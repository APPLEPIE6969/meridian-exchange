// Cookie sessions (web UI) + API-key extraction (trading API).

import crypto from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

// v8 ignore next — the fallback secret only applies when the env var is unset
/* v8 ignore next */
const SECRET = process.env.MRX_SESSION_SECRET || 'mrx-dev-secret-9f27c1ab4e'
export const SESSION_COOKIE = 'mrx_session'

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
}

export function createSessionToken(accountId: string): string {
  const payload = Buffer.from(JSON.stringify({ aid: accountId, exp: Date.now() + 30 * 86400000 })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  if (sign(payload) !== sig) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!data.aid || data.exp < Date.now()) return null
    return data.aid as string
  } catch {
    return null
  }
}

/** Resolve the acting account from (1) API key bearer/header or (2) session cookie. */
export async function resolveAccount(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  let key: string | null = null
  if (auth.toLowerCase().startsWith('bearer ')) key = auth.slice(7).trim()
  if (!key) key = req.headers.get('x-mrx-key') ?? req.headers.get('x-api-key')
  if (key) {
    const account = await db.account.findUnique({ where: { apiKey: key } })
    if (account) return account
    return null
  }
  const cookieStore = await cookies()
  const aid = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)
  if (!aid) return null
  return db.account.findUnique({ where: { id: aid } })
}

/** account id from a websocket relay handshake (server-to-server) */
export function accountIdFromApiKey(key: string | null): Promise<string | null> {
  if (!key) return Promise.resolve(null)
  return db.account.findUnique({ where: { apiKey: key } }).then((a) => a?.id ?? null)
}
