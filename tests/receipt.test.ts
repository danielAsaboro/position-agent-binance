import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderReceipt } from '../lib/agent/receipt.ts';
const terms = {
  symbol: 'BTCUSDT',
  side: 'SELL',
  quantity: '0.05',
  price: '49950',
};
const order = {
  symbol: 'BTCUSDT',
  side: 'SELL',
  clientOrderId: 'id',
  origQty: '0.05',
  executedQty: '0.05',
  reduceOnly: true,
  price: '49950',
  status: 'FILLED',
  avgPrice: '50000',
};
test('receipt must match approved order identity, side and size', () => {
  validateOrderReceipt(order, terms, 'id');
  assert.throws(() =>
    validateOrderReceipt({ ...order, clientOrderId: 'other' }, terms, 'id'),
  );
  assert.throws(() =>
    validateOrderReceipt({ ...order, executedQty: '0.08' }, terms, 'id'),
  );
  assert.throws(() =>
    validateOrderReceipt({ ...order, reduceOnly: false }, terms, 'id'),
  );
});
test('receipt cannot exceed price bound or claim a nonnumeric fill', () => {
  assert.throws(() =>
    validateOrderReceipt({ ...order, avgPrice: '49000' }, terms, 'id'),
  );
  assert.throws(() =>
    validateOrderReceipt({ ...order, executedQty: 'NaN' }, terms, 'id'),
  );
});
