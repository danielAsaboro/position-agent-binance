'use client';
import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  Settings2,
  Plus,
  RefreshCw,
  Link2,
  Pause,
  Play,
  Check,
  Clock3,
  ChevronRight,
  ExternalLink,
  Terminal,
  Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
const money = (n: number | undefined) =>
  n === undefined
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
      }).format(n);
const pct = (n: number | undefined) =>
  n === undefined ? '—' : `${(n * 100).toFixed(4)}%`;
const readableError = (message: string) => {
  if (message.includes('Exchange clock unavailable (403)'))
    return 'This hosted runtime cannot reach Binance (HTTP 403). Use the local app for authenticated demo trading.';
  if (
    message.includes('internal error; reference') ||
    message.includes('Exchange returned an unreadable response')
  )
    return 'Binance is temporarily unreachable. Saved mandates and verified receipts remain available.';
  return message;
};
async function api(path: string, body?: unknown) {
  const r = await fetch(`/api/agent/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d: any = await r.json();
  if (!r.ok) throw new Error(readableError(d.error ?? 'Request failed'));
  return d;
}
export default function Dashboard() {
  const [market, setMarket] = useState<any>(null),
    [state, setState] = useState<any>({
      mandates: [],
      proposals: [],
      events: [],
      connection: null,
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(''),
    [positions, setPositions] = useState<any[]>([]),
    [selected, setSelected] = useState(''),
    [proposal, setProposal] = useState<any>(null),
    [token, setToken] = useState(''),
    [needsSignIn, setNeedsSignIn] = useState(false),
    [webMcpReady, setWebMcpReady] = useState(false);
  const active =
    state.mandates.find((m: any) => m.id === selected) ?? state.mandates[0];
  const verifiedProposal = state.proposals.find(
    (p: any) =>
      p.mandate_id === active?.id && p.status === 'verified' && p.receipt,
  );
  const refresh = async () => {
    try {
      setState(await api('state'));
    } catch (e: any) {
      if (e.message.includes('Sign in')) setNeedsSignIn(true);
      else setError(e.message);
    }
  };
  useEffect(() => {
    api('market')
      .then(setMarket)
      .catch((e) => setError(e.message));
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!state.connection) return;
    const tick = () =>
      api('monitor', {})
        .then(refresh)
        .catch((e) => setError(e.message));
    tick();
    const timer = setInterval(tick, 60000);
    return () => clearInterval(timer);
  }, [!!state.connection]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function newMandate() {
    await run(async () => {
      const result = await api('positions');
      setPositions(result);
      setModal('mandate');
    });
  }
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async (tool: any) => {
      try {
        await context.registerTool(tool, { signal: lifecycle.signal });
        return true;
      } catch {
        return false;
      }
    };
    const readTool = register({
      name: 'read_position_desk',
      description:
        'Read saved mandates, observed positions, and proposal outcomes.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async () => await api('state'),
    });
    const assessTool = register({
      name: 'assess_managed_position',
      description:
        'Assess an existing mandate and stage a proposal. Does not approve or execute an order.',
      inputSchema: {
        type: 'object',
        properties: { mandateId: { type: 'string' } },
        required: ['mandateId'],
        additionalProperties: false,
      },
      execute: async (input: any) => {
        if (
          typeof input?.mandateId !== 'string' ||
          !/^[a-f0-9-]{36}$/.test(input.mandateId)
        )
          throw new Error('Valid mandate ID required');
        const result = await api(`mandates/${input.mandateId}/assess`, {});
        await refresh();
        return result;
      },
    });
    void Promise.all([readTool, assessTool]).then((results) =>
      setWebMcpReady(results.every(Boolean)),
    );
    return () => lifecycle.abort();
  }, []);
  const line = market?.candles ?? [];
  const prices = line.map((c: any) => c.close);
  const low = Math.min(...prices),
    high = Math.max(...prices);
  const points = prices
    .map(
      (v: number, i: number) =>
        `${(i / (prices.length - 1)) * 800},${150 - ((v - low) / (high - low || 1)) * 120}`,
    )
    .join(' ');
  return (
    <div className="workspace">
      <aside className="rail">
        <a className="brand" href="/" aria-label="Position Agent home">
          <span className="brandmark">
            <Activity size={23} />
          </span>
          <span>
            position<span className="brand-light">/agent</span>
          </span>
        </a>
        <div className="rail-label">WORKSPACE</div>
        <div className="nav-active">
          <Target size={18} /> Position desk{' '}
          <span className="nav-count">{state.mandates.length}</span>
        </div>
        <button className="rail-link" onClick={() => setModal('connection')}>
          <Link2 size={18} /> Exchange connection
        </button>
        <button className="rail-link" onClick={() => setModal('agent')}>
          <Terminal size={18} /> Agent OS
        </button>
        <div className="rail-bottom">
          <div className="small-label">EXECUTION POLICY</div>
          <p>
            <ShieldCheck size={16} /> You approve every order
          </p>
          <span>Existing positions · reduce only</span>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} /> Position desk
          </div>
          <div className="header-right">
            {needsSignIn && (
              <a href="/signin-with-chatgpt?return_to=/" target="_top">
                Sign in
              </a>
            )}
            <span
              className={`status-dot ${state.connection ? 'connected' : ''}`}
            />
            {state.connection
              ? `${state.connection.environment.toUpperCase()} connected`
              : 'Exchange disconnected'}
            <button
              className="header-agent-button"
              onClick={() => setModal('agent')}
            >
              <Terminal size={15} /> Agent OS
            </button>
            <button
              className="icon-button"
              aria-label="Connection settings"
              onClick={() => setModal('connection')}
            >
              <Settings2 size={18} />
            </button>
          </div>
        </header>
        <section className="page-heading">
          <div>
            <div className="eyebrow">GOAL-BASED FUTURES EXECUTION</div>
            <h1>
              {active
                ? 'The agent is managing the trade'
                : 'Bring the position. Set the mandate'}
              <span className="heading-dot">.</span>
            </h1>
            <p>
              {active
                ? 'It watches the live position, proposes bounded trades and verifies every approved fill on Binance.'
                : 'Open a futures position in Binance Demo, then let the agent reduce or close it as your limits change.'}
            </p>
          </div>
          <Button
            className="primary-button"
            onClick={
              state.connection ? newMandate : () => setModal('connection')
            }
          >
            <Plus size={17} />
            {state.connection
              ? active
                ? 'Manage another position'
                : 'Import open position'
              : 'Connect Binance Demo'}
          </Button>
        </section>
        <section
          className="trading-contract"
          aria-label="How Position Agent trades"
        >
          <div>
            <span className="contract-number">01</span>
            <strong>You open the position</strong>
            <small>Directly in Binance Demo</small>
          </div>
          <ChevronRight size={16} />
          <div>
            <span className="contract-number">02</span>
            <strong>The agent proposes a trade</strong>
            <small>Hold, reduce or close</small>
          </div>
          <ChevronRight size={16} />
          <div>
            <span className="contract-number">03</span>
            <strong>You approve exact terms</strong>
            <small>Symbol, side, size and price</small>
          </div>
          <ChevronRight size={16} />
          <div>
            <span className="contract-number">04</span>
            <strong>Binance proves the fill</strong>
            <small>Order, trades and remaining position</small>
          </div>
        </section>
        <button
          className={`agent-runtime ${webMcpReady ? 'is-live' : ''}`}
          onClick={() => setModal('agent')}
          type="button"
        >
          <Terminal size={16} />
          <span>
            <strong>
              {webMcpReady ? 'Agent OS tools connected' : 'Connect Agent OS'}
            </strong>
            <small>
              {webMcpReady
                ? 'Read the desk and assess mandates through WebMCP'
                : 'Use the scoped MCP bridge to observe and propose'}
            </small>
          </span>
          <span className="agent-runtime-status">
            {webMcpReady ? '2 TOOLS LIVE' : 'SET UP'}
          </span>
        </button>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => setError('')} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        <section className="market-strip">
          <div className="market-identity">
            <span className="coin">₿</span>
            <div>
              <strong>
                BTC <span>/ USDT</span>
              </strong>
              <small>PERPETUAL · BINANCE PUBLIC DATA</small>
            </div>
          </div>
          <div>
            <span className="small-label">MARK PRICE</span>
            <strong className="numeric">{money(market?.markPrice)}</strong>
          </div>
          <div>
            <span className="small-label">24H CHANGE</span>
            <strong className={market?.changePct < 0 ? 'negative' : 'positive'}>
              {market
                ? `${market.changePct > 0 ? '+' : ''}${market.changePct.toFixed(2)}%`
                : '—'}
            </strong>
          </div>
          <div>
            <span className="small-label">FUNDING RATE</span>
            <strong className="numeric">{pct(market?.fundingRate)}</strong>
          </div>
          <div>
            <span className="small-label">NEXT FUNDING</span>
            <strong>
              {market
                ? new Date(market.nextFundingTime).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '—'}
            </strong>
          </div>
          <button
            className="icon-button"
            aria-label="Refresh market"
            disabled={busy}
            onClick={() => run(async () => setMarket(await api('market')))}
          >
            <RefreshCw size={17} />
          </button>
        </section>
        <div className="desk-grid">
          <section className="main-panel">
            <div className="panel-heading">
              <div>
                <span className="small-label">
                  {active ? 'LIVE FUTURES POSITION' : 'POSITION MONITOR'}
                </span>
                <h2>{active ? active.symbol : 'Your next move starts here'}</h2>
              </div>
              <span className={`pill ${active ? 'trading-pill' : ''}`}>
                {active ? `Agent ${active.status}` : 'Awaiting position'}
              </span>
            </div>
            {active ? (
              <>
                <div className="position-stats">
                  <div>
                    <span>Current exposure</span>
                    <strong>
                      {money(
                        active.snapshot
                          ? Math.abs(active.snapshot.quantity) *
                              active.snapshot.markPrice
                          : undefined,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Open P&L</span>
                    <strong
                      className={
                        (active.snapshot?.unrealizedPnl ?? 0) < 0
                          ? 'negative'
                          : 'positive'
                      }
                    >
                      {money(active.snapshot?.unrealizedPnl)}
                    </strong>
                  </div>
                  <div>
                    <span>Direction</span>
                    <strong>
                      {active.snapshot?.quantity > 0
                        ? 'Long'
                        : active.snapshot?.quantity < 0
                          ? 'Short'
                          : 'Closed'}
                    </strong>
                  </div>
                </div>
                <div className="mandate-selector">
                  {state.mandates.map((m: any) => (
                    <button
                      key={m.id}
                      className={active.id === m.id ? 'selected' : ''}
                      onClick={() => setSelected(m.id)}
                    >
                      {m.symbol}
                      <span>{m.status}</span>
                    </button>
                  ))}
                </div>
                {verifiedProposal && (
                  <div className="execution-proof">
                    <span className="proof-icon">
                      <Check size={16} />
                    </span>
                    <div>
                      <small>LATEST AGENT TRADE · BINANCE DEMO</small>
                      <strong>
                        {verifiedProposal.body.terms.side}{' '}
                        {verifiedProposal.receipt.executedQuantity}{' '}
                        {verifiedProposal.body.terms.symbol} filled at{' '}
                        {money(verifiedProposal.receipt.averagePrice)}
                      </strong>
                      <span>
                        Exchange order {verifiedProposal.receipt.orderId} ·
                        remaining position verified
                      </span>
                    </div>
                    <span className="verified-label">VERIFIED</span>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-intro">
                <div className="empty-icon">
                  <Target size={30} />
                </div>
                <h3>
                  A position. A goal.
                  <br />A plan that stays with it.
                </h3>
                <p>
                  This agent starts after you open a Binance futures position.
                  It can place reduce-only trades to keep that position inside
                  your exposure, loss, profit, funding and deadline limits.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setModal('connection')}
                >
                  Connect Binance Demo <ArrowUpRight size={16} />
                </Button>
              </div>
            )}
            <div className="chart-wrap">
              <div className="chart-heading">
                <span>BTCUSDT · Last 48 hours</span>
                <span>
                  {market ? 'Hourly closes' : 'Loading public market data'}
                </span>
              </div>
              {line.length > 0 ? (
                <svg
                  viewBox="0 0 800 180"
                  role="img"
                  aria-label="Bitcoin hourly closing prices over the past 48 hours"
                >
                  <defs>
                    <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f0c94c" stopOpacity=".2" />
                      <stop offset="100%" stopColor="#f0c94c" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[30, 90, 150].map((y) => (
                    <line
                      key={y}
                      x1="0"
                      x2="800"
                      y1={y}
                      y2={y}
                      stroke="#2a2d33"
                      strokeDasharray="3 5"
                    />
                  ))}
                  <polygon
                    points={`0,180 ${points} 800,180`}
                    fill="url(#chart-fill)"
                  />
                  <polyline
                    points={points}
                    fill="none"
                    stroke="#e9c448"
                    strokeWidth="2"
                  />
                </svg>
              ) : (
                <div className="no-chart">
                  Public prices will appear when Binance responds.
                </div>
              )}
              <div className="chart-footer">
                <span>
                  {market ? new Date(line[0]?.time).toLocaleDateString() : ''}
                </span>
                <span>
                  {market
                    ? `Updated ${new Date(market.observedAt).toLocaleTimeString()}`
                    : ''}
                </span>
              </div>
            </div>
            <div className="workflow-strip">
              {[
                'Live position',
                'Agent decision',
                'Exact approval',
                'Verified fill',
              ].map((s, i) => (
                <div key={s}>
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  {s}
                  {i < 3 && <ChevronRight size={14} />}
                </div>
              ))}
            </div>
          </section>
          <aside className="mandate-panel">
            <div className="panel-heading">
              <h2>Management mandate</h2>
              <ShieldCheck size={18} />
            </div>
            {active ? (
              <>
                <p className="goal-text">“{active.body.goal}”</p>
                <div className="constraint">
                  <span>Exposure ceiling</span>
                  <strong>{money(active.body.maxNotional)}</strong>
                </div>
                <div className="constraint">
                  <span>Retain at least</span>
                  <strong>{active.body.minRetainedPct}% of initial size</strong>
                </div>
                <div className="constraint">
                  <span>Open loss exit trigger</span>
                  <strong>{money(active.body.maxOpenLoss)}</strong>
                </div>
                <div className="constraint">
                  <span>Profit review trigger</span>
                  <strong>{money(active.body.takeProfit)}</strong>
                </div>
                <div className="constraint">
                  <span>Projected funding budget</span>
                  <strong>{money(active.body.fundingBudget)}</strong>
                </div>
                <div className="constraint">
                  <span>Holding deadline</span>
                  <strong>
                    {new Date(active.body.deadline).toLocaleString()}
                  </strong>
                </div>
                <div className="monitor-note">
                  <Clock3 size={16} />
                  <span>
                    {active.last_check
                      ? `Last checked ${new Date(active.last_check).toLocaleTimeString()}`
                      : 'Not checked yet'}
                    <br />
                    {state.connection?.monitor_at &&
                    Date.now() - state.connection.monitor_at < 90000
                      ? 'Monitor heartbeat current'
                      : 'Monitor heartbeat unavailable'}
                    <br />
                    This tab checks every minute while open. Off-page checks
                    require the monitor runner.
                    {active.last_error && (
                      <b>{readableError(active.last_error)}</b>
                    )}
                  </span>
                </div>
                <Button
                  disabled={busy}
                  className="primary-button full"
                  onClick={() =>
                    run(async () => {
                      const p = await api(`mandates/${active.id}/assess`, {});
                      if (p.proposal) {
                        setProposal(p.proposal);
                        setModal('proposal');
                      }
                    })
                  }
                >
                  <RefreshCw size={16} /> Assess now
                </Button>
                <div className="button-row">
                  <Button variant="outline" onClick={() => setModal('edit')}>
                    Edit mandate
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      run(async () => {
                        await api(`mandates/${active.id}/status`, {
                          status:
                            active.status === 'active' ? 'paused' : 'active',
                        });
                      })
                    }
                  >
                    {active.status === 'active' ? (
                      <Pause size={15} />
                    ) : (
                      <Play size={15} />
                    )}{' '}
                    {active.status === 'active' ? 'Pause' : 'Resume'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="muted">The limits that guide every decision.</p>
                {[
                  [
                    '01',
                    'Define the goal',
                    'Exposure, loss and profit triggers, time horizon.',
                  ],
                  [
                    '02',
                    'Compare the choices',
                    'Retained exposure, execution costs and funding.',
                  ],
                  [
                    '03',
                    'Stay in control',
                    'Review the exact order before it can execute.',
                  ],
                ].map(([n, t, d]) => (
                  <div className="mandate-step" key={n}>
                    <span>{n}</span>
                    <div>
                      <h3>{t}</h3>
                      <p>{d}</p>
                    </div>
                  </div>
                ))}
                <div className="callout">
                  <ShieldCheck size={18} />
                  <p>
                    The agent never opens exposure or increases leverage. It
                    only sends approved reduce-only orders against a position
                    you already opened in Binance.
                  </p>
                </div>
              </>
            )}
          </aside>
        </div>
        <section className="activity-panel">
          <Tabs defaultValue="decisions" className="activity-tabs">
            <TabsList>
              <TabsTrigger value="decisions">Decisions & proposals</TabsTrigger>
              <TabsTrigger value="activity">Activity & receipts</TabsTrigger>
            </TabsList>
            <TabsContent value="decisions">
              {active?.assessment && (
                <div className="assessment-summary">
                  <span className="pill">{active.assessment.action}</span>
                  <p>{active.assessment.reasons.join(' ')}</p>
                </div>
              )}
              {state.proposals.length ? (
                state.proposals.map((p: any) => (
                  <button
                    className="activity-row"
                    key={p.id}
                    onClick={() => {
                      setProposal(p);
                      setModal('proposal');
                    }}
                  >
                    <span className="event-icon">
                      <ArrowDownRight size={18} />
                    </span>
                    <div>
                      <strong>
                        {p.body.snapshot.symbol} · {p.body.assessment.action}
                      </strong>
                      <small>{p.body.assessment.reasons[0]}</small>
                    </div>
                    <span className="pill">{p.status}</span>
                    <ChevronRight size={16} />
                  </button>
                ))
              ) : (
                <div className="empty-activity">
                  <Activity size={22} />
                  <div>
                    <strong>No adjustments proposed</strong>
                    <p>
                      Decisions appear here when a managed position is assessed.
                    </p>
                  </div>
                </div>
              )}
            </TabsContent>
            <TabsContent value="activity">
              {state.events.length ? (
                state.events.map((e: any) => (
                  <div className="activity-row" key={e.id}>
                    <span className="event-icon">
                      <Check size={16} />
                    </span>
                    <div>
                      <strong>{e.message}</strong>
                      <small>
                        {new Date(e.created_at).toLocaleString()} · {e.kind}
                      </small>
                      {e.details && (
                        <details>
                          <summary>View receipt</summary>
                          <pre>{JSON.stringify(e.details, null, 2)}</pre>
                        </details>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-activity">
                  <Clock3 size={22} />
                  <p>
                    Your connection, mandate changes and execution receipts will
                    appear here.
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </section>
        <footer>
          <span>
            Position Agent <span className="footer-sep">/</span> Binance Agent
            OS
          </span>
          <span>
            Funding projections assume an unchanged rate. Exit triggers are not
            guaranteed loss limits.
          </span>
        </footer>
      </main>
      <Dialog
        open={!!modal}
        onOpenChange={(open) => {
          if (!open) setModal('');
        }}
      >
        <DialogContent className="agent-dialog">
          <DialogTitle>
            {modal === 'connection'
              ? 'Connect Binance'
              : modal === 'agent'
                ? 'Connect your Agent OS client'
                : modal === 'proposal'
                  ? 'Review adjustment'
                  : modal === 'edit'
                    ? 'Revise your mandate'
                    : 'Manage an existing position'}
          </DialogTitle>
          <DialogDescription>
            {modal === 'connection'
              ? 'Credentials are encrypted on the server. Use the matching Binance environment.'
              : modal === 'proposal'
                ? 'Approval applies only to this exact order and expires after 60 seconds.'
                : modal === 'agent'
                  ? 'Your AI client can observe and propose. Exchange orders require your approval here.'
                  : 'Set explicit limits for ongoing position management.'}
          </DialogDescription>
          {modal === 'connection' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(async () => {
                  await api('connection', {
                    apiKey: f.get('apiKey'),
                    secret: f.get('secret'),
                    environment: f.get('environment'),
                    eligible: f.get('eligible') === 'on',
                  });
                  setModal('');
                });
              }}
            >
              <label>
                Environment
                <select name="environment" defaultValue="demo">
                  <option value="demo">Binance Demo Trading</option>
                  <option value="live">Binance Live</option>
                </select>
              </label>
              <label>
                API key
                <input
                  name="apiKey"
                  type="password"
                  required
                  autoComplete="off"
                />
              </label>
              <label>
                API secret
                <input
                  name="secret"
                  type="password"
                  required
                  autoComplete="off"
                />
              </label>
              <label className="checkbox-label">
                <input name="eligible" type="checkbox" required /> I can legally
                use this Binance environment and authorize this app to read my
                positions.
              </label>
              <p className="muted">
                Use a dedicated API key without withdrawal permission.
                Connecting does not authorize an order.
              </p>
              <Button
                className="primary-button full"
                disabled={busy}
                type="submit"
              >
                {busy ? 'Verifying connection…' : 'Verify & connect'}
              </Button>
              {state.connection && (
                <Button
                  className="full mt-3"
                  variant="destructive"
                  type="button"
                  onClick={() =>
                    run(async () => {
                      await api('disconnect', {});
                      setModal('');
                    })
                  }
                >
                  Disconnect & pause mandates
                </Button>
              )}
            </form>
          )}
          {(modal === 'mandate' || modal === 'edit') && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const body: any = Object.fromEntries(f);
                for (const key of [
                  'maxNotional',
                  'minRetainedPct',
                  'maxOpenLoss',
                  'takeProfit',
                  'profitTrimPct',
                  'fundingBudget',
                  'maxSlippageBps',
                ])
                  body[key] = Number(body[key]);
                body.deadline = new Date(String(f.get('deadline'))).getTime();
                run(async () => {
                  const result = await api(
                    modal === 'edit'
                      ? `mandates/${active.id}/edit`
                      : 'mandates',
                    body,
                  );
                  setSelected(result.id);
                  setModal('');
                });
              }}
            >
              <label>
                Position
                {modal === 'edit' ? (
                  <input name="symbol" value={active.symbol} readOnly />
                ) : (
                  <select name="symbol" required>
                    {positions.map((p: any) => (
                      <option key={p.symbol + p.positionSide} value={p.symbol}>
                        {p.symbol} ·{' '}
                        {Number(p.positionAmt) > 0 ? 'Long' : 'Short'} ·{' '}
                        {p.positionAmt}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              {!positions.length && modal === 'mandate' && (
                <p className="callout">
                  No open USDT positions found. Open a position directly in the
                  matching Binance environment first.
                </p>
              )}
              <label>
                Goal
                <textarea
                  name="goal"
                  required
                  maxLength={500}
                  defaultValue={modal === 'edit' ? active.body.goal : ''}
                  placeholder="Keep my BTC exposure within budget until tomorrow…"
                />
              </label>
              <div className="form-grid">
                {[
                  ['maxNotional', 'Maximum exposure (USDT)', 1000],
                  ['minRetainedPct', 'Retain initial size (%)', 25],
                  ['maxOpenLoss', 'Open loss exit trigger (USDT)', 100],
                  ['takeProfit', 'Profit review trigger (USDT)', 200],
                  ['profitTrimPct', 'Trim at profit trigger (%)', 25],
                  ['fundingBudget', 'Funding budget (USDT)', 10],
                  ['maxSlippageBps', 'Price bound (basis points)', 10],
                ].map(([name, label, initial]) => (
                  <label key={name}>
                    {label}
                    <input
                      name={String(name)}
                      type="number"
                      min={
                        name === 'fundingBudget' || name === 'minRetainedPct'
                          ? 0
                          : 0.01
                      }
                      step="any"
                      required
                      defaultValue={
                        modal === 'edit' ? active.body[name] : initial
                      }
                    />
                  </label>
                ))}
                <label>
                  Holding deadline
                  <input
                    type="datetime-local"
                    name="deadline"
                    required
                    defaultValue={new Date(
                      (modal === 'edit'
                        ? active.body.deadline
                        : Date.now() + 86400000) -
                        new Date().getTimezoneOffset() * 60000,
                    )
                      .toISOString()
                      .slice(0, 16)}
                  />
                </label>
              </div>
              <p className="muted">
                Loss and deadline exits override retained exposure. A verified
                profit trim pauses monitoring for a mandate review.
              </p>
              <Button
                type="submit"
                disabled={busy || (modal === 'mandate' && !positions.length)}
                className="primary-button full"
              >
                Save mandate
              </Button>
            </form>
          )}
          {modal === 'proposal' && proposal && (
            <>
              <div className="proposal-head">
                <h3>{proposal.body.snapshot.symbol}</h3>
                <span className="pill">{proposal.status}</span>
              </div>
              <p>{proposal.body.assessment.reasons.join(' ')}</p>
              <div className="comparison">
                <div>
                  <span>Keep position</span>
                  <strong>
                    {money(proposal.body.assessment.beforeNotional)}
                  </strong>
                  <small>
                    Projected funding{' '}
                    {money(proposal.body.assessment.holdFunding)}
                  </small>
                </div>
                <ArrowUpRight />
                <div>
                  <span>After adjustment</span>
                  <strong>
                    {money(proposal.body.assessment.afterNotional)}
                  </strong>
                  <small>
                    Estimated cost{' '}
                    {money(proposal.body.assessment.estimatedCost)}
                  </small>
                </div>
              </div>
              <div className="order-ticket">
                <span>EXACT ORDER</span>
                <strong>
                  {proposal.body.terms.side} {proposal.body.terms.quantity}{' '}
                  {proposal.body.snapshot.symbol}
                </strong>
                <p>
                  Limit {proposal.body.terms.price} · Immediate or cancel ·
                  Reduce only
                </p>
                <small>
                  Created {new Date(proposal.created_at).toLocaleTimeString()} ·
                  Partial fills are possible
                </small>
              </div>
              <div className="scenario-table">
                <div>
                  <strong>Price move</strong>
                  <strong>Hold*</strong>
                  <strong>Adjust*</strong>
                </div>
                {proposal.body.assessment.priceScenarios.map((s: any) => (
                  <div key={s.movePct}>
                    <span>
                      {s.movePct > 0 ? '+' : ''}
                      {s.movePct}%
                    </span>
                    <span>{money(s.holdPnl)}</span>
                    <span>{money(s.adjustedPnl)}</span>
                  </div>
                ))}
              </div>
              <p className="muted">
                *Illustrative future price change less projected funding and
                adjustment costs; excludes existing P&L and a later exit. These
                are scenarios, not forecasts.
              </p>
              {proposal.receipt && (
                <details>
                  <summary>Exchange receipt</summary>
                  <pre>{JSON.stringify(proposal.receipt, null, 2)}</pre>
                </details>
              )}
              {proposal.status === 'pending' ? (
                <div className="button-row">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api(`proposals/${proposal.id}/reject`, {});
                        setModal('');
                      })
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    disabled={busy || Date.now() - proposal.created_at > 60000}
                    className="primary-button"
                    onClick={() =>
                      run(async () => {
                        const r = await api(
                          `proposals/${proposal.id}/approve`,
                          {
                            confirmation: `${proposal.body.terms.side} ${proposal.body.terms.quantity} ${proposal.body.snapshot.symbol}`,
                          },
                        );
                        setProposal(r);
                      })
                    }
                  >
                    {Date.now() - proposal.created_at > 60000
                      ? 'Expired · assess again'
                      : busy
                        ? 'Verifying…'
                        : 'Approve exact order'}
                  </Button>
                </div>
              ) : ['executing', 'unknown'].includes(proposal.status) ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      setProposal(
                        await api(`proposals/${proposal.id}/reconcile`, {}),
                      );
                    })
                  }
                >
                  Reconcile with Binance
                </Button>
              ) : null}
            </>
          )}
          {modal === 'agent' && (
            <>
              <ol className="agent-steps">
                <li>Connect Binance and save a mandate here.</li>
                <li>Generate a personal agent token below.</li>
                <li>
                  Configure the local MCP bridge in your Agent OS client. It
                  calls this app’s authenticated API.
                </li>
              </ol>
              <Button
                disabled={busy || !state.connection}
                onClick={() =>
                  run(async () => setToken((await api('token', {})).token))
                }
              >
                Generate / rotate agent token
              </Button>
              {token && (
                <label>
                  Copy now — shown once
                  <input
                    value={token}
                    readOnly
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              )}
              <p className="muted">
                The token can read your positions and request assessments. It
                cannot approve or execute orders. Rotating it disconnects old
                clients.
              </p>
              <a href="/api/agent/guide" target="_blank" rel="noreferrer">
                Open integration guide <ExternalLink size={14} />
              </a>
            </>
          )}
          {error && (
            <p role="alert" className="negative">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
