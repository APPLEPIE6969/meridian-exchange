// Deterministic RNG primitives — the foundation every simulation path builds on.

import { describe, it, expect } from 'vitest'
import { hashSeed, mulberry32, Rng, liveRng, gaussLive, roundTo, clamp } from '@/lib/engine/rng'

describe('hashSeed', () => {
  it('is deterministic for the same input', () => {
    expect(hashSeed('QNTM')).toBe(hashSeed('QNTM'))
  })

  it('returns an unsigned 32-bit integer', () => {
    for (const s of ['QNTM', 'IRWQ', 'sector:Technology', 'listed:MCOM', '']) {
      const h = hashSeed(s)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
      expect(Number.isInteger(h)).toBe(true)
    }
  })

  it('is sensitive to input (no trivial collisions in the universe)', () => {
    const seeds = new Set(['QNTM', 'VLTR', 'LUMCR', 'KRYO', 'SILVX', 'MRDN', 'AXBK'].map(hashSeed))
    expect(seeds.size).toBe(7)
  })

  it('matches the FNV-1a reference algorithm', () => {
    // hand-computed FNV-1a of "a": h = (2166136261 ^ 97) * 16777619 (mod 2^32)
    const expected = Math.imul((2166136261 ^ 97) >>> 0, 16777619) >>> 0
    expect(hashSeed('a')).toBe(expected)
  })
})

describe('mulberry32', () => {
  it('is deterministic and uniform in [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1)()
    const b = mulberry32(2)()
    expect(a).not.toBe(b)
  })

  it('handles seed 0 without degenerating', () => {
    const g = mulberry32(0)
    const vals = new Set(Array.from({ length: 100 }, () => g()))
    expect(vals.size).toBeGreaterThan(90)
  })
})

describe('Rng', () => {
  it('u() is deterministic and in [0,1)', () => {
    const r1 = new Rng('seed-a')
    const r2 = new Rng('seed-a')
    for (let i = 0; i < 100; i++) {
      const v = r1.u()
      expect(v).toBe(r2.u())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('accepts numeric seeds (string seeds are hashed)', () => {
    expect(new Rng(7).u()).toBe(new Rng(7).u())
    expect(new Rng('x').u()).toBe(new Rng(hashSeed('x')).u())
  })

  it('range() stays within [min,max)', () => {
    const r = new Rng(99)
    for (let i = 0; i < 500; i++) {
      const v = r.range(-3, 5)
      expect(v).toBeGreaterThanOrEqual(-3)
      expect(v).toBeLessThan(5)
    }
  })

  it('gauss() has roughly zero mean and bounded tails', () => {
    const r = new Rng('gauss-dist')
    const n = 20000
    let sum = 0
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < n; i++) {
      const v = r.gauss()
      sum += v
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.05)
    expect(min).toBeGreaterThan(-6)
    expect(max).toBeLessThan(6)
  })

  it('gauss() retries when the uniform draw is exactly zero (Box–Muller log(0) guard)', () => {
    const r = new Rng(1) as unknown as { next: () => number; gauss: () => number }
    let calls = 0
    r.next = () => (calls++ === 0 ? 0 : 0.5)
    const v = r.gauss()
    expect(calls).toBe(3) // u: rejected + accepted, v: accepted
    expect(Number.isFinite(v)).toBe(true)
  })

  it('norm() shifts and scales the normal', () => {
    const r = new Rng('norm-check')
    for (let i = 0; i < 200; i++) {
      const v = r.norm(10, 2)
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(20)
    }
  })

  it('lognorm() is positive', () => {
    const r = new Rng('lognorm-check')
    for (let i = 0; i < 200; i++) expect(r.lognorm(0, 1)).toBeGreaterThan(0)
  })

  it('int() returns integers within [min,max]', () => {
    const r = new Rng('int-check')
    for (let i = 0; i < 500; i++) {
      const v = r.int(2, 5)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(2)
      expect(v).toBeLessThanOrEqual(5)
    }
  })

  it('bool() respects the probability bounds', () => {
    const r = new Rng('bool-check')
    expect(r.bool(1)).toBe(true) // p=1: any u < 1
    expect(r.bool(0)).toBe(false) // p=0: u < 0 impossible
    const trues = Array.from({ length: 200 }, () => r.bool(0.5)).filter(Boolean).length
    expect(trues).toBeGreaterThan(60)
    expect(trues).toBeLessThan(140)
  })

  it('pick() always returns a member of the array', () => {
    const r = new Rng('pick-check')
    const arr = ['a', 'b', 'c'] as const
    for (let i = 0; i < 100; i++) expect(arr).toContain(r.pick(arr))
  })

  it('weighted() honors relative weights', () => {
    const r = new Rng('weighted-check')
    const counts = { a: 0, b: 0 }
    for (let i = 0; i < 2000; i++) {
      const v = r.weighted<'a' | 'b'>([['a', 1], ['b', 3]])
      counts[v]++
    }
    expect(counts.a).toBeGreaterThan(350)
    expect(counts.a).toBeLessThan(650)
    expect(counts.b).toBeGreaterThan(1350)
  })

  it('weighted() with a single entry always returns it', () => {
    const r = new Rng('weighted-one')
    expect(r.weighted([['only', 5]])).toBe('only')
  })

  it('weighted() falls back to the last entry when the draw exceeds the total', () => {
    // Defensive tail: reachable only when next() >= 1 (never via mulberry32,
    // but the branch protects against malformed RNG injection).
    const r = new Rng('weighted-fallback') as unknown as { next: () => number; weighted: (e: [string, number][]) => string }
    r.next = () => 1.5
    expect(r.weighted([['a', 1], ['b', 1]])).toBe('b')
  })
})

describe('helpers', () => {
  it('liveRng and gaussLive produce finite values', () => {
    for (let i = 0; i < 100; i++) expect(Number.isFinite(gaussLive())).toBe(true)
    expect(liveRng).toBeInstanceOf(Rng)
  })

  it('roundTo rounds to the requested precision', () => {
    expect(roundTo(1.005, 2)).toBe(1.0)
    expect(roundTo(Math.PI, 4)).toBe(3.1416)
    expect(roundTo(2.5, 0)).toBe(3)
    expect(roundTo(-1.005, 2)).toBe(-1)
    expect(roundTo(10)).toBe(10)
    expect(roundTo(0.123456, 5)).toBe(0.12346)
  })

  it('clamp() confines values to the range', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-5, 0, 3)).toBe(0)
    expect(clamp(2, 0, 3)).toBe(2)
  })
})
