import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, signature } from '../lib/agent/crypto.ts';
test('credentials encrypted and bound to their owner', async () => {
  const key = '11'.repeat(32);
  const box = await seal(
    { apiKey: 'private-key', secret: 'private-secret' },
    key,
    'user-a',
  );
  assert.ok(!box.includes('private'));
  assert.deepEqual(await unseal(box, key, 'user-a'), {
    apiKey: 'private-key',
    secret: 'private-secret',
  });
  await assert.rejects(() => unseal(box, key, 'user-b'));
});
test('Binance HMAC has stable SHA256 output', async () =>
  assert.equal(
    await signature('key', 'The quick brown fox jumps over the lazy dog'),
    'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
  ));
