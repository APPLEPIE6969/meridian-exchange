// Deterministic market history: synthetic daily bars + intraday Brownian-bridge
// reconstruction, anchored to live prices so charts stay consistent across restarts.

import { Rng, hashSeed, clamp } from './rng'
import { Instrument, BY_SYMBOL } from './universe'
import { etDateToUtcMs, roundPx } from './time'

export interface DailyBar {
  date: string // ET date YYYY-MM-DD
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface Candle {
  t: number // epoch ms
  o: number
  h: number
  l: number
  c: number
  v: number
}

// The exchange opened for trading in 1996 — nothing lists before that.
const EXCHANGE_OPEN_YEAR = 1996

/**
 * When the issuer listed on the Meridian Exchange: derived deterministically
 * from the symbol. Operating companies list a few years after their founding;
 * ETFs launched between 2004 and 2023; nothing predates the exchange itself.
 * The daily history of every security runs from this date to today.
 */
export function listingDate(inst: Instrument): string {
  const h = hashSeed('listed:' + inst.symbol)
  let y = inst.kind === 'etf' ? 2004 + (h % 20) : inst.founded + 1 + (h % 14)
  y = Math.max(EXCHANGE_OPEN_YEAR, Math.min(y, new Date().getUTCFullYear()))
  const m = 1 + (h % 12)
  const d = 1 + ((h >>> 4) % 28)
  // Never in the future: if the seeded month/day lands ahead of today within
  // the current year, walk the listing year back one — still after founding
  // (the newest foundation is 2017) and above the 1996 floor.
  if (`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` > new Date().toISOString().slice(0, 10)) {
    y -= 1
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((etDateToUtcMs(toDate) - etDateToUtcMs(fromDate)) / 86400000)
}

/**
 * Build the full synthetic daily history of a security, from its listing date
 * through `endDate` (yesterday), with the final close = anchor. Deterministic
 * for a given (symbol, anchor, endDate): identical on every boot, which is
 * what lets old bars be regenerated while recent real bars persist.
 */
export function buildDailyHistory(inst: Instrument, anchor: number, endDate: string): DailyBar[] {
  const n = Math.max(2, daysBetween(listingDate(inst), endDate) + 1)
  const rets = genReturnStream(inst, n)
  const volDay = inst.volAnn / 100 / Math.sqrt(252)
  const vRng = new Rng('volhist:' + inst.symbol)
  const gapRng = new Rng('gaps:' + inst.symbol)

  // Long-run growth target: the name compounds at a symbol-specific drift from
  // its listing to today, so multi-decade charts show eras, not random noise.
  const years = Math.max(0.5, n / 365.25)
  const cagr = 0.05 + (hashSeed('cagr:' + inst.symbol) % 90) / 1000 // 5%–14% per year
  const targetLog = cagr * years
  const ipoPrice = Math.max(0.5, anchor / Math.exp(targetLog))

  // forward log path, linearly corrected so it ends exactly at `anchor`
  const cum: number[] = [0]
  for (let i = 0; i < n; i++) cum.push(cum[i] + rets[i])
  const drift = (targetLog - cum[n]) / n
  const closes: number[] = []
  for (let i = 1; i <= n; i++) closes.push(ipoPrice * Math.exp(cum[i] + drift * i))

  const bars: DailyBar[] = []
  for (let i = 0; i < n; i++) {
    const c = closes[i]
    const prevC = i === 0 ? ipoPrice : closes[i - 1]
    const gap = Math.exp(gapRng.norm(0, volDay * 0.35))
    const o = prevC * gap
    const range1 = Math.abs(vRng.gauss()) * volDay * 0.85 + volDay * 0.25
    const skew = vRng.gauss() * volDay * 0.4
    // floor o/c first, then derive h/l — guarantees h ≥ max(o, c) ≥ l even in
    // the sub-dollar tail of very old bars
    const oF = Math.max(0.5, o)
    const cF = Math.max(0.4, c)
    const h = Math.max(oF, cF) * (1 + range1 * 0.6) + skew * cF
    const l = Math.min(oF, cF) * (1 - range1 * 0.6) + skew * cF
    const v = Math.round(inst.avgVol * vRng.lognorm(0, 0.42) * (0.75 + 0.5 * Math.abs(rets[i]) / (volDay + 1e-9)))
    const date = shiftDate(endDate, -(n - 1 - i))
    bars.push({
      date,
      o: roundPx(oF),
      h: roundPx(Math.max(h, oF, cF)),
      l: roundPx(Math.max(0.4, Math.min(l, oF, cF))),
      c: roundPx(cF),
      v,
    })
  }
  return bars
}
// Fixed seed streams so the *shape* of history is identical every boot.
const MARKET_SEED = 777001
const sectorSeeds = new Map<string, number>()

function sectorSeed(sector: string): number {
  let s = sectorSeeds.get(sector)
  if (s === undefined) {
    s = hashSeed('sector:' + sector) % 100000
    sectorSeeds.set(sector, s)
  }
  return s
}

/** generate N daily returns from common market + sector + idiosyncratic streams */
function genReturnStream(inst: Instrument, n: number): number[] {
  const mRng = new Rng(MARKET_SEED)
  const sRng = new Rng(sectorSeed(inst.sector))
  const iRng = new Rng('idio:' + inst.symbol)
  // burn streams up to a symbol-specific offset so streams decorrelate
  const burn = hashSeed('burn:' + inst.symbol) % 64
  for (let k = 0; k < burn; k++) {
    mRng.gauss()
    sRng.gauss()
  }
  const mVol = 0.011
  const sVol = 0.013
  const iVol = (inst.volAnn / 100) / Math.sqrt(252) * 0.85
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const r = 0.00032 + inst.beta * 0.9 * mVol * mRng.gauss() + 0.55 * sVol * sRng.gauss() + iVol * iRng.gauss()
    out.push(r)
  }
  return out
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12))
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

// ─── Intraday synthesis (past days) ─────────────────────────────────────────

const intradayCache = new Map<string, Candle[]>()

/**
 * Synthesize intraday candles for a completed daily bar via a seeded
 * Brownian bridge between open and close.
 */
export function synthIntraday(symbol: string, bar: DailyBar, intervalMin: number): Candle[] {
  const key = `${symbol}|${bar.date}|${intervalMin}`
  const hit = intradayCache.get(key)
  if (hit) return hit

  const steps = Math.round(1440 / intervalMin)
  const rng = new Rng(`bridge:${symbol}:${bar.date}:${Math.round(intervalMin)}`)
  const inst = BY_SYMBOL.get(symbol)
  const dayVol = inst ? clamp((bar.h - bar.l) / Math.max(bar.o, 0.01), 0.002, 0.12) : 0.02
  const stepVol = dayVol / Math.sqrt(steps) * 1.15

  // random walk
  const xs: number[] = [0]
  let x = 0
  for (let i = 1; i <= steps; i++) {
    x += rng.gauss() * stepVol
    xs.push(x)
  }
  // bridge so the path ends exactly at close
  const endX = Math.log(bar.c / bar.o)
  const drift = xs[steps] - endX
  const candles: Candle[] = []
  const baseMs = etDateToUtcMs(bar.date)
  const stepMs = intervalMin * 60000
  const volPerBar = bar.v / steps

  for (let i = 0; i < steps; i++) {
    const x0 = xs[i] - (i / steps) * drift
    const x1 = xs[i + 1] - ((i + 1) / steps) * drift
    const p0 = bar.o * Math.exp(x0)
    const p1 = bar.o * Math.exp(x1)
    const wig = rng.gauss() * stepVol * 0.35
    const hi = Math.max(p0, p1) * (1 + Math.abs(wig))
    const lo = Math.min(p0, p1) * (1 - Math.abs(wig))
    // U-shaped volume
    const minuteOfDay = i * intervalMin
    const u = 0.7 + 1.3 * Math.exp(-Math.pow(minuteOfDay / 90, 2)) + 1.1 * Math.exp(-Math.pow((1440 - minuteOfDay) / 120, 2))
    const v = Math.max(1, Math.round(volPerBar * u * rng.lognorm(0, 0.5)))
    candles.push({
      t: baseMs + i * stepMs,
      o: roundPx(p0),
      h: roundPx(hi),
      l: roundPx(lo),
      c: roundPx(p1),
      v,
    })
  }
  if (intradayCache.size > 220) {
    // evict oldest entries
    const keys = intradayCache.keys()
    for (let i = 0; i < 60; i++) {
      const k = keys.next()
      // v8 ignore next — only reachable if the cache held fewer than 60
      // entries, impossible behind the >220 overflow guard
      /* v8 ignore next */
      if (k.done) break
      intradayCache.delete(k.value)
    }
  }
  intradayCache.set(key, candles)
  return candles
}
