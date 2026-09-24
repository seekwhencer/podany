import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from './rateLimit.js';

function makeReqRes(ip = '1.2.3.4') {
  const state = { status: null, headers: {} };
  const req = { ip, headers: {} };
  let nextCalled = 0;
  const res = {
    _state: state,
    status(code) { state.status = code; return this; },
    set(key, val) { state.headers[String(key).toLowerCase()] = val; return this; },
    send(body) { state.body = body; return this; }
  };
  const next = () => { nextCalled += 1; };
  return { req, res, next, get nextCount() { return nextCalled; } };
}

test('allows up to the limit, exposes remaining, then blocks with 429', () => {
  const mw = createRateLimiter({ windowMs: 10_000, limit: 2, keyBy: () => 'k' });

  const c1 = makeReqRes();
  mw(c1.req, c1.res, c1.next);
  assert.equal(c1.nextCount, 1);
  assert.equal(c1.res._state.headers['x-ratelimit-remaining'], '1');

  const c2 = makeReqRes();
  mw(c2.req, c2.res, c2.next);
  assert.equal(c2.nextCount, 1);
  assert.equal(c2.res._state.headers['x-ratelimit-remaining'], '0');

  const c3 = makeReqRes();
  mw(c3.req, c3.res, c3.next);
  assert.equal(c3.nextCount, 0);
  assert.equal(c3.res._state.status, 429);
  assert.match(c3.res._state.headers['retry-after'], /^\d+$/);
});

test('keys requests by ip by default', () => {
  const mw = createRateLimiter({ windowMs: 10_000, limit: 1 });
  const a = makeReqRes('1.1.1.1');
  mw(a.req, a.res, a.next);
  const b = makeReqRes('2.2.2.2');
  mw(b.req, b.res, b.next);
  assert.equal(a.nextCount, 1);
  assert.equal(b.nextCount, 1);
});
