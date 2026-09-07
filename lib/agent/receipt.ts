export function validateOrderReceipt(
  order: any,
  terms: Record<string, string>,
  clientId: string,
) {
  if (
    order.clientOrderId !== clientId ||
    order.symbol !== terms.symbol ||
    order.side !== terms.side ||
    Number(order.origQty) !== Number(terms.quantity) ||
    order.reduceOnly !== true ||
    Number(order.price) !== Number(terms.price)
  )
    throw new Error('Exchange receipt does not match the approved order');
  const executed = Number(order.executedQty),
    price = Number(order.avgPrice);
  if (
    !Number.isFinite(executed) ||
    executed < 0 ||
    executed > Number(terms.quantity) + 1e-12
  )
    throw new Error('Invalid executed quantity');
  if (
    executed > 0 &&
    (!Number.isFinite(price) ||
      price <= 0 ||
      (terms.side === 'SELL'
        ? price < Number(terms.price)
        : price > Number(terms.price)))
  )
    throw new Error('Fill price does not match the approved bound');
}
