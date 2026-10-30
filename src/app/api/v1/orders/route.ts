import { NextRequest } from 'next/server'
import { ok, fail, preflight, rateLimitResponse, clientKey, requireAccount, errorResponse } from '@/lib/api/respond'
import { placeOrder, orderView, ensureEngineHooks } from '@/lib/engine/accounts'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const account = await requireAccount(req)
    const url = new URL(req.url)
    const status = url.searchParams.get('status') ?? 'open'
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 50)))
    const symbol = url.searchParams.get('symbol')?.toUpperCase()
    const where: Record<string, unknown> = { accountId: account.id }
    if (status === 'open') where.status = { in: ['new', 'accepted', 'partially_filled'] }
    else if (status === 'closed') where.status = { in: ['filled', 'canceled', 'expired', 'rejected'] }
    else if (status !== 'all') where.status = status
    if (symbol) where.symbol = symbol
    const orders = await db.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit })
    return ok({ orders: orders.map(orderView), ts: Date.now() })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function POST(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    ensureEngineHooks()
    const account = await requireAccount(req)
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return fail(422, 'INVALID_BODY', 'Request body must be a JSON order object. See /api/v1/docs.')
    }
    const side = body.side
    if (!['buy', 'sell'].includes(side)) {
      return fail(422, 'INVALID_SIDE', "side must be 'buy' or 'sell'.")
    }
    const order = await placeOrder(account.id, {
      symbol: body.symbol,
      qty: body.qty !== undefined ? Number(body.qty) : undefined,
      notional: body.notional !== undefined ? Number(body.notional) : undefined,
      side,
      type: body.type ?? 'market',
      time_in_force: body.time_in_force ?? body.tif ?? 'day',
      limit_price: body.limit_price !== undefined ? Number(body.limit_price) : undefined,
      stop_price: body.stop_price !== undefined ? Number(body.stop_price) : undefined,
      client_order_id: body.client_order_id ? String(body.client_order_id) : undefined,
    })
    if (!order) return fail(500, 'INTERNAL', 'Order could not be persisted.')
    return ok(orderView(order), 201)
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
