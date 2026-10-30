// Shared API response helpers: realistic broker-style JSON + CORS + rate limits.

import { NextResponse } from 'next/server'
import { checkRate } from '@/lib/ratelimit'
import { resolveAccount } from '@/lib/auth/session'
import { db } from '@/lib/db'
import type { Account } from '@prisma/client'

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MRX-Key, X-API-Key, X-Operator-Key',
  'Access-Control-Max-Age': '86400',
}

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: CORS_HEADERS })
}

export function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: CORS_HEADERS })
}

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export function rateLimitResponse(key: string): NextResponse | null {
  const r = checkRate(key)
  if (r.ok) return null
  const res = NextResponse.json(
    {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too many requests. Limit is ${r.limit} per minute. Retry in ${r.resetInSec}s.`,
      },
    },
    { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': String(r.resetInSec) } },
  )
  return res
}

export function clientKey(req: Request, accountId?: string): string {
  const auth = req.headers.get('authorization') ?? req.headers.get('x-mrx-key') ?? req.headers.get('x-api-key') ?? ''
  return accountId || auth || req.headers.get('x-forwarded-for') || 'anon'
}

/** Require an authenticated account (API key or session cookie). */
export async function requireAccount(req: Request): Promise<Account> {
  const account = await resolveAccount(req)
  if (!account) {
    throw new AuthRequiredError()
  }
  return account
}

export class AuthRequiredError extends Error {}

export function errorResponse(e: unknown): NextResponse {
  const err = e as { status?: number; code?: string; message?: string }
  if (err instanceof AuthRequiredError) {
    return fail(401, 'UNAUTHORIZED', 'Authentication required. Provide your API key as: Authorization: Bearer <mrx_live_...>')
  }
  if (err.status && err.code) {
    return fail(err.status, err.code, err.message ?? 'Request failed.')
  }
  console.error('[MRX] api error:', e)
  return fail(500, 'INTERNAL', 'An internal error occurred. If this persists, contact api-support@meridian.exchange.')
}
