'use client'

import { useEffect, useState } from 'react'
import { useTerminal } from '@/lib/client/store'
import { api } from '@/lib/client/api'
import { fmtTime, fmtVol } from '@/lib/client/format'
import { ScrollArea } from '@/components/ui/scroll-area'

interface BookLevel { price: number; size: number }
interface TapeRow { t: number; price: number; size: number; aggressor: string }

export function BookPanel() {
  const selected = useTerminal((s) => s.selected)
  const quotes = useTerminal((s) => s.quotes)
  const [bids, setBids] = useState<BookLevel[]>([])
  const [asks, setAsks] = useState<BookLevel[]>([])
  const [tape, setTape] = useState<TapeRow[]>([])
  const [view, setView] = useState<'book' | 'tape'>('book')

  const q = quotes[selected]

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const book = await api.get<{ bids: BookLevel[]; asks: BookLevel[] }>(`/api/v1/market/orderbook?symbol=${selected}`)
        const trades = await api.get<{ trades: TapeRow[] }>(`/api/v1/market/trades?symbol=${selected}&limit=40`)
        if (!cancelled) {
          setBids(book.bids)
          setAsks(book.asks)
          setTape(trades.trades)
        }
      } catch {
        // ignore
      }
    }
    load()
    const id = setInterval(load, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [selected])

  const maxSize = Math.max(1, ...bids.map((b) => b.size), ...asks.map((a) => a.size))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex border-b border-[#1e2530]">
        <button onClick={() => setView('book')} className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider ${view === 'book' ? 'border-b-2 border-[#f5a524] text-neutral-100' : 'text-neutral-500'}`}>
          Order Book
        </button>
        <button onClick={() => setView('tape')} className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider ${view === 'tape' ? 'border-b-2 border-[#f5a524] text-neutral-100' : 'text-neutral-500'}`}>
          Time & Sales
        </button>
      </div>

      {view === 'book' ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2 text-[11px]">
            <div className="mb-1 grid grid-cols-3 text-[9px] uppercase tracking-wide text-neutral-600">
              <span>Price</span>
              <span className="text-right">Size</span>
              <span className="text-right">Total</span>
            </div>
            {/* asks reversed (highest first) */}
            <div className="mb-1.5 space-y-px">
              {[...asks].reverse().slice(0, 7).map((a, i) => (
                <LevelRow key={`a${i}`} level={a} max={maxSize} side="ask" />
              ))}
            </div>
            <div className="my-1 flex items-center justify-between rounded bg-[#12161d] px-1.5 py-1 text-[10px]">
              <span className="font-bold tabular-nums text-neutral-100">{q ? q.p.toFixed(2) : '—'}</span>
              <span className="text-neutral-500">spread {q ? (q.a - q.b).toFixed(2) : '—'}</span>
            </div>
            <div className="space-y-px">
              {bids.slice(0, 7).map((b, i) => (
                <LevelRow key={`b${i}`} level={b} max={maxSize} side="bid" />
              ))}
            </div>
          </div>
        </ScrollArea>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2 text-[10px]">
            <div className="mb-1 grid grid-cols-3 text-[9px] uppercase tracking-wide text-neutral-600">
              <span>Time</span>
              <span className="text-right">Price</span>
              <span className="text-right">Size</span>
            </div>
            {tape.map((t, i) => (
              <div key={i} className="grid grid-cols-3 py-[1px] tabular-nums">
                <span className="text-neutral-500">{fmtTime(t.t)}</span>
                <span className={`text-right font-semibold ${t.aggressor === 'B' ? 'text-[#16c784]' : t.aggressor === 'S' ? 'text-[#ea3943]' : 'text-neutral-300'}`}>{t.price.toFixed(2)}</span>
                <span className="text-right text-neutral-400">{fmtVol(t.size)}</span>
              </div>
            ))}
            {tape.length === 0 && <div className="py-6 text-center text-neutral-600">Awaiting trades…</div>}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

function LevelRow({ level, max, side }: { level: BookLevel; max: number; side: 'bid' | 'ask' }) {
  const pct = Math.min(100, (level.size / max) * 100)
  return (
    <div className="relative grid grid-cols-3 py-[1px] tabular-nums">
      <div
        className={`absolute inset-y-0 right-0 ${side === 'bid' ? 'bg-[#16c784]/12' : 'bg-[#ea3943]/12'}`}
        style={{ width: `${pct}%` }}
      />
      <span className={`relative font-semibold ${side === 'bid' ? 'text-[#16c784]' : 'text-[#ea3943]'}`}>{level.price.toFixed(2)}</span>
      <span className="relative text-right text-neutral-300">{fmtVol(level.size)}</span>
      <span className="relative text-right text-neutral-600">{fmtVol(level.size)}</span>
    </div>
  )
}
