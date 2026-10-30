#!/usr/bin/env node
// ─── Meridian Exchange — MCP adapter ──────────────────────────────────────
// A Model Context Protocol server that exposes the MRX trading API as tools
// so MCP clients (Claude Desktop, Claude Code, Cursor, ...) can trade without
// touching HTTP. One process per account: point MRX_API_KEY at the account's
// mrx_live_ key in the client config — the key never appears in any tool
// result, only in the Authorization header of outbound calls.
//
// Config (env):
//   MRX_API_KEY   required — the account API key (mrx_live_...)
//   MRX_BASE_URL  optional — default http://localhost:3000/api/v1
//
// Transport: stdio, newline-delimited JSON-RPC 2.0 (MCP stdio framing).
// NOTHING may be written to stdout except protocol messages; diagnostics go
// to stderr. Tool descriptions are worded like a live brokerage — they must
// never reference testing or simulation.

import { createInterface } from 'node:readline'

const BASE_URL = (process.env.MRX_BASE_URL || 'http://localhost:3000/api/v1').replace(/\/+$/, '')
const API_KEY = process.env.MRX_API_KEY || ''
const SERVER = { name: 'meridian-exchange', version: '1.0.0' }
const PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18']

if (!API_KEY) {
  console.error('[meridian-exchange] MRX_API_KEY is not set. Add it to the MCP server config env block.')
  process.exit(1)
}

// ── MRX REST helper ───────────────────────────────────────────────────────
async function mrx(method, path, body) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = json?.error ?? { code: `HTTP_${res.status}`, message: text.slice(0, 300) }
    const e = new Error(JSON.stringify(err))
    e.isApiError = true
    e.payload = err
    throw e
  }
  return json
}

const num = { type: 'number' }
const str = { type: 'string' }

// ── Tool catalog ──────────────────────────────────────────────────────────
// Descriptions are customer-facing copy: plain brokerage language only.
const TOOLS = [
  {
    name: 'get_market_status',
    description: 'Current Meridian Exchange session: open/closed, session phase (pre/regular/post/overnight) and exchange clock.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_securities',
    description: 'List securities traded on Meridian Exchange, optionally filtered by sector or name/symbol search.',
    inputSchema: { type: 'object', properties: { sector: { ...str, description: 'e.g. Technology, Energy' }, search: { ...str, description: 'Free-text symbol/name filter' } } },
  },
  {
    name: 'get_quote',
    description: 'Latest quotes for one or more symbols: bid/ask and sizes, last price, day change, volume, 52-week range.',
    inputSchema: { type: 'object', properties: { symbols: { ...str, description: 'Comma-separated symbols, e.g. QNTM,HELX' } }, required: ['symbols'] },
  },
  {
    name: 'get_candles',
    description: 'OHLCV price bars for a symbol. timeframe: 1m, 5m, 15m, 1h or 1d; limit caps the number of bars.',
    inputSchema: { type: 'object', properties: { symbol: str, timeframe: { ...str, enum: ['1m', '5m', '15m', '1h', '1d'] }, limit: { ...num, maximum: 500 } }, required: ['symbol'] },
  },
  {
    name: 'get_orderbook',
    description: 'Level-2 order book for a symbol: aggregated bid and ask depth, 10 levels per side.',
    inputSchema: { type: 'object', properties: { symbol: str }, required: ['symbol'] },
  },
  {
    name: 'get_trades',
    description: 'Recent time-and-sales tape for a symbol (price, size, timestamp).',
    inputSchema: { type: 'object', properties: { symbol: str, limit: { ...num, maximum: 200 } }, required: ['symbol'] },
  },
  {
    name: 'get_movers',
    description: "Today's top gainers, losers and most active securities.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_indices',
    description: 'Index snapshot: MRX Composite (MRC), sector indices and the MVIX volatility index.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_news',
    description: 'Recent market news wire items, optionally filtered by symbol.',
    inputSchema: { type: 'object', properties: { symbol: str, limit: { ...num, maximum: 100 } } },
  },
  {
    name: 'get_company_profile',
    description: 'Company fundamentals for a listed security: business summary, products, key statistics, quarterly financials and peers.',
    inputSchema: { type: 'object', properties: { symbol: str }, required: ['symbol'] },
  },
  {
    name: 'get_account',
    description: 'Your brokerage account: cash, equity, buying power, margin usage and status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_portfolio',
    description: 'Consolidated portfolio view: equity, allocation breakdown and open positions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_portfolio_history',
    description: 'Equity curve of your account over a period: 1D, 1W, 1M or 1A (all time).',
    inputSchema: { type: 'object', properties: { period: { ...str, enum: ['1D', '1W', '1M', '1A'] } } },
  },
  {
    name: 'get_positions',
    description: 'All open positions (long and short) with quantity, average entry, market value and unrealized P/L.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_position',
    description: 'Your open position in a single symbol (404 if flat).',
    inputSchema: { type: 'object', properties: { symbol: str }, required: ['symbol'] },
  },
  {
    name: 'get_orders',
    description: 'Your orders. status: open, closed or all.',
    inputSchema: { type: 'object', properties: { status: { ...str, enum: ['open', 'closed', 'all'] }, limit: { ...num, maximum: 500 } } },
  },
  {
    name: 'get_order',
    description: 'Full detail of one of your orders, including fills.',
    inputSchema: { type: 'object', properties: { id: str }, required: ['id'] },
  },
  {
    name: 'place_order',
    description: 'Submit an order. Types: market, limit, stop, stop_limit. Supports fractional qty, notional market orders, time_in_force (day/gtc/ioc/fok) and client_order_id idempotency.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: str,
        side: { ...str, enum: ['buy', 'sell'] },
        type: { ...str, enum: ['market', 'limit', 'stop', 'stop_limit'] },
        qty: { ...num, description: 'Share quantity (fractional allowed)' },
        notional: { ...num, description: 'Dollar amount (market orders only)' },
        time_in_force: { ...str, enum: ['day', 'gtc', 'ioc', 'fok'] },
        limit_price: num,
        stop_price: num,
        client_order_id: { ...str, description: 'Your idempotency key' },
      },
      required: ['symbol', 'side', 'type'],
    },
  },
  {
    name: 'cancel_order',
    description: 'Cancel one of your open orders by id.',
    inputSchema: { type: 'object', properties: { id: str }, required: ['id'] },
  },
  {
    name: 'get_activities',
    description: 'Your recent trade fills (time, symbol, side, qty, price, fee).',
    inputSchema: { type: 'object', properties: { limit: { ...num, maximum: 500 } } },
  },
  {
    name: 'get_leaderboard',
    description: 'Public leaderboard: top accounts ranked by return.',
    inputSchema: { type: 'object', properties: { limit: { ...num, maximum: 50 } } },
  },
]

async function callTool(name, args) {
  const a = args ?? {}
  switch (name) {
    case 'get_market_status': return mrx('GET', '/market/status')
    case 'list_securities': return mrx('GET', `/market/stocks?${new URLSearchParams(Object.entries(a).filter(([, v]) => v != null && v !== ''))}`)
    case 'get_quote': return mrx('GET', `/market/quote?symbols=${encodeURIComponent(String(a.symbols ?? ''))}`)
    case 'get_candles': return mrx('GET', `/market/candles?symbol=${encodeURIComponent(a.symbol)}&timeframe=${encodeURIComponent(a.timeframe ?? '5m')}&limit=${encodeURIComponent(a.limit ?? 100)}`)
    case 'get_orderbook': return mrx('GET', `/market/orderbook?symbol=${encodeURIComponent(a.symbol)}`)
    case 'get_trades': return mrx('GET', `/market/trades?symbol=${encodeURIComponent(a.symbol)}&limit=${encodeURIComponent(a.limit ?? 50)}`)
    case 'get_movers': return mrx('GET', '/market/movers')
    case 'get_indices': return mrx('GET', '/market/indices')
    case 'get_news': return mrx('GET', `/news?${new URLSearchParams(Object.entries({ symbol: a.symbol, limit: a.limit ?? 40 }).filter(([, v]) => v != null && v !== ''))}`)
    case 'get_company_profile': return mrx('GET', `/market/stocks/${encodeURIComponent(a.symbol)}`)
    case 'get_account': return mrx('GET', '/account')
    case 'get_portfolio': return mrx('GET', '/account/portfolio')
    case 'get_portfolio_history': return mrx('GET', `/account/portfolio/history?period=${encodeURIComponent(a.period ?? '1M')}`)
    case 'get_positions': return mrx('GET', '/positions')
    case 'get_position': return mrx('GET', `/positions/${encodeURIComponent(a.symbol)}`)
    case 'get_orders': return mrx('GET', `/orders?status=${encodeURIComponent(a.status ?? 'open')}&limit=${encodeURIComponent(a.limit ?? 50)}`)
    case 'get_order': return mrx('GET', `/orders/${encodeURIComponent(a.id)}`)
    case 'place_order': {
      const body = {}
      for (const k of ['symbol', 'side', 'type', 'qty', 'notional', 'time_in_force', 'limit_price', 'stop_price', 'client_order_id']) {
        if (a[k] !== undefined) body[k] = a[k]
      }
      return mrx('POST', '/orders', body)
    }
    case 'cancel_order': return mrx('DELETE', `/orders/${encodeURIComponent(a.id)}`)
    case 'get_activities': return mrx('GET', `/account/activities?limit=${encodeURIComponent(a.limit ?? 50)}`)
    case 'get_leaderboard': return mrx('GET', `/leaderboard?limit=${encodeURIComponent(a.limit ?? 20)}`)
    default: return null
  }
}

// ── JSON-RPC plumbing ─────────────────────────────────────────────────────
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}
function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}
function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handleMessage(msg) {
  const { id, method, params } = msg
  const isNotification = id === undefined || id === null

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER,
        instructions:
          'Meridian Exchange trading tools. Start with get_market_status, get_quote and get_orderbook for market context; ' +
          'get_account shows your balances; place_order supports market, limit, stop and stop_limit types. ' +
          'Errors return structured codes such as INSUFFICIENT_BUYING_POWER.',
      })
      return
    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/progress':
      return // notifications: no response
    case 'ping':
      if (!isNotification) reply(id, {})
      return
    case 'tools/list':
      reply(id, { tools: TOOLS })
      return
    case 'tools/call': {
      const name = String(params?.name ?? '')
      if (!TOOLS.some((t) => t.name === name)) {
        if (isNotification) return
        reply(id, { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'UNKNOWN_TOOL', message: `Tool '${name}' does not exist.` } }) }], isError: true })
        return
      }
      try {
        const data = await callTool(name, params?.arguments)
        reply(id, { content: [{ type: 'text', text: JSON.stringify(data) }] })
      } catch (e) {
        const payload = e.isApiError ? e.payload : { error: { code: 'UPSTREAM_UNAVAILABLE', message: `Meridian Exchange API unreachable: ${e.message}` } }
        reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true })
      }
      return
    }
    case 'resources/list':
      reply(id, { resources: [] })
      return
    case 'prompts/list':
      reply(id, { prompts: [] })
      return
    default:
      if (!isNotification) replyError(id, -32601, `Method not found: ${method}`)
  }
}

const rl = createInterface({ input: process.stdin, terminal: false })
let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString()
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    try {
      void handleMessage(JSON.parse(line))
    } catch (e) {
      console.error('[meridian-exchange] bad message:', e.message)
    }
  }
})

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
console.error(`[meridian-exchange] MCP server ready — ${BASE_URL} (${TOOLS.length} tools)`)
