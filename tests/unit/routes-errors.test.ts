// Error-path coverage: when the engine or database misbehaves, every
// documented endpoint must return a shaped 500 (never a raw crash).
// Each probe patches one engine method / db delegate to throw, driving the
// route's catch branch, then restores it.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getEngineReady } from '@/lib/engine'
import { registerAccount } from '@/lib/engine/accounts'
import { db } from '@/lib/db'
import type { MarketEngine } from '@/lib/engine/engine'

import { GET as quoteGET } from '@/app/api/v1/market/quote/route'
import { GET as stocksGET } from '@/app/api/v1/market/stocks/route'
import { GET as stockGET } from '@/app/api/v1/market/stocks/[symbol]/route'
import { GET as candlesGET } from '@/app/api/v1/market/candles/route'
import { GET as orderbookGET } from '@/app/api/v1/market/orderbook/route'
import { GET as tradesGET } from '@/app/api/v1/market/trades/route'
import { GET as moversGET } from '@/app/api/v1/market/movers/route'
import { GET as indicesGET } from '@/app/api/v1/market/indices/route'
import { GET as statusGET } from '@/app/api/v1/market/status/route'
import { GET as calendarGET } from '@/app/api/v1/market/calendar/route'
import { GET as newsGET } from '@/app/api/v1/news/route'
import { GET as leaderboardGET } from '@/app/api/v1/leaderboard/route'
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
import { POST as registerPOST } from '@/app/api/v1/auth/register/route'
import { POST as loginPOST } from '@/app/api/v1/auth/login/route'
import { GET as meGET } from '@/app/api/v1/auth/me/route'
import { GET as opGET, POST as opPOST } from '@/app/api/v1/operator/route'
import { GET as profilesGET, POST as profilesPOST, PATCH as profilesPATCH, DELETE as profilesDELETE } from '@/app/api/v1/profiles/route'

const OPS = { 'x-operator-key': 'meridian-ops-2026' }
const getReq = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${url}`, { method: 'GET', headers })
const postReq = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const delReq = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${url}`, { method: 'DELETE', headers })

type ErrorSpy = ReturnType<typeof vi.spyOn>
const errSpy = (): ErrorSpy => {
  const spy: ErrorSpy = vi.spyOn(console, 'error')
  spy.mockImplementation(() => undefined)
  return spy
}

/** Patch a property (or method) on the engine/db to throw, run the probe, restore. */
async function probe(restoreTarget: object, key: string, fn: () => Promise<Response>, label: string, err: () => ErrorSpy) {
  const original = (restoreTarget as Record<string, unknown>)[key]
  ;(restoreTarget as Record<string, unknown>)[key] = () => {
    throw new Error('simulated outage')
  }
  const spy = err()
  try {
    await expect500(await fn(), label)
  } finally {
    ;(restoreTarget as Record<string, unknown>)[key] = original
    spy.mockRestore()
  }
}

async function expect500(res: Response, label: string) {
  expect(res.status, label).toBe(500)
  const body = await res.json()
  expect(body.error.code, label).toBe('INTERNAL')
  expect(body.error.message).toContain('internal error occurred')
}

let engine: MarketEngine
let acct: Awaited<ReturnType<typeof registerAccount>>
let auth: Record<string, string>
let n = 0

beforeEach(async () => {
  engine = await getEngineReady()
  n++
  acct = await registerAccount({ email: `errpath-${Date.now()}-${n}@mrx.dev`, password: 'password123' })
  auth = { authorization: `Bearer ${acct.apiKey}` }
})

describe('engine-down error paths', () => {
  it('market data routes fail shaped', async () => {
    const ip = { 'X-Forwarded-For': `errpath-${n}` }
    await probe(engine, 'quote', () => quoteGET(getReq('/api/v1/market/quote?symbols=QNTM', ip)), 'quote', errSpy)
    await probe(engine, 'allQuotes', () => stocksGET(getReq('/api/v1/market/stocks', ip)), 'stocks', errSpy)
    await probe(engine, 'allQuotes', () => stockGET(getReq('/api/v1/market/stocks/QNTM', ip), { params: Promise.resolve({ symbol: 'QNTM' }) }), 'stock', errSpy)
    await probe(engine, 'getCandles', () => candlesGET(getReq('/api/v1/market/candles?symbol=QNTM', ip)), 'candles', errSpy)
    await probe(engine, 'getBook', () => orderbookGET(getReq('/api/v1/market/orderbook?symbol=QNTM', ip)), 'orderbook', errSpy)
    await probe(engine, 'getTape', () => tradesGET(getReq('/api/v1/market/trades?symbol=QNTM', ip)), 'trades', errSpy)
    await probe(engine, 'movers', () => moversGET(getReq('/api/v1/market/movers', ip)), 'movers', errSpy)
    await probe(engine, 'indices', () => indicesGET(getReq('/api/v1/market/indices', ip)), 'indices', errSpy)
    await probe(engine, 'marketStatus', () => statusGET(getReq('/api/v1/market/status', ip)), 'status', errSpy)
    await probe(engine, 'calendar', () => calendarGET(getReq('/api/v1/market/calendar', ip)), 'calendar', errSpy)
    await probe(engine, 'news', () => newsGET(getReq('/api/v1/news', ip)), 'news', errSpy)
    await probe(engine, 'quote', () => leaderboardGET(getReq('/api/v1/leaderboard', ip)), 'leaderboard', errSpy)
  })

  it('trading routes fail shaped', async () => {
    await probe(db.position, 'findMany', () => accountGET(getReq('/api/v1/account', auth)), 'account', errSpy)
    await probe(db.position, 'findMany', () => portfolioGET(getReq('/api/v1/account/portfolio', auth)), 'portfolio', errSpy)
    await probe(db.fill, 'findMany', () => historyGET(getReq('/api/v1/account/portfolio/history?period=1D', auth)), 'history', errSpy)
    await probe(db.fill, 'findMany', () => activitiesGET(getReq('/api/v1/account/activities', auth)), 'activities', errSpy)
    await probe(db.account, 'findUnique', () => keysGET(getReq('/api/v1/account/keys', auth)), 'keys', errSpy)
    await probe(db.account, 'update', () => keysPOST(postReq('/api/v1/account/keys', {}, auth)), 'keys rotate', errSpy)
    await probe(db.account, 'update', () => rotatePOST(postReq('/api/v1/account/keys/rotate', {}, auth)), 'rotate alias', errSpy)
    await probe(db.position, 'findMany', () => positionsGET(getReq('/api/v1/positions', auth)), 'positions', errSpy)
    await probe(db.position, 'findMany', () => positionGET(getReq('/api/v1/positions/QNTM', auth), { params: Promise.resolve({ symbol: 'QNTM' }) }), 'position', errSpy)
    await probe(db.order, 'findMany', () => ordersGET(getReq('/api/v1/orders', auth)), 'orders list', errSpy)
    await probe(engine, 'quote', () => ordersPOST(postReq('/api/v1/orders', { symbol: 'QNTM', qty: 1, side: 'buy', type: 'market' }, auth)), 'orders place', errSpy)
    await probe(db.order, 'findUnique', () => orderGET(getReq('/api/v1/orders/x', auth), { params: Promise.resolve({ id: 'x' }) }), 'order get', errSpy)
    await probe(db.order, 'findUnique', () => orderDELETE(delReq('/api/v1/orders/x', auth), { params: Promise.resolve({ id: 'x' }) }), 'order cancel', errSpy)
    await probe(db.account, 'findUnique', () => meGET(getReq('/api/v1/auth/me', auth)), 'me', errSpy)
    await probe(db.account, 'findUnique', () => registerPOST(postReq('/api/v1/auth/register', { email: `x-${n}-${Date.now()}@e.dev`, password: 'password123' })), 'register', errSpy)
    await probe(db.account, 'findUnique', () => loginPOST(postReq('/api/v1/auth/login', { email: acct.email, password: 'password123' })), 'login', errSpy)
  })

  it('operator and profiles routes fail shaped', async () => {
    await probe(db.account, 'findMany', () => opGET(getReq('/api/v1/operator', OPS)), 'operator get', errSpy)
    await probe(engine, 'applyMarketShock', () => opPOST(postReq('/api/v1/operator', { action: 'shock_market', bps: 10, operator_key: 'meridian-ops-2026' })), 'operator post', errSpy)
    await probe(db.testProfile, 'findMany', () => profilesGET(getReq('/api/v1/profiles', OPS)), 'profiles get', errSpy)
    await probe(db.testProfile, 'findUnique', () => profilesPOST(postReq('/api/v1/profiles', { label: `err-${n}`, operator_key: 'meridian-ops-2026' })), 'profiles post', errSpy)
    await probe(db.testProfile, 'findUnique', () => profilesPATCH(postReq('/api/v1/profiles', { label: `err-${n}`, leaderboard_alias: 'ok', operator_key: 'meridian-ops-2026' })), 'profiles patch', errSpy)
    await probe(db.testProfile, 'findUnique', () => profilesDELETE(delReq(`/api/v1/profiles?label=err-${n}`, OPS)), 'profiles delete', errSpy)
  })

  it('engine.states property outage is restored afterwards', async () => {
    // a fill so portfolioHistory actually walks engine.states via priceAt
    const { placeOrder } = await import('@/lib/engine/accounts')
    await placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'market', qty: 1 })
    const orig = engine.states
    Object.defineProperty(engine, 'states', { get() { throw new Error('outage') }, configurable: true })
    const spy = errSpy()
    try {
      await expect500(await historyGET(getReq('/api/v1/account/portfolio/history?period=1M', auth)), 'states getter')
    } finally {
      Object.defineProperty(engine, 'states', { value: orig, writable: true, configurable: true })
      spy.mockRestore()
    }
    expect(engine.states.size).toBe(48) // restored and healthy
  })
})
