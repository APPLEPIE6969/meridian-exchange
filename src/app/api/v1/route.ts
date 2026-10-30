import { ok, fail, preflight } from '@/lib/api/respond'

export const dynamic = 'force-dynamic'

export async function GET() {
  return ok({
    name: 'Meridian Exchange Trading API',
    version: 'v1',
    description: 'REST API for the Meridian Exchange (MRX) — a 24/7 national securities exchange.',
    documentation: '/api/v1/docs',
    endpoints: [
      'GET  /api/v1/market/status',
      'GET  /api/v1/market/stocks',
      'GET  /api/v1/market/quote?symbols=',
      'GET  /api/v1/market/candles?symbol=&interval=',
      'GET  /api/v1/market/orderbook?symbol=',
      'GET  /api/v1/market/trades?symbol=',
      'GET  /api/v1/market/movers',
      'GET  /api/v1/market/indices',
      'GET  /api/v1/market/calendar',
      'GET  /api/v1/news',
      'GET  /api/v1/leaderboard',
      'GET  /api/v1/account            (auth)',
      'GET  /api/v1/account/portfolio/history?period=1D|1W|1M|1A   (auth)',
      'GET  /api/v1/account/activities (auth)',
      'GET  /api/v1/positions          (auth)',
      'GET  /api/v1/orders             (auth)',
      'POST /api/v1/orders             (auth)',
      'DEL  /api/v1/orders/{id}        (auth)',
    ],
    streaming: 'Socket.IO: connect to / with ?XTransformPort=3003 (events: ticks, news, fill, order)',
    ts: new Date().toISOString(),
  })
}

export async function OPTIONS() {
  return preflight()
}
