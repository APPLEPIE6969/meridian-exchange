// POST /account/keys/rotate — documented rotation endpoint (alias of POST /account/keys).

import { NextRequest } from 'next/server'
import { ok, preflight, rateLimitResponse, clientKey, requireAccount, errorResponse } from '@/lib/api/respond'
import { rotateApiKey } from '@/lib/engine/accounts'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const account = await requireAccount(req)
    const key = await rotateApiKey(account.id)
    return ok({
      api_key: key,
      message: 'API key rotated. The previous key has been revoked — update your integrations.',
    })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
