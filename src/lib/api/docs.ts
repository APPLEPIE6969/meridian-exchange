// MRX trading API documentation — served at /api/v1/docs and rendered in-app.

export const API_DOCS = `# Meridian Exchange — Trading API v1

Base URL: \`{host}/api/v1\`   ·   Format: JSON   ·   Auth: API key (Bearer)

The Meridian Exchange (MRX) is a 24/7 national securities exchange.
All endpoints below are live. Rate limit: **200 requests/minute** per API key (HTTP 429 on excess).

## Authentication

    Authorization: Bearer mrx_live_xxxxxxxxxxxxxxxxxxxx

API keys are issued at registration and viewable/rotatable in the account endpoints.

## Market Data (public, no key required)

| Method | Path | Description |
|--------|------|-------------|
| GET | /market/status | Exchange status, session (pre/regular/post/overnight), clock (ET) |
| GET | /market/stocks | All listed securities. Filters: ?sector=Technology&search=quant |
| GET | /market/stocks/{symbol} | Company profile: about, products & services, key statistics, 8 quarters of financials (EPS actual vs estimate, revenue), next report with consensus, sector peers, recent news |
| GET | /market/quote?symbols=QNTM,NEURX | Latest quotes: bid/ask/sizes, last, day stats |
| GET | /market/candles?symbol=QNTM&interval=5m&start=<ms>&end=<ms> | OHLCV bars. interval: 1m, 5m, 15m, 1h, 1d; or range: 1D, 5D, 1M, 3M, 6M, 1A, 5A, ALL |
| GET | /market/orderbook?symbol=QNTM | Level-2 book: aggregated depth, 10 levels/side |
| GET | /market/trades?symbol=QNTM&limit=50 | Time & sales tape |
| GET | /market/movers | Top gainers / losers / most active |
| GET | /market/indices | MRX Composite (MRC), sector indices, MVIX volatility index |
| GET | /market/calendar?days=21 | Upcoming earnings dates with consensus EPS |
| GET | /news?symbol=QNTM&limit=40 | News wire (filterable by symbol) |
| GET | /leaderboard | Top accounts by return |

## Trading (requires API key)

| Method | Path | Description |
|--------|------|-------------|
| GET  | /account | Balances, equity, buying power (2x margin), status |
| GET  | /account/portfolio | Consolidated portfolio: equity, allocation, positions inline |
| GET  | /account/portfolio/history?period=1D\\|1W\\|1M\\|1A | Equity curve |
| GET  | /account/activities?limit=50 | Fill history |
| GET  | /account/keys · POST /account/keys/rotate | API key management |
| GET  | /positions | Open positions (long & short) with unrealized P/L |
| GET  | /positions/{symbol} | Single position (404 if flat) |
| GET  | /orders?status=open&limit=50 | Order history (status: open, closed, all) |
| GET  | /orders/{id} | Single order |
| POST | /orders | Submit order |
| DELETE | /orders/{id} | Cancel open order |

### POST /orders body

    {
      "symbol": "QNTM",
      "qty": 10,                      // or "notional": 2500 (market orders)
      "side": "buy",                  // buy | sell  (shorting allowed)
      "type": "limit",                // market | limit | stop | stop_limit
      "time_in_force": "gtc",         // day | gtc | ioc | fok
      "limit_price": 600.50,          // required for limit / stop_limit
      "stop_price": 580.00,           // required for stop / stop_limit
      "client_order_id": "my-id-001"  // optional idempotency key
    }

Fractional quantities are supported (e.g. qty: 2.5). Margin: 2x initial (Reg T), 30% maintenance.
Accounts falling below maintenance enter MARGIN_CALL; below 15% exposure coverage positions are liquidated.

### Order statuses

new → accepted → partially_filled → filled · canceled · expired · rejected

### Errors

    { "error": { "code": "INSUFFICIENT_BUYING_POWER", "message": "..." } }

Common codes: UNAUTHORIZED (401), SYMBOL_NOT_FOUND (404), INVALID_QUANTITY,
INSUFFICIENT_BUYING_POWER, ORDER_REJECTED, ORDER_ALREADY_PROCESSED, RATE_LIMIT_EXCEEDED (429).

## Streaming

Socket.IO relay: run \`mini-services/market-relay\` (default port 3003) and point your client at
\`http://<relay-host>:3003\` (the web terminal resolves this via \`NEXT_PUBLIC_MRX_STREAM_URL\`).
Events: \`ticks\` (1s snapshot of all quotes +
indices), \`news\` (wire items), \`fill\` / \`order\` (account events after emitting \`subscribe-account\`
with your API key).

## Quick start (curl)

    curl -X POST {host}/api/v1/orders \\
      -H "Authorization: Bearer mrx_live_..." \\
      -H "Content-Type: application/json" \\
      -d '{"symbol":"NEURX","qty":25,"side":"buy","type":"market"}'
`
