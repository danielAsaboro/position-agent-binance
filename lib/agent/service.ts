import { validateOrderReceipt } from './receipt.ts';
import { Binance } from './binance.ts';
import type { Credentials } from './binance.ts';
import {
  assess,
  validateMandate,
  orderTerms,
  approvalCheck,
} from './domain.ts';
import { seal, unseal, digest } from './crypto.ts';
import { Store } from './store.ts';
export class AgentService {
  store: Store;
  key: string;
  constructor(store: Store, key: string) {
    this.store = store;
    this.key = key;
  }
  async exchange(owner: string) {
    const c = await this.store.one(
      'SELECT * FROM connections WHERE owner=?',
      owner,
    );
    if (!c) throw new Error('Connect Binance first');
    return new Binance(
      (await unseal(c.encrypted, this.key, owner)) as Credentials,
    );
  }
  async state(owner: string) {
    const [connection, mandates, proposals, events] = await Promise.all([
      this.store.one(
        'SELECT environment,updated_at,monitor_at FROM connections WHERE owner=?',
        owner,
      ),
      this.store.all(
        'SELECT * FROM mandates WHERE owner=? ORDER BY created_at DESC',
        owner,
      ),
      this.store.all(
        'SELECT * FROM proposals WHERE owner=? ORDER BY created_at DESC LIMIT 50',
        owner,
      ),
      this.store.all(
        'SELECT * FROM events WHERE owner=? ORDER BY created_at DESC LIMIT 100',
        owner,
      ),
    ]);
    return {
      connection,
      mandates: mandates.map((m: any) => ({
        ...m,
        body: JSON.parse(m.body),
        snapshot: m.snapshot ? JSON.parse(m.snapshot) : null,
        assessment: m.assessment ? JSON.parse(m.assessment) : null,
      })),
      proposals: proposals.map((p: any) => ({
        ...p,
        body: JSON.parse(p.body),
        receipt: p.receipt ? JSON.parse(p.receipt) : null,
      })),
      events: events.map((e: any) => ({
        ...e,
        details: e.details ? JSON.parse(e.details) : null,
      })),
    };
  }
  async connect(owner: string, body: any) {
    if (!body.eligible) throw new Error('Confirm eligibility and read access');
    if (!['demo', 'live'].includes(body.environment))
      throw new Error('Choose demo or live');
    if (
      typeof body.apiKey !== 'string' ||
      body.apiKey.length < 20 ||
      body.apiKey.length > 512 ||
      typeof body.secret !== 'string' ||
      body.secret.length < 20 ||
      body.secret.length > 512
    )
      throw new Error('Enter a valid API key and secret');
    const holder = crypto.randomUUID();
    await this.store.lock(owner, holder);
    try {
      const old = await this.store.one(
        'SELECT owner FROM connections WHERE owner=?',
        owner,
      );
      if (old)
        throw new Error(
          'Disconnect the existing account before replacing credentials',
        );
      const credentials: Credentials = {
        apiKey: body.apiKey.trim(),
        secret: body.secret.trim(),
        environment: body.environment,
      };
      const client = new Binance(credentials);
      await client.positions();
      await this.store.run(
        'INSERT INTO connections (owner,encrypted,environment,updated_at) VALUES (?,?,?,?)',
        owner,
        await seal(credentials, this.key, owner),
        body.environment,
        Date.now(),
      );
      await this.store.event(
        owner,
        'connection',
        `Binance ${body.environment} read connection verified`,
      );
      return { connected: true };
    } finally {
      await this.store.unlock(owner, holder);
    }
  }
  async disconnect(owner: string) {
    const holder = crypto.randomUUID();
    await this.store.lock(owner, holder);
    try {
      await this.store.db.batch([
        this.store.db
          .prepare('DELETE FROM connections WHERE owner=?')
          .bind(owner),
        this.store.db
          .prepare(
            "UPDATE mandates SET status='paused',version=version+1 WHERE owner=?",
          )
          .bind(owner),
        this.store.db
          .prepare(
            "UPDATE proposals SET status='invalidated' WHERE owner=? AND status='pending'",
          )
          .bind(owner),
      ]);
      await this.store.event(
        owner,
        'connection',
        'Disconnected; all mandates paused',
      );
      return { disconnected: true };
    } finally {
      await this.store.unlock(owner, holder);
    }
  }
  async saveMandate(owner: string, input: any, id?: string) {
    const holder = crypto.randomUUID();
    await this.store.lock(owner, holder);
    try {
      const old = id ? await this.store.mandate(owner, id) : null;
      const client = await this.exchange(owner);
      const snapshot = await client.snapshot(input.symbol);
      if (snapshot.quantity === 0) throw new Error('Select an open position');
      if (!old) {
        const duplicate = await this.store.one(
          'SELECT id FROM mandates WHERE owner=? AND symbol=?',
          owner,
          input.symbol,
        );
        if (duplicate)
          throw new Error(
            'A mandate already exists for this position. Edit that mandate.',
          );
      }
      if (old && old.symbol !== input.symbol)
        throw new Error('A mandate cannot switch positions');
      const body = validateMandate({
        ...input,
        baselineQuantity:
          old?.body.baselineQuantity ?? Math.abs(snapshot.quantity),
      });
      if (body.deadline <= Date.now())
        throw new Error('Choose a future deadline');
      const mandateId = id ?? crypto.randomUUID();
      if (old) {
        await this.store.db.batch([
          this.store.db
            .prepare(
              "UPDATE mandates SET body=?,status='active',version=version+1,assessment=NULL WHERE id=? AND owner=?",
            )
            .bind(JSON.stringify(body), mandateId, owner),
          this.store.db
            .prepare(
              "UPDATE proposals SET status='invalidated' WHERE mandate_id=? AND owner=? AND status='pending'",
            )
            .bind(mandateId, owner),
        ]);
      } else
        await this.store.run(
          "INSERT INTO mandates(id,owner,symbol,body,status,version,snapshot,created_at) VALUES(?,?,?,?,'active',1,?,?)",
          mandateId,
          owner,
          body.symbol,
          JSON.stringify(body),
          JSON.stringify(snapshot),
          Date.now(),
        );
      await this.store.event(
        owner,
        'mandate',
        old ? 'Management mandate revised' : 'Management mandate created',
        mandateId,
        body,
      );
      return { id: mandateId };
    } finally {
      await this.store.unlock(owner, holder);
    }
  }
  async status(owner: string, id: string, status: string) {
    if (!['active', 'paused'].includes(status))
      throw new Error('Invalid status');
    const holder = crypto.randomUUID();
    await this.store.lock(owner, holder);
    try {
      await this.store.mandate(owner, id);
      await this.store.db.batch([
        this.store.db
          .prepare(
            'UPDATE mandates SET status=?,version=version+1 WHERE id=? AND owner=?',
          )
          .bind(status, id, owner),
        this.store.db
          .prepare(
            "UPDATE proposals SET status='invalidated' WHERE mandate_id=? AND owner=? AND status='pending'",
          )
          .bind(id, owner),
      ]);
      await this.store.event(
        owner,
        'mandate',
        `Monitoring ${status === 'active' ? 'resumed' : 'paused'}`,
        id,
      );
      return { status };
    } finally {
      await this.store.unlock(owner, holder);
    }
  }
  async evaluate(owner: string, id: string) {
    const m = await this.store.mandate(owner, id);
    if (m.status !== 'active')
      throw new Error('Resume this mandate before assessing');
    if (await this.store.one('SELECT holder FROM locks WHERE key=?', owner))
      throw new Error('Account operation awaiting reconciliation');
    try {
      const p = await (await this.exchange(owner)).snapshot(m.symbol);
      const a = assess(m.body, p);
      const current = await this.store.mandate(owner, id);
      if (current.version !== m.version || current.status !== 'active')
        throw new Error('Mandate changed during assessment');
      await this.store.run(
        'UPDATE mandates SET snapshot=?,assessment=?,last_check=?,last_error=NULL WHERE id=? AND owner=? AND version=?',
        JSON.stringify(p),
        JSON.stringify(a),
        Date.now(),
        id,
        owner,
        m.version,
      );
      let proposal = null;
      if (a.action === 'reduce' || a.action === 'close') {
        const latest = await this.store.one(
          "SELECT id FROM proposals WHERE owner=? AND mandate_id=? AND status='pending' AND created_at>?",
          owner,
          id,
          Date.now() - 60000,
        );
        if (latest) proposal = await this.store.proposal(owner, latest.id);
        else {
          const proposalId = crypto.randomUUID(),
            clientId = `pa_${proposalId.replaceAll('-', '')}`;
          const body = {
            snapshot: p,
            assessment: a,
            terms: orderTerms(p, a.quantity, m.body.maxSlippageBps),
          };
          await this.store.db.batch([
            this.store.db
              .prepare(
                "UPDATE proposals SET status='expired' WHERE owner=? AND mandate_id=? AND status='pending'",
              )
              .bind(owner, id),
            this.store.db
              .prepare(
                "INSERT INTO proposals(id,owner,mandate_id,mandate_version,body,status,created_at,client_id) VALUES(?,?,?,?,?,'pending',?,?)",
              )
              .bind(
                proposalId,
                owner,
                id,
                m.version,
                JSON.stringify(body),
                p.observedAt,
                clientId,
              ),
          ]);
          proposal = await this.store.proposal(owner, proposalId);
          await this.store.event(
            owner,
            'proposal',
            'Adjustment ready for your approval',
            id,
            { proposalId, assessment: a, terms: body.terms },
          );
        }
      } else if (
        !m.assessment ||
        JSON.parse(m.assessment).action !== a.action
      ) {
        await this.store.event(owner, 'assessment', a.reasons.join(' '), id, a);
      }
      if (p.quantity === 0)
        await this.store.run(
          "UPDATE mandates SET status='closed' WHERE id=? AND owner=?",
          id,
          owner,
        );
      return { assessment: a, proposal };
    } catch (e: any) {
      await this.store.run(
        'UPDATE mandates SET last_error=? WHERE id=? AND owner=?',
        e.message,
        id,
        owner,
      );
      throw e;
    }
  }
  async approve(owner: string, id: string, confirmation: string) {
    const proposal = await this.store.proposal(owner, id);
    if (proposal.status !== 'pending')
      throw new Error('This proposal is not pending');
    const { snapshot, terms } = proposal.body;
    if (confirmation !== `${terms.side} ${terms.quantity} ${snapshot.symbol}`)
      throw new Error('Exact-order confirmation is required');
    await this.store.lock(owner, id);
    let dispatch = false;
    try {
      const current = await this.store.proposal(owner, id);
      if (current.status !== 'pending')
        throw new Error('Proposal already handled');
      const m = await this.store.mandate(owner, proposal.mandate_id);
      if (m.status !== 'active' || m.version !== proposal.mandate_version)
        throw new Error('Mandate changed. Assess again.');
      const client = await this.exchange(owner);
      const fresh = await client.snapshot(snapshot.symbol);
      approvalCheck(snapshot, fresh, Date.now(), m.body.maxSlippageBps);
      const open = await client.openOrders(snapshot.symbol);
      if (open.length)
        throw new Error(
          'Existing orders or TP/SL orders need review in Binance before approving. The agent does not cancel protective orders.',
        );
      approvalCheck(snapshot, fresh, Date.now(), m.body.maxSlippageBps);
      // Re-evaluate trigger validity as well as price and quantity. Never dispatch a obsolete proposal.
      const a = assess(m.body, fresh);
      if (
        !['reduce', 'close'].includes(a.action) ||
        a.quantity + 1e-10 < Number(terms.quantity)
      )
        throw new Error(
          'Conditions changed. The approved reduction is no longer justified.',
        );
      await this.store.run(
        "UPDATE proposals SET status='executing' WHERE id=? AND owner=? AND status='pending'",
        id,
        owner,
      );
      await this.store.event(
        owner,
        'approval',
        'Exact order approved; submission recorded before dispatch',
        m.id,
        { clientId: proposal.client_id, terms },
      );
      dispatch = true;
      try {
        await client.submit(terms, proposal.client_id);
      } catch (e: any) {
        await this.store.run(
          "UPDATE proposals SET status='unknown',receipt=? WHERE id=? AND owner=?",
          JSON.stringify({
            message:
              'Submission outcome is unconfirmed. Querying the original client order ID.',
            error: e.message,
          }),
          id,
          owner,
        );
      }
      return await this.reconcile(owner, id);
    } catch (e: any) {
      if (!dispatch) {
        await this.store.unlock(owner, id);
      }
      throw e;
    }
  }
  async reconcile(owner: string, id: string) {
    const p = await this.store.proposal(owner, id);
    if (!['executing', 'unknown'].includes(p.status)) return p;
    const client = await this.exchange(owner);
    try {
      const order = await client.query(p.body.snapshot.symbol, p.client_id);
      validateOrderReceipt(order, p.body.terms, p.client_id);
      const [position, trades] = await Promise.all([
        client.snapshot(p.body.snapshot.symbol),
        client.trades(p.body.snapshot.symbol, String(order.orderId)),
      ]);
      const terminal = [
        'FILLED',
        'CANCELED',
        'EXPIRED',
        'EXPIRED_IN_MATCH',
        'REJECTED',
      ].includes(order.status);
      const executed = Number(order.executedQty);
      const expected = Math.max(
        0,
        Math.abs(p.body.snapshot.quantity) - executed,
      );
      const matched =
        Math.abs(Math.abs(position.quantity) - expected) <
          position.stepSize / 2 &&
        (!position.quantity ||
          Math.sign(position.quantity) === Math.sign(p.body.snapshot.quantity));
      const status = !terminal
        ? 'executing'
        : !matched
          ? 'unknown'
          : executed === 0
            ? 'unfilled'
            : order.status === 'FILLED'
              ? 'verified'
              : 'partial';
      const now = Date.now();
      const receipt = JSON.stringify({
        verificationId: crypto.randomUUID(),
        environment: client.credentials!.environment,
        orderId: String(order.orderId),
        clientOrderId: p.client_id,
        exchangeStatus: order.status,
        executedQuantity: executed,
        averagePrice: Number(order.avgPrice),
        trades,
        position,
        expectedRemainingQuantity: expected,
        positionMatched: matched,
        verifiedAt: now,
      });
      const update = this.store.db
        .prepare(
          "UPDATE proposals SET status=?,receipt=? WHERE id=? AND owner=? AND status IN ('executing','unknown')",
        )
        .bind(status, receipt, id, owner);
      if (['verified', 'partial', 'unfilled'].includes(status)) {
        // One transaction owns finalization. A delayed reader cannot overwrite a
        // terminal result, duplicate its effects, or release an unrelated lock.
        const owns =
          'EXISTS (SELECT 1 FROM proposals WHERE id=? AND owner=? AND receipt=?)';
        const batch = [
          update,
          this.store.db
            .prepare(
              `UPDATE mandates SET snapshot=?,last_check=? WHERE id=? AND owner=? AND ${owns}`,
            )
            .bind(
              JSON.stringify(position),
              now,
              p.mandate_id,
              owner,
              id,
              owner,
              receipt,
            ),
        ];
        const profitTrigger = p.body.assessment.reasons.some((r: string) =>
          r.includes('profit reached'),
        );
        if (position.quantity === 0 || (profitTrigger && executed > 0))
          batch.push(
            this.store.db
              .prepare(
                `UPDATE mandates SET status=?,version=version+1 WHERE id=? AND owner=? AND ${owns}`,
              )
              .bind(
                position.quantity === 0 ? 'closed' : 'paused',
                p.mandate_id,
                owner,
                id,
                owner,
                receipt,
              ),
          );
        const message =
          status === 'verified'
            ? 'Order fill and remaining position verified'
            : status === 'partial'
              ? 'Partial fill verified; remainder requires a new approval'
              : 'Order ended without a fill';
        batch.push(
          this.store.db
            .prepare(
              `INSERT INTO events(id,owner,mandate_id,kind,message,details,created_at) SELECT ?,?,?,?,?,?,? WHERE ${owns}`,
            )
            .bind(
              crypto.randomUUID(),
              owner,
              p.mandate_id,
              'execution',
              message,
              receipt,
              now,
              id,
              owner,
              receipt,
            ),
        );
        batch.push(
          this.store.db
            .prepare(
              `UPDATE proposals SET status='invalidated' WHERE owner=? AND status='pending' AND ${owns}`,
            )
            .bind(owner, id, owner, receipt),
        );
        batch.push(
          this.store.db
            .prepare(`DELETE FROM locks WHERE key=? AND holder=? AND ${owns}`)
            .bind(owner, id, id, owner, receipt),
        );
        await this.store.db.batch(batch);
      } else await update.run();
      return this.store.proposal(owner, id);
    } catch (e: any) {
      await this.store.run(
        "UPDATE proposals SET status='unknown',receipt=? WHERE id=? AND owner=? AND status IN ('executing','unknown')",
        JSON.stringify({
          message:
            'Exchange outcome remains unknown. No duplicate order will be sent.',
          error: e.message,
          lastQueryAt: Date.now(),
        }),
        id,
        owner,
      );
      return this.store.proposal(owner, id);
    }
  }
  async reject(owner: string, id: string) {
    const holder = crypto.randomUUID();
    await this.store.lock(owner, holder);
    try {
      const p = await this.store.proposal(owner, id);
      if (p.status !== 'pending')
        throw new Error('Only pending proposals can be rejected');
      await this.store.run(
        "UPDATE proposals SET status='rejected' WHERE id=? AND owner=? AND status='pending'",
        id,
        owner,
      );
      await this.store.event(
        owner,
        'proposal',
        'Adjustment rejected',
        p.mandate_id,
      );
      return { rejected: true };
    } finally {
      await this.store.unlock(owner, holder);
    }
  }
  async token(owner: string) {
    const c = await this.store.one(
      'SELECT owner FROM connections WHERE owner=?',
      owner,
    );
    if (!c) throw new Error('Connect Binance first');
    const token = `pa_${crypto.randomUUID()}${crypto.randomUUID()}`;
    await this.store.run(
      'UPDATE connections SET token_hash=? WHERE owner=?',
      await digest(token),
      owner,
    );
    return { token };
  }
  async monitor(owner: string) {
    const pending = await this.store.all(
      "SELECT id FROM proposals WHERE owner=? AND status IN ('executing','unknown')",
      owner,
    );
    for (const p of pending) await this.reconcile(owner, p.id);
    const mandates = await this.store.all(
      "SELECT id FROM mandates WHERE owner=? AND status='active'",
      owner,
    );
    const results = [];
    for (const m of mandates) {
      try {
        results.push({ id: m.id, ...(await this.evaluate(owner, m.id)) });
      } catch (e: any) {
        results.push({ id: m.id, error: e.message });
      }
    }
    await this.store.run(
      'UPDATE connections SET monitor_at=? WHERE owner=?',
      Date.now(),
      owner,
    );
    return results;
  }
}
