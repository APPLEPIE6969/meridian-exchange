// Meridian Exchange — core matching & simulation engine.
// Runs inside the Next.js process as a global singleton.

import fs from 'fs'
import path from 'path'
import { INSTRUMENTS, BY_SYMBOL, Instrument, Sector, SECTOR_TARGET_LEVELS, COMPOSITE_TARGET_LEVEL } from './universe'
import { Rng, gaussLive, roundTo, clamp, hashSeed } from './rng'
import { DailyBar, buildDailyHistory, synthIntraday, Candle, shiftDate } from './history'
import { GeneratedNews, generateRandomEvent, makeEarningsNews, makeHaltNews } from './news'
import { etNow, sessionOf, sessionVolMult, sessionVolNumMult, SESSION_LABEL, Session, roundPx, tickSize, dateShiftUtcMidnight, etDateToUtcMs } from './time'

export interface Quote {
  s: string
  p: number
  b: number
  a: number
  bs: number
  as: number
  o: number
  h: number
  l: number
  pc: number
  v: number
  chg: number
  chgp: number
  halted: boolean
  t: number
}

export interface Level {
  price: number
  size: number
}

export interface TapeTrade {
  t: number
  p: number
  s: number
  x: 'B' | 'S' | 'T' // aggressor side
}

export interface RestingOrder {
  orderId: string
  accountId: string
  symbol: string
  side: 'buy' | 'sell'
  type: 'limit' | 'stop' | 'stop_limit'
  qty: number
  remaining: number
  limitPrice: number | null
  stopPrice: number | null
  tif: 'day' | 'gtc' | 'ioc' | 'fok'
  createdAt: number
  seq: number
}

export interface FillPart {
  qty: number
  price: number
  fee: number
}

export interface PlacedOrderInput {
  id: string
  accountId: string
  symbol: string
  side: 'buy' | 'sell'
  type: 'market' | 'limit' | 'stop' | 'stop_limit'
  qty: number
  limitPrice: number | null
  stopPrice: number | null
  tif: 'day' | 'gtc' | 'ioc' | 'fok'
}

interface Impulse {
  totalBps: number
  perTick: number
  remaining: number
  overshoot: number
}

interface SymbolState {
  inst: Instrument
  price: number
  prevClose: number
  dayOpen: number
  dayHigh: number
  dayLow: number
  volume: number
  volVar: number // per-tick variance state (GARCH-ish)
  drift: number // annualized anchor drift
  anchor: number
  impulse: Impulse | null
  counterImpulse: number
  haltedUntil: number
  haltReason: string
  priceRing: number[]
  ringIdx: number
  bid: number
  ask: number
  bidSize: number
  askSize: number
  bids: Level[]
  asks: Level[]
  tape: TapeTrade[]
  dailyBars: DailyBar[]
  live: { '1m': Candle[]; '5m': Candle[]; '15m': Candle[]; '1h': Candle[] }
  today: { date: string; o: number; h: number; l: number; c: number; v: number }
  estEps: number
  nextEarnings: number
  lastTick: number
}

interface IndexState {
  level: number
  prevClose: number
}

const TICK_MS = 1000
const TICKS_PER_YEAR = 31_536_000
const MAX_TAPE = 220

const secRng = new Rng('mrx-session-seed')
// Macro (market-wide) news drift: applied each tick then decayed, so the total
// move converges to the headline's bps while every intermediate price prints.
const MACRO_DECAY = 0.8

export interface EngineHooks {
  onFill: (orderId: string, accountId: string, fill: FillPart, orderDone: boolean) => Promise<void>
  onOrderStatus: (orderId: string, accountId: string, status: string, reason?: string) => Promise<void>
  checkMargins: () => Promise<void>
}

export class MarketEngine {
  states = new Map<string, SymbolState>()
  restingBySymbol = new Map<string, RestingOrder[]>()
  stopMonitors = new Map<string, RestingOrder[]>() // keyed by symbol
  allResting = new Map<string, RestingOrder>() // orderId -> order
  orderSeq = 0
  composite: IndexState = { level: COMPOSITE_TARGET_LEVEL, prevClose: COMPOSITE_TARGET_LEVEL }
  sectorIndices = new Map<Sector, IndexState>()
  compositeDivisor = 1
  sectorDivisors = new Map<Sector, number>()
  mvix = 21.4
  mvixVarTick = 0
  newsFeed: { id: string; headline: string; body: string; source: string; kind: string; symbols: string; sentiment: number; impactBps: number; createdAt: string }[] = []
  hooks: EngineHooks | null = null
  paused = false
  ready!: Promise<unknown>
  private timer: NodeJS.Timeout | null = null
  private lastEtDate = ''
  private lastSnapshot = 0
  private lastMarginCheck = 0
  private relayUp = true
  private lastRelayTry = 0
  private marketImpulse = 0 // bps applied to all symbols this tick (macro news)
  private bootStats = { started: new Date().toISOString(), ticks: 0 }

  // ────────────────────────────────────────────── boot

  async init(): Promise<void> {
    const snap = this.loadSnapshot()
    const et = etNow()
    this.lastEtDate = et.date
    const yesterday = dateShiftUtcMidnight(et.date, -1)
    for (const inst of INSTRUMENTS) {
      const saved = snap?.symbols?.[inst.symbol]
      const anchor = saved?.prevClose && saved.price ? saved.price : inst.basePrice
      const prevClose = saved?.prevClose ?? inst.basePrice * (1 + (hashSeed(inst.symbol) % 100 - 50) / 5000)
      const savedDaily = snap?.daily?.[inst.symbol] ?? []
      // History runs from each issuer's listing date to today. Older bars are
      // regenerated deterministically (same seed every boot); the snapshot's
      // recent real tail splices onto the regenerated head, so realized days
      // are never rewritten and the tape never truncates across restarts.
      const head = savedDaily.length
        ? buildDailyHistory(inst, savedDaily[0].c, shiftDate(savedDaily[0].date, -1))
        : buildDailyHistory(inst, prevClose, yesterday)
      const daily = savedDaily.length ? head.concat(savedDaily) : head
      const st: SymbolState = {
        inst,
        price: saved?.price ?? anchor,
        prevClose,
        dayOpen: saved?.dayOpen ?? (saved?.price ?? anchor),
        dayHigh: saved?.dayHigh ?? (saved?.price ?? anchor),
        dayLow: saved?.dayLow ?? (saved?.price ?? anchor),
        volume: saved?.volume ?? 0,
        volVar: Math.pow(inst.volAnn / 100 / Math.sqrt(TICKS_PER_YEAR), 2),
        drift: saved?.drift ?? 0,
        anchor: saved?.anchor ?? anchor,
        impulse: null,
        counterImpulse: 0,
        haltedUntil: 0,
        haltReason: '',
        priceRing: new Array(600).fill(saved?.price ?? anchor),
        ringIdx: 0,
        bid: 0,
        ask: 0,
        bidSize: 100,
        askSize: 100,
        bids: [],
        asks: [],
        tape: [],
        dailyBars: daily,
        live: { '1m': [], '5m': [], '15m': [], '1h': [] },
        today: { date: et.date, o: saved?.dayOpen ?? anchor, h: saved?.dayHigh ?? anchor, l: saved?.dayLow ?? anchor, c: saved?.price ?? anchor, v: saved?.volume ?? 0 },
        estEps: saved?.estEps ?? inst.estEps,
        nextEarnings: saved?.nextEarnings ?? this.pickEarningsDate(inst),
        lastTick: Date.now(),
      }
      this.refreshQuotes(st, 1)
      this.states.set(inst.symbol, st)
      this.restingBySymbol.set(inst.symbol, [])
      this.stopMonitors.set(inst.symbol, [])
    }
    // indices
    if (snap) {
      this.composite = snap.composite
      this.sectorIndices = new Map(Object.entries(snap.sector ?? {}) as [Sector, IndexState][])
      this.mvix = snap.mvix?.level ?? 21.4
      this.mvixVarTick = snap.mvix?.varTick ?? 0
      // daily bars are already spliced (regenerated listing-era head + recent
      // snapshot tail) inside the state constructor above — do NOT overwrite
      // them here, or the deep history is lost on every snapshot boot.
    }
    const capSum = this.computeCapSum()
    this.compositeDivisor = capSum / (snap?.composite?.level ?? COMPOSITE_TARGET_LEVEL)
    this.composite = { level: capSum / this.compositeDivisor, prevClose: snap?.composite?.prevClose ?? capSum / this.compositeDivisor }
    for (const sector of Object.keys(SECTOR_TARGET_LEVELS) as Sector[]) {
      const sCap = this.computeCapSum(sector)
      const saved = snap?.sector?.[sector]
      const level = saved?.level ?? sCap / (sCap / (SECTOR_TARGET_LEVELS[sector] ?? 1000))
      this.sectorDivisors.set(sector, sCap / level)
      this.sectorIndices.set(sector, { level, prevClose: saved?.prevClose ?? level })
    }
    if (!snap) this.mvix = 21.4
    await this.seedGenesisWire()
    await this.loadNewsFromDB()
    await this.restoreOpenOrders()
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  private pickEarningsDate(inst: Instrument): number {
    const days = 3 + Math.floor((hashSeed('earn:' + inst.symbol) % 60))
    return Date.now() + days * 86400000 + (hashSeed('eh:' + inst.symbol) % 9) * 3600000
  }

  // ────────────────────────────────────────────── snapshot persistence

  private snapPath(): string {
    return path.join(process.cwd(), 'db', 'market-state.json')
  }

  private loadSnapshot(): any {
    try {
      const raw = fs.readFileSync(this.snapPath(), 'utf8')
      const data = JSON.parse(raw)
      const age = Date.now() - new Date(data.savedAt).getTime()
      if (age > 5 * 86400000) return null
      return data
    } catch {
      return null
    }
  }

  private saveSnapshot(): void {
    try {
      const symbols: Record<string, unknown> = {}
      const daily: Record<string, DailyBar[]> = {}
      for (const [sym, st] of this.states) {
        symbols[sym] = {
          price: st.price, prevClose: st.prevClose, dayOpen: st.dayOpen, dayHigh: st.dayHigh,
          dayLow: st.dayLow, volume: Math.round(st.volume), volVar: st.volVar, drift: st.drift,
          anchor: st.anchor, estEps: st.estEps, nextEarnings: st.nextEarnings,
        }
        daily[sym] = st.dailyBars.slice(-380) // recent real tail; older bars regenerate deterministically from each listing
      }
      const data = {
        savedAt: new Date().toISOString(),
        symbols,
        daily,
        composite: this.composite,
        sector: Object.fromEntries(this.sectorIndices),
        mvix: { level: this.mvix, varTick: this.mvixVarTick },
      }
      fs.writeFileSync(this.snapPath(), JSON.stringify(data))
    } catch {
      // best effort
    }
  }

  // ────────────────────────────────────────────── quotes / book

  private refreshQuotes(st: SymbolState, volMult: number): void {
    const inst = st.inst
    const liq = clamp(Math.sqrt(inst.avgVol / 3e6), 0.6, 4.5)
    const spreadBps = (1.1 + 5.5 / liq) * (0.55 + 0.45 * clamp(st.volVar > 0 ? Math.sqrt(st.volVar) / (inst.volAnn / 100 / Math.sqrt(TICKS_PER_YEAR)) : 1, 0.5, 3)) * (inst.kind === 'etf' ? 0.45 : 1)
    const half = Math.max(tickSize(st.price), (st.price * spreadBps) / 2 / 10000 * 1.0)
    st.bid = roundPx(st.price - half)
    st.ask = roundPx(st.price + half)
    if (st.ask <= st.bid) st.ask = st.bid + tickSize(st.price)
    const baseSize = Math.max(100, (inst.avgVol / 86400) * 26 * (1 / liq))
    st.bidSize = Math.max(100, Math.round((baseSize * (0.55 + Math.random() * 1.3)) / 100) * 100)
    st.askSize = Math.max(100, Math.round((baseSize * (0.55 + Math.random() * 1.3)) / 100) * 100)
    void volMult
    const mkLadder = (start: number, dir: -1 | 1): Level[] => {
      const out: Level[] = []
      let p = start
      for (let i = 0; i < 6; i++) {
        const size = Math.max(100, Math.round((baseSize * (0.35 + Math.random() * 2.2) * (1 + i * 0.55)) / 100) * 100)
        out.push({ price: roundPx(p), size })
        p += dir * tickSize(st.price) * (1 + Math.floor(Math.random() * 2) + Math.floor(i / 2))
      }
      return out
    }
    st.bids = mkLadder(st.bid, -1)
    st.asks = mkLadder(st.ask, 1)
  }

  quote(symbol: string): Quote | null {
    const st = this.states.get(symbol)
    if (!st) return null
    const now = Date.now()
    const chg = st.price - st.prevClose
    return {
      s: symbol,
      p: roundPx(st.price),
      b: st.bid,
      a: st.ask,
      bs: st.bidSize,
      as: st.askSize,
      o: roundPx(st.dayOpen),
      h: roundPx(st.dayHigh),
      l: roundPx(st.dayLow),
      pc: roundPx(st.prevClose),
      v: Math.round(st.volume),
      chg: roundTo(chg, 2),
      chgp: roundTo((chg / st.prevClose) * 100, 2),
      halted: st.haltedUntil > now,
      t: now,
    }
  }

  allQuotes(): Quote[] {
    const out: Quote[] = []
    for (const sym of this.states.keys()) {
      const q = this.quote(sym)
      if (q) out.push(q)
    }
    return out
  }

  getBook(symbol: string): { symbol: string; bids: Level[]; asks: Level[]; ts: number; halted: boolean } | null {
    const st = this.states.get(symbol)
    if (!st) return null
    const bids = st.bids.map((l) => ({ ...l }))
    const asks = st.asks.map((l) => ({ ...l }))
    // merge resting account orders into displayed depth
    for (const ro of this.restingBySymbol.get(symbol) ?? []) {
      if (ro.type !== 'limit' || ro.limitPrice === null) continue
      const arr = ro.side === 'buy' ? bids : asks
      const lvl = arr.find((l) => Math.abs(l.price - ro.limitPrice!) < tickSize(st.price) / 2)
      if (lvl) lvl.size = Math.round(lvl.size + ro.remaining)
      else {
        arr.push({ price: ro.limitPrice, size: Math.round(ro.remaining) })
        arr.sort((a, b) => (ro.side === 'buy' ? b.price - a.price : a.price - b.price))
      }
    }
    return { symbol, bids: bids.slice(0, 10), asks: asks.slice(0, 10), ts: Date.now(), halted: st.haltedUntil > Date.now() }
  }

  getTape(symbol: string, limit = 60): TapeTrade[] {
    const st = this.states.get(symbol)
    if (!st) return []
    return st.tape.slice(-limit).reverse()
  }

  // ────────────────────────────────────────────── candles

  getCandles(symbol: string, interval: '1m' | '5m' | '15m' | '1h' | '1d', startMs: number, endMs: number, limit = 900): Candle[] {
    const st = this.states.get(symbol)
    if (!st) return []
    const out: Candle[] = []
    if (interval === '1d') {
      for (const b of st.dailyBars) {
        const t = etDateToUtcMs(b.date)
        if (t >= startMs && t <= endMs) out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })
      }
      const tb = st.today
      const tToday = etDateToUtcMs(tb.date)
      if (tToday >= startMs && tToday <= endMs && tb.v + tb.c > 0) {
        out.push({ t: tToday, o: tb.o, h: tb.h, l: tb.l, c: st.price, v: Math.round(tb.v) })
      }
      return out.slice(-limit)
    }
    const minutes = interval === '1m' ? 1 : interval === '5m' ? 5 : interval === '15m' ? 15 : 60
    // synthetic history for completed days within range, merged with the live
    // buffer into a single map keyed by bucket time. The live buffer covers the
    // trailing ~14 days, which overlaps synthIntraday output — live wins per
    // bucket so no timestamp is ever emitted twice.
    const et = etNow()
    const byT = new Map<number, Candle>()
    for (const b of st.dailyBars) {
      const t = etDateToUtcMs(b.date)
      if (t < startMs - 86400000 || t > endMs) continue
      if (b.date === et.date) continue
      const bars = synthIntraday(symbol, b, minutes)
      for (const c of bars) if (c.t >= startMs && c.t <= endMs && !byT.has(c.t)) byT.set(c.t, c)
    }
    for (const c of st.live[interval]) {
      if (c.t >= startMs && c.t <= endMs) byT.set(c.t, c)
    }
    const merged = [...byT.values()].sort((a, b) => a.t - b.t)
    return merged.slice(-limit)
  }

  // ────────────────────────────────────────────── indices / movers

  private computeCapSum(sector?: Sector): number {
    let sum = 0
    for (const st of this.states.values()) {
      if (st.inst.kind !== 'stock') continue
      if (sector && st.inst.sector !== sector) continue
      sum += st.inst.shares * st.price
    }
    return sum
  }

  indices() {
    const sectors: Record<string, { level: number; chg: number; chgp: number }> = {}
    for (const [sec, ix] of this.sectorIndices) {
      sectors[sec] = {
        level: roundTo(ix.level, 2),
        chg: roundTo(ix.level - ix.prevClose, 2),
        chgp: roundTo(((ix.level - ix.prevClose) / ix.prevClose) * 100, 2),
      }
    }
    return {
      composite: {
        symbol: 'MRC',
        name: 'MRX Composite Index',
        level: roundTo(this.composite.level, 2),
        chg: roundTo(this.composite.level - this.composite.prevClose, 2),
        chgp: roundTo(((this.composite.level - this.composite.prevClose) / this.composite.prevClose) * 100, 2),
      },
      mvix: roundTo(this.mvix, 2),
      sectors,
      ts: Date.now(),
    }
  }

  movers() {
    const qs = this.allQuotes().filter((q) => !q.s.endsWith('ETF') )
    const st = this.states
    const arr = qs.map((q) => ({ ...q, cap: (st.get(q.s)?.inst.shares ?? 0) * q.p }))
    const byGain = [...arr].sort((a, b) => b.chgp - a.chgp)
    const byLoss = [...arr].sort((a, b) => a.chgp - b.chgp)
    const byVol = [...arr].sort((a, b) => b.v * b.p - a.v * a.p)
    return {
      gainers: byGain.slice(0, 5),
      losers: byLoss.slice(0, 5),
      active: byVol.slice(0, 5),
      ts: Date.now(),
    }
  }

  marketStatus() {
    const et = etNow()
    const session = sessionOf(et.minutes)
    return {
      exchange: 'MRX',
      name: 'Meridian Exchange',
      tz: 'America/New_York',
      date: et.date,
      time: `${String(et.hour).padStart(2, '0')}:${String(et.minute).padStart(2, '0')}:${String(et.second).padStart(2, '0')}`,
      weekday: et.weekday,
      session,
      session_label: SESSION_LABEL[session],
      open: !this.paused,
      trading_hours: '24/7 — the MRX market never closes',
      paused: this.paused,
      ts: Date.now(),
    }
  }

  calendar(days = 30) {
    const now = Date.now()
    const items: { symbol: string; name: string; date: string; time: string; estEps: number }[] = []
    for (const st of this.states.values()) {
      if (st.nextEarnings < now + days * 86400000) {
        const d = new Date(st.nextEarnings)
        items.push({
          symbol: st.inst.symbol,
          name: st.inst.name,
          date: d.toISOString().slice(0, 10),
          time: '16:15',
          estEps: roundTo(st.estEps, 2),
        })
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date))
    return { events: items, ts: now }
  }

  // ────────────────────────────────────────────── order handling

  /** validate + route a newly accepted order; returns immediate fills if any */
  async submitOrder(
    o: PlacedOrderInput,
    opts: { skipLiquidityCheck?: boolean } = {},
  ): Promise<{ fills: FillPart[]; status: string; reject?: string; resting: boolean }> {
    const st = this.states.get(o.symbol)
    if (!st) return { fills: [], status: 'rejected', reject: `Unknown symbol ${o.symbol}`, resting: false }
    const now = Date.now()
    if (this.paused) return { fills: [], status: 'rejected', reject: 'MRX: Market is temporarily paused. New orders are not being accepted.', resting: false }
    if (st.haltedUntil > now) return { fills: [], status: 'rejected', reject: `MRX: ${o.symbol} is in a volatility trading pause. Orders are not being accepted.`, resting: false }
    if (o.qty <= 0) return { fills: [], status: 'rejected', reject: 'Quantity must be positive.', resting: false }

    const fills: FillPart[] = []
    if (o.type === 'market') {
      // walk the book
      const isBuy = o.side === 'buy'
      let remaining = o.qty
      let notional = 0
      let filled = 0
      while (remaining > 1e-9) {
        const levels = isBuy ? st.asks : st.bids
        if (levels.length === 0) break
        const lvl = levels[0]
        if (lvl.size <= 1e-9) {
          if (isBuy) st.asks.shift()
          else st.bids.shift()
          continue
        }
        const take = Math.min(remaining, lvl.size)
        lvl.size -= take
        remaining -= take
        filled += take
        notional += take * lvl.price
        if (lvl.size <= 1e-9) {
          if (isBuy) st.asks.shift()
          else st.bids.shift()
        }
      }
      if (filled <= 1e-9) {
        return { fills: [], status: 'rejected', reject: 'MRX: insufficient liquidity at market.', resting: false }
      }
      const avg = notional / filled
      const impact = Math.sqrt(o.qty / Math.max(st.inst.avgVol, 1)) * 0.004
      const fee = isBuy ? 0 : notional * 0.0000278 + Math.min(8.3, filled * 0.000166)
      fills.push({ qty: filled, price: roundPx(avg), fee: roundTo(fee, 4) })
      if (remaining > 1e-9) {
        // too large for book: fill the rest with slippage penalty
        const slip = avg * (1 + (isBuy ? 1 : -1) * impact * 2.2)
        const fee2 = isBuy ? 0 : remaining * slip * 0.0000278
        fills.push({ qty: remaining, price: roundPx(slip), fee: roundTo(fee2, 4) })
        filled += remaining
      }
      st.price = fills[fills.length - 1].price
      st.anchor *= 1 + (isBuy ? 1 : -1) * impact * 0.35
      this.recordTapePrint(st, st.price, o.qty, isBuy ? 'B' : 'S')
      if (!opts.skipLiquidityCheck) this.refreshQuotes(st, 1)
      return { fills, status: 'filled', resting: false }
    }

    if (o.type === 'limit') {
      const lp = o.limitPrice ?? 0
      if (lp <= 0) return { fills: [], status: 'rejected', reject: 'Limit price required.', resting: false }
      const isBuy = o.side === 'buy'
      // marketable?
      if ((isBuy && st.ask <= lp) || (!isBuy && st.bid >= lp)) {
        let remaining = o.qty
        let notional = 0
        let filled = 0
        while (remaining > 1e-9) {
          const levels = isBuy ? st.asks : st.bids
          if (levels.length === 0) break
          const lvl = levels[0]
          if (isBuy ? lvl.price > lp : lvl.price < lp) break
          const take = Math.min(remaining, lvl.size)
          lvl.size -= take
          remaining -= take
          filled += take
          notional += take * lvl.price
          if (lvl.size <= 1e-9) {
            if (isBuy) st.asks.shift()
            else st.bids.shift()
          }
        }
        if (filled > 1e-9) {
          const avg = notional / filled
          const fee = isBuy ? 0 : notional * 0.0000278 + Math.min(8.3, filled * 0.000166)
          fills.push({ qty: filled, price: roundPx(avg), fee: roundTo(fee, 4) })
          st.price = roundPx(avg)
          if (remaining > 1e-9) {
            this.restLimitOrder(o, remaining, now)
            return { fills, status: 'partially_filled', resting: true }
          }
          return { fills, status: 'filled', resting: false }
        }
      }
      this.restLimitOrder(o, o.qty, now)
      return { fills: [], status: 'accepted', resting: true }
    }

    // stop / stop_limit
    const sp = o.stopPrice ?? 0
    if (sp <= 0) return { fills: [], status: 'rejected', reject: 'Stop price required.', resting: false }
    const st0 = this.states.get(o.symbol)
    if (st0) {
      // Market-direction validation (broker convention): a sell stop must sit
      // below the market, a buy stop above it — otherwise it would trigger
      // immediately. Marketable limit orders are allowed (they execute).
      if (o.side === 'sell' && sp >= st0.bid) {
        return { fills: [], status: 'rejected', resting: false, reject: `Stop price ${sp.toFixed(2)} must be below the current market price to place a sell stop.` }
      }
      if (o.side === 'buy' && sp <= st0.ask) {
        return { fills: [], status: 'rejected', resting: false, reject: `Stop price ${sp.toFixed(2)} must be above the current market price to place a buy stop.` }
      }
      if (o.type === 'stop_limit' && o.limitPrice !== null) {
        if (o.side === 'buy' && o.limitPrice < sp) {
          return { fills: [], status: 'rejected', resting: false, reject: 'For buy stop limit orders, limit price must be at or above the stop price.' }
        }
        if (o.side === 'sell' && o.limitPrice > sp) {
          return { fills: [], status: 'rejected', resting: false, reject: 'For sell stop limit orders, limit price must be at or below the stop price.' }
        }
      }
    }
    const ro: RestingOrder = {
      orderId: o.id, accountId: o.accountId, symbol: o.symbol, side: o.side,
      type: o.type === 'stop' ? 'stop' : 'stop_limit',
      qty: o.qty, remaining: o.qty, limitPrice: o.limitPrice, stopPrice: o.stopPrice, tif: o.tif, createdAt: now, seq: ++this.orderSeq,
    }
    this.allResting.set(o.id, ro)
    this.stopMonitors.get(o.symbol)!.push(ro)
    return { fills: [], status: 'accepted', resting: true }
  }

  private restLimitOrder(o: PlacedOrderInput, remaining: number, now: number): void {
    const ro: RestingOrder = {
      orderId: o.id, accountId: o.accountId, symbol: o.symbol, side: o.side, type: 'limit',
      qty: o.qty, remaining, limitPrice: o.limitPrice, stopPrice: o.stopPrice, tif: o.tif, createdAt: now, seq: ++this.orderSeq,
    }
    this.allResting.set(o.id, ro)
    this.restingBySymbol.get(o.symbol)!.push(ro)
    this.sortBook(o.symbol)
  }

  private sortBook(symbol: string): void {
    const arr = this.restingBySymbol.get(symbol)
    if (!arr) return
    arr.sort((a, b) => {
      const pa = a.limitPrice ?? 0
      const pb = b.limitPrice ?? 0
      if (a.side !== b.side) return a.side === 'buy' ? -1 : 1
      if (a.side === 'buy') return pb - pa || a.seq - b.seq
      return pa - pb || a.seq - b.seq
    })
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const ro = this.allResting.get(orderId)
    if (!ro) return false
    this.allResting.delete(orderId)
    const arr = ro.type === 'limit' ? this.restingBySymbol.get(ro.symbol) : this.stopMonitors.get(ro.symbol)
    if (arr) {
      const i = arr.findIndex((x) => x.orderId === orderId)
      if (i >= 0) arr.splice(i, 1)
    }
    if (this.hooks) await this.hooks.onOrderStatus(orderId, ro.accountId, 'canceled')
    return true
  }

  hasResting(orderId: string): boolean {
    return this.allResting.has(orderId)
  }

  private async executeRestingFill(ro: RestingOrder, qty: number, price: number): Promise<void> {
    const notional = qty * price
    const fee = ro.side === 'sell' ? notional * 0.0000278 + Math.min(8.3, qty * 0.000166) : 0
    ro.remaining -= qty
    const done = ro.remaining <= 1e-6
    if (done) {
      this.allResting.delete(ro.orderId)
      const arr = ro.type === 'limit' ? this.restingBySymbol.get(ro.symbol) : this.stopMonitors.get(ro.symbol)
      if (arr) {
        const i = arr.findIndex((x) => x.orderId === ro.orderId)
        if (i >= 0) arr.splice(i, 1)
      }
    }
    const st = this.states.get(ro.symbol)
    if (st) this.recordTapePrint(st, price, qty, ro.side === 'buy' ? 'B' : 'S')
    if (this.hooks) {
      await this.hooks.onFill(ro.orderId, ro.accountId, { qty, price: roundPx(price), fee: roundTo(fee, 4) }, done)
    }
  }

  // ────────────────────────────────────────────── news

  // A fresh exchange opens with hours of headlines already on the wire, like
  // any real morning. On first boot (empty news table) backfill a realistic
  // spread of items across the last few hours. Snapshot boots and restarts
  // skip this — the table is already populated.
  private async seedGenesisWire(): Promise<void> {
    try {
      const { db } = await import('@/lib/db')
      if ((await db.newsItem.count()) > 0) return
      const symbolsByCap = [...this.states.values()]
        .filter((s) => s.inst.kind === 'stock')
        .sort((a, b) => b.inst.shares * b.price - a.inst.shares * a.price)
        .map((s) => s.inst)
      const WINDOW = 5 * 3600_000
      const COUNT = 14
      const step = WINDOW / COUNT
      let t = Date.now() - WINDOW
      const rows: { headline: string; body: string; source: string; kind: string; symbols: string; sentiment: number; impactBps: number; createdAt: Date }[] = []
      for (let i = 0; i < COUNT; i++) {
        const n = generateRandomEvent(secRng, symbolsByCap)
        t += step * (0.5 + Math.random())
        rows.push({
          headline: n.headline, body: n.body, source: n.source, kind: n.kind,
          symbols: JSON.stringify(n.symbols), sentiment: n.sentiment, impactBps: n.impactBps,
          createdAt: new Date(Math.min(t, Date.now() - 60_000)),
        })
      }
      await db.newsItem.createMany({ data: rows })
    } catch {
      // best effort — an empty wire on first boot is not fatal
    }
  }

  private async loadNewsFromDB(): Promise<void> {
    try {
      const { db } = await import('@/lib/db')
      const rows = await db.newsItem.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
      this.newsFeed = rows.map((r) => ({
        id: r.id, headline: r.headline, body: r.body, source: r.source, kind: r.kind,
        symbols: r.symbols, sentiment: r.sentiment, impactBps: r.impactBps, createdAt: r.createdAt.toISOString(),
      }))
    } catch {
      this.newsFeed = []
    }
  }

  async publishNews(n: GeneratedNews): Promise<void> {
    const entry = {
      id: `nws_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      headline: n.headline, body: n.body, source: n.source, kind: n.kind,
      symbols: JSON.stringify(n.symbols), sentiment: n.sentiment, impactBps: n.impactBps,
      createdAt: new Date().toISOString(),
    }
    this.newsFeed.unshift(entry)
    if (this.newsFeed.length > 300) this.newsFeed.pop()
    try {
      const { db } = await import('@/lib/db')
      await db.newsItem.create({ data: { ...entry, createdAt: new Date(entry.createdAt) } })
    } catch {
      // ignore
    }
    await this.broadcast('market', 'news', entry)
    // apply impulses
    const now = Date.now()
    for (const target of n.symbols) {
      if (target === '*') {
        // Market-wide reaction spreads over the next ~15 ticks as a decaying
        // drip so the tape traverses the move instead of gapping in one print.
        this.marketImpulse += (n.impactBps / 100 / 100) * (1 - MACRO_DECAY)
        this.mvixVarTick += Math.pow(Math.abs(n.impactBps) / 100 / 100 / 900, 2) * 2e6
        for (const st of this.states.values()) {
          this.startImpulse(st, n.impactBps * 0.9, now)
        }
      } else if (target.startsWith('@')) {
        const sector = target.slice(1)
        for (const st of this.states.values()) {
          if (st.inst.sector === sector) this.startImpulse(st, n.impactBps * (st.inst.symbol === n.symbols[0]?.slice(1) ? 1 : 0.65), now)
        }
      } else {
        const st = this.states.get(target)
        if (st) this.startImpulse(st, n.impactBps, now)
        // sector sympathy at 35%
        const primary = this.states.get(target)
        if (primary && n.kind !== 'halt') {
          for (const st of this.states.values()) {
            if (st.inst.sector === primary.inst.sector && st !== primary) {
              this.startImpulse(st, n.impactBps * 0.35 * (0.5 + Math.random()), now)
            }
          }
        }
      }
    }
  }

  private startImpulse(st: SymbolState, bps: number, now: number): void {
    if (Math.abs(bps) < 1) return
    const durationTicks = Math.max(20, Math.round(45 + Math.random() * 200))
    st.impulse = {
      totalBps: bps,
      perTick: (bps / 100 / 100 / durationTicks) * 1.15, // overshoot 15%
      remaining: durationTicks,
      overshoot: 1.15,
    }
    st.lastTick = now
  }

  news(limit = 40, symbol?: string) {
    let items = this.newsFeed
    if (symbol) items = items.filter((n) => { try { const arr = JSON.parse(n.symbols); return arr.includes(symbol) } catch { return false } })
    return { news: items.slice(0, limit), ts: Date.now() }
  }

  // ────────────────────────────────────────────── tape

  private recordTapePrint(st: SymbolState, price: number, size: number, x: 'B' | 'S' | 'T'): void {
    st.tape.push({ t: Date.now(), p: roundPx(price), s: Math.max(1, Math.round(size)), x })
    if (st.tape.length > MAX_TAPE) st.tape.splice(0, st.tape.length - MAX_TAPE)
  }

  // ────────────────────────────────────────────── candle aggregation

  private bucketTs(ts: number, minutes: number): number {
    return Math.floor(ts / (minutes * 60000)) * minutes * 60000
  }

  private aggregateLive(st: SymbolState, ts: number, volTick: number): void {
    const price = st.price
    const update = (arr: Candle[], minutes: number) => {
      const b = this.bucketTs(ts, minutes)
      const last = arr[arr.length - 1]
      if (!last || last.t !== b) {
        arr.push({ t: b, o: price, h: price, l: price, c: price, v: volTick })
        const cap = minutes === 1 ? 4400 : minutes === 5 ? 4200 : minutes === 15 ? 3000 : 2600
        if (arr.length > cap) arr.splice(0, arr.length - cap)
      } else {
        last.h = Math.max(last.h, price)
        last.l = Math.min(last.l, price)
        last.c = price
        last.v += volTick
      }
    }
    update(st.live['1m'], 1)
    update(st.live['5m'], 5)
    update(st.live['15m'], 15)
    update(st.live['1h'], 60)
    // today bar
    const tb = st.today
    tb.c = price
    tb.h = Math.max(tb.h, price)
    tb.l = Math.min(tb.l, price)
    tb.v += volTick
  }

  // ────────────────────────────────────────────── main tick

  private tick(): void {
    try {
      this.tickInner()
    } catch (e) {
      console.error('[MRX] tick error', e)
    }
  }

  private async tickInner(): Promise<void> {
    const now = Date.now()
    this.bootStats.ticks++
    const et = etNow(now)
    const session = sessionOf(et.minutes)
    const volMult = sessionVolMult(et.minutes)
    const volNum = sessionVolNumMult(et.minutes)

    // day roll
    if (et.date !== this.lastEtDate) {
      this.rollDay(et.date)
    }

    if (this.paused) {
      await this.broadcast('market', 'ticks', { quotes: this.allQuotes(), indices: this.indices(), ts: now, paused: true })
      return
    }

    // market factor
    const mBase = 0.011 / Math.sqrt(TICKS_PER_YEAR)
    const rM = gaussLive() * mBase * volMult + this.marketImpulse
    this.marketImpulse *= MACRO_DECAY

    const sectorReturns = new Map<Sector, number>()
    for (const sec of this.sectorIndices.keys()) {
      sectorReturns.set(sec, gaussLive() * (0.013 / Math.sqrt(TICKS_PER_YEAR)) * volMult)
    }

    for (const st of this.states.values()) {
      const inst = st.inst
      // halt expiry
      if (st.haltedUntil > 0 && st.haltedUntil <= now) {
        st.haltedUntil = 0
        st.haltReason = ''
        // Re-center the LULD reference band at the reopen (auction) price —
        // otherwise the stale pre-halt reference re-triggers the halt for minutes.
        st.priceRing.fill(st.price)
        this.refreshQuotes(st, volMult)
      }
      if (st.haltedUntil > now) {
        st.priceRing[st.ringIdx] = st.price
        st.ringIdx = (st.ringIdx + 1) % st.priceRing.length
        continue
      }

      const sigmaBase = inst.volAnn / 100 / Math.sqrt(TICKS_PER_YEAR)
      // GARCH-ish vol state
      const idio = gaussLive() * sigmaBase * Math.sqrt(Math.max(st.volVar, sigmaBase * sigmaBase * 0.3)) / Math.max(sigmaBase, 1e-12)
      const ret = inst.kind === 'etf'
        ? rM * (inst.symbol === 'MCOM' ? 1 : 1.05) + (sectorReturns.get(inst.sector) ?? 0) * 0.6 + gaussLive() * sigmaBase * 0.5 * volMult
        : inst.beta * 0.9 * rM + 0.55 * (sectorReturns.get(inst.sector) ?? 0) + idio * volMult

      let impRet = 0
      if (st.impulse && st.impulse.remaining > 0) {
        impRet = st.impulse.perTick * (0.7 + Math.random() * 0.6)
        st.impulse.remaining--
        if (st.impulse.remaining === 0) {
          // small mean reversion after overshoot
          st.counterImpulse = -(st.impulse.totalBps / 100 / 100) * 0.09
          st.impulse = null
        }
      }
      if (st.counterImpulse !== 0) {
        const step = st.counterImpulse * 0.12
        impRet += step
        st.counterImpulse -= step
        if (Math.abs(st.counterImpulse) < 1e-7) st.counterImpulse = 0
      }

      // clamp crazy ticks
      const clamped = clamp(ret + impRet, -sigmaBase * 12, sigmaBase * 12)
      st.price = Math.max(0.5, st.price * Math.exp(clamped))

      // volatility state update
      st.volVar = 0.94 * st.volVar + 0.055 * clamped * clamped + 0.006 * sigmaBase * sigmaBase
      st.volVar = clamp(st.volVar, sigmaBase * sigmaBase * 0.25, sigmaBase * sigmaBase * 36)

      // anchor drift regime
      if (Math.random() < 0.0004) {
        st.drift = secRng.weighted<number>([[-0.45, 0.1], [-0.18, 0.2], [0, 0.4], [0.18, 0.2], [0.45, 0.1]])
      }
      st.anchor *= Math.exp(st.drift / TICKS_PER_YEAR)
      st.price *= Math.exp(-0.0000045 * Math.log(st.price / st.anchor))

      // ranges + volume
      if (st.price > st.dayHigh) st.dayHigh = st.price
      if (st.price < st.dayLow) st.dayLow = st.price
      const volTick = (inst.avgVol / 86400) * volNum * (0.55 + Math.random() * 1.1) * Math.pow(clamp(Math.sqrt(st.volVar) / sigmaBase, 0.4, 4), 0.7)
      st.volume += volTick
      this.aggregateLive(st, now, volTick)

      // tape prints (organic flow)
      if (Math.random() < 0.22 + volNum * 0.5) {
        const nPrints = Math.random() < 0.12 ? 2 + Math.floor(Math.random() * 3) : 1
        for (let i = 0; i < nPrints; i++) {
          const isBuy = Math.random() < 0.5
          const px = isBuy ? st.ask : st.bid
          const size = Math.min(st.inst.avgVol / 700, Math.max(1, Math.exp(secRng.norm(Math.log(st.inst.avgVol / 2600), 1.35))))
          this.recordTapePrint(st, px, size, isBuy ? 'B' : 'S')
          st.price = px
        }
      }

      this.refreshQuotes(st, volMult)

      // ring buffer for LULD
      st.priceRing[st.ringIdx] = st.price
      st.ringIdx = (st.ringIdx + 1) % st.priceRing.length
      const ref = st.priceRing[(st.ringIdx + 300) % st.priceRing.length]
      const band = inst.kind === 'etf' ? 0.14 : 0.08
      if (ref > 0 && Math.abs(st.price / ref - 1) >= band && st.haltedUntil <= now) {
        st.haltedUntil = now + 60000
        st.haltReason = 'LULD — volatility trading pause'
        const news = makeHaltNews(inst.symbol, 'Volatility Trading Pause (LULD)')
        void this.publishNews(news)
      }

      // earnings
      if (st.nextEarnings <= now) {
        await this.runEarnings(st)
      }
    }

    // match resting orders & stops
    await this.matchResting()
    await this.expireDayOrders(et.date)

    // random news
    if (Math.random() < 1 / 85) {
      const symbolsByCap = [...this.states.values()]
        .filter((s) => s.inst.kind === 'stock')
        .sort((a, b) => b.inst.shares * b.price - a.inst.shares * a.price)
        .map((s) => s.inst)
      const ev = generateRandomEvent(secRng, symbolsByCap)
      await this.publishNews(ev)
    }

    // indices
    const capSum = this.computeCapSum()
    const newComposite = capSum / this.compositeDivisor
    const rC = newComposite / this.composite.level - 1
    this.mvixVarTick = 0.9965 * this.mvixVarTick + 0.0035 * rC * rC * TICKS_PER_YEAR
    const mvixTarget = clamp(Math.sqrt(this.mvixVarTick) * 100 * 0.62 + 9.5, 9, 85)
    this.mvix = this.mvix * 0.98 + mvixTarget * 0.02
    this.composite.level = newComposite
    for (const [sector, ix] of this.sectorIndices) {
      const sCap = this.computeCapSum(sector)
      ix.level = sCap / (this.sectorDivisors.get(sector) ?? 1)
    }

    // broadcast
    await this.broadcast('market', 'ticks', { quotes: this.allQuotes(), indices: this.indices(), ts: now, paused: false })

    // periodic maintenance
    if (now - this.lastSnapshot > 45000) {
      this.lastSnapshot = now
      this.saveSnapshot()
    }
    if (now - this.lastMarginCheck > 30000 && this.hooks) {
      this.lastMarginCheck = now
      void this.hooks.checkMargins().catch(() => undefined)
    }
  }

  private rollDay(today: string): void {
    this.lastEtDate = today
    for (const st of this.states.values()) {
      const bar: DailyBar = {
        date: st.today.date,
        o: roundPx(st.today.o),
        h: roundPx(Math.max(st.today.h, st.price)),
        l: roundPx(Math.min(st.today.l, st.price)),
        c: roundPx(st.price),
        v: Math.round(st.today.v),
      }
      if (bar.v > 0 && bar.date !== st.dailyBars[st.dailyBars.length - 1]?.date) {
        st.dailyBars.push(bar)
        if (st.dailyBars.length > 420) st.dailyBars.splice(0, st.dailyBars.length - 420)
      }
      st.prevClose = st.price
      st.dayOpen = st.price
      st.dayHigh = st.price
      st.dayLow = st.price
      st.volume = 0
      st.today = { date: today, o: st.price, h: st.price, l: st.price, c: st.price, v: 0 }
      st.live = { '1m': [], '5m': [], '15m': [], '1h': [] }
    }
    this.composite.prevClose = this.composite.level
    for (const ix of this.sectorIndices.values()) ix.prevClose = ix.level
  }

  private async runEarnings(st: SymbolState): Promise<void> {
    const est = st.estEps
    const actual = roundTo(est * (1 + gaussLive() * 0.13 + 0.03), 2)
    const revBeat = gaussLive() * 4.2 + 0.4
    const guideUp = actual > est * 1.05 ? Math.random() < 0.78 : actual < est * 0.95 ? Math.random() < 0.12 : Math.random() < 0.45 ? true : null
    const news = makeEarningsNews(st.inst, actual, est, revBeat, guideUp as boolean | null)
    st.estEps = roundTo(est * (1 + gaussLive() * 0.06 + 0.045), 2)
    st.nextEarnings = Date.now() + 63 * 86400000 + Math.floor(Math.random() * 20) * 3600000
    // volatility spike around the print
    st.volVar = Math.min(st.volVar * 4, (st.inst.volAnn / 100 / Math.sqrt(TICKS_PER_YEAR)) ** 2 * 30)
    await this.publishNews(news)
  }

  private async matchResting(): Promise<void> {
    for (const [symbol, orders] of this.restingBySymbol) {
      if (orders.length === 0) continue
      const st = this.states.get(symbol)
      if (!st || st.haltedUntil > Date.now()) continue
      for (let i = orders.length - 1; i >= 0; i--) {
        const ro = orders[i]
        if (ro.type !== 'limit' || ro.limitPrice === null) continue
        if (ro.side === 'buy') {
          while (ro.remaining > 1e-9 && st.asks.length && st.asks[0].price <= ro.limitPrice) {
            const lvl = st.asks[0]
            const take = Math.min(ro.remaining, lvl.size)
            await this.executeRestingFill(ro, take, lvl.price)
            lvl.size -= take
            if (lvl.size <= 1e-9) st.asks.shift()
            if (!this.allResting.has(ro.orderId)) break
          }
        } else {
          while (ro.remaining > 1e-9 && st.bids.length && st.bids[0].price >= ro.limitPrice) {
            const lvl = st.bids[0]
            const take = Math.min(ro.remaining, lvl.size)
            await this.executeRestingFill(ro, take, lvl.price)
            lvl.size -= take
            if (lvl.size <= 1e-9) st.bids.shift()
            if (!this.allResting.has(ro.orderId)) break
          }
        }
      }
    }
    // stops
    for (const [symbol, stops] of this.stopMonitors) {
      if (stops.length === 0) continue
      const st = this.states.get(symbol)
      if (!st || st.haltedUntil > Date.now()) continue
      for (let i = stops.length - 1; i >= 0; i--) {
        const ro = stops[i]
        if (ro.stopPrice === null) continue
        const triggered = ro.side === 'buy' ? st.ask >= ro.stopPrice : st.bid <= ro.stopPrice
        if (!triggered) continue
        stops.splice(i, 1)
        this.allResting.delete(ro.orderId)
        // execute remainder as market / limit
        const isBuy = ro.side === 'buy'
        const levels = isBuy ? st.asks : st.bids
        let remaining = ro.remaining
        while (remaining > 1e-9 && levels.length) {
          const lvl = levels[0]
          if (ro.type === 'stop_limit' && ro.limitPrice !== null) {
            if (isBuy ? lvl.price > ro.limitPrice : lvl.price < ro.limitPrice) break
          }
          const take = Math.min(remaining, lvl.size)
          await this.executeRestingFill(ro, take, lvl.price)
          lvl.size -= take
          remaining -= take
          if (lvl.size <= 1e-9) levels.shift()
        }
        if (remaining > 1e-9 && ro.type === 'stop') {
          const slip = st.price * (isBuy ? 1.004 : 0.996)
          await this.executeRestingFill(ro, remaining, slip)
          st.price = slip
        }
        // if stop_limit unfillable remainder → cancel
        if (remaining > 1e-9 && ro.type === 'stop_limit' && this.allResting.has(ro.orderId)) {
          this.allResting.delete(ro.orderId)
          if (this.hooks) await this.hooks.onOrderStatus(ro.orderId, ro.accountId, 'canceled', 'MRX: stop limit order could not be executed within limit price.')
        }
      }
    }
  }

  private async expireDayOrders(today: string): Promise<void> {
    const midnight = etDateToUtcMs(today) - 5 * 3600000 // approx ET midnight in ms (17:00 prev day UTC offset basis)
    void midnight
    for (const ro of [...this.allResting.values()]) {
      if (ro.tif !== 'day') continue
      const createdEt = etNow(ro.createdAt).date
      if (createdEt !== today) {
        this.allResting.delete(ro.orderId)
        const arr = ro.type === 'limit' ? this.restingBySymbol.get(ro.symbol) : this.stopMonitors.get(ro.symbol)
        if (arr) {
          const i = arr.findIndex((x) => x.orderId === ro.orderId)
          if (i >= 0) arr.splice(i, 1)
        }
        if (this.hooks) await this.hooks.onOrderStatus(ro.orderId, ro.accountId, 'expired')
      }
    }
  }

  // Re-register open working orders from the DB after a process restart.
  private async restoreOpenOrders(): Promise<void> {
    try {
      const { db } = await import('@/lib/db')
      const rows = await db.order.findMany({
        where: { status: { in: ['accepted', 'partially_filled'] }, type: { in: ['limit', 'stop', 'stop_limit'] } },
        orderBy: { createdAt: 'asc' },
      })
      if (!rows.length) return
      const todayEt = etNow().date
      const toExpire: string[] = []
      const toClose: string[] = []
      let restored = 0
      for (const r of rows) {
        if (!this.states.has(r.symbol) || !this.restingBySymbol.has(r.symbol)) {
          toExpire.push(r.id) // symbol delisted from universe
          continue
        }
        const remaining = r.qty - r.filledQty
        if (remaining <= 1e-9) {
          toClose.push(r.id)
          continue
        }
        if (r.tif === 'day' && etNow(r.createdAt.getTime()).date !== todayEt) {
          toExpire.push(r.id) // day orders do not survive overnight
          continue
        }
        const ro: RestingOrder = {
          orderId: r.id,
          accountId: r.accountId,
          symbol: r.symbol,
          side: r.side === 'buy' ? 'buy' : 'sell',
          type: r.type === 'limit' ? 'limit' : r.type === 'stop' ? 'stop' : 'stop_limit',
          qty: r.qty,
          remaining,
          limitPrice: r.limitPrice,
          stopPrice: r.stopPrice,
          tif: r.tif as RestingOrder['tif'],
          createdAt: r.createdAt.getTime(),
          seq: ++this.orderSeq,
        }
        this.allResting.set(ro.orderId, ro)
        if (ro.type === 'limit') this.restingBySymbol.get(ro.symbol)!.push(ro)
        else this.stopMonitors.get(ro.symbol)!.push(ro)
        restored++
      }
      for (const sym of this.restingBySymbol.keys()) this.sortBook(sym)
      if (toExpire.length) {
        await db.order.updateMany({ where: { id: { in: toExpire } }, data: { status: 'expired' } })
      }
      if (toClose.length) {
        await db.order.updateMany({ where: { id: { in: toClose } }, data: { status: 'filled', filledAt: new Date() } })
      }
      console.log(`[MRX] restored ${restored} working order(s) from DB (${toExpire.length} expired, ${toClose.length} closed)`)
    } catch (e) {
      console.error('[MRX] open-order restore failed:', e)
    }
  }

  // ────────────────────────────────────────────── operator actions

  applyMarketShock(bps: number): void {
    for (const st of this.states.values()) {
      this.startImpulse(st, bps * (0.7 + Math.random() * 0.6), Date.now())
    }
    this.mvixVarTick += Math.pow(Math.abs(bps) / 10000 / 60, 2) * 1e6
  }

  applySymbolShock(symbol: string, bps: number): boolean {
    const st = this.states.get(symbol)
    if (!st) return false
    this.startImpulse(st, bps, Date.now())
    return true
  }

  haltSymbol(symbol: string, seconds = 60): boolean {
    const st = this.states.get(symbol)
    if (!st) return false
    st.haltedUntil = Date.now() + seconds * 1000
    st.haltReason = 'Volatility Trading Pause'
    void this.publishNews(makeHaltNews(symbol, 'Volatility Trading Pause'))
    return true
  }

  resumeSymbol(symbol: string): boolean {
    const st = this.states.get(symbol)
    if (!st) return false
    st.haltedUntil = 0
    return true
  }

  stats() {
    return {
      started: this.bootStats.started,
      ticks: this.bootStats.ticks,
      instruments: this.states.size,
      restingOrders: this.allResting.size,
      newsItems: this.newsFeed.length,
      paused: this.paused,
      composite: roundTo(this.composite.level, 2),
      mvix: roundTo(this.mvix, 2),
    }
  }

  // ────────────────────────────────────────────── relay broadcast

  private async broadcast(room: string, event: string, data: unknown): Promise<void> {
    if (!this.relayUp && Date.now() - this.lastRelayTry < 15000) return
    this.lastRelayTry = Date.now()
    try {
      const res = await fetch('http://127.0.0.1:3003/internal/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ room, event, data }] }),
        signal: AbortSignal.timeout(1200),
      })
      this.relayUp = res.ok
    } catch {
      this.relayUp = false
    }
  }

  broadcastNow(room: string, event: string, data: unknown): void {
    void this.broadcast(room, event, data)
  }
}

export type { Session }
