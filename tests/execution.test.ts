import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { AgentService } from '../lib/agent/service.ts';
import { Store } from '../lib/agent/store.ts';
import { assess, orderTerms } from '../lib/agent/domain.ts';
async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    readFileSync(
      new URL('../drizzle/0000_round_gabe_jones.sql', import.meta.url),
      'utf8',
    ),
  );
  const adapter: any = {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      return {
        bind(...args: any[]) {
          return {
            first: async () => statement.get(...args) ?? null,
            all: async () => ({ results: statement.all(...args) }),
            run: async () => statement.run(...args),
          };
        },
      };
    },
    async batch(statements: any[]) {
      db.exec('BEGIN');
      try {
        const r = [];
        for (const s of statements) r.push(await s.run());
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const store = new Store(adapter),
    service = new AgentService(store, '11'.repeat(32)),
    now = Date.now();
  const snapshot = {
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
  const mandate = {
    symbol: 'BTCUSDT',
    goal: 'Manage existing exposure',
    maxNotional: 7500,
    minRetainedPct: 25,
    baselineQuantity: 0.2,
    maxOpenLoss: 500,
    takeProfit: 1000,
    profitTrimPct: 25,
    deadline: now + 86400000,
    fundingBudget: 10,
    maxSlippageBps: 10,
  };
  const body = {
    snapshot,
    assessment: assess(mandate, snapshot),
    terms: orderTerms(snapshot, 0.05, 10),
  };
  await store.run(
    "INSERT INTO mandates(id,owner,symbol,body,status,version,created_at) VALUES('m','u','BTCUSDT',?,'active',1,?)",
    JSON.stringify(mandate),
    now,
  );
  await store.run(
    "INSERT INTO proposals(id,owner,mandate_id,mandate_version,body,status,created_at,client_id) VALUES('p','u','m',1,?,'pending',?,'client-unique')",
    JSON.stringify(body),
    now,
  );
  let sent = 0,
    qty = 0.2;
  let unknown = false,
    mismatch = false;
  const exchange: any = {
    credentials: { environment: 'demo' },
    snapshot: async () => ({
      ...snapshot,
      quantity: qty,
      observedAt: Date.now(),
    }),
    openOrders: async () => [],
    submit: async () => {
      sent++;
      qty = 0.15;
      if (unknown) throw new Error('transport timed out');
    },
    query: async () => ({
      orderId: 123,
      status: 'FILLED',
      executedQty: '0.05',
      avgPrice: '50000',
      symbol: 'BTCUSDT',
      side: 'SELL',
      clientOrderId: 'client-unique',
      origQty: '0.050',
      price: '49950.0',
      reduceOnly: true,
    }),
    trades: async () => [{ orderId: 123, qty: '0.05', commission: '1.25' }],
  };
  service.exchange = async () => exchange;
  return {
    service,
    store,
    exchange,
    get sent() {
      return sent;
    },
    set unknown(v: boolean) {
      unknown = v;
    },
    set qty(v: number) {
      qty = v;
    },
  };
}
test('successful order verifies an independent order read and remaining position', async () => {
  const f = await setup();
  const r = await f.service.approve('u', 'p', 'SELL 0.050 BTCUSDT');
  assert.equal(r.status, 'verified');
  assert.equal(r.receipt.positionMatched, true);
  assert.equal(f.sent, 1);
  assert.equal(await f.store.one('SELECT * FROM locks WHERE key=?', 'u'), null);
});
test('timeout reconciles the same order without a replacement submission', async () => {
  const f = await setup();
  f.unknown = true;
  const r = await f.service.approve('u', 'p', 'SELL 0.050 BTCUSDT');
  assert.equal(r.status, 'verified');
  assert.equal(f.sent, 1);
  await assert.rejects(() => f.service.approve('u', 'p', 'SELL 0.050 BTCUSDT'));
  assert.equal(f.sent, 1);
});
test('unknown exchange outcome retains the lock and blocks additional operations', async () => {
  const f = await setup();
  f.exchange.query = async () => {
    throw new Error('not found yet');
  };
  const r = await f.service.approve('u', 'p', 'SELL 0.050 BTCUSDT');
  assert.equal(r.status, 'unknown');
  await assert.rejects(() => f.service.disconnect('u'), /reconciliation/);
  assert.equal(f.sent, 1);
});
test('position mismatch cannot be presented as verified', async () => {
  const f = await setup();
  const originalQuery = f.exchange.query;
  f.exchange.query = async () => {
    f.qty = 0.12;
    return originalQuery();
  };
  const r = await f.service.approve('u', 'p', 'SELL 0.050 BTCUSDT');
  assert.equal(r.status, 'unknown');
  assert.equal(r.receipt.positionMatched, false);
});
test('changed mandate prevents approved order dispatch', async () => {
  const f = await setup();
  await f.store.run("UPDATE mandates SET version=2 WHERE id='m'");
  await assert.rejects(
    () => f.service.approve('u', 'p', 'SELL 0.050 BTCUSDT'),
    /Mandate changed/,
  );
  assert.equal(f.sent, 0);
});
test('concurrent approvals produce at most one submission', async () => {
  const f = await setup();
  await Promise.allSettled([
    f.service.approve('u', 'p', 'SELL 0.050 BTCUSDT'),
    f.service.approve('u', 'p', 'SELL 0.050 BTCUSDT'),
  ]);
  assert.equal(f.sent, 1);
});
test('rejection cannot race an already claimed approval', async () => {
  const f = await setup();
  await f.store.lock('u', 'p');
  await assert.rejects(() => f.service.reject('u', 'p'), /reconciliation/);
});

test('late reconciliation failure cannot overwrite a finalized order or leave unknown unlocked', async () => {
  const f = await setup();
  await f.store.run("UPDATE proposals SET status='executing' WHERE id='p'");
  await f.store.lock('u', 'p');
  f.qty = 0.15;
  let rejectSlow: any;
  let entered: any;
  const began = new Promise<void>((r) => (entered = r));
  const original = f.exchange.query;
  let calls = 0;
  f.exchange.query = async () => {
    calls++;
    if (calls === 1) return original();
    entered();
    return new Promise((_, reject) => {
      rejectSlow = reject;
    });
  };
  const fast = f.service.reconcile('u', 'p');
  const slow = f.service.reconcile('u', 'p');
  await began;
  await fast;
  rejectSlow(new Error('late timeout'));
  await slow;
  const p = await f.store.proposal('u', 'p');
  assert.equal(p.status, 'verified');
  assert.equal(await f.store.one('SELECT * FROM locks WHERE key=?', 'u'), null);
});
