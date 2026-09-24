import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashToken, generateToken } from './crypto.js';
import { isValidExternalUrl } from './url.js';
import { json, error, notFound } from './response.js';

async function subtleHash(token) {
  const data = new TextEncoder().encode(token);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

test('hashToken matches WebCrypto SHA-256 and known vectors', async () => {
  assert.equal(hashToken(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hashToken('test@example.com'), await subtleHash('test@example.com'));
  assert.equal(hashToken(12345), await subtleHash('12345'));
});

test('generateToken returns hex of requested length and is unique', () => {
  const token = generateToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.match(generateToken(16), /^[0-9a-f]{32}$/);
  assert.notEqual(generateToken(), generateToken());
});

test('isValidExternalUrl accepts public http/https hosts', () => {
  assert.equal(isValidExternalUrl('https://example.com/audio.mp3'), true);
  assert.equal(isValidExternalUrl('http://podcast.example.org/feed.xml'), true);
  assert.equal(isValidExternalUrl('https://podcast.example.org/path?q=1#x'), true);
});

test('isValidExternalUrl rejects non-http schemes and malformed input', () => {
  assert.equal(isValidExternalUrl('ftp://example.com/file'), false);
  assert.equal(isValidExternalUrl('file:///etc/passwd'), false);
  assert.equal(isValidExternalUrl('data:text;base64,AAAA'), false);
  assert.equal(isValidExternalUrl('not a url'), false);
  assert.equal(isValidExternalUrl(''), false);
});

test('isValidExternalUrl blocks internal / private / metadata hosts (SSRF)', () => {
  for (const blocked of [
    'http://localhost/secret',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://169.254.169.25/latest/meta-data/',
    'http://100.64.1.2/',
    'http://metadata.google.internal/',
    'http://example.local/x',
    'http://svc.internal/y',
    'http://box.lan/z',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://0x7f.0.0.1/',
    'http://080.0.0.1/'
  ]) {
    assert.equal(isValidExternalUrl(blocked), false, `should block ${blocked}`);
  }
});

test('response helpers build JSON responses via a fake Express res', () => {
  const makeRes = () => {
    const state = { status: null, headers: {}, body: null };
    return {
      _state: state,
      status(code) { state.status = code; return this; },
      set(headers) { Object.assign(state.headers, headers); return this; },
      send(body) { state.body = body; return this; }
    };
  };

  const r1 = json(makeRes(), 200, { success: true });
  assert.equal(r1._state.status, 200);
  assert.equal(r1._state.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(r1._state.body, JSON.stringify({ success: true }));

  const r2 = error(makeRes(), 400, 'bad', { 'X-Custom': '1' });
  assert.equal(r2._state.status, 400);
  assert.equal(r2._state.body, JSON.stringify({ error: 'bad' }));
  assert.equal(r2._state.headers['X-Custom'], '1');

  const r3 = notFound(makeRes());
  assert.equal(r3._state.status, 404);
  assert.equal(r3._state.body, JSON.stringify({ error: 'Not found' }));
});
