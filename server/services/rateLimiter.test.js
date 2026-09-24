import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from './rateLimiter.js';

test('allows up to the limit then blocks within the window', () => {
  const limiter = new RateLimiter({ windowMs: 10_000, limit: 3 });
  assert.equal(limiter.check('email@a').allowed, true);
  assert.equal(limiter.check('email@a').allowed, true);
  assert.equal(limiter.check('email@a').allowed, true);
  const blocked = limiter.check('email@a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterMs > 0);
});

test('separate keys are tracked independently', () => {
  const limiter = new RateLimiter({ windowMs: 10_000, limit: 1 });
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, false);
  assert.equal(limiter.check('b').allowed, true);
});

test('reset clears a key and old entries expire', async () => {
  const limiter = new RateLimiter({ windowMs: 40, limit: 2 });
  assert.equal(limiter.check('k').allowed, true);
  assert.equal(limiter.check('k').allowed, true);
  assert.equal(limiter.check('k').allowed, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(limiter.check('k').allowed, true);
  limiter.reset('k');
  assert.equal(limiter.size, 0);
});
