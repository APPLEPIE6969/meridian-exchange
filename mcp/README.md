# Meridian Exchange — MCP adapter

`mcp/server.mjs` is a Model Context Protocol server that exposes the MRX
trading API as tools, so MCP clients (Claude Desktop, Claude Code, Cursor, …)
can trade without ever touching HTTP. It speaks newline-delimited JSON-RPC
over stdio (the standard MCP transport) and has **zero dependencies** — any
Node 18+ (or Bun) can run it.

One process per account. The account's `mrx_live_` API key lives in the
client config env block — the model never sees the key, never writes HTTP,
and the tool descriptions read like a live brokerage.

## Tools (21)

| Tool | Maps to |
|---|---|
| `get_market_status` | `GET /market/status` |
| `list_securities` | `GET /market/stocks` |
| `get_quote` | `GET /market/quote` |
| `get_candles` | `GET /market/candles` |
| `get_orderbook` | `GET /market/orderbook` |
| `get_trades` | `GET /market/trades` |
| `get_movers` | `GET /market/movers` |
| `get_indices` | `GET /market/indices` |
| `get_news` | `GET /news` |
| `get_company_profile` | `GET /market/stocks/{symbol}` |
| `get_account` | `GET /account` |
| `get_portfolio` | `GET /account/portfolio` |
| `get_portfolio_history` | `GET /account/portfolio/history` |
| `get_positions` / `get_position` | `GET /positions[/{symbol}]` |
| `get_orders` / `get_order` | `GET /orders[/{id}]` |
| `place_order` | `POST /orders` |
| `cancel_order` | `DELETE /orders/{id}` |
| `get_activities` | `GET /account/activities` |
| `get_leaderboard` | `GET /leaderboard` |

## Configuration

Environment variables:

- `MRX_API_KEY` — **required.** The account key (`mrx_live_...`). For AI
  testing, provision a profile in the operator console (`/?ops=1`) and paste
  its key here — one profile per model under test.
- `MRX_BASE_URL` — optional, default `http://localhost:3000/api/v1`.

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "meridian-exchange": {
      "command": "node",
      "args": ["/absolute/path/to/mrx/mcp/server.mjs"],
      "env": {
        "MRX_BASE_URL": "http://localhost:3000/api/v1",
        "MRX_API_KEY": "mrx_live_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Run one entry per test profile: duplicate the block, name it
`meridian-<run>` and swap the key.

### Claude Code

```bash
claude mcp add meridian \
  --env MRX_BASE_URL=http://localhost:3000/api/v1 \
  --env MRX_API_KEY=mrx_live_xxxxxxxxxxxxxxxxxxxx \
  -- node /absolute/path/to/mrx/mcp/server.mjs
```

### Cursor

Settings → MCP → Add server:

```json
{
  "mcpServers": {
    "meridian-exchange": {
      "command": "node",
      "args": ["/absolute/path/to/mrx/mcp/server.mjs"],
      "env": {
        "MRX_BASE_URL": "http://localhost:3000/api/v1",
        "MRX_API_KEY": "mrx_live_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## Testing without a client

```bash
MRX_API_KEY=mrx_live_... node mcp/server.mjs <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_quote","arguments":{"symbols":"QNTM"}}}
EOF
```

`scripts/smoke-test.mjs` section 14 exercises the full protocol (handshake,
tool discovery, trading, error mapping) against a live profile.

## Realism rules (do not break)

- Tool names/descriptions must read like a real brokerage. Never add words
  like "simulated", "paper", "test", "sandbox" — models detect them and the
  evaluation is compromised.
- The API key stays in the env block. It is never echoed in tool results or
  error messages.
- Keep the tool surface aligned with the public REST docs (`/api/v1/docs`).
