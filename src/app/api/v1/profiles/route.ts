// AI test-profile management — OPERATOR ONLY, deliberately NOT listed in the
// public /docs response. The models under test must never encounter anything
// that hints at evaluation infrastructure: a profile is a perfectly ordinary
// brokerage account (own cash, positions, orders, API key) created through the
// standard registration pipeline. Profiles are fully isolated from one another
// at the account level — separate cash, positions, orders, fills and keys —
// while sharing the one realistic order book, exactly like customers at a real
// exchange. Nothing any profile key can observe references profiles, testing,
// or simulation.

import { NextRequest } from 'next/server'
import { ok, fail, preflight, errorResponse } from '@/lib/api/respond'
import { getEngineReady } from '@/lib/engine'
import { db } from '@/lib/db'
import { registerAccount } from '@/lib/engine/accounts'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

const OPERATOR_KEY = process.env.MRX_OPERATOR_KEY || 'meridian-ops-2026'

function authorized(req: NextRequest, bodyKey?: string): boolean {
  const headerKey = req.headers.get('x-operator-key')
  const queryKey = req.nextUrl?.searchParams.get('k') ?? undefined
  return headerKey === OPERATOR_KEY || bodyKey === OPERATOR_KEY || queryKey === OPERATOR_KEY
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

// ── synthetic human identities ─────────────────────────────────────
// Every surface a model (or anyone) can observe echoes the account's own
// identity back: /account and /auth/me return handle + name + email, and
// the public leaderboard publishes handles. None of those fields may
// encode the operator label or the model under test — a profile account
// must read exactly like a retail customer, or the test is compromised.
const FIRST_NAMES = ['Jordan', 'Morgan', 'Taylor', 'Casey', 'Riley', 'Quinn', 'Hayden', 'Rowan', 'Emerson', 'Skylar', 'Marlowe', 'Devon', 'Blake', 'Reese', 'Parker', 'Sawyer', 'Finley', 'Cameron', 'Aubrey', 'Lennox']
const LAST_NAMES = ['Avery', 'Brooks', 'Carter', 'Delaney', 'Ellison', 'Foster', 'Grant', 'Harrison', 'Ingram', 'Jennings', 'Keller', 'Lawson', 'Mercer', 'Novak', 'Ortiz', 'Palmer', 'Quintero', 'Reyes', 'Sullivan', 'Thornton']
const HANDLE_ADJ = ['quiet', 'amber', 'cobalt', 'velvet', 'north', 'harbor', 'lunar', 'ivory', 'cedar', 'rapid', 'sable', 'golden', 'silver', 'stellar', 'meadow', 'summit', 'winter', 'copper', 'drift', 'ember']
const HANDLE_NOUN = ['falcon', 'heron', 'otter', 'wolf', 'storm', 'ridge', 'compass', 'beacon', 'willow', 'sparrow', 'badger', 'ember', 'flint', 'gale', 'orchid', 'quarry', 'martin', 'pixel', 'cursor', 'delta']

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function humanIdentity(): { name: string; handle: string; email: string } {
  const name = `${pickOne(FIRST_NAMES)} ${pickOne(LAST_NAMES)}`
  const handle = `${pickOne(HANDLE_ADJ)}_${pickOne(HANDLE_NOUN)}_${Math.floor(Math.random() * 90) + 10}`
  const email = `${handle}_${randomBytes(3).toString('hex')}@mrxclients.io`
  return { name, handle, email }
}

interface ProfileRow {
  id: string
  label: string
  model: string
  notes: string
  account_id: string
  handle: string
  leaderboard_alias: string | null
  display_handle: string
  status: string
  api_key: string
  cash: number
  equity: number
  return_pct: number
  positions: number
  trades: number
  realized_pl: number
  gross_exposure: number
  top_holding: { symbol: string; weight_pct: number } | null
  created_at: string
}

// Signed average-cost realized P/L from the fill history (net of fees).
// Longs realize (sell - avg); shorts realize (avg sell - buy-back).
function realizedFromFills(fills: { symbol: string; side: string; qty: number; price: number; fee: number }[]): number {
  const book = new Map<string, { qty: number; avg: number }>()
  let realized = 0
  for (const f of fills) {
    const b = book.get(f.symbol) ?? { qty: 0, avg: 0 }
    if (f.side === 'buy') {
      if (b.qty >= 0) {
        b.avg = (b.avg * b.qty + f.price * f.qty) / (b.qty + f.qty || 1)
        b.qty += f.qty
      } else {
        const close = Math.min(f.qty, -b.qty)
        realized += close * (b.avg - f.price)
        b.qty += close
        const open = f.qty - close
        if (open > 1e-9) { b.qty = open; b.avg = f.price }
      }
    } else {
      if (b.qty <= 0) {
        b.avg = (b.avg * -b.qty + f.price * f.qty) / (-b.qty + f.qty || 1)
        b.qty -= f.qty
      } else {
        const close = Math.min(f.qty, b.qty)
        realized += close * (f.price - b.avg)
        b.qty -= close
        const open = f.qty - close
        if (open > 1e-9) { b.qty = -open; b.avg = f.price }
      }
    }
    realized -= f.fee
    book.set(f.symbol, b)
  }
  return Math.round(realized * 100) / 100
}

// Operator-set public leaderboard name. Sanitized hard because it is visible
// to every participant — including the model under test.
function sanitizeAlias(raw: unknown): { alias: string | null; error?: never } | { alias?: never; error: NextResponse } {
  if (raw === undefined || raw === null || raw === '') return { alias: null }
  const a = String(raw).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  if (a.length < 3 || a.length > 24) {
    return { error: fail(422, 'INVALID_ALIAS', 'leaderboard_alias must be 3-24 chars (a-z, 0-9, _).') }
  }
  return { alias: a }
}

async function profileRows(): Promise<ProfileRow[]> {
  const engine = await getEngineReady()
  const profiles = await db.testProfile.findMany({
    include: { account: { include: { positions: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const ids = profiles.map((p) => p.accountId)
  const allFills = ids.length
    ? await db.fill.findMany({ where: { accountId: { in: ids } }, orderBy: { createdAt: 'asc' } })
    : []
  const fillsByAccount = new Map<string, typeof allFills>()
  for (const f of allFills) {
    const arr = fillsByAccount.get(f.accountId) ?? []
    arr.push(f)
    fillsByAccount.set(f.accountId, arr)
  }
  return profiles.map((p) => {
    let mv = 0
    let topSymbol: string | null = null
    let topMv = 0
    let gross = 0
    for (const pos of p.account.positions) {
      const price = engine.quote(pos.symbol)?.p ?? pos.avgPrice
      const absMv = Math.abs(pos.qty * price)
      mv += pos.qty * price
      gross += absMv
      if (absMv > topMv) { topMv = absMv; topSymbol = pos.symbol }
    }
    const equity = p.account.cash + mv
    const fills = fillsByAccount.get(p.accountId) ?? []
    const alias = p.leaderboardAlias
    return {
      id: p.id,
      label: p.label,
      model: p.model,
      notes: p.notes,
      account_id: p.accountId,
      handle: p.account.handle,
      leaderboard_alias: alias,
      display_handle: alias ?? p.account.handle,
      status: p.account.status,
      api_key: p.account.apiKey,
      cash: Math.round(p.account.cash * 100) / 100,
      equity: Math.round(equity * 100) / 100,
      return_pct: Math.round((equity / p.startingCash - 1) * 10000) / 100,
      positions: p.account.positions.length,
      trades: fills.length,
      realized_pl: realizedFromFills(fills),
      gross_exposure: Math.round(gross * 100) / 100,
      top_holding: topSymbol && equity > 0 ? { symbol: topSymbol, weight_pct: Math.round((topMv / equity) * 1000) / 10 } : null,
      created_at: p.createdAt.toISOString(),
    }
  })
}

export async function GET(req: NextRequest) {
  try {
    if (!authorized(req)) return fail(404, 'NOT_FOUND', 'Unknown endpoint.')
    return ok({ profiles: await profileRows() })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    if (!authorized(req, body?.operator_key)) return fail(404, 'NOT_FOUND', 'Unknown endpoint.')

    const label = String(body.label ?? '').trim()
    const slug = slugify(label)
    if (!slug) return fail(422, 'LABEL_REQUIRED', 'label is required.')

    const existing = await db.testProfile.findUnique({ where: { label: slug } })
    if (existing) return fail(409, 'PROFILE_EXISTS', `Profile '${slug}' already exists.`)

    // Standard registration pipeline — the account is indistinguishable from
    // any retail signup. The label/model live ONLY in the operator-only
    // TestProfile row; the account itself gets a synthetic human identity
    // (handle, name, email) so nothing observable encodes the evaluation.
    // Random suffix keeps the email collision-free when a profile is deleted
    // and recreated with the same label.
    const identity = humanIdentity()
    const account = await registerAccount({
      email: identity.email,
      password: randomBytes(16).toString('hex'),
      name: identity.name,
      handle: identity.handle,
    })

    const startingCash = Number(body.starting_cash ?? 100000)
    const validCash = Number.isFinite(startingCash) && startingCash >= 100 && startingCash <= 10_000_000
    if (validCash && startingCash !== 100000) {
      await db.account.update({ where: { id: account.id }, data: { cash: startingCash, lastEquity: startingCash } })
    }

    const aliasCheck = sanitizeAlias(body.leaderboard_alias)
    if (aliasCheck.error) return aliasCheck.error

    const profile = await db.testProfile.create({
      data: {
        accountId: account.id,
        label: slug,
        model: String(body.model ?? '').slice(0, 120),
        notes: String(body.notes ?? '').slice(0, 2000),
        leaderboardAlias: aliasCheck.alias,
        startingCash: validCash ? startingCash : 100000,
      },
    })

    const rows = await profileRows()
    const row = rows.find((r) => r.id === profile.id)
    return ok({
      profile: row,
      credentials: {
        api_key: account.apiKey,
        base_url: `${req.nextUrl.origin}/api/v1`,
        auth_header: 'Authorization: Bearer <key>  (or X-MRX-Key: <key>)',
      },
      message: `Profile '${slug}' provisioned. Hand the api_key to the model — it resolves to a normal brokerage account.`,
    }, 201)
  } catch (e) {
    return errorResponse(e)
  }
}

// Update an operator-set public alias. NOTE: the alias IS visible on the
// public leaderboard to every participant — including the model under test —
// so it must stay human-looking; the API rejects anything else.
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    if (!authorized(req, body?.operator_key)) return fail(404, 'NOT_FOUND', 'Unknown endpoint.')
    const id = body?.id ? String(body.id) : null
    const label = body?.label ? slugify(String(body.label)) : null
    const profile = id
      ? await db.testProfile.findUnique({ where: { id } })
      : label
        ? await db.testProfile.findUnique({ where: { label } })
        : null
    if (!profile) return fail(404, 'PROFILE_NOT_FOUND', 'Profile not found.')
    if (!('leaderboard_alias' in body)) {
      return fail(422, 'NOTHING_TO_UPDATE', "Provide 'leaderboard_alias' (empty string clears the alias).")
    }
    const aliasCheck = sanitizeAlias(body.leaderboard_alias)
    if (aliasCheck.error) return aliasCheck.error
    await db.testProfile.update({ where: { id: profile.id }, data: { leaderboardAlias: aliasCheck.alias } })
    const rows = await profileRows()
    return ok({ profile: rows.find((r) => r.id === profile.id), message: aliasCheck.alias ? `Leaderboard alias set to '${aliasCheck.alias}'.` : 'Leaderboard alias cleared.' })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!authorized(req)) return fail(404, 'NOT_FOUND', 'Unknown endpoint.')
    const id = req.nextUrl?.searchParams.get('id')
    const label = req.nextUrl?.searchParams.get('label')
    const profile = id
      ? await db.testProfile.findUnique({ where: { id } })
      : label
        ? await db.testProfile.findUnique({ where: { label } })
        : null
    if (!profile) return fail(404, 'PROFILE_NOT_FOUND', 'Profile not found.')
    // Deleting the account cascades to the profile, positions, orders and fills.
    await db.account.delete({ where: { id: profile.accountId } })
    return ok({ success: true, message: `Profile '${profile.label}' deleted.` })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
