import { NextRequest } from 'next/server'
import { ok, preflight, rateLimitResponse, clientKey, requireAccount, errorResponse } from '@/lib/api/respond'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const account = await requireAccount(req)
    const limit = Math.min(500, Math.max(1, Number(new URL(req.url).searchParams.get('limit') ?? 50)))
    const activities = await db.fill.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return ok({
      activities: activities.map((f) => ({
        id: f.id,
        activity_type: 'fill',
        order_id: f.orderId,
        symbol: f.symbol,
        side: f.side,
        qty: String(f.qty),
        price: String(f.price),
        fee: String(f.fee),
        amount: String(f.side === 'buy' ? -(f.qty * f.price + f.fee) : f.qty * f.price - f.fee),
        transaction_time: f.createdAt.toISOString(),
      })),
      ts: Date.now(),
    })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
