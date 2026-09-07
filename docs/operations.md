# Operations

## Unknown order

Use Reconcile in the proposal dialog. The system queries the original client order ID and reads the position. It holds the account execution lock until a terminal order and matching position are observed. Do not clear an unknown order lock based solely on a timeout or a single order-not-found response. Inspect Binance order history directly if reconciliation remains unresolved.

## Interrupted operation before submission

A persistent lock may remain after a process stops before dispatch. Inspect the proposal and audit event. Only a pending proposal with no submission event and authoritative exchange confirmation of no order can be cleared by an operator. Never clear an executing/unknown lock without reconciling the exchange. Administrative repair is intentionally not exposed to an agent tool.

## Monitor stopped

The dashboard's heartbeat becomes stale after 90 seconds. Keep the browser open or run the monitor process against an authenticated app endpoint. Restarting the monitor does not re-submit previous orders; it reconciles them first.

## Hosting access

Keep the deployment owner-private for development. A public hackathon demo requires a deliberate access change and must not expose account details or credentials. A private deployment alone is not a public submission link.
