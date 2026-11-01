// Consolidated portfolio view — Alpaca-style aggregate with positions inline.

import { NextRequest } from 'next/server'
import { ok, preflight, rateLimitResponse, clientKey, requireAccount, errorResponse } from '@/lib/api/respond'
import { accountView, positionViews } from '@/lib/engine/accounts'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rl = rateLimitResponse(clientKey(req))
  if (rl) return rl
  try {
    const account = await requireAccount(req)
    const [acct, positions] = await Promise.all([accountView(account.id), positionViews(account.id)])
    const longValue = positions
      .filter((p) => p.side === 'long')
      .reduce((s, p) => s + (p.market_value as number), 0)
    return ok({
      account_id: acct.id,
      account_number: acct.account_number,
      status: acct.status,
      cash: acct.cash,
      portfolio_value: acct.portfolio_value,
      equity: acct.equity,
      long_market_value: acct.long_market_value,
      short_market_value: acct.short_market_value,
      long_invested_value: Math.round(longValue * 100) / 100,
      buying_power: acct.buying_power,
      buying_power_available: acct.buying_power_available,
      positions_count: positions.length,
      positions,
      ts: Date.now(),
    })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function OPTIONS() {
  return preflight()
}
