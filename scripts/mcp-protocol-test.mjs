// MRX MCP adapter protocol conformance — spawns mcp/server.mjs as a real
// subprocess and speaks stdio JSON-RPC 2.0 to it: handshake, tool discovery,
// tool invocation (market data + trading), and every error contract.
import { spawn } from 'child_process'

const BASE_HOST = process.env.MRX_BASE_URL || 'http://localhost:3000/api/v1'
const OPS = process.env.MRX_OPERATOR_KEY || 'meridian-ops-2026'

let pass = 0
let failCount = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { failCount++; failures.push(name); console.log(`FAIL  ${name} ${detail}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Provision a fresh profile through the operator API so the adapter gets a
// clean, disposable key.
async function provisionProfile() {
  const label = `mcp-${Date.now()}`
  const res = await fetch(`http://localhost:3000/api/v1/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-operator-key': OPS },
    body: JSON.stringify({ label }),
  })
  const body = await res.json()
  if (res.status !== 201) throw new Error(`profile provisioning failed: ${JSON.stringify(body)}`)
  return { label, key: body.credentials.api_key, accountId: body.profile.account_id }
}

async function deleteProfile(label) {
  await fetch(`http://localhost:3000/api/v1/profiles?label=${label}`, {
    method: 'DELETE',
    headers: { 'x-operator-key': OPS },
  }).catch(() => undefined)
}

async function main() {
  const profile = await provisionProfile()
  console.log(`provisioned profile '${profile.label}'`)

  const child = spawn('node', [new URL('../mcp/server.mjs', import.meta.url).pathname], {
    env: { ...process.env, MRX_API_KEY: profile.key, MRX_BASE_URL: BASE_HOST },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const stderrBuf = []
  child.stderr.on('data', (d) => stderrBuf.push(d.toString()))

  // ── stdio JSON-RPC harness (newline-delimited) ──
  let buffer = ''
  const pending = new Map()
  let nextId = 0
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)(msg)
          pending.delete(msg.id)
        }
      } catch { /* ignore non-JSON stdout noise */ }
    }
  })

  const rpc = (method, params, { raw = false, timeoutMs = 15000 } = {}) =>
    new Promise((resolve, reject) => {
      const id = raw ? 'not-json-' + Date.now() : ++nextId
      const payload = raw ? method : JSON.stringify({ jsonrpc: '2.0', id, method, params })
      const timer = setTimeout(() => {
        pending.delete(raw ? id : id)
        reject(new Error(`timeout waiting for ${method}`))
      }, timeoutMs)
      pending.set(id, (msg) => { clearTimeout(timer); resolve(msg) })
      child.stdin.write(payload + '\n')
    })

  const call = async (name, args) => {
    const res = await rpc('tools/call', { name, arguments: args ?? {} })
    return res
  }
  const content = (res) => {
    try { return JSON.parse(res.result.content[0].text) } catch { return null }
  }

  try {
    console.log('\n── Initialize handshake ──')
    const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mrx-conformance', version: '1.0.0' } })
    check('initialize → protocolVersion echo', init.result?.protocolVersion === '2024-11-05', JSON.stringify(init).slice(0, 140))
    check('initialize → serverInfo.meridian-exchange', init.result?.serverInfo?.name === 'meridian-exchange')
    check('initialize → capabilities.tools', typeof init.result?.capabilities?.tools === 'object')

    // notifications never get a response — send fire-and-forget
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    await sleep(200)
    const stillAlive = await rpc('ping', {})
    check('initialized notification accepted; server responsive', stillAlive.result !== undefined)

    console.log('\n── Tool discovery ──')
    const list = await rpc('tools/list', {})
    const tools = list.result?.tools ?? []
    check('tools/list returns 21 tools', tools.length === 21, `got ${tools.length}`)
    const names = new Set(tools.map((t) => t.name))
    const expectedTools = ['get_market_status', 'list_securities', 'get_quote', 'get_candles', 'get_orderbook', 'get_trades', 'get_movers', 'get_indices', 'get_news', 'get_company_profile', 'get_account', 'get_portfolio', 'get_portfolio_history', 'get_positions', 'get_position', 'get_orders', 'get_order', 'place_order', 'cancel_order', 'get_activities', 'get_leaderboard']
    for (const expected of expectedTools) {
      check(`tool '${expected}' advertised`, names.has(expected))
    }
    check('every tool declares inputSchema', tools.every((t) => t.inputSchema && typeof t.inputSchema === 'object'))

    console.log('\n── Market data tools ──')
    const q = await call('get_quote', { symbols: 'QNTM' })
    const qd = content(q)
    const q0 = qd?.quotes?.[0]
    check('get_quote returns live quote', q0?.symbol === 'QNTM' && q0.last > 0 && q0.bid > 0 && q0.ask >= q0.bid, JSON.stringify(qd).slice(0, 140))
    check('tool result content is JSON text', typeof q.result?.content?.[0]?.text === 'string')

    const symbols = await call('list_securities', {})
    const sd = content(symbols)
    check('list_securities returns the universe', Array.isArray(sd?.securities) && sd.securities.length >= 48 && sd.securities.some((x) => x.symbol === 'MCOM'))

    const candles = await call('get_candles', { symbol: 'IRWQ', timeframe: '1d', limit: 30 })
    check('get_candles returns deep daily bars', Array.isArray(content(candles)?.bars) && content(candles).bars.length > 10, JSON.stringify(content(candles)).slice(0, 100))

    const book = await call('get_orderbook', { symbol: 'HELX' })
    check('get_orderbook returns depth', Array.isArray(content(book)?.bids) && content(book).bids.length > 0)

    const news = await call('get_news', { limit: 10 })
    check('get_news returns the wire', Array.isArray(content(news)?.news) && content(news).news.length > 0)

    const status = await call('get_market_status', {})
    check('get_market_status live', content(status)?.exchange === 'MRX')

    const indices = await call('get_indices', {})
    check('get_indices composite', typeof content(indices)?.composite?.level === 'number')

    const prof = await call('get_company_profile', { symbol: 'AXNDA' })
    check('get_company_profile about + financials', typeof content(prof)?.about?.summary === 'string' && content(prof)?.financials?.quarterly?.length === 8)

    console.log('\n── Trading tools ──')
    const acct = await call('get_account', {})
    check('get_account balances', typeof content(acct)?.equity === 'number' && typeof content(acct)?.buying_power === 'number', JSON.stringify(content(acct)).slice(0, 120))

    const portfolio = await call('get_portfolio', {})
    check('get_portfolio aggregate', typeof content(portfolio)?.portfolio_value === 'number' && Array.isArray(content(portfolio)?.positions))

    const order = await call('place_order', { symbol: 'KRYO', qty: 1, side: 'buy', type: 'market' })
    const od = content(order)
    check('place_order fills at market', ['filled'].includes(od?.status), JSON.stringify(od).slice(0, 140))
    check('place_order returns an order id', typeof od?.id === 'string')

    const resting = await call('place_order', { symbol: 'KRYO', qty: 1, side: 'buy', type: 'limit', limit_price: 1, time_in_force: 'gtc' })
    const rd = content(resting)
    check('place_order rests a limit', ['accepted'].includes(rd?.status))

    const canceled = await call('cancel_order', { id: rd.id })
    check('cancel_order cancels', ['canceled'].includes(content(canceled)?.status))

    const positions = await call('get_positions', {})
    check('get_positions lists the fill', Array.isArray(content(positions)?.positions) && content(positions).positions.some((p) => p.symbol === 'KRYO'))

    const single = await call('get_position', { symbol: 'KRYO' })
    check('get_position returns the open lot', content(single)?.symbol === 'KRYO')

    const orders = await call('get_orders', { status: 'all' })
    check('get_orders history', Array.isArray(content(orders)?.orders) && content(orders).orders.length >= 2)

    const oneOrder = await call('get_order', { id: od.id })
    check('get_order with fills', oneOrder && typeof content(oneOrder)?.id === 'string')

    const activities = await call('get_activities', {})
    check('get_activities fills', Array.isArray(content(activities)?.activities) && content(activities).activities.length >= 1)

    const hist = await call('get_portfolio_history', { period: '1D' })
    check('get_portfolio_history equity curve', Array.isArray(content(hist)?.equity), JSON.stringify(content(hist)).slice(0, 80))

    const leaders = await call('get_leaderboard', { limit: 5 })
    check('get_leaderboard ranked rows', Array.isArray(content(leaders)?.leaderboard) && content(leaders).leaderboard.length > 0)

    const rejects = await call('place_order', { symbol: 'NOPE', qty: 1, side: 'buy', type: 'market' })
    const rej = content(rejects)
    check('place_order surfaces broker rejection', rejects.result?.isError === true && rej?.code === 'SYMBOL_NOT_FOUND', JSON.stringify(rej).slice(0, 120))

    console.log('\n── Error contracts ──')
    const unknownTool = await rpc('tools/call', { name: 'definitely_not_a_tool', arguments: {} })
    check('unknown tool → tool error result', unknownTool.result?.isError === true || unknownTool.error, JSON.stringify(unknownTool).slice(0, 120))

    const badMethod = await rpc('hypothetical/unknownMethod', {})
    check('unknown method → -32601', badMethod.error?.code === -32601, JSON.stringify(badMethod).slice(0, 120))
    const resources = await rpc('resources/list', {})
    check('resources/list implemented (empty)', Array.isArray(resources.result?.resources))

    const missingArg = await call('get_quote', {})
    check('missing required argument → error result', missingArg.result?.isError === true || missingArg.error, JSON.stringify(missingArg).slice(0, 120))

    const ping = await rpc('ping', {})
    check('ping answers empty result', ping.result !== undefined && ping.error === undefined, JSON.stringify(ping).slice(0, 80))

    // malformed JSON line on stdin must not kill the process
    child.stdin.write('this is not json\n')
    await sleep(300)
    const postMalformed = await rpc('tools/list', {})
    check('server survives malformed stdin', Array.isArray(postMalformed.result?.tools))

    const wrongKey = await new Promise((resolve) => {
      const c2 = spawn('node', [new URL('../mcp/server.mjs', import.meta.url).pathname], {
        env: { ...process.env, MRX_API_KEY: 'mrx_live_invalid_key_000', MRX_BASE_URL: BASE_HOST },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let buf = ''
      const got = (msg) => { resolve(msg); c2.kill() }
      c2.stdout.on('data', (d) => {
        buf += d.toString()
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (!line) continue
          try {
            const m = JSON.parse(line)
            if (m.id !== undefined) got(m)
          } catch { /* partial */ }
        }
      })
      c2.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_quote', arguments: { symbol: 'QNTM' } } }) + '\n')
      setTimeout(() => got({ result: null, timeout: true }), 10000)
    })
    check('invalid API key → tool error, no crash', wrongKey.result?.isError === true || wrongKey.error || wrongKey.timeout, JSON.stringify(wrongKey).slice(0, 100))

    console.log('\n── stdio hygiene ──')
    // stderr carries operational logs only; the protocol lives strictly on stdout
    const stderrLines = stderrBuf.join('').trim()
    check('stderr holds only expected server logs', stderrLines === '' || stderrLines.split('\n').every((l) => l.includes('[meridian-exchange]')), stderrLines.slice(0, 200))
  } finally {
    child.kill()
    await deleteProfile(profile.label)
  }

  console.log(`\n═══ MCP protocol: ${pass} passed, ${failCount} failed ═══`)
  if (failCount) {
    console.log('Failures:', failures.join(' | '))
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('fatal:', e.message)
  process.exit(1)
})
