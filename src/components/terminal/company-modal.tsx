'use client'

import { useCallback, useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/client/api'
import { fmtMoney, fmtPct, fmtVol, trendColor } from '@/lib/client/format'
import { toast } from 'sonner'

export const OPEN_PROFILE_EVENT = 'mrx:open-profile'

export function openCompanyProfile(symbol: string) {
  window.dispatchEvent(new CustomEvent(OPEN_PROFILE_EVENT, { detail: { symbol } }))
}

interface CompanyProfile {
  symbol: string
  name: string
  sector: string
  kind: string
  exchange: string
  price: number
  change: number
  change_percent: number
  about: {
    description: string
    summary: string
    ceo: string
    headquarters: string
    founded: number
    employees: number
  }
  products: string[]
  stats: {
    market_cap: number
    shares_outstanding: number
    pe_ratio: number | null
    eps_ttm: number
    dividend_yield: number
    beta: number
    avg_volume: number
    volume: number
    week52_high: number
    week52_low: number
    revenue_ttm_b: number | null
    revenue_growth: number | null
    gross_margin: number | null
    net_margin: number | null
  }
  financials: {
    quarterly: { quarter: string; reportDate: string; epsActual: number; epsEstimate: number; epsSurprise: number; revenueB: number; revYoY: number }[]
    next_report: { date: string; eps_consensus: number; revenue_consensus_b: number }
  }
  peers: { symbol: string; name: string; last: number; change_percent: number; market_cap: number }[]
  news: { id: string; headline: string; source: string; kind: string; sentiment: number; createdAt: string }[]
}

export function CompanyProfileModal() {
  const [open, setOpen] = useState(false)
  const [symbol, setSymbol] = useState('')
  const [data, setData] = useState<CompanyProfile | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (sym: string) => {
    setLoading(true)
    setData(null)
    try {
      const res = await api.get<CompanyProfile>(`/api/v1/market/stocks/${sym}`)
      setData(res)
    } catch {
      toast.error(`Unable to load company profile for ${sym}.`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const sym = (e as CustomEvent<{ symbol: string }>).detail?.symbol?.toUpperCase()
      if (!sym) return
      setSymbol(sym)
      setOpen(true)
      void load(sym)
    }
    window.addEventListener(OPEN_PROFILE_EVENT, handler)
    return () => window.removeEventListener(OPEN_PROFILE_EVENT, handler)
  }, [load])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
      <DialogContent className="max-h-[86vh] overflow-y-auto border-[#1e2530] bg-[#12161d] text-neutral-200 sm:max-w-2xl">
        {loading || !data ? (
          <>
            <DialogHeader className="pb-1">
              <DialogTitle className="text-lg text-neutral-50">{symbol} · Company Profile</DialogTitle>
              <DialogDescription className="text-xs text-neutral-500">Loading company information…</DialogDescription>
            </DialogHeader>
            <div className="flex h-48 items-center justify-center">
              <div className="size-6 animate-spin rounded-full border-2 border-[#f5a524] border-t-transparent" />
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="pb-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <DialogTitle className="text-lg text-neutral-50">
                  {data.symbol} <span className="text-sm font-normal text-neutral-400">· {data.name}</span>
                </DialogTitle>
                <span className="rounded bg-[#1e2530] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#f5a524]">{data.sector}</span>
              </div>
              <DialogDescription className="flex items-baseline gap-2 text-xs">
                <span className="text-base font-bold tabular-nums text-neutral-100">${data.price.toFixed(2)}</span>
                <span className={`font-semibold tabular-nums ${trendColor(data.change)}`}>
                  {data.change >= 0 ? '+' : ''}{data.change.toFixed(2)} ({fmtPct(data.change_percent)})
                </span>
                <span className="text-[10px] text-neutral-600">{data.exchange}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              {/* About */}
              <Section title="About">
                <p className="text-xs leading-relaxed text-neutral-300">{data.about.summary}</p>
                <p className="mt-2 text-xs leading-relaxed text-neutral-400">{data.about.description}</p>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] sm:grid-cols-4">
                  <Kv k="CEO" v={data.about.ceo} />
                  <Kv k="Headquarters" v={data.about.headquarters} />
                  <Kv k="Founded" v={String(data.about.founded)} />
                  <Kv k="Employees" v={data.about.employees > 0 ? data.about.employees.toLocaleString('en-US') : '—'} />
                </div>
              </Section>

              {/* Products & services */}
              {data.products.length > 0 && (
                <Section title="Products & Services">
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {data.products.map((p) => (
                      <div key={p} className="flex items-start gap-1.5 rounded border border-[#1e2530] bg-[#0b0e13] px-2 py-1.5">
                        <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-[#f5a524]" />
                        <span className="text-[11px] leading-snug text-neutral-300">{p}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Key statistics */}
              <Section title="Key Statistics">
                <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-[10px] sm:grid-cols-4">
                  <Kv k="Market Cap" v={fmtMoney(data.stats.market_cap)} />
                  <Kv k="P/E (ttm)" v={data.stats.pe_ratio ? data.stats.pe_ratio.toFixed(1) : '—'} />
                  <Kv k="EPS (ttm)" v={`$${data.stats.eps_ttm.toFixed(2)}`} />
                  <Kv k="Div Yield" v={data.stats.dividend_yield > 0 ? `${data.stats.dividend_yield.toFixed(1)}%` : '—'} />
                  <Kv k="Beta" v={data.stats.beta.toFixed(2)} />
                  <Kv k="52W Range" v={`$${data.stats.week52_low.toFixed(2)}–$${data.stats.week52_high.toFixed(2)}`} />
                  <Kv k="Volume" v={fmtVol(data.stats.volume)} />
                  <Kv k="Avg Volume" v={fmtVol(data.stats.avg_volume)} />
                  {data.stats.revenue_ttm_b != null && <Kv k="Revenue (ttm)" v={`$${data.stats.revenue_ttm_b.toFixed(1)}B`} />}
                  {data.stats.revenue_growth != null && <Kv k="Rev Growth" v={fmtPct(data.stats.revenue_growth)} />}
                  {data.stats.gross_margin != null && <Kv k="Gross Margin" v={`${data.stats.gross_margin.toFixed(0)}%`} />}
                  {data.stats.net_margin != null && (
                    <Kv k="Net Margin" v={`${data.stats.net_margin.toFixed(0)}%`} danger={data.stats.net_margin < 0} />
                  )}
                </div>
              </Section>

              {/* Quarterly financials */}
              <Section title="Quarterly Financials">
                <table className="w-full text-[10px] tabular-nums">
                  <thead>
                    <tr className="border-b border-[#1e2530] text-left text-neutral-600">
                      <th className="py-1 pr-2 font-medium">Quarter</th>
                      <th className="py-1 pr-2 font-medium">Reported</th>
                      <th className="py-1 pr-2 text-right font-medium">EPS</th>
                      <th className="py-1 pr-2 text-right font-medium">Est.</th>
                      <th className="py-1 pr-2 text-right font-medium">Surprise</th>
                      <th className="py-1 pr-2 text-right font-medium">Revenue</th>
                      <th className="py-1 text-right font-medium">YoY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.financials.quarterly.slice().reverse().map((r) => (
                      <tr key={`${r.quarter}-${r.reportDate}`} className="border-b border-[#161b24] text-neutral-300">
                        <td className="py-1 pr-2 font-semibold text-neutral-200">{r.quarter}</td>
                        <td className="py-1 pr-2 text-neutral-500">{r.reportDate}</td>
                        <td className={`py-1 pr-2 text-right font-semibold ${r.epsActual >= r.epsEstimate ? 'text-[#16c784]' : 'text-[#ea3943]'}`}>
                          ${r.epsActual.toFixed(2)}
                        </td>
                        <td className="py-1 pr-2 text-right text-neutral-500">${r.epsEstimate.toFixed(2)}</td>
                        <td className={`py-1 pr-2 text-right ${r.epsSurprise >= 0 ? 'text-[#16c784]' : 'text-[#ea3943]'}`}>
                          {r.epsSurprise >= 0 ? '+' : ''}{r.epsSurprise.toFixed(1)}%
                        </td>
                        <td className="py-1 pr-2 text-right">${r.revenueB.toFixed(2)}B</td>
                        <td className={`py-1 text-right ${trendColor(r.revYoY)}`}>{r.revYoY >= 0 ? '+' : ''}{r.revYoY.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 text-[10px] text-neutral-400">
                  <span className="font-semibold uppercase tracking-wide text-[#f5a524]">Next report</span>
                  <span>{new Date(data.financials.next_report.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} UTC</span>
                  <span>· EPS consensus ${data.financials.next_report.eps_consensus.toFixed(2)}</span>
                  <span>· Revenue est. ${data.financials.next_report.revenue_consensus_b.toFixed(2)}B</span>
                </div>
              </Section>

              {/* Peers */}
              {data.peers.length > 0 && (
                <Section title={`${data.sector} Peers`}>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {data.peers.map((p) => (
                      <button
                        key={p.symbol}
                        onClick={() => { setSymbol(p.symbol); void load(p.symbol) }}
                        className="flex items-center justify-between rounded border border-[#1e2530] bg-[#0b0e13] px-2 py-1.5 text-left hover:border-[#f5a52466]"
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-neutral-200">{p.symbol}</div>
                          <div className="truncate text-[9px] text-neutral-500">{p.name}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] tabular-nums text-neutral-200">${p.last.toFixed(2)}</div>
                          <div className={`text-[9px] tabular-nums ${trendColor(p.change_percent)}`}>{fmtPct(p.change_percent)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {/* Recent news */}
              {data.news.length > 0 && (
                <Section title="Recent News">
                  <div className="space-y-1.5">
                    {data.news.map((n) => (
                      <div key={n.id} className="rounded border border-[#1e2530] bg-[#0b0e13] px-2 py-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-[11px] font-medium leading-snug text-neutral-200">{n.headline}</div>
                          <span className={`shrink-0 text-[9px] font-bold ${trendColor(n.sentiment)}`}>
                            {n.sentiment > 0.15 ? '▲' : n.sentiment < -0.15 ? '▼' : '■'}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[9px] text-neutral-600">
                          {n.source} · {new Date(n.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              <p className="border-t border-[#1e2530] pt-2 text-[9px] leading-relaxed text-neutral-700">
                Company information provided by Meridian Market Data. Financial figures are as reported; consensus estimates are compiled from covering analysts and are subject to revision. Nothing here is investment advice.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-500">{title}</h4>
      {children}
    </section>
  )
}

function Kv({ k, v, danger }: { k: string; v: string; danger?: boolean }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-neutral-600">{k}</div>
      <div className={`truncate text-[11px] font-medium tabular-nums ${danger ? 'text-[#ea3943]' : 'text-neutral-300'}`}>{v}</div>
    </div>
  )
}
