import { NextRequest } from 'next/server'
import { ok, fail, preflight, rateLimitResponse, clientKey, errorResponse } from '@/lib/api/respond'
import { getEngineReady } from '@/lib/engine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const engine = await getEngineReady()
    const url = new URL(req.url)
    const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase()
    if (!symbol) return fail(422, 'SYMBOL_REQUIRED', 'symbol query parameter is required.')
    if (!engine.quote(symbol)) return fail(404, 'SYMBOL_NOT_FOUND', `No security found for symbol '${symbol}'.`)
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)))
    const trades = engine.getTape(symbol, limit)
    return ok({
      symbol,
      trades: trades.map((t) => ({ t: t.t, price: t.p, size: Math.round(t.s), aggressor: t.x })),
      ts: Date.now(),
    })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
