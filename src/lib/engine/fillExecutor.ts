// Applies executed fills to the database: orders, positions, account cash.

import { db } from '@/lib/db'

export interface FillInput {
  qty: number
  price: number
  fee: number
}

export interface AppliedFillResult {
  orderId: string
  status: string
  filledQty: number
  filledAvgPrice: number | null
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000
}

/**
 * Apply one fill (or an array of immediate fills) to an order, updating the
 * position (with average-cost accounting across sign flips) and account cash.
 */
export async function applyFill(
  orderId: string,
  accountId: string,
  fill: FillInput,
  orderDone: boolean,
): Promise<AppliedFillResult> {
  const qty = round4(fill.qty)
  const price = round4(fill.price)
  const fee = round4(fill.fee)
  const notional = round4(qty * price)

  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } })
    if (!order) throw new Error(`Order ${orderId} not found`)

    const prevFilled = order.filledQty
    const newFilled = round4(prevFilled + qty)
    const newAvg =
      order.filledAvgPrice && prevFilled > 0
        ? round4((order.filledAvgPrice * prevFilled + price * qty) / newFilled)
        : price
    const status = orderDone || newFilled >= order.qty - 1e-9 ? 'filled' : 'partially_filled'

    await tx.order.update({
      where: { id: orderId },
      data: {
        filledQty: newFilled,
        filledAvgPrice: newAvg,
        status,
        filledAt: status === 'filled' ? new Date() : order.filledAt,
      },
    })

    await tx.fill.create({
      data: { orderId, accountId, symbol: order.symbol, side: order.side, qty, price, fee, createdAt: new Date() },
    })

    // position update
    const sideSign = order.side === 'buy' ? 1 : -1
    const signedQty = sideSign * qty
    const pos = await tx.position.findUnique({
      where: { accountId_symbol: { accountId, symbol: order.symbol } },
    })

    let newQty = signedQty
    let newAvgPrice = price
    if (pos) {
      const cur = pos.qty
      if (Math.abs(cur) < 1e-9) {
        newQty = signedQty
        newAvgPrice = price
      } else if (Math.sign(cur) === Math.sign(signedQty)) {
        // adding
        newQty = round4(cur + signedQty)
        newAvgPrice = round4((pos.avgPrice * Math.abs(cur) + price * Math.abs(signedQty)) / (Math.abs(cur) + Math.abs(signedQty)))
      } else {
        // reducing or flipping
        newQty = round4(cur + signedQty)
        newAvgPrice = Math.abs(newQty) < 1e-9 || Math.sign(newQty) !== Math.sign(cur) ? price : pos.avgPrice
      }
      if (Math.abs(newQty) < 1e-9) {
        await tx.position.delete({ where: { id: pos.id } })
        newQty = 0
      } else {
        await tx.position.update({ where: { id: pos.id }, data: { qty: newQty, avgPrice: newAvgPrice } })
      }
    } else {
      await tx.position.create({ data: { accountId, symbol: order.symbol, qty: newQty, avgPrice: price } })
    }

    // cash: buy reduces, sell adds (fee applies to sells: SEC/TAF)
    const cashDelta = order.side === 'buy' ? -(notional + fee) : notional - fee
    await tx.account.update({
      where: { id: accountId },
      data: { cash: { increment: round4(cashDelta) } },
    })

    return { orderId, status, filledQty: newFilled, filledAvgPrice: newAvg }
  })

  return result
}
