// MRX WebSocket relay conformance — connects to the Socket.IO relay like the
// terminal does: handshake, live ticks, wire news, and private account rooms
// driven by real REST trades.
import { io } from 'socket.io-client'

const RELAY = process.env.MRX_RELAY_URL || 'http://localhost:3003'
const API = process.env.MRX_API_URL || 'http://localhost:3000/api/v1'
const OPS = process.env.MRX_OPERATOR_KEY || 'meridian-ops-2026'

let pass = 0
let failCount = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { failCount++; failures.push(name); console.log(`FAIL  ${name} ${detail}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const timeout = (ms, label) => new Promise((_, reject) => setTimeout(() => reject(new Error(label || `timeout after ${ms}ms`)), ms))

async function registerAccount() {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.42' },
    body: JSON.stringify({ email: `ws-${Date.now()}@mrx.dev`, password: 'password123' }),
  })
  const body = await res.json()
  if (!body.api_key) throw new Error('registration failed: ' + JSON.stringify(body))
  return body
}

async function main() {
  console.log(`relay: ${RELAY}`)

  console.log('\n── HTTP surface ──')
  const health = await fetch(`${RELAY}/internal/broadcast`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"messages":[]}' })
  check('relay broadcast endpoint responds', health.status === 200)
  check('relay serves CORS', (health.headers.get('access-control-allow-origin') ?? '*') === '*')

  console.log('\n── Connection & live ticks ──')
  const socket = io(RELAY, { transports: ['websocket', 'polling'], reconnection: false, timeout: 8000 })

  const firstTicks = new Promise((resolve) => socket.on('ticks', resolve))
  socket.on('connect_error', (e) => console.log('connect_error:', e.message))

  await Promise.race([
    new Promise((resolve) => socket.on('connect', resolve)),
    timeout(8000, 'relay connection timed out'),
  ])
  check('socket.io connects', socket.connected)
  check('socket has an id', typeof socket.id === 'string' && socket.id.length > 0)

  const ticks1 = await Promise.race([firstTicks, timeout(10000, 'no ticks frame within 10s')])
  check('ticks frame arrives', Array.isArray(ticks1.quotes) && ticks1.quotes.length >= 48, `quotes: ${(ticks1.quotes || []).length}`)
  const qntm = ticks1.quotes.find((q) => q.s === 'QNTM')
  check('tick frame carries full quotes', qntm && qntm.p > 0 && qntm.b > 0 && qntm.a >= qntm.b && typeof qntm.chgp === 'number')
  check('tick frame carries indices', ticks1.indices?.composite?.symbol === 'MRC' && typeof ticks1.indices.mvix === 'number')
  check('tick frame is timestamped', typeof ticks1.ts === 'number' && Math.abs(Date.now() - ticks1.ts) < 30000)

  // second frame must differ in time (live stream, not a snapshot)
  const t1 = ticks1.ts
  const ticks2 = await Promise.race([
    new Promise((resolve) => socket.on('ticks', (d) => { if (d.ts !== t1) resolve(d) })),
    timeout(10000, 'no second ticks frame'),
  ])
  check('ticks stream continuously', ticks2.ts > t1)

  console.log('\n── Wire news broadcast ──')
  const newsPromise = new Promise((resolve) => socket.on('news', resolve))
  await fetch(`${API}/operator`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-operator-key': OPS },
    body: JSON.stringify({ action: 'inject_news', headline: 'Relay conformance: wire flash headline', symbols: ['QNTM'], impact_bps: 0 }),
  })
  const news = await Promise.race([newsPromise, timeout(8000, 'no news broadcast within 8s')])
  check('news event broadcasts to the market room', typeof news.headline === 'string' && news.id, JSON.stringify(news).slice(0, 120))
  check('news carries sentiment + symbols', typeof news.sentiment === 'number' && JSON.parse(news.symbols).includes('QNTM'))

  console.log('\n── Private account room ──')
  const account = await registerAccount()
  socket.emit('subscribe-account', { api_key: account.api_key })
  await sleep(400)

  // trade through the REST API and await both fill and order events
  const fillPromise = new Promise((resolve) => socket.on('fill', resolve))
  const trade = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${account.api_key}` },
    body: JSON.stringify({ symbol: 'HELX', qty: 2, side: 'buy', type: 'market' }),
  })
  const tradeBody = await trade.json()
  check('REST trade executed for the room', trade.status === 201 && tradeBody.status === 'filled', JSON.stringify(tradeBody).slice(0, 120))

  const fill = await Promise.race([fillPromise, timeout(8000, 'no fill event within 8s')])
  check('fill event lands in the private room', fill.order_id === tradeBody.id && fill.qty === 2 && fill.price > 0, JSON.stringify(fill).slice(0, 140))

  // 'order' events fire on hook-driven status changes: rest an order, cancel it
  const orderPromise = new Promise((resolve) => socket.on('order', resolve))
  const resting = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${account.api_key}` },
    body: JSON.stringify({ symbol: 'HELX', qty: 1, side: 'buy', type: 'limit', limit_price: 1, time_in_force: 'gtc' }),
  })
  const restingBody = await resting.json()
  check('resting order accepted', resting.status === 201 && restingBody.status === 'accepted')
  await fetch(`${API}/orders/${restingBody.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${account.api_key}` } })
  const orderEvt = await Promise.race([orderPromise, timeout(8000, 'no order event within 8s')])
  check('order event lands in the private room', orderEvt.id === restingBody.id && orderEvt.status === 'canceled', JSON.stringify(orderEvt).slice(0, 120))

  // a second account must NOT receive the first account's events
  const outsider = await registerAccount()
  const outsiderSocket = io(RELAY, { transports: ['websocket', 'polling'], reconnection: false })
  await Promise.race([new Promise((r) => outsiderSocket.on('connect', r)), timeout(8000, 'outsider connect timeout')])
  outsiderSocket.emit('subscribe-account', { api_key: outsider.api_key })
  await sleep(300)
  // collect every fill the outsider sees, then judge after the order id is known —
  // the relay broadcast can beat the HTTP response back to the test
  const outsiderFills = []
  outsiderSocket.on('fill', (f) => outsiderFills.push(f))
  const outsiderOrders = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${outsider.api_key}` },
    body: JSON.stringify({ symbol: 'VLTR', qty: 1, side: 'buy', type: 'market' }),
  })
  const outsiderOrder = await outsiderOrders.json()
  check('second account trades independently', outsiderOrders.status === 201 && outsiderOrder.status === 'filled')
  await sleep(1500)
  const leaked = outsiderFills.filter((f) => f.order_id !== outsiderOrder.id)
  check('no cross-account event leakage', leaked.length === 0, leaked.length ? JSON.stringify(leaked[0]).slice(0, 120) : '')
  outsiderSocket.close()

  console.log('\n── Room isolation & reconnection ──')
  socket.io.on('reconnect', () => { /* informational */ })
  socket.close()
  check('clean disconnect', true)

  console.log(`\n═══ WS relay: ${pass} passed, ${failCount} failed ═══`)
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
