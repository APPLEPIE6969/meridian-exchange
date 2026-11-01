import { NextRequest } from 'next/server'
import { ok, fail, preflight, rateLimitResponse, clientKey, errorResponse } from '@/lib/api/respond'
import { getEngineReady } from '@/lib/engine'
import { BY_SYMBOL } from '@/lib/engine/universe'
import { PROFILES, buildQuarterFinancials, nextEarningsConsensus } from '@/lib/engine/profiles'
import { roundTo } from '@/lib/engine/rng'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const engine = await getEngineReady()
    const { symbol: raw } = await ctx.params
    const symbol = raw.toUpperCase()
    const inst = BY_SYMBOL.get(symbol)
    if (!inst) return fail(404, 'UNKNOWN_SYMBOL', `No security listed under ${symbol} on Meridian.`)

    const st = engine.states.get(symbol)!
    const q = engine.allQuotes().find((x) => x.s === symbol)
    // v8 ignore next — the quote always exists for a listed symbol
    /* v8 ignore next */
    const price = q?.p ?? st.price
    const profile = PROFILES[symbol] ?? null

    const daily = st.dailyBars.slice(-252)
    const week52High = roundTo(Math.max(...daily.map((b) => b.h), st.dayHigh, st.price), 2)
    const week52Low = roundTo(Math.min(...daily.map((b) => b.l), st.dayLow, st.price), 2)

    const financials = buildQuarterFinancials(inst, st.nextEarnings)
    const consensus = nextEarningsConsensus(inst, st.nextEarnings)

    // peers: same sector operating companies, biggest 5 by cap
    const peers = engine
      .allQuotes()
      .filter((x) => x.s !== symbol && BY_SYMBOL.get(x.s)?.sector === inst.sector && BY_SYMBOL.get(x.s)?.kind === 'stock')
      /* v8 ignore next */ .map((x) => ({ x, cap: x.p * (BY_SYMBOL.get(x.s)?.shares ?? 0) }))
      .sort((a, b) => b.cap - a.cap)
      .slice(0, 5)
      .map(({ x }) => ({
        symbol: x.s,
        name: BY_SYMBOL.get(x.s)!.name,
        last: x.p,
        change_percent: x.chgp,
        /* v8 ignore next */ market_cap: Math.round(x.p * (BY_SYMBOL.get(x.s)?.shares ?? 0)),
      }))

    // recent news mentioning this symbol
    let news: { id: string; headline: string; source: string; kind: string; sentiment: number; createdAt: string }[] = []
    for (let i = engine.newsFeed.length - 1; i >= 0 && news.length < 8; i--) {
      const n = engine.newsFeed[i]
      let syms: string[] = []
      try { syms = JSON.parse(n.symbols) as string[] } catch { syms = [] }
      if (syms.includes(symbol) || syms.includes(`@${inst.sector}`)) {
        news.push({ id: n.id, headline: n.headline, source: n.source, kind: n.kind, sentiment: n.sentiment, createdAt: n.createdAt })
      }
    }

    return ok({
      symbol,
      name: inst.name,
      sector: inst.sector,
      kind: inst.kind,
      exchange: 'MRX — Meridian Exchange',
      currency: 'USD',
      price: roundTo(price, 2),
      change: roundTo(price - st.prevClose, 2),
      change_percent: roundTo(((price - st.prevClose) / st.prevClose) * 100, 2),
      /* v8 ignore next */ halted: q?.halted ?? false,

      about: {
        description: inst.description,
        summary: profile?.summary ?? inst.description,
        ceo: inst.ceo,
        headquarters: inst.hq,
        founded: inst.founded,
        employees: inst.employees,
      },

      products: profile?.products ?? [],

      stats: {
        market_cap: Math.round(inst.shares * price),
        shares_outstanding: inst.shares,
        pe_ratio: inst.estEps > 0 ? roundTo(price / inst.estEps, 2) : null,
        eps_ttm: inst.estEps,
        dividend_yield: inst.divYield,
        beta: inst.beta,
        avg_volume: inst.avgVol,
        /* v8 ignore next */ volume: q?.v ?? st.volume,
        week52_high: week52High,
        week52_low: week52Low,
        revenue_ttm_b: profile?.revenueTtm ?? null,
        revenue_growth: profile?.revGrowth ?? null,
        gross_margin: profile?.grossMargin ?? null,
        net_margin: profile?.netMargin ?? null,
      },

      financials: {
        quarterly: financials,
        next_report: {
          date: new Date(st.nextEarnings).toISOString(),
          eps_consensus: consensus.eps,
          revenue_consensus_b: consensus.revenueB,
        },
      },

      peers,
      news,
      ts: Date.now(),
    })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
