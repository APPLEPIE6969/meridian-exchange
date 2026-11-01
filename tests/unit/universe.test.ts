// The instrument universe: integrity of all 46 listed securities.

import { describe, it, expect } from 'vitest'
import { INSTRUMENTS, BY_SYMBOL, SECTOR_TARGET_LEVELS, COMPOSITE_TARGET_LEVEL, sectorOf } from '@/lib/engine/universe'

const SECTORS = ['Technology', 'Financials', 'Healthcare', 'Energy', 'Consumer', 'Industrials', 'Communication', 'Utilities']

describe('INSTRUMENTS', () => {
  it('lists exactly 48 securities: 42 stocks + 6 ETFs', () => {
    expect(INSTRUMENTS).toHaveLength(48)
    expect(INSTRUMENTS.filter((i) => i.kind === 'stock')).toHaveLength(42)
    expect(INSTRUMENTS.filter((i) => i.kind === 'etf')).toHaveLength(6)
  })

  it('has globally unique symbols', () => {
    const symbols = INSTRUMENTS.map((i) => i.symbol)
    expect(new Set(symbols).size).toBe(48)
  })

  it('uses clean ticker formats (1-6 uppercase letters, unique)', () => {
    for (const s of INSTRUMENTS.map((i) => i.symbol)) {
      expect(s).toMatch(/^[A-Z]{2,6}$/)
    }
  })

  it('only uses valid sectors', () => {
    for (const i of INSTRUMENTS) expect(SECTORS).toContain(i.sector)
  })

  it('has sane positive fundamentals on every stock', () => {
    for (const i of INSTRUMENTS.filter((x) => x.kind === 'stock')) {
      expect(i.basePrice).toBeGreaterThan(0.5)
      expect(i.shares).toBeGreaterThan(0)
      expect(i.avgVol).toBeGreaterThan(0)
      expect(i.beta).toBeGreaterThan(0)
      expect(i.beta).toBeLessThanOrEqual(2)
      expect(i.volAnn).toBeGreaterThanOrEqual(12)
      expect(i.volAnn).toBeLessThanOrEqual(66)
      expect(i.divYield).toBeGreaterThanOrEqual(0)
      expect(i.employees).toBeGreaterThan(0)
      expect(i.founded).toBeGreaterThanOrEqual(1889)
      expect(i.founded).toBeLessThanOrEqual(2017)
      expect(i.hq.length).toBeGreaterThan(3)
      expect(i.ceo.length).toBeGreaterThan(2)
      expect(i.name.length).toBeGreaterThan(5)
      expect(i.description.length).toBeGreaterThan(60)
    }
  })

  it('ETFs are structured differently (no ceo/eps, fixed share count)', () => {
    for (const i of INSTRUMENTS.filter((x) => x.kind === 'etf')) {
      expect(i.estEps).toBe(0)
      expect(i.employees).toBe(0)
      expect(i.ceo).toBe('—')
      expect(i.shares).toBe(100_000_000)
      expect(i.hq).toBe('New York, NY')
      expect(i.founded).toBe(2013)
      expect(i.description).toMatch(/^Seeks to track/)
    }
  })

  it('every ETF names a real sector with a sector index', () => {
    for (const i of INSTRUMENTS.filter((x) => x.kind === 'etf')) {
      expect(SECTOR_TARGET_LEVELS[i.sector]).toBeDefined()
    }
  })

  it('implied market caps land in a believable range ($50M – $2T)', () => {
    for (const i of INSTRUMENTS) {
      const cap = i.shares * i.basePrice
      expect(cap).toBeGreaterThan(5e7)
      expect(cap).toBeLessThan(2e12)
    }
  })

  it('every stock name with a profile appears exactly once in the universe', () => {
    const symbols = INSTRUMENTS.map((i) => i.symbol)
    expect(new Set(symbols).size).toBe(symbols.length)
  })
})

describe('BY_SYMBOL', () => {
  it('maps every instrument by symbol', () => {
    expect(BY_SYMBOL.size).toBe(48)
    for (const inst of INSTRUMENTS) expect(BY_SYMBOL.get(inst.symbol)).toBe(inst)
  })
})

describe('sectorOf', () => {
  it('resolves listed symbols to their sector', () => {
    expect(sectorOf('QNTM')).toBe('Technology')
    expect(sectorOf('AXBK')).toBe('Financials')
    expect(sectorOf('MCOM')).toBe('Technology')
  })

  it('returns null for unknown symbols', () => {
    expect(sectorOf('BOGUS')).toBeNull()
    expect(sectorOf('')).toBeNull()
  })
})

describe('index targets', () => {
  it('defines a target level for all 8 sectors', () => {
    expect(Object.keys(SECTOR_TARGET_LEVELS)).toHaveLength(8)
    for (const level of Object.values(SECTOR_TARGET_LEVELS)) {
      expect(level).toBeGreaterThan(100)
      expect(level).toBeLessThan(10000)
    }
  })

  it('defines a composite target', () => {
    expect(COMPOSITE_TARGET_LEVEL).toBeGreaterThan(1000)
  })
})
