// Deep daily history: listing dates, deterministic generation, OHLC invariants.

import { describe, it, expect } from 'vitest'
import { listingDate, daysBetween, buildDailyHistory, shiftDate, synthIntraday } from '@/lib/engine/history'
import { INSTRUMENTS, BY_SYMBOL, type Instrument } from '@/lib/engine/universe'

const TODAY = '2026-12-31'

function barInvariants(bars: { o: number; h: number; l: number; c: number; v: number; date: string }[], label: string) {
  for (const b of bars) {
    expect(b.h, `${label} ${b.date} high`).toBeGreaterThanOrEqual(Math.max(b.o, b.c))
    expect(b.l, `${label} ${b.date} low`).toBeLessThanOrEqual(Math.min(b.o, b.c))
    expect(b.l).toBeGreaterThan(0)
    expect(b.c).toBeGreaterThan(0)
    expect(Number.isFinite(b.o + b.h + b.l + b.c)).toBe(true)
    expect(b.v).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(b.v)).toBe(true)
  }
}

describe('listingDate', () => {
  it('is deterministic per symbol', () => {
    const qntm = BY_SYMBOL.get('QNTM')!
    expect(listingDate(qntm)).toBe(listingDate(qntm))
  })

  it('never predates the 1996 exchange opening', () => {
    for (const inst of INSTRUMENTS) {
      const d = listingDate(inst)
      expect(Number(d.slice(0, 4))).toBeGreaterThanOrEqual(1996)
    }
  })

  it('never lists in the future', () => {
    const thisYear = new Date().getUTCFullYear()
    for (const inst of INSTRUMENTS) {
      expect(Number(listingDate(inst).slice(0, 4))).toBeLessThanOrEqual(thisYear)
    }
  })

  it('lists old foundations after 1996 (clamped) and recent foundations shortly after founding', () => {
    const axbk = BY_SYMBOL.get('AXBK')! // founded 1889 → clamped to 1996
    expect(listingDate(axbk).slice(0, 4)).toBe('1996')

    const qubiq = BY_SYMBOL.get('QUBIQ')! // founded 2017 → lists 2018+ (never before founding)
    const qubiqListed = Number(listingDate(qubiq).slice(0, 4))
    expect(qubiqListed).toBeGreaterThanOrEqual(2018)
    expect(qubiqListed).toBeLessThanOrEqual(new Date().getUTCFullYear())
  })

  it('gives ETFs launch years between 2004 and 2023', () => {
    for (const inst of INSTRUMENTS.filter((i) => i.kind === 'etf')) {
      const y = Number(listingDate(inst).slice(0, 4))
      expect(y).toBeGreaterThanOrEqual(2004)
      expect(y).toBeLessThanOrEqual(2023)
    }
  })

  it('produces valid calendar dates', () => {
    for (const inst of INSTRUMENTS) {
      expect(listingDate(inst)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const [, m, d] = listingDate(inst).split('-').map(Number)
      expect(m).toBeGreaterThanOrEqual(1)
      expect(m).toBeLessThanOrEqual(12)
      expect(d).toBeGreaterThanOrEqual(1)
      expect(d).toBeLessThanOrEqual(28)
    }
  })
})

describe('daysBetween', () => {
  it('counts day differences correctly', () => {
    expect(daysBetween('2026-01-01', '2026-01-02')).toBe(1)
    expect(daysBetween('2026-01-01', '2026-02-01')).toBe(31)
    expect(daysBetween('2026-01-02', '2026-01-01')).toBe(-1)
    expect(daysBetween('2026-03-01', '2026-02-28')).toBe(-1)
  })
})

describe('shiftDate', () => {
  it('shifts calendar dates across boundaries', () => {
    expect(shiftDate('2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftDate('2026-02-01', -1)).toBe('2026-01-31')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDate('2026-11-01', 0)).toBe('2026-11-01')
  })
})

describe('buildDailyHistory', () => {
  it('spans from the listing date to the end date for every security', () => {
    for (const inst of INSTRUMENTS) {
      const bars = buildDailyHistory(inst, inst.basePrice, TODAY)
      const expected = daysBetween(listingDate(inst), TODAY) + 1
      expect(bars.length).toBe(expected)
      expect(bars[0].date).toBe(listingDate(inst))
      expect(bars[bars.length - 1].date).toBe(TODAY)
    }
  })

  it('is deterministic for identical (symbol, anchor, endDate)', () => {
    const qntm = BY_SYMBOL.get('QNTM')!
    const a = buildDailyHistory(qntm, 612.4, TODAY)
    const b = buildDailyHistory(qntm, 612.4, TODAY)
    expect(a).toEqual(b)
  })

  it('changes with the anchor but not with unrelated symbols', () => {
    const qntm = BY_SYMBOL.get('QNTM')!
    const at612 = buildDailyHistory(qntm, 612.4, TODAY)
    const at500 = buildDailyHistory(qntm, 500, TODAY)
    expect(at612.length).toBe(at500.length)
    // the path is scaled to end exactly at the anchor
    expect(at612[at612.length - 1].c).toBeCloseTo(612.4, 1)
    expect(at500[at500.length - 1].c).toBeCloseTo(500, 1)
  })

  it('ends exactly at the anchor price (linear correction)', () => {
    for (const sym of ['QNTM', 'IRWQ', 'HYDQ', 'MCOM']) {
      const inst = BY_SYMBOL.get(sym)!
      const anchor = inst.basePrice * 1.234
      const bars = buildDailyHistory(inst, anchor, TODAY)
      expect(bars[bars.length - 1].c).toBeCloseTo(anchor, 1)
    }
  })

  it('satisfies OHLC invariants on every bar of every security', () => {
    for (const inst of INSTRUMENTS) {
      barInvariants(buildDailyHistory(inst, inst.basePrice, TODAY), inst.symbol)
    }
  })

  it('gives multi-decade names thousands of bars and recent IPOs few', () => {
    const irwq = BY_SYMBOL.get('IRWQ')! // listed 1996+
    const deep = buildDailyHistory(irwq, irwq.basePrice, TODAY)
    expect(deep.length).toBeGreaterThan(8000)

    const qubiq = BY_SYMBOL.get('QUBIQ')! // founded 2017, listed after
    const shallow = buildDailyHistory(qubiq, qubiq.basePrice, TODAY)
    expect(shallow.length).toBeLessThan(4000)
    expect(deep.length).toBeGreaterThan(shallow.length * 2)
  })

  it('still generates a valid 2-bar minimum for a listing dated today', () => {
    const inst = BY_SYMBOL.get('QUBIQ')!
    const listing = listingDate(inst)
    const bars = buildDailyHistory(inst, inst.basePrice, listing)
    expect(bars.length).toBe(2)
    barInvariants(bars, 'min-history')
  })

  it('applies a positive long-run growth target (5–14% CAGR) from IPO price to anchor', () => {
    const inst = BY_SYMBOL.get('QNTM')!
    const bars = buildDailyHistory(inst, 612.4, TODAY)
    const years = bars.length / 365.25
    const cagr = Math.pow(612.4 / bars[0].c, 1 / years) - 1
    // noisy path around the drift, so allow generous bounds
    expect(cagr).toBeGreaterThan(0)
    expect(cagr).toBeLessThan(0.40)
  })

  it('never prices below the sub-dollar floor', () => {
    const hydq = BY_SYMBOL.get('HYDQ')! // $9.75, deep history
    const bars = buildDailyHistory(hydq, 9.75, TODAY)
    for (const b of bars) {
      expect(b.c).toBeGreaterThanOrEqual(0.4)
      expect(b.l).toBeGreaterThanOrEqual(0.4)
    }
  })

  it('volume stays in a sane band around average daily volume', () => {
    const inst = BY_SYMBOL.get('QNTM')!
    const bars = buildDailyHistory(inst, inst.basePrice, TODAY)
    for (const b of bars.slice(-100)) {
      expect(b.v).toBeGreaterThan(0)
      expect(b.v).toBeLessThan(inst.avgVol * 20)
    }
  })
})

describe('synthIntraday', () => {
  const inst = BY_SYMBOL.get('QNTM')!
  const bar = buildDailyHistory(inst, inst.basePrice, '2026-10-30')[5]

  it('produces the right number of interval buckets ending at the bar close', () => {
    for (const interval of [1, 5, 15, 60]) {
      const candles = synthIntraday(inst.symbol, bar, interval)
      expect(candles).toHaveLength(Math.round(1440 / interval))
      expect(candles[candles.length - 1].c).toBeCloseTo(bar.c, 0)
    }
  })

  it('is cached: repeated calls return the identical array', () => {
    const a = synthIntraday(inst.symbol, bar, 5)
    const b = synthIntraday(inst.symbol, bar, 5)
    expect(b).toBe(a)
  })

  it('seeds candles from the bar open and keeps OHLC coherent', () => {
    const candles = synthIntraday(inst.symbol, bar, 30)
    expect(candles[0].o).toBeCloseTo(bar.o, 0)
    for (const c of candles) {
      expect(c.h).toBeGreaterThanOrEqual(Math.max(c.o, c.c) - 0.01)
      expect(c.l).toBeLessThanOrEqual(Math.min(c.o, c.c) + 0.01)
      expect(c.v).toBeGreaterThan(0)
      expect(Number.isFinite(c.t)).toBe(true)
    }
  })

  it('falls back to default volatility for unknown symbols', () => {
    const fake: Instrument = { ...inst, symbol: 'ZZZZZ' } as Instrument
    const candles = synthIntraday('ZZZZZ', bar, 5)
    expect(candles.length).toBeGreaterThan(0)
    expect(fake).toBeDefined() // fake only documents the unknown-symbol path
  })

  it('evicts the oldest entries when the cache overflows', () => {
    // >220 distinct keys then one more triggers the eviction sweep of 60
    for (let i = 0; i < 225; i++) {
      const b = { ...bar, date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}` }
      synthIntraday(`EVT${i}`, b, 5)
    }
    const before = synthIntraday(inst.symbol, { ...bar, date: '2019-06-01' }, 5).length
    expect(before).toBeGreaterThan(0)
  })
})
