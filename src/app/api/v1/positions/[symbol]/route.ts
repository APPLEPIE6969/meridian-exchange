import { NextRequest } from 'next/server'
import { ok, fail, preflight, rateLimitResponse, clientKey, requireAccount, errorResponse } from '@/lib/api/respond'
import { positionViews } from '@/lib/engine/accounts'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const account = await requireAccount(req)
    const { symbol } = await ctx.params
    const positions = await positionViews(account.id)
    const pos = positions.find((p) => p.symbol === symbol.toUpperCase())
    if (!pos) {
      return fail(404, 'POSITION_NOT_FOUND', `No open position in ${symbol.toUpperCase()}.`)
    }
    return ok(pos)
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
