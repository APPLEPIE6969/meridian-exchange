import { NextRequest } from 'next/server'
import { ok, preflight, rateLimitResponse, clientKey, errorResponse } from '@/lib/api/respond'
import { getEngineReady } from '@/lib/engine'
import { BY_SYMBOL } from '@/lib/engine/universe'
import { roundTo } from '@/lib/engine/rng'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const engine = await getEngineReady()
    const url = new URL(req.url)
    const sector = url.searchParams.get('sector')
    const search = url.searchParams.get('search')?.toLowerCase()
    const kind = url.searchParams.get('kind')

    let rows = engine.allQuotes().map((q) => {
      const inst = BY_SYMBOL.get(q.s)!
      const st = engine.states.get(q.s)!
      return {
        symbol: q.s,
        name: inst.name,
        sector: inst.sector,
        kind: inst.kind,
        last: q.p,
        bid: q.b,
        ask: q.a,
        bid_size: q.bs,
        ask_size: q.as,
        open: q.o,
        high: q.h,
        low: q.l,
        prev_close: q.pc,
        volume: q.v,
        change: q.chg,
        change_percent: q.chgp,
        market_cap: Math.round(inst.shares * q.p),
        avg_volume: inst.avgVol,
        pe_ratio: inst.estEps > 0 ? roundTo(q.p / inst.estEps, 2) : null,
        dividend_yield: inst.divYield,
        beta: inst.beta,
        week52_high: roundTo(Math.max(...st.dailyBars.slice(-252).map((b) => b.h), q.h, q.p), 2),
        week52_low: roundTo(Math.min(...st.dailyBars.slice(-252).map((b) => b.l), q.l, q.p), 2),
        halted: q.halted,
        ts: q.t,
      }
    })

    if (sector) rows = rows.filter((r) => r.sector.toLowerCase() === sector.toLowerCase())
    if (kind) rows = rows.filter((r) => r.kind === kind)
    if (search) {
      rows = rows.filter((r) => r.symbol.toLowerCase().includes(search) || r.name.toLowerCase().includes(search))
    }
    rows.sort((a, b) => b.market_cap - a.market_cap)
    return ok({ securities: rows, count: rows.length, ts: Date.now() })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
