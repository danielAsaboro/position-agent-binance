export type Database = {
  prepare: (sql: string) => any;
  batch: (queries: any[]) => Promise<any>;
};
export class Store {
  db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  async one(sql: string, ...args: unknown[]) {
    return this.db
      .prepare(sql)
      .bind(...args)
      .first();
  }
  async all(sql: string, ...args: unknown[]) {
    return (
      await this.db
        .prepare(sql)
        .bind(...args)
        .all()
    ).results;
  }
  async run(sql: string, ...args: unknown[]) {
    return this.db
      .prepare(sql)
      .bind(...args)
      .run();
  }
  async lock(owner: string, holder: string) {
    try {
      await this.run(
        'INSERT INTO locks (key,holder,created_at) VALUES (?,?,?)',
        owner,
        holder,
        Date.now(),
      );
    } catch {
      throw new Error(
        'An account operation is already in progress or awaits reconciliation.',
      );
    }
  }
  async unlock(owner: string, holder: string) {
    await this.run('DELETE FROM locks WHERE key=? AND holder=?', owner, holder);
  }
  async event(
    owner: string,
    kind: string,
    message: string,
    mandateId: string | null = null,
    details: unknown = null,
  ) {
    await this.run(
      'INSERT INTO events (id,owner,mandate_id,kind,message,details,created_at) VALUES (?,?,?,?,?,?,?)',
      crypto.randomUUID(),
      owner,
      mandateId,
      kind,
      message,
      details ? JSON.stringify(details) : null,
      Date.now(),
    );
  }
  async proposal(owner: string, id: string) {
    const p = await this.one(
      'SELECT * FROM proposals WHERE owner=? AND id=?',
      owner,
      id,
    );
    if (!p) throw new Error('Proposal not found');
    return {
      ...p,
      body: JSON.parse(p.body),
      receipt: p.receipt ? JSON.parse(p.receipt) : null,
    };
  }
  async mandate(owner: string, id: string) {
    const m = await this.one(
      'SELECT * FROM mandates WHERE owner=? AND id=?',
      owner,
      id,
    );
    if (!m) throw new Error('Mandate not found');
    return { ...m, body: JSON.parse(m.body) };
  }
}
