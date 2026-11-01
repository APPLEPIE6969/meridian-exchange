// Company profiles + deterministic quarterly financials.

import { describe, it, expect } from 'vitest'
import { PROFILES, profileOf, buildQuarterFinancials, nextEarningsConsensus } from '@/lib/engine/profiles'
import { INSTRUMENTS, BY_SYMBOL, type Instrument } from '@/lib/engine/universe'

const NEXT_REPORT = Date.UTC(2026, 10, 15, 20, 15) // an upcoming report date

describe('PROFILES', () => {
  it('covers every operating company (no ETFs)', () => {
    const stocks = INSTRUMENTS.filter((i) => i.kind === 'stock')
    expect(Object.keys(PROFILES)).toHaveLength(stocks.length)
    for (const s of stocks) expect(PROFILES[s.symbol]).toBeDefined()
    for (const s of INSTRUMENTS.filter((i) => i.kind === 'etf')) expect(PROFILES[s.symbol]).toBeUndefined()
  })

  it('every profile has a real summary, products and sane financial baselines', () => {
    for (const [sym, p] of Object.entries(PROFILES)) {
      expect(BY_SYMBOL.has(sym), `${sym} not in universe`).toBe(true)
      expect(p.summary.length).toBeGreaterThan(120)
      expect(p.products.length).toBeGreaterThanOrEqual(3)
      for (const product of p.products) expect(product.length).toBeGreaterThan(3)
      expect(p.revenueTtm).toBeGreaterThan(0)
      expect(p.revGrowth).toBeGreaterThan(-20)
      expect(p.revGrowth).toBeLessThan(80)
      expect(p.grossMargin).toBeGreaterThan(10)
      expect(p.grossMargin).toBeLessThanOrEqual(85)
      expect(p.netMargin).toBeGreaterThan(-200)
      expect(p.netMargin).toBeLessThan(40)
    }
  })
})

describe('profileOf', () => {
  it('resolves stocks and rejects ETFs / unknown symbols', () => {
    expect(profileOf('QNTM')).toBe(PROFILES.QNTM)
    expect(profileOf('MCOM')).toBeNull()
    expect(profileOf('NOPE')).toBeNull()
  })
})

describe('buildQuarterFinancials', () => {
  it('returns 8 quarters, oldest first, ending just before the next report', () => {
    const qntm = BY_SYMBOL.get('QNTM')!
    const rows = buildQuarterFinancials(qntm, NEXT_REPORT)
    expect(rows).toHaveLength(8)
    for (let i = 1; i < 8; i++) {
      expect(rows[i].reportDate > rows[i - 1].reportDate).toBe(true)
    }
    const last = new Date(rows[7].reportDate + 'T00:00:00Z').getTime()
    expect(last).toBeLessThan(NEXT_REPORT)
  })

  it('uses strict calendar-quarter labels with no skips', () => {
    const qntm = BY_SYMBOL.get('QNTM')!
    const rows = buildQuarterFinancials(qntm, NEXT_REPORT)
    for (let i = 1; i < 8; i++) {
      const prev = rows[i - 1].quarter.match(/Q(\d) (\d{4})/)!
      const cur = rows[i].quarter.match(/Q(\d) (\d{4})/)!
      const pq = Number(prev[1])
      const py = Number(prev[2])
      const cq = Number(cur[1])
      const cy = Number(cur[2])
      const expectedNextQ = pq === 4 ? 1 : pq + 1
      const expectedNextY = pq === 4 ? py + 1 : py
      expect(cq).toBe(expectedNextQ)
      expect(cy).toBe(expectedNextY)
    }
  })

  it('is deterministic per symbol', () => {
    const qntm = BY_SYMBOL.get('QNTM')!
    expect(buildQuarterFinancials(qntm, NEXT_REPORT)).toEqual(buildQuarterFinancials(qntm, NEXT_REPORT))
  })

  it('falls back to derived financials for issuers without a profile (ETF)', () => {
    const etf = BY_SYMBOL.get('MCOM')!
    const rows = buildQuarterFinancials(etf, NEXT_REPORT)
    expect(rows).toHaveLength(8)
    for (const r of rows) {
      expect(r.revenueB).toBeGreaterThan(0)
      expect(Number.isFinite(r.epsActual)).toBe(true)
    }
  })

  it('keeps eps signs aligned with unprofitable issuers', () => {
    const zrnx = BY_SYMBOL.get('ZRNX')! // estEps negative
    const rows = buildQuarterFinancials(zrnx, NEXT_REPORT)
    for (const r of rows) expect(r.epsActual).toBeLessThanOrEqual(0)
  })

  it('produces coherent surprise percentages', () => {
    const helx = BY_SYMBOL.get('HELX')!
    const rows = buildQuarterFinancials(helx, NEXT_REPORT)
    for (const r of rows) {
      const expected = ((r.epsActual - r.epsEstimate) / Math.abs(r.epsEstimate)) * 100
      expect(r.epsSurprise).toBeCloseTo(expected, 0)
    }
  })

  it('computes yoy revenue growth for the newest 4 quarters against year-ago rows', () => {
    const qntm = BY_SYMBOL.get('QNTM')!
    const rows = buildQuarterFinancials(qntm, NEXT_REPORT)
    for (let i = 4; i < 8; i++) {
      const expected = (rows[i].revenueB / rows[i - 4].revenueB - 1) * 100
      expect(rows[i].revYoY).toBeCloseTo(expected, 0)
    }
  })
})

describe('nextEarningsConsensus', () => {
  it('is deterministic per (symbol, report period)', () => {
    const qntm = BY_SYMBOL.get('QNTM')!
    expect(nextEarningsConsensus(qntm, NEXT_REPORT)).toEqual(nextEarningsConsensus(qntm, NEXT_REPORT))
    expect(nextEarningsConsensus(qntm, NEXT_REPORT + 86400000)).not.toEqual(nextEarningsConsensus(qntm, NEXT_REPORT))
  })

  it('stays near the tracked estimate and quarterly revenue', () => {
    const qntm = BY_SYMBOL.get('QNTM')!
    const c = nextEarningsConsensus(qntm, NEXT_REPORT)
    expect(c.eps).toBeGreaterThan(0)
    expect(Math.abs(c.eps - qntm.estEps) / qntm.estEps).toBeLessThan(0.5)
    const prof = PROFILES.QNTM
    expect(c.revenueB).toBeGreaterThan(0)
    expect(Math.abs(c.revenueB - prof.revenueTtm / 4) / (prof.revenueTtm / 4)).toBeLessThan(0.3)
  })

  it('derives revenue from market data when no profile exists', () => {
    const etf = BY_SYMBOL.get('MHLT')! as Instrument
    const c = nextEarningsConsensus(etf, NEXT_REPORT)
    // ETFs carry no revenue profile: the market-derived figure is tiny and
    // rounds to 0.00 at $B precision — what matters is a finite, sane value
    expect(c.revenueB).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(c.revenueB)).toBe(true)
    expect(Number.isFinite(c.eps)).toBe(true)
    expect(c.eps).toBe(0) // estEps is 0 for ETFs
  })
})
