import { NextRequest } from 'next/server'
import { ok, preflight, rateLimitResponse, clientKey, errorResponse } from '@/lib/api/respond'
import { getEngineReady } from '@/lib/engine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const engine = await getEngineReady()
    const m = engine.movers()
    const shape = (arr: typeof m.gainers) =>
      arr.map((q) => ({
        symbol: q.s,
        last: q.p,
        change: q.chg,
        change_percent: q.chgp,
        volume: q.v,
        halted: q.halted,
      }))
    return ok({ gainers: shape(m.gainers), losers: shape(m.losers), most_active: shape(m.active), ts: m.ts })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
