'use client'

import { useMemo, useState } from 'react'
import { useTerminal } from '@/lib/client/store'
import { fmtPct, fmtVol, trendColor } from '@/lib/client/format'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

export function Watchlist() {
  const securities = useTerminal((s) => s.securities)
  const quotes = useTerminal((s) => s.quotes)
  const selected = useTerminal((s) => s.selected)
  const select = useTerminal((s) => s.select)
  const flash = useTerminal((s) => s.flash)
  const [query, setQuery] = useState('')
  const [sector, setSector] = useState('All')

  const sectors = useMemo(() => ['All', ...Array.from(new Set(securities.map((s) => s.sector)))], [securities])
  const rows = useMemo(() => {
    let r = securities
    if (sector !== 'All') r = r.filter((s) => s.sector === sector)
    if (query) {
      const q = query.toLowerCase()
      r = r.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
    }
    return r
  }, [securities, sector, query])

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-[#1e2530] bg-[#0d1117]">
      <div className="border-b border-[#1e2530] p-2.5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search MRX securities…"
          className="h-8 border-[#1e2530] bg-[#12161d] text-xs text-neutral-200 placeholder:text-neutral-600 focus-visible:ring-[#f5a524]/40"
        />
        <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
          {sectors.map((s) => (
            <button
              key={s}
              onClick={() => setSector(s)}
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                sector === s ? 'bg-[#f5a524] text-black' : 'bg-[#12161d] text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div>
          {rows.map((sec) => {
            const q = quotes[sec.symbol]
            const pct = q?.chgp ?? sec.change_percent
            const f = flash[sec.symbol]
            return (
              <button
                key={sec.symbol}
                onClick={() => select(sec.symbol)}
                className={`flex w-full items-center justify-between px-2.5 py-[7px] text-left transition-colors ${
                  selected === sec.symbol ? 'bg-[#1a2029]' : 'hover:bg-[#141922]'
                } ${f === 'up' ? 'flash-up' : f === 'down' ? 'flash-down' : ''}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[12px] font-bold tabular-nums ${selected === sec.symbol ? 'text-[#f5a524]' : 'text-neutral-200'}`}>{sec.symbol}</span>
                    {sec.kind === 'etf' && <span className="rounded bg-[#1e2530] px-1 text-[8px] font-bold text-neutral-400">ETF</span>}
                    {q?.halted && <span className="rounded bg-[#ea3943] px-1 text-[8px] font-bold text-white">HALT</span>}
                  </div>
                  <div className="max-w-[130px] truncate text-[10px] text-neutral-500">{sec.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-[12px] font-semibold tabular-nums text-neutral-100">{(q?.p ?? sec.last).toFixed(2)}</div>
                  <div className={`text-[10px] tabular-nums ${trendColor(pct)}`}>{fmtPct(pct)}</div>
                </div>
                <div className="ml-2 hidden w-10 text-right text-[9px] tabular-nums text-neutral-600 lg:block">{fmtVol(q?.v ?? 0)}</div>
              </button>
            )
          })}
          {rows.length === 0 && <div className="p-4 text-center text-xs text-neutral-600">No securities match.</div>}
        </div>
      </ScrollArea>
      <div className="border-t border-[#1e2530] px-2.5 py-1.5 text-[9px] leading-tight text-neutral-600">
        Market data by Meridian Data Services. Prices reflect consolidated MRX tape.
      </div>
    </div>
  )
}
