export type Position = {
  symbol: string;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  unrealizedPnl: number;
  positionSide: string;
  observedAt: number;
  fundingRate: number;
  nextFundingTime: number;
  fundingIntervalHours: number;
  takerFeeRate: number;
  stepSize: number;
  tickSize: number;
  minQty: number;
  minNotional: number;
};
export type Mandate = {
  symbol: string;
  goal: string;
  maxNotional: number;
  minRetainedPct: number;
  baselineQuantity: number;
  maxOpenLoss: number;
  takeProfit: number;
  profitTrimPct: number;
  deadline: number;
  fundingBudget: number;
  maxSlippageBps: number;
};
export type Assessment = {
  action: 'hold' | 'reduce' | 'close' | 'review';
  reasons: string[];
  quantity: number;
  beforeNotional: number;
  afterNotional: number;
  holdFunding: number;
  afterFunding: number;
  estimatedCost: number;
  fundingSavings: number;
  settlements: number;
  priceScenarios: { movePct: number; holdPnl: number; adjustedPnl: number }[];
};
const finite = (v: unknown, name: string, min: number, max = 1e12): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw new Error(`${name} must be between ${min} and ${max}`);
  return v;
};
export function validateMandate(value: unknown): Mandate {
  const m = value as Mandate;
  if (!m || !/^([A-Z0-9]{2,20})USDT$/.test(m.symbol))
    throw new Error('Select a USDT perpetual position');
  if (
    typeof m.goal !== 'string' ||
    m.goal.trim().length < 3 ||
    m.goal.length > 500
  )
    throw new Error('Describe your goal in 3–500 characters');
  finite(m.maxNotional, 'Maximum notional', 1);
  finite(m.minRetainedPct, 'Retained exposure', 0, 100);
  finite(m.baselineQuantity, 'Baseline quantity', 0.00000001);
  finite(m.maxOpenLoss, 'Loss trigger', 0.01);
  finite(m.takeProfit, 'Profit trigger', 0.01);
  finite(m.profitTrimPct, 'Profit reduction', 1, 100);
  finite(m.deadline, 'Deadline', 1, 1e15);
  finite(m.fundingBudget, 'Funding budget', 0);
  finite(m.maxSlippageBps, 'Slippage', 1, 100);
  return { ...m, goal: m.goal.trim() };
}
export function assess(m: Mandate, p: Position, now = Date.now()): Assessment {
  validateMandate(m);
  if (p.positionSide !== 'BOTH')
    throw new Error('Only one-way positions are supported');
  if (p.symbol !== m.symbol)
    throw new Error('Position and mandate do not match');
  for (const [k, v] of Object.entries(p))
    if (typeof v === 'number' && !Number.isFinite(v))
      throw new Error(`Invalid position ${k}`);
  if (
    p.markPrice <= 0 ||
    p.stepSize <= 0 ||
    p.tickSize <= 0 ||
    p.fundingIntervalHours <= 0 ||
    p.takerFeeRate < 0
  )
    throw new Error('Incomplete exchange constraints');
  const qty = Math.abs(p.quantity),
    notional = qty * p.markPrice;
  const settlements =
    m.deadline >= p.nextFundingTime
      ? Math.floor(
          (m.deadline - p.nextFundingTime) / (p.fundingIntervalHours * 3600000),
        ) + 1
      : 0;
  const funding =
    notional * p.fundingRate * Math.sign(p.quantity) * settlements;
  const a: Assessment = {
    action: 'hold',
    reasons: [],
    quantity: 0,
    beforeNotional: notional,
    afterNotional: notional,
    holdFunding: funding,
    afterFunding: funding,
    estimatedCost: 0,
    fundingSavings: 0,
    settlements,
    priceScenarios: [],
  };
  let reduction = 0;
  if (qty === 0) {
    a.reasons.push('Position is closed. Monitoring can be paused.');
    return a;
  }
  if (p.unrealizedPnl <= -m.maxOpenLoss) {
    a.action = 'close';
    a.reasons.push(
      'Open loss reached your exit trigger. Exit triggers override the retention floor.',
    );
    reduction = qty;
  } else if (now >= m.deadline) {
    a.action = 'close';
    a.reasons.push(
      'Your holding deadline has arrived. Exit triggers override the retention floor.',
    );
    reduction = qty;
  } else {
    if (notional > m.maxNotional) {
      reduction = Math.max(reduction, qty - m.maxNotional / p.markPrice);
      a.reasons.push('Position exposure exceeds your notional ceiling.');
    }
    if (p.unrealizedPnl >= m.takeProfit) {
      reduction = Math.max(reduction, (qty * m.profitTrimPct) / 100);
      a.reasons.push(
        'Unrealized profit reached your review trigger. This trigger pauses after a verified trim until you revise the mandate.',
      );
    }
    if (funding > m.fundingBudget) {
      const fundingQty = qty * (1 - m.fundingBudget / funding);
      const savings = (funding * fundingQty) / qty;
      const cost =
        fundingQty * p.markPrice * (p.takerFeeRate + m.maxSlippageBps / 10000);
      if (cost >= savings && reduction === 0) {
        a.action = 'review';
        a.reasons.push(
          'Projected funding exceeds your budget, but reduction cost exceeds projected funding savings. Revise the budget or objective.',
        );
      } else {
        reduction = Math.max(reduction, fundingQty);
        a.reasons.push(
          'Projected funding exceeds the budget if the current rate persists. Future rates can change.',
        );
      }
    }
    const floor = (m.baselineQuantity * m.minRetainedPct) / 100;
    if (reduction > 0 && qty - reduction < floor - 1e-10) {
      a.action = 'review';
      a.reasons.push(
        'Required reduction conflicts with your minimum retained exposure. Revise the mandate.',
      );
      reduction = 0;
    }
  }
  if (reduction > 0) {
    // Round reduction up to meet the ceiling, capped by actual exchange quantity.
    reduction = Math.min(
      qty,
      Math.ceil((reduction - 1e-12) / p.stepSize) * p.stepSize,
    );
    if (
      a.action !== 'close' &&
      qty - reduction < (m.baselineQuantity * m.minRetainedPct) / 100 - 1e-10
    ) {
      a.action = 'review';
      a.reasons.push(
        'Exchange quantity rounding would breach retained exposure.',
      );
      reduction = 0;
    } else if (
      reduction < p.minQty ||
      reduction * p.markPrice < p.minNotional
    ) {
      a.action = 'review';
      a.reasons.push('The reduction is below the supported order minimum.');
      reduction = 0;
    } else a.action = reduction >= qty ? 'close' : 'reduce';
  }
  a.quantity = Number(reduction.toFixed(12));
  a.afterNotional = Number(((qty - a.quantity) * p.markPrice).toFixed(8));
  a.afterFunding = qty ? (funding * (qty - a.quantity)) / qty : 0;
  a.estimatedCost =
    a.quantity * p.markPrice * (p.takerFeeRate + m.maxSlippageBps / 10000);
  a.fundingSavings = funding - a.afterFunding;
  if (!a.reasons.length)
    a.reasons.push(
      'Position is within your mandate. Keep monitoring; no order is justified.',
    );
  a.priceScenarios = [-1, 0, 1].map((movePct) => ({
    movePct,
    holdPnl: ((notional * movePct) / 100) * Math.sign(p.quantity) - funding,
    adjustedPnl:
      ((a.afterNotional * movePct) / 100) * Math.sign(p.quantity) -
      a.afterFunding -
      a.estimatedCost,
  }));
  return a;
}
function decimals(step: number) {
  const [base, exponent = '0'] = step.toString().split('e');
  return Math.max(0, (base.split('.')[1]?.length ?? 0) - Number(exponent));
}
export function orderTerms(p: Position, quantity: number, slippageBps: number) {
  finite(quantity, 'Quantity', p.minQty, Math.abs(p.quantity));
  finite(slippageBps, 'Slippage', 1, 100);
  const qty = Math.floor((quantity + 1e-12) / p.stepSize) * p.stepSize;
  const side = p.quantity > 0 ? 'SELL' : 'BUY';
  const bound =
    p.markPrice * (1 + ((side === 'BUY' ? 1 : -1) * slippageBps) / 10000);
  const price =
    (side === 'BUY'
      ? Math.floor(bound / p.tickSize)
      : Math.ceil(bound / p.tickSize)) * p.tickSize;
  if (qty < p.minQty || qty * price < p.minNotional)
    throw new Error('Order below exchange minimum');
  return {
    symbol: p.symbol,
    side,
    type: 'LIMIT',
    timeInForce: 'IOC',
    reduceOnly: 'true',
    quantity: qty.toFixed(decimals(p.stepSize)),
    price: price.toFixed(decimals(p.tickSize)),
  };
}
export function approvalCheck(
  original: Position,
  fresh: Position,
  now: number,
  maxDriftBps: number,
) {
  if (now - original.observedAt > 60000 || now < original.observedAt)
    throw new Error('Proposal expired. Refresh before approving.');
  if (
    original.symbol !== fresh.symbol ||
    original.positionSide !== fresh.positionSide ||
    original.quantity !== fresh.quantity
  )
    throw new Error('Position quantity changed. Refresh proposal.');
  if (Math.abs(fresh.markPrice / original.markPrice - 1) * 10000 > maxDriftBps)
    throw new Error('Market price moved beyond your bound. Refresh proposal.');
}
