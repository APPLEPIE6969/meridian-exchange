import { NextRequest } from 'next/server'
import { ok, preflight, rateLimitResponse, clientKey, errorResponse } from '@/lib/api/respond'
import { getEngineReady } from '@/lib/engine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const engine = await getEngineReady()
    return ok(engine.indices())
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
