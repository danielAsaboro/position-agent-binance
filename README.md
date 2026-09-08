# Position Agent

A persistent position-management workflow for Binance Agent OS clients. Connect an existing Binance USD-M **one-way USDT perpetual** position, define a mandate, compare proposed adjustments, approve an exact order, and reconcile the exchange result.

Unlike a signal bot, Position Agent begins after the user opens a position. It manages that position against a persistent goal spanning exposure, retained size, loss, profit, funding, slippage, and a holding deadline. The agent can propose hold, reduce, close, or review; only the user can approve an exchange order.

## Run locally

Requires Node 24 or newer.

```sh
npm ci
# Create .dev.vars with CREDENTIAL_ENCRYPTION_KEY set to 32 random bytes as 64 hex characters.
npm run build
npx wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_round_gabe_jones.sql
npm run dev
```

Open the Local URL and use **Sign in** for the starter's local development identity. Hosted identity is provided by the private Sites sign-in boundary; never expose the bare development server publicly.

Connect demo credentials through **Connect Binance**. The app verifies a real account read before saving the encrypted credentials. No sample position or simulated order is included. Create the initial position directly in Binance Demo Trading. Demo and live credentials are separate.

## Management rules

- Mandates specify a notional ceiling, initial-size retention floor, open-loss exit trigger, profit trim trigger, deadline, projected funding budget and price bound.
- Loss/deadline exits override the retention floor. These are approval-triggering conditions, not guaranteed stop losses.
- Funding uses mark notional, signed rates and the contract's settlement interval. Projection assumes the current rate persists. The budget covers projected remaining funding, not a cumulative realized expense cap.
- Reductions use LIMIT / IOC / reduceOnly. An unfilled or partial order is explicit; there is no automatic replacement.
- Every proposal expires after 60 seconds and is revalidated against a fresh snapshot. Existing standard and algorithmic orders block submission. Review them in Binance; this app does not cancel protective orders.
- The order client ID is persisted before dispatch. A timeout is queried using that same ID; it is never blindly retried. A discrepancy retains the account lock.
- A verified profit trim pauses monitoring so the user can revise the profit mandate before another trim.
- No opening positions, leverage changes, transfers or withdrawals.

## Agent OS / MCP

The browser registers two WebMCP tools in supported clients:

- `read_position_desk` reads the connected environment, mandates, observations, proposals, and receipts.
- `assess_managed_position` observes one saved mandate and stages a decision or proposal. It cannot approve or execute an order.

Configure your supported MCP client to run `node /absolute/path/to/scripts/mcp-bridge.mjs` with `POSITION_AGENT_URL` and `POSITION_AGENT_TOKEN`. Generate the token in the app's **Agent OS** dialog. See `skills/position-agent/SKILL.md` for the operating workflow.

The bridge provides `list_position_mandates`, `assess_position`, `reconcile_position_order`, and `monitor_positions`. It exposes no approval tool; tokens are denied access to order approval and account modifications server-side. AI reasoning runs in your connected MCP client. The app's calculations and execution constraints are deterministic.

The private hosted app requires platform sign-in. Its machine-to-machine ingress has not been verified. Use the local authenticated endpoint for MCP/monitor until a supported hosted machine-access path is configured; do not disable authentication to make it work.

## Monitoring

The dashboard checks active mandates every minute while open. For off-page monitoring, run:

```sh
POSITION_AGENT_URL=http://localhost:3000 POSITION_AGENT_TOKEN='<personal token>' npm run monitor
```

Keep that process and the app server running. `node scripts/monitor.mjs --once` performs a single cycle. The UI reports actual monitor heartbeat time. The private Sites deployment does **not** provision an always-on scheduler. Do not claim unattended monitoring without an active runner and fresh heartbeat.

## Deployment

The application is a Cloudflare-compatible Worker with D1 migrations. `.openai/hosting.json` binds the private Sites project and database. Configure `CREDENTIAL_ENCRYPTION_KEY` as a hosted secret before deployment. Preserve the key across releases; changing it makes existing saved credentials unreadable.

For an independent Cloudflare deployment, configure your own D1 binding and a scheduled runner to POST the monitor endpoint using an agent token through an authenticated ingress. Never expose trusted identity headers directly to the internet.

## Verification

The repository test suite covers constraints, signed funding, quantity precision, credential encryption, owner isolation, execution locking, concurrent approvals, timeout reconciliation, and receipt matching. Exchange behavior in unit tests uses test doubles.

A separate authenticated Binance Demo run proved the vertical slice against the exchange: Position Agent observed a 0.002 BTCUSDT long, proposed a 0.0008 BTC reduce-only IOC adjustment for a 100 USDT exposure ceiling, received exact human approval, verified the fill, reconciled the remaining 0.0012 BTC position, and returned hold on the next assessment. The private submission workspace retains the exchange receipt; credentials and personal tokens are never committed.

The supported in-app browser also registered and invoked the WebMCP position-desk tool against that authenticated state. A retained off-page runner and hosted Binance connectivity remain separate deployment checks; the current private Sites runtime receives HTTP 403 from Binance and must not be presented as a working hosted exchange connection.

## Safety boundary

- The agent cannot open positions, increase leverage, transfer assets, or withdraw.
- Agent tokens cannot approve orders or change account settings.
- Every proposal expires after 60 seconds and is revalidated against fresh position and price data.
- Submission is idempotent: the client order ID is persisted before dispatch, and timeouts are reconciled instead of retried.
- Standard or algorithmic open orders block execution so protective orders are never silently displaced.
