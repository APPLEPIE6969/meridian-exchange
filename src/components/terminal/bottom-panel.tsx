'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTerminal, type OrderView } from '@/lib/client/store'
import { api } from '@/lib/client/api'
import { fmtNum, fmtPct, fmtSigned, fmtVol, agoLabel, trendColor } from '@/lib/client/format'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'

type Tab = 'positions' | 'orders' | 'history' | 'news' | 'board'

export function BottomPanel({ onChanged, onNeedAuth }: { onChanged: () => void; onNeedAuth: () => void }) {
  const [tab, setTab] = useState<Tab>('positions')
  const account = useTerminal((s) => s.account)

  const tabs: { key: Tab; label: string }[] = [
    { key: 'positions', label: 'Positions' },
    { key: 'orders', label: 'Orders' },
    { key: 'history', label: 'History' },
    { key: 'news', label: 'News' },
    { key: 'board', label: 'Leaderboard' },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-[#1e2530] bg-[#0b0e13]">
      <div className="flex shrink-0 items-center border-b border-[#1e2530] px-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wider ${
              tab === t.key ? 'border-b-2 border-[#f5a524] text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t.label}
          </button>
        ))}
        {!account && tab !== 'news' && tab !== 'board' && (
          <button onClick={onNeedAuth} className="ml-auto mr-2 text-[10px] text-[#f5a524] hover:underline">Sign in to view your account</button>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {tab === 'positions' && <PositionsPanel onChanged={onChanged} />}
          {tab === 'orders' && <OrdersPanel onChanged={onChanged} />}
          {tab === 'history' && <HistoryPanel />}
          {tab === 'news' && <NewsPanel />}
          {tab === 'board' && <LeaderboardPanel />}
        </div>
      </ScrollArea>
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div className="py-8 text-center text-xs text-neutral-600">{msg}</div>
}

function PositionsPanel({ onChanged }: { onChanged: () => void }) {
  const account = useTerminal((s) => s.account)
  const positions = useTerminal((s) => s.positions)
  const quotes = useTerminal((s) => s.quotes)
  const select = useTerminal((s) => s.select)
  void onChanged
  if (!account) return <Empty msg="Sign in to view positions." />
  if (positions.length === 0) return <Empty msg="No open positions. Place your first trade above." />

  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-left text-[9px] uppercase tracking-wide text-neutral-600">
          <th className="pb-1">Symbol</th>
          <th className="pb-1 text-right">Qty</th>
          <th className="pb-1 text-right">Avg Entry</th>
          <th className="pb-1 text-right">Last</th>
          <th className="pb-1 text-right">Mkt Value</th>
          <th className="pb-1 text-right">Unrealized P/L</th>
          <th className="pb-1 text-right">P/L %</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => {
          const q = quotes[p.symbol]
          const last = q?.p ?? Number(p.market_price)
          const qty = Number(p.qty)
          return (
            <tr key={p.symbol} className="cursor-pointer border-t border-[#161b24] hover:bg-[#12161d]" onClick={() => select(p.symbol)}>
              <td className="py-1.5 font-bold text-neutral-200">
                {p.symbol} <span className={`ml-1 rounded px-1 text-[8px] font-bold ${qty >= 0 ? 'bg-[#16c784]/15 text-[#16c784]' : 'bg-[#ea3943]/15 text-[#ea3943]'}`}>{qty >= 0 ? 'LONG' : 'SHORT'}</span>
              </td>
              <td className="text-right tabular-nums text-neutral-300">{fmtNum(qty, 4)}</td>
              <td className="text-right tabular-nums text-neutral-400">{Number(p.avg_entry_price).toFixed(2)}</td>
              <td className="text-right tabular-nums text-neutral-200">{last.toFixed(2)}</td>
              <td className="text-right tabular-nums text-neutral-300">${fmtNum(p.market_value)}</td>
              <td className={`text-right tabular-nums ${trendColor(p.unrealized_pl)}`}>{fmtSigned(p.unrealized_pl)}</td>
              <td className={`text-right tabular-nums ${trendColor(p.unrealized_plpc * 100)}`}>{fmtPct(p.unrealized_plpc * 100)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function OrdersPanel({ onChanged }: { onChanged: () => void }) {
  const account = useTerminal((s) => s.account)
  const orders = useTerminal((s) => s.orders)
  const setOrders = useTerminal((s) => s.setOrders)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (status: string) => {
    const res = await api.get<{ orders: OrderView[] }>(`/api/v1/orders?status=${status}&limit=50`)
    setOrders(res.orders)
  }, [setOrders])

  useEffect(() => {
    if (!account) return
    void load('all')
  }, [account?.id, load])

  if (!account) return <Empty msg="Sign in to view orders." />

  const cancel = async (id: string) => {
    setBusy(id)
    try {
      await api.del(`/api/v1/orders/${id}`)
      toast.success('Order canceled.')
      await load('all')
      onChanged()
    } catch {
      toast.error('Could not cancel order.')
    } finally {
      setBusy(null)
    }
  }

  if (orders.length === 0) return <Empty msg="No orders yet." />

  const statusColor: Record<string, string> = {
    filled: 'bg-[#16c784]/15 text-[#16c784]',
    accepted: 'bg-[#f5a524]/15 text-[#f5a524]',
    new: 'bg-[#f5a524]/15 text-[#f5a524]',
    partially_filled: 'bg-[#f5a524]/15 text-[#f5a524]',
    canceled: 'bg-neutral-600/20 text-neutral-400',
    expired: 'bg-neutral-600/20 text-neutral-400',
    rejected: 'bg-[#ea3943]/15 text-[#ea3943]',
  }

  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-left text-[9px] uppercase tracking-wide text-neutral-600">
          <th className="pb-1">Time</th>
          <th className="pb-1">Symbol</th>
          <th className="pb-1">Side</th>
          <th className="pb-1">Type</th>
          <th className="pb-1 text-right">Qty</th>
          <th className="pb-1 text-right">Filled</th>
          <th className="pb-1 text-right">Avg Px</th>
          <th className="pb-1">TIF</th>
          <th className="pb-1">Status</th>
          <th className="pb-1 text-right"></th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => {
          const open = ['new', 'accepted', 'partially_filled'].includes(o.status)
          return (
            <tr key={o.id} className="border-t border-[#161b24]">
              <td className="py-1.5 text-neutral-500">{agoLabel(o.created_at)}</td>
              <td className="font-bold text-neutral-200">{o.symbol}</td>
              <td className={o.side === 'buy' ? 'text-[#16c784]' : 'text-[#ea3943]'}>{o.side.toUpperCase()}</td>
              <td className="text-neutral-400">{o.order_type.replace('_', ' ')}{o.limit_price ? ` @ ${Number(o.limit_price).toFixed(2)}` : ''}{o.stop_price ? ` ⛔${Number(o.stop_price).toFixed(2)}` : ''}</td>
              <td className="text-right tabular-nums text-neutral-300">{fmtNum(Number(o.qty), 2)}</td>
              <td className="text-right tabular-nums text-neutral-400">{fmtNum(Number(o.filled_qty), 2)}</td>
              <td className="text-right tabular-nums text-neutral-300">{o.filled_avg_price ? Number(o.filled_avg_price).toFixed(2) : '—'}</td>
              <td className="text-neutral-500">{o.time_in_force.toUpperCase()}</td>
              <td>
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${statusColor[o.status] ?? 'bg-neutral-700 text-neutral-300'}`} title={o.reject_reason ?? ''}>
                  {o.status.replace('_', ' ').toUpperCase()}
                </span>
              </td>
              <td className="text-right">
                {open && (
                  <button onClick={() => cancel(o.id)} disabled={busy === o.id} className="text-[10px] text-[#ea3943] hover:underline disabled:opacity-40">
                    {busy === o.id ? '…' : 'Cancel'}
                  </button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function HistoryPanel() {
  const account = useTerminal((s) => s.account)
  const activities = useTerminal((s) => s.activities)
  const setActivities = useTerminal((s) => s.setActivities)

  useEffect(() => {
    if (!account) return
    api.get<{ activities: typeof activities }>('/api/v1/account/activities?limit=100')
      .then((res) => setActivities(res.activities))
      .catch(() => undefined)
  }, [account, setActivities])

  if (!account) return <Empty msg="Sign in to view trade history." />
  if (activities.length === 0) return <Empty msg="No fills yet." />

  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-left text-[9px] uppercase tracking-wide text-neutral-600">
          <th className="pb-1">Time</th>
          <th className="pb-1">Symbol</th>
          <th className="pb-1">Side</th>
          <th className="pb-1 text-right">Qty</th>
          <th className="pb-1 text-right">Price</th>
          <th className="pb-1 text-right">Fee</th>
          <th className="pb-1 text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {activities.map((a) => (
          <tr key={a.id} className="border-t border-[#161b24]">
            <td className="py-1.5 text-neutral-500">{agoLabel(a.transaction_time)}</td>
            <td className="font-bold text-neutral-200">{a.symbol}</td>
            <td className={a.side === 'buy' ? 'text-[#16c784]' : 'text-[#ea3943]'}>{a.side.toUpperCase()}</td>
            <td className="text-right tabular-nums text-neutral-300">{fmtVol(Number(a.qty))}</td>
            <td className="text-right tabular-nums text-neutral-300">{Number(a.price).toFixed(2)}</td>
            <td className="text-right tabular-nums text-neutral-600">{Number(a.fee) > 0 ? `$${Number(a.fee).toFixed(2)}` : '—'}</td>
            <td className={`text-right tabular-nums ${trendColor(Number(a.amount))}`}>{fmtSigned(Number(a.amount))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function NewsPanel() {
  const news = useTerminal((s) => s.news)
  const select = useTerminal((s) => s.select)
  const [expanded, setExpanded] = useState<string | null>(null)

  if (news.length === 0) return <Empty msg="Loading the wire…" />

  return (
    <div className="space-y-1">
      {news.slice(0, 40).map((n) => {
        const symbols = JSON.parse(n.symbols || '[]') as string[]
        const isOpen = expanded === n.id
        return (
          <div key={n.id} className="rounded border border-[#161b24] bg-[#0f1319] px-2.5 py-1.5">
            {/* expand toggle — must NOT be a <button>: ticker chips below are
                real <button>s and HTML forbids nested interactive buttons */}
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              className="w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#f5a524]/60"
              onClick={() => setExpanded(isOpen ? null : n.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setExpanded(isOpen ? null : n.id)
                }
              }}
            >
              <div className="flex items-start gap-2">
                <span className={`mt-[3px] size-1.5 shrink-0 rounded-full ${n.sentiment > 0.15 ? 'bg-[#16c784]' : n.sentiment < -0.15 ? 'bg-[#ea3943]' : 'bg-neutral-500'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] font-medium leading-snug text-neutral-200">{n.headline}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px] text-neutral-600">
                    <span className="font-semibold text-neutral-500">{n.source}</span>
                    <span>·</span>
                    <span>{agoLabel(n.createdAt)}</span>
                    {/* dedupe: a headline can cite the same ticker twice —
                        duplicate React keys would corrupt reconciliation */}
                    {Array.from(new Set(symbols)).slice(0, 4).map((s) => (
                      <button
                        key={s}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!s.startsWith('@') && !s.startsWith('*')) select(s)
                        }}
                        className="rounded bg-[#1e2530] px-1 font-bold text-[#f5a524] hover:bg-[#f5a524] hover:text-black"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            {isOpen && <p className="mt-1.5 pl-4 text-[11px] leading-relaxed text-neutral-400">{n.body}</p>}
          </div>
        )
      })}
    </div>
  )
}

interface BoardRow {
  rank: number
  handle: string
  equity: number
  return_pct: number
  trades: number
}

function LeaderboardPanel() {
  const [rows, setRows] = useState<BoardRow[]>([])
  useEffect(() => {
    const load = () => api.get<{ leaderboard: BoardRow[] }>('/api/v1/leaderboard?limit=20').then((r) => setRows(r.leaderboard)).catch(() => undefined)
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [])
  if (rows.length === 0) return <Empty msg="No traders ranked yet." />
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-left text-[9px] uppercase tracking-wide text-neutral-600">
          <th className="pb-1">#</th>
          <th className="pb-1">Trader</th>
          <th className="pb-1 text-right">Equity</th>
          <th className="pb-1 text-right">Return</th>
          <th className="pb-1 text-right">Fills</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.handle} className="border-t border-[#161b24]">
            <td className="py-1.5 font-bold text-neutral-500">{r.rank}</td>
            <td className="font-semibold text-neutral-200">{r.handle}</td>
            <td className="text-right tabular-nums text-neutral-300">${fmtNum(r.equity)}</td>
            <td className={`text-right font-semibold tabular-nums ${trendColor(r.return_pct)}`}>{fmtPct(r.return_pct)}</td>
            <td className="text-right tabular-nums text-neutral-500">{r.trades}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
