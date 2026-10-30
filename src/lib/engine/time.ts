// ET (America/New_York) time helpers — the MRX clock.
// MRX is a 24/7 exchange: four sessions per ET calendar day.

const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export interface EtTime {
  date: string // YYYY-MM-DD (ET trading date)
  minutes: number // minutes since ET midnight
  hour: number
  minute: number
  second: number
  weekday: string
}

export function etNow(ts: number = Date.now()): EtTime {
  const parts = etFormatter.formatToParts(new Date(ts))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const year = get('year')
  const month = get('month')
  const day = get('day')
  let hour = get('hour')
  if (hour === 24) hour = 0
  const minute = get('minute')
  const second = get('second')
  const weekdayName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
  }).format(new Date(ts))
  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    minutes: hour * 60 + minute,
    hour,
    minute,
    second,
    weekday: weekdayName,
  }
}

export type Session = 'pre_market' | 'regular' | 'post_market' | 'overnight'

export function sessionOf(minutes: number): Session {
  if (minutes >= 240 && minutes < 570) return 'pre_market' // 04:00–09:30
  if (minutes >= 570 && minutes < 960) return 'regular' // 09:30–16:00
  if (minutes >= 960 && minutes < 1200) return 'post_market' // 16:00–20:00
  return 'overnight'
}

export const SESSION_LABEL: Record<Session, string> = {
  pre_market: 'Pre-Market',
  regular: 'Regular Session',
  post_market: 'Post-Market',
  overnight: 'Overnight Session',
}

/** volatility multiplier by session (regular baseline 1.0) */
export function sessionVolMult(minutes: number): number {
  const s = sessionOf(minutes)
  let m = 1
  if (s === 'pre_market' || s === 'post_market') m = 0.55
  else if (s === 'overnight') m = 0.32
  else {
    // regular session: U-shaped intraday volatility
    const t = minutes - 570 // minutes since open
    const openSpike = 1.9 * Math.exp(-Math.pow(t / 35, 2))
    const closeSpike = 1.55 * Math.exp(-Math.pow((390 - t) / 45, 2))
    m = 0.72 + openSpike + closeSpike
  }
  return m
}

/** volume accrual multiplier by session */
export function sessionVolNumMult(minutes: number): number {
  const s = sessionOf(minutes)
  let m = 1
  if (s === 'pre_market' || s === 'post_market') m = 0.12
  else if (s === 'overnight') m = 0.045
  else {
    const t = minutes - 570
    const openSpike = 2.4 * Math.exp(-Math.pow(t / 40, 2))
    const closeSpike = 2.1 * Math.exp(-Math.pow((390 - t) / 50, 2))
    m = 0.75 + openSpike + closeSpike
  }
  return m
}

/** tick size per price level (Reg NMS style) */
export function tickSize(price: number): number {
  return price < 1 ? 0.001 : 0.01
}

export function roundPx(price: number): number {
  const t = tickSize(price)
  return Math.round(price / t) * t
}

export function dateShiftUtcMidnight(etDate: string, days: number): string {
  // ET date arithmetic via UTC-anchored noon timestamps (safe across DST)
  const [y, m, d] = etDate.split('-').map(Number)
  const base = Date.UTC(y, m - 1, d, 12, 0, 0)
  const shifted = new Date(base + days * 86400000)
  const yy = shifted.getUTCFullYear()
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(shifted.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export function etDateToUtcMs(etDate: string): number {
  // Midday-anchored epoch for an ET date (bucket key use)
  const [y, m, d] = etDate.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 17, 0, 0) // 17:00 UTC ≈ noon ET (approx, DST-aware enough for bucketing)
}
