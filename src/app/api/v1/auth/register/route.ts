import { NextRequest } from 'next/server'
import { ok, fail, preflight, rateLimitResponse, clientKey, errorResponse } from '@/lib/api/respond'
import { registerAccount } from '@/lib/engine/accounts'
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
    const account = await registerAccount({
      email: String(body.email),
      password: String(body.password),
      name: body.name ? String(body.name) : undefined,
      handle: body.handle ? String(body.handle) : undefined,
    })
    const res = ok({
      id: account.id,
      account_number: account.accountNumber,
      email: account.email,
      handle: account.handle,
      status: account.status,
      cash: account.cash,
      api_key: account.apiKey,
      message: 'Account approved. Funded with $100,000 instant deposit credit (new-account promotion). Keep your API key secret — it is shown once at registration.',
      created_at: account.createdAt.toISOString(),
    }, 201)
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
