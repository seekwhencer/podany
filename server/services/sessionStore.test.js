import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from './sessionStore.js';

test('issue returns a raw token and hash, resolve maps back to userId', () => {
  const store = new SessionStore();
  const { raw, hash } = store.issue('usr_1');
  assert.match(raw, /^[0-9a-f]{64}$/);
  assert.equal(hash.length, 64);
  assert.equal(store.resolve(hash), 'usr_1');
  assert.equal(store.size, 1);
});

test('resolve returns null for unknown or revoked hashes', () => {
  const store = new SessionStore();
  assert.equal(store.resolve('missing'), null);
  const { hash } = store.issue('usr_2');
  store.revoke(hash);
  assert.equal(store.resolve(hash), null);
  assert.equal(store.size, 0);
});

test('resolve drops expired entries and prune clears them', () => {
  const store = new SessionStore(1);
  const first = store.issue('usr_a');
  store._store.set(first.hash, { userId: 'usr_a', expiresAt: Math.floor(Date.now() / 1000) - 1 });
  assert.equal(store.resolve(first.hash), null);
  store.issue('usr_b');
  store.prune();
  assert.equal(store.size, 1);
});
