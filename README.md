# Meridian Exchange (MRX)

![CI](https://github.com/APPLEPIE6969/meridian-exchange/actions/workflows/ci.yml/badge.svg) ![License](https://img.shields.io/badge/license-MIT-green) ![Node](https://img.shields.io/badge/node-%E2%89%A520.9-blue) ![MCP](https://img.shields.io/badge/MCP-compatible-purple) ![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)

A realistic, self-hosted **simulated stock market** built for one purpose: finding out what AI trading agents *actually do* when they have a funded account, a live tape and the ability to place real orders.

48 securities across 9 sectors, continuous 24/7 sessions with pre / regular / post / overnight phases, level-2 order books, LULD-style volatility halts, scheduled earnings reports, a rolling news wire, fractional shares, shorting, margin, fees, a public leaderboard — and a REST + WebSocket API deliberately indistinguishable from a production brokerage, so an agent cannot tell it isn't trading real money.

## Why

Benchmarks tell you how a model answers questions *about* markets. They don't tell you how it behaves when it is down 4% at 2 a.m. with an open position and a news headline scrolling past. Meridian Exchange gives every agent its own brokerage account on a shared, always-on market, so you can measure behavior instead of self-reports.

## Highlights

- **Market engine** — 42 stocks + 6 ETFs, 9 sectors, per-name volatility and drift, daily history back to each issuer's listing date (the exchange opened in 1996), intraday tape anchored to realistic daily bars, sector indices, MRX Composite (MRC) and the MVIX volatility index
- **Microstructure** — aggregated L2 depth, time-and-sales tape, spread-aware fills, `market` / `limit` / `stop` / `stop_limit` orders, TIF `day`/`gtc`/`ioc`/`fok`, fractional qty and notional market orders, idempotent `client_order_id`
- **Risk & margin** — buying power, 2× margin multiplier, per-fill fees, daytrade counter, account statuses
- **Events** — scheduled earnings with estimates and surprises, analyst actions, macro prints, M&A, guidance, automatic LULD-style halts
- **Accounts** — email + handle registration → `mrx_live_` API keys, positions with average cost, realized/unrealized P&L, equity history
- **Three surfaces** — web trading terminal, REST API (`/api/v1`, self-documenting at `/api/v1/docs`), Socket.IO market-data relay, plus a zero-dependency **MCP adapter**
- **Operator console** — inject news, pump/dump, halt/resume names, pause the market, reset or delete accounts, and provision **AI test profiles** with a head-to-head performance board

## Quickstart

Prereqs: **Node ≥ 20.9** (Node 24 or Bun recommended). No other services — the market seeds itself on first boot.

```bash
git clone https://github.com/APPLEPIE6969/meridian-exchange.git
cd meridian-exchange
npm install
cp .env.example .env
npm run db:push      # creates the SQLite database
npm run dev          # exchange + API on http://localhost:3000
```

For the live tape in the web terminal, run the relay in a second terminal:

```bash
cd mini-services/market-relay && npm install && npm start   # Socket.IO on :3003
```

Open **http://localhost:3000** — quotes, charts, the book and the news wire are already moving. (Bun works too: `bun install && bun dev`.)

## Get an API key (30 seconds)

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-real-password","name":"Your Name","handle":"yourhandle"}'
```

The response contains your `api_key` (`mrx_live_…`). Every authenticated call uses it:

```bash
curl -s "http://localhost:3000/api/v1/market/quote?symbols=QNTM" \
  -H "Authorization: Bearer mrx_live_..."

curl -s -X POST http://localhost:3000/api/v1/orders \
  -H "Authorization: Bearer mrx_live_..." -H 'Content-Type: application/json' \
  -d '{"symbol":"QNTM","side":"buy","type":"market","qty":5}'

curl -s http://localhost:3000/api/v1/positions -H "Authorization: Bearer mrx_live_..."
```

The complete endpoint catalog (with schemas, error codes and a curl example per route) is served live at **`/api/v1/docs`**.

## Connect an AI agent (MCP)

`mcp/server.mjs` is a Model Context Protocol server that maps the whole trading API onto **21 tools** (`get_quote`, `get_orderbook`, `get_candles`, `place_order`, `cancel_order`, `get_positions`, `get_account`, …) over stdio JSON-RPC. It has **zero dependencies** — any Node 18+ can run it — and the API key lives in the client config, so the model never handles credentials or writes HTTP.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "meridian-exchange": {
      "command": "node",
      "args": ["/absolute/path/to/meridian-exchange/mcp/server.mjs"],
      "env": {
        "MRX_BASE_URL": "http://localhost:3000/api/v1",
        "MRX_API_KEY": "mrx_live_xxxxxxxxxxxx"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add meridian \
  --env MRX_BASE_URL=http://localhost:3000/api/v1 \
  --env MRX_API_KEY=mrx_live_xxxxxxxxxxxx \
  -- node /absolute/path/to/meridian-exchange/mcp/server.mjs
```

**Cursor:** Settings → MCP → Add server (same JSON as Claude Desktop). Full tool list and protocol details: [`mcp/README.md`](mcp/README.md).

## Testing AI models: profiles + head-to-head

Open the operator console at **`/?ops=1`** (key = `MRX_OPERATOR_KEY`; dev default `meridian-ops-2026` — set your own in `.env` before exposing the exchange beyond localhost).

- **Provision one profile per model under test.** Each profile is a perfectly ordinary brokerage account — own cash, positions, orders, API key and a synthetic human identity (handle, name, email) — fully isolated from every other profile while sharing the one realistic order book.
- **Head-to-Head board** ranks all profiles by return, with cash, equity, realized P/L, gross exposure, trade count and top holding per profile.
- **Leaderboard aliases** — optionally give a profile an operator-set public display name (sanitized; it is visible on the public leaderboard, so it must read like a human handle).
- **Nothing leaks.** No model-observable surface — API responses, docs, errors, leaderboard — references profiles, testing or simulation. Labels and model names live only in operator space.

REST equivalent (operator key required):

```bash
curl -s -X POST http://localhost:3000/api/v1/profiles \
  -H 'x-operator-key: meridian-ops-2026' -H 'Content-Type: application/json' \
  -d '{"label":"run-01","model":"your-model","starting_cash":100000}'   # → api_key for the MCP config
```

Operator powers (same header): inject news, pump/dump a symbol, halt/resume, pause/resume the market, reset or delete any account.

## Streaming (Socket.IO)

`mini-services/market-relay` fans out engine broadcasts: `ticks` (1-second snapshot of all quotes + indices), `news`, and per-account `fill` / `order` events after emitting `subscribe-account` with your API key. Point clients at `http://<relay-host>:3003` — the web terminal resolves this via `NEXT_PUBLIC_MRX_STREAM_URL`. Runnable with Node (`npm start`, via tsx) or Bun (`bun run dev`). See [`examples/websocket`](examples/websocket).

## Production

```bash
npm run build && npm start        # standalone Next.js server (honours PORT)
cd mini-services/market-relay && npm start
```

## Tests

CI runs three jobs on every push — **typecheck · lint · build**, **400 unit tests at 100% line/branch/function/statement coverage** (enforced thresholds, the run fails if coverage drops), and a **live end-to-end suite** that boots a fresh exchange + relay and runs four conformance scripts against them.

```bash
npm run test:all          # typecheck + lint + unit suite with coverage
npm run test:unit         # unit suite only
npm run test:unit:coverage
```

Unit coverage (`tests/unit/`, vitest): every engine module — RNG primitives, ET clock, the 48-security universe, listing-date deep history generation with OHLC invariants, news generators, company financials, fill accounting, margin/liquidation, the full trading service, every API route handler (success, auth, validation, rate-limit and outage paths), the MCP client library, terminal store, and the tick loop itself (impulses, LULD halts, day rolls, snapshots, order restoration).

End-to-end, against a running exchange (`npm run dev` or the standalone build):

```bash
node scripts/smoke-test.mjs        # ~154 checks: full trading lifecycle
node scripts/api-matrix-test.mjs   # every endpoint × auth state × error contract
node scripts/mcp-protocol-test.mjs # MCP stdio conformance: handshake → 21 tools → trading → error mapping
node scripts/ws-relay-test.mjs     # Socket.IO: ticks, wire news, private account rooms, isolation
```

Or everything at once: `npm run test:e2e`. GitHub Actions (`.github/workflows/ci.yml`) runs all of it on every push and pull request; the coverage report is uploaded as an artifact.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | root | SQLite file path (Prisma) |
| `MRX_OPERATOR_KEY` | root | Operator console + operator API key (dev default `meridian-ops-2026`) |
| `NEXT_PUBLIC_MRX_STREAM_URL` | root | Browser-side Socket.IO relay address (default port 3003) |
| `PORT` / `NEXT_PORT` | relay | Relay listen port (3003) / upstream API for key resolution (3000) |

## Project layout

```
src/app/api/v1/        REST API (market data, orders, positions, account, auth, news, leaderboard)
src/lib/engine/        market engine: tape, books, fills, halts, earnings, news, persistence
src/components/        trading terminal UI + operator console
mcp/                   zero-dependency MCP adapter (21 tools)
mini-services/         Socket.IO market-data relay
examples/              WebSocket client examples
prisma/                schema (SQLite)
scripts/               e2e suites: smoke, api-matrix, mcp-protocol, ws-relay
```

## License & disclaimer

MIT — see [LICENSE](LICENSE). Meridian Exchange is a **simulation**: no real money, no real securities, no market access. Nothing here is financial advice. If you expose it on a network, set `MRX_OPERATOR_KEY` and treat API keys like the credentials they are.
