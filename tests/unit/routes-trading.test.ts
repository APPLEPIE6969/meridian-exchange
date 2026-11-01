// Trading, auth, operator and profile-management endpoints — handlers called
// directly. Each registered account provides its own rate-limit bucket (key).

import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as registerPOST } from '@/app/api/v1/auth/register/route'
import { POST as loginPOST } from '@/app/api/v1/auth/login/route'
import { POST as logoutPOST } from '@/app/api/v1/auth/logout/route'
import { GET as meGET } from '@/app/api/v1/auth/me/route'
import { GET as accountGET } from '@/app/api/v1/account/route'
import { GET as portfolioGET } from '@/app/api/v1/account/portfolio/route'
import { GET as historyGET } from '@/app/api/v1/account/portfolio/history/route'
import { GET as activitiesGET } from '@/app/api/v1/account/activities/route'
import { GET as keysGET, POST as keysPOST } from '@/app/api/v1/account/keys/route'
import { POST as rotatePOST } from '@/app/api/v1/account/keys/rotate/route'
import { GET as positionsGET } from '@/app/api/v1/positions/route'
import { GET as positionGET } from '@/app/api/v1/positions/[symbol]/route'
import { GET as ordersGET, POST as ordersPOST } from '@/app/api/v1/orders/route'
import { GET as orderGET, DELETE as orderDELETE } from '@/app/api/v1/orders/[id]/route'
import { GET as opGET, POST as opPOST } from '@/app/api/v1/operator/route'
import { GET as profilesGET, POST as profilesPOST, PATCH as profilesPATCH, DELETE as profilesDELETE } from '@/app/api/v1/profiles/route'
import { POST as resolvePOST } from '@/app/api/internal/resolve/route'
import { registerAccount, placeOrder } from '@/lib/engine/accounts'
import { db } from '@/lib/db'
import { getEngineReady } from '@/lib/engine'

const OPS = { 'x-operator-key': 'meridian-ops-2026' }
let n = 0

function post(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function getReq(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, { method: 'GET', headers })
}

function delReq(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, { method: 'DELETE', headers })
}

const json = async (res: Response) => ({ status: res.status, body: await res.json() })
const uniqEmail = () => `route-${Date.now()}-${++n}@mrx.dev`

let acct: Awaited<ReturnType<typeof registerAccount>>
let auth: Record<string, string>

beforeEach(async () => {
  const engine = await getEngineReady()
  for (const s of engine.states.values()) { s.haltedUntil = 0; s.priceRing.fill(s.price); s.ringIdx = 0 }
  acct = await registerAccount({ email: uniqEmail(), password: 'password123', handle: `router${++n}` })
  auth = { authorization: `Bearer ${acct.apiKey}` }
})

describe('auth endpoints', () => {
  it('registers a funded account and returns a one-time API key', async () => {
    const { status, body } = await json(await registerPOST(post('/api/v1/auth/register', { email: uniqEmail(), password: 'password123', handle: 'route_reg' })))
    expect(status).toBe(201)
    expect(body.api_key).toMatch(/^mrx_live_/)
    expect(body.cash).toBe(100000)
    expect(body.message).toContain('$100,000')
    const setCookie = (await registerPOST(post('/api/v1/auth/register', { email: uniqEmail(), password: 'password123' }))).headers.get('set-cookie')
    expect(setCookie).toContain('mrx_session=')
  })

  it('validates registration input', async () => {
    const missing = await json(await registerPOST(post('/api/v1/auth/register', {})))
    expect(missing.status).toBe(422)
    expect(missing.body.error.code).toBe('MISSING_FIELDS')

    const named = await json(await registerPOST(post('/api/v1/auth/register', { email: uniqEmail(), password: 'password123', name: 'Named Trader' })))
    expect(named.status).toBe(201)

    const dupe = await json(await registerPOST(post('/api/v1/auth/register', { email: acct.email, password: 'password123' })))
    expect(dupe.status).toBe(409)

    const invalid = await json(await registerPOST(post('/api/v1/auth/register', { email: 'garbage', password: 'password123' })))
    expect(invalid.body.error.code).toBe('INVALID_EMAIL')

    const weak = await json(await registerPOST(post('/api/v1/auth/register', { email: uniqEmail(), password: 'short' })))
    expect(weak.body.error.code).toBe('WEAK_PASSWORD')
  })

  it('logs in, sets the session cookie, and rejects bad credentials', async () => {
    const okLogin = await loginPOST(post('/api/v1/auth/login', { email: acct.email, password: 'password123' }))
    expect(okLogin.status).toBe(200)
    expect((await okLogin.json()).api_key).toBe(acct.apiKey)
    expect(okLogin.headers.get('set-cookie')).toContain('mrx_session=')

    const missing = await json(await loginPOST(post('/api/v1/auth/login', { email: acct.email })))
    expect(missing.status).toBe(422)
    expect(missing.body.error.code).toBe('MISSING_FIELDS')

    const bad = await json(await loginPOST(post('/api/v1/auth/login', { email: acct.email, password: 'wrong-pass' })))
    expect(bad.status).toBe(401)
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('logout clears the session', async () => {
    const res = await logoutPOST()
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(res.headers.get('set-cookie')).toContain('mrx_session=;')
  })

  it('/auth/me mirrors /account with identity fields', async () => {
    const { status, body } = await json(await meGET(getReq('/api/v1/auth/me', auth)))
    expect(status).toBe(200)
    expect(body.email).toBe(acct.email)
    expect(body.handle).toBe(acct.handle)
    expect(body.equity).toBeGreaterThan(0)
  })
})

describe('account endpoints', () => {
  it('GET /account returns the full broker view', async () => {
    const { status, body } = await json(await accountGET(getReq('/api/v1/account', auth)))
    expect(status).toBe(200)
    expect(body.account_number).toMatch(/^MRX/)
    expect(body.multiplier).toBe('2')
    expect(body.buying_power).toBeGreaterThan(0)
  })

  it('GET /account/portfolio aggregates positions inline', async () => {
    await placeOrder(acct.id, { symbol: 'LUMCR', side: 'buy', type: 'market', qty: 3 })
    const { status, body } = await json(await portfolioGET(getReq('/api/v1/account/portfolio', auth)))
    expect(status).toBe(200)
    expect(body.positions_count).toBe(1)
    expect(body.positions[0].symbol).toBe('LUMCR')
    expect(body.long_invested_value).toBeGreaterThan(0)
  })

  it('GET /account/portfolio/history validates period', async () => {
    const ok = await json(await historyGET(getReq('/api/v1/account/portfolio/history?period=1W', auth)))
    expect(ok.status).toBe(200)
    expect(ok.body.timeframe).toBe('1W')

    const bad = await json(await historyGET(getReq('/api/v1/account/portfolio/history?period=2Y', auth)))
    expect(bad.status).toBe(422)
    expect(bad.body.error.code).toBe('INVALID_PERIOD')

    const missing = await json(await historyGET(getReq('/api/v1/account/portfolio/history', auth)))
    expect(missing.status).toBe(200) // defaults to 1A
  })

  it('GET /account/activities lists fills after trading', async () => {
    await placeOrder(acct.id, { symbol: 'KRYO', side: 'buy', type: 'market', qty: 2 })
    const { status, body } = await json(await activitiesGET(getReq('/api/v1/account/activities?limit=10', auth)))
    expect(status).toBe(200)
    expect(body.activities.length).toBe(1)
    const a = body.activities[0]
    expect(a.activity_type).toBe('fill')
    expect(a.side).toBe('buy')
    expect(Number(a.amount)).toBeLessThan(0) // buys are negative cash flows
  })

  it('key management: list masked, rotate via POST and the alias route', async () => {
    const listed = await json(await keysGET(getReq('/api/v1/account/keys', auth)))
    expect(listed.status).toBe(200)
    expect(listed.body.keys[0].key_id).toContain('…')
    expect(listed.body.keys[0].secret_masked).toBe('••••••••••••')

    const rotated = await json(await keysPOST(post('/api/v1/account/keys', {}, auth)))
    expect(rotated.status).toBe(200)
    expect(rotated.body.api_key).not.toBe(acct.apiKey)

    // old key no longer authenticates
    const stale = await json(await accountGET(getReq('/api/v1/account', auth)))
    expect(stale.status).toBe(401)

    auth = { authorization: `Bearer ${rotated.body.api_key}` }
    const rotated2 = await json(await rotatePOST(post('/api/v1/account/keys/rotate', {}, auth)))
    expect(rotated2.status).toBe(200)
    auth = { authorization: `Bearer ${rotated2.body.api_key}` }
  })

  it('401s without credentials across the authenticated surface', async () => {
    for (const call of [
      () => accountGET(getReq('/api/v1/account')),
      () => portfolioGET(getReq('/api/v1/account/portfolio')),
      () => activitiesGET(getReq('/api/v1/account/activities')),
      () => positionsGET(getReq('/api/v1/positions')),
      () => ordersGET(getReq('/api/v1/orders')),
      () => keysGET(getReq('/api/v1/account/keys')),
    ]) {
      const res = await call()
      expect(res.status).toBe(401)
      expect((await res.json()).error.code).toBe('UNAUTHORIZED')
    }
    const badKey = await json(await accountGET(getReq('/api/v1/account', { authorization: 'Bearer mrx_live_invalid' })))
    expect(badKey.status).toBe(401)
  })
})

describe('positions & orders endpoints', () => {
  it('positions list and single-symbol lookup with 404', async () => {
    const empty = await json(await positionsGET(getReq('/api/v1/positions', auth)))
    expect(empty.body.count).toBe(0)

    await placeOrder(acct.id, { symbol: 'VSTRA', side: 'buy', type: 'market', qty: 4 })
    const list = await json(await positionsGET(getReq('/api/v1/positions', auth)))
    expect(list.body.count).toBe(1)

    const one = await json(await positionGET(getReq('/api/v1/positions/VSTRA', auth), { params: Promise.resolve({ symbol: 'VSTRA' }) }))
    expect(one.status).toBe(200)
    expect(one.body.qty).toBe('4')

    const lower = await json(await positionGET(getReq('/api/v1/positions/vstra', auth), { params: Promise.resolve({ symbol: 'vstra' }) }))
    expect(lower.status).toBe(200)

    const flat = await json(await positionGET(getReq('/api/v1/positions/AQBK', auth), { params: Promise.resolve({ symbol: 'AQBK' }) }))
    expect(flat.status).toBe(404)
    expect(flat.body.error.code).toBe('POSITION_NOT_FOUND')
  })

  it('orders lifecycle: place, list open/closed/all, fetch one with fills, cancel', async () => {
    const filled = await json(await ordersPOST(post('/api/v1/orders', { symbol: 'GNRY', qty: 2, side: 'buy', type: 'market' }, auth)))
    expect(filled.status).toBe(201)
    expect(filled.body.status).toBe('filled')
    expect(filled.body.qty).toBe('2')

    const resting = await json(await ordersPOST(post('/api/v1/orders', { symbol: 'GNRY', qty: 1, side: 'buy', type: 'limit', limit_price: 1, time_in_force: 'gtc' }, auth)))
    expect(resting.status).toBe(201)
    expect(resting.body.status).toBe('accepted')

    const openList = await json(await ordersGET(getReq('/api/v1/orders?status=open', auth)))
    expect(openList.body.orders).toHaveLength(1)
    const closedList = await json(await ordersGET(getReq('/api/v1/orders?status=closed', auth)))
    expect(closedList.body.orders).toHaveLength(1)
    const allList = await json(await ordersGET(getReq('/api/v1/orders?status=all&symbol=GNRY', auth)))
    expect(allList.body.orders).toHaveLength(2)
    const explicit = await json(await ordersGET(getReq('/api/v1/orders?status=filled', auth)))
    expect(explicit.body.orders).toHaveLength(1)

    const one = await json(await orderGET(getReq(`/api/v1/orders/${filled.body.id}`, auth), { params: Promise.resolve({ id: filled.body.id }) }))
    expect(one.status).toBe(200)
    expect(one.body.fills).toHaveLength(1)

    const canceled = await json(await orderDELETE(delReq(`/api/v1/orders/${resting.body.id}`, auth), { params: Promise.resolve({ id: resting.body.id }) }))
    expect(canceled.status).toBe(200)
    expect(canceled.body.status).toBe('canceled')
  })

  it('order validation errors surface broker codes', async () => {
    const noBody = await new NextRequest('http://localhost:3000/api/v1/orders', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: 'not-json{' })
    const badBody = await json(await ordersPOST(noBody))
    expect(badBody.status).toBe(422)
    expect(badBody.body.error.code).toBe('INVALID_BODY')

    const badSide = await json(await ordersPOST(post('/api/v1/orders', { symbol: 'GNRY', qty: 1, side: 'up', type: 'market' }, auth)))
    expect(badSide.body.error.code).toBe('INVALID_SIDE')

    const badSymbol = await json(await ordersPOST(post('/api/v1/orders', { symbol: 'NOPE', qty: 1, side: 'buy', type: 'market' }, auth)))
    expect(badSymbol.status).toBe(404)

    const noFunds = await json(await ordersPOST(post('/api/v1/orders', { symbol: 'QNTM', notional: 9000000, side: 'buy', type: 'market' }, auth)))
    expect(noFunds.status).toBe(422)
    expect(noFunds.body.error.code).toBe('INSUFFICIENT_BUYING_POWER')

    const noQty = await json(await ordersPOST(post('/api/v1/orders', { symbol: 'QNTM', side: 'buy', type: 'market' }, auth)))
    expect(noQty.status).toBe(422)
    expect(noQty.body.error.code).toBe('INVALID_QUANTITY')

    const ghost = await json(await orderGET(getReq('/api/v1/orders/missing', auth), { params: Promise.resolve({ id: 'missing' }) }))
    expect(ghost.status).toBe(404)
    const ghostDel = await json(await orderDELETE(delReq('/api/v1/orders/missing', auth), { params: Promise.resolve({ id: 'missing' }) }))
    expect(ghostDel.status).toBe(404)
  })

  it('orders are account-scoped: other accounts cannot see or cancel them', async () => {
    const other = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const order = await json(await ordersPOST(post('/api/v1/orders', { symbol: 'GNRY', qty: 1, side: 'buy', type: 'limit', limit_price: 1, time_in_force: 'gtc' }, auth)))
    const foreignGet = await json(await orderGET(getReq(`/api/v1/orders/${order.body.id}`, { authorization: `Bearer ${other.apiKey}` }), { params: Promise.resolve({ id: order.body.id }) }))
    expect(foreignGet.status).toBe(404)
    const foreignDel = await json(await orderDELETE(delReq(`/api/v1/orders/${order.body.id}`, { authorization: `Bearer ${other.apiKey}` }), { params: Promise.resolve({ id: order.body.id }) }))
    expect(foreignDel.status).toBe(404)
    await orderDELETE(delReq(`/api/v1/orders/${order.body.id}`, auth), { params: Promise.resolve({ id: order.body.id }) })
  })

  it('internal resolve endpoint maps API keys for the relay', async () => {
    const ok = await json(await resolvePOST(post('/api/internal/resolve', { api_key: acct.apiKey })))
    expect(ok.status).toBe(200)
    expect(ok.body.account_id).toBe(acct.id)

    const missing = await json(await resolvePOST(post('/api/internal/resolve', {})))
    expect(missing.status).toBe(422)
    const bad = await json(await resolvePOST(post('/api/internal/resolve', { api_key: 'nope' })))
    expect(bad.status).toBe(401)
  })
})

describe('operator endpoint', () => {
  it('404s for unauthorized callers (all three auth channels checked)', async () => {
    expect((await opGET(getReq('/api/v1/operator'))).status).toBe(404)
    expect((await opGET(getReq('/api/v1/operator', { 'x-operator-key': 'wrong' }))).status).toBe(404)
    const bodyWrong = await json(await opPOST(post('/api/v1/operator', { action: 'shock_market', operator_key: 'wrong' })))
    expect(bodyWrong.status).toBe(404)
  })

  it('authorizes via header, query or body key', async () => {
    expect((await opGET(getReq('/api/v1/operator', OPS))).status).toBe(200)
    expect((await opGET(getReq('/api/v1/operator?k=meridian-ops-2026'))).status).toBe(200)
    const viaBody = await json(await opPOST(post('/api/v1/operator', { action: 'pause_market', operator_key: 'meridian-ops-2026' })))
    expect(viaBody.status).toBe(200)
    const resume = await json(await opPOST(post('/api/v1/operator', { action: 'resume_market', operator_key: 'meridian-ops-2026' })))
    expect(resume.body.success).toBe(true)
  })

  it('GET prices unpriceable positions at cost', async () => {
    const order = await db.order.create({
      data: { accountId: acct.id, symbol: 'QNTM', side: 'buy', type: 'market', qty: 1, status: 'filled', filledQty: 1, filledAvgPrice: 100 },
    })
    await db.position.create({ data: { accountId: acct.id, symbol: 'GHOSTX', qty: 4, avgPrice: 7.25 } })
    await db.fill.create({ data: { orderId: order.id, accountId: acct.id, symbol: 'GHOSTX', side: 'buy', qty: 4, price: 7.25, fee: 0 } })
    const { status, body } = await json(await opGET(getReq('/api/v1/operator', OPS)))
    expect(status).toBe(200)
    const row = body.accounts.find((r: { id: string }) => r.id === acct.id)
    expect(row.equity).toBeCloseTo(acct.cash + 29, 0) // 4 × $7.25 at cost
    await db.position.deleteMany({ where: { accountId: acct.id, symbol: 'GHOSTX' } })
    await db.fill.deleteMany({ where: { accountId: acct.id, symbol: 'GHOSTX' } })
  })

  it('GET returns engine stats and all accounts with equity', async () => {
    const { status, body } = await json(await opGET(getReq('/api/v1/operator', OPS)))
    expect(status).toBe(200)
    expect(body.engine.instruments).toBe(48)
    const row = body.accounts.find((r: { id: string }) => r.id === acct.id)
    expect(row.equity).toBeGreaterThan(0)
    expect(row.return_pct).toBeCloseTo((row.equity / 100000 - 1) * 100, 1)
  })

  it('runs every operator action', async () => {
    const shock = await json(await opPOST(post('/api/v1/operator', { action: 'shock_market', bps: 50 }, OPS)))
    expect(shock.body.success).toBe(true)
    const shockDefault = await json(await opPOST(post('/api/v1/operator', { action: 'shock_market' }, OPS)))
    expect(shockDefault.body.bps).toBe(-600)
    const pumpDefault = await json(await opPOST(post('/api/v1/operator', { action: 'pump', symbol: 'AXNDA' }, OPS)))
    expect(pumpDefault.body.bps).toBe(800)
    const dumpDefault = await json(await opPOST(post('/api/v1/operator', { action: 'dump', symbol: 'AXNDA' }, OPS)))
    expect(dumpDefault.body.bps).toBe(-900)
    const haltDefault = await json(await opPOST(post('/api/v1/operator', { action: 'halt', symbol: 'AXNDA' }, OPS)))
    expect(haltDefault.body.success).toBe(true)
    await opPOST(post('/api/v1/operator', { action: 'resume', symbol: 'AXNDA' }, OPS))

    const pump = await json(await opPOST(post('/api/v1/operator', { action: 'pump', symbol: 'axnda', bps: 120 }, OPS)))
    expect(pump.body.success).toBe(true)
    const pumpMiss = await json(await opPOST(post('/api/v1/operator', { action: 'pump', symbol: 'NOPE' }, OPS)))
    expect(pumpMiss.status).toBe(404)

    const dump = await json(await opPOST(post('/api/v1/operator', { action: 'dump', symbol: 'AXNDA', bps: 120 }, OPS)))
    expect(dump.body.success).toBe(true)
    const dumpMiss = await json(await opPOST(post('/api/v1/operator', { action: 'dump', symbol: 'NOPE' }, OPS)))
    expect(dumpMiss.status).toBe(404)

    const halt = await json(await opPOST(post('/api/v1/operator', { action: 'halt', symbol: 'AXNDA', seconds: 1 }, OPS)))
    expect(halt.body.success).toBe(true)
    const haltMiss = await json(await opPOST(post('/api/v1/operator', { action: 'halt', symbol: 'NOPE' }, OPS)))
    expect(haltMiss.status).toBe(404)

    const resume = await json(await opPOST(post('/api/v1/operator', { action: 'resume', symbol: 'AXNDA' }, OPS)))
    expect(resume.body.success).toBe(true)
    const resumeMiss = await json(await opPOST(post('/api/v1/operator', { action: 'resume', symbol: 'NOPE' }, OPS)))
    expect(resumeMiss.status).toBe(404)

    const news = await json(await opPOST(post('/api/v1/operator', { action: 'inject_news', headline: 'Operator flash: sector rotation', symbols: ['@Technology'], impact_bps: 30 }, OPS)))
    expect(news.body.success).toBe(true)
    const noHeadline = await json(await opPOST(post('/api/v1/operator', { action: 'inject_news' }, OPS)))
    expect(noHeadline.status).toBe(422)
    const singleSymbolNews = await json(await opPOST(post('/api/v1/operator', { action: 'inject_news', headline: 'Single symbol flash', symbol: 'QNTM', impact_bps: 0 }, OPS)))
    expect(singleSymbolNews.body.success).toBe(true)

    const unknown = await json(await opPOST(post('/api/v1/operator', { action: 'teleport_market' }, OPS)))
    expect(unknown.status).toBe(422)
    expect(unknown.body.error.code).toBe('UNKNOWN_ACTION')
    const noAction = await json(await opPOST(post('/api/v1/operator', {}, OPS)))
    expect(noAction.status).toBe(422)
    const marketNews = await json(await opPOST(post('/api/v1/operator', { action: 'inject_news', headline: 'Market-wide flash with no symbol target' }, OPS)))
    expect(marketNews.body.success).toBe(true)
    const resetMiss = await json(await opPOST(post('/api/v1/operator', { action: 'reset_account' }, OPS)))
    expect(resetMiss.status).toBe(404)
    const deleteMiss = await json(await opPOST(post('/api/v1/operator', { action: 'delete_account' }, OPS)))
    expect(deleteMiss.status).toBe(404)
  })

  it('reset_account and delete_account manage the operator fleet', async () => {
    await placeOrder(acct.id, { symbol: 'SYNTQ', side: 'buy', type: 'market', qty: 1 })
    const reset = await json(await opPOST(post('/api/v1/operator', { action: 'reset_account', account_id: acct.id }, OPS)))
    expect(reset.body.message).toContain('$100,000')
    const after = await db.account.findUnique({ where: { id: acct.id } })
    expect(after!.cash).toBe(100000)
    expect(after!.status).toBe('ACTIVE')
    expect(await db.fill.count({ where: { accountId: acct.id } })).toBe(0)

    const resetMiss = await json(await opPOST(post('/api/v1/operator', { action: 'reset_account', account_id: 'ghost' }, OPS)))
    expect(resetMiss.status).toBe(404)

    const victim = await registerAccount({ email: uniqEmail(), password: 'password123' })
    const deleted = await json(await opPOST(post('/api/v1/operator', { action: 'delete_account', account_id: victim.id }, OPS)))
    expect(deleted.body.success).toBe(true)
    expect(await db.account.findUnique({ where: { id: victim.id } })).toBeNull()
    const deleteMiss = await json(await opPOST(post('/api/v1/operator', { action: 'delete_account', account_id: 'ghost' }, OPS)))
    expect(deleteMiss.status).toBe(404)
  })
})

describe('profiles endpoint (operator-only evaluation fleet)', () => {
  it('404s non-operator callers on every method', async () => {
    expect((await profilesGET(getReq('/api/v1/profiles'))).status).toBe(404)
    expect((await profilesPOST(post('/api/v1/profiles', { label: 'x' }))).status).toBe(404)
    expect((await profilesPATCH(post('/api/v1/profiles', { id: 'x' }))).status).toBe(404)
    expect((await profilesDELETE(delReq('/api/v1/profiles?id=x'))).status).toBe(404)
  })

  it('provisions a profile that looks like an ordinary retail account', async () => {
    const label = `probe-${Date.now()}-${++n}`
    const created = await json(await profilesPOST(post('/api/v1/profiles', { label, model: 'test-model', operator_key: 'meridian-ops-2026' })))
    expect(created.status).toBe(201)
    expect(created.body.profile.label).toBe(label)
    expect(created.body.credentials.api_key).toMatch(/^mrx_live_/)
    // the underlying account is indistinguishable from a retail customer
    const identity = await db.account.findUnique({ where: { id: created.body.profile.account_id } })
    expect(identity!.email.endsWith('@mrxclients.io')).toBe(true)
    expect(identity!.handle).not.toContain(label)
    expect(created.body.profile.handle).not.toContain('test')

    const dupe = await json(await profilesPOST(post('/api/v1/profiles', { label, operator_key: 'meridian-ops-2026' })))
    expect(dupe.status).toBe(409)

    const noLabel = await json(await profilesPOST(post('/api/v1/profiles', { label: '!!!', operator_key: 'meridian-ops-2026' })))
    expect(noLabel.status).toBe(422)
    const missingLabel = await json(await profilesPOST(post('/api/v1/profiles', { operator_key: 'meridian-ops-2026' })))
    expect(missingLabel.status).toBe(422)
    const badAliasPost = await json(await profilesPOST(post('/api/v1/profiles', { label: `badashtml-${n}`, leaderboard_alias: 'no!', operator_key: 'meridian-ops-2026' })))
    expect(badAliasPost.status).toBe(422)
    expect(badAliasPost.body.error.code).toBe('INVALID_ALIAS')

    const list = await json(await profilesGET(getReq('/api/v1/profiles', OPS)))
    const row = list.body.profiles.find((p: { id: string }) => p.id === created.body.profile.id)
    expect(row.return_pct).toBe(0)
    expect(row.trades).toBe(0)
    expect(row.top_holding).toBeNull()

    // cleanup
    const del = await profilesDELETE(delReq(`/api/v1/profiles?label=${label}`, OPS))
    expect((await del.json()).success).toBe(true)
  })

  it('realized P/L arithmetic handles zero-quantity fills and unpriced positions', async () => {
    const label = `zero-${Date.now()}-${++n}`
    const created = await json(await profilesPOST(post('/api/v1/profiles', { label, operator_key: 'meridian-ops-2026' })))
    const acctId = created.body.profile.account_id
    const order = await db.order.create({
      data: { accountId: acctId, symbol: 'QNTM', side: 'buy', type: 'market', qty: 1, status: 'filled', filledQty: 1, filledAvgPrice: 100 },
    })
    // zero-qty fills exercise the (x || 1) guards in realizedFromFills
    await db.fill.create({ data: { orderId: order.id, accountId: acctId, symbol: 'QNTM', side: 'buy', qty: 0, price: 100, fee: 0 } })
    await db.fill.create({ data: { orderId: order.id, accountId: acctId, symbol: 'QNTM', side: 'sell', qty: 0, price: 100, fee: 0 } })
    // an unpriceable position exercises the avgPrice fallback
    await db.position.create({ data: { accountId: acctId, symbol: 'GHOSTX', qty: 3, avgPrice: 9.5 } })
    const list = await json(await profilesGET(getReq('/api/v1/profiles', OPS)))
    const row = list.body.profiles.find((pp: { id: string }) => pp.id === created.body.profile.id)
    expect(row.realized_pl).toBe(0)
    expect(Number.isFinite(row.equity)).toBe(true)
    await profilesDELETE(delReq(`/api/v1/profiles?label=${label}`, OPS))
  })

  it('supports custom starting cash and rejects invalid values', async () => {
    const label = `cash-${Date.now()}-${++n}`
    const created = await json(await profilesPOST(post('/api/v1/profiles', { label, starting_cash: 250000, operator_key: 'meridian-ops-2026' })))
    expect(created.body.profile.cash).toBe(250000)
    await profilesDELETE(delReq(`/api/v1/profiles?label=${label}`, OPS))

    const bad = await json(await profilesPOST(post('/api/v1/profiles', { label: `bad-${n}`, starting_cash: 1, operator_key: 'meridian-ops-2026' })))
    expect(bad.body.profile.cash).toBe(100000) // falls back to the standard funding
    await profilesDELETE(delReq(`/api/v1/profiles?label=bad-${n}`, OPS))

    const nan = await json(await profilesPOST(post('/api/v1/profiles', { label: `nan-${n}`, starting_cash: 'twelve-million', operator_key: 'meridian-ops-2026' })))
    expect(nan.body.profile.cash).toBe(100000)
    await profilesDELETE(delReq(`/api/v1/profiles?label=nan-${n}`, OPS))
  })

  it('tracks trades, realized P/L and top holding through a full round trip', async () => {
    const label = `roundtrip-${Date.now()}-${++n}`
    const created = await json(await profilesPOST(post('/api/v1/profiles', { label, operator_key: 'meridian-ops-2026' })))
    const key = created.body.credentials.api_key
    const auth = { authorization: `Bearer ${key}` }

    await ordersPOST(post('/api/v1/orders', { symbol: 'MRDN', qty: 10, side: 'buy', type: 'market' }, auth))
    await ordersPOST(post('/api/v1/orders', { symbol: 'MRDN', qty: 4, side: 'sell', type: 'market' }, auth))
    await ordersPOST(post('/api/v1/orders', { symbol: 'PXLQ', qty: 2, side: 'sell', type: 'market' }, auth)) // short
    await ordersPOST(post('/api/v1/orders', { symbol: 'PXLQ', qty: 3, side: 'buy', type: 'market' }, auth)) // cover + flip

    const list = await json(await profilesGET(getReq('/api/v1/profiles', OPS)))
    const row = list.body.profiles.find((p: { id: string }) => p.id === created.body.profile.id)
    expect(row.trades).toBe(4)
    expect(row.positions).toBeGreaterThan(0)
    expect(row.gross_exposure).toBeGreaterThan(0)
    expect(row.top_holding).not.toBeNull()
    expect(typeof row.realized_pl).toBe('number')

    // alias lifecycle
    const set = await json(await profilesPATCH(post('/api/v1/profiles', { label, leaderboard_alias: 'Alias Probe 42!', operator_key: 'meridian-ops-2026' })))
    expect(set.body.profile.leaderboard_alias).toBe('alias_probe_42')
    expect(set.body.profile.display_handle).toBe('alias_probe_42')

    const clear = await json(await profilesPATCH(post('/api/v1/profiles', { id: created.body.profile.id, leaderboard_alias: '', operator_key: 'meridian-ops-2026' })))
    expect(clear.body.profile.leaderboard_alias).toBeNull()

    const nothing = await json(await profilesPATCH(post('/api/v1/profiles', { id: created.body.profile.id, operator_key: 'meridian-ops-2026' })))
    expect(nothing.status).toBe(422)
    const badAlias = await json(await profilesPATCH(post('/api/v1/profiles', { id: created.body.profile.id, leaderboard_alias: 'x', operator_key: 'meridian-ops-2026' })))
    expect(badAlias.status).toBe(422)
    const ghost = await json(await profilesPATCH(post('/api/v1/profiles', { label: 'ghost-profile-zzz', leaderboard_alias: 'okalias', operator_key: 'meridian-ops-2026' })))
    expect(ghost.status).toBe(404)
    const neither = await json(await profilesPATCH(post('/api/v1/profiles', { leaderboard_alias: 'okalias', operator_key: 'meridian-ops-2026' })))
    expect(neither.status).toBe(404)

    const delById = await profilesDELETE(delReq(`/api/v1/profiles?id=${created.body.profile.id}`, OPS))
    expect(delById.status).toBe(200)
    const delGhost = await profilesDELETE(delReq('/api/v1/profiles?id=ghost', OPS))
    expect(delGhost.status).toBe(404)
    const delNeither = await profilesDELETE(delReq('/api/v1/profiles', OPS))
    expect(delNeither.status).toBe(404)
  })
})

describe('final profile edges', () => {
  it('POST accepts a valid leaderboard_alias and exact-cover fills zero out realized P/L', async () => {
    const OPS = { 'x-operator-key': 'meridian-ops-2026' }
    const label = `aliaspost-${Date.now()}-${++n}`
    const created = await json(await profilesPOST(post('/api/v1/profiles', { label, leaderboard_alias: 'steady_comet_7', operator_key: 'meridian-ops-2026' })))
    expect(created.status).toBe(201)
    expect(created.body.profile.leaderboard_alias).toBe('steady_comet_7')
    const auth = { authorization: `Bearer ${created.body.credentials.api_key}` }

    // exact round-trip: buy 5, sell 5 → open = 0 on the reduce branch
    await ordersPOST(post('/api/v1/orders', { symbol: 'MRDN', qty: 5, side: 'buy', type: 'market' }, auth))
    await ordersPOST(post('/api/v1/orders', { symbol: 'MRDN', qty: 5, side: 'sell', type: 'market' }, auth))

    // exact short cover: short 5, buy back 5
    await ordersPOST(post('/api/v1/orders', { symbol: 'PXLQ', qty: 5, side: 'sell', type: 'market' }, auth))
    await ordersPOST(post('/api/v1/orders', { symbol: 'PXLQ', qty: 5, side: 'buy', type: 'market' }, auth))

    // sell-through flip: sell 7 of a 5-share long re-opens a 2-share short
    await ordersPOST(post('/api/v1/orders', { symbol: 'STRMQ', qty: 5, side: 'buy', type: 'market' }, auth))
    await ordersPOST(post('/api/v1/orders', { symbol: 'STRMQ', qty: 7, side: 'sell', type: 'market' }, auth))

    const list = await json(await profilesGET(getReq('/api/v1/profiles', OPS)))
    const row = list.body.profiles.find((pp: { id: string }) => pp.id === created.body.profile.id)
    expect(row.trades).toBe(6)
    expect(row.positions).toBe(1) // only the flipped STRMQ short remains
    await profilesDELETE(delReq(`/api/v1/profiles?label=${label}`, OPS))
  })
})
