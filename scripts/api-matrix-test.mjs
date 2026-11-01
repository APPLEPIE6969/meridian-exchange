// MRX API matrix — exercises every documented endpoint across auth states,
// parameter validation and error contracts, against a live server.
// Complements smoke-test.mjs (trading lifecycle) with breadth: every route,
// every documented failure code, CORS headers, and the 429 contract.
const BASE = 'http://localhost:3000/api/v1'
let pass = 0
let failCount = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { failCount++; failures.push(name); console.log(`FAIL  ${name} ${detail}`) }
}

async function api(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON */ }
  return { status: res.status, json, headers: res.headers }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Distinct rate-limit buckets so the deliberate 429 sweep never starves others
const anon = { 'X-Forwarded-For': '198.51.100.10' }
const opsKey = process.env.MRX_OPERATOR_KEY || 'meridian-ops-2026'
const OPS = { 'x-operator-key': opsKey, 'X-Forwarded-For': '198.51.100.11' }

console.log('\n── Registration (unique emails; isolated buckets) ──')
const email = `matrix-${Date.now()}@mrx.dev`
let key = null
{
  const reg = await api('POST', '/auth/register', { email, password: 'password123', handle: 'matrix_probe' }, { 'X-Forwarded-For': '198.51.100.12' })
  check('register 201 + api_key', reg.status === 201 && typeof reg.json.api_key === 'string' && reg.json.api_key.startsWith('mrx_live_'), JSON.stringify(reg.json).slice(0, 120))
  check('register CORS header', reg.headers.get('access-control-allow-origin') === '*')
  check('register sets session cookie', (reg.headers.get('set-cookie') || '').includes('mrx_session='))
  key = reg.json.api_key
  const dup = await api('POST', '/auth/register', { email, password: 'password123' }, { 'X-Forwarded-For': '198.51.100.12' })
  check('duplicate email 409 ACCOUNT_EXISTS', dup.status === 409 && dup.json.error.code === 'ACCOUNT_EXISTS')
  const auth = { authorization: `Bearer ${key}` }
  console.log('\n── Market data (public) ──')
  const market = [
    ['/market/status', 'exchange'],
    ['/market/stocks', 'securities'],
    ['/market/quote?symbols=QNTM', 'quotes'],
    ['/market/candles?symbol=QNTM&interval=5m', 'bars'],
    ['/market/candles?symbol=IRWQ&interval=1d&range=ALL&limit=20000', 'bars'],
    ['/market/orderbook?symbol=QNTM', 'bids'],
    ['/market/trades?symbol=QNTM', 'trades'],
    ['/market/movers', 'gainers'],
    ['/market/indices', 'composite'],
    ['/market/calendar', 'events'],
    ['/news', 'news'],
    ['/leaderboard', 'leaderboard'],
  ]
  for (const [path, field] of market) {
    const r = await api('GET', path, undefined, anon)
    check(`GET ${path.split('?')[0]} 200`, r.status === 200 && r.json && field in r.json, `status ${r.status}`)
  }
  const stock = await api('GET', '/market/stocks/QNTM', undefined, anon)
  check('GET /market/stocks/{symbol} full profile', stock.status === 200 && stock.json.about && stock.json.financials.quarterly.length === 8 && Array.isArray(stock.json.peers))
  const doc = await fetch(BASE + '/docs')
  check('GET /docs returns markdown', doc.status === 200 && (await doc.text()).includes('# Meridian Exchange'))

  console.log('\n── Parameter validation (public) ──')
  const invalid = [
    ['/market/quote', 422, 'SYMBOLS_REQUIRED'],
    ['/market/quote?symbols=NOPE', 404, 'SYMBOL_NOT_FOUND'],
    ['/market/candles?symbol=QNTM&interval=9s', 422, 'INVALID_INTERVAL'],
    ['/market/candles?symbol=QNTM&start=999&end=100', 422, 'INVALID_RANGE'],
    ['/market/orderbook', 422, 'SYMBOL_REQUIRED'],
    ['/market/orderbook?symbol=NOPE', 404, 'SYMBOL_NOT_FOUND'],
    ['/market/trades', 422, 'SYMBOL_REQUIRED'],
    ['/market/stocks/NOPE', 404, 'UNKNOWN_SYMBOL'],
  ]
  for (const [path, status, code] of invalid) {
    const r = await api('GET', path, undefined, anon)
    check(`GET ${path} → ${status} ${code}`, r.status === status && r.json?.error?.code === code, `got ${r.status} ${r.json?.error?.code}`)
  }

  console.log('\n── Authentication wall ──')
  const guarded = ['/account', '/account/portfolio', '/account/activities', '/account/keys', '/positions', '/orders']
  for (const path of guarded) {
    const r = await api('GET', path, undefined, anon)
    check(`anon GET ${path} → 401`, r.status === 401 && r.json?.error?.code === 'UNAUTHORIZED')
  }
  const badKey = await api('GET', '/account', undefined, { authorization: 'Bearer mrx_live_ffffffffffffffffffffffffffffffffffffffff' })
  check('bogus key 401', badKey.status === 401)

  console.log('\n── Trading surface (authed) ──')
  const acct = await api('GET', '/account', undefined, auth)
  check('GET /account 200 broker view', acct.status === 200 && acct.json.multiplier === '2' && acct.json.buying_power > 0)
  const me = await api('GET', '/auth/me', undefined, auth)
  check('GET /auth/me mirrors account', me.status === 200 && me.json.id === acct.json.id)
  const pf = await api('GET', '/account/portfolio', undefined, auth)
  check('GET /account/portfolio shape', pf.status === 200 && Array.isArray(pf.json.positions))
  const hist = await api('GET', '/account/portfolio/history?period=1D', undefined, auth)
  check('GET portfolio/history 1D', hist.status === 200 && hist.json.equity.length > 40)
  const badPeriod = await api('GET', '/account/portfolio/history?period=2W', undefined, auth)
  check('history invalid period 422', badPeriod.status === 422 && badPeriod.json.error.code === 'INVALID_PERIOD')
  const acts = await api('GET', '/account/activities', undefined, auth)
  check('GET /account/activities 200', acts.status === 200 && Array.isArray(acts.json.activities))
  const keys = await api('GET', '/account/keys', undefined, auth)
  check('GET /account/keys masks secret', keys.status === 200 && keys.json.keys[0].secret_masked === '••••••••••••')

  const place = await api('POST', '/orders', { symbol: 'QNTM', qty: 1, side: 'buy', type: 'market' }, auth)
  check('POST /orders market fill 201', place.status === 201 && place.json.status === 'filled', JSON.stringify(place.json).slice(0, 140))
  check('order view strings qty', place.json.qty === '1' && place.json.asset_class === 'us_equity')
  const coid = `matrix-${Date.now()}`
  const rest = await api('POST', '/orders', { symbol: 'QNTM', qty: 1, side: 'buy', type: 'limit', limit_price: 1, time_in_force: 'gtc', client_order_id: coid }, auth)
  check('POST resting limit accepted', rest.status === 201 && rest.json.status === 'accepted')
  const dupe = await api('POST', '/orders', { symbol: 'QNTM', qty: 1, side: 'buy', type: 'limit', limit_price: 1, time_in_force: 'gtc', client_order_id: coid }, auth)
  check('client_order_id idempotent replay', dupe.status === 201 && dupe.json.id === rest.json.id, `got ${dupe.status} id ${dupe.json?.id} vs ${rest.json?.id}`)
  const openList = await api('GET', '/orders?status=open', undefined, auth)
  check('GET /orders?status=open finds the resting one', openList.status === 200 && openList.json.orders.some((o) => o.id === rest.json.id))
  const one = await api('GET', `/orders/${place.json.id}`, undefined, auth)
  check('GET /orders/{id} with fills', one.status === 200 && Array.isArray(one.json.fills) && one.json.fills.length === 1)
  const cancel = await api('DELETE', `/orders/${rest.json.id}`, undefined, auth)
  check('DELETE /orders/{id} cancels', cancel.status === 200 && cancel.json.status === 'canceled')
  const recancel = await api('DELETE', `/orders/${rest.json.id}`, undefined, auth)
  check('re-cancel 422 ORDER_ALREADY_PROCESSED', recancel.status === 422 && recancel.json.error.code === 'ORDER_ALREADY_PROCESSED')

  const pos = await api('GET', '/positions/QNTM', undefined, auth)
  check('GET /positions/{symbol} 200', pos.status === 200 && pos.json.symbol === 'QNTM')
  const flat = await api('GET', '/positions/AQFR', undefined, auth)
  check('flat position 404 POSITION_NOT_FOUND', flat.status === 404 && flat.json.error.code === 'POSITION_NOT_FOUND')

  console.log('\n── Order rejection codes ──')
  const rejects = [
    [{ symbol: 'NOPE', qty: 1, side: 'buy', type: 'market' }, 404, 'SYMBOL_NOT_FOUND'],
    [{ symbol: 'QNTM', qty: 0, side: 'buy', type: 'market' }, 422, 'INVALID_QUANTITY'],
    [{ symbol: 'QNTM', qty: 1, side: 'buy', type: 'weird' }, 422, 'INVALID_ORDER_TYPE'],
    [{ symbol: 'QNTM', qty: 1, side: 'sideways', type: 'market' }, 422, 'INVALID_SIDE'],
    [{ symbol: 'QNTM', qty: 1, side: 'buy', type: 'limit' }, 422, 'LIMIT_PRICE_REQUIRED'],
    [{ symbol: 'QNTM', qty: 1, side: 'buy', type: 'stop' }, 422, 'STOP_PRICE_REQUIRED'],
    [{ symbol: 'QNTM', notional: 9000000, side: 'buy', type: 'market' }, 422, 'INSUFFICIENT_BUYING_POWER'],
  ]
  for (const [body, status, code] of rejects) {
    const r = await api('POST', '/orders', body, auth)
    check(`POST /orders ${code}`, r.status === status && r.json?.error?.code === code, `got ${r.status} ${r.json?.error?.code}`)
  }

  console.log('\n── Key rotation ──')
  const rot = await api('POST', '/account/keys/rotate', {}, auth)
  check('POST /account/keys/rotate 200', rot.status === 200 && rot.json.api_key.startsWith('mrx_live_'))
  const stale = await api('GET', '/account', undefined, auth)
  check('old key revoked (401)', stale.status === 401)
  key = rot.json.api_key
  const freshAuth = { authorization: `Bearer ${key}` }
  const revive = await api('GET', '/account', undefined, freshAuth)
  check('new key authenticates', revive.status === 200)

  console.log('\n── Operator surface (hidden from public docs) ──')
  const opDenied = await api('GET', '/operator', undefined, anon)
  check('anon /operator → 404 (undetectable)', opDenied.status === 404)
  const opList = await api('GET', '/operator', undefined, OPS)
  check('operator GET lists accounts', opList.status === 200 && Array.isArray(opList.json.accounts) && opList.json.engine.instruments > 0)
  const flash = await api('POST', '/operator', { action: 'inject_news', headline: 'Matrix test: operator wire flash', impact_bps: 0 }, OPS)
  check('operator inject_news works', flash.status === 200 && flash.json.success)
  const opAction = await api('POST', '/operator', { action: 'shock_market', bps: 10, operator_key: opsKey }, anon)
  check('operator body-key auth works', opAction.status === 200)

  console.log('\n── Profile fleet (operator-only) ──')
  const profDenied = await api('GET', '/profiles', undefined, anon)
  check('anon /profiles → 404', profDenied.status === 404)
  const label = `matrix-${Date.now()}`
  const prof = await api('POST', '/profiles', { label, operator_key: opsKey })
  check('POST /profiles provisions', prof.status === 201 && prof.json.profile.label === label && prof.json.credentials.api_key.startsWith('mrx_live_'))
  const profList = await api('GET', '/profiles', undefined, OPS)
  check('GET /profiles lists the fleet', profList.status === 200 && profList.json.profiles.some((p) => p.label === label))
  const patch = await api('PATCH', '/profiles', { label, leaderboard_alias: 'matrix_probe_01', operator_key: opsKey })
  check('PATCH alias sanitizes', patch.status === 200 && patch.body?.profile?.leaderboard_alias === 'matrix_probe_01' || patch.json.profile?.leaderboard_alias === 'matrix_probe_01', JSON.stringify(patch.json).slice(0, 100))
  const del = await api('DELETE', `/profiles?label=${label}`, undefined, OPS)
  check('DELETE /profile removes it', del.status === 200 && del.json.success)

  console.log('\n── Internal resolve (relay bootstrap; /api/internal, not /api/v1) ──')
  const resolveAt = (body) => fetch('http://localhost:3000/api/internal/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))
  const res1 = await resolveAt({ api_key: key })
  check('resolve valid key → account_id', res1.status === 200 && typeof res1.json.account_id === 'string', JSON.stringify(res1).slice(0, 100))
  const res2 = await resolveAt({})
  check('resolve missing key 422', res2.status === 422)
  const res3 = await resolveAt({ api_key: 'nope' })
  check('resolve bad key 401', res3.status === 401)

  console.log('\n── Rate limiting (isolated bucket) ──')
  const bucket = { 'X-Forwarded-For': `198.51.100.99-${Date.now()}` }
  let last = null
  for (let i = 0; i < 201; i++) last = await api('GET', '/market/status', undefined, bucket)
  check('201st request → 429 RATE_LIMIT_EXCEEDED', last.status === 429 && last.json.error.code === 'RATE_LIMIT_EXCEEDED', `got ${last.status}`)
  check('429 carries Retry-After', Number(last.headers.get('retry-after')) > 0)

  console.log('\n── Unknown routes & methods ──')
  const missing = await api('GET', '/market/nonexistent', undefined, anon)
  check('unknown endpoint 404', missing.status === 404)
  const badMethod = await api('PATCH', '/market/status', {}, anon)
  check('unsupported method rejected', [404, 405].includes(badMethod.status))
}

console.log(`\n═══ API matrix: ${pass} passed, ${failCount} failed ═══`)
if (failCount) {
  console.log('Failures:', failures.join(' | '))
  process.exit(1)
}
