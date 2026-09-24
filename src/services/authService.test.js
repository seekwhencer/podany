import './testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from './authService.js';

class InMemoryUser {
  constructor() {
    this.rows = [];
    this._counter = 0;
  }
  generateId(prefix = '') {
    this._counter += 1;
    return `${prefix}usr_${this._counter}`;
  }
  async findByEmail(email) {
    return this.rows.find((u) => u.email === email) ?? null;
  }
  async findById(id) {
    return this.rows.find((u) => u.id === id) ?? null;
  }
  async create({ id, email }) {
    const user = { id, email, created_at: Math.floor(Date.now() / 1000) };
    this.rows.push(user);
    return { affectedRows: 1 };
  }
  async countCreatedAfter(cutoff) {
    return this.rows.filter((u) => u.created_at > cutoff).length;
  }
}

class InMemoryToken {
  constructor() {
    this.rows = [];
  }
  async create({ tokenHash, userId, expiresAt }) {
    this.rows.push({ token_hash: tokenHash, user_id: userId, expires_at: expiresAt, used: 0, created_at: Math.floor(Date.now() / 1000) });
    return { affectedRows: 1 };
  }
  async consume(hash) {
    const now = Math.floor(Date.now() / 1000);
    const row = this.rows.find((t) => t.token_hash === hash);
    if (!row) return null;
    if (row.used === 0 && row.expires_at > now) {
      row.used = 1;
      return row.user_id;
    }
    if (row.expires_at > now) return row.user_id;
    return null;
  }
  async countCreatedAfterForUser(userId, cutoff) {
    return this.rows.filter((t) => t.user_id === userId && t.created_at > cutoff).length;
  }
}

function buildAuth(deps = {}) {
  const users = deps.users ?? new InMemoryUser();
  const tokens = deps.tokens ?? new InMemoryToken();
  const email = deps.email ?? { enabled: false, async send() { return { sentVia: 'local' }; } };
  return new AuthService({ users, tokens, email, ...deps });
}

test('sendLoginLink creates a user and token and returns a verifyUrl in local mode', async () => {
  const auth = buildAuth();
  const result = await auth.sendLoginLink({ email: 'New@Example.com ', origin: 'https://app.example.test' });
  assert.equal(result.success, true);
  assert.equal(result.sentVia, 'local');
  assert.match(result.verifyUrl, /^https:\/\/app\.example\.test\/auth\/verify\/?\?token=/);
  assert.match(result.verifyUrl, /token=[0-9a-f]{64}$/);
});

test('sendLoginLink falls back to the configured app url for an invalid origin', async () => {
  const auth = buildAuth();
  const result = await auth.sendLoginLink({ email: 'second@example.com', origin: 'ftp://evil.test' });
  assert.match(result.verifyUrl, /^http:\/\/localhost:8788\/auth\/verify\/?\?token=/);
});

test('sendLoginLink rejects malformed emails', async () => {
  const auth = buildAuth();
  await assert.rejects(() => auth.sendLoginLink({ email: 'not-an-email' }), /Valid email address required/);
});

test('verify consumes the token and issues a session token', async () => {
  const auth = buildAuth();
  const sent = await auth.sendLoginLink({ email: 'verify@example.com' });
  const token = sent.verifyUrl.split('token=')[1];
  const result = await auth.verify(token);
  assert.equal(result.success, true);
  assert.match(result.sessionToken, /^[0-9a-f]{64}$/);
  assert.equal(result.user.email, 'verify@example.com');
});

test('verify rejects an unknown token', async () => {
  const auth = buildAuth();
  await assert.rejects(() => auth.verify('deadbeef'), /Invalid or expired token/);
});

test('resolveUser returns the user for a valid session and null otherwise', async () => {
  const auth = buildAuth();
  const sent = await auth.sendLoginLink({ email: 'resolve@example.com' });
  const token = sent.verifyUrl.split('token=')[1];
  const verified = await auth.verify(token);
  const user = await auth.resolveUser(verified.sessionToken);
  assert.equal(user.email, 'resolve@example.com');
  assert.equal(await auth.resolveUser('nope'), null);
});

test('login issues a session directly when local login is enabled', async () => {
  const auth = buildAuth({ localLoginEnabled: true });
  const result = await auth.login({ email: 'local@example.com' });
  assert.equal(result.success, true);
  assert.match(result.sessionToken, /^[0-9a-f]{64}$/);
  assert.equal(result.user.email, 'local@example.com');
});

test('login throws when local login is disabled', async () => {
  const auth = buildAuth({ localLoginEnabled: false });
  await assert.rejects(() => auth.login({ email: 'x@example.com' }), /not enabled/);
});

test('logout revokes the session token', async () => {
  const auth = buildAuth();
  const sent = await auth.sendLoginLink({ email: 'logout@example.com' });
  const token = sent.verifyUrl.split('token=')[1];
  const verified = await auth.verify(token);
  const user = await auth.resolveUser(verified.sessionToken);
  assert.equal(user.email, 'logout@example.com');
  await auth.logout(verified.sessionToken);
  assert.equal(await auth.resolveUser(verified.sessionToken), null);
});

test('sendLoginLink enforces the per-email link rate limit', async () => {
  const auth = buildAuth();
  for (let i = 0; i < 5; i += 1) {
    await auth.sendLoginLink({ email: 'rate@example.com' });
  }
  await assert.rejects(() => auth.sendLoginLink({ email: 'rate@example.com' }), /Too many login attempts/);
});
