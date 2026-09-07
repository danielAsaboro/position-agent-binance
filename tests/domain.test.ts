import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assess,
  validateMandate,
  orderTerms,
  approvalCheck,
} from '../lib/agent/domain.ts';
const now = 1788819000000;
const p = {
  symbol: 'BTCUSDT',
  quantity: 0.2,
  entryPrice: 50000,
  markPrice: 50000,
  liquidationPrice: 40000,
  unrealizedPnl: 0,
  positionSide: 'BOTH',
  observedAt: now,
  fundingRate: 0.0001,
  nextFundingTime: now + 3600000,
  fundingIntervalHours: 8,
  takerFeeRate: 0.0005,
  stepSize: 0.001,
  tickSize: 0.1,
  minQty: 0.001,
  minNotional: 5,
};
const m = {
  symbol: 'BTCUSDT',
  goal: 'Keep directional exposure within my limits',
  maxNotional: 12000,
  minRetainedPct: 25,
  baselineQuantity: 0.2,
  maxOpenLoss: 500,
  takeProfit: 1000,
  profitTrimPct: 25,
  deadline: now + 24 * 3600000,
  fundingBudget: 10,
  maxSlippageBps: 10,
};
test('healthy mandate holds and counts actual future settlements', () => {
  const a = assess(m, p, now);
  assert.equal(a.action, 'hold');
  assert.equal(a.holdFunding, 3);
});
test('short receives positive funding, not a false cost breach', () => {
  const a = assess({ ...m, fundingBudget: 0 }, { ...p, quantity: -0.2 }, now);
  assert.equal(a.action, 'hold');
  assert.equal(a.holdFunding, -3);
});
test('overexposure produces exact reduction and costs', () => {
  const a = assess({ ...m, maxNotional: 7500 }, p, now);
  assert.equal(a.action, 'reduce');
  assert.equal(a.quantity, 0.05);
  assert.equal(a.afterNotional, 7500);
  assert.ok(a.estimatedCost > 0);
});
test('funding adjustment more expensive than savings holds with reason', () => {
  const a = assess({ ...m, fundingBudget: 2.9 }, p, now);
  assert.equal(a.action, 'review');
  assert.match(a.reasons.join(' '), /cost/i);
});
test('minimum retained exposure conflict cannot silently trade', () => {
  const a = assess({ ...m, maxNotional: 1000 }, p, now);
  assert.equal(a.action, 'review');
});
test('loss trigger exits even when retention floor is set', () => {
  const a = assess(m, { ...p, unrealizedPnl: -501 }, now);
  assert.equal(a.action, 'close');
  assert.equal(a.quantity, 0.2);
});
test('deadline closes instead of rolling the goal forward', () =>
  assert.equal(assess({ ...m, deadline: now - 1 }, p, now).action, 'close'));
test('invalid NaN and infinity constraints rejected', () => {
  assert.throws(() => validateMandate({ ...m, maxNotional: Infinity }));
  assert.throws(() => validateMandate({ ...m, minRetainedPct: 101 }));
});
test('hedge positions are unsupported', () =>
  assert.throws(
    () => assess(m, { ...p, positionSide: 'LONG' }, now),
    /one-way/i,
  ));
test('rounding never violates approved slippage bound', () => {
  const t = orderTerms(p, 0.0509, 10);
  assert.equal(t.quantity, '0.050');
  assert.equal(t.side, 'SELL');
  assert.ok(Number(t.price) >= 49950);
  const b = orderTerms({ ...p, quantity: -0.2 }, 0.05, 10);
  assert.ok(Number(b.price) <= 50050);
});
test('stale, changed quantity and drifted approvals fail', () => {
  assert.throws(() => approvalCheck(p, p, now + 61000, 10), /expired/i);
  assert.throws(
    () => approvalCheck(p, { ...p, quantity: 0.1 }, now + 1000, 10),
    /quantity/i,
  );
  assert.throws(
    () => approvalCheck(p, { ...p, markPrice: 51000 }, now + 1000, 10),
    /price/i,
  );
});
test('non power-of-ten quantity steps retain required precision', () => {
  const terms = orderTerms(
    { ...p, quantity: 10, stepSize: 0.25, tickSize: 0.25, minQty: 0.25 },
    1.25,
    10,
  );
  assert.equal(terms.quantity, '1.25');
});
