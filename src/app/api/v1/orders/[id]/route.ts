import { NextRequest } from 'next/server'
import { ok, fail, preflight, rateLimitResponse, clientKey, requireAccount, errorResponse } from '@/lib/api/respond'
import { cancelOrder, orderView } from '@/lib/engine/accounts'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const account = await requireAccount(req)
    const { id } = await ctx.params
    const order = await db.order.findUnique({ where: { id } })
    if (!order || order.accountId !== account.id) {
      return fail(404, 'ORDER_NOT_FOUND', 'Order not found.')
    }
    const fills = await db.fill.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } })
    return ok({
      ...orderView(order),
      fills: fills.map((f) => ({
        id: f.id,
        order_id: f.orderId,
        symbol: f.symbol,
        side: f.side,
        qty: String(f.qty),
        price: String(f.price),
        fee: String(f.fee),
        ts: f.createdAt.toISOString(),
      })),
    })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const account = await requireAccount(req)
    const { id } = await ctx.params
    const order = await cancelOrder(account.id, id)
    if (!order) return fail(404, 'ORDER_NOT_FOUND', 'Order not found.')
    return ok(orderView(order))
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
