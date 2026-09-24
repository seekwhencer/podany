import '../services/testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCors } from './cors.js';

function makeRes() {
  const headers = {};
  return {
    _headers: headers,
    _status: null,
    status() { return this; },
    set(key, val) { headers[String(key).toLowerCase()] = val; return this; },
    getHeader(key) { return headers[String(key).toLowerCase()]; },
    setHeader(key, val) { headers[String(key).toLowerCase()] = val; return this; },
    writeHead() { return this; },
    get statusCode() { return this._status; },
    set statusCode(v) { this._status = v; },
    end() { return this; }
  };
}

function makeReq(headers = {}) {
  return { headers, ip: '1.2.3.4', ...headers };
}

test('createCors returns an express-compatible middleware function', () => {
  const mw = createCors({ origin: 'https://app.example.test' });
  assert.equal(typeof mw, 'function');
});

test('cors reflects credentials for a matching origin on a normal request', () => {
  const mw = createCors({ origin: 'https://app.example.test' });
  const res = makeRes();
  let nextCalled = false;
  mw(makeReq({ origin: 'https://app.example.test' }), res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res._headers['access-control-allow-origin'], 'https://app.example.test');
  assert.equal(res._headers['access-control-allow-credentials'], 'true');
});

test('cors preflight exposes allowed methods and headers for a matching origin', () => {
  const mw = createCors({ origin: 'https://app.example.test' });
  const res = makeRes();
  let nextCalled = false;
  mw(
    makeReq({ method: 'OPTIONS', origin: 'https://app.example.test', 'access-control-request-headers': 'X-Session-Token' }),
    res,
    () => { nextCalled = true; }
  );
  assert.equal(nextCalled, false);
  assert.equal(res._status, 204);
  assert.match(res._headers['access-control-allow-methods'] || '', /DELETE/);
  assert.match(res._headers['access-control-allow-headers'] || '', /X-Session-Token/);
});

test('cors omits the allow-origin header for a non-matching origin', () => {
  const mw = createCors({ origin: 'https://app.example.test' });
  const res = makeRes();
  let nextCalled = false;
  mw(makeReq({ origin: 'https://evil.test' }), res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res._headers['access-control-allow-origin'], undefined);
});
