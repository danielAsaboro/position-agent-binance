import { signature } from './crypto.ts';
import type { Position } from './domain.ts';
export type ExchangeEnvironment = 'demo' | 'live';
export type Credentials = {
  apiKey: string;
  secret: string;
  environment: ExchangeEnvironment;
};
const bases = {
  demo: 'https://demo-fapi.binance.com',
  live: 'https://fapi.binance.com',
};
export class ExchangeError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}
export class Binance {
  credentials?: Credentials;
  constructor(credentials?: Credentials) {
    this.credentials = credentials;
  }
  async request(
    path: string,
    params: Record<string, string | number> = {},
    signed = false,
    method = 'GET',
  ): Promise<any> {
    const base = bases[this.credentials?.environment ?? 'live'];
    const query = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    );
    const headers: Record<string, string> = {};
    if (signed) {
      if (!this.credentials) throw new Error('Connect Binance first');
      const clock = await fetch(`${base}/fapi/v1/time`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!clock.ok)
        throw new Error(`Exchange clock unavailable (${clock.status})`);
      const time = (await clock.json()) as { serverTime: number };
      query.set('timestamp', String(time.serverTime));
      query.set('recvWindow', '5000');
      query.set(
        'signature',
        await signature(this.credentials.secret, query.toString()),
      );
      headers['X-MBX-APIKEY'] = this.credentials.apiKey;
    }
    const response = await fetch(`${base}${path}?${query}`, {
      method,
      headers,
      signal: AbortSignal.timeout(12000),
    });
    let body: any;
    try {
      body = await response.json();
    } catch {
      throw new ExchangeError(
        response.status,
        'Exchange returned an unreadable response',
      );
    }
    if (!response.ok)
      throw new ExchangeError(
        Number(body.code ?? response.status),
        `Binance ${body.code ?? response.status}: ${String(body.msg ?? 'Request failed').slice(0, 200)}`,
      );
    return body;
  }
  async positions() {
    const data = await this.request('/fapi/v3/positionRisk', {}, true);
    if (!Array.isArray(data)) throw new Error('Invalid position response');
    return data.filter(
      (p: any) =>
        Number(p.positionAmt) !== 0 && /^[A-Z0-9]+USDT$/.test(p.symbol),
    );
  }
  async snapshot(symbol: string): Promise<Position> {
    if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) throw new Error('Invalid symbol');
    const [positions, mark, info, funding, fee, mode] = await Promise.all([
      this.request('/fapi/v3/positionRisk', { symbol }, true),
      this.request('/fapi/v1/premiumIndex', { symbol }),
      this.request('/fapi/v1/exchangeInfo'),
      this.request('/fapi/v1/fundingInfo'),
      this.request('/fapi/v1/commissionRate', { symbol }, true),
      this.request('/fapi/v1/positionSide/dual', {}, true),
    ]);
    if (mode.dualSidePosition)
      throw new Error(
        'Hedge mode is not supported. Use an existing one-way account.',
      );
    const p = positions.find(
      (x: any) => x.symbol === symbol && x.positionSide === 'BOTH',
    );
    if (!p) throw new Error('Position is no longer available');
    const s = info.symbols.find(
      (x: any) =>
        x.symbol === symbol &&
        x.contractType === 'PERPETUAL' &&
        x.status === 'TRADING',
    );
    if (!s) throw new Error('This contract is not a trading USDT perpetual');
    const lot = s.filters.find((x: any) => x.filterType === 'LOT_SIZE'),
      tick = s.filters.find((x: any) => x.filterType === 'PRICE_FILTER'),
      min = s.filters.find((x: any) => x.filterType === 'MIN_NOTIONAL');
    return {
      symbol,
      quantity: Number(p.positionAmt),
      entryPrice: Number(p.entryPrice),
      markPrice: Number(mark.markPrice),
      liquidationPrice: Number(p.liquidationPrice),
      unrealizedPnl: Number(p.unRealizedProfit),
      positionSide: p.positionSide,
      observedAt: Date.now(),
      fundingRate: Number(mark.lastFundingRate),
      nextFundingTime: Number(mark.nextFundingTime),
      fundingIntervalHours: Number(
        funding.find((x: any) => x.symbol === symbol)?.fundingIntervalHours ??
          8,
      ),
      takerFeeRate: Number(fee.takerCommissionRate),
      stepSize: Number(lot.stepSize),
      tickSize: Number(tick.tickSize),
      minQty: Number(lot.minQty),
      minNotional: Number(min?.notional ?? 5),
    };
  }
  async openOrders(symbol: string) {
    const [standard, algorithmic] = await Promise.all([
      this.request('/fapi/v1/openOrders', { symbol }, true),
      this.request('/fapi/v1/openAlgoOrders', {}, true),
    ]);
    if (!Array.isArray(standard) || !Array.isArray(algorithmic))
      throw new Error('Could not verify existing orders');
    return [
      ...standard,
      ...algorithmic.filter((order: any) => order.symbol === symbol),
    ];
  }
  async submit(terms: Record<string, string>, clientId: string) {
    return this.request(
      '/fapi/v1/order',
      { ...terms, newClientOrderId: clientId, newOrderRespType: 'RESULT' },
      true,
      'POST',
    );
  }
  async query(symbol: string, clientId: string) {
    return this.request(
      '/fapi/v1/order',
      { symbol, origClientOrderId: clientId },
      true,
    );
  }
  async trades(symbol: string, orderId: string) {
    return this.request('/fapi/v1/userTrades', { symbol, orderId }, true);
  }
  async market(symbol = 'BTCUSDT') {
    const [mark, candles, ticker] = await Promise.all([
      this.request('/fapi/v1/premiumIndex', { symbol }),
      this.request('/fapi/v1/klines', { symbol, interval: '1h', limit: 48 }),
      this.request('/fapi/v1/ticker/24hr', { symbol }),
    ]);
    return {
      symbol,
      markPrice: Number(mark.markPrice),
      fundingRate: Number(mark.lastFundingRate),
      nextFundingTime: Number(mark.nextFundingTime),
      changePct: Number(ticker.priceChangePercent),
      observedAt: Date.now(),
      candles: candles.map((c: any[]) => ({ time: c[0], close: Number(c[4]) })),
      source: bases.live,
    };
  }
}
