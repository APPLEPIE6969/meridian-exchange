// Fill application: order progress, average-cost accounting, position lifecycle, cash.

import { describe, it, expect, beforeEach } from 'vitest'
import { applyFill } from '@/lib/engine/fillExecutor'
import { registerAccount, placeOrder } from '@/lib/engine/accounts'
import { db } from '@/lib/db'
import { getEngineReady } from '@/lib/engine'

let counter = 0

async function newAccountWithMarketOrder(symbol: string, side: 'buy' | 'sell', qty: number) {
  counter++
  const acct = await registerAccount({ email: `fill-${Date.now()}-${counter}@mrx.dev`, password: 'password123', handle: `filler${counter}` })
  const order = await placeOrder(acct.id, { symbol, side, type: 'market', qty })
  return { acct, order }
}

let acct: Awaited<ReturnType<typeof registerAccount>>
let resting: { id: string }

beforeEach(async () => {
  const engine = await getEngineReady()
  for (const s of engine.states.values()) { s.haltedUntil = 0; s.priceRing.fill(s.price); s.ringIdx = 0 }
  counter++
  acct = await registerAccount({ email: `fillcore-${Date.now()}-${counter}@mrx.dev`, password: 'password123', handle: `fillcore${counter}` })
  // A resting limit order far from the market, to fill manually piece by piece.
  const res = await placeOrder(acct.id, { symbol: 'QNTM', side: 'buy', type: 'limit', qty: 10, limit_price: 1, time_in_force: 'gtc' })
  resting = { id: res!.id }
})

describe('applyFill', () => {
  it('throws for unknown orders', async () => {
    await expect(applyFill('no-such-order', acct.id, { qty: 1, price: 100, fee: 0 }, true)).rejects.toThrow(/not found/)
  })

  it('applies a partial fill without completing the order', async () => {
    const r = await applyFill(resting.id, acct.id, { qty: 4, price: 100, fee: 0.05 }, false)
    expect(r.status).toBe('partially_filled')
    expect(r.filledQty).toBe(4)
    expect(r.filledAvgPrice).toBe(100)
    const order = await db.order.findUnique({ where: { id: resting.id } })
    expect(order!.status).toBe('partially_filled')
    expect(order!.filledAt).toBeNull()
    const fill = await db.fill.findFirst({ where: { orderId: resting.id } })
    expect(fill!.qty).toBe(4)
    expect(fill!.symbol).toBe('QNTM')
    expect(fill!.side).toBe('buy')
  })

  it('completes the order on a filling fill and stamps filledAt', async () => {
    await applyFill(resting.id, acct.id, { qty: 4, price: 100, fee: 0 }, false)
    const r = await applyFill(resting.id, acct.id, { qty: 6, price: 102, fee: 0 }, false)
    expect(r.status).toBe('filled')
    expect(r.filledQty).toBe(10)
    expect(r.filledAvgPrice).toBeCloseTo((4 * 100 + 6 * 102) / 10, 4)
    const order = await db.order.findUnique({ where: { id: resting.id } })
    expect(order!.status).toBe('filled')
    expect(order!.filledAt).not.toBeNull()
  })

  it('treats orderDone=true as filled even if quantity is incomplete', async () => {
    const r = await applyFill(resting.id, acct.id, { qty: 1, price: 50, fee: 0 }, true)
    expect(r.status).toBe('filled')
  })

  it('creates a long position with the fill price', async () => {
    await applyFill(resting.id, acct.id, { qty: 5, price: 100, fee: 0 }, false)
    const pos = await db.position.findUnique({ where: { accountId_symbol: { accountId: acct.id, symbol: 'QNTM' } } })
    expect(pos!.qty).toBe(5)
    expect(pos!.avgPrice).toBe(100)
  })

  it('adds to an existing position with weighted-average cost', async () => {
    await applyFill(resting.id, acct.id, { qty: 5, price: 100, fee: 0 }, false)
    await applyFill(resting.id, acct.id, { qty: 5, price: 200, fee: 0 }, false)
    const pos = await db.position.findUnique({ where: { accountId_symbol: { accountId: acct.id, symbol: 'QNTM' } } })
    expect(pos!.qty).toBe(10)
    expect(pos!.avgPrice).toBeCloseTo(150, 4)
  })

  it('reduces a position without touching the average cost', async () => {
    await applyFill(resting.id, acct.id, { qty: 8, price: 100, fee: 0 }, false)
    const sellOrder = await db.order.create({
      data: { accountId: acct.id, symbol: 'QNTM', side: 'sell', type: 'limit', qty: 3, limitPrice: 1, tif: 'gtc', status: 'accepted' },
    })
    await applyFill(sellOrder.id, acct.id, { qty: 3, price: 120, fee: 0 }, false)
    const pos = await db.position.findUnique({ where: { accountId_symbol: { accountId: acct.id, symbol: 'QNTM' } } })
    expect(pos!.qty).toBe(5)
    expect(pos!.avgPrice).toBe(100)
  })

  it('deletes the position when it closes to exactly zero', async () => {
    await applyFill(resting.id, acct.id, { qty: 8, price: 100, fee: 0 }, false)
    const sellOrder = await db.order.create({
      data: { accountId: acct.id, symbol: 'QNTM', side: 'sell', type: 'limit', qty: 8, limitPrice: 1, tif: 'gtc', status: 'accepted' },
    })
    await applyFill(sellOrder.id, acct.id, { qty: 8, price: 120, fee: 0 }, false)
    const pos = await db.position.findUnique({ where: { accountId_symbol: { accountId: acct.id, symbol: 'QNTM' } } })
    expect(pos).toBeNull()
  })

  it('flips a position through zero to the opposite sign at the new price', async () => {
    await applyFill(resting.id, acct.id, { qty: 5, price: 100, fee: 0 }, false)
    // sell 8 (via a short-capable market order account): apply directly against the same position
    const sellAcct = await newAccountWithMarketOrder('VLTR', 'buy', 1)
    // simulate a sell fill on acct's QNTM long using a synthetic sell order
    const sellOrder = await db.order.create({
      data: { accountId: acct.id, symbol: 'QNTM', side: 'sell', type: 'limit', qty: 8, limitPrice: 1, tif: 'gtc', status: 'accepted' },
    })
    await applyFill(sellOrder.id, acct.id, { qty: 8, price: 110, fee: 0.1 }, false)
    const pos = await db.position.findUnique({ where: { accountId_symbol: { accountId: acct.id, symbol: 'QNTM' } } })
    expect(pos!.qty).toBe(-3)
    expect(pos!.avgPrice).toBe(110)
    expect(sellAcct.acct).toBeDefined()
  })

  it('opens a short position from flat on a sell fill', async () => {
    const sellOrder = await db.order.create({
      data: { accountId: acct.id, symbol: 'HELX', side: 'sell', type: 'limit', qty: 7, limitPrice: 1, tif: 'gtc', status: 'accepted' },
    })
    await applyFill(sellOrder.id, acct.id, { qty: 7, price: 90, fee: 0.2 }, false)
    const pos = await db.position.findUnique({ where: { accountId_symbol: { accountId: acct.id, symbol: 'HELX' } } })
    expect(pos!.qty).toBe(-7)
    expect(pos!.avgPrice).toBe(90)
  })

  it('covers a short back through zero with correct re-opening price', async () => {
    const sellOrder = await db.order.create({
      data: { accountId: acct.id, symbol: 'KRYO', side: 'sell', type: 'limit', qty: 10, limitPrice: 1, tif: 'gtc', status: 'accepted' },
    })
    await applyFill(sellOrder.id, acct.id, { qty: 10, price: 20, fee: 0 }, false)
    const buyOrder = await db.order.create({
      data: { accountId: acct.id, symbol: 'KRYO', side: 'buy', type: 'limit', qty: 14, limitPrice: 1000, tif: 'gtc', status: 'accepted' },
    })
    await applyFill(buyOrder.id, acct.id, { qty: 14, price: 22, fee: 0 }, false)
    const pos = await db.position.findUnique({ where: { accountId_symbol: { accountId: acct.id, symbol: 'KRYO' } } })
    expect(pos!.qty).toBe(4)
    expect(pos!.avgPrice).toBe(22)
  })

  it('moves cash: buys subtract notional+fee, sells add notional−fee', async () => {
    const before = (await db.account.findUnique({ where: { id: acct.id } }))!.cash
    await applyFill(resting.id, acct.id, { qty: 2, price: 100, fee: 0.5 }, false)
    const afterBuy = (await db.account.findUnique({ where: { id: acct.id } }))!.cash
    expect(afterBuy).toBeCloseTo(before - 200.5, 4)

    const sellOrder = await db.order.create({
      data: { accountId: acct.id, symbol: 'MENDL', side: 'sell', type: 'limit', qty: 3, limitPrice: 1, tif: 'gtc', status: 'accepted' },
    })
    await applyFill(sellOrder.id, acct.id, { qty: 3, price: 50, fee: 0.25 }, false)
    const afterSell = (await db.account.findUnique({ where: { id: acct.id } }))!.cash
    expect(afterSell).toBeCloseTo(afterBuy + 150 - 0.25, 4)
  })
})

describe('flat-position branch', () => {
  it('fills against a zero-quantity position as if opening fresh', async () => {
    await db.position.create({
      data: { accountId: acct.id, symbol: 'MENDL', qty: 0, avgPrice: 50 },
    })
    const buyOrder = await db.order.create({
      data: { accountId: acct.id, symbol: 'MENDL', side: 'buy', type: 'limit', qty: 4, limitPrice: 1000, tif: 'gtc', status: 'accepted' },
    })
    const applied = await applyFill(buyOrder.id, acct.id, { qty: 2, price: 60, fee: 0 }, false)
    expect(applied.status).toBe('partially_filled')
    const pos = await db.position.findUnique({ where: { accountId_symbol: { accountId: acct.id, symbol: 'MENDL' } } })
    expect(pos!.qty).toBe(2)
    expect(pos!.avgPrice).toBe(60)
  })
})
