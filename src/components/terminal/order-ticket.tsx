'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTerminal } from '@/lib/client/store'
import { api, ApiClientError, getStoredApiKey } from '@/lib/client/api'
import { fmtNum } from '@/lib/client/format'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

type Side = 'buy' | 'sell'
type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit'

export function OrderTicket({ onChanged }: { onChanged: () => void }) {
  const selected = useTerminal((s) => s.selected)
  const quotes = useTerminal((s) => s.quotes)
  const account = useTerminal((s) => s.account)
  const positions = useTerminal((s) => s.positions)
  const q = quotes[selected]

  const [side, setSide] = useState<Side>('buy')
  const [type, setType] = useState<OrderType>('market')
  const [tif, setTif] = useState('day')
  const [qty, setQty] = useState('10')
  const [limitPrice, setLimitPrice] = useState('')
  const [stopPrice, setStopPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)

  useEffect(() => {
    if (q) {
      setLimitPrice(q.a.toFixed(2))
      setStopPrice((type === 'stop' ? (side === 'buy' ? q.a * 1.01 : q.b * 0.99) : q.p).toFixed(2))
    }

  }, [selected, q?.a, q?.b, side])

  const estQty = Number(qty) || 0
  const estPrice = type === 'limit' ? Number(limitPrice) || q?.a || 0 : type === 'stop_limit' ? Number(limitPrice) || q?.p || 0 : q?.p || 0
  const estCost = estQty * estPrice
  const pos = positions.find((p) => p.symbol === selected)
  const held = pos ? Math.abs(Number(pos.qty)) : 0

  const needsAuth = !account

  const submit = async () => {
    if (needsAuth) {
      setAuthOpen(true)
      window.dispatchEvent(new CustomEvent('mrx:open-auth'))
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        symbol: selected,
        side,
        type,
        time_in_force: tif,
      }
      if (type === 'limit' || type === 'stop_limit') body.limit_price = Number(limitPrice)
      if (type === 'stop' || type === 'stop_limit') body.stop_price = Number(stopPrice)
      const qtyNum = Number(qty)
      if (!qtyNum || qtyNum <= 0) {
        toast.error('Enter a valid quantity.')
        return
      }
      body.qty = Math.round(qtyNum * 10000) / 10000
      const res = await api.post<{ id: string; status: string; filled_avg_price: string | null }>('/api/v1/orders', body)
      if (res.status === 'filled') {
        toast.success(`${side === 'buy' ? 'Bought' : 'Sold'} ${qty} ${selected} @ $${res.filled_avg_price}`)
      } else if (res.status === 'canceled') {
        toast.info('Order canceled (no fill).')
      } else {
        toast.success(`Order accepted — ${res.status.replace('_', ' ')}`)
      }
      onChanged()
    } catch (e) {
      if (e instanceof ApiClientError) toast.error(`${e.code}: ${e.message}`)
      else toast.error('Order failed. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border-b border-[#1e2530] p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Order Ticket</span>
        <span className="text-[10px] text-neutral-600">{selected}</span>
      </div>

      {/* side toggle */}
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <button
          onClick={() => setSide('buy')}
          className={`h-9 rounded font-bold text-sm transition-colors ${
            side === 'buy' ? 'bg-[#16c784] text-black' : 'bg-[#12161d] text-[#16c784] hover:bg-[#16c784]/15'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`h-9 rounded font-bold text-sm transition-colors ${
            side === 'sell' ? 'bg-[#ea3943] text-white' : 'bg-[#12161d] text-[#ea3943] hover:bg-[#ea3943]/15'
          }`}
        >
          Sell
        </button>
      </div>

      {/* type + tif */}
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <Select value={type} onValueChange={(v) => setType(v as OrderType)}>
          <SelectTrigger className="h-8 border-[#1e2530] bg-[#12161d] text-xs text-neutral-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-[#1e2530] bg-[#12161d] text-neutral-200">
            <SelectItem value="market">Market</SelectItem>
            <SelectItem value="limit">Limit</SelectItem>
            <SelectItem value="stop">Stop</SelectItem>
            <SelectItem value="stop_limit">Stop Limit</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tif} onValueChange={setTif}>
          <SelectTrigger className="h-8 border-[#1e2530] bg-[#12161d] text-xs text-neutral-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-[#1e2530] bg-[#12161d] text-neutral-200">
            <SelectItem value="day">Day</SelectItem>
            <SelectItem value="gtc">GTC</SelectItem>
            <SelectItem value="ioc">IOC</SelectItem>
            <SelectItem value="fok">FOK</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* qty */}
      <div className="mb-2">
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">Quantity {pos ? `· held ${held}` : ''}</label>
        <Input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          type="number"
          min="0"
          step="any"
          className="h-8 border-[#1e2530] bg-[#12161d] text-sm tabular-nums text-neutral-100"
        />
      </div>

      {type !== 'market' && (
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {(type === 'limit' || type === 'stop_limit') && (
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">Limit</label>
              <Input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} type="number" step="any" className="h-8 border-[#1e2530] bg-[#12161d] text-sm tabular-nums text-neutral-100" />
            </div>
          )}
          {(type === 'stop' || type === 'stop_limit') && (
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">Stop</label>
              <Input value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} type="number" step="any" className="h-8 border-[#1e2530] bg-[#12161d] text-sm tabular-nums text-neutral-100" />
            </div>
          )}
        </div>
      )}

      {/* estimates */}
      <div className="mb-2 space-y-0.5 rounded bg-[#0f1319] p-2 text-[10px] text-neutral-500">
        <div className="flex justify-between">
          <span>Est. price</span>
          <span className="tabular-nums text-neutral-300">${estPrice.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>Est. cost</span>
          <span className="tabular-nums text-neutral-300">${fmtNum(estCost)}</span>
        </div>
        {account && (
          <div className="flex justify-between">
            <span>Buying power</span>
            <span className="tabular-nums text-neutral-300">${fmtNum(account.buying_power_available)}</span>
          </div>
        )}
      </div>

      <button
        onClick={submit}
        disabled={submitting || q?.halted}
        className={`h-9 w-full rounded font-bold text-sm transition-opacity disabled:opacity-40 ${
          side === 'buy' ? 'bg-[#16c784] text-black hover:bg-[#1ad693]' : 'bg-[#ea3943] text-white hover:bg-[#f04b54]'
        }`}
      >
        {q?.halted ? 'Halted' : submitting ? 'Submitting…' : `${side === 'buy' ? 'Buy' : 'Sell'} ${selected}`}
      </button>
      {needsAuth && <div className="mt-1.5 text-center text-[10px] text-neutral-600">Sign in to place orders · <button onClick={() => window.dispatchEvent(new CustomEvent('mrx:open-auth'))} className="text-[#f5a524] underline">open an account</button></div>}
      {!needsAuth && <div className="mt-1.5 text-center text-[9px] text-neutral-700">Market & limit orders routed to MRX book · $0 commission</div>}
    </div>
  )
}
