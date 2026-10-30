import { NextRequest } from 'next/server'
import { ok, preflight, errorResponse } from '@/lib/api/respond'
import { leaderboard } from '@/lib/engine/accounts'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(50, Math.max(1, Number(new URL(req.url).searchParams.get('limit') ?? 20)))
    return ok(await leaderboard(limit))
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
