import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Binance } from '../lib/agent/binance.ts';
test('successful empty positionRisk response represents zero exposure after close', async () => {
  const b = new Binance();
  b.request = async (path: string) =>
    ({
      '/fapi/v3/positionRisk': [],
      '/fapi/v1/premiumIndex': {
        markPrice: '50000',
        lastFundingRate: '0.0001',
        nextFundingTime: Date.now() + 3600000,
      },
      '/fapi/v1/exchangeInfo': {
        symbols: [
          {
            symbol: 'BTCUSDT',
            contractType: 'PERPETUAL',
            status: 'TRADING',
            filters: [
              { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001' },
              { filterType: 'PRICE_FILTER', tickSize: '0.1' },
            ],
          },
        ],
      },
      '/fapi/v1/fundingInfo': [],
      '/fapi/v1/commissionRate': { takerCommissionRate: '0.0005' },
      '/fapi/v1/positionSide/dual': { dualSidePosition: false },
    })[path];
  const p = await b.snapshot('BTCUSDT');
  assert.equal(p.quantity, 0);
  assert.equal(p.unrealizedPnl, 0);
});
