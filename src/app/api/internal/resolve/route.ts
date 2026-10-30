// Internal endpoint used by the socket.io relay to resolve an API key to an
// account id (for private account event rooms). Not exposed in public docs.

import { NextRequest } from 'next/server'
import { ok, fail, preflight } from '@/lib/api/respond'
import { accountIdFromApiKey } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  if (!body?.api_key) return fail(422, 'MISSING_KEY', 'api_key required.')
  const accountId = await accountIdFromApiKey(String(body.api_key))
  if (!accountId) return fail(401, 'UNAUTHORIZED', 'Invalid API key.')
  return ok({ account_id: accountId })
}

export async function OPTIONS() {
  return preflight()
}
