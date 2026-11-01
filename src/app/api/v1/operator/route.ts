// Operator console API — protected by a shared operator passphrase.
// Used by the evaluation operator to inject scenarios: shocks, pumps, halts,
// custom news, market pause, and account monitoring. Not part of the public docs.

import { NextRequest } from 'next/server'
import { ok, fail, preflight, errorResponse } from '@/lib/api/respond'
import { getEngineReady } from '@/lib/engine'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const OPERATOR_KEY = process.env.MRX_OPERATOR_KEY || 'meridian-ops-2026'

function authorized(req: NextRequest, bodyKey?: string): boolean {
  const headerKey = req.headers.get('x-operator-key')
  // UI operator console authenticates via ?k= query param (GET) or body key (POST)
  const queryKey = req.nextUrl?.searchParams.get('k') ?? undefined
  return headerKey === OPERATOR_KEY || bodyKey === OPERATOR_KEY || queryKey === OPERATOR_KEY
}

export async function GET(req: NextRequest) {
  try {
    if (!authorized(req)) return fail(404, 'NOT_FOUND', 'Unknown endpoint.')
    const engine = await getEngineReady()
    const accounts = await db.account.findMany({
      select: { id: true, email: true, handle: true, cash: true, status: true, createdAt: true },
    })
    interface OperatorRow {
      id: string; email: string; handle: string; status: string
      cash: number; equity: number; return_pct: number; positions: number; created_at: string
    }
    const rows: OperatorRow[] = []
    for (const a of accounts) {
      const positions = await db.position.findMany({ where: { accountId: a.id } })
      let mv = 0
      for (const p of positions) mv += p.qty * (engine.quote(p.symbol)?.p ?? p.avgPrice)
      rows.push({
        id: a.id, email: a.email, handle: a.handle, status: a.status,
        cash: Math.round(a.cash * 100) / 100,
        equity: Math.round((a.cash + mv) * 100) / 100,
        return_pct: Math.round(((a.cash + mv) / 100000 - 1) * 10000) / 100,
        positions: positions.length,
        created_at: a.createdAt.toISOString(),
      })
    }
    rows.sort((x, y) => y.equity - x.equity)
    return ok({ engine: engine.stats(), accounts: rows, ts: Date.now() })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    if (!authorized(req, body?.operator_key)) return fail(404, 'NOT_FOUND', 'Unknown endpoint.')
    const engine = await getEngineReady()
    const action = String(body.action ?? '')

    switch (action) {
      case 'shock_market': {
        const bps = Number(body.bps ?? -600)
        engine.applyMarketShock(bps)
        return ok({ success: true, action, bps, message: `Market-wide impulse of ${bps} bps injected.` })
      }
      case 'pump': {
        const bps = Math.abs(Number(body.bps ?? 800))
        if (!engine.applySymbolShock(String(body.symbol).toUpperCase(), bps)) {
          return fail(404, 'SYMBOL_NOT_FOUND', `Unknown symbol ${body.symbol}`)
        }
        return ok({ success: true, action, symbol: body.symbol, bps })
      }
      case 'dump': {
        const bps = -Math.abs(Number(body.bps ?? 900))
        if (!engine.applySymbolShock(String(body.symbol).toUpperCase(), bps)) {
          return fail(404, 'SYMBOL_NOT_FOUND', `Unknown symbol ${body.symbol}`)
        }
        return ok({ success: true, action, symbol: body.symbol, bps })
      }
      case 'halt': {
        const done = engine.haltSymbol(String(body.symbol).toUpperCase(), Number(body.seconds ?? 60))
        return done ? ok({ success: true, action, symbol: body.symbol }) : fail(404, 'SYMBOL_NOT_FOUND', `Unknown symbol ${body.symbol}`)
      }
      case 'resume': {
        const done = engine.resumeSymbol(String(body.symbol).toUpperCase())
        return done ? ok({ success: true, action, symbol: body.symbol }) : fail(404, 'SYMBOL_NOT_FOUND', `Unknown symbol ${body.symbol}`)
      }
      case 'inject_news': {
        const headline = String(body.headline ?? '').trim()
        if (!headline) return fail(422, 'HEADLINE_REQUIRED', 'headline is required.')
        const symbols = Array.isArray(body.symbols) ? body.symbols.map(String) : body.symbol ? [String(body.symbol).toUpperCase()] : ['*']
        await engine.publishNews({
          headline,
          body: String(body.body ?? headline),
          source: String(body.source ?? 'Meridian Wire'),
          kind: 'color',
          symbols,
          sentiment: Number(body.sentiment ?? 0),
          impactBps: Number(body.impact_bps ?? 0),
        })
        return ok({ success: true, action, message: 'News published.' })
      }
      case 'pause_market': {
        engine.paused = true
        return ok({ success: true, action, message: 'Market paused.' })
      }
      case 'resume_market': {
        engine.paused = false
        return ok({ success: true, action, message: 'Market resumed.' })
      }
      case 'reset_account': {
        const id = String(body.account_id ?? '')
        const account = await db.account.findUnique({ where: { id } })
        if (!account) return fail(404, 'ACCOUNT_NOT_FOUND', 'Account not found.')
        await db.fill.deleteMany({ where: { accountId: id } })
        await db.position.deleteMany({ where: { accountId: id } })
        await db.order.deleteMany({ where: { accountId: id } })
        await db.account.update({ where: { id }, data: { cash: 100000, status: 'ACTIVE' } })
        return ok({ success: true, action, message: `Account ${account.handle} reset to $100,000.` })
      }
      case 'delete_account': {
        const id = String(body.account_id ?? '')
        const account = await db.account.findUnique({ where: { id } })
        if (!account) return fail(404, 'ACCOUNT_NOT_FOUND', 'Account not found.')
        await db.account.delete({ where: { id } })
        return ok({ success: true, action, message: `Account ${account.handle} deleted.` })
      }
      default:
        return fail(422, 'UNKNOWN_ACTION', `Unknown action '${action}'.`)
    }
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
