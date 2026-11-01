// Account lifecycle, order placement with buying power, cancellations,
// valuations, portfolio history, leaderboard and the margin engine.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerAccount, loginAccount, rotateApiKey, accountByApiKey, accountById,
  placeOrder, cancelOrder, valueAccount, accountView, positionViews,
  portfolioHistory, leaderboard, orderView, INITIAL_CASH, ApiError, wireEngineHooks,
} from '@/lib/engine/accounts'
import { getEngineReady } from '@/lib/engine'
import { db } from '@/lib/db'
import type { MarketEngine } from '@/lib/engine/engine'

let engine: MarketEngine
let n = 0

function uniq(prefix: string) {
  n++
  return `${prefix}-${Date.now()}-${n}@mrx.dev`
}

async function freshAccount(handle?: string) {
  return registerAccount({ email: uniq('acct'), password: 'password123', handle })
}

beforeEach(async () => {
  engine = await getEngineReady()
  // halts from earlier suites must never leak into trading tests
  for (const s of engine.states.values()) { s.haltedUntil = 0; s.priceRing.fill(s.price); s.ringIdx = 0 }
})

async function priceOf(symbol: string): Promise<number> {
  return engine.quote(symbol)!.p
}

describe('registration & credentials', () => {
  it('registers a funded account with API key and account number', async () => {
    const acct = await registerAccount({ email: uniq('reg'), password: 'password123', name: 'Test One', handle: 'reg_one' })
    expect(acct.cash).toBe(INITIAL_CASH)
    expect(acct.apiKey).toMatch(/^mrx_live_[0-9a-f]{40}$/)
    expect(acct.accountNumber).toMatch(/^MRX\d{8}$/)
    expect(acct.status).toBe('ACTIVE')
    expect(acct.multiplier).toBe(2)
    expect(acct.name).toBe('Test One')
  })

  it('rejects invalid emails, weak passwords and duplicate emails', async () => {
    await expect(registerAccount({ email: 'not-an-email', password: 'password123' })).rejects.toMatchObject({ code: 'INVALID_EMAIL', status: 422 })
    await expect(registerAccount({ email: uniq('weak'), password: 'short' })).rejects.toMatchObject({ code: 'WEAK_PASSWORD', status: 422 })
    const acct = await freshAccount()
    await expect(registerAccount({ email: acct.email, password: 'password123' })).rejects.toMatchObject({ code: 'ACCOUNT_EXISTS', status: 409 })
  })

  it('derives and sanitizes handles from emails; appends a suffix on collisions', async () => {
    const a = await registerAccount({ email: 'John.Doe@Example.com', password: 'password123' })
    expect(a.handle).toBe('johndoe')
    const b = await registerAccount({ email: 'john.doe@other.example', password: 'password123' })
    expect(b.handle).not.toBe('johndoe')
    expect(b.handle.startsWith('johndoe_')).toBe(true)
    expect(b.handle.length).toBeLessThanOrEqual('johndoe_'.length + 4)
  })

  it('logins with valid credentials and rejects bad ones', async () => {
    const acct = await freshAccount('loginok')
    const found = await loginAccount(acct.email.toUpperCase(), 'password123')
    expect(found.id).toBe(acct.id)
    await expect(loginAccount(acct.email, 'wrong-password')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 })
    await expect(loginAccount('ghost@mrx.dev', 'password123')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('looks accounts up by key and id (null-safe)', async () => {
    const acct = await freshAccount()
    expect((await accountByApiKey(acct.apiKey))?.id).toBe(acct.id)
    expect(await accountByApiKey(null)).toBeNull()
    expect(await accountByApiKey('mrx_live_nope')).toBeNull()
    expect((await accountById(acct.id))?.id).toBe(acct.id)
    expect(await accountById(null)).toBeNull()
    expect(await accountById('missing')).toBeNull()
  })

  it('rotates the API key, invalidating the old one', async () => {
    const acct = await freshAccount()
    const old = acct.apiKey
    const key = await rotateApiKey(acct.id)
    expect(key).toMatch(/^mrx_live_/)
    expect(key).not.toBe(old)
    expect(await accountByApiKey(old)).toBeNull()
    expect((await accountByApiKey(key))?.id).toBe(acct.id)
  })

  it('hashes passwords with per-user salts and verifies safely', async () => {
    const acct = await freshAccount()
    const [salt] = acct.passwordHash.split(':')
    expect(acct.passwordHash).toContain(':')
    const { verifyPassword } = await import('@/lib/engine/accounts')
    expect(verifyPassword('password123', acct.passwordHash)).toBe(true)
    expect(verifyPassword('wrong', acct.passwordHash)).toBe(false)
    expect(verifyPassword('password123', 'no-colon-here')).toBe(false)
    expect(salt!.length).toBe(32)
  })
})

describe('order placement — validation', () => {
  it('requires a symbol and rejects unknown symbols', async () => {
    const acct = await freshAccount()
    await expect(placeOrder(acct.id, { symbol: '', side: 'buy', type: 'market', qty: 1 })).rejects.toMatchObject({ code: 'SYMBOL_REQUIRED' })
    await expect(placeOrder(acct.id, { symbol: '  ', side: 'buy', type: 'market', qty: 1 })).rejects.toMatchObject({ code: 'SYMBOL_REQUIRED' })
    await expect(placeOrder(acct.id, { symbol: 'BOGUS', side: 'buy', type: 'market', qty: 1 })).rejects.toMatchObject({ code: 'SYMBOL_NOT_FOUND', status: 404 })
  })

  it('lowercase symbols are normalized', async () => {
    const acct = await freshAccount()
    const order = await placeOrder(acct.id, { symbol: 'qntm', side: 'buy', type: 'market', qty: 1 })
    expect(order!.symbol).toBe('QNTM')
    expect(order!.status).toBe('filled')
  })

  it('validates order type and time in force', async () => {
    const acct = await freshAccount()
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'weird' as 'market', qty: 1 })).rejects.toMatchObject({ code: 'INVALID_ORDER_TYPE' })
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'market', qty: 1, time_in_force: 'year' as 'day' })).rejects.toMatchObject({ code: 'INVALID_TIF' })
  })

  it('requires prices for limit / stop order types', async () => {
    const acct = await freshAccount()
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'limit', qty: 1 })).rejects.toMatchObject({ code: 'LIMIT_PRICE_REQUIRED' })
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'limit', qty: 1, limit_price: 0 })).rejects.toMatchObject({ code: 'LIMIT_PRICE_REQUIRED' })
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'stop', qty: 1 })).rejects.toMatchObject({ code: 'STOP_PRICE_REQUIRED' })
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'stop_limit', qty: 1, limit_price: 10 })).rejects.toMatchObject({ code: 'STOP_PRICE_REQUIRED' })
  })

  it('validates quantity, notional and maximum order size', async () => {
    const acct = await freshAccount()
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'market' })).rejects.toMatchObject({ code: 'INVALID_QUANTITY' })
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'market', qty: 0 })).rejects.toMatchObject({ code: 'INVALID_QUANTITY' })
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'market', qty: -3 })).rejects.toMatchObject({ code: 'INVALID_QUANTITY' })
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'market', qty: 600000 })).rejects.toMatchObject({ code: 'INVALID_QUANTITY' })
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'market', notional: 0.5 })).rejects.toMatchObject({ code: 'INVALID_NOTIONAL' })
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'limit', notional: 500, limit_price: 600 })).rejects.toMatchObject({ code: 'NOTIONAL_MARKET_ONLY' })
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'market', qty: 100000 })).rejects.toMatchObject({ code: 'ORDER_TOO_LARGE' })
  })

  it('converts notional market orders into fractional quantities', async () => {
    const acct = await freshAccount()
    const px = await priceOf('HELX')
    const order = await placeOrder(acct.id, { symbol: 'HELX', side: 'buy', type: 'market', notional: 1000 })
    expect(order!.notional).toBe(1000)
    expect(order!.qty).toBeCloseTo(1000 / px, 4)
    expect(order!.status).toBe('filled')
  })

  it('enforces buying power and account state', async () => {
    const acct = await freshAccount()
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'market', notional: 9000000 }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_BUYING_POWER', status: 422 })

    await db.account.update({ where: { id: acct.id }, data: { status: 'RESTRICTED' } })
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'market', qty: 1 }))
      .rejects.toMatchObject({ code: 'ACCOUNT_RESTRICTED', status: 403 })
    await db.account.update({ where: { id: acct.id }, data: { status: 'ACTIVE' } })

    await expect(placeOrder('missing-account', { symbol: 'QNTM', side: 'buy', type: 'market', qty: 1 }))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })

  it('blocks short sales for accounts in margin call', async () => {
    const acct = await freshAccount()
    await db.account.update({ where: { id: acct.id }, data: { status: 'MARGIN_CALL' } })
    await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'sell', type: 'market', qty: 10 }))
      .rejects.toMatchObject({ code: 'MARGIN_CALL' })
    await db.account.update({ where: { id: acct.id }, data: { status: 'ACTIVE' } })
  })

  it('is idempotent on client_order_id', async () => {
    const acct = await freshAccount()
    const coid = `coid-${Date.now()}-${n}`
    const first = await placeOrder(acct.id, { symbol: 'HELX', side: 'buy', type: 'market', qty: 1, client_order_id: coid })
    const again = await placeOrder(acct.id, { symbol: 'HELX', side: 'buy', type: 'market', qty: 1, client_order_id: coid })
    expect(again!.id).toBe(first!.id)
  })
})

describe('order placement — execution', () => {
  it('fills market orders from the book at the ask/bid', async () => {
    const acct = await freshAccount()
    const px = await priceOf('VLTR')
    const buy = await placeOrder(acct.id, { symbol: 'VLTR', side: 'buy', type: 'market', qty: 5 })
    expect(buy!.status).toBe('filled')
    expect(buy!.filledQty).toBe(5)
    expect(Number(buy!.filledAvgPrice)).toBeGreaterThanOrEqual(px * 0.995)
    const pos = await positionViews(acct.id)
    expect(pos).toHaveLength(1)
    expect(pos[0].side).toBe('long')

    const sell = await placeOrder(acct.id, { symbol: 'VLTR', side: 'sell', type: 'market', qty: 5 })
    expect(sell!.status).toBe('filled')
    expect(await positionViews(acct.id)).toHaveLength(0)
  })

  it('walks large market orders with a slippage tail', async () => {
    const acct = await freshAccount()
    await db.account.update({ where: { id: acct.id }, data: { cash: 5_000_000, lastEquity: 5_000_000 } })
    const order = await placeOrder(acct.id, { symbol: 'KRYO', side: 'buy', type: 'market', qty: 5000 })
    expect(order!.status).toBe('filled')
    const fillRows = await db.fill.findMany({ where: { orderId: order!.id } })
    expect(fillRows.length).toBeGreaterThanOrEqual(1)
  })

  it('shorts from flat and covers back to flat', async () => {
    const acct = await freshAccount()
    const order = await placeOrder(acct.id, { symbol: 'MENDL', side: 'sell', type: 'market', qty: 3 })
    expect(order!.status).toBe('filled')
    const pos = (await positionViews(acct.id))[0]
    expect(pos.side).toBe('short')
    await placeOrder(acct.id, { symbol: 'MENDL', side: 'buy', type: 'market', qty: 3 })
    expect(await positionViews(acct.id)).toHaveLength(0)
  })

  it('rests non-marketable limits and fills them when the market crosses', async () => {
    const acct = await freshAccount()
    const px = await priceOf('AXNDA')
    const order = await placeOrder(acct.id, { symbol: 'AXNDA', side: 'buy', type: 'limit', qty: 2, limit_price: px * 0.8, time_in_force: 'gtc' })
    expect(order!.status).toBe('accepted')
    expect(engine.hasResting(order!.id)).toBe(true)

    // Force the fill path: drop the offer through the limit.
    const st = engine.states.get('AXNDA')!
    const resting = engine.restingBySymbol.get('AXNDA')!
    const ro = resting.find((r) => r.orderId === order!.id)!
    st.asks = [{ price: ro.limitPrice!, size: 500 }, ...st.asks]
    await (engine as unknown as { matchResting: () => Promise<void> }).matchResting()
    expect(engine.hasResting(order!.id)).toBe(false)
    const after = await db.order.findUnique({ where: { id: order!.id } })
    expect(after!.status).toBe('filled')
  })

  it('IOC orders keep the filled part and cancel the rest', async () => {
    const acct = await freshAccount()
    await db.account.update({ where: { id: acct.id }, data: { cash: 5_000_000, lastEquity: 5_000_000 } })
    const px = await priceOf('CLDU')
    const order = await placeOrder(acct.id, { symbol: 'CLDU', side: 'buy', type: 'limit', qty: 100000, limit_price: px + 0.5, time_in_force: 'ioc' })
    expect(order!.status).toBe('partially_filled')
    expect(order!.filledQty).toBeGreaterThan(0)
    expect(order!.filledQty).toBeLessThan(100000)
    expect(order!.rejectReason).toContain('IOC')
    expect(engine.hasResting(order!.id)).toBe(false)
  })

  it('FOK orders cancel entirely unless fully filled immediately', async () => {
    const acct = await freshAccount()
    await db.account.update({ where: { id: acct.id }, data: { cash: 5_000_000, lastEquity: 5_000_000 } })
    const px = await priceOf('VNTQ')
    const order = await placeOrder(acct.id, { symbol: 'VNTQ', side: 'buy', type: 'limit', qty: 100000, limit_price: px + 0.5, time_in_force: 'fok' })
    expect(order!.status).toBe('canceled')
    expect(order!.rejectReason).toContain('FOK')
    expect(order!.filledQty).toBeGreaterThan(0)
  })

  it('surfaces engine rejections as ORDER_REJECTED and releases reservations', async () => {
    const acct = await freshAccount()
    engine.paused = true
    try {
      await expect(placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'market', qty: 1 }))
        .rejects.toMatchObject({ code: 'ORDER_REJECTED' })
    } finally {
      engine.paused = false
    }
    expect((await valueAccount(acct.id, engine)).reservedBp).toBe(0)
  })

  it('rejects orders on halted symbols and releases reservations', async () => {
    const acct = await freshAccount()
    engine.haltSymbol('OCTEQ', 30)
    try {
      await expect(placeOrder(acct.id, { symbol: 'OCTEQ', side: 'buy', type: 'market', qty: 1 }))
        .rejects.toMatchObject({ code: 'ORDER_REJECTED' })
      expect((await valueAccount(acct.id, engine)).reservedBp).toBe(0)
    } finally {
      engine.resumeSymbol('OCTEQ')
    }
  })
})

describe('cancellations', () => {
  it('cancels resting orders and releases the reservation', async () => {
    const acct = await freshAccount()
    const px = await priceOf('CDXR')
    const order = await placeOrder(acct.id, { symbol: 'CDXR', side: 'buy', type: 'limit', qty: 1, limit_price: px * 0.5, time_in_force: 'gtc' })
    const reserved = (await valueAccount(acct.id, engine)).reservedBp
    expect(reserved).toBeGreaterThan(0)
    const canceled = await cancelOrder(acct.id, order!.id)
    expect(canceled!.status).toBe('canceled')
    expect((await valueAccount(acct.id, engine)).reservedBp).toBe(0)
    expect(engine.hasResting(order!.id)).toBe(false)
  })

  it('cancels resting stops (stop-monitor path)', async () => {
    const acct = await freshAccount()
    const px = await priceOf('NEURX')
    await placeOrder(acct.id, { symbol: 'NEURX', side: 'buy', type: 'market', qty: 1 })
    const stop = await placeOrder(acct.id, { symbol: 'NEURX', side: 'sell', type: 'stop', qty: 1, stop_price: px * 0.5 })
    expect(stop!.status).toBe('accepted')
    const canceled = await cancelOrder(acct.id, stop!.id)
    expect(canceled!.status).toBe('canceled')
  })

  it('rejects unknown, foreign and already-final orders', async () => {
    const acct = await freshAccount()
    const other = await freshAccount()
    await expect(cancelOrder(acct.id, 'missing')).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' })
    const px = await priceOf('SYNTQ')
    const order = await placeOrder(acct.id, { symbol: 'SYNTQ', side: 'buy', type: 'limit', qty: 1, limit_price: px * 0.5, time_in_force: 'gtc' })
    await expect(cancelOrder(other.id, order!.id)).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' })
    await cancelOrder(acct.id, order!.id)
    await expect(cancelOrder(acct.id, order!.id)).rejects.toMatchObject({ code: 'ORDER_ALREADY_PROCESSED' })
    const filled = await placeOrder(other.id, { symbol: 'SYNTQ', side: 'buy', type: 'market', qty: 1 })
    await expect(cancelOrder(other.id, filled!.id)).rejects.toMatchObject({ code: 'ORDER_ALREADY_PROCESSED' })
  })

  it('cancels via the engine when the book entry is already gone', async () => {
    const acct = await freshAccount()
    const px = await priceOf('QUBIQ')
    const order = await placeOrder(acct.id, { symbol: 'QUBIQ', side: 'buy', type: 'limit', qty: 1, limit_price: px * 0.5, time_in_force: 'gtc' })
    // remove the resting entry out from under the service → engine cancel
    // finds nothing → the service still marks the order canceled
    const allResting = engine.allResting as unknown as Map<string, unknown>
    allResting.delete(order!.id)
    const book = engine.restingBySymbol.get('QUBIQ')!
    const i = book.findIndex((r) => r.orderId === order!.id)
    if (i >= 0) book.splice(i, 1)
    const done = await cancelOrder(acct.id, order!.id)
    expect(done!.status).toBe('canceled')
  })
})

describe('valuations & views', () => {
  it('values accounts: equity, buying power, reservations', async () => {
    const acct = await freshAccount()
    const v0 = await valueAccount(acct.id, engine)
    expect(v0.cash).toBe(INITIAL_CASH)
    expect(v0.equity).toBe(INITIAL_CASH)
    expect(v0.buyingPower).toBeCloseTo(INITIAL_CASH * 2, 6)
    expect(v0.longMv).toBe(0)
    expect(v0.shortMv).toBe(0)

    await placeOrder(acct.id, { symbol: 'ZRNX', side: 'buy', type: 'market', qty: 10 })
    const v1 = await valueAccount(acct.id, engine)
    expect(v1.longMv).toBeGreaterThan(0)
    expect(v1.equity).toBeCloseTo(v1.cash + v1.longMv, 0)
    expect(v1.gross).toBeCloseTo(v1.longMv, 0)
  })

  it('404s for unknown accounts', async () => {
    await expect(valueAccount('missing', engine)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(accountView('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('accountView exposes broker-style fields', async () => {
    const acct = await freshAccount()
    const view = await accountView(acct.id)
    expect(view.id).toBe(acct.id)
    expect(view.account_number).toBe(acct.accountNumber)
    expect(view.currency).toBe('USD')
    expect(view.multiplier).toBe('2')
    expect(view.trading_blocked).toBe(false)
    expect(view.equity).toBeCloseTo(INITIAL_CASH, 2)
    expect(view.initial_margin).toBe(0)
    expect(view.maintenance_margin).toBe(0)
    expect(view.handle).toBe(acct.handle)
  })

  it('positionViews computes unrealized P/L in both directions', async () => {
    const acct = await freshAccount()
    expect(await positionViews(acct.id)).toEqual([])
    await placeOrder(acct.id, { symbol: 'TERRV', side: 'buy', type: 'market', qty: 2 })
    const long = (await positionViews(acct.id))[0]
    expect(long.side).toBe('long')
    expect(Number(long.qty)).toBe(2)
    expect(long.cost_basis).toBeCloseTo(2 * Number(long.avg_entry_price), 2)
    expect(typeof long.unrealized_pl).toBe('number')
    expect(typeof long.change_today).toBe('number')

    await placeOrder(acct.id, { symbol: 'TERRV', side: 'sell', type: 'market', qty: 2 })
    await placeOrder(acct.id, { symbol: 'TERRV', side: 'sell', type: 'market', qty: 1 })
    const short = (await positionViews(acct.id))[0]
    expect(short.side).toBe('short')
    expect(Number(short.qty)).toBe(-1)
  })

  it('orderView renders strings for broker compatibility', () => {
    const base = {
      id: 'o1', clientOrderId: 'c1', symbol: 'QNTM', side: 'buy', type: 'limit', qty: 2.5,
      notional: null as number | null, filledQty: 1, filledAvgPrice: 100.5, limitPrice: 99.5,
      stopPrice: null as number | null, tif: 'day', status: 'partially_filled', rejectReason: null as string | null,
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:01Z'), filledAt: null,
    }
    const v = orderView(base)
    expect(v.qty).toBe('2.5')
    expect(v.filled_qty).toBe('1')
    expect(v.notional).toBeNull()
    expect(v.filled_at).toBeNull()
    expect(v.order_type).toBe('limit')
    expect(v.created_at).toBe('2026-01-01T00:00:00.000Z')

    const filled = orderView({ ...base, filledAt: new Date('2026-01-02T00:00:00Z'), notional: 250, stopPrice: 90 })
    expect(filled.filled_at).toBe('2026-01-02T00:00:00.000Z')
    expect(filled.notional).toBe('250')
    expect(filled.stop_price).toBe('90')
  })
})

describe('portfolio history', () => {
  it('404s for unknown accounts', async () => {
    await expect(portfolioHistory('missing', '1D')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('builds an equity curve for every period including the pre-listing price fallback', async () => {
    const acct = await freshAccount()
    await placeOrder(acct.id, { symbol: 'PLCN', side: 'buy', type: 'market', qty: 1 })
    // age the account so '1A' spans years and priceAt walks the daily bars,
    // including dates before the listing (best === null → today's open fallback)
    await db.account.update({ where: { id: acct.id }, data: { createdAt: new Date(Date.now() - 36 * 365 * 86400000) } })
    for (const period of ['1D', '1W', '1M', '1A'] as const) {
      const h = await portfolioHistory(acct.id, period)
      expect(h.timestamp.length).toBe(h.equity.length)
      expect(h.equity.length).toBeGreaterThan(40)
      expect(h.base_value).toBe(INITIAL_CASH)
      expect(h.timeframe).toBe(period)
      expect(h.profit_loss_pct.length).toBe(h.equity.length)
      for (const e of h.equity) expect(Number.isFinite(e)).toBe(true)
    }
  })

  it('falls back to the 1D span for unknown periods', async () => {
    const acct = await freshAccount()
    const h = await portfolioHistory(acct.id, '3X' as '1D')
    expect(h.timeframe).toBe('3X')
    expect(h.equity.length).toBeGreaterThan(40)
  })
})

describe('leaderboard', () => {
  it('ranks accounts by return and honors operator aliases', async () => {
    const acct = await freshAccount()
    ;(engine as unknown as { resumeSymbol: (s: string) => boolean }).resumeSymbol('HLXQ')
    await placeOrder(acct.id, { symbol: 'HLXQ', side: 'buy', type: 'market', qty: 1 })
    const label = `alias-probe-${Date.now()}-${n}`
    // the suite registers hundreds of accounts — vault this one to the top of
    // the return ranking so it survives the leaderboard's 50-row window
    await db.account.update({ where: { id: acct.id }, data: { handle: label, cash: 10_000_000 } })
    const board = await leaderboard(50)
    expect(board.ts).toBeGreaterThan(0)
    const row = board.leaderboard.find((r) => r.handle === label)
    expect(row).toBeDefined()
    expect(row!.rank).toBeGreaterThan(0)
    expect(row!.trades).toBeGreaterThanOrEqual(1)
    expect(row!.equity).toBeGreaterThan(0)
    expect(row!.return_pct).toBeCloseTo((row!.equity / INITIAL_CASH - 1) * 100, 1)

    // alias replaces the display handle only
    const prof = await db.testProfile.create({
      data: { accountId: acct.id, label: `lbl-${Date.now()}-${n}`, model: '', notes: '', startingCash: INITIAL_CASH },
    })
    await db.testProfile.update({ where: { id: prof.id }, data: { leaderboardAlias: 'stealthy_falcon_42' } })
    const board2 = await leaderboard(50)
    expect(board2.leaderboard.find((r) => r.handle === 'stealthy_falcon_42')).toBeDefined()
    expect(board2.leaderboard.find((r) => r.handle === label)).toBeUndefined()
  })

  it('respects the limit parameter and sorts descending by return', async () => {
    const board = await leaderboard(3)
    expect(board.leaderboard.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < board.leaderboard.length; i++) {
      expect(board.leaderboard[i - 1].return_pct).toBeGreaterThanOrEqual(board.leaderboard[i].return_pct)
      expect(board.leaderboard[i].rank).toBe(i + 1)
    }
  })
})

describe('margin engine', () => {
  it('wires hooks idempotently', async () => {
    const hooks1 = engine.hooks
    wireEngineHooks(engine)
    expect(engine.hooks).toBe(hooks1)
  })

  it('restores ACTIVE for margin-called accounts without positions', async () => {
    const acct = await freshAccount()
    await db.account.update({ where: { id: acct.id }, data: { status: 'MARGIN_CALL' } })
    await engine.hooks!.checkMargins()
    expect((await db.account.findUnique({ where: { id: acct.id } }))!.status).toBe('ACTIVE')
  })

  it('flags margin call below 30% maintenance and restores above 50%', async () => {
    const acct = await freshAccount()
    await placeOrder(acct.id, { symbol: 'MRDN', side: 'buy', type: 'market', qty: 50 })
    // set cash so that equity = cash + longMv ≈ 0.22 × gross
    const v = await valueAccount(acct.id, engine)
    const target = 0.22 * v.longMv
    await db.account.update({ where: { id: acct.id }, data: { cash: target - v.longMv } })
    await engine.hooks!.checkMargins()
    expect((await db.account.findUnique({ where: { id: acct.id } }))!.status).toBe('MARGIN_CALL')

    // restore equity well above 50%
    await db.account.update({ where: { id: acct.id }, data: { cash: INITIAL_CASH } })
    await engine.hooks!.checkMargins()
    expect((await db.account.findUnique({ where: { id: acct.id } }))!.status).toBe('ACTIVE')
  })

  it('liquidates accounts below 15% coverage: cancels working orders, closes positions', async () => {
    const acct = await freshAccount()
    await db.account.update({ where: { id: acct.id }, data: { cash: INITIAL_CASH + 900000, lastEquity: INITIAL_CASH + 900000 } })
    await placeOrder(acct.id, { symbol: 'VSTRA', side: 'buy', type: 'market', qty: 100 })
    const px = await priceOf('VSTRA')
    await placeOrder(acct.id, { symbol: 'VSTRA', side: 'buy', type: 'limit', qty: 1000, limit_price: px * 0.9, time_in_force: 'gtc' })
    expect(engine.restingBySymbol.get('VSTRA')!.length).toBeGreaterThan(0)

    // crater the account below 15% coverage
    const v = await valueAccount(acct.id, engine)
    await db.account.update({ where: { id: acct.id }, data: { cash: -0.9 * v.longMv } })
    await engine.hooks!.checkMargins()

    const after = await db.account.findUnique({ where: { id: acct.id } })
    expect(after!.status).toBe('MARGIN_CALL')
    expect(await positionViews(acct.id)).toHaveLength(0)
    expect(engine.restingBySymbol.get('VSTRA')!.filter((r) => r.accountId === acct.id)).toHaveLength(0)
    const working = await db.order.findMany({ where: { accountId: acct.id, status: { in: ['accepted', 'new', 'partially_filled'] } } })
    expect(working).toHaveLength(0)
    const liqFills = await db.fill.findMany({ where: { accountId: acct.id, order: { clientOrderId: { startsWith: 'LIQ-' } } } })
    expect(liqFills.length).toBeGreaterThan(0)
  })

  it('liquidates short positions by buying back', async () => {
    const acct = await freshAccount()
    await placeOrder(acct.id, { symbol: 'GNRY', side: 'sell', type: 'market', qty: 50 }) // short
    const v = await valueAccount(acct.id, engine)
    expect(v.shortMv).toBeLessThan(0)
    // blow up equity via huge negative cash
    await db.account.update({ where: { id: acct.id }, data: { cash: -0.9 * Math.abs(v.shortMv) } })
    await engine.hooks!.checkMargins()
    expect(await positionViews(acct.id)).toHaveLength(0)
    const fills = await db.fill.findMany({ where: { accountId: acct.id } })
    expect(fills.some((f) => f.side === 'buy')).toBe(true)
  })

  it('ensureEngineHooks wires hooks through the ready promise', async () => {
    const { ensureEngineHooks } = await import('@/lib/engine/accounts')
    ensureEngineHooks()
    await new Promise((r) => setTimeout(r, 50))
    expect(engine.hooks).not.toBeNull()
  })
})

describe('error class', () => {
  it('ApiError carries status and code', () => {
    const e = new ApiError(418, 'TEAPOT', 'short and stout')
    expect(e.status).toBe(418)
    expect(e.code).toBe('TEAPOT')
    expect(e.message).toBe('short and stout')
    expect(e).toBeInstanceOf(Error)
  })
})

describe('liquidation & valuation edges', () => {
  it('liquidation marks liquidation orders rejected when the market is paused', async () => {
    const acct = await freshAccount()
    await db.account.update({ where: { id: acct.id }, data: { cash: INITIAL_CASH + 500000, lastEquity: INITIAL_CASH + 500000 } })
    await placeOrder(acct.id, { symbol: 'BASTN', side: 'buy', type: 'market', qty: 50 })
    const v = await valueAccount(acct.id, engine)
    await db.account.update({ where: { id: acct.id }, data: { cash: -0.9 * v.longMv } })
    engine.paused = true
    try {
      await engine.hooks!.checkMargins()
      const rejected = await db.order.findFirst({ where: { accountId: acct.id, status: 'rejected' } })
      expect(rejected).not.toBeNull()
    } finally {
      engine.paused = false
    }
  })

  it('portfolio history prices fills from daily bars, pre-listing dates and unknown symbols', async () => {
    const acct = await freshAccount()
    // age the account so '1A' spans decades
    await db.account.update({ where: { id: acct.id }, data: { createdAt: new Date(Date.now() - 36 * 365 * 86400000) } })
    await placeOrder(acct.id, { symbol: 'PLCN', side: 'buy', type: 'market', qty: 2 })
    const order = await db.order.findFirst({ where: { accountId: acct.id } })
    // backdate the real fill before PLCN's listing: priceAt walks its bars,
    // finds none, and falls back to today's open
    await db.fill.updateMany({
      where: { accountId: acct.id },
      data: { createdAt: new Date(Date.now() - 35 * 365 * 86400000) },
    })
    // a fill in a symbol outside the universe prices at 0
    await db.fill.create({
      data: { orderId: order!.id, accountId: acct.id, symbol: 'BOGUS', side: 'buy', qty: 1, price: 10, fee: 0, createdAt: new Date(Date.now() - 30 * 365 * 86400000) },
    })
    const h = await portfolioHistory(acct.id, '1A')
    expect(h.equity.length).toBeGreaterThan(100)
    for (const e of h.equity) expect(Number.isFinite(e)).toBe(true)
    // early curve: BOGUS prices at 0, PLCN at the pre-listing fallback (today's open)
    expect(h.equity[0]).toBeGreaterThan(0)
    // later curve: PLCN held from the 1991 fill is priced from its daily bars
    const last = h.equity[h.equity.length - 1]
    expect(last).not.toBe(h.equity[0])
  })
})

describe('identity & valuation edges', () => {
  it('falls back to the generic trader handle for unusable email local parts', async () => {
    const acct = await registerAccount({ email: '+@mrx.dev', password: 'password123' })
    expect(acct.handle).toBe('trader')
  })

  it('values short positions with negative market value', async () => {
    const acct = await freshAccount()
    await placeOrder(acct.id, { symbol: 'CRDSP', side: 'sell', type: 'market', qty: 3 })
    const v = await valueAccount(acct.id, engine)
    expect(v.shortMv).toBeLessThan(0)
    expect(v.gross).toBeCloseTo(Math.abs(v.shortMv), 0)
    expect(v.equity).toBeCloseTo(v.cash + v.shortMv, 0)
  })

  it('positions in unknown symbols fall back to cost and price at zero', async () => {
    const acct = await freshAccount()
    await placeOrder(acct.id, { symbol: 'VELR', side: 'buy', type: 'market', qty: 1 })
    const order = await db.order.findFirst({ where: { accountId: acct.id } })
    await db.position.create({ data: { accountId: acct.id, symbol: 'GHOSTX', qty: 5, avgPrice: 12.5 } })
    await db.fill.create({ data: { orderId: order!.id, accountId: acct.id, symbol: 'GHOSTX', side: 'buy', qty: 5, price: 12.5, fee: 0 } })
    const views = await positionViews(acct.id)
    const ghost = views.find((p) => p.symbol === 'GHOSTX')!
    expect(Number(ghost.market_price)).toBe(12.5) // avgPrice fallback
    expect(Number(ghost.change_today)).toBe(0)

    // leaderboard also prices unknown symbols at cost
    const board = await leaderboard(500)
    const row = board.leaderboard.find((r) => r.handle === acct.handle)
    expect(row).toBeDefined()
  })

  it('zero-cost positions report zero unrealized percentage', async () => {
    const acct = await freshAccount()
    await db.position.create({ data: { accountId: acct.id, symbol: 'DOLCI', qty: 10, avgPrice: 0 } })
    const views = await positionViews(acct.id)
    const free = views.find((p) => p.symbol === 'DOLCI')!
    expect(free.unrealized_plpc).toBe(0)
  })

  it('portfolio history falls back to the live price when today opened at zero', async () => {
    const acct = await freshAccount()
    await placeOrder(acct.id, { symbol: 'STRMQ', side: 'buy', type: 'market', qty: 1 })
    const s = engine.states.get('STRMQ')!
    const savedToday = { ...s.today }
    s.today = { ...s.today, o: 0 } // pathological pre-open state
    await db.fill.updateMany({ where: { accountId: acct.id }, data: { createdAt: new Date(Date.now() - 35 * 365 * 86400000) } })
    await db.account.update({ where: { id: acct.id }, data: { createdAt: new Date(Date.now() - 36 * 365 * 86400000) } })
    try {
      const h = await portfolioHistory(acct.id, '1A')
      for (const e of h.equity) expect(Number.isFinite(e)).toBe(true)
    } finally {
      s.today = savedToday
    }
  })

  it('liquidation skips positions in unknown symbols', async () => {
    const acct = await freshAccount()
    await db.account.update({ where: { id: acct.id }, data: { cash: INITIAL_CASH + 500000, lastEquity: INITIAL_CASH + 500000 } })
    await placeOrder(acct.id, { symbol: 'ATKR', side: 'buy', type: 'market', qty: 5 })
    await db.position.create({ data: { accountId: acct.id, symbol: 'GHOSTX', qty: 5, avgPrice: 10 } })
    const v = await valueAccount(acct.id, engine)
    await db.account.update({ where: { id: acct.id }, data: { cash: -0.9 * v.longMv } })
    await engine.hooks!.checkMargins()
    const remaining = await positionViews(acct.id)
    expect(remaining.map((p) => p.symbol)).toEqual(['GHOSTX']) // ATKR liquidated; unpriceable GHOSTX survives
  })

  it('sell availability skips foreign and other-symbol reservations', async () => {
    const acct = await freshAccount()
    const other = await freshAccount()
    const qpx = await engine.quote('QNTM')!.p
    // account `other` reserves BP on QNTM; account `acct` rests its own QNTM
    // order too — the HELX sell must ignore BOTH reservations
    await placeOrder(other.id, { symbol: 'QNTM', side: 'buy', type: 'limit', qty: 1, limit_price: qpx * 0.5, time_in_force: 'gtc' })
    await placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'limit', qty: 1, limit_price: qpx * 0.5, time_in_force: 'gtc' })
    await placeOrder(acct.id, { symbol: 'HELX', side: 'sell', type: 'market', qty: 2 })
    expect((await positionViews(acct.id)).some((p) => p.symbol === 'HELX' && p.side === 'short')).toBe(true)
    for (const a of [acct, other]) {
      const row = await db.order.findFirst({ where: { accountId: a.id, symbol: 'QNTM', status: 'accepted' } })
      if (row) await cancelOrder(a.id, row.id)
    }
  })

  it('IOC orders that fill nothing are canceled outright', async () => {
    const acct = await freshAccount()
    const px = await engine.quote('KRYO')!.p
    const order = await placeOrder(acct.id, { symbol: 'KRYO', side: 'buy', type: 'limit', qty: 5, limit_price: px * 0.5, time_in_force: 'ioc' })
    expect(order!.status).toBe('canceled')
    expect(order!.filledQty).toBe(0)
    expect(order!.rejectReason).toContain('no liquidity')
  })
})

describe('final account edges', () => {
  it('placeOrder without a symbol asks for one', async () => {
    const acct = await freshAccount()
    await expect(placeOrder(acct.id, { symbol: undefined as unknown as string, side: 'buy', type: 'market', qty: 1 }))
      .rejects.toMatchObject({ code: 'SYMBOL_REQUIRED' })
  })

  it('portfolio history accounts for sell fills in the replay', async () => {
    const acct = await freshAccount()
    await placeOrder(acct.id, { symbol: 'HLXQ', side: 'buy', type: 'market', qty: 2 })
    await placeOrder(acct.id, { symbol: 'HLXQ', side: 'sell', type: 'market', qty: 1 })
    const h = await portfolioHistory(acct.id, '1D')
    expect(h.equity.length).toBeGreaterThan(40)
    for (const e of h.equity) expect(Number.isFinite(e)).toBe(true)
  })
})

describe('reservation accounting', () => {
  it('counts same-symbol reservations when sizing a new sell', async () => {
    const acct = await freshAccount()
    await placeOrder(acct.id, { symbol: 'MENDL', side: 'buy', type: 'market', qty: 10 })
    // rest a sell for half the position: 5 shares reserved
    const resting = await placeOrder(acct.id, { symbol: 'MENDL', side: 'sell', type: 'limit', qty: 5, limit_price: engine.quote('MENDL')!.p * 1.2, time_in_force: 'gtc' })
    expect(resting!.status).toBe('accepted')
    // selling 8 more: the reservation only shapes buying-power math — the
    // fill applies against the full 10-share long, leaving 2
    const order = await placeOrder(acct.id, { symbol: 'MENDL', side: 'sell', type: 'market', qty: 8 })
    expect(order!.status).toBe('filled')
    const pos = (await positionViews(acct.id)).find((p) => p.symbol === 'MENDL')!
    expect(Number(pos.qty)).toBe(2)
    await cancelOrder(acct.id, resting!.id)
  })
})
