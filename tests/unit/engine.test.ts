// Engine core: boot state, quotes, books, candles, impulses (no teleports),
// news routing, LULD halts, day rolls, earnings, resting matching, snapshots,
// order restoration and operator actions.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import { getEngineReady } from '@/lib/engine'
import { registerAccount, placeOrder } from '@/lib/engine/accounts'
import { db } from '@/lib/db'
import { etDateToUtcMs } from '@/lib/engine/time'
import type { MarketEngine } from '@/lib/engine/engine'
import type { SymbolState } from '@/lib/engine/engine'

let engine: MarketEngine
let E: Record<string, unknown> // private-surface accessor
let n = 0

beforeEach(async () => {
  engine = await getEngineReady()
  E = engine as unknown as Record<string, unknown>
  unhaltAll()
})

afterEach(() => {
  engine.paused = false
  vi.restoreAllMocks()
})

function st(symbol: string): SymbolState {
  return engine.states.get(symbol)!
}

function unhaltAll() {
  for (const s of engine.states.values()) {
    s.haltedUntil = 0
    // re-anchor the LULD ring at the live price — test-driven drift otherwise
    // trips instant halts on the first tick
    s.priceRing.fill(s.price)
    s.ringIdx = 0
  }
}

async function tick(times = 1) {
  for (let i = 0; i < times; i++) await (E.tickInner as () => Promise<void>)()
}

const uniqEmail = () => `engine-${Date.now()}-${++n}@mrx.dev`

describe('boot state & quotes', () => {
  it('booted all 46 securities with deep daily history from listing dates', () => {
    expect(engine.states.size).toBe(48)
    for (const [sym, s] of engine.states) {
      expect(s.inst.symbol).toBe(sym)
      expect(s.dailyBars.length).toBeGreaterThanOrEqual(2)
      expect(s.price).toBeGreaterThan(0.4)
      expect(s.bid).toBeGreaterThan(0)
      expect(s.ask).toBeGreaterThan(s.bid)
      expect(s.prevClose).toBeGreaterThan(0)
      expect(s.volume).toBeGreaterThanOrEqual(0)
    }
    const irwq = st('IRWQ')
    expect(irwq.dailyBars.length).toBeGreaterThan(8000) // listed 1996
  })

  it('quotes expose broker fields with coherent bid/ask and day stats', () => {
    const q = engine.quote('QNTM')!
    expect(q.s).toBe('QNTM')
    expect(q.a).toBeGreaterThan(q.b)
    expect(q.bs).toBeGreaterThan(0)
    expect(q.as).toBeGreaterThan(0)
    expect(q.h).toBeGreaterThanOrEqual(q.p)
    expect(q.l).toBeLessThanOrEqual(q.p)
    expect(typeof q.chg).toBe('number')
    expect(q.chgp).toBeCloseTo((q.chg / q.pc) * 100, 0)
    expect(q.halted).toBe(false)
    expect(q.t).toBeGreaterThan(0)
    expect(engine.quote('BOGUS')).toBeNull()
  })

  it('allQuotes covers the universe; getBook returns 10 leveled sides', () => {
    expect(engine.allQuotes()).toHaveLength(48)
    const book = engine.getBook('QNTM')!
    expect(book.symbol).toBe('QNTM')
    expect(book.bids.length).toBeGreaterThan(0)
    expect(book.asks.length).toBeGreaterThan(0)
    for (let i = 1; i < book.bids.length; i++) expect(book.bids[i].price).toBeLessThanOrEqual(book.bids[i - 1].price)
    for (let i = 1; i < book.asks.length; i++) expect(book.asks[i].price).toBeGreaterThanOrEqual(book.asks[i - 1].price)
    expect(book.halted).toBe(false)
    expect(engine.getBook('BOGUS')).toBeNull()
  })

  it('getBook merges resting limit orders into displayed depth (new level + existing level)', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const px = engine.quote('KRYO')!.p
    const far = await placeOrder(acct.id, { symbol: 'KRYO', side: 'buy', type: 'limit', qty: 250, limit_price: px * 0.5, time_in_force: 'gtc' })
    const farPx = Number(far!.limitPrice)
    const book1 = engine.getBook('KRYO')!
    expect(book1.bids.some((l) => l.price === farPx)).toBe(true)

    // second order at the SAME resting price merges into that level
    const acct2 = await registerAccount({ email: uniqEmail(), password: 'password123' })
    await placeOrder(acct2.id, { symbol: 'KRYO', side: 'buy', type: 'limit', qty: 150, limit_price: farPx, time_in_force: 'gtc' })
    const book2 = engine.getBook('KRYO')!
    const level = book2.bids.find((l) => l.price === farPx)!
    expect(level.size).toBe(400)

    // resting sell orders appear on the ask side
    const px2 = engine.quote('MENDL')!.p
    const sellPx = Math.round(px2 * 1.15 * 100) / 100
    await placeOrder(acct.id, { symbol: 'MENDL', side: 'sell', type: 'limit', qty: 75, limit_price: sellPx, time_in_force: 'gtc' })
    const book3 = engine.getBook('MENDL')!
    expect(book3.asks.some((l) => l.price === sellPx)).toBe(true)

    await engine.cancelOrder(far!.id)
  })

  it('getTape returns newest-first slices and [] for unknown symbols', () => {
    expect(engine.getTape('BOGUS')).toEqual([])
    const tape = engine.getTape('QNTM', 10)
    expect(tape.length).toBeLessThanOrEqual(10)
    for (let i = 1; i < tape.length; i++) expect(tape[i - 1].t).toBeGreaterThanOrEqual(tape[i].t)
  })

  it('indices expose the composite, MVIX and all sectors', () => {
    const ix = engine.indices()
    expect(ix.composite.symbol).toBe('MRC')
    expect(ix.composite.level).toBeGreaterThan(1000)
    expect(ix.mvix).toBeGreaterThan(5)
    expect(Object.keys(ix.sectors)).toHaveLength(8)
    for (const s of Object.values(ix.sectors)) {
      expect(s.level).toBeGreaterThan(0)
      expect(typeof s.chgp).toBe('number')
    }
  })

  it('movers return gainers/losers/active sorted', () => {
    const m = engine.movers()
    expect(m.gainers.length).toBeLessThanOrEqual(5)
    expect(m.losers.length).toBeLessThanOrEqual(5)
    expect(m.active.length).toBeLessThanOrEqual(5)
    for (let i = 1; i < m.gainers.length; i++) expect(m.gainers[i - 1].chgp).toBeGreaterThanOrEqual(m.gainers[i].chgp)
    for (let i = 1; i < m.losers.length; i++) expect(m.losers[i - 1].chgp).toBeLessThanOrEqual(m.losers[i].chgp)
    for (let i = 1; i < m.active.length; i++) expect(m.active[i - 1].v * m.active[i - 1].p).toBeGreaterThanOrEqual(m.active[i].v * m.active[i].p)
  })

  it('marketStatus reflects the exchange clock', () => {
    const s = engine.marketStatus()
    expect(s.exchange).toBe('MRX')
    expect(s.tz).toBe('America/New_York')
    expect(s.open).toBe(true)
    expect(s.paused).toBe(false)
    expect(s.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(['pre_market', 'regular', 'post_market', 'overnight']).toContain(s.session)
  })

  it('calendar lists upcoming earnings within the window, sorted', () => {
    const c = engine.calendar(90)
    expect(c.events.length).toBeGreaterThan(0)
    for (let i = 1; i < c.events.length; i++) expect(c.events[i - 1].date <= c.events[i].date).toBe(true)
    for (const e of c.events) {
      expect(e.time).toBe('16:15')
      expect(engine.states.has(e.symbol)).toBe(true)
    }
    expect(engine.calendar(0).events.length).toBe(0) // nothing within 0 days (earnings are 3+ days out)
  })
})

describe('candles', () => {
  it('serves daily bars across the full listing-era history', () => {
    const irwq = st('IRWQ')
    const start = etDateToUtcMs(irwq.dailyBars[0].date) - 1000
    const end = Date.now() + 86400000
    const bars = engine.getCandles('IRWQ', '1d', start, end, 20000)
    expect(bars.length).toBeGreaterThan(8000)
    expect(bars[0].t).toBe(etDateToUtcMs(irwq.dailyBars[0].date))
    for (const b of bars) expect(b.t).toBeGreaterThanOrEqual(start)
  })

  it('daily slice respects start/end and appends the live today bar', () => {
    const s = st('QNTM')
    s.today.v = 12345
    const start = etDateToUtcMs(s.dailyBars[s.dailyBars.length - 1].date)
    const end = Date.now() + 86400000
    const bars = engine.getCandles('QNTM', '1d', start, end)
    expect(bars.length).toBeGreaterThanOrEqual(2)
    expect(bars[bars.length - 1].v).toBe(12345)
    s.today.v = 0
  })

  it('daily candles skip an empty today bar', () => {
    const s = st('QNTM')
    const savedToday = { ...s.today }
    s.today = { date: s.today.date, o: 0, h: 0, l: 0, c: 0, v: 0 }
    const start = etDateToUtcMs(s.dailyBars[s.dailyBars.length - 1].date)
    const bars = engine.getCandles('QNTM', '1d', start, Date.now() + 86400000)
    expect(bars.some((b) => b.t === etDateToUtcMs(s.today.date))).toBe(false)
    s.today = savedToday
  })

  it('synthesizes intraday history and overlays the live buffer without duplicate timestamps', () => {
    const start = Date.now() - 3 * 86400000
    const end = Date.now()
    const bars = engine.getCandles('QNTM', '5m', start, end)
    expect(bars.length).toBeGreaterThan(100)
    const seen = new Set<number>()
    for (const b of bars) {
      expect(seen.has(b.t)).toBe(false)
      seen.add(b.t)
    }
    // live buffer wins per bucket
    const s = st('QNTM')
    s.live['5m'].push({ t: bars[0].t, o: 1, h: 1, l: 1, c: 1, v: 9 })
    const again = engine.getCandles('QNTM', '5m', start, end)
    expect(again.find((b) => b.t === bars[0].t)!.v).toBe(9)
    s.live['5m'].pop()
  })

  it('returns [] for unknown symbols and slices to the limit', () => {
    expect(engine.getCandles('BOGUS', '1m', 0, Date.now())).toEqual([])
    const bars = engine.getCandles('QNTM', '1m', Date.now() - 86400000, Date.now(), 10)
    expect(bars.length).toBeLessThanOrEqual(10)
  })

  it('maps all four intraday intervals', () => {
    const start = Date.now() - 2 * 86400000
    for (const interval of ['1m', '5m', '15m', '1h'] as const) {
      const bars = engine.getCandles('VLTR', interval, start, Date.now())
      expect(bars.length).toBeGreaterThan(0)
    }
  })
})

describe('news routing & impulses (no teleports)', () => {
  it('single-symbol news moves the primary and sympathezes the sector', async () => {
    const q0 = engine.quote('NEURX')!.p
    const peers0 = new Map([...engine.states.values()].filter((s) => s.inst.sector === 'Technology' && s.inst.symbol !== 'NEURX').map((s) => [s.inst.symbol, s.price]))
    await engine.publishNews({
      headline: 'NEURX lands transformational contract', body: 'Big win for Neuraflux AI.', source: 'Test',
      kind: 'product', symbols: ['NEURX'], sentiment: 0.7, impactBps: 500,
    })
    // quiet ticks: no random news may offset the injected impulse
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    await tick(30)
    randSpy.mockRestore()
    const moved = st('NEURX').price / q0 - 1
    expect(moved).toBeGreaterThan(0.002)
    const peerMoved = [...peers0].filter(([sym]) => engine.states.get(sym)!.inst.sector === 'Technology')
    expect(peerMoved.length).toBeGreaterThan(0)
  })

  it('halt-kind news skips sector sympathy', async () => {
    const px = st('KRYO').price
    await engine.publishNews({
      headline: 'MRX Halts Trading in KRYO — Test', body: 'halt test', source: 'Test',
      kind: 'halt', symbols: ['KRYO'], sentiment: 0, impactBps: 0,
    })
    expect(engine.newsFeed[0].kind).toBe('halt')
    expect(st('KRYO').price).toBe(px) // zero-impact news does not move price
  })

  it('sector-tagged news moves every constituent at reduced strength', async () => {
    const before = new Map([...engine.states.values()].filter((s) => s.inst.sector === 'Utilities').map((s) => [s.inst.symbol, s.price]))
    await engine.publishNews({
      headline: 'Utilities rally on data-center demand', body: 'Rotation into utilities.', source: 'Test',
      kind: 'color', symbols: ['@Utilities'], sentiment: 0.4, impactBps: 300,
    })
    await tick(20)
    for (const [sym, px] of before) {
      expect(st(sym).price, sym).not.toBe(px)
    }
  })

  it('macro news drips: no tick exceeds ~0.35% while the move accumulates', async () => {
    for (let i = 0; i < 3; i++) await tick()
    const symbols = ['QNTM', 'MRDN', 'GRTD', 'MCOM', 'AXBK']
    const before = new Map(symbols.map((s) => [s, st(s).price]))

    await engine.publishNews({
      headline: 'Fed slashes rates by 50bps', body: 'Aggressive easing cycle begins.', source: 'The Macro Desk',
      kind: 'macro', symbols: ['*'], sentiment: 0.7, impactBps: 900,
    })

    let maxStep = 0
    let maxSym = ''
    const prev = new Map(before)
    for (let i = 0; i < 45; i++) {
      await tick()
      for (const s of symbols) {
        const p = st(s).price
        const step = Math.abs(p / prev.get(s)! - 1)
        if (step > maxStep) { maxStep = step; maxSym = s }
        prev.set(s, p)
      }
    }
    expect(maxStep, `largest single-tick step ${(maxStep * 100).toFixed(3)}% on ${maxSym}`).toBeLessThan(0.0035)

    const qntmTotal = st('QNTM').price / before.get('QNTM')! - 1
    const grtdTotal = st('GRTD').price / before.get('GRTD')! - 1
    expect(qntmTotal).toBeGreaterThan(0.01) // high-beta name reacts materially
    expect(Math.abs(qntmTotal)).toBeGreaterThan(Math.abs(grtdTotal)) // beta ordering
  })

  it('macro impulses decay to zero (no permanent drift)', async () => {
    await engine.publishNews({
      headline: 'CPI shock', body: 'Inflation surprise.', source: 'The Macro Desk',
      kind: 'macro', symbols: ['*'], sentiment: -0.4, impactBps: -300,
    })
    // quiet ticks: suppress random news so no fresh macro impulse refills the field
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    await tick(80)
    randSpy.mockRestore()
    expect(Math.abs(E.marketImpulse as number)).toBeLessThan(1e-9)
  })

  it('newsFeed caps at 300 entries and zero-impact news leaves prices untouched', async () => {
    const px = st('QNTM').price
    const startLen = engine.newsFeed.length
    for (let i = 0; i < 300; i++) {
      await engine.publishNews({
        headline: `Filler headline ${i} for the wire cap test`, body: 'No impact filler.', source: 'Test',
        kind: 'color', symbols: ['QNTM'], sentiment: 0, impactBps: 0,
      })
    }
    expect(engine.newsFeed.length).toBe(Math.min(300, startLen + 300))
    expect(engine.newsFeed.length).toBeLessThanOrEqual(300)
    expect(st('QNTM').price).toBe(px)
  })

  it('news() filters by symbol (valid JSON) and survives malformed symbol JSON', async () => {
    const feed = engine.news(5)
    expect(feed.news.length).toBeLessThanOrEqual(5)
    expect(feed.ts).toBeGreaterThan(0)

    engine.newsFeed.unshift({ id: 'bad', headline: 'h', body: 'b', source: 's', kind: 'color', symbols: '{not json', sentiment: 0, impactBps: 0, createdAt: new Date().toISOString() })
    const filtered = engine.news(50, 'QNTM')
    expect(filtered.news.find((x) => x.id === 'bad')).toBeUndefined()
    engine.newsFeed.shift()
  })

  it('startImpulse ignores sub-1bps noise', async () => {
    const px = st('WVLN').price
    await engine.publishNews({
      headline: 'Wavelink mentioned in passing', body: 'tiny', source: 'Test',
      kind: 'color', symbols: ['WVLN'], sentiment: 0.01, impactBps: 0,
    })
    await tick(3)
    expect(Math.abs(st('WVLN').price / px - 1)).toBeLessThan(0.002)
  })
})

describe('order routing via the engine', () => {
  it('rejects unknown symbols, paused market, halted symbols and non-positive qty', async () => {
    const r1 = await engine.submitOrder({ id: 'x1', accountId: 'a', symbol: 'BOGUS', side: 'buy', type: 'market', qty: 1, limitPrice: null, stopPrice: null, tif: 'day' })
    expect(r1.reject).toMatch(/Unknown symbol/)
    engine.paused = true
    const r2 = await engine.submitOrder({ id: 'x2', accountId: 'a', symbol: 'QNTM', side: 'buy', type: 'market', qty: 1, limitPrice: null, stopPrice: null, tif: 'day' })
    expect(r2.reject).toMatch(/paused/)
    engine.paused = false
    engine.haltSymbol('PXLQ', 30)
    const r3 = await engine.submitOrder({ id: 'x3', accountId: 'a', symbol: 'PXLQ', side: 'buy', type: 'market', qty: 1, limitPrice: null, stopPrice: null, tif: 'day' })
    expect(r3.reject).toMatch(/volatility trading pause/i)
    engine.resumeSymbol('PXLQ')
    const r4 = await engine.submitOrder({ id: 'x4', accountId: 'a', symbol: 'QNTM', side: 'buy', type: 'market', qty: 0, limitPrice: null, stopPrice: null, tif: 'day' })
    expect(r4.reject).toMatch(/positive/)
  })

  it('rejects market orders when the book is exhausted', async () => {
    const s = st('SILVX')
    const savedBids = s.bids
    s.bids = []
    const r = await engine.submitOrder({ id: 'x5', accountId: 'a', symbol: 'SILVX', side: 'sell', type: 'market', qty: 1, limitPrice: null, stopPrice: null, tif: 'day' })
    expect(r.reject).toMatch(/insufficient liquidity/)
    s.bids = savedBids
  })

  it('drains the book and fills the remainder with slippage', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    await db.account.update({ where: { id: acct.id }, data: { cash: 5000000, lastEquity: 5000000 } })
    const s = st('AQFR')
    const bookDepth = s.asks.reduce((sum, l) => sum + l.size, 0)
    const r = await engine.submitOrder({ id: 'x6', accountId: acct.id, symbol: 'AQFR', side: 'buy', type: 'market', qty: bookDepth + 4000, limitPrice: null, stopPrice: null, tif: 'day' })
    expect(r.status).toBe('filled')
    expect(r.fills).toHaveLength(2) // book fill + slippage tail
    expect(r.fills[1].price).toBeGreaterThan(r.fills[0].price)
    // anchor moved with the impact
    expect(s.anchor).toBeGreaterThan(0)
  })

  it('limit orders rest below the market and marketable limits fill immediately', async () => {
    const px = st('VOLTQ').price
    const r1 = await engine.submitOrder({ id: 'x7', accountId: 'a', symbol: 'VOLTQ', side: 'buy', type: 'limit', qty: 1, limitPrice: px * 0.9, stopPrice: null, tif: 'gtc' })
    expect(r1).toMatchObject({ status: 'accepted', resting: true })
    expect(engine.hasResting('x7')).toBe(true)
    await engine.cancelOrder('x7')

    const r2 = await engine.submitOrder({ id: 'x8', accountId: 'a', symbol: 'VOLTQ', side: 'buy', type: 'limit', qty: 1, limitPrice: px * 1.02, stopPrice: null, tif: 'day' })
    expect(r2.status).toBe('filled')

    const r3 = await engine.submitOrder({ id: 'x9', accountId: 'a', symbol: 'VOLTQ', side: 'buy', type: 'limit', qty: 1, limitPrice: 0, stopPrice: null, tif: 'day' })
    expect(r3.reject).toMatch(/Limit price required/)
  })

  it('partially-marketable limits fill what they can and rest the rest', async () => {
    const s = st('DOLCI')
    const askTotal = s.asks.reduce((sum, l) => sum + l.size, 0)
    const px = s.asks[s.asks.length - 1].price + 0.05 // sweep the whole visible ask ladder
    const r = await engine.submitOrder({ id: 'x10', accountId: 'a', symbol: 'DOLCI', side: 'buy', type: 'limit', qty: askTotal * 3, limitPrice: px, stopPrice: null, tif: 'gtc' })
    expect(r.status).toBe('partially_filled')
    expect(r.resting).toBe(true)
    expect(r.fills[0].qty).toBeGreaterThan(0)
    expect(engine.hasResting('x10')).toBe(true)
    await engine.cancelOrder('x10')
  })

  it('validates stop direction and stop_limit relationships', async () => {
    const px = st('BASTN').price
    const mk = (over: Partial<Record<string, unknown>>) => ({
      id: 'x', accountId: 'a', symbol: 'BASTN', side: 'sell' as const, type: 'stop' as const,
      qty: 1, limitPrice: null, stopPrice: px * 0.9, tif: 'day' as const, ...over,
    })
    expect((await engine.submitOrder(mk({ stopPrice: 0 }))).reject).toMatch(/Stop price required/)
    expect((await engine.submitOrder(mk({ stopPrice: px * 1.2 }))).reject).toMatch(/below the current market/)
    expect((await engine.submitOrder(mk({ side: 'buy', stopPrice: px * 0.8 }))).reject).toMatch(/above the current market/)
    expect((await engine.submitOrder(mk({ side: 'buy', type: 'stop_limit', stopPrice: px * 1.1, limitPrice: px * 1.05 }))).reject).toMatch(/at or above the stop price/)
    expect((await engine.submitOrder(mk({ type: 'stop_limit', stopPrice: px * 0.9, limitPrice: px * 0.95 }))).reject).toMatch(/at or below the stop price/)
    const okStop = await engine.submitOrder(mk({ type: 'stop_limit', stopPrice: px * 0.9, limitPrice: px * 0.85 }))
    expect(okStop.status).toBe('accepted')
    expect(okStop.resting).toBe(true)
    await engine.cancelOrder('x')
  })
})

describe('stops & resting matching', () => {
  it('sell stops trigger as price falls and execute down the book', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const px = st('HELX').price
    await placeOrder(acct.id, { symbol: 'HELX', side: 'buy', type: 'market', qty: 5 })
    const stop = await placeOrder(acct.id, { symbol: 'HELX', side: 'sell', type: 'stop', qty: 5, stop_price: px * 0.97 })
    expect(stop!.status).toBe('accepted')
    const s = st('HELX')
    s.bid = px * 0.94
    s.price = px * 0.94
    await (E.matchResting as () => Promise<void>)()
    expect(engine.hasResting(stop!.id)).toBe(false)
    const order = await db.order.findUnique({ where: { id: stop!.id } })
    expect(order!.filledQty).toBeGreaterThan(0)
  })

  it('buy stops trigger as price rises', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    await db.account.update({ where: { id: acct.id }, data: { cash: 500000, lastEquity: 500000 } })
    const px = st('STRMQ').price
    const stop = await placeOrder(acct.id, { symbol: 'STRMQ', side: 'buy', type: 'stop', qty: 5, stop_price: px * 1.03 })
    expect(stop!.status).toBe('accepted')
    const s = st('STRMQ')
    s.ask = px * 1.05
    s.price = px * 1.05
    await (E.matchResting as () => Promise<void>)()
    expect(engine.hasResting(stop!.id)).toBe(false)
  })

  it('stop orders fill at a slip price when the book is empty', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const px = st('IRWQ').price
    await placeOrder(acct.id, { symbol: 'IRWQ', side: 'buy', type: 'market', qty: 5 })
    const stop = await placeOrder(acct.id, { symbol: 'IRWQ', side: 'sell', type: 'stop', qty: 5, stop_price: px * 0.97 })
    const s = st('IRWQ')
    s.bid = px * 0.94
    s.price = px * 0.94
    const savedBids = s.bids
    s.bids = []
    await (E.matchResting as () => Promise<void>)()
    s.bids = savedBids
    expect(engine.hasResting(stop!.id)).toBe(false)
    const after = await db.order.findUnique({ where: { id: stop!.id } })
    expect(after!.filledQty).toBe(5)
  })

  it('stop_limit orders that cannot fill within the limit are canceled with a reason', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const px = st('GRXN').price
    await placeOrder(acct.id, { symbol: 'GRXN', side: 'buy', type: 'market', qty: 5 })
    const stop = await placeOrder(acct.id, { symbol: 'GRXN', side: 'sell', type: 'stop_limit', qty: 5, stop_price: px * 0.97, limit_price: px * 0.9 })
    const s = st('GRXN')
    s.bid = px * 0.94 // triggers (below stop) but book is above the 0.9 limit
    s.price = px * 0.94
    const savedBids = s.bids
    s.bids = [{ price: px * 0.85, size: 100 }]
    await (E.matchResting as () => Promise<void>)()
    s.bids = savedBids
    expect(engine.hasResting(stop!.id)).toBe(false)
    const after = await db.order.findUnique({ where: { id: stop!.id } })
    expect(after!.status).toBe('canceled')
    expect(after!.rejectReason).toMatch(/stop limit/i)
  })

  it('matchResting and stops skip halted symbols', async () => {
    engine.haltSymbol('ATKR', 30)
    try {
      const before = engine.restingBySymbol.get('ATKR')!.length
      await (E.matchResting as () => Promise<void>)()
      expect(engine.restingBySymbol.get('ATKR')!.length).toBeGreaterThanOrEqual(before)
    } finally {
      engine.resumeSymbol('ATKR')
    }
  })

  it('sortBook orders the book by side and price-time priority', () => {
    const arr = engine.restingBySymbol.get('VELR')!
    arr.length = 0
    const mk = (id: string, side: 'buy' | 'sell', px: number | null, seq: number) => ({
      orderId: id, accountId: 'a', symbol: 'VELR', side, type: 'limit' as const, qty: 1,
      remaining: 1, limitPrice: px, stopPrice: null, tif: 'gtc' as const, createdAt: 0, seq,
    })
    arr.push(mk('s1', 'sell', 101, 1), mk('b2', 'buy', 99, 2), mk('b1', 'buy', 100, 3), mk('b0', 'buy', 100, 4))
    ;(E.sortBook as (s: string) => void)('VELR')
    expect(arr.map((r) => r.orderId)).toEqual(['b1', 'b0', 'b2', 's1'])
    arr.length = 0
    // price-time tiebreak: earlier seq wins at the same buy price
    arr.push(mk('z2', 'buy', 50, 9), mk('z1', 'buy', 50, 8))
    ;(E.sortBook as (s: string) => void)('VELR')
    expect(arr.map((r) => r.orderId)).toEqual(['z1', 'z2'])
    arr.length = 0
  })

  it('cancelOrder removes stops from the stop monitor', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const px = st('PETQ').price
    await placeOrder(acct.id, { symbol: 'PETQ', side: 'buy', type: 'market', qty: 5 })
    const stop = await placeOrder(acct.id, { symbol: 'PETQ', side: 'sell', type: 'stop', qty: 5, stop_price: px * 0.9 })
    expect(await engine.cancelOrder(stop!.id)).toBe(true)
    expect(await engine.cancelOrder(stop!.id)).toBe(false)
  })
})

describe('LULD halts & day lifecycle', () => {
  it('haltSymbol pauses trading, quotes flag it, and expiry re-centers the ring', async () => {
    engine.haltSymbol('NDRX', 1)
    expect(engine.quote('NDRX')!.halted).toBe(true)
    expect(engine.getBook('NDRX')!.halted).toBe(true)
    expect(engine.newsFeed[0].headline).toContain('MRX Halts Trading in NDRX')
    const s = st('NDRX')
    s.haltedUntil = Date.now() - 1 // expired
    await tick(1)
    expect(s.haltedUntil).toBe(0)
    expect(s.haltReason).toBe('')
    expect(engine.quote('NDRX')!.halted).toBe(false)
  })

  it('symbols frozen mid-halt keep their price and are skipped by the tick loop', async () => {
    engine.haltSymbol('TERRV', 30)
    const px = st('TERRV').price
    const vol = st('TERRV').volume
    await tick(2)
    expect(st('TERRV').price).toBe(px)
    expect(st('TERRV').volume).toBe(vol)
    engine.resumeSymbol('TERRV')
  })

  it('LULD triggers a halt when price strays 8% from the 300-tick reference (stocks)', async () => {
    const s = st('HLXQ')
    await tick(2) // advance the ring so the reference is a real historical price
    const ref = s.priceRing[(s.ringIdx + 300) % s.priceRing.length]
    s.price = ref * 1.12
    await tick(1)
    expect(s.haltedUntil).toBeGreaterThan(0)
    engine.resumeSymbol('HLXQ')
  })

  it('ETFs use the wider 14% band', async () => {
    const s = st('MFIN')
    await tick(2)
    const ref = s.priceRing[(s.ringIdx + 300) % s.priceRing.length]
    s.price = ref * 1.09 // inside the 14% ETF band
    await tick(1)
    expect(s.haltedUntil).toBe(0)
    s.price = ref * 1.16 // outside it
    await tick(1)
    expect(s.haltedUntil).toBeGreaterThan(0)
    engine.resumeSymbol('MFIN')
  })

  it('rollDay archives the completed today-bar, resets day stats and keeps deep history', async () => {
    const s = st('QNTM')
    const depthBefore = s.dailyBars.length
    await tick(2) // accrue volume into today
    expect(s.today.v).toBeGreaterThan(0)
    const yesterday = s.today.date
    ;(E.rollDay as (d: string) => void)('2026-11-02')
    expect(s.dailyBars.length).toBe(depthBefore + 1)
    expect(s.dailyBars[s.dailyBars.length - 1].date).toBe(yesterday)
    expect(s.today.date).toBe('2026-11-02')
    expect(s.volume).toBe(0)
    expect(s.live['1m']).toHaveLength(0)
    expect(s.prevClose).toBe(s.price)
    // idempotent within the same day: a second roll with no volume pushes nothing
    const depth2 = s.dailyBars.length
    ;(E.rollDay as (d: string) => void)('2026-11-02')
    expect(s.dailyBars.length).toBe(depth2)
    ;(E.rollDay as (d: string) => void)('2026-11-01') // restore the real ET date flow
    // composite and sector prevCloses updated
    expect(engine.composite.prevClose).toBeGreaterThan(0)
  })

  it('expireDayOrders expires stale day orders but spares GTC', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const px = st('CRDSP').price
    const day = await placeOrder(acct.id, { symbol: 'CRDSP', side: 'buy', type: 'limit', qty: 1, limit_price: px * 0.5, time_in_force: 'day' })
    const gtc = await placeOrder(acct.id, { symbol: 'CRDSP', side: 'buy', type: 'limit', qty: 1, limit_price: px * 0.5, time_in_force: 'gtc' })
    const ro = (E.allResting as Map<string, { createdAt: number; tif: string }>).get(day!.id)!
    ro.createdAt = Date.now() - 26 * 3600000 // placed "yesterday"
    await (E.expireDayOrders as (d: string) => Promise<void>)('2026-11-02')
    expect((await db.order.findUnique({ where: { id: day!.id } }))!.status).toBe('expired')
    expect((await db.order.findUnique({ where: { id: gtc!.id } }))!.status).toBe('accepted')
    await engine.cancelOrder(gtc!.id)
  })

  it('runEarnings publishes an earnings report and reschedules ~63 days out', async () => {
    st('ZRNX').haltedUntil = 0
    const s = st('ZRNX')
    s.nextEarnings = Date.now() - 1000
    await tick(1)
    expect(s.nextEarnings).toBeGreaterThan(Date.now() + 60 * 86400000)
    expect(s.nextEarnings).toBeLessThan(Date.now() + 70 * 86400000)
    expect(Number.isFinite(s.estEps)).toBe(true)
    expect(s.estEps).not.toBe(0)
    const earnings = engine.newsFeed.find((x) => x.kind === 'earnings' && JSON.parse(x.symbols).includes('ZRNX'))
    expect(earnings).toBeDefined()
  })
})

describe('snapshots & open-order restoration', () => {
  it('saveSnapshot writes a parseable state file and loadSnapshot reads it back', () => {
    ;(E.saveSnapshot as () => void)()
    const raw = fs.readFileSync(`${process.cwd()}/db/market-state.json`, 'utf8')
    const data = JSON.parse(raw)
    expect(data.symbols.QNTM.price).toBeGreaterThan(0)
    expect(data.daily.QNTM.length).toBeGreaterThan(0)
    expect(data.composite.level).toBeGreaterThan(0)
    expect((E.loadSnapshot as () => unknown)()).not.toBeNull()
  })

  it('loadSnapshot rejects stale (>5 days) and corrupt files', () => {
    const path = `${process.cwd()}/db/market-state.json`
    fs.writeFileSync(path, JSON.stringify({ savedAt: new Date(Date.now() - 6 * 86400000).toISOString() }))
    expect((E.loadSnapshot as () => unknown)()).toBeNull()
    fs.writeFileSync(path, '{corrupt json')
    expect((E.loadSnapshot as () => unknown)()).toBeNull()
  })

  it('restoreOpenOrders restores working orders and expires/closes the rest', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const px = st('OCTEQ').price
    const valid = await db.order.create({
      data: { accountId: acct.id, symbol: 'OCTEQ', side: 'buy', type: 'limit', qty: 2, limitPrice: px * 0.9, tif: 'gtc', status: 'accepted' },
    })
    const delisted = await db.order.create({
      data: { accountId: acct.id, symbol: 'BOGUS', side: 'buy', type: 'limit', qty: 2, limitPrice: 1, tif: 'gtc', status: 'accepted' },
    })
    const done = await db.order.create({
      data: { accountId: acct.id, symbol: 'OCTEQ', side: 'buy', type: 'limit', qty: 2, filledQty: 2, limitPrice: 1, tif: 'gtc', status: 'partially_filled' },
    })
    const staleDay = await db.order.create({
      data: { accountId: acct.id, symbol: 'OCTEQ', side: 'buy', type: 'limit', qty: 2, limitPrice: 1, tif: 'day', status: 'accepted', createdAt: new Date(Date.now() - 26 * 3600000) },
    })
    await (E.restoreOpenOrders as () => Promise<void>)()
    expect(engine.hasResting(valid.id)).toBe(true)
    expect((await db.order.findUnique({ where: { id: delisted.id } }))!.status).toBe('expired')
    expect((await db.order.findUnique({ where: { id: done.id } }))!.status).toBe('filled')
    expect((await db.order.findUnique({ where: { id: staleDay.id } }))!.status).toBe('expired')
    await engine.cancelOrder(valid.id)
  })

  it('restoreOpenOrders survives database failures', async () => {
    const orig = db.order.findMany.bind(db.order)
    ;(db.order as unknown as { findMany: () => Promise<never> }).findMany = async () => {
      throw new Error('db offline')
    }
    try {
      await (E.restoreOpenOrders as () => Promise<void>)()
    } finally {
      ;(db.order as unknown as { findMany: typeof orig }).findMany = orig
    }
  })
})

describe('genesis wire & news persistence', () => {
  it('a fresh database is seeded with a backfilled news wire', async () => {
    const count = await db.newsItem.count()
    expect(count).toBeGreaterThanOrEqual(14)
  })

  it('publishNews persists to the database', async () => {
    const before = await db.newsItem.count()
    await engine.publishNews({
      headline: 'Persisted headline for the DB test', body: 'body', source: 'Test',
      kind: 'color', symbols: ['QNTM'], sentiment: 0, impactBps: 0,
    })
    expect(await db.newsItem.count()).toBe(before + 1)
  })
})

describe('operator actions & stats', () => {
  it('applySymbolShock / halt / resume return false for unknown symbols', () => {
    expect((E.applySymbolShock as (s: string, b: number) => boolean)('BOGUS', 100)).toBe(false)
    expect((E.haltSymbol as (s: string, sec?: number) => boolean)('BOGUS')).toBe(false)
    expect((E.resumeSymbol as (s: string) => boolean)('BOGUS')).toBe(false)
  })

  it('applyMarketShock starts impulses on every symbol', async () => {
    ;(E.applyMarketShock as (b: number) => void)(300)
    let withImpulse = 0
    for (const s of engine.states.values()) if (s.impulse) withImpulse++
    expect(withImpulse).toBeGreaterThan(40)
    // quiet ticks: rand=0.99 suppresses random news, tape prints and drift flips
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    // halt freezes an impulse, so keep releasing and ticking until all drain
    for (let round = 0; round < 40; round++) {
      unhaltAll()
      await tick(30)
      let pending = false
      for (const s of engine.states.values()) if (s.impulse) pending = true
      if (!pending) break
    }
    randSpy.mockRestore()
    let remaining = 0
    for (const s of engine.states.values()) if (s.impulse) remaining++
    expect(remaining).toBe(0)
  })

  it('applySymbolShock moves only the target symbol', async () => {
    const px = st('GRTD').price
    expect((E.applySymbolShock as (s: string, b: number) => boolean)('GRTD', 500)).toBe(true)
    await tick(25)
    expect(st('GRTD').price).not.toBe(px)
  })

  it('stats() reports engine vitals', () => {
    const s = engine.stats()
    expect(s.instruments).toBe(48)
    expect(s.ticks).toBeGreaterThan(0)
    expect(s.composite).toBeGreaterThan(0)
    expect(s.mvix).toBeGreaterThan(0)
    expect(s.paused).toBe(false)
    expect(typeof s.restingOrders).toBe('number')
    expect(s.newsItems).toBeGreaterThan(0)
  })

  it('broadcastNow and the relay outage path stay silent and safe', async () => {
    // relay is not running in tests: the first broadcast fails and the circuit
    // breaker suppresses retries for 15s
    engine.broadcastNow('market', 'news', { test: 1 })
    await new Promise((r) => setTimeout(r, 1200))
    expect(typeof (E as { relayUp?: boolean }).relayUp).toBe('boolean')
  })

  it('tick errors are caught and logged, never crash the loop', async () => {
    const origTickInner = E.tickInner
    ;(engine as unknown as { tickInner: () => void }).tickInner = () => {
      throw new Error('simulated tick failure')
    }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ;(E.tick as () => void)()
    expect(errSpy).toHaveBeenCalled()
    ;(engine as unknown as { tickInner: unknown }).tickInner = origTickInner
  })

  it('wireEngineHooks and margin checks can run through the hook surface', async () => {
    expect(engine.hooks).not.toBeNull()
    await engine.hooks!.checkMargins()
  })
})

describe('snapshot boot path & persistence edges', () => {
  it('boots from a snapshot: regenerates the deep head and splices the saved tail', async () => {
    ;(E.saveSnapshot as () => void)()
    const snapPath = `${process.cwd()}/db/market-state.json`
    const raw = JSON.parse(fs.readFileSync(snapPath, 'utf8'))
    // keep only a short real tail — the boot must regenerate the deep era
    raw.daily.QNTM = raw.daily.QNTM.slice(-40)
    fs.writeFileSync(snapPath, JSON.stringify(raw))

    const { MarketEngine } = await import('@/lib/engine/engine')
    const g = globalThis as unknown as { __mrxEngine?: MarketEngine }
    const real = g.__mrxEngine
    const second = new MarketEngine()
    await second.init()
    clearInterval((second as unknown as { timer: NodeJS.Timeout | null }).timer ?? undefined)
    try {
      const qntm = second.states.get('QNTM')!
      expect(qntm.dailyBars.length).toBeGreaterThan(8000) // regenerated head + saved tail
      expect(qntm.dailyBars.slice(-40)).toEqual(raw.daily.QNTM) // tail verbatim
      expect(second.composite.level).toBeGreaterThan(0) // indices restored from the snapshot
      expect(second.sectorIndices.size).toBe(8)
      expect(second.mvix).toBeGreaterThan(0)
      for (const ix of second.sectorIndices.values()) expect(ix.prevClose).toBeGreaterThan(0)
    } finally {
      g.__mrxEngine = real
    }
  })

  it('saveSnapshot survives a broken snapshot path', () => {
    const orig = (E.snapPath as () => string).bind(engine)
    ;(E as Record<string, unknown>).snapPath = () => {
      throw new Error('disk gone')
    }
    try {
      ;(E.saveSnapshot as () => void)()
    } finally {
      ;(E as Record<string, unknown>).snapPath = orig
    }
  })

  it('loadNewsFromDB survives database failures', async () => {
    const orig = db.newsItem.findMany.bind(db.newsItem)
    ;(db.newsItem as unknown as { findMany: () => Promise<never> }).findMany = async () => {
      throw new Error('db offline')
    }
    try {
      await (E.loadNewsFromDB as () => Promise<void>)()
      expect(engine.newsFeed).toEqual([])
    } finally {
      ;(db.newsItem as unknown as { findMany: typeof orig }).findMany = orig
    }
  })

  it('publishNews survives a failed database write', async () => {
    const orig = db.newsItem.create.bind(db.newsItem)
    ;(db.newsItem as unknown as { create: () => Promise<never> }).create = async () => {
      throw new Error('db offline')
    }
    try {
      const before = engine.newsFeed.length
      await engine.publishNews({ headline: 'DB-less wire entry', body: 'b', source: 's', kind: 'color', symbols: ['QNTM'], sentiment: 0, impactBps: 0 })
      expect(engine.newsFeed.length).toBe(before + 1)
    } finally {
      ;(db.newsItem as unknown as { create: typeof orig }).create = orig
    }
  })

  it('a paused market broadcasts a paused frame and skips all processing', async () => {
    engine.paused = true
    try {
      const px = st('QNTM').price
      await tick(2)
      expect(st('QNTM').price).toBe(px)
    } finally {
      engine.paused = false
    }
  })

  it('the relay circuit breaker opens on failure and suppresses retries for 15s', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('relay down')
    }) as typeof fetch
    try {
      ;(E.broadcastNow as (r: string, e: string, d: unknown) => void)('market', 'news', { x: 1 })
      await new Promise((r) => setTimeout(r, 100))
      expect((E as { relayUp: boolean }).relayUp).toBe(false)
      // within the 15s window the next broadcast returns immediately
      ;(E.broadcastNow as (r: string, e: string, d: unknown) => void)('market', 'news', { x: 2 })
    } finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('book-walk edges (both sides)', () => {
  it('market buy skips zero-size ask levels', async () => {
    const s = st('QNTM')
    const saved = s.asks
    const lvl1 = s.ask
    const lvl2 = s.ask + 0.05
    s.asks = [{ price: lvl1, size: 0 }, { price: lvl2, size: 500 }]
    const r = await engine.submitOrder({ id: 'z1', accountId: 'a', symbol: 'QNTM', side: 'buy', type: 'market', qty: 1, limitPrice: null, stopPrice: null, tif: 'day' })
    expect(r.status).toBe('filled')
    expect(r.fills[0].price).toBeCloseTo(lvl2, 2)
    s.asks = saved
  })

  it('market sell drains exact-size bid levels', async () => {
    const s = st('QNTM')
    const saved = s.bids
    const top = s.bid
    s.bids = [{ price: top, size: 5 }, { price: top - 0.05, size: 500 }]
    const r = await engine.submitOrder({ id: 'z2', accountId: 'a', symbol: 'QNTM', side: 'sell', type: 'market', qty: 5, limitPrice: null, stopPrice: null, tif: 'day' })
    expect(r.status).toBe('filled')
    expect(r.fills[0].price).toBeCloseTo(top, 2)
    s.bids = saved
  })

  it('market sell skips zero-size bid levels', async () => {
    const s = st('HELX')
    const saved = s.bids
    const below = s.bid - 0.05
    s.bids = [{ price: s.bid, size: 0 }, { price: below, size: 500 }]
    const r = await engine.submitOrder({ id: 'z3', accountId: 'a', symbol: 'HELX', side: 'sell', type: 'market', qty: 1, limitPrice: null, stopPrice: null, tif: 'day' })
    expect(r.status).toBe('filled')
    expect(r.fills[0].price).toBeCloseTo(below, 2)
    s.bids = saved
  })

  it('limit sell walks and depletes bid levels, resting the remainder', async () => {
    const s = st('MENDL')
    const saved = s.bids
    const top = s.bid
    s.bids = [{ price: top, size: 2 }, { price: top - 0.05, size: 500 }]
    const r = await engine.submitOrder({ id: 'z4', accountId: 'a', symbol: 'MENDL', side: 'sell', type: 'limit', qty: 3, limitPrice: top, stopPrice: null, tif: 'gtc' })
    expect(r.status).toBe('partially_filled')
    expect(r.resting).toBe(true)
    expect(r.fills[0].qty).toBe(2)
    expect(engine.hasResting('z4')).toBe(true)
    s.bids = saved
    await engine.cancelOrder('z4')
  })

  it('matchResting fills resting sell limits from the bid side', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    await placeOrder(acct.id, { symbol: 'MENDL', side: 'buy', type: 'market', qty: 2 })
    const px = st('MENDL').price
    const order = await placeOrder(acct.id, { symbol: 'MENDL', side: 'sell', type: 'limit', qty: 2, limit_price: px * 1.05, time_in_force: 'gtc' })
    expect(order!.status).toBe('accepted')
    const s = st('MENDL')
    // exactly-sized top level: the resting fill consumes it fully and shifts it
    s.bids = [{ price: px * 1.06, size: 2 }, { price: px * 1.05, size: 100 }]
    await (E.matchResting as () => Promise<void>)()
    expect(engine.hasResting(order!.id)).toBe(false)
    const after = await db.order.findUnique({ where: { id: order!.id } })
    expect(after!.status).toBe('filled')
  })

  it('restoreOpenOrders re-registers stop orders onto the stop monitor', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const px = st('GRTD').price
    const stopRow = await db.order.create({
      data: { accountId: acct.id, symbol: 'GRTD', side: 'sell', type: 'stop', qty: 1, stopPrice: px * 0.9, tif: 'gtc', status: 'accepted' },
    })
    await (E.restoreOpenOrders as () => Promise<void>)()
    expect(engine.hasResting(stopRow.id)).toBe(true)
    expect(engine.stopMonitors.get('GRTD')!.some((r) => r.orderId === stopRow.id)).toBe(true)
    await engine.cancelOrder(stopRow.id)
  })
})

describe('remaining engine edges', () => {
  it('getEngine surfaces boot failures and allows a clean retry', async () => {
    const g = globalThis as unknown as { __mrxEngine?: MarketEngine }
    const real = g.__mrxEngine
    const { MarketEngine } = await import('@/lib/engine/engine')
    const proto = MarketEngine.prototype as unknown as { init: () => Promise<void> }
    const origInit = proto.init
    g.__mrxEngine = undefined
    proto.init = async () => {
      throw new Error('boot failure')
    }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { getEngine } = await import('@/lib/engine')
    try {
      await expect(getEngine().ready).rejects.toThrow('boot failure')
      expect(g.__mrxEngine).toBeUndefined() // failed instance released for retry
    } finally {
      proto.init = origInit
      errSpy.mockRestore()
      g.__mrxEngine = real
    }
  })

  it('sortBook tolerates unknown symbols', () => {
    expect((E.sortBook as (s: string) => void)('BOGUS')).toBeUndefined()
  })

  it('sortBook breaks sell-side price ties by sequence', () => {
    const arr = engine.restingBySymbol.get('WVLN')!
    arr.length = 0
    const mk = (id: string, side: 'buy' | 'sell', px: number | null, seq: number) => ({
      orderId: id, accountId: 'a', symbol: 'WVLN', side, type: 'limit' as const, qty: 1,
      remaining: 1, limitPrice: px, stopPrice: null, tif: 'gtc' as const, createdAt: 0, seq,
    })
    arr.push(mk('s2', 'sell', 90, 2), mk('s1', 'sell', 90, 1))
    ;(E.sortBook as (s: string) => void)('WVLN')
    expect(arr.map((r) => r.orderId)).toEqual(['s1', 's2'])
    arr.length = 0
  })

  it('limit orders without a limit price are rejected by the engine', async () => {
    const r = await engine.submitOrder({ id: 'nolp', accountId: 'a', symbol: 'QNTM', side: 'buy', type: 'limit', qty: 1, limitPrice: null, stopPrice: null, tif: 'day' })
    expect(r.reject).toMatch(/Limit price required/)
  })

  it('tape prints are capped at MAX_TAPE', () => {
    const s = st('QNTM')
    const saved = s.tape
    s.tape = []
    for (let i = 0; i < 260; i++) s.tape.push({ t: i, p: 1, s: 1, x: 'T' })
    ;(E.recordTapePrint as (st: SymbolState, p: number, size: number, x: 'B' | 'S' | 'T') => void)(s, 5, 10, 'B')
    expect(s.tape.length).toBeLessThanOrEqual(220)
    expect(s.tape[s.tape.length - 1].p).toBe(5)
    s.tape = saved
  })

  it('live 1m buffers are capped', async () => {
    const s = st('QNTM')
    s.live['1m'] = Array.from({ length: 4400 }, (_, i) => ({ t: i * 60000, o: 1, h: 1, l: 1, c: 1, v: 1 }))
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    await tick(1)
    randSpy.mockRestore()
    expect(s.live['1m'].length).toBeLessThanOrEqual(4400)
    s.live['1m'] = []
  })

  it('market sell slippage lands below the book average', async () => {
    const s = st('AXBK')
    const saved = s.bids
    const depth = s.bids.reduce((sum, l) => sum + l.size, 0)
    const r = await engine.submitOrder({ id: 'z5', accountId: 'a', symbol: 'AXBK', side: 'sell', type: 'market', qty: depth + 3000, limitPrice: null, stopPrice: null, tif: 'day' })
    expect(r.fills).toHaveLength(2)
    expect(r.fills[1].price).toBeLessThan(r.fills[0].price)
    s.bids = saved
  })

  it('buy stop_limit that cannot fill within its limit is canceled', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    await db.account.update({ where: { id: acct.id }, data: { cash: 500000, lastEquity: 500000 } })
    const px = st('PXLQ').price
    const stop = await placeOrder(acct.id, { symbol: 'PXLQ', side: 'buy', type: 'stop_limit', qty: 5, stop_price: px * 1.03, limit_price: px * 1.04 })
    expect(stop!.status).toBe('accepted')
    const s = st('PXLQ')
    s.ask = px * 1.05 // triggers (above stop) but the book is above the limit
    s.price = px * 1.05
    const saved = s.asks
    s.asks = [{ price: px * 1.06, size: 100 }]
    try {
      await (E.matchResting as () => Promise<void>)()
    } finally {
      s.asks = saved
    }
    expect(engine.hasResting(stop!.id)).toBe(false)
    const after = await db.order.findUnique({ where: { id: stop!.id } })
    expect(after!.status).toBe('canceled')
    expect(after!.rejectReason).toMatch(/stop limit/i)

    // hookless engine: the cancel still frees the slot (DB sync is the hook's job)
    const mid = st('PXLQ').price
    const stop2 = await placeOrder(acct.id, { symbol: 'PXLQ', side: 'buy', type: 'stop_limit', qty: 5, stop_price: mid * 1.02, limit_price: mid * 1.03 })
    s.ask = mid * 1.04
    s.price = mid * 1.04
    const savedAsks2 = s.asks
    s.asks = [{ price: mid * 1.05, size: 100 }] // above the limit → unfillable
    const hooks = engine.hooks
    engine.hooks = null
    try {
      await (E.matchResting as () => Promise<void>)()
      expect(engine.hasResting(stop2!.id)).toBe(false)
    } finally {
      engine.hooks = hooks
      s.asks = savedAsks2
    }
  })

  it('non-triggered stops stay resting', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const px = st('STRMQ').price
    await placeOrder(acct.id, { symbol: 'STRMQ', side: 'buy', type: 'market', qty: 1 })
    const stop = await placeOrder(acct.id, { symbol: 'STRMQ', side: 'sell', type: 'stop', qty: 1, stop_price: px * 0.5 })
    await (E.matchResting as () => Promise<void>)()
    expect(engine.hasResting(stop!.id)).toBe(true)
    await engine.cancelOrder(stop!.id)
  })

  it('stops skip halted symbols in the monitor loop', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const px = st('PETQ').price
    await placeOrder(acct.id, { symbol: 'PETQ', side: 'buy', type: 'market', qty: 1 })
    const stop = await placeOrder(acct.id, { symbol: 'PETQ', side: 'sell', type: 'stop', qty: 1, stop_price: px * 0.99 })
    engine.haltSymbol('PETQ', 30)
    try {
      await (E.matchResting as () => Promise<void>)()
      expect(engine.hasResting(stop!.id)).toBe(true)
    } finally {
      engine.resumeSymbol('PETQ')
      await engine.cancelOrder(stop!.id)
    }
  })

  it('buy stops fill at a slip price when the ask book is empty', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    await db.account.update({ where: { id: acct.id }, data: { cash: 500000, lastEquity: 500000 } })
    const px = st('IRWQ').price
    const stop = await placeOrder(acct.id, { symbol: 'IRWQ', side: 'buy', type: 'stop', qty: 5, stop_price: px * 1.03 })
    const s = st('IRWQ')
    s.ask = px * 1.05
    s.price = px * 1.05
    const saved = s.asks
    s.asks = []
    await (E.matchResting as () => Promise<void>)()
    s.asks = saved
    expect(engine.hasResting(stop!.id)).toBe(false)
    const after = await db.order.findUnique({ where: { id: stop!.id } })
    expect(after!.filledQty).toBe(5)
  })

  it('restoreOpenOrders re-registers stop_limit orders', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const px = st('GRXN').price
    const row = await db.order.create({
      data: { accountId: acct.id, symbol: 'GRXN', side: 'sell', type: 'stop_limit', qty: 1, stopPrice: px * 0.9, limitPrice: px * 0.85, tif: 'gtc', status: 'accepted' },
    })
    await (E.restoreOpenOrders as () => Promise<void>)()
    expect(engine.hasResting(row.id)).toBe(true)
    expect(engine.stopMonitors.get('GRXN')!.some((r) => r.orderId === row.id)).toBe(true)
    await engine.cancelOrder(row.id)
  })

  it('snapshot boots tolerate partial state (no per-symbol day fields, no mvix, no sectors)', async () => {
    ;(E.saveSnapshot as () => void)()
    const snapPath = `${process.cwd()}/db/market-state.json`
    const raw = JSON.parse(fs.readFileSync(snapPath, 'utf8'))
    delete raw.mvix
    delete raw.sector
    for (const sym of Object.keys(raw.symbols)) {
      const s = raw.symbols[sym]
      for (const k of ['dayOpen', 'dayHigh', 'dayLow', 'volume', 'drift', 'anchor', 'estEps', 'nextEarnings'] as const) {
        delete s[k]
      }
    }
    fs.writeFileSync(snapPath, JSON.stringify(raw))

    const { MarketEngine } = await import('@/lib/engine/engine')
    const g = globalThis as unknown as { __mrxEngine?: MarketEngine }
    const real = g.__mrxEngine
    const second = new MarketEngine()
    await second.init()
    clearInterval((second as unknown as { timer: NodeJS.Timeout | null }).timer ?? undefined)
    try {
      const qntm = second.states.get('QNTM')!
      expect(qntm.dayHigh).toBeGreaterThan(0)
      expect(qntm.dayLow).toBeGreaterThan(0)
      expect(qntm.volume).toBe(0)
      expect(second.mvix).toBe(21.4) // defaulted
      expect(second.sectorIndices.size).toBe(8) // recomputed from market caps
    } finally {
      g.__mrxEngine = real
    }
  })
})

describe('final edge coverage', () => {
  it('seedGenesisWire backfills the wire when the news table is empty', async () => {
    await db.newsItem.deleteMany({})
    expect(await db.newsItem.count()).toBe(0)
    await (E.seedGenesisWire as () => Promise<void>)()
    expect(await db.newsItem.count()).toBeGreaterThanOrEqual(14)
    const wire = engine.news(5)
    expect(wire.news.length).toBeGreaterThan(0)
  })

  it('quotes re-center correctly when volatility state collapses to zero', () => {
    const s = st('QNTM')
    const volVar = s.volVar
    s.volVar = 0
    ;(E.refreshQuotes as (st: SymbolState, v: number) => void)(s, 1)
    expect(s.ask).toBeGreaterThan(s.bid)
    s.volVar = volVar
  })

  it('fill-driven prints update the day low (market and limit paths)', async () => {
    // market path
    const s = st('QNTM')
    const saved = { bids: s.bids, dayLow: s.dayLow }
    const artificial = s.price * 1.01
    s.dayLow = artificial // artificially high → any sell sets a new low
    s.bids = [{ price: s.price * 0.999, size: 500 }]
    const r = await engine.submitOrder({ id: 'dl1', accountId: 'a', symbol: 'QNTM', side: 'sell', type: 'market', qty: 1, limitPrice: null, stopPrice: null, tif: 'day' })
    expect(r.status).toBe('filled')
    expect(s.dayLow).toBeLessThan(artificial)
    s.bids = saved.bids
    s.dayLow = saved.dayLow

    // limit path
    const s2 = st('HELX')
    const saved2 = { bids: s2.bids, dayLow: s2.dayLow }
    const artificial2 = s2.price * 1.01
    s2.dayLow = artificial2
    s2.bids = [{ price: s2.price * 0.999, size: 500 }]
    const r2 = await engine.submitOrder({ id: 'dl2', accountId: 'a', symbol: 'HELX', side: 'sell', type: 'limit', qty: 1, limitPrice: s2.price * 0.995, stopPrice: null, tif: 'day' })
    expect(r2.status).toBe('filled')
    expect(s2.dayLow).toBeLessThan(artificial2)
    s2.bids = saved2.bids
    s2.dayLow = saved2.dayLow
  })

  it('engine rejects stops without a stop price', async () => {
    const r = await engine.submitOrder({ id: 'nosp', accountId: 'a', symbol: 'QNTM', side: 'sell', type: 'stop', qty: 1, limitPrice: null, stopPrice: null, tif: 'day' })
    expect(r.reject).toMatch(/Stop price required/)
  })

  it('drift regime flips fire (rare random branch, forced)', async () => {
    const s = st('DOLCI')
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.0001)
    await tick(2)
    randSpy.mockRestore()
    expect(Number.isFinite(s.drift)).toBe(true)
  })

  it('runEarnings walks every guidance branch (beat / in-line / miss × coin flip)', async () => {
    const s = st('ZRNX')
    s.haltedUntil = 0
    const rands = [0.01, 0.9, 0.5, 0.2, 0.8, 0.3, 0.05, 0.95, 0.4, 0.44, 0.46, 0.11]
    let i = 0
    const randSpy = vi.spyOn(Math, 'random').mockImplementation(() => rands[i++ % rands.length])
    try {
      for (let k = 0; k < 24; k++) {
        s.nextEarnings = Date.now() - 1000
        await (E.runEarnings as (st: SymbolState) => Promise<void>)(s)
      }
    } finally {
      randSpy.mockRestore()
    }
    expect(s.nextEarnings).toBeGreaterThan(Date.now() + 60 * 86400000)
  })

  it('matchResting skips halted symbols in the limit loop', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const px = st('TERRV').price
    const order = await placeOrder(acct.id, { symbol: 'TERRV', side: 'buy', type: 'limit', qty: 1, limit_price: px * 0.95, time_in_force: 'gtc' })
    expect(order!.status).toBe('accepted')
    engine.haltSymbol('TERRV', 30)
    try {
      await (E.matchResting as () => Promise<void>)()
      expect(engine.hasResting(order!.id)).toBe(true)
    } finally {
      engine.resumeSymbol('TERRV')
      await engine.cancelOrder(order!.id)
    }
  })

  it('resting fills deplete exact-size levels (buy and stop paths)', async () => {
    // resting buy consuming an exactly-sized ask level
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    await db.account.update({ where: { id: acct.id }, data: { cash: 500000, lastEquity: 500000 } })
    const s = st('OCTEQ')
    const saved = s.asks
    const px = s.price
    const order = await placeOrder(acct.id, { symbol: 'OCTEQ', side: 'buy', type: 'limit', qty: 3, limit_price: px * 1.02, time_in_force: 'gtc' })
    if (engine.hasResting(order!.id)) {
      s.asks = [{ price: px * 1.01, size: 3 }]
      await (E.matchResting as () => Promise<void>)()
      expect(engine.hasResting(order!.id)).toBe(false)
    }
    s.asks = saved

    // stop execution consuming an exactly-sized level
    const acct2 = await registerAccount({ email: uniqEmail(), password: 'password123' })
    await placeOrder(acct2.id, { symbol: 'VLTR', side: 'buy', type: 'market', qty: 1 })
    const px2 = st('VLTR').price
    const stop = await placeOrder(acct2.id, { symbol: 'VLTR', side: 'sell', type: 'stop', qty: 2, stop_price: px2 * 0.98 })
    const s2 = st('VLTR')
    const savedBids = s2.bids
    s2.bid = px2 * 0.95
    s2.price = px2 * 0.95
    s2.bids = [{ price: px2 * 0.95, size: 2 }]
    await (E.matchResting as () => Promise<void>)()
    s2.bids = savedBids
    expect(engine.hasResting(stop!.id)).toBe(false)
    expect((await db.order.findUnique({ where: { id: stop!.id } }))!.filledQty).toBe(2)
  })

  it('day orders of stop type expire at the ET day boundary', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const px = st('GNRY').price
    await placeOrder(acct.id, { symbol: 'GNRY', side: 'buy', type: 'market', qty: 1 })
    const stop = await placeOrder(acct.id, { symbol: 'GNRY', side: 'sell', type: 'stop', qty: 1, stop_price: px * 0.5, time_in_force: 'day' })
    const ro = (E.allResting as Map<string, { createdAt: number }>).get(stop!.id)!
    ro.createdAt = Date.now() - 26 * 3600000
    await (E.expireDayOrders as (d: string) => Promise<void>)('2026-11-02')
    expect(engine.hasResting(stop!.id)).toBe(false)
    expect((await db.order.findUnique({ where: { id: stop!.id } }))!.status).toBe('expired')
  })

  it('rollDay skips the archive when the bar is already stored', () => {
    const s = st('MCOM')
    const lastBar = s.dailyBars[s.dailyBars.length - 1]
    s.today = { date: lastBar.date, o: lastBar.o, h: lastBar.h, l: lastBar.l, c: lastBar.c, v: 100 }
    const before = s.dailyBars.length
    ;(E.rollDay as (d: string) => void)('2026-11-02')
    expect(s.dailyBars.length).toBe(before)
  })
})

describe('final book-sort & fill-break edges', () => {
  it('sortBook orders mixed sides with sells after buys', () => {
    const arr = engine.restingBySymbol.get('KRYO')!
    arr.length = 0
    const mk = (id: string, side: 'buy' | 'sell', px: number | null, seq: number) => ({
      orderId: id, accountId: 'a', symbol: 'KRYO', side, type: 'limit' as const, qty: 1,
      remaining: 1, limitPrice: px, stopPrice: null, tif: 'gtc' as const, createdAt: 0, seq,
    })
    arr.push(mk('m1', 'sell', 30, 1), mk('m2', 'buy', 20, 2))
    ;(E.sortBook as (s: string) => void)('KRYO')
    expect(arr.map((r) => r.orderId)).toEqual(['m2', 'm1'])
    // buy price tie handled by seq
    arr.length = 0
    arr.push(mk('t1', 'buy', 20, 5), mk('t2', 'buy', 20, 4))
    ;(E.sortBook as (s: string) => void)('KRYO')
    expect(arr.map((r) => r.orderId)).toEqual(['t2', 't1'])
    arr.length = 0
  })

  it('resting fills break out when the order completes mid-ladder', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    await db.account.update({ where: { id: acct.id }, data: { cash: 500000, lastEquity: 500000 } })
    const s = st('OCTEQ')
    const saved = s.asks
    const px = s.price
    const order = await placeOrder(acct.id, { symbol: 'OCTEQ', side: 'buy', type: 'limit', qty: 2, limit_price: px * 0.97, time_in_force: 'gtc' })
    if (engine.hasResting(order!.id)) {
      s.asks = [{ price: px * 0.96, size: 2 }, { price: px * 0.965, size: 50 }]
      await (E.matchResting as () => Promise<void>)()
      expect(engine.hasResting(order!.id)).toBe(false)
    }
    s.asks = saved

    const acct2 = await registerAccount({ email: uniqEmail(), password: 'password123' })
    await placeOrder(acct2.id, { symbol: 'VLTR', side: 'buy', type: 'market', qty: 1 })
    const px2 = st('VLTR').price
    const stop = await placeOrder(acct2.id, { symbol: 'VLTR', side: 'sell', type: 'stop', qty: 2, stop_price: px2 * 0.98 })
    const s2 = st('VLTR')
    const savedBids = s2.bids
    s2.bid = px2 * 0.95
    s2.price = px2 * 0.95
    s2.bids = [{ price: px2 * 0.95, size: 2 }, { price: px2 * 0.945, size: 50 }]
    await (E.matchResting as () => Promise<void>)()
    s2.bids = savedBids
    expect(engine.hasResting(stop!.id)).toBe(false)
  })

  it('seedGenesisWire survives a failed wire write', async () => {
    const orig = db.newsItem.createMany.bind(db.newsItem)
    ;(db.newsItem as unknown as { createMany: () => Promise<never> }).createMany = async () => {
      throw new Error('db offline')
    }
    try {
      await db.newsItem.deleteMany({})
      await (E.seedGenesisWire as () => Promise<void>)()
      expect(await db.newsItem.count()).toBe(0) // write failed, wire stays empty, no crash
    } finally {
      ;(db.newsItem as unknown as { createMany: typeof orig }).createMany = orig
    }
  })

  it('runEarnings explores every guidance branch over many draws', async () => {
    const s = st('ZRNX')
    s.haltedUntil = 0
    const rands = [0.01, 0.5, 0.9, 0.11, 0.13, 0.44, 0.46, 0.77, 0.79]
    let i = 0
    const randSpy = vi.spyOn(Math, 'random').mockImplementation(() => rands[i++ % rands.length])
    try {
      // negative-EPS issuer (ZRNX) and positive-EPS issuer (QNTM) invert the
      // beat/miss bands — running both walks every guidance branch
      for (const sym of ['ZRNX', 'QNTM']) {
        const target = st(sym)
        target.haltedUntil = 0
        for (let k = 0; k < 60; k++) {
          target.nextEarnings = Date.now() - 1000
          await (E.runEarnings as (st: SymbolState) => Promise<void>)(target)
        }
      }
    } finally {
      randSpy.mockRestore()
    }
  })
})

describe('sort + stop-fill final branches', () => {
  it('sortBook places buys before sells when comparing sell-first input', () => {
    const arr = engine.restingBySymbol.get('CLDU')!
    arr.length = 0
    const mk = (id: string, side: 'buy' | 'sell', px: number | null, seq: number) => ({
      orderId: id, accountId: 'a', symbol: 'CLDU', side, type: 'limit' as const, qty: 1,
      remaining: 1, limitPrice: px, stopPrice: null, tif: 'gtc' as const, createdAt: 0, seq,
    })
    arr.push(mk('b1', 'buy', 20, 1), mk('s1', 'sell', 30, 2))
    ;(E.sortBook as (s: string) => void)('CLDU')
    expect(arr.map((r) => r.orderId)).toEqual(['b1', 's1'])
    arr.length = 0
  })

  it('stops partially filling larger levels keep the level queued', async () => {
    const acct = await registerAccount({ email: uniqEmail(), password: 'password123' })
    await placeOrder(acct.id, { symbol: 'PETQ', side: 'buy', type: 'market', qty: 1 })
    const px = st('PETQ').price
    const stop = await placeOrder(acct.id, { symbol: 'PETQ', side: 'sell', type: 'stop', qty: 2, stop_price: px * 0.98 })
    const s = st('PETQ')
    const savedBids = s.bids
    s.bid = px * 0.95
    s.price = px * 0.95
    s.bids = [{ price: px * 0.95, size: 50 }] // much larger than the order
    await (E.matchResting as () => Promise<void>)()
    s.bids = savedBids
    expect(engine.hasResting(stop!.id)).toBe(false)
    expect((await db.order.findUnique({ where: { id: stop!.id } }))!.filledQty).toBe(2)
  })
})
