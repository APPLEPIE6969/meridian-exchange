import { NextRequest } from 'next/server'
import { ok, preflight, rateLimitResponse, clientKey, requireAccount, errorResponse } from '@/lib/api/respond'
import { rotateApiKey } from '@/lib/engine/accounts'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const account = await requireAccount(req)
    return ok({
      keys: [
        {
          id: account.id,
          key_id: account.apiKey.slice(0, 14) + '…' + account.apiKey.slice(-4),
          secret_masked: '••••••••••••',
          created_at: account.createdAt.toISOString(),
          status: 'ACTIVE',
          scopes: ['trading', 'market_data', 'account'],
        },
      ],
      note: 'Use the full key with: Authorization: Bearer <key>. Rotate to invalidate the current key.',
    })
  } catch (e) {
    return errorResponse(e)
  }
}

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
