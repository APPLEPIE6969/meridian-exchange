// Public market-data, news, leaderboard and docs endpoints — handlers called
// directly with NextRequest (rate-limit buckets isolated per request IP).

import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as quoteGET, OPTIONS as quoteOPTIONS } from '@/app/api/v1/market/quote/route'
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
import { GET as docsGET } from '@/app/api/v1/docs/route'
import { GET as rootV1GET } from '@/app/api/v1/route'
import { GET as helloGET } from '@/app/api/route'
import { registerAccount, placeOrder } from '@/lib/engine/accounts'
import { getEngineReady } from '@/lib/engine'

let n = 0
const ip = () => `10.7.${++n}.${n}` // unique rate-limit bucket per call
const get = (url: string) => new NextRequest(`http://localhost:3000${url}`, { headers: { 'X-Forwarded-For': ip() } })
const json = async (res: Response) => ({ status: res.status, body: await res.json() })

describe('GET /market/quote', () => {
  it('returns enriched multi-symbol quotes', async () => {
    const { status, body } = await json(await quoteGET(get('/api/v1/market/quote?symbols=QNTM,HELX,MTEK')))
    expect(status).toBe(200)
    expect(body.quotes).toHaveLength(3)
    const q = body.quotes[0]
    for (const k of ['symbol', 'name', 'sector', 'kind', 'last', 'bid', 'ask', 'bid_size', 'ask_size', 'last_size', 'open', 'high', 'low', 'prev_close', 'volume', 'change', 'change_percent', 'week52_high', 'week52_low', 'halted', 'session', 'ts']) {
      expect(q, k).toHaveProperty(k)
    }
    expect(q.bid_size).toBeGreaterThan(0)
    expect(q.week52_low).toBeLessThanOrEqual(q.last)
    expect(q.last).toBeLessThanOrEqual(q.week52_high)
  })

  it('reports unknown symbols in not_found and 404s when nothing matches', async () => {
    const mixed = await json(await quoteGET(get('/api/v1/market/quote?symbols=QNTM,BOGUS')))
    expect(mixed.status).toBe(200)
    expect(mixed.body.not_found).toEqual(['BOGUS'])

    const miss = await json(await quoteGET(get('/api/v1/market/quote?symbols=NOPE1,NOPE2')))
    expect(miss.status).toBe(404)
    expect(miss.body.error.code).toBe('SYMBOL_NOT_FOUND')
  })

  it('validates the symbols parameter', async () => {
    const missing = await json(await quoteGET(get('/api/v1/market/quote')))
    expect(missing.status).toBe(422)
    expect(missing.body.error.code).toBe('SYMBOLS_REQUIRED')

    const blank = await json(await quoteGET(get('/api/v1/market/quote?symbols=%20%20,')))
    expect(blank.status).toBe(422)
    expect(blank.body.error.code).toBe('SYMBOLS_REQUIRED')
  })

  it('accepts the singular ?symbol= alias, normalizes case and whitespace, caps at 50', async () => {
    const single = await json(await quoteGET(get('/api/v1/market/quote?symbol=qntm')))
    expect(single.status).toBe(200)
    expect(single.body.quotes[0].symbol).toBe('QNTM')

    const many = Array.from({ length: 60 }, () => 'QNTM').join(',')
    const capped = await json(await quoteGET(get(`/api/v1/market/quote?symbols=${many}`)))
    expect(capped.status).toBe(200)
    expect(capped.body.quotes.length).toBeLessThanOrEqual(50)
  })

  it('answers CORS preflight', async () => {
    const res = await quoteOPTIONS()
    expect(res.status).toBe(204)
  })
})

describe('GET /market/stocks', () => {
  it('lists all securities sorted by market cap', async () => {
    const { status, body } = await json(await stocksGET(get('/api/v1/market/stocks')))
    expect(status).toBe(200)
    expect(body.count).toBe(48)
    expect(body.securities).toHaveLength(48)
    for (let i = 1; i < body.securities.length; i++) {
      expect(body.securities[i - 1].market_cap).toBeGreaterThanOrEqual(body.securities[i].market_cap)
    }
    const qntm = body.securities.find((s: { symbol: string }) => s.symbol === 'QNTM')
    expect(qntm.pe_ratio).toBeCloseTo(qntm.last / 8.85, 0)
  })

  it('filters by sector, kind and search', async () => {
    const tech = await json(await stocksGET(get('/api/v1/market/stocks?sector=technology')))
    expect(tech.status).toBe(200)
    for (const s of tech.body.securities) expect(s.sector).toBe('Technology')

    const etfs = await json(await stocksGET(get('/api/v1/market/stocks?kind=etf')))
    expect(etfs.body.securities).toHaveLength(6)
    for (const s of etfs.body.securities) expect(s.kind).toBe('etf')

    const search = await json(await stocksGET(get('/api/v1/market/stocks?search=quantum')))
    expect(search.body.securities.length).toBeGreaterThan(0)
    expect(search.body.securities.some((s: { symbol: string }) => s.symbol === 'QNTM')).toBe(true)

    const bySymbol = await json(await stocksGET(get('/api/v1/market/stocks?search=hlxq')))
    expect(bySymbol.body.securities).toHaveLength(1)

    const none = await json(await stocksGET(get('/api/v1/market/stocks?search=zzzznope')))
    expect(none.body.count).toBe(0)
  })
})

describe('GET /market/stocks/[symbol]', () => {
  it('returns the full company profile for a stock', async () => {
    const res = await stockGET(get('/api/v1/market/stocks/QNTM'), { params: Promise.resolve({ symbol: 'QNTM' }) })
    const { status, body } = await json(res)
    expect(status).toBe(200)
    expect(body.symbol).toBe('QNTM')
    expect(body.about.summary.length).toBeGreaterThan(100)
    expect(body.products.length).toBeGreaterThan(2)
    expect(body.financials.quarterly).toHaveLength(8)
    expect(body.financials.next_report.eps_consensus).toBeGreaterThan(0)
    expect(body.peers.length).toBeGreaterThan(0)
    expect(body.peers[0].market_cap).toBeGreaterThan(0)
    expect(body.stats.week52_low).toBeLessThanOrEqual(body.price)
    expect(body.stats.shares_outstanding).toBeGreaterThan(0)
    expect(Array.isArray(body.news)).toBe(true)
  })

  it('serves ETFs without product lines and handles lowercase input', async () => {
    const res = await stockGET(get('/api/v1/market/stocks/mcom'), { params: Promise.resolve({ symbol: 'mcom' }) })
    const { status, body } = await json(res)
    expect(status).toBe(200)
    expect(body.kind).toBe('etf')
    expect(body.products).toEqual([])
  })

  it('404s unknown symbols', async () => {
    const res = await stockGET(get('/api/v1/market/stocks/NOPE'), { params: Promise.resolve({ symbol: 'NOPE' }) })
    const { status, body } = await json(res)
    expect(status).toBe(404)
    expect(body.error.code).toBe('UNKNOWN_SYMBOL')
  })
})

describe('GET /market/candles', () => {
  it('returns intraday and daily bars', async () => {
    const fiveMin = await json(await candlesGET(get('/api/v1/market/candles?symbol=QNTM&interval=5m&start=' + (Date.now() - 3 * 86400000))))
    expect(fiveMin.status).toBe(200)
    expect(fiveMin.body.count).toBeGreaterThan(50)
    for (const b of fiveMin.body.bars) {
      expect(b.h).toBeGreaterThanOrEqual(b.l)
      expect(b.v).toBeGreaterThanOrEqual(0)
    }

    const daily = await json(await candlesGET(get('/api/v1/market/candles?symbol=IRWQ&interval=1d&range=ALL&limit=20000')))
    expect(daily.status).toBe(200)
    expect(daily.body.count).toBeGreaterThan(8000) // deep history from 1996
  })

  it('supports named ranges including ALL', async () => {
    for (const range of ['1D', '5D', '1M', '3M', '6M', '1A', '5A', 'ALL']) {
      const res = await json(await candlesGET(get(`/api/v1/market/candles?symbol=QNTM&interval=1d&range=${range}`)))
      expect(res.status, range).toBe(200)
      expect(res.body.count, range).toBeGreaterThan(0)
    }
    const all = await json(await candlesGET(get('/api/v1/market/candles?symbol=IRWQ&interval=1d&range=ALL&limit=20000')))
    expect(all.body.count).toBeGreaterThan(8000)
  })

  it('honors the timeframe alias (backwards compatibility)', async () => {
    const res = await json(await candlesGET(get(`/api/v1/market/candles?symbol=QNTM&timeframe=15m&start=${Date.now() - 86400000}`)))
    expect(res.status).toBe(200)
    expect(res.body.interval).toBe('15m')
  })

  it('validates symbol, interval and range', async () => {
    const noSym = await json(await candlesGET(get('/api/v1/market/candles')))
    expect(noSym.status).toBe(422)
    expect(noSym.body.error.code).toBe('SYMBOL_REQUIRED')

    const badSym = await json(await candlesGET(get('/api/v1/market/candles?symbol=NOPE')))
    expect(badSym.status).toBe(404)

    const badInterval = await json(await candlesGET(get('/api/v1/market/candles?symbol=QNTM&interval=37s')))
    expect(badInterval.status).toBe(422)
    expect(badInterval.body.error.code).toBe('INVALID_INTERVAL')

    const badRange = await json(await candlesGET(get('/api/v1/market/candles?symbol=QNTM&start=500&end=100')))
    expect(badRange.status).toBe(422)
    expect(badRange.body.error.code).toBe('INVALID_RANGE')

    // end in the future is clamped, empty start defaults to 5 days
    const clamped = await json(await candlesGET(get(`/api/v1/market/candles?symbol=QNTM&end=${Date.now() + 99999999}`)))
    expect(clamped.status).toBe(200)

    // an unrecognized range falls through to the explicit/default window
    const unknownRange = await json(await candlesGET(get('/api/v1/market/candles?symbol=QNTM&interval=1d&range=2W')))
    expect(unknownRange.status).toBe(200)
  })
})

describe('GET /market/orderbook + /market/trades', () => {
  it('returns aggregated depth with spread', async () => {
    const { status, body } = await json(await orderbookGET(get('/api/v1/market/orderbook?symbol=NEURX')))
    expect(status).toBe(200)
    expect(body.bids.length).toBeGreaterThan(0)
    expect(body.depth_bids).toBeGreaterThan(0)
    expect(body.depth_asks).toBeGreaterThan(0)
    expect(body.spread).toBeGreaterThanOrEqual(0)
  })

  it('validates symbol and 404s unknowns', async () => {
    const missing = await json(await orderbookGET(get('/api/v1/market/orderbook')))
    expect(missing.status).toBe(422)
    const unknown = await json(await orderbookGET(get('/api/v1/market/orderbook?symbol=NOPE')))
    expect(unknown.status).toBe(404)

    const tMissing = await json(await tradesGET(get('/api/v1/market/trades')))
    expect(tMissing.status).toBe(422)
    const tUnknown = await json(await tradesGET(get('/api/v1/market/trades?symbol=NOPE')))
    expect(tUnknown.status).toBe(404)
  })

  it('returns the time & sales tape with a limit clamp', async () => {
    const { status, body } = await json(await tradesGET(get('/api/v1/market/trades?symbol=CLDU&limit=10')))
    expect(status).toBe(200)
    expect(body.trades.length).toBeLessThanOrEqual(10)
    for (const t of body.trades) {
      expect(['B', 'S', 'T']).toContain(t.aggressor)
      expect(t.size).toBeGreaterThan(0)
    }
  })
})

describe('GET /market/movers, /market/indices, /market/status, /market/calendar', () => {
  it('movers shape', async () => {
    const { status, body } = await json(await moversGET(get('/api/v1/market/movers')))
    expect(status).toBe(200)
    for (const key of ['gainers', 'losers', 'most_active']) {
      expect(body[key].length).toBeGreaterThan(0)
      expect(body[key][0]).toHaveProperty('symbol')
    }
  })

  it('indices shape', async () => {
    const { status, body } = await json(await indicesGET(get('/api/v1/market/indices')))
    expect(status).toBe(200)
    expect(body.composite.symbol).toBe('MRC')
    expect(typeof body.mvix).toBe('number')
  })

  it('status shape', async () => {
    const { status, body } = await json(await statusGET(get('/api/v1/market/status')))
    expect(status).toBe(200)
    expect(body.exchange).toBe('MRX')
  })

  it('calendar clamps days and returns events', async () => {
    const tiny = await json(await calendarGET(get('/api/v1/market/calendar?days=-5')))
    expect(tiny.status).toBe(200) // clamped to 1
    const big = await json(await calendarGET(get('/api/v1/market/calendar?days=999')))
    expect(big.status).toBe(200)
    expect(big.body.events.length).toBeGreaterThan(0)
  })
})

describe('GET /news, /leaderboard, /docs, index endpoints', () => {
  it('company news parsing survives malformed symbol payloads', async () => {
    const engine = await getEngineReady()
    engine.newsFeed.unshift({
      id: 'bad-json', headline: 'h', body: 'b', source: 's', kind: 'color',
      symbols: '{broken', sentiment: 0, impactBps: 0, createdAt: new Date().toISOString(),
    })
    try {
      const res = await stockGET(get('/api/v1/market/stocks/HELX'), { params: Promise.resolve({ symbol: 'HELX' }) })
      expect(res.status).toBe(200)
    } finally {
      engine.newsFeed.shift()
    }
  })

  it('news wire filters by symbol and clamps limit', async () => {
    const all = await json(await newsGET(get('/api/v1/news?limit=5')))
    expect(all.status).toBe(200)
    expect(all.body.news.length).toBeLessThanOrEqual(5)

    const filtered = await json(await newsGET(get('/api/v1/news?symbol=qntm&limit=3')))
    expect(filtered.status).toBe(200)
    for (const item of filtered.body.news) {
      expect(JSON.parse(item.symbols)).toContain('QNTM')
    }
    expect(filtered.body.news[0]).toHaveProperty('headline')
  })

  it('leaderboard clamps limit and returns ranked rows', async () => {
    const acct = await registerAccount({ email: `lb-route-${Date.now()}@mrx.dev`, password: 'password123' })
    await placeOrder(acct.id, { symbol: 'HYDQ', side: 'buy', type: 'market', qty: 1 })
    const res = await json(await leaderboardGET(get('/api/v1/leaderboard?limit=5')))
    expect(res.status).toBe(200)
    expect(res.body.leaderboard.length).toBeLessThanOrEqual(5)
    expect(res.body.leaderboard[0].rank).toBe(1)

    const tiny = await json(await leaderboardGET(get('/api/v1/leaderboard?limit=-3')))
    expect(tiny.status).toBe(200)
  })

  it('docs returns markdown with CORS', async () => {
    const res = await docsGET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    const text = await res.text()
    expect(text).toContain('# Meridian Exchange')
    expect(text).toContain('/market/candles')
  })

  it('v1 index and hello endpoints respond', async () => {
    const v1 = await json(await rootV1GET())
    expect(v1.status).toBe(200)
    expect(v1.body.version).toBe('v1')
    expect(v1.body.endpoints.length).toBeGreaterThan(10)

    const hello = await json(await helloGET())
    expect(hello.body).toEqual({ message: 'Hello, world!' })
  })
})
