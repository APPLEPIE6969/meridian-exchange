import { NextRequest } from 'next/server'
import { ok, fail, preflight, rateLimitResponse, clientKey, errorResponse } from '@/lib/api/respond'
import { getEngineReady } from '@/lib/engine'

export const dynamic = 'force-dynamic'

const INTERVALS: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '1d': 1440 }

export async function GET(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const engine = await getEngineReady()
    const url = new URL(req.url)
    const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase()
    if (!symbol) return fail(422, 'SYMBOL_REQUIRED', 'symbol query parameter is required.')
    if (!engine.quote(symbol)) return fail(404, 'SYMBOL_NOT_FOUND', `No security found for symbol '${symbol}'.`)

    const interval = url.searchParams.get('interval') ?? '5m'
    if (!INTERVALS[interval]) {
      return fail(422, 'INVALID_INTERVAL', "interval must be one of: 1m, 5m, 15m, 1h, 1d")
    }

    const now = Date.now()
    let start = Number(url.searchParams.get('start') ?? 0)
    let end = Number(url.searchParams.get('end') ?? now)
    const range = url.searchParams.get('range')
    const rangeMs: Record<string, number> = { '1D': 86400000, '5D': 5 * 86400000, '1M': 30 * 86400000, '3M': 90 * 86400000, '6M': 182 * 86400000, '1A': 365 * 86400000 }
    if (range && rangeMs[range]) {
      start = now - rangeMs[range]
      end = now
    }
    if (interval === '1d' && !start) start = now - 365 * 86400000
    if (!start) start = now - 5 * 86400000
    if (!end || end > now + 60000) end = now
    if (end <= start) return fail(422, 'INVALID_RANGE', 'end must be greater than start.')

    const limit = Math.min(2000, Math.max(10, Number(url.searchParams.get('limit') ?? 900)))
    const bars = engine.getCandles(symbol, interval as '1m' | '5m' | '15m' | '1h' | '1d', start, end, limit)
    return ok({
      symbol,
      interval,
      bars: bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: Math.round(b.v) })),
      count: bars.length,
      ts: now,
    })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
