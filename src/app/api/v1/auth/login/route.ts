import { NextRequest } from 'next/server'
import { ok, fail, preflight, rateLimitResponse, clientKey, errorResponse } from '@/lib/api/respond'
import { loginAccount } from '@/lib/engine/accounts'
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const body = await req.json().catch(() => ({}))
    if (!body.email || !body.password) {
      return fail(422, 'MISSING_FIELDS', 'email and password are required.')
    }
    const account = await loginAccount(String(body.email), String(body.password))
    const res = ok({
      id: account.id,
      account_number: account.accountNumber,
      email: account.email,
      handle: account.handle,
      status: account.status,
      api_key: account.apiKey,
      ts: new Date().toISOString(),
    })
    res.cookies.set(SESSION_COOKIE, createSessionToken(account.id), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86400,
    })
    return res
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
