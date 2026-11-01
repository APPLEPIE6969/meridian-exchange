import { NextRequest } from 'next/server'
import { ok, fail, preflight, rateLimitResponse, clientKey, errorResponse } from '@/lib/api/respond'
import { getEngineReady } from '@/lib/engine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const engine = await getEngineReady()
    const url = new URL(req.url)
    const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase()
    if (!symbol) return fail(422, 'SYMBOL_REQUIRED', 'symbol query parameter is required.')
    const book = engine.getBook(symbol)
    if (!book) return fail(404, 'SYMBOL_NOT_FOUND', `No security found for symbol '${symbol}'.`)
    const q = engine.quote(symbol)!
    return ok({
      symbol,
      last: q.p,
      bid: q.b,
      ask: q.a,
      bids: book.bids.map((l) => ({ price: l.price, size: Math.round(l.size) })),
      asks: book.asks.map((l) => ({ price: l.price, size: Math.round(l.size) })),
      depth_bids: book.bids.reduce((s, l) => s + l.size, 0),
      depth_asks: book.asks.reduce((s, l) => s + l.size, 0),
      spread: Math.round((q.a - q.b) * 100) / 100,
      halted: book.halted,
      ts: book.ts,
    })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
