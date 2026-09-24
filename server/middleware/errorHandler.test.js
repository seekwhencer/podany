import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler, notFoundHandler } from './errorHandler.js';

function makeRes({ headersSent = false } = {}) {
  const state = { status: null, headers: {}, body: null, headersSent };
  return {
    _state: state,
    get headersSent() { return state.headersSent; },
    status(code) { state.status = code; return this; },
    set(key, val) { state.headers[String(key).toLowerCase()] = val; return this; },
    send(body) { state.body = body; return this; }
  };
}

test('maps an error status through to the response', () => {
  const res = makeRes();
  const err = Object.assign(new Error('bad email'), { status: 400 });
  errorHandler(err, {}, res, () => {});
  assert.equal(res._state.status, 400);
  assert.match(JSON.parse(res._state.body).error, /bad email/);
});

test('defaults generic errors to 500 with a safe message', () => {
  const res = makeRes();
  errorHandler(new Error('secret stack trace'), {}, res, () => {});
  assert.equal(res._state.status, 500);
  assert.equal(JSON.parse(res._state.body).error, 'Internal server error');
});

test('treats body-parse errors as 400', () => {
  const res = makeRes();
  errorHandler({ type: 'entity.parse.failed', message: 'invalid json' }, {}, res, () => {});
  assert.equal(res._state.status, 400);
  assert.match(JSON.parse(res._state.body).error, /invalid json/);
});

test('passes through without responding when headers were already sent', () => {
  const res = makeRes({ headersSent: true });
  let nextCalled = false;
  errorHandler(new Error('late'), {}, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res._state.status, null);
});

test('notFoundHandler returns a 404 JSON body', () => {
  const res = makeRes();
  notFoundHandler({}, res, () => {});
  assert.equal(res._state.status, 404);
  assert.equal(JSON.parse(res._state.body).error, 'Not found');
});
