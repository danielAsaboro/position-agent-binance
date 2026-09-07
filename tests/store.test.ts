import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../lib/agent/store.ts';
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE locks (key TEXT PRIMARY KEY,holder TEXT,created_at INTEGER); CREATE TABLE proposals (id TEXT PRIMARY KEY,owner TEXT,body TEXT,receipt TEXT);',
  );
  const adapter = {
    prepare(sql: string) {
      const s = db.prepare(sql);
      return {
        bind(...args: any[]) {
          return {
            first: async () => s.get(...args) ?? null,
            all: async () => ({ results: s.all(...args) }),
            run: async () => s.run(...args),
          };
        },
      };
    },
    batch: async () => {},
  };
  return new Store(adapter);
}
test('account execution lock excludes another request and survives wrong-owner release', async () => {
  const s = setup();
  await s.lock('a', 'one');
  await assert.rejects(() => s.lock('a', 'two'), /reconciliation/);
  await s.unlock('a', 'two');
  await assert.rejects(() => s.lock('a', 'three'));
  await s.unlock('a', 'one');
  await s.lock('a', 'two');
});
test('proposal cannot be read by a different owner', async () => {
  const s = setup();
  await s.run(
    'INSERT INTO proposals(id,owner,body) VALUES(?,?,?)',
    'p',
    'a',
    '{}',
  );
  await assert.rejects(() => s.proposal('b', 'p'), /not found/);
  assert.equal((await s.proposal('a', 'p')).id, 'p');
});
