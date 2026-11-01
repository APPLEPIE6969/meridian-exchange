import { NextRequest } from 'next/server'
import { ok, fail, preflight, rateLimitResponse, clientKey, requireAccount, errorResponse } from '@/lib/api/respond'
import { portfolioHistory } from '@/lib/engine/accounts'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const account = await requireAccount(req)
    const periodRaw = new URL(req.url).searchParams.get('period') ?? '1A'
    const period = ['1D', '1W', '1M', '1A'].includes(periodRaw) ? periodRaw : null
    if (!period) return fail(422, 'INVALID_PERIOD', 'period must be one of: 1D, 1W, 1M, 1A.')
    return ok(await portfolioHistory(account.id, period as '1D' | '1W' | '1M' | '1A'))
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
