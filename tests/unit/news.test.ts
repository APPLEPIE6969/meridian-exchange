// News wire generators: every kind, every branch, deterministic shaping.

import { describe, it, expect } from 'vitest'
import { generateRandomEvent, makeEarningsNews, makeHaltNews, type GeneratedNews } from '@/lib/engine/news'
import { INSTRUMENTS, BY_SYMBOL, type Instrument } from '@/lib/engine/universe'
import { Rng } from '@/lib/engine/rng'

const KINDS = ['analyst', 'product', 'guidance', 'regulatory', 'ma', 'insider', 'capital', 'macro', 'legal', 'color', 'halt', 'earnings']

const stocks = INSTRUMENTS.filter((i) => i.kind === 'stock')
const byCap = [...stocks].sort((a, b) => b.shares * b.basePrice - a.shares * a.basePrice)

function generateN(n: number, seed: string): GeneratedNews[] {
  const rng = new Rng(seed)
  const out: GeneratedNews[] = []
  for (let i = 0; i < n; i++) out.push(generateRandomEvent(rng, byCap))
  return out
}

function assertShape(n: ReturnType<typeof generateRandomEvent>) {
  expect(typeof n.headline).toBe('string')
  expect(n.headline.length).toBeGreaterThan(10)
  expect(typeof n.body).toBe('string')
  expect(n.body.length).toBeGreaterThan(40)
  expect(n.source.length).toBeGreaterThan(3)
  expect(KINDS).toContain(n.kind)
  expect(Array.isArray(n.symbols)).toBe(true)
  expect(n.symbols.length).toBeGreaterThan(0)
  for (const s of n.symbols) {
    if (s !== '*' && !s.startsWith('@')) expect(BY_SYMBOL.has(s)).toBe(true)
  }
  expect(n.sentiment).toBeGreaterThanOrEqual(-1)
  expect(n.sentiment).toBeLessThanOrEqual(1)
  expect(Number.isInteger(n.impactBps)).toBe(true)
  expect(Math.abs(n.impactBps)).toBeLessThanOrEqual(1800)
}

describe('generateRandomEvent', () => {
  it('is deterministic for a given seed sequence', () => {
    const a = generateN(50, 'determinism-check')
    const b = generateN(50, 'determinism-check')
    expect(a).toEqual(b)
  })

  it('produces schema-valid output across a large deterministic sample', () => {
    for (const n of generateN(3000, 'shape-check')) assertShape(n)
  })

  it('eventually emits every news kind (weighted coverage)', () => {
    const seen = new Set<string>(generateN(3000, 'kind-coverage').map((n) => n.kind))
    for (const k of ['analyst', 'product', 'guidance', 'regulatory', 'ma', 'insider', 'capital', 'macro', 'legal', 'color'] as string[]) {
      expect(seen.has(k), `missing kind: ${k}`).toBe(true)
    }
  })

  it('caps larger caps into the news more often than small caps', () => {
    const events = generateN(3000, 'cap-bias')
    const big = byCap.slice(0, 8).map((i) => i.symbol)
    const small = byCap.slice(-8).map((i) => i.symbol)
    const bigCount = events.filter((e) => e.symbols.some((s) => big.includes(s))).length
    const smallCount = events.filter((e) => e.symbols.some((s) => small.includes(s))).length
    expect(bigCount).toBeGreaterThan(smallCount)
  })

  it('handles a single-symbol candidate list', () => {
    const rng = new Rng('single')
    for (let i = 0; i < 50; i++) {
      const n = generateRandomEvent(rng, [byCap[0]])
      if (n.kind !== 'macro' && n.kind !== 'color') assertShape(n)
    }
  })
})

describe('analyst news content', () => {
  it('mentions the symbol, a firm, and ratings on upgrades', () => {
    const events = generateN(3000, 'analyst-content').filter((n) => n.kind === 'analyst')
    expect(events.length).toBeGreaterThan(200)
    const up = events.find((n) => /Upgrades/.test(n.headline))!
    expect(up.sentiment).toBeGreaterThan(0)
    const down = events.find((n) => /Downgrades/.test(n.headline))!
    expect(down.sentiment).toBeLessThan(0)
    const init = events.find((n) => /Initiates/.test(n.headline))!
    expect(init.headline).toMatch(/\$\d+/)
    for (const n of events.slice(0, 50)) expect(n.body).toMatch(/\$/)
  })

  it('signs impactBps with sentiment for analyst actions', () => {
    const events = generateN(3000, 'analyst-sign').filter((n) => n.kind === 'analyst')
    for (const n of events) expect(Math.sign(n.impactBps)).toBe(Math.sign(n.sentiment))
  })
})

describe('product / guidance / regulatory / capital / legal / insider / ma', () => {
  it('guidance raises are positive, cuts negative, with material impact', () => {
    const events = generateN(4000, 'guidance-check').filter((n) => n.kind === 'guidance')
    const raise = events.find((n) => /Raises/.test(n.headline))!
    const cut = events.find((n) => /Cuts/.test(n.headline))!
    expect(raise.sentiment).toBeGreaterThan(0.4)
    expect(cut.sentiment).toBeLessThan(-0.4)
    expect(Math.abs(cut.impactBps)).toBeGreaterThan(200)
  })

  it('regulatory good news and reviews both occur with signed impact', () => {
    const events = generateN(4000, 'reg-check').filter((n) => n.kind === 'regulatory')
    const good = events.find((n) => /Clears Key Regulatory/.test(n.headline))!
    expect(good.sentiment).toBeGreaterThan(0)
    const bad = events.find((n) => /Open Review Into/.test(n.headline))!
    expect(bad.sentiment).toBeLessThan(0)
  })

  it('M&A takeover chatter carries a premium and strong positive impact', () => {
    const events = generateN(4000, 'ma-check').filter((n) => n.kind === 'ma')
    expect(events.length).toBeGreaterThan(50)
    for (const n of events.slice(0, 20)) {
      expect(n.headline).toMatch(/Premium|premium/)
      expect(n.impactBps).toBeGreaterThan(300)
      expect(n.sentiment).toBeGreaterThan(0.5)
    }
  })

  it('insider Form-4 filings come in buy and sell flavors', () => {
    const events = generateN(4000, 'insider-check').filter((n) => n.kind === 'insider')
    expect(events.some((n) => n.headline.includes('Buys'))).toBe(true)
    expect(events.some((n) => n.headline.includes('Sells'))).toBe(true)
  })

  it('capital markets actions include buybacks, dividends, and bond offerings', () => {
    const events = generateN(4000, 'capital-check').filter((n) => n.kind === 'capital')
    expect(events.some((n) => /Repurchase/.test(n.headline))).toBe(true)
    expect(events.some((n) => /Dividend/.test(n.headline))).toBe(true)
    expect(events.some((n) => /Senior Notes/.test(n.headline))).toBe(true)
  })

  it('legal verdicts occur on both sides', () => {
    const events = generateN(4000, 'legal-check').filter((n) => n.kind === 'legal')
    expect(events.some((n) => /Prevails/.test(n.headline))).toBe(true)
    expect(events.some((n) => /Awards/.test(n.headline))).toBe(true)
  })

  it('product news includes contracts, launches, partnerships and adoption', () => {
    const events = generateN(4000, 'product-check').filter((n) => n.kind === 'product')
    expect(events.some((n) => /Contract With/.test(n.headline))).toBe(true)
    expect(events.some((n) => /Unveils/.test(n.headline))).toBe(true)
    expect(events.some((n) => /Partnership/.test(n.headline))).toBe(true)
    expect(events.some((n) => /Adoption Metrics/.test(n.headline))).toBe(true)
    // partnership items reference a real partner symbol
    const withPartner = events.find((n) => n.symbols.length === 2)!
    expect(BY_SYMBOL.has(withPartner.symbols[1])).toBe(true)
  })
})

describe('macro & color news', () => {
  it('macro items hit the whole market (*)', () => {
    const events = generateN(4000, 'macro-check').filter((n) => n.kind === 'macro')
    expect(events.length).toBeGreaterThan(100)
    for (const n of events.slice(0, 30)) expect(n.symbols).toEqual(['*'])
  })

  it('color items tag sectors with @Sector or hit the whole market', () => {
    const events = generateN(4000, 'color-check').filter((n) => n.kind === 'color')
    expect(events.length).toBeGreaterThan(50)
    for (const n of events.slice(0, 30)) {
      for (const s of n.symbols) expect(s === '*' || s.startsWith('@')).toBe(true)
    }
  })
})

describe('makeEarningsNews', () => {
  const inst = BY_SYMBOL.get('QNTM')!

  it('shapes a beat with positive sentiment and impact', () => {
    const n = makeEarningsNews(inst, 9.5, 8.85, 3.5, true)
    expect(n.kind).toBe('earnings')
    expect(n.headline).toContain('Beats')
    expect(n.sentiment).toBeGreaterThan(0)
    expect(n.impactBps).toBeGreaterThan(0)
    expect(n.symbols).toEqual(['QNTM'])
    expect(n.body).toContain('above-consensus guidance')
  })

  it('shapes a miss with negative sentiment and a premarket-slide headline', () => {
    const n = makeEarningsNews(inst, 7.1, 8.85, -4.2, false)
    expect(n.headline).toContain('Misses')
    expect(n.headline).toContain('Shares Slide Premarket')
    expect(n.sentiment).toBeLessThan(0)
    expect(n.impactBps).toBeLessThan(0)
    expect(n.body).toContain('guidance below consensus')
  })

  it('handles zero estimates without dividing by zero', () => {
    const n = makeEarningsNews(inst, 0.12, 0, 0, null)
    expect(Number.isFinite(n.sentiment)).toBe(true)
    expect(Number.isFinite(n.impactBps)).toBe(true)
    expect(n.body).toContain('in-line guidance')
  })

  it('formats losses in accounting parentheses', () => {
    const n = makeEarningsNews(inst, -0.42, -0.2, -1, null)
    expect(n.headline).toContain('($0.42)')
    expect(n.body).toContain('($0.42)')
  })

  it('clamps sentiment and impact to sane broker-grade bounds', () => {
    const huge = makeEarningsNews(inst, 100, 0.01, 400, true)
    expect(huge.sentiment).toBeLessThanOrEqual(0.95)
    expect(Math.abs(huge.impactBps)).toBeLessThanOrEqual(1800)
    const disaster = makeEarningsNews(inst, -5, 2, -100, false)
    expect(disaster.sentiment).toBeGreaterThanOrEqual(-0.95)
  })

  it('labels revenue beats, misses and inline correctly', () => {
    expect(makeEarningsNews(inst, 9, 8.85, 2.0, null).body).toContain('above expectations')
    expect(makeEarningsNews(inst, 9, 8.85, -2.0, null).body).toContain('below expectations')
    expect(makeEarningsNews(inst, 9, 8.85, 0.2, null).body).toContain('in line with expectations')
  })
})

describe('makeHaltNews', () => {
  it('describes the LULD pause with zero sentiment', () => {
    const n = makeHaltNews('QNTM', 'Volatility Trading Pause (LULD)')
    expect(n.kind).toBe('halt')
    expect(n.headline).toContain('MRX Halts Trading in QNTM')
    expect(n.symbols).toEqual(['QNTM'])
    expect(n.sentiment).toBe(0)
    expect(n.impactBps).toBe(0)
    expect(n.source).toBe('MRX Newsroom')
  })
})
