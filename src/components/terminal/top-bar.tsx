'use client'

import { useEffect, useState } from 'react'
import { useTerminal } from '@/lib/client/store'
import { fmtNum, fmtPct, trendColor } from '@/lib/client/format'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

export function TopBar({ onOpenAccount, onOpenAuth, onOpenDocs }: { onOpenAccount: () => void; onOpenAuth: () => void; onOpenDocs: () => void }) {
  const indices = useTerminal((s) => s.indices)
  const status = useTerminal((s) => s.status)
  const account = useTerminal((s) => s.account)
  const connected = useTerminal((s) => s.connected)
  const [clock, setClock] = useState('')

  useEffect(() => {
    const tick = () => {
      setClock(new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const sessionColor =
    status?.session === 'regular' ? 'bg-[#16c784]' : status?.session === 'pre_market' || status?.session === 'post_market' ? 'bg-[#f5a524]' : 'bg-[#8b95a7]'

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[#1e2530] bg-[#0b0e13] px-3">
      {/* brand */}
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded bg-[#f5a524] font-black text-black">M</div>
        <div className="leading-none">
          <div className="text-[15px] font-bold tracking-tight text-neutral-100">
            MERIDIAN <span className="text-[#f5a524]">EXCHANGE</span>
          </div>
          <div className="text-[10px] text-neutral-500">24/7 US Equities · Member MRX/SIPC · meridian.exchange</div>
        </div>
      </div>

      {/* indices */}
      <div className="hidden min-w-0 flex-1 items-center gap-4 overflow-x-auto px-2 md:flex" aria-label="index ticker">
        {indices && (
          <>
            <IndexChip name="MRX Composite" level={indices.composite.level} chg={indices.composite.chg} chgp={indices.composite.chgp} />
            {Object.entries(indices.sectors).map(([sec, ix]) => (
              <IndexChip key={sec} name={sec} level={ix.level} chg={ix.chg} chgp={ix.chgp} />
            ))}
            <IndexChip name="MVIX" level={indices.mvix} chg={indices.mvix - 21.4} chgp={indices.mvix - 21.4} vol />
          </>
        )}
      </div>

      {/* status + clock */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-[#1e2530] bg-[#12161d] px-2.5 py-1.5">
          <span className={`size-2 rounded-full ${sessionColor} ${status?.paused ? 'animate-pulse bg-red-500' : ''}`} />
          <div className="leading-none">
            <div className="text-[11px] font-semibold text-neutral-200">{status?.paused ? 'MARKET PAUSED' : status?.session_label ?? '—'}</div>
            <div className="text-[10px] text-neutral-500">{status?.date} · {clock} ET</div>
          </div>
        </div>
        <div className={`hidden items-center gap-1.5 text-[10px] sm:flex ${connected ? 'text-[#16c784]' : 'text-[#ea3943]'}`}>
          <span className={`size-1.5 rounded-full ${connected ? 'bg-[#16c784]' : 'bg-[#ea3943] animate-pulse'}`} />
          {connected ? 'LIVE' : 'CONNECTING'}
        </div>
      </div>

      {/* account */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenDocs}
          className="hidden h-9 items-center rounded-md border border-[#1e2530] bg-[#12161d] px-3 text-xs font-medium text-neutral-300 hover:border-[#f5a524]/50 hover:text-white md:flex"
        >
          API Docs
        </button>
        {account ? (
          <Dialog>
            <DialogTrigger asChild>
              <button className="flex h-9 items-center gap-2 rounded-md border border-[#1e2530] bg-[#12161d] px-3 hover:border-[#f5a524]/50">
                <div className="text-left leading-none">
                  <div className="text-[11px] font-semibold text-neutral-100">{account.handle}</div>
                  <div className="text-[10px] text-neutral-400 tabular-nums">
                    ${fmtNum(account.portfolio_value)} <span className={trendColor(account.portfolio_value - 100000)}>{fmtPct((account.portfolio_value / 100000 - 1) * 100)}</span>
                  </div>
                </div>
              </button>
            </DialogTrigger>
            <DialogContent className="border-[#1e2530] bg-[#12161d] text-neutral-200 sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-neutral-100">Account</DialogTitle>
              </DialogHeader>
              <button onClick={onOpenAccount} className="w-full rounded-md border border-[#1e2530] bg-[#0b0e13] px-3 py-2 text-left text-sm hover:border-[#f5a524]/50">
                Account details & API keys →
              </button>
            </DialogContent>
          </Dialog>
        ) : (
          <button
            onClick={onOpenAuth}
            className="h-9 rounded-md bg-[#f5a524] px-4 text-xs font-bold text-black hover:bg-[#ffb838]"
          >
            Sign In / Open Account
          </button>
        )}
      </div>
    </header>
  )
}

function IndexChip({ name, level, chg, chgp, vol }: { name: string; level: number; chg: number; chgp: number; vol?: boolean }) {
  return (
    <div className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">{name}</span>
      <span className="text-[12px] font-semibold tabular-nums text-neutral-200">{vol ? level.toFixed(2) : fmtNum(level)}</span>
      <span className={`text-[11px] tabular-nums ${trendColor(chgp)}`}>{fmtPct(chgp)}</span>
    </div>
  )
}
