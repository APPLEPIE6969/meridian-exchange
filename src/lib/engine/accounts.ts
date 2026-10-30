// Account & trading service: registration, API keys, order placement with
// buying-power checks + reservations, positions, portfolio history, margins.

import crypto from 'crypto'
import { db } from '@/lib/db'
import { MarketEngine } from './engine'
import { getEngineReady } from '.'
import { applyFill } from './fillExecutor'
import { roundTo } from './rng'

export const INITIAL_CASH = 100000

// ────────────────────────────────────────────── passwords & keys

function scryptHash(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  return `${salt}:${scryptHash(password, salt)}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptHash(password, salt)
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'))
}

function newApiKey(): string {
  return 'mrx_live_' + crypto.randomBytes(20).toString('hex')
}

function newAccountNumber(): string {
  return 'MRX' + String(Math.floor(10000000 + Math.random() * 89999999))
}

// ────────────────────────────────────────────── reservations (in-memory)

interface Reservation {
  accountId: string
  bp: number // buying power reserved
  shares: number // shares reserved for sell (long reduction)
  symbol: string
  qty: number // total order quantity
}
const reservations = new Map<string, Reservation>() // orderId -> reservation

function releaseReservation(orderId: string, frac = 1): void {
  const r = reservations.get(orderId)
  if (!r) return
  if (frac >= 1) reservations.delete(orderId)
  else {
    r.bp *= 1 - frac
    r.shares *= 1 - frac
  }
}

// ────────────────────────────────────────────── account lifecycle

export interface RegisterInput {
  email: string
  password: string
  name?: string
  handle?: string
}

export async function registerAccount(input: RegisterInput) {
  const email = input.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(422, 'INVALID_EMAIL', 'Please provide a valid email address.')
  if (!input.password || input.password.length < 8) throw new ApiError(422, 'WEAK_PASSWORD', 'Password must be at least 8 characters.')
  const existing = await db.account.findUnique({ where: { email } })
  if (existing) throw new ApiError(409, 'ACCOUNT_EXISTS', 'An account with this email already exists.')

  let handle = (input.handle || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18) || 'trader'
  if (await db.account.findUnique({ where: { handle } })) handle = handle + '_' + crypto.randomBytes(2).toString('hex')

  const account = await db.account.create({
    data: {
      email,
      name: input.name?.trim() || handle,
      handle,
      passwordHash: hashPassword(input.password),
      apiKey: newApiKey(),
      accountNumber: newAccountNumber(),
      cash: INITIAL_CASH,
      lastEquity: INITIAL_CASH,
    },
  })
  return account
}

export async function loginAccount(email: string, password: string) {
  const account = await db.account.findUnique({ where: { email: email.trim().toLowerCase() } })
  if (!account || !verifyPassword(password, account.passwordHash)) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.')
  }
  return account
}

export async function accountByApiKey(key: string | null) {
  if (!key) return null
  return db.account.findUnique({ where: { apiKey: key } })
}

export async function accountById(id: string | null) {
  if (!id) return null
  return db.account.findUnique({ where: { id } })
}

export async function rotateApiKey(accountId: string) {
  const key = newApiKey()
  await db.account.update({ where: { id: accountId }, data: { apiKey: key } })
  return key
}

// ────────────────────────────────────────────── ApiError

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// ────────────────────────────────────────────── engine hooks

let hooksWiredFor: MarketEngine | null = null

/** Attach DB-persistence hooks to an engine instance (idempotent per instance). */
export function wireEngineHooks(engine: MarketEngine): void {
  if (hooksWiredFor === engine) return
  hooksWiredFor = engine
  engine.hooks = {
      onFill: async (orderId, accountId, fill, done) => {
        const result = await applyFill(orderId, accountId, fill, done)
        const res = reservations.get(orderId)
        if (res) {
          releaseReservation(orderId, fill.qty / Math.max(res.qty, 1e-9))
        }
        engine.broadcastNow('account:' + accountId, 'fill', {
          order_id: orderId, symbol: undefined, qty: fill.qty, price: fill.price, fee: fill.fee,
          filled_qty: result.filledQty, status: result.status, ts: Date.now(),
        })
        engine.broadcastNow('account:' + accountId, 'order', { id: orderId, status: result.status, filled_qty: result.filledQty, filled_avg_price: result.filledAvgPrice })
      },
      onOrderStatus: async (orderId, accountId, status, reason) => {
        await db.order.update({ where: { id: orderId }, data: { status, rejectReason: reason ?? null } }).catch(() => undefined)
        releaseReservation(orderId)
        engine.broadcastNow('account:' + accountId, 'order', { id: orderId, status, reason })
      },
      checkMargins: async () => {
        await runMarginCheck(engine)
      },
  }
}

export function ensureEngineHooks(): void {
  void getEngineReady().then(wireEngineHooks)
}

// ────────────────────────────────────────────── valuation helpers

export interface AccountValuation {
  cash: number
  longMv: number
  shortMv: number
  equity: number
  gross: number
  buyingPower: number
  reservedBp: number
  availableBp: number
  positions: { symbol: string; qty: number; avgPrice: number; price: number }[]
}

export async function valueAccount(accountId: string, engine: MarketEngine): Promise<AccountValuation> {
  const account = await db.account.findUnique({ where: { id: accountId } })
  if (!account) throw new ApiError(404, 'NOT_FOUND', 'Account not found.')
  const positions = await db.position.findMany({ where: { accountId } })
  let longMv = 0
  let shortMv = 0
  const posViews = positions.map((p) => {
    const q = engine.quote(p.symbol)
    const price = q?.p ?? p.avgPrice
    const mv = p.qty * price
    if (mv >= 0) longMv += mv
    else shortMv += mv
    return { symbol: p.symbol, qty: p.qty, avgPrice: p.avgPrice, price }
  })
  const equity = account.cash + longMv + shortMv
  const gross = longMv + Math.abs(shortMv)
  let reservedBp = 0
  for (const r of reservations.values()) if (r.accountId === accountId) reservedBp += r.bp
  const buyingPower = Math.max(0, equity * account.multiplier - gross)
  return {
    cash: account.cash,
    longMv,
    shortMv,
    equity,
    gross,
    buyingPower,
    reservedBp,
    availableBp: Math.max(0, buyingPower - reservedBp),
    positions: posViews,
  }
}

// ────────────────────────────────────────────── order placement

export interface PlaceOrderInput {
  symbol: string
  qty?: number
  notional?: number
  side: 'buy' | 'sell'
  type: 'market' | 'limit' | 'stop' | 'stop_limit'
  time_in_force?: 'day' | 'gtc' | 'ioc' | 'fok'
  limit_price?: number
  stop_price?: number
  client_order_id?: string
}

export async function placeOrder(accountId: string, input: PlaceOrderInput) {
  ensureEngineHooks()
  const engine = await getEngineReady()

  const symbol = String(input.symbol ?? '').toUpperCase().trim()
  if (!symbol) throw new ApiError(422, 'SYMBOL_REQUIRED', 'Symbol is required.')

  // client order id idempotency
  if (input.client_order_id) {
    const dupe = await db.order.findFirst({ where: { accountId, clientOrderId: input.client_order_id } })
    if (dupe) return dupe
  }

  const q = engine.quote(symbol)
  if (!q) throw new ApiError(404, 'SYMBOL_NOT_FOUND', `No security found for symbol '${symbol}'. Verify the symbol and try again.`)

  const type = input.type
  if (!['market', 'limit', 'stop', 'stop_limit'].includes(type)) {
    throw new ApiError(422, 'INVALID_ORDER_TYPE', `Order type '${type}' is not supported. Use market, limit, stop, or stop_limit.`)
  }
  const tif = input.time_in_force ?? 'day'
  if (!['day', 'gtc', 'ioc', 'fok'].includes(tif)) {
    throw new ApiError(422, 'INVALID_TIF', `time_in_force must be one of: day, gtc, ioc, fok.`)
  }
  if ((type === 'limit' || type === 'stop_limit') && (!input.limit_price || input.limit_price <= 0)) {
    throw new ApiError(422, 'LIMIT_PRICE_REQUIRED', `Order type '${type}' requires a positive limit_price.`)
  }
  if ((type === 'stop' || type === 'stop_limit') && (!input.stop_price || input.stop_price <= 0)) {
    throw new ApiError(422, 'STOP_PRICE_REQUIRED', `Order type '${type}' requires a positive stop_price.`)
  }

  let qty = input.qty
  if (!qty && input.notional) {
    if (input.notional < 1) throw new ApiError(422, 'INVALID_NOTIONAL', 'Notional value must be at least $1.00.')
    if (type !== 'market') throw new ApiError(422, 'NOTIONAL_MARKET_ONLY', 'Notional orders are only supported for market orders.')
    qty = roundTo(input.notional / q.p, 4)
  }
  if (!qty || qty <= 0) throw new ApiError(422, 'INVALID_QUANTITY', 'Quantity must be a positive number.')
  if (qty > 500000) throw new ApiError(422, 'INVALID_QUANTITY', 'Quantity exceeds maximum order size of 500,000 shares.')
  const estPrice = type === 'limit' ? (input.limit_price as number) : type === 'stop_limit' ? (input.limit_price as number) : q.p
  const notionalEst = qty * estPrice
  if (notionalEst > 25_000_000) throw new ApiError(422, 'ORDER_TOO_LARGE', 'Estimated order value exceeds the $25,000,000 maximum single-order notional.')

  const account = await db.account.findUnique({ where: { id: accountId } })
  if (!account) throw new ApiError(404, 'NOT_FOUND', 'Account not found.')
  if (account.status === 'RESTRICTED') throw new ApiError(403, 'ACCOUNT_RESTRICTED', 'This account is restricted. Contact support for assistance.')

  const valuation = await valueAccount(accountId, engine)

  // ── buying power / shares availability
  let bpNeeded = 0
  let sharesReserved = 0
  if (input.side === 'buy') {
    bpNeeded = notionalEst
  } else {
    const pos = valuation.positions.find((p) => p.symbol === symbol)
    const longQty = pos && pos.qty > 0 ? pos.qty : 0
    let reservedAlready = 0
    for (const r of reservations.values()) if (r.accountId === accountId && r.symbol === symbol) reservedAlready += r.shares
    const sellable = Math.max(0, longQty - reservedAlready)
    sharesReserved = Math.min(qty, sellable)
    const shortQty = Math.max(0, qty - sellable)
    if (shortQty > 0) {
      bpNeeded = shortQty * estPrice
      if (account.status === 'MARGIN_CALL') {
        throw new ApiError(422, 'MARGIN_CALL', 'Account is in margin call. Short sales are not permitted until equity is restored.')
      }
    }
  }
  if (bpNeeded > valuation.availableBp + 1e-6) {
    throw new ApiError(
      422,
      'INSUFFICIENT_BUYING_POWER',
      `Order requires $${roundTo(bpNeeded, 2).toLocaleString('en-US')} of buying power, but only $${roundTo(valuation.availableBp, 2).toLocaleString('en-US')} is available (equity $${roundTo(valuation.equity, 2).toLocaleString('en-US')}, ${account.multiplier}x margin).`,
    )
  }

  // ── create order row
  const order = await db.order.create({
    data: {
      accountId,
      clientOrderId: input.client_order_id ?? null,
      symbol,
      side: input.side,
      type,
      qty,
      notional: input.notional ?? null,
      limitPrice: input.limit_price ?? null,
      stopPrice: input.stop_price ?? null,
      tif,
      status: 'new',
    },
  })

  reservations.set(order.id, { accountId, bp: bpNeeded, shares: sharesReserved, symbol, qty })

  const result = await engine.submitOrder({
    id: order.id,
    accountId,
    symbol,
    side: input.side,
    type,
    qty,
    limitPrice: input.limit_price ?? null,
    stopPrice: input.stop_price ?? null,
    tif,
  })

  if (result.reject) {
    await db.order.update({ where: { id: order.id }, data: { status: 'rejected', rejectReason: result.reject } })
    releaseReservation(order.id)
    throw new ApiError(422, 'ORDER_REJECTED', result.reject)
  }

  // apply immediate fills
  let filledQty = 0
  for (const f of result.fills) {
    const applied = await applyFill(order.id, accountId, f, true)
    filledQty = applied.filledQty
    releaseReservation(order.id, f.qty / qty)
    engine.broadcastNow('account:' + accountId, 'fill', {
      order_id: order.id, symbol, qty: f.qty, price: f.price, fee: f.fee,
      filled_qty: applied.filledQty, status: applied.status, ts: Date.now(),
    })
  }

  let status = result.status
  if (result.resting && (tif === 'ioc' || tif === 'fok')) {
    if (tif === 'fok' && filledQty < qty - 1e-9) {
      await engine.cancelOrder(order.id)
      await db.order.update({ where: { id: order.id }, data: { status: 'canceled', rejectReason: 'FOK: order could not be filled in full immediately.' } })
      releaseReservation(order.id)
      status = 'canceled'
    } else if (tif === 'ioc') {
      await engine.cancelOrder(order.id)
      const st = filledQty > 0 ? 'partially_filled' : 'canceled'
      await db.order.update({ where: { id: order.id }, data: { status: st, rejectReason: filledQty > 0 ? 'IOC: unfilled portion canceled.' : 'IOC: no liquidity at market; canceled.' } })
      releaseReservation(order.id)
      status = st
    }
  } else if (result.resting) {
    await db.order.update({ where: { id: order.id }, data: { status: 'accepted' } })
    status = 'accepted'
  }

  const updated = await db.order.findUnique({ where: { id: order.id } })
  return updated
}

export async function cancelOrder(accountId: string, orderId: string) {
  ensureEngineHooks()
  const engine = await getEngineReady()
  const order = await db.order.findUnique({ where: { id: orderId } })
  if (!order || order.accountId !== accountId) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found.')
  if (['filled', 'canceled', 'expired', 'rejected'].includes(order.status)) {
    throw new ApiError(422, 'ORDER_ALREADY_PROCESSED', `Order is already ${order.status} and can no longer be canceled.`)
  }
  const removed = await engine.cancelOrder(orderId)
  if (!removed) {
    await db.order.update({ where: { id: orderId }, data: { status: 'canceled' } })
  }
  releaseReservation(orderId)
  return db.order.findUnique({ where: { id: orderId } })
}

// ────────────────────────────────────────────── margin maintenance

async function runMarginCheck(engine: MarketEngine): Promise<void> {
  const accounts = await db.account.findMany({ where: { status: { in: ['ACTIVE', 'MARGIN_CALL'] } } })
  for (const account of accounts) {
    const positions = await db.position.findMany({ where: { accountId: account.id } })
    if (positions.length === 0) {
      if (account.status !== 'ACTIVE') {
        await db.account.update({ where: { id: account.id }, data: { status: 'ACTIVE' } })
      }
      continue
    }
    let longMv = 0
    let shortMv = 0
    for (const p of positions) {
      const price = engine.quote(p.symbol)?.p ?? p.avgPrice
      const mv = p.qty * price
      if (mv >= 0) longMv += mv
      else shortMv += mv
    }
    const equity = account.cash + longMv + shortMv
    const gross = longMv + Math.abs(shortMv)

    if (gross > 0 && equity < 0.15 * gross) {
      // force liquidation
      await liquidateAccount(engine, account.id)
    } else if (gross > 0 && equity < 0.30 * gross) {
      if (account.status !== 'MARGIN_CALL') {
        await db.account.update({ where: { id: account.id }, data: { status: 'MARGIN_CALL' } })
      }
    } else if (account.status === 'MARGIN_CALL' && equity >= 0.5 * gross) {
      await db.account.update({ where: { id: account.id }, data: { status: 'ACTIVE' } })
    }
  }
}

async function liquidateAccount(engine: MarketEngine, accountId: string): Promise<void> {
  // cancel resting orders
  const open = await db.order.findMany({ where: { accountId, status: { in: ['new', 'accepted', 'partially_filled'] } } })
  for (const o of open) {
    await engine.cancelOrder(o.id).catch(() => undefined)
    releaseReservation(o.id)
  }
  await db.order.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: 'canceled', rejectReason: 'Canceled: margin call liquidation.' } }).catch(() => undefined)

  const positions = await db.position.findMany({ where: { accountId } })
  for (const p of positions) {
    const q = engine.quote(p.symbol)
    if (!q) continue
    const side = p.qty > 0 ? 'sell' : 'buy'
    const qty = Math.abs(p.qty)
    const order = await db.order.create({
      data: {
        accountId, symbol: p.symbol, side, type: 'market', qty, tif: 'day',
        status: 'new', clientOrderId: 'LIQ-' + Date.now().toString(36) + '-' + p.symbol,
      },
    })
    const result = await engine.submitOrder({ id: order.id, accountId, symbol: p.symbol, side, type: 'market', qty, limitPrice: null, stopPrice: null, tif: 'day' }, { skipLiquidityCheck: true })
    for (const f of result.fills) {
      await applyFill(order.id, accountId, f, true).catch(() => undefined)
    }
    if (result.reject) {
      await db.order.update({ where: { id: order.id }, data: { status: 'rejected', rejectReason: result.reject } })
    }
  }
  await db.account.update({ where: { id: accountId }, data: { status: 'MARGIN_CALL' } })
}

// ────────────────────────────────────────────── views

export function orderView(o: {
  id: string
  clientOrderId: string | null
  symbol: string
  side: string
  type: string
  qty: number
  notional: number | null
  filledQty: number
  filledAvgPrice: number | null
  limitPrice: number | null
  stopPrice: number | null
  tif: string
  status: string
  rejectReason: string | null
  createdAt: Date
  updatedAt: Date
  filledAt: Date | null
}) {
  return {
    id: o.id,
    client_order_id: o.clientOrderId,
    created_at: o.createdAt.toISOString(),
    updated_at: o.updatedAt.toISOString(),
    submitted_at: o.createdAt.toISOString(),
    filled_at: o.filledAt?.toISOString() ?? null,
    status: o.status,
    symbol: o.symbol,
    asset_class: 'us_equity',
    qty: String(o.qty),
    notional: o.notional ? String(o.notional) : null,
    filled_qty: String(o.filledQty),
    filled_avg_price: o.filledAvgPrice ? String(o.filledAvgPrice) : null,
    order_type: o.type,
    side: o.side,
    time_in_force: o.tif,
    limit_price: o.limitPrice ? String(o.limitPrice) : null,
    stop_price: o.stopPrice ? String(o.stopPrice) : null,
    reject_reason: o.rejectReason,
  }
}

export async function accountView(accountId: string) {
  const engine = await getEngineReady()
  const account = await db.account.findUnique({ where: { id: accountId } })
  if (!account) throw new ApiError(404, 'NOT_FOUND', 'Account not found.')
  const v = await valueAccount(accountId, engine)
  return {
    id: account.id,
    account_number: account.accountNumber,
    status: account.status,
    currency: 'USD',
    cash: roundTo(v.cash, 2),
    cash_available: roundTo(Math.max(0, v.cash), 2),
    portfolio_value: roundTo(v.equity, 2),
    equity: roundTo(v.equity, 2),
    long_market_value: roundTo(v.longMv, 2),
    short_market_value: roundTo(v.shortMv, 2),
    initial_margin: roundTo(v.gross / 2, 2),
    maintenance_margin: roundTo(v.gross * 0.3, 2),
    buying_power: roundTo(v.buyingPower, 2),
    buying_power_available: roundTo(v.availableBp, 2),
    multiplier: String(account.multiplier),
    daytrade_count: account.daytradeCount,
    pattern_day_trader: false,
    trading_blocked: account.status === 'RESTRICTED',
    account_blocked: false,
    created_at: account.createdAt.toISOString(),
    handle: account.handle,
  }
}

export async function positionViews(accountId: string) {
  const engine = await getEngineReady()
  const positions = await db.position.findMany({ where: { accountId }, orderBy: { symbol: 'asc' } })
  return positions.map((p) => {
    const q = engine.quote(p.symbol)
    const price = q?.p ?? p.avgPrice
    const prev = q?.pc ?? price
    const mv = p.qty * price
    const cost = p.qty * p.avgPrice
    return {
      symbol: p.symbol,
      qty: String(p.qty),
      side: p.qty >= 0 ? 'long' : 'short',
      avg_entry_price: String(p.avgPrice),
      market_price: String(price),
      market_value: roundTo(mv, 2),
      cost_basis: roundTo(cost, 2),
      unrealized_pl: roundTo(mv - cost, 2),
      unrealized_plpc: roundTo(cost !== 0 ? (mv - cost) / Math.abs(cost) : 0, 6),
      change_today: roundTo(price - prev, 2),
      asset_class: 'us_equity',
    }
  })
}

export async function portfolioHistory(accountId: string, period: '1D' | '1W' | '1M' | '1A') {
  const engine = await getEngineReady()
  const account = await db.account.findUnique({ where: { id: accountId } })
  if (!account) throw new ApiError(404, 'NOT_FOUND', 'Account not found.')
  const now = Date.now()
  const spans: Record<string, number> = { '1D': 86400000, '1W': 7 * 86400000, '1M': 30 * 86400000, '1A': now - account.createdAt.getTime() }
  const span = Math.max(spans[period] ?? 86400000, 3600000)
  const start = now - span
  const fills = await db.fill.findMany({ where: { accountId, createdAt: { gte: new Date(start - 90 * 86400000) } }, orderBy: { createdAt: 'asc' } })

  const n = Math.min(160, Math.max(40, Math.floor(span / 600000)))
  const step = span / n
  const timestamps: number[] = []
  const equity: number[] = []
  const profitLoss: number[] = []

  const fillsByTs = fills.map((f) => ({ ts: f.createdAt.getTime(), symbol: f.symbol, side: f.side, qty: f.qty, price: f.price, fee: f.fee }))
  let fi = 0
  let cash = INITIAL_CASH
  const holdings = new Map<string, number>()

  const priceAt = (symbol: string, ts: number): number => {
    const st = engine.states.get(symbol)
    if (!st) return 0
    if (ts >= now - 120000) return st.price
    const date = new Date(ts).toISOString().slice(0, 10)
    let best: number | null = null
    for (const b of st.dailyBars) {
      if (b.date <= date) best = b.c
      else break
    }
    if (best === null) return st.today.o || st.price
    return best
  }

  for (let i = 0; i <= n; i++) {
    const t = Math.min(start + i * step, now)
    while (fi < fillsByTs.length && fillsByTs[fi].ts <= t) {
      const f = fillsByTs[fi]
      cash += f.side === 'buy' ? -(f.qty * f.price + f.fee) : f.qty * f.price - f.fee
      holdings.set(f.symbol, (holdings.get(f.symbol) ?? 0) + (f.side === 'buy' ? f.qty : -f.qty))
      fi++
    }
    let mv = 0
    for (const [sym, qty] of holdings) if (Math.abs(qty) > 1e-9) mv += qty * priceAt(sym, t)
    const eq = cash + mv
    timestamps.push(t)
    equity.push(roundTo(eq, 2))
    profitLoss.push(roundTo(eq - INITIAL_CASH, 2))
  }
  return {
    timestamp: timestamps.map((t) => Math.floor(t / 1000)),
    equity,
    profit_loss: profitLoss,
    profit_loss_pct: equity.map((e) => roundTo((e / INITIAL_CASH - 1) * 100, 3)),
    base_value: INITIAL_CASH,
    timeframe: period,
  }
}

export async function leaderboard(limit = 20) {
  const engine = await getEngineReady()
  const accounts = await db.account.findMany({ select: { id: true, handle: true, cash: true, createdAt: true } })
  // Test profiles may carry an operator-set public alias; it only replaces the
  // DISPLAY handle. Rank ordering and metrics are untouched, and accounts
  // without an alias are indistinguishable from regular customers.
  const profiles = await db.testProfile.findMany({ select: { accountId: true, leaderboardAlias: true } })
  const aliasByAccount = new Map(
    profiles.filter((p) => p.leaderboardAlias).map((p) => [p.accountId, p.leaderboardAlias as string]),
  )
  const rows: { handle: string; equity: number; return_pct: number; trades: number }[] = []
  for (const a of accounts) {
    const positions = await db.position.findMany({ where: { accountId: a.id } })
    let mv = 0
    let trades = 0
    for (const p of positions) {
      const price = engine.quote(p.symbol)?.p ?? p.avgPrice
      mv += p.qty * price
    }
    const fills = await db.fill.count({ where: { accountId: a.id } })
    trades = fills
    const equity = a.cash + mv
    rows.push({ handle: aliasByAccount.get(a.id) ?? a.handle, equity: roundTo(equity, 2), return_pct: roundTo((equity / INITIAL_CASH - 1) * 100, 2), trades })
  }
  rows.sort((x, y) => y.return_pct - x.return_pct)
  return { leaderboard: rows.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r })), ts: Date.now() }
}
