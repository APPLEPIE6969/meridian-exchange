// MRX end-to-end API smoke test — exercises the full trading lifecycle.
// Response shapes follow the broker API contract: qty/filled_qty are strings,
// candles use `bars`, order objects are returned at top level of POST /orders.
const BASE = 'http://localhost:3000/api/v1'
let pass = 0, failCount = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { failCount++; failures.push(name); console.log(`FAIL  ${name} ${detail}`) }
}

async function api(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON */ }
  return { status: res.status, json, text }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Distinct rate-limit bucket for market-data checks (limiter keys on X-Forwarded-For)
const MD = { 'X-Forwarded-For': '203.0.113.77' }
const mdApi = (path) => api('GET', path, undefined, MD)
// Dedicated buckets for auth POSTs and authed trading calls, so the deliberate
// 429-hammer in the Infra section can never starve them (limit: 200/min/bucket)
const AUTH = { 'X-Forwarded-For': '203.0.113.55' }

// ── 1. market data ────────────────────────────────────────────────
console.log('\n── Market Data ──')
{
  const { status, json } = await mdApi('/market/quote?symbols=QNTM,HELX,MTEK')
  check('quote multi-symbol 200', status === 200 && json?.quotes?.length === 3, JSON.stringify(json).slice(0, 200))
  const q = json?.quotes?.[0]
  check('quote fields', q && q.bid > 0 && q.ask >= q.bid && q.volume >= 0 && typeof q.change_percent === 'number')
  check('quote 52w range', q && q.week52_low <= q.last && q.last <= q.week52_high)
}
{
  const { status, json } = await mdApi('/market/quote?symbols=BOGUS')
  check('quote unknown symbol 404', status === 404 && json?.error?.code === 'SYMBOL_NOT_FOUND', JSON.stringify(json))
}
{
  const { status, json } = await mdApi('/market/candles?symbol=QNTM&timeframe=5m&limit=50')
  check('candles 5m', status === 200 && Array.isArray(json?.bars) && json.bars.length > 10, JSON.stringify(json).slice(0, 150))
  const c = json?.bars?.[0]
  check('candle OHLC valid', c && c.o > 0 && c.h >= c.l && c.h >= c.o && c.l <= c.o)
}
{
  const { status, json } = await mdApi('/market/candles?symbol=QNTM&timeframe=1d&limit=120')
  check('candles 1d history', status === 200 && json?.bars?.length >= 100, `got ${json?.bars?.length}`)
}
{
  const { status, json } = await mdApi('/market/orderbook?symbol=QNTM')
  check('orderbook L2', status === 200 && json?.bids?.length > 0 && json?.asks?.length > 0, JSON.stringify(json).slice(0, 150))
  check('book spread sane', json.bids[0].price < json.asks[0].price)
}
{
  // tape fills as the engine ticks — allow a few seconds on a cold-started engine
  let tradesOk = false, tradesSeen = 0
  for (let i = 0; i < 6 && !tradesOk; i++) {
    const { status, json } = await mdApi('/market/trades?symbol=QNTM&limit=20')
    tradesSeen = json?.trades?.length ?? 0
    tradesOk = status === 200 && tradesSeen > 0
    if (!tradesOk) await sleep(1000)
  }
  check('time & sales', tradesOk, `trades=${tradesSeen}`)
}
{
  const { status, json } = await mdApi('/market/indices')
  check('indices composite', status === 200 && json?.composite?.symbol === 'MRC' && json.composite.level > 0, JSON.stringify(json).slice(0, 150))
  check('indices mvix + sectors', typeof json?.mvix === 'number' && json?.sectors && Object.keys(json.sectors).length >= 5)
}
{
  const { status, json } = await mdApi('/market/movers')
  check('movers', status === 200 && Array.isArray(json?.gainers) && Array.isArray(json?.losers))
}
{
  const { status, json } = await mdApi('/market/stocks')
  check('stock universe', status === 200 && json?.securities?.length >= 40)
}
{
  const { status, json } = await mdApi('/market/calendar?days=21')
  check('earnings calendar', status === 200 && Array.isArray(json?.events ?? json?.calendar ?? json))
}
{
  const { status, json } = await mdApi('/news')
  check('news wire', status === 200 && Array.isArray(json?.news) && json.news.length > 0)
}

// ── 2. auth ───────────────────────────────────────────────────────
console.log('\n── Auth & Account ──')
let apiKey, smokeEmail, smokePass
{
  smokeEmail = `smoke${Date.now()}@mrx-test.io`
  smokePass = 'T3st-P4ssw0rd!'
  const reg = await api('POST', '/auth/register', {
    email: smokeEmail, password: smokePass, name: 'Smoke Tester', handle: `smoke_${Math.floor(Math.random() * 1e6)}`,
  }, AUTH)
  check('register 201', reg.status === 201 || reg.status === 200, JSON.stringify(reg.json).slice(0, 200))
  apiKey = reg.json?.api_key || reg.json?.apiKey
  check('api key issued', typeof apiKey === 'string' && apiKey.startsWith('mrx_live_'), String(apiKey))
}
{
  const bad = await api('GET', '/account', undefined, { 'X-MRX-Key': 'mrx_live_deadbeef' })
  check('bad key rejected 401', bad.status === 401, JSON.stringify(bad.json))
}
{
  const noKey = await api('GET', '/account', undefined, AUTH)
  check('missing key 401', noKey.status === 401)
}

const H = { 'X-MRX-Key': apiKey, 'X-Forwarded-For': '203.0.113.66' }

// ── 3. account ────────────────────────────────────────────────────
console.log('\n── Account ──')
{
  const { status, json } = await api('GET', '/account', undefined, H)
  check('account 200', status === 200, JSON.stringify(json).slice(0, 200))
  check('account cash 100k', Math.abs((json?.cash ?? 0) - 100000) < 0.01)
  check('buying power = cash x2', (json?.buying_power ?? 0) >= 199000)
  check('account number format', /^MRX\d{8}$/.test(json?.account_number ?? ''))
}
{
  const { status, json } = await api('GET', '/positions', undefined, H)
  check('positions empty', status === 200 && (json?.positions?.length ?? 1) === 0)
}

// ── 4. trading lifecycle ──────────────────────────────────────────
console.log('\n── Trading ──')
let marketOrderId, qPrice
{
  const { status, json } = await api('POST', '/orders', {
    symbol: 'QNTM', side: 'buy', type: 'market', qty: 10, tif: 'day',
  }, H)
  check('market buy accepted', (status === 200 || status === 201) && ['filled', 'accepted', 'partially_filled'].includes(json?.status), JSON.stringify(json).slice(0, 250))
  marketOrderId = json?.id
  check('market buy filled qty 10', Number(json?.filled_qty) === 10, `filled_qty=${json?.filled_qty}`)
  check('fill avg price present', json?.filled_avg_price !== null && Number(json?.filled_avg_price) > 0)
  qPrice = Number(json?.filled_avg_price ?? 0)
}
await sleep(300)
{
  const { status, json } = await api('GET', '/positions', undefined, H)
  const pos = json?.positions?.find((p) => p.symbol === 'QNTM')
  check('position QNTM +10', status === 200 && pos && Math.abs(Number(pos.qty) - 10) < 1e-6, JSON.stringify(json).slice(0, 250))
  check('position has unrealized pnl', pos && typeof pos.unrealized_pl === 'number')
}
{
  // resting: sell limit FAR ABOVE market
  const highPx = Math.round(qPrice * 3)
  const { status, json } = await api('POST', '/orders', {
    symbol: 'QNTM', side: 'sell', type: 'limit', qty: 5, limit_price: highPx, tif: 'gtc',
  }, H)
  check('high sell limit rests', status === 201 && json?.status === 'accepted', JSON.stringify(json).slice(0, 200))
  globalThis.sellLimitId = json?.id
}
{
  // resting: buy limit FAR BELOW market
  const { status, json } = await api('POST', '/orders', {
    symbol: 'QNTM', side: 'buy', type: 'limit', qty: 5, limit_price: 0.01, tif: 'gtc',
  }, H)
  check('low buy limit rests (no panic fill)', status === 201 && json?.status === 'accepted', JSON.stringify(json).slice(0, 200))
  globalThis.buyLimitId = json?.id
}
{
  // resting: sell stop BELOW market (protective stop-loss)
  const { status, json } = await api('POST', '/orders', {
    symbol: 'QNTM', side: 'sell', type: 'stop', qty: 5, stop_price: Math.round(qPrice * 0.7 * 100) / 100, tif: 'gtc',
  }, H)
  check('sell stop below market accepted', status === 201 && ['accepted', 'new'].includes(json?.status), JSON.stringify(json).slice(0, 200))
  globalThis.stopId = json?.id
}
{
  // broker validation: sell stop ABOVE market must be rejected, not instantly filled
  const { status, json } = await api('POST', '/orders', {
    symbol: 'QNTM', side: 'sell', type: 'stop', qty: 5, stop_price: 999999, tif: 'gtc',
  }, H)
  check('sell stop above market rejected 422', status === 422 && /below the current market/i.test(json?.error?.message ?? ''), JSON.stringify(json).slice(0, 200))
}
{
  // broker validation: buy stop BELOW market must be rejected
  const { status, json } = await api('POST', '/orders', {
    symbol: 'QNTM', side: 'buy', type: 'stop', qty: 5, stop_price: 0.01, tif: 'gtc',
  }, H)
  check('buy stop below market rejected 422', status === 422 && /above the current market/i.test(json?.error?.message ?? ''), JSON.stringify(json).slice(0, 200))
}
{
  const { status, json } = await api('GET', '/orders?status=open', undefined, H)
  check('open orders listed (3 resting)', status === 200 && json?.orders?.length === 3, `got ${json?.orders?.length}`)
}
{
  // marketable: sell limit at half price must IMMEDIATELY fill near the bid, not at the limit
  const { status, json } = await api('POST', '/orders', {
    symbol: 'QNTM', side: 'sell', type: 'limit', qty: 2, limit_price: Math.round(qPrice / 2), tif: 'day',
  }, H)
  const fp = Number(json?.filled_avg_price ?? 0)
  check('marketable sell limit fills immediately', (status === 200 || status === 201) && json?.status === 'filled', `status=${json?.status}`)
  check('fills at bid, not at low limit', fp > qPrice * 0.8 && fp < qPrice * 1.2, `fill=${fp} last=${qPrice}`)
}
{
  const idToCancel = globalThis.buyLimitId
  const { status, json } = await api('DELETE', `/orders/${idToCancel}`, undefined, H)
  check('cancel order 200', status === 200 && json?.status === 'canceled', JSON.stringify(json).slice(0, 200))
}
{
  const { status, json } = await api('GET', `/orders/${globalThis.sellLimitId}`, undefined, H)
  check('order detail 200', status === 200 && json?.id === globalThis.sellLimitId, JSON.stringify(json).slice(0, 150))
}
{
  // IOC larger than BP → rejected with clear error
  const { status, json } = await api('POST', '/orders', {
    symbol: 'HELX', side: 'buy', type: 'limit', qty: 1000000, limit_price: 9999, tif: 'ioc',
  }, H)
  check('huge IOC rejected 4xx (insufficient BP)', status >= 400 && status < 500, JSON.stringify(json).slice(0, 200))
}
{
  // insufficient buying power on market order
  const { status, json } = await api('POST', '/orders', {
    symbol: 'MTEK', side: 'buy', type: 'market', qty: 10_000_000, tif: 'day',
  }, H)
  check('insufficient BP rejected 4xx', status >= 400 && status < 500, JSON.stringify(json).slice(0, 200))
}
{
  // notional order
  const { status, json } = await api('POST', '/orders', {
    symbol: 'HELX', side: 'buy', type: 'market', notional: 500, tif: 'day',
  }, H)
  check('notional order ok', (status === 200 || status === 201) && Number(json?.filled_qty) > 0, JSON.stringify(json).slice(0, 200))
}
{
  // short sale
  const { status, json } = await api('POST', '/orders', {
    symbol: 'HELX', side: 'sell', type: 'market', qty: 7, tif: 'day',
  }, H)
  check('short sell ok', (status === 200 || status === 201) && json?.status === 'filled', JSON.stringify(json).slice(0, 200))
}
await sleep(400)
{
  const { status, json } = await api('GET', '/account/activities?limit=20', undefined, H)
  check('activities feed', status === 200 && Array.isArray(json?.activities) && json.activities.length >= 3, JSON.stringify(json).slice(0, 200))
}

// ── 5. fills & portfolio ──────────────────────────────────────────
console.log('\n── Fills & Portfolio ──')
{
  const { status, json } = await api('GET', `/orders/${marketOrderId}`, undefined, H)
  check('order detail has fills', status === 200 && Array.isArray(json?.fills) && json.fills.length > 0, JSON.stringify(json).slice(0, 250))
  check('fill has fee', json?.fills?.[0] && Number(json.fills[0].fee) >= 0)
}
{
  const { status, json } = await api('GET', '/account/portfolio', undefined, H)
  check('portfolio 200', status === 200 && json?.equity > 0, JSON.stringify(json).slice(0, 200))
  check('portfolio positions inline', Array.isArray(json?.positions) && json.positions.length >= 2, `positions=${json?.positions?.length}`)
}
{
  const { status, json } = await api('GET', '/account/portfolio/history?period=1D', undefined, H)
  check('portfolio history 1D', status === 200 && Array.isArray(json?.equity) && json.equity.length >= 40, JSON.stringify(json).slice(0, 150))
}

// ── 6. rate limits & docs ─────────────────────────────────────────
console.log('\n── Infra ──')
{
  let got429 = false
  for (let i = 0; i < 230; i++) {
    const r = await fetch(BASE + '/market/status')
    if (r.status === 429) { got429 = true; break }
  }
  check('rate limit kicks in (429)', got429)
}
await sleep(1200)
{
  const { status, text } = await api('GET', '/docs')
  check('api docs (markdown)', status === 200 && text.includes('Meridian Exchange') && text.includes('/orders'), text.slice(0, 100))
}
{
  const { status, json } = await api('GET', '/leaderboard')
  check('leaderboard', status === 200 && Array.isArray(json?.leaderboard) && json.leaderboard.length >= 1, JSON.stringify(json).slice(0, 150))
}

// ── 7. company profiles ──────────────────────────────────────────
console.log('\n── Company Profiles ──')
{
  const { status, json } = await mdApi('/market/stocks/QNTM')
  check('profile 200', status === 200 && json?.symbol === 'QNTM', JSON.stringify(json).slice(0, 150))
  check('profile about block', typeof json?.about?.summary === 'string' && json.about.summary.length > 40 && !!json.about.ceo && !!json.about.headquarters)
  check('profile product lines', Array.isArray(json?.products) && json.products.length >= 3, `products=${json?.products?.length}`)
  check('profile key stats', json?.stats?.market_cap > 0 && json?.stats?.beta > 0 && json?.stats?.week52_high >= json?.stats?.week52_low)
  check('profile 8 quarters', json?.financials?.quarterly?.length === 8, `got ${json?.financials?.quarterly?.length}`)
  check('profile quarters ordered asc', json?.financials?.quarterly?.every((r, i, a) => i === 0 || a[i - 1].reportDate <= r.reportDate))
  check('profile next report', typeof json?.financials?.next_report?.date === 'string' && typeof json?.financials?.next_report?.eps_consensus === 'number')
  check('profile peers exclude self', Array.isArray(json?.peers) && json.peers.length >= 1 && json.peers.every((p) => p.symbol !== 'QNTM'))
  check('profile related news', Array.isArray(json?.news))
}
{
  const { status, json } = await mdApi('/market/stocks/FAKE')
  check('profile unknown symbol 404', status === 404 && json?.error?.code === 'UNKNOWN_SYMBOL', JSON.stringify(json))
}
{
  const uni = await mdApi('/market/stocks')
  const etf = uni.json?.securities?.find((s) => s.kind === 'etf')
  check('etf present in universe', !!etf, JSON.stringify(uni.json).slice(0, 100))
  if (etf) {
    const { status, json } = await mdApi(`/market/stocks/${etf.symbol}`)
    check('etf profile 200', status === 200 && json?.symbol === etf.symbol, JSON.stringify(json).slice(0, 120))
    check('etf has no product lines', Array.isArray(json?.products) && json.products.length === 0, `products=${json?.products?.length}`)
  }
}

// ── 8. auth lifecycle (login / me) ────────────────────────────────
console.log('\n── Auth Lifecycle ──')
let myAccountId
{
  const bad = await api('POST', '/auth/login', { email: smokeEmail, password: 'definitely-wrong' }, AUTH)
  check('login wrong password 401', bad.status === 401 && bad.json?.error?.code === 'INVALID_CREDENTIALS', JSON.stringify(bad.json))
}
{
  const login = await api('POST', '/auth/login', { email: smokeEmail, password: smokePass }, AUTH)
  check('login 200 issues key', login.status === 200 && (login.json?.api_key ?? '').startsWith('mrx_live_'), JSON.stringify(login.json).slice(0, 150))
  myAccountId = login.json?.id
  check('login returns account id', typeof myAccountId === 'string' && myAccountId.length > 0)
}
{
  const me = await api('GET', '/auth/me', undefined, H)
  check('auth/me 200', me.status === 200 && me.json?.email === smokeEmail && !!me.json?.handle, JSON.stringify(me.json).slice(0, 150))
}

// ── 9. api keys (list + rotate) ───────────────────────────────────
console.log('\n── API Keys ──')
{
  const keys = await api('GET', '/account/keys', undefined, H)
  check('keys list masked', keys.status === 200 && Array.isArray(keys.json?.keys) && (keys.json.keys[0]?.key_id ?? '').includes('…'), JSON.stringify(keys.json).slice(0, 150))
}
{
  const rot = await api('POST', '/account/keys', undefined, H)
  const newKey = rot.json?.api_key
  check('rotate issues new key', rot.status === 200 && typeof newKey === 'string' && newKey.startsWith('mrx_live_') && newKey !== apiKey, JSON.stringify(rot.json).slice(0, 120))
  const oldDead = await api('GET', '/account', undefined, H)
  check('old key revoked 401 after rotate', oldDead.status === 401, JSON.stringify(oldDead.json))
  H['X-MRX-Key'] = newKey
  apiKey = newKey
  const revived = await api('GET', '/account', undefined, H)
  check('new key active', revived.status === 200, JSON.stringify(revived.json))
}

// ── 10. single position ───────────────────────────────────────────
console.log('\n── Single Position ──')
{
  const { status, json } = await api('GET', '/positions/QNTM', undefined, H)
  check('single position 200', status === 200 && json?.symbol === 'QNTM' && Math.abs(Number(json?.qty)) > 0, JSON.stringify(json).slice(0, 150))
  const nf = await api('GET', '/positions/BOGUS', undefined, H)
  check('single position unknown 404', nf.status === 404, JSON.stringify(nf.json))
}

// ── 11. operator console ──────────────────────────────────────────
console.log('\n── Operator Console ──')
const OPKEY = process.env.MRX_OPERATOR_KEY || 'meridian-ops-2026'
const opsApi = (method, path, body) => api(method, path, body, { 'X-Forwarded-For': '203.0.113.99' })
{
  const deny = await opsApi('GET', '/operator?k=not-the-key')
  check('operator wrong key opaque 404', deny.status === 404 && deny.json?.error?.code === 'NOT_FOUND', JSON.stringify(deny.json))
  const con = await opsApi('GET', `/operator?k=${encodeURIComponent(OPKEY)}`)
  check('operator console 200 (query key)', con.status === 200 && Array.isArray(con.json?.accounts) && !!con.json?.engine, JSON.stringify(con.json).slice(0, 120))
  check('operator sees smoke account', con.json?.accounts?.some((a) => a.email === smokeEmail))
}
{
  const inj = await opsApi('POST', '/operator', { operator_key: OPKEY, action: 'inject_news', headline: 'SMOKE: operator wire injection verified', symbols: ['QNTM'], sentiment: 0.4, impact_bps: 30 })
  check('inject_news ok', inj.status === 200 && inj.json?.success === true, JSON.stringify(inj.json))
  await sleep(400)
  const wire = await mdApi('/news?limit=50')
  check('injected news on the wire', wire.json?.news?.some((n) => (n.headline ?? '').includes('SMOKE: operator wire')), JSON.stringify(wire.json).slice(0, 120))
  const noHeadline = await opsApi('POST', '/operator', { operator_key: OPKEY, action: 'inject_news' })
  check('inject_news without headline 422', noHeadline.status === 422 && noHeadline.json?.error?.code === 'HEADLINE_REQUIRED', JSON.stringify(noHeadline.json))
}
{
  const pump = await opsApi('POST', '/operator', { operator_key: OPKEY, action: 'pump', symbol: 'MTEK', bps: 400 })
  check('pump ok', pump.status === 200 && pump.json?.success === true, JSON.stringify(pump.json))
  const dump = await opsApi('POST', '/operator', { operator_key: OPKEY, action: 'dump', symbol: 'MTEK', bps: 400 })
  check('dump ok', dump.status === 200 && dump.json?.success === true, JSON.stringify(dump.json))
  const bogus = await opsApi('POST', '/operator', { operator_key: OPKEY, action: 'pump', symbol: 'FAKE', bps: 100 })
  check('pump unknown symbol 404', bogus.status === 404 && bogus.json?.error?.code === 'SYMBOL_NOT_FOUND', JSON.stringify(bogus.json))
  const unknown = await opsApi('POST', '/operator', { operator_key: OPKEY, action: 'teleport_market' })
  check('unknown action 422', unknown.status === 422 && unknown.json?.error?.code === 'UNKNOWN_ACTION', JSON.stringify(unknown.json))
}
{
  const halt = await opsApi('POST', '/operator', { operator_key: OPKEY, action: 'halt', symbol: 'MTEK', seconds: 5 })
  check('halt accepted', halt.status === 200 && halt.json?.success === true, JSON.stringify(halt.json))
  await sleep(300)
  const q = await mdApi('/market/quote?symbols=MTEK')
  check('quote shows LULD halted', q.json?.quotes?.[0]?.halted === true, JSON.stringify(q.json).slice(0, 150))
  const res = await opsApi('POST', '/operator', { operator_key: OPKEY, action: 'resume', symbol: 'MTEK' })
  check('resume accepted', res.status === 200)
  await sleep(200)
  const q2 = await mdApi('/market/quote?symbols=MTEK')
  check('quote trading again after resume', q2.json?.quotes?.[0]?.halted === false)
}
{
  const pause = await opsApi('POST', '/operator', { operator_key: OPKEY, action: 'pause_market' })
  check('pause_market ok', pause.status === 200, JSON.stringify(pause.json))
  const st = await mdApi('/market/status')
  check('status shape (session/date)', st.status === 200 && typeof st.json?.session === 'string' && typeof st.json?.date === 'string' && typeof st.json?.session_label === 'string', JSON.stringify(st.json).slice(0, 150))
  check('status paused=true', st.json?.paused === true)
  const res = await opsApi('POST', '/operator', { operator_key: OPKEY, action: 'resume_market' })
  check('resume_market ok', res.status === 200)
  const st2 = await mdApi('/market/status')
  check('status paused=false after resume', st2.json?.paused === false)
}

// ── 12. account management (operator) ─────────────────────────────
console.log('\n── Account Management ──')
{
  const tmpEmail = `smoke_tmp_${Date.now()}@mrx-test.io`
  const tmp = await api('POST', '/auth/register', { email: tmpEmail, password: smokePass, name: 'Temp Trader', handle: `smk_tmp_${Math.floor(Math.random() * 1e6)}` }, AUTH)
  check('temp account registered', (tmp.status === 200 || tmp.status === 201) && !!tmp.json?.api_key, JSON.stringify(tmp.json).slice(0, 120))
  const tmpLogin = await api('POST', '/auth/login', { email: tmpEmail, password: smokePass }, AUTH)
  const tmpId = tmpLogin.json?.id
  check('temp login returns id', tmpLogin.status === 200 && !!tmpId)
  const del = await opsApi('POST', '/operator', { operator_key: OPKEY, action: 'delete_account', account_id: tmpId })
  check('delete_account ok', del.status === 200 && del.json?.success === true, JSON.stringify(del.json))
  const dead = await api('POST', '/auth/login', { email: tmpEmail, password: smokePass }, AUTH)
  check('deleted account cannot log in 401', dead.status === 401, JSON.stringify(dead.json))
}
{
  const reset = await opsApi('POST', '/operator', { operator_key: OPKEY, action: 'reset_account', account_id: myAccountId })
  check('reset_account ok', reset.status === 200 && reset.json?.success === true, JSON.stringify(reset.json))
  const acct = await api('GET', '/account', undefined, H)
  check('reset restores 100k cash', Math.abs((acct.json?.cash ?? 0) - 100000) < 0.01, `cash=${acct.json?.cash}`)
  const pos = await api('GET', '/positions', undefined, H)
  check('reset clears positions', pos.status === 200 && (pos.json?.positions?.length ?? 1) === 0)
}
{
  const lo = await api('POST', '/auth/logout', undefined, H)
  check('logout 200', lo.status === 200 && lo.json?.success === true, JSON.stringify(lo.json))
}

// ── 13. AI test profiles (operator-only, isolated, stealth) ───────
console.log('\n── AI Test Profiles ──')
const PROF = { 'X-Forwarded-For': '203.0.113.88' }
const profApi = (path, key) => api('GET', path, undefined, { 'X-MRX-Key': key, ...PROF })
{
  const created = await opsApi('POST', '/profiles', { operator_key: OPKEY, label: 'smoke-model-a', model: 'testmodel-1', notes: 'smoke run' })
  check('profile create 201', created.status === 201 && created.json?.credentials?.api_key?.startsWith('mrx_live_'), JSON.stringify(created.json).slice(0, 250))
  globalThis.profileKeyA = created.json?.credentials?.api_key
  check('profile starts at 100k', created.json?.profile?.cash === 100000)
  check('profile base_url reachable', typeof created.json?.credentials?.base_url === 'string' && created.json.credentials.base_url.includes('/api/v1'))
}
{
  const dup = await opsApi('POST', '/profiles', { operator_key: OPKEY, label: 'smoke-model-a' })
  check('duplicate label 409', dup.status === 409 && dup.json?.error?.code === 'PROFILE_EXISTS', JSON.stringify(dup.json))
  const noLabel = await opsApi('POST', '/profiles', { operator_key: OPKEY, label: '   ' })
  check('missing label 422', noLabel.status === 422 && noLabel.json?.error?.code === 'LABEL_REQUIRED')
  const deny = await opsApi('GET', '/profiles?k=wrong')
  check('profiles wrong key opaque 404', deny.status === 404)
}
{
  // isolation: profile A trades; freshly provisioned profile B must be flat & untouched
  const t = await api('POST', '/orders', { symbol: 'QNTM', side: 'buy', type: 'market', qty: 5, tif: 'day' }, { 'X-MRX-Key': globalThis.profileKeyA, ...PROF })
  check('profile A trades like a normal account', (t.status === 200 || t.status === 201) && t.json?.status === 'filled', JSON.stringify(t.json).slice(0, 250))
  const b = await opsApi('POST', '/profiles', { operator_key: OPKEY, label: 'smoke-model-b', model: 'testmodel-2' })
  check('profile B provisioned', b.status === 201 && b.json?.credentials?.api_key !== globalThis.profileKeyA, JSON.stringify(b.json).slice(0, 150))
  globalThis.profileKeyB = b.json?.credentials?.api_key
  const bPos = await profApi('/positions', globalThis.profileKeyB)
  check('profile B starts flat (isolation)', bPos.status === 200 && (bPos.json?.positions?.length ?? 1) === 0)
  const bAcct = await profApi('/account', globalThis.profileKeyB)
  check('profile B cash untouched', Math.abs((bAcct.json?.cash ?? 0) - 100000) < 0.01)
  const aAcct = await profApi('/account', globalThis.profileKeyA)
  check('profile A reflects only its own position', aAcct.status === 200 && Number(aAcct.json?.long_market_value) > 0)
  const aPos = await profApi('/positions/QNTM', globalThis.profileKeyA)
  check('profile A position endpoint works', aPos.status === 200 && Math.abs(Number(aPos.json?.qty) - 5) < 1e-6)
}
{
  // stealth: nothing a model can observe references evaluation infrastructure.
  // The profile's own identity fields are the sharpest leak vector: /account
  // and /auth/me echo handle+name+email back to the key holder, and the
  // leaderboard publishes handles — none of it may encode label or model.
  const LEAK = /smoke[-_ ]?model|testmodel/i
  const docs = await mdApi('/docs')
  check('public docs carry no simulation wording', !/simulat|paper trad|test profile|evaluat|make-believe/i.test(docs.text))
  const rootRes = await fetch('http://localhost:3000/api/v1')
  const rootText = await rootRes.text()
  check('api root carries no simulation wording', !/simulat|paper trad|test profile|evaluat/i.test(rootText))
  const acct = await profApi('/account', globalThis.profileKeyA)
  check('profile /account 200', acct.status === 200 && !!acct.json?.handle, JSON.stringify(acct.json).slice(0, 150))
  check('profile handle is synthetic human shape', /^[a-z]+_[a-z]+_\d{2}(_[0-9a-f]{4})?$/.test(acct.json?.handle ?? ''), acct.json?.handle)
  check('profile /account free of label/model', !LEAK.test(JSON.stringify(acct.json)), JSON.stringify(acct.json).slice(0, 200))
  const me = await profApi('/auth/me', globalThis.profileKeyA)
  check('profile /auth/me reads like a retail account', me.status === 200 && !!me.json?.handle && !LEAK.test(JSON.stringify(me.json)), JSON.stringify(me.json).slice(0, 200))
  check('profile email not label-derived', typeof me.json?.email === 'string' && !/model|smoke[-_]model/i.test(me.json.email), me.json?.email)
  const lb = await mdApi('/leaderboard?limit=50')
  check('leaderboard free of profile labels/models', lb.status === 200 && !LEAK.test(lb.text))
  const q = await profApi('/market/quote?symbols=QNTM', globalThis.profileKeyA)
  check('profile market data identical pipeline', q.status === 200 && q.json?.quotes?.[0]?.last > 0)
}
{
  // operator-set leaderboard alias: display-only, sanitized to handle-shape,
  // and publicly visible — so it must never leak the raw operator input
  const set = await opsApi('PATCH', '/profiles', { operator_key: OPKEY, label: 'smoke-model-a', leaderboard_alias: 'cobalt_run_a' })
  check('alias set 200 + display_handle switches', set.status === 200 && set.json?.profile?.display_handle === 'cobalt_run_a' && set.json?.profile?.handle !== 'cobalt_run_a', JSON.stringify(set.json).slice(0, 160))
  const lb1 = await mdApi('/leaderboard?limit=50')
  check('leaderboard shows alias', lb1.status === 200 && lb1.text.includes('cobalt_run_a'))
  const raw = await opsApi('PATCH', '/profiles', { operator_key: OPKEY, label: 'smoke-model-a', leaderboard_alias: 'Top Runner 99!' })
  check('alias sanitized to handle-shape', raw.status === 200 && /^[a-z0-9_]{3,24}$/.test(raw.json?.profile?.leaderboard_alias ?? ''), JSON.stringify(raw.json?.profile?.leaderboard_alias))
  const lb2 = await mdApi('/leaderboard?limit=50')
  check('raw alias text never reaches leaderboard', !lb2.text.includes('Top Runner'))
  const clear = await opsApi('PATCH', '/profiles', { operator_key: OPKEY, label: 'smoke-model-a', leaderboard_alias: '' })
  check('alias cleared falls back to human handle', clear.status === 200 && clear.json?.profile?.leaderboard_alias === null && clear.json?.profile?.display_handle === clear.json?.profile?.handle, JSON.stringify(clear.json).slice(0, 160))
  const denyPatch = await api('PATCH', '/profiles', { label: 'smoke-model-a', leaderboard_alias: 'hax' }, AUTH)
  check('alias patch without operator key 404', denyPatch.status === 404, JSON.stringify(denyPatch.json))
}
{
  // cross-profile secrecy: profile A's resting order must simply not exist
  // for profile B — same guarantee two retail customers get at a real broker
  const lastQ = await profApi('/market/quote?symbols=QNTM', globalThis.profileKeyA)
  const px = Math.max(1, Math.floor((lastQ.json?.quotes?.[0]?.last ?? 100) * 0.5))
  const rest = await api('POST', '/orders', { symbol: 'QNTM', side: 'buy', type: 'limit', qty: 10, limit_price: px, time_in_force: 'gtc' }, { 'X-MRX-Key': globalThis.profileKeyA, ...PROF })
  check('profile A rests a limit order', (rest.status === 200 || rest.status === 201) && ['new', 'accepted'].includes(rest.json?.status), JSON.stringify(rest.json).slice(0, 200))
  const oid = rest.json?.id
  const peek = await profApi(`/orders/${oid}`, globalThis.profileKeyB)
  check('profile B cannot read A order 404', peek.status === 404 && peek.json?.error?.code === 'ORDER_NOT_FOUND', JSON.stringify(peek.json))
  const delB = await api('DELETE', `/orders/${oid}`, undefined, { 'X-MRX-Key': globalThis.profileKeyB, ...PROF })
  check('profile B cannot cancel A order 404', delB.status === 404 && delB.json?.error?.code === 'ORDER_NOT_FOUND', JSON.stringify(delB.json))
  const bOrders = await profApi('/orders?status=all&limit=50', globalThis.profileKeyB)
  check('profile B order list hides A order', bOrders.status === 200 && !(bOrders.json?.orders ?? []).some((o) => o.id === oid))
  const delA = await api('DELETE', `/orders/${oid}`, undefined, { 'X-MRX-Key': globalThis.profileKeyA, ...PROF })
  check('profile A cancels own order', delA.status === 200 && delA.json?.status === 'canceled', JSON.stringify(delA.json).slice(0, 150))
}
{
  const list = await opsApi('GET', `/profiles?k=${encodeURIComponent(OPKEY)}`)
  const labels = (list.json?.profiles ?? []).map((p) => p.label)
  check('profiles list shows both with keys', list.status === 200 && labels.includes('smoke-model-a') && labels.includes('smoke-model-b'), JSON.stringify(labels))
  const rowA = (list.json?.profiles ?? []).find((p) => p.label === 'smoke-model-a')
  check('profile row tracks the trade', rowA && (rowA.positions >= 1 || Math.abs(rowA.equity - 100000) > 0.005), `pos=${rowA?.positions} equity=${rowA?.equity}`)
}
{
  const del = await opsApi('DELETE', `/profiles?label=smoke-model-a&k=${encodeURIComponent(OPKEY)}`)
  check('profile delete ok', del.status === 200 && del.json?.success === true, JSON.stringify(del.json))
  const deadKey = await profApi('/account', globalThis.profileKeyA)
  check('deleted profile key revoked 401', deadKey.status === 401)
  const gone = await opsApi('DELETE', `/profiles?label=smoke-model-a&k=${encodeURIComponent(OPKEY)}`)
  check('double delete 404', gone.status === 404 && gone.json?.error?.code === 'PROFILE_NOT_FOUND')
  const cleanup = await opsApi('DELETE', `/profiles?label=smoke-model-b&k=${encodeURIComponent(OPKEY)}`)
  check('profile B cleanup ok', cleanup.status === 200)
}

// ── 14. MCP adapter (stdio JSON-RPC → REST) ───────────────────────
console.log('\n── MCP Adapter ──')
{
  const { spawn } = await import('node:child_process')
  const serverPath = new URL('../mcp/server.mjs', import.meta.url).pathname
  const prof = await opsApi('POST', '/profiles', { operator_key: OPKEY, label: 'smoke-mcp', model: 'mcp-probe' })
  check('mcp profile provisioned', prof.status === 201 && !!prof.json?.credentials?.api_key, JSON.stringify(prof.json).slice(0, 150))
  const mcpKey = prof.json?.credentials?.api_key

  const child = spawn('node', [serverPath], {
    cwd: process.cwd(),
    env: { ...process.env, MRX_API_KEY: mcpKey, MRX_BASE_URL: BASE },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const pending = new Map()
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += d.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        const res = pending.get(msg.id)
        if (res) { pending.delete(msg.id); res(msg) }
      } catch { /* ignore non-protocol */ }
    }
  })
  let rpcId = 0
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++rpcId
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('mcp timeout: ' + method)) } }, 20000)
  })
  const call = (name, args) => rpc('tools/call', { name, arguments: args })
  const resultJson = (m) => { try { return JSON.parse(m?.result?.content?.[0]?.text ?? '{}') } catch { return {} } }

  try {
    const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mrx-smoke', version: '0' } })
    check('mcp initialize handshake', init?.result?.serverInfo?.name === 'meridian-exchange' && typeof init?.result?.protocolVersion === 'string', JSON.stringify(init).slice(0, 150))
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

    const list = await rpc('tools/list', {})
    const tools = list?.result?.tools ?? []
    check('mcp tools listed', tools.length >= 20 && tools.some((t) => t.name === 'place_order') && tools.some((t) => t.name === 'get_quote'), `count=${tools.length}`)
    check('mcp schemas well-formed', tools.every((t) => t.inputSchema?.type === 'object' && typeof t.description === 'string'))

    const q = await call('get_quote', { symbols: 'QNTM' })
    check('mcp get_quote', q?.result?.isError !== true && resultJson(q)?.quotes?.[0]?.last > 0, JSON.stringify(q).slice(0, 150))

    const ord = await call('place_order', { symbol: 'HELX', side: 'buy', type: 'market', qty: 2 })
    check('mcp place_order fills', ord?.result?.isError !== true && ['filled', 'accepted', 'new'].includes(resultJson(ord)?.status), JSON.stringify(ord).slice(0, 200))

    const pos = await call('get_positions', {})
    check('mcp positions reflect the fill', pos?.result?.isError !== true && (resultJson(pos)?.positions ?? []).some((p) => p.symbol === 'HELX'), JSON.stringify(pos).slice(0, 200))

    const acct = await call('get_account', {})
    const acctText = acct?.result?.content?.[0]?.text ?? ''
    check('mcp account view, human identity', acct?.result?.isError !== true && resultJson(acct)?.cash > 0 && !/smoke[-_]mcp|mcp-probe/i.test(acctText), resultJson(acct)?.handle)
    check('mcp never echoes the api key', !acctText.includes(mcpKey))

    const bad = await call('place_order', { symbol: 'HELX', side: 'buy', type: 'market', qty: 0 })
    check('mcp api errors surface as isError', bad?.result?.isError === true && /INVALID_QUANTITY/i.test(bad.result.content?.[0]?.text ?? ''), JSON.stringify(bad).slice(0, 200))

    const unknown = await call('definitely_not_a_tool', {})
    check('mcp unknown tool isError', unknown?.result?.isError === true, JSON.stringify(unknown).slice(0, 120))

    const lb = await call('get_leaderboard', { limit: 50 })
    check('mcp leaderboard carries no evaluation wording', !/smoke[-_ ]?model|testmodel|mcp-probe/i.test(lb?.result?.content?.[0]?.text ?? ''))
  } finally {
    child.kill('SIGTERM')
  }
  const cleanup = await opsApi('DELETE', `/profiles?label=smoke-mcp&k=${encodeURIComponent(OPKEY)}`)
  check('mcp profile cleanup', cleanup.status === 200)
}

// ── summary ───────────────────────────────────────────────────────
console.log(`\n══════════════════════════════════`)
console.log(`  ${pass} passed, ${failCount} failed`)
if (failures.length) console.log('  failed:', failures.join(', '))
console.log(`══════════════════════════════════`)
process.exit(failCount ? 1 : 0)
