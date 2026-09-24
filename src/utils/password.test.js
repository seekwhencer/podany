import '../services/testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password.js';

test('hashPassword produces a scrypt string that verifies the correct password', () => {
  const hash = hashPassword('s3cret-pass');
  assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(verifyPassword('s3cret-pass', hash), true);
});

test('verifyPassword rejects a wrong password', () => {
  const hash = hashPassword('s3cret-pass');
  assert.equal(verifyPassword('wrong-pass', hash), false);
});

test('verifyPassword handles malformed or missing stored hashes', () => {
  assert.equal(verifyPassword('x', null), false);
  assert.equal(verifyPassword('x', 'not-a-hash'), false);
  assert.equal(verifyPassword('x', ''), false);
});

test('two hashes of the same password differ due to random salt', () => {
  const a = hashPassword('same');
  const b = hashPassword('same');
  assert.notEqual(a, b);
  assert.equal(verifyPassword('same', a), true);
  assert.equal(verifyPassword('same', b), true);
});
