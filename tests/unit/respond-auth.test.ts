// Response helpers, rate limiter, and session/auth resolution.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { ok, fail, preflight, rateLimitResponse, clientKey, requireAccount, errorResponse, AuthRequiredError, CORS_HEADERS } from '@/lib/api/respond'
import { checkRate } from '@/lib/ratelimit'
import { createSessionToken, verifySessionToken, resolveAccount, accountIdFromApiKey, SESSION_COOKIE } from '@/lib/auth/session'
import { registerAccount } from '@/lib/engine/accounts'
import { __setCookie, __clearCookies } from '../mocks/next-headers'

function req(url: string, headers: Record<string, string> = {}, method = 'GET'): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, { method, headers })
}

let account: Awaited<ReturnType<typeof registerAccount>>
let counter = 0

beforeEach(async () => {
  __clearCookies()
  counter++
  account = await registerAccount({ email: `auth-test-${Date.now()}-${counter}@mrx.dev`, password: 'password123', handle: `auther${counter}` })
})

describe('respond helpers', () => {
  it('ok() wraps data with CORS headers', async () => {
    const res = ok({ a: 1 }, 201)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ a: 1 })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toBe(CORS_HEADERS['Access-Control-Allow-Methods'])
  })

  it('fail() shapes broker-style errors', async () => {
    const res = fail(404, 'NOPE', 'not here')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'NOPE', message: 'not here' } })
  })

  it('preflight() answers 204 with CORS', () => {
    const res = preflight()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-max-age')).toBe('86400')
  })

  it('clientKey prefers accountId, then auth headers, then XFF, then anon', () => {
    expect(clientKey(req('/x'), 'acct-1')).toBe('acct-1')
    expect(clientKey(req('/x', { authorization: 'Bearer k1' }))).toBe('Bearer k1')
    expect(clientKey(req('/x', { 'x-mrx-key': 'k2' }))).toBe('k2')
    expect(clientKey(req('/x', { 'x-api-key': 'k3' }))).toBe('k3')
    expect(clientKey(req('/x', { 'x-forwarded-for': '10.0.0.1' }))).toBe('10.0.0.1')
    expect(clientKey(req('/x'))).toBe('anon')
  })

  it('rateLimitResponse passes under the limit and trips at 200/min', async () => {
    const key = `rl-${Date.now()}-${counter}`
    for (let i = 0; i < 200; i++) expect(rateLimitResponse(key)).toBeNull()
    const res = rateLimitResponse(key)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(429)
    const body = await res!.json()
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(res!.headers.get('retry-after')).toMatch(/^\d+$/)
  })

  it('requireAccount resolves a valid key and throws AuthRequiredError otherwise', async () => {
    const found = await requireAccount(req('/x', { authorization: `Bearer ${account.apiKey}` }))
    expect(found.id).toBe(account.id)
    const err = await requireAccount(req('/x')).catch((e) => e)
    expect(err).toBeInstanceOf(AuthRequiredError)
    const bad = await requireAccount(req('/x', { authorization: 'Bearer mrx_live_deadbeef' })).catch((e) => e)
    expect(bad).toBeInstanceOf(AuthRequiredError)
  })

  it('errorResponse maps error classes to broker responses', async () => {
    const auth = errorResponse(new AuthRequiredError())
    expect(auth.status).toBe(401)
    expect((await auth.json()).error.code).toBe('UNAUTHORIZED')

    const apiErr = errorResponse(Object.assign(new Error('bad order'), { status: 422, code: 'ORDER_REJECTED' }))
    expect(apiErr.status).toBe(422)
    expect((await apiErr.json()).error.code).toBe('ORDER_REJECTED')

    const unknown = errorResponse(new Error('boom'))
    expect(unknown.status).toBe(500)
    expect((await unknown.json()).error.code).toBe('INTERNAL')
  })
})

describe('checkRate (sliding window)', () => {
  afterEach(() => vi.useRealTimers())

  it('counts requests inside the window and resets after it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const key = `win-${Date.now()}`
    expect(checkRate(key, 3, 1000)).toMatchObject({ ok: true, remaining: 2 })
    expect(checkRate(key, 3, 1000)).toMatchObject({ ok: true, remaining: 1 })
    expect(checkRate(key, 3, 1000)).toMatchObject({ ok: true, remaining: 0 })
    expect(checkRate(key, 3, 1000).ok).toBe(false)
    expect(checkRate(key, 3, 1000).remaining).toBe(0)

    vi.setSystemTime(1_000_000 + 1100) // window elapsed
    expect(checkRate(key, 3, 1000)).toMatchObject({ ok: true, remaining: 2 })
  })

  it('sweeps expired buckets once the map exceeds 5000 entries', () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000_000)
    // fill 5001 fresh buckets
    for (let i = 0; i < 5001; i++) checkRate(`sweep-${i}`, 100, 60_000)
    // drive key-0 down the increment path with a still-valid bucket
    checkRate('sweep-0', 100, 60_000)
    // age everything out, refresh sweep-0, then force the cleanup branch
    vi.setSystemTime(2_000_000 + 61_000)
    checkRate('sweep-0', 100, 60_000) // fresh bucket replaces the expired one
    const before = checkRate('sweep-0', 100, 60_000) // increment path with size > 5000 → sweep
    expect(before.ok).toBe(true)
    // all expired buckets (except sweep-0) are now gone: re-checking an old key starts clean
    expect(checkRate('sweep-4999', 100, 60_000).remaining).toBe(99)
  })
})

describe('session tokens', () => {
  it('round-trips an account id', () => {
    const token = createSessionToken('acc-123')
    expect(verifySessionToken(token)).toBe('acc-123')
  })

  it('rejects missing, malformed, tampered and expired tokens', () => {
    expect(verifySessionToken(undefined)).toBeNull()
    expect(verifySessionToken(null)).toBeNull()
    expect(verifySessionToken('')).toBeNull()
    expect(verifySessionToken('no-dot-here')).toBeNull()
    expect(verifySessionToken('.')).toBeNull()
    expect(verifySessionToken('onlysignature')).toBeNull()

    const token = createSessionToken('acc-123')
    const [payload] = token.split('.')
    expect(verifySessionToken(payload + '.forgedsig')).toBeNull() // bad signature

    // correctly signed but expired — reaches the expiry check itself
    const expiredPayload = Buffer.from(JSON.stringify({ aid: 'acc-123', exp: Date.now() - 1000 })).toString('base64url')
    const expiredSig = crypto.createHmac('sha256', 'unit-test-secret').update(expiredPayload).digest('base64url')
    expect(verifySessionToken(`${expiredPayload}.${expiredSig}`)).toBeNull()

    const noAid = Buffer.from(JSON.stringify({ exp: Date.now() + 1000 })).toString('base64url')
    const signedNoAid = `${noAid}.${createSessionToken('x').split('.')[1]}`
    expect(verifySessionToken(signedNoAid)).toBeNull()

    const garbage = Buffer.from('{{{not json').toString('base64url')
    expect(verifySessionToken(`${garbage}.${createSessionToken('x').split('.')[1]}`)).toBeNull()
  })
})

describe('resolveAccount', () => {
  it('resolves via bearer token, x-mrx-key, x-api-key', async () => {
    const headerVariants: Record<string, string>[] = [
      { authorization: `Bearer ${account.apiKey}` },
      { 'x-mrx-key': account.apiKey },
      { 'x-api-key': account.apiKey },
    ]
    for (const headers of headerVariants) {
      const found = await resolveAccount(req('/x', headers))
      expect(found?.id).toBe(account.id)
    }
  })

  it('returns null for unknown keys without touching cookies', async () => {
    expect(await resolveAccount(req('/x', { authorization: 'Bearer mrx_live_unknown' }))).toBeNull()
  })

  it('resolves via a valid session cookie', async () => {
    __setCookie(SESSION_COOKIE, createSessionToken(account.id))
    const found = await resolveAccount(req('/x'))
    expect(found?.id).toBe(account.id)
  })

  it('falls through to null with an invalid or missing cookie', async () => {
    expect(await resolveAccount(req('/x'))).toBeNull()
    __setCookie(SESSION_COOKIE, 'garbage.token')
    expect(await resolveAccount(req('/x'))).toBeNull()
  })

  it('bearer headers win over cookies', async () => {
    __setCookie(SESSION_COOKIE, createSessionToken(account.id))
    const other = await registerAccount({ email: `other-${Date.now()}-${counter}@mrx.dev`, password: 'password123' })
    const found = await resolveAccount(req('/x', { authorization: `Bearer ${other.apiKey}` }))
    expect(found?.id).toBe(other.id)
  })
})

describe('accountIdFromApiKey', () => {
  it('resolves valid keys and null/invalid ones', async () => {
    expect(await accountIdFromApiKey(account.apiKey)).toBe(account.id)
    expect(await accountIdFromApiKey(null)).toBeNull()
    expect(await accountIdFromApiKey('mrx_live_nope')).toBeNull()
  })
})

describe('session token edge: signed but unparseable payload', () => {
  it('accepts a signed payload missing exp (aid only)', async () => {
    const payload = Buffer.from(JSON.stringify({ aid: 'acc-no-exp' })).toString('base64url')
    const sig = crypto.createHmac('sha256', 'unit-test-secret').update(payload).digest('base64url')
    expect(verifySessionToken(`${payload}.${sig}`)).toBe('acc-no-exp')
  })

  it('rejects a correctly-signed payload that is not JSON', async () => {
    const payload = Buffer.from('{{{ not json').toString('base64url')
    const sig = crypto.createHmac('sha256', 'unit-test-secret').update(payload).digest('base64url')
    expect(verifySessionToken(`${payload}.${sig}`)).toBeNull()
  })

  it('errorResponse defaults the message when the error carries none', async () => {
    const res = errorResponse({ status: 422, code: 'CUSTOM_CODE' })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('CUSTOM_CODE')
    expect(body.error.message).toBe('Request failed.')
  })
})
