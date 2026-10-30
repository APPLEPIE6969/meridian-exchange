import { NextRequest } from 'next/server'
import { ok, fail, preflight, rateLimitResponse, clientKey, errorResponse } from '@/lib/api/respond'
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
    const symbolsParam = url.searchParams.get('symbols') ?? url.searchParams.get('symbol') ?? ''
    if (!symbolsParam) return fail(422, 'SYMBOLS_REQUIRED', "Provide one or more symbols: ?symbols=QNTM,NEURX (max 50).")
    const symbols = symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 50)
    if (symbols.length === 0) return fail(422, 'SYMBOLS_REQUIRED', 'No valid symbols provided.')

    const quotes: Record<string, unknown>[] = []
    const notFound: string[] = []
    for (const s of symbols) {
      const q = engine.quote(s)
      if (!q) {
        notFound.push(s)
        continue
      }
      const inst = BY_SYMBOL.get(s)!
      const st = engine.states.get(s)!
      quotes.push({
        symbol: s,
        name: inst.name,
        sector: inst.sector,
        kind: inst.kind,
        last: q.p,
        bid: q.b,
        ask: q.a,
        bid_size: q.bs,
        ask_size: q.as,
        last_size: st.tape.length ? st.tape[st.tape.length - 1].s : 100,
        open: q.o,
        high: q.h,
        low: q.l,
        prev_close: q.pc,
        volume: q.v,
        change: q.chg,
        change_percent: q.chgp,
        week52_high: roundTo(Math.max(...st.dailyBars.slice(-252).map((b) => b.h), q.h, q.p), 2),
        week52_low: roundTo(Math.min(...st.dailyBars.slice(-252).map((b) => b.l), q.l, q.p), 2),
        halted: q.halted,
        session: engine.marketStatus().session,
        ts: q.t,
      })
    }
    if (quotes.length === 0 && notFound.length > 0) {
      return fail(404, 'SYMBOL_NOT_FOUND', `No security found for symbol(s): ${notFound.join(', ')}`)
    }
    return ok({ quotes, not_found: notFound, ts: Date.now() })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
