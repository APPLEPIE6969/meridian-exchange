// Seeded RNG utilities — deterministic simulation primitives.

export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 — fast deterministic PRNG */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Rng {
  private next: () => number

  constructor(seed: number | string) {
    this.next = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed)
  }

  /** uniform [0,1) */
  u(): number {
    return this.next()
  }

  /** uniform [min,max) */
  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  /** standard normal (Box–Muller) */
  gauss(): number {
    let u = 0
    let v = 0
    while (u === 0) u = this.next()
    while (v === 0) v = this.next()
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
  }

  /** N(mu, sigma) */
  norm(mu: number, sigma: number): number {
    return mu + sigma * this.gauss()
  }

  /** lognormal */
  lognorm(mu: number, sigma: number): number {
    return Math.exp(this.norm(mu, sigma))
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  bool(p: number): boolean {
    return this.next() < p
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }

  /** weighted pick: entries [item, weight] */
  weighted<T>(entries: [T, number][]): T {
    const total = entries.reduce((s, e) => s + e[1], 0)
    let r = this.next() * total
    for (const [item, w] of entries) {
      r -= w
      if (r <= 0) return item
    }
    return entries[entries.length - 1][0]
  }
}

/** non-deterministic RNG for live simulation */
export const liveRng = new Rng((Math.random() * 2 ** 31) | 0)

export function gaussLive(): number {
  return liveRng.gauss()
}

export function roundTo(value: number, decimals = 2): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
