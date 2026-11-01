// Cross-cutting sweeps: every OPTIONS preflight, per-endpoint rate limiting,
// and the quote tape-size branch — closing the last structural gaps.

import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'

import { GET as quoteGET, OPTIONS as quoteOPT } from '@/app/api/v1/market/quote/route'
import { GET as stocksGET, OPTIONS as stocksOPT } from '@/app/api/v1/market/stocks/route'
import { GET as stockGET, OPTIONS as stockOPT } from '@/app/api/v1/market/stocks/[symbol]/route'
import { GET as candlesGET, OPTIONS as candlesOPT } from '@/app/api/v1/market/candles/route'
import { GET as orderbookGET, OPTIONS as orderbookOPT } from '@/app/api/v1/market/orderbook/route'
import { GET as tradesGET, OPTIONS as tradesOPT } from '@/app/api/v1/market/trades/route'
import { GET as moversGET, OPTIONS as moversOPT } from '@/app/api/v1/market/movers/route'
import { GET as indicesGET, OPTIONS as indicesOPT } from '@/app/api/v1/market/indices/route'
import { GET as statusGET, OPTIONS as statusOPT } from '@/app/api/v1/market/status/route'
import { GET as calendarGET, OPTIONS as calendarOPT } from '@/app/api/v1/market/calendar/route'
import { GET as newsGET, OPTIONS as newsOPT } from '@/app/api/v1/news/route'
import { GET as leaderboardGET, OPTIONS as leaderboardOPT } from '@/app/api/v1/leaderboard/route'
import { GET as docsGET, OPTIONS as docsOPT } from '@/app/api/v1/docs/route'
import { GET as v1GET, OPTIONS as v1OPT } from '@/app/api/v1/route'
import { GET as helloGET } from '@/app/api/route'
import { GET as accountGET, OPTIONS as accountOPT } from '@/app/api/v1/account/route'
import { GET as portfolioGET, OPTIONS as portfolioOPT } from '@/app/api/v1/account/portfolio/route'
import { GET as historyGET, OPTIONS as historyOPT } from '@/app/api/v1/account/portfolio/history/route'
import { GET as activitiesGET, OPTIONS as activitiesOPT } from '@/app/api/v1/account/activities/route'
import { GET as keysGET, POST as keysPOST, OPTIONS as keysOPT } from '@/app/api/v1/account/keys/route'
import { POST as rotatePOST, OPTIONS as rotateOPT } from '@/app/api/v1/account/keys/rotate/route'
import { GET as positionsGET, OPTIONS as positionsOPT } from '@/app/api/v1/positions/route'
import { GET as positionGET, OPTIONS as positionOPT } from '@/app/api/v1/positions/[symbol]/route'
import { GET as ordersGET, POST as ordersPOST, OPTIONS as ordersOPT } from '@/app/api/v1/orders/route'
import { GET as orderGET, DELETE as orderDELETE, OPTIONS as orderOPT } from '@/app/api/v1/orders/[id]/route'
import { GET as opGET, POST as opPOST, OPTIONS as opOPT } from '@/app/api/v1/operator/route'
import { GET as profilesGET, POST as profilesPOST, PATCH as profilesPATCH, DELETE as profilesDELETE, OPTIONS as profilesOPT } from '@/app/api/v1/profiles/route'
import { POST as registerPOST, OPTIONS as registerOPT } from '@/app/api/v1/auth/register/route'
import { POST as loginPOST, OPTIONS as loginOPT } from '@/app/api/v1/auth/login/route'
import { POST as logoutPOST, OPTIONS as logoutOPT } from '@/app/api/v1/auth/logout/route'
import { GET as meGET, OPTIONS as meOPT } from '@/app/api/v1/auth/me/route'
import { POST as resolvePOST, OPTIONS as resolveOPT } from '@/app/api/internal/resolve/route'
import { registerAccount, placeOrder } from '@/lib/engine/accounts'
import { getEngineReady } from '@/lib/engine'

let n = 0
const ip = () => `10.9.${++n}.${n}`
const getReq = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${url}`, { method: 'GET', headers })
const postReq = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

describe('OPTIONS preflight sweep — every route answers 204 with CORS', () => {
  it('market + misc routes', async () => {
    for (const opt of [quoteOPT, stocksOPT, stockOPT, candlesOPT, orderbookOPT, tradesOPT, moversOPT, indicesOPT, statusOPT, calendarOPT, newsOPT, leaderboardOPT, docsOPT, v1OPT]) {
      const res = await opt()
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    }
  })

  it('trading + operator + profiles + auth routes', async () => {
    for (const opt of [accountOPT, portfolioOPT, historyOPT, activitiesOPT, keysOPT, rotateOPT, positionsOPT, positionOPT, ordersOPT, orderOPT, opOPT, profilesOPT, registerOPT, loginOPT, logoutOPT, meOPT, resolveOPT]) {
      expect((await opt()).status).toBe(204)
    }
  })
})

describe('rate limiting trips on every rate-limited route', () => {
  it('market data endpoints 429 after 200 requests in one minute', async () => {
    const bucket = { 'X-Forwarded-For': `hammer-md-${Date.now()}` }
    const targets: [string, (req: NextRequest) => Promise<Response>, string][] = [
      ['quote', quoteGET, '/api/v1/market/quote?symbols=QNTM'],
      ['stocks', stocksGET, '/api/v1/market/stocks'],
      ['stock', (r) => stockGET(r, { params: Promise.resolve({ symbol: 'QNTM' }) }), '/api/v1/market/stocks/QNTM'],
      ['candles', candlesGET, '/api/v1/market/candles?symbol=QNTM&interval=1d'],
      ['orderbook', orderbookGET, '/api/v1/market/orderbook?symbol=QNTM'],
      ['trades', tradesGET, '/api/v1/market/trades?symbol=QNTM'],
      ['movers', moversGET, '/api/v1/market/movers'],
      ['indices', indicesGET, '/api/v1/market/indices'],
      ['status', statusGET, '/api/v1/market/status'],
      ['calendar', calendarGET, '/api/v1/market/calendar'],
    ]
    for (const [name, handler, url] of targets) {
      let last: Response | null = null
      for (let i = 0; i < 201; i++) last = await handler(getReq(url, bucket))
      expect(last!.status, name).toBe(429)
      expect(((await last!.json()).error ?? {}).code, name).toBe('RATE_LIMIT_EXCEEDED')
    }
  }, 60_000)

  it('trading endpoints 429 per API key', async () => {
    const acct = await registerAccount({ email: `hammer-${Date.now()}@mrx.dev`, password: 'password123' })
    const bucket = { authorization: `Bearer ${acct.apiKey}` }
    const targets: [string, (req: NextRequest) => Promise<Response>, string, string][] = [
      ['account', (r) => accountGET(r), 'GET', '/api/v1/account'],
      ['portfolio', (r) => portfolioGET(r), 'GET', '/api/v1/account/portfolio'],
      ['history', (r) => historyGET(r), 'GET', '/api/v1/account/portfolio/history?period=1D'],
      ['activities', (r) => activitiesGET(r), 'GET', '/api/v1/account/activities'],
      ['keys', (r) => keysGET(r), 'GET', '/api/v1/account/keys'],
      ['positions', (r) => positionsGET(r), 'GET', '/api/v1/positions'],
      ['position', (r) => positionGET(r, { params: Promise.resolve({ symbol: 'QNTM' }) }), 'GET', '/api/v1/positions/QNTM'],
      ['orders', (r) => ordersGET(r), 'GET', '/api/v1/orders'],
      ['order', (r) => orderGET(r, { params: Promise.resolve({ id: 'missing' }) }), 'GET', '/api/v1/orders/missing'],
      ['me', (r) => meGET(r), 'GET', '/api/v1/auth/me'],
      ['register', (r) => registerPOST(r), 'POST', '/api/v1/auth/register'],
      ['login', (r) => loginPOST(r), 'POST', '/api/v1/auth/login'],
    ]
    for (const [name, handler, method, url] of targets) {
      let last: Response | null = null
      for (let i = 0; i < 201; i++) {
        last = method === 'GET' ? await handler(getReq(url, bucket)) : await handler(postReq(url, {}, bucket))
      }
      expect(last!.status, name).toBe(429)
    }
  }, 60_000)
})

describe('quote tape-size branch', () => {
  it('uses 100 when the tape is empty and the last print size otherwise', async () => {
    const engine = await getEngineReady()
    const st = engine.states.get('QNTM')!
    const savedTape = st.tape
    st.tape = []
    const empty = await (await quoteGET(getReq('/api/v1/market/quote?symbols=QNTM', { 'X-Forwarded-For': ip() }))).json()
    expect(empty.quotes[0].last_size).toBe(100)

    st.tape = [{ t: Date.now(), p: st.price, s: 777, x: 'B' }] as typeof savedTape
    const withPrint = await (await quoteGET(getReq('/api/v1/market/quote?symbols=QNTM', { 'X-Forwarded-For': ip() }))).json()
    expect(withPrint.quotes[0].last_size).toBe(777)
    st.tape = savedTape
  })
})

describe('profileRows with an empty fleet', () => {
  it('returns an empty list without querying fills', async () => {
    const OPS = { 'x-operator-key': 'meridian-ops-2026' }
    const engine = await getEngineReady()
    const dbMod = await import('@/lib/db')
    const orig = dbMod.db.testProfile.findMany.bind(dbMod.db.testProfile)
    ;(dbMod.db.testProfile as unknown as { findMany: () => Promise<never[]> }).findMany = async () => []
    try {
      const res = await profilesGET(getReq('/api/v1/profiles', OPS))
      expect(res.status).toBe(200)
      expect((await res.json()).profiles).toEqual([])
    } finally {
      ;(dbMod.db.testProfile as unknown as { findMany: typeof orig }).findMany = orig
    }
    void engine
  })
})


describe('rate limit: order-detail route + default limits', () => {
  it('GET/DELETE /orders/{id} trip the limiter per key', async () => {
    const acct = await registerAccount({ email: `hammer2-${Date.now()}@mrx.dev`, password: 'password123' })
    const bucket = { authorization: `Bearer ${acct.apiKey}` }
    let last: Response | null = null
    for (let i = 0; i < 201; i++) last = await orderGET(getReq('/api/v1/orders/missing', bucket), { params: Promise.resolve({ id: 'missing' }) })
    expect(last!.status).toBe(429)
  }, 60_000)

  it('activities default limit and sell-side amounts', async () => {
    const { placeOrder } = await import('@/lib/engine/accounts')
    const acct = await registerAccount({ email: `deflim-${Date.now()}@mrx.dev`, password: 'password123' })
    const auth = { authorization: `Bearer ${acct.apiKey}` }
    await placeOrder(acct.id, { symbol: 'KRYO', side: 'buy', type: 'market', qty: 2 })
    await placeOrder(acct.id, { symbol: 'KRYO', side: 'sell', type: 'market', qty: 2 })
    const res = await activitiesGET(getReq('/api/v1/account/activities', auth))
    expect(res.status).toBe(200)
    const amounts = (await res.json()).activities.map((a: { amount: string }) => Number(a.amount))
    expect(amounts.some((a: number) => a > 0)).toBe(true) // the sell credit
  })

  it('orders POST hammers trip the limiter; POST defaults type to market', async () => {
    const acct = await registerAccount({ email: `posthammer-${Date.now()}@mrx.dev`, password: 'password123' })
    const auth = { authorization: `Bearer ${acct.apiKey}` }
    let last: Response | null = null
    for (let i = 0; i < 201; i++) last = await ordersPOST(postReq('/api/v1/orders', {}, auth))
    expect(last!.status).toBe(429)
  }, 60_000)

  it('orders POST without type defaults to market; DELETE hammers trip too', async () => {
    const { placeOrder } = await import('@/lib/engine/accounts')
    const acct = await registerAccount({ email: `deftype-${Date.now()}@mrx.dev`, password: 'password123' })
    const auth = { authorization: `Bearer ${acct.apiKey}` }
    const res = await ordersPOST(postReq('/api/v1/orders', { symbol: 'KRYO', qty: 1, side: 'buy' }, auth))
    expect(res.status).toBe(201)
    expect((await res.json()).order_type).toBe('market')

    let last: Response | null = null
    for (let i = 0; i < 201; i++) {
      last = await orderDELETE(new NextRequest(`http://localhost:3000/api/v1/orders/missing`, { method: 'DELETE', headers: auth }), { params: Promise.resolve({ id: 'missing' }) })
    }
    expect(last!.status).toBe(429)
  }, 60_000)
})

describe('final limiter + payload branches', () => {
  it('keys POST and rotate POST trip the shared limiter', async () => {
    const { rotateApiKey } = await import('@/lib/engine/accounts')
    void rotateApiKey
    const acct = await registerAccount({ email: `keyrot-${Date.now()}@mrx.dev`, password: 'password123' })
    const auth = { authorization: `Bearer ${acct.apiKey}` }
    let last: Response | null = null
    for (let i = 0; i < 201; i++) last = await keysPOST(postReq('/api/v1/account/keys', {}, auth))
    expect(last!.status).toBe(429)
    const rotated = await rotatePOST(postReq('/api/v1/account/keys/rotate', {}, auth))
    expect(rotated.status).toBe(429) // same bucket, still exhausted
  }, 60_000)

  it('orders POST carries stop_price and client_order_id through', async () => {
    const { placeOrder } = await import('@/lib/engine/accounts')
    void placeOrder
    const acct = await registerAccount({ email: `stopbody-${Date.now()}@mrx.dev`, password: 'password123' })
    const auth = { authorization: `Bearer ${acct.apiKey}` }
    await ordersPOST(postReq('/api/v1/orders', { symbol: 'QNTM', qty: 1, side: 'buy', type: 'market' }, auth))
    const px = (await (await import('@/lib/engine')).getEngineReady()).quote('QNTM')!.p
    const stop = await ordersPOST(postReq('/api/v1/orders', { symbol: 'QNTM', qty: 1, side: 'sell', type: 'stop', stop_price: px * 0.9, client_order_id: `coid-${Date.now()}` }, auth))
    expect(stop.status).toBe(201)
    expect((await stop.json()).stop_price).not.toBeNull()
  })
})
