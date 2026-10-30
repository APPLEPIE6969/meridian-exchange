import { ok, preflight } from '@/lib/api/respond'
import { SESSION_COOKIE } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST() {
  const res = ok({ success: true, message: 'Signed out.' })
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}

export async function OPTIONS() {
  return preflight()
}
