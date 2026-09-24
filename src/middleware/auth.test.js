import '../services/testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../services/authService.js';
import { SessionStore } from '../services/sessionStore.js';
import { createAuthMiddleware } from './auth.js';

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

function makeRes() {
  const state = { status: null, headers: {}, body: null };
  return {
    _state: state,
    status(code) { state.status = code; return this; },
    set(key, val) { state.headers[String(key).toLowerCase()] = val; return this; },
    send(body) { state.body = body; return this; }
  };
}

function makeReq({ headerToken = null, cookieToken = null } = {}) {
  const headers = {};
  if (headerToken) headers['x-session-token'] = headerToken;
  if (cookieToken) headers.cookie = `${'podcast_session'}=${cookieToken}`;
  return { headers, cookies: { 'podcast_session': cookieToken }, ip: '1.2.3.4' };
}

function build() {
  const users = new InMemoryUser();
  const tokens = new InMemoryToken();
  const sessions = new SessionStore();
  const email = { enabled: false };
  const auth = new AuthService({ users, tokens, email, sessions });
  const requireAuth = createAuthMiddleware({ users, tokens, email, sessions });
  return { auth, requireAuth, users };
}

async function issueSession(auth, email) {
  const sent = await auth.sendLoginLink({ email });
  const token = sent.verifyUrl.split('token=')[1];
  const result = await auth.verify(token);
  return result.sessionToken;
}

test('requireAuth resolves the user from the X-Session-Token header', async () => {
  const { auth, requireAuth } = build();
  const token = await issueSession(auth, 'header@example.com');
  const res = makeRes();
  const req = makeReq({ headerToken: token });
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.email, 'header@example.com');
});

test('requireAuth resolves the user from the session cookie', async () => {
  const { auth, requireAuth } = build();
  const token = await issueSession(auth, 'cookie@example.com');
  const res = makeRes();
  const req = makeReq({ cookieToken: token });
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.email, 'cookie@example.com');
});

test('requireAuth rejects a missing token with 401', async () => {
  const { requireAuth } = build();
  const res = makeRes();
  await requireAuth(makeReq(), res, () => {});
  assert.equal(res._state.status, 401);
  assert.match(JSON.parse(res._state.body).error, /Authentication required/);
});

test('requireAuth rejects an unknown token with 401', async () => {
  const { requireAuth } = build();
  const res = makeRes();
  await requireAuth(makeReq({ headerToken: 'deadbeef' }), res, () => {});
  assert.equal(res._state.status, 401);
  assert.match(JSON.parse(res._state.body).error, /Invalid or expired session/);
});
