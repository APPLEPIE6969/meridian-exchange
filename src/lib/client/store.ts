'use client'

import { create } from 'zustand'

export interface Quote {
  s: string
  p: number
  b: number
  a: number
  bs: number
  as: number
  o: number
  h: number
  l: number
  pc: number
  v: number
  chg: number
  chgp: number
  halted: boolean
  t: number
}

export interface IndexState {
  composite: { symbol: string; name: string; level: number; chg: number; chgp: number }
  mvix: number
  sectors: Record<string, { level: number; chg: number; chgp: number }>
  ts: number
}

export interface SecurityRow {
  symbol: string
  name: string
  sector: string
  kind: string
  last: number
  volume: number
  market_cap: number
  change_percent: number
  avg_volume: number
  pe_ratio: number | null
  dividend_yield: number
  week52_high: number
  week52_low: number
}

export interface NewsItem {
  id: string
  headline: string
  body: string
  source: string
  kind: string
  symbols: string
  sentiment: number
  impactBps: number
  createdAt: string
}

export interface AccountView {
  id: string
  account_number: string
  email?: string
  name?: string
  handle: string
  status: string
  cash: number
  portfolio_value: number
  equity: number
  buying_power: number
  buying_power_available: number
  long_market_value: number
  short_market_value: number
  daytrade_count: number
  created_at: string
}

export interface PositionView {
  symbol: string
  qty: string
  side: string
  avg_entry_price: string
  market_price: string
  market_value: number
  cost_basis: number
  unrealized_pl: number
  unrealized_plpc: number
  change_today: number
}

export interface OrderView {
  id: string
  client_order_id: string | null
  created_at: string
  filled_at: string | null
  status: string
  symbol: string
  qty: string
  filled_qty: string
  filled_avg_price: string | null
  order_type: string
  side: string
  time_in_force: string
  limit_price: string | null
  stop_price: string | null
  reject_reason: string | null
}

export interface ActivityView {
  id: string
  order_id: string
  symbol: string
  side: string
  qty: string
  price: string
  fee: string
  amount: string
  transaction_time: string
}

export interface BookLevel {
  price: number
  size: number
}

interface TerminalState {
  quotes: Record<string, Quote>
  prevPrices: Record<string, number>
  indices: IndexState | null
  securities: SecurityRow[]
  status: { session: string; session_label: string; date: string; time: string; weekday: string; open: boolean; paused?: boolean } | null
  news: NewsItem[]
  selected: string
  connected: boolean
  account: AccountView | null
  positions: PositionView[]
  orders: OrderView[]
  activities: ActivityView[]
  flash: Record<string, 'up' | 'down'>

  setQuotes: (quotes: Quote[], indices: IndexState) => void
  markFlash: () => void
  setSecurities: (rows: SecurityRow[]) => void
  setStatus: (s: TerminalState['status']) => void
  setNews: (items: NewsItem[]) => void
  prependNews: (item: NewsItem) => void
  select: (symbol: string) => void
  setConnected: (v: boolean) => void
  setAccount: (a: AccountView | null) => void
  setPositions: (p: PositionView[]) => void
  setOrders: (o: OrderView[]) => void
  setActivities: (a: ActivityView[]) => void
}

export const useTerminal = create<TerminalState>((set, get) => ({
  quotes: {},
  prevPrices: {},
  indices: null,
  securities: [],
  status: null,
  news: [],
  selected: 'QNTM',
  connected: false,
  account: null,
  positions: [],
  orders: [],
  activities: [],
  flash: {},

  setQuotes: (quotes, indices) => {
    const prev: Record<string, number> = {}
    const cur = get().quotes
    for (const q of quotes) prev[q.s] = cur[q.s]?.p ?? q.p
    set({ quotes: Object.fromEntries(quotes.map((q) => [q.s, q])), prevPrices: prev, indices })
  },

  markFlash: () => {
    // compute flash directions from the last two frames
    const { quotes, prevPrices } = get()
    const flash: Record<string, 'up' | 'down'> = {}
    for (const s in quotes) {
      const prev = prevPrices[s]
      if (prev !== undefined && quotes[s].p !== prev) flash[s] = quotes[s].p > prev ? 'up' : 'down'
    }
    set({ flash })
  },

  setSecurities: (rows) => set({ securities: rows }),
  setStatus: (s) => set({ status: s }),
  setNews: (items) => set({ news: items }),
  prependNews: (item) => set({ news: [item, ...get().news].slice(0, 120) }),
  select: (symbol) => set({ selected: symbol }),
  setConnected: (v) => set({ connected: v }),
  setAccount: (a) => set({ account: a }),
  setPositions: (p) => set({ positions: p }),
  setOrders: (o) => set({ orders: o }),
  setActivities: (a) => set({ activities: a }),
}))
