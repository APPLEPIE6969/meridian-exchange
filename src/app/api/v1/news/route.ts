import { NextRequest } from 'next/server'
import { ok, preflight, errorResponse } from '@/lib/api/respond'
import { getEngineReady } from '@/lib/engine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const engine = await getEngineReady()
    const url = new URL(req.url)
    const symbol = url.searchParams.get('symbol')?.toUpperCase() ?? undefined
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 40)))
    return ok(engine.news(limit, symbol))
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
