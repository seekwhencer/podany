import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

import { LiveHub } from './LiveHub.js';
import { WEBSOCKET_PATH, EVENT_CONNECTION_HELLO, EVENT_PING, EVENT_PONG } from './protocol.js';

const VALID_USER = { id: 'u1', name: 'Test User' };
const OTHER_USER = { id: 'u2', name: 'Other User' };

function makeAuth(map) {
  return {
    async resolveUser(token) {
      return (map && map[String(token)]) ?? null;
    }
  };
}

async function startHub(deps) {
  const server = http.createServer((req, res) => res.end('ok'));
  const hub = new LiveHub(deps);
  hub.attach(server);
  server.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = address.port;
  const base = `ws://127.0.0.1:${port}`;
  return {
    server,
    hub,
    base,
    close() {
      hub.close();
      server.close();
    }
  };
}

function connect(base, { token, path = WEBSOCKET_PATH } = {}) {
  const headers = {};
  if (token !== undefined) headers['X-Session-Token'] = token;
  const ws = new WebSocket(`${base}${path}`, { headers });
  const result = { ws, opened: false, hello: null, messages: [], closed: false };

  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(settle, 1500);
    ws.on('open', () => {
      result.opened = true;
    });
    ws.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString();
      result.messages.push(text);
      if (!result.hello) {
        try {
          const parsed = JSON.parse(text);
          if (parsed.type === EVENT_CONNECTION_HELLO) {
            result.hello = parsed.payload;
            clearTimeout(timer);
            settle();
          }
        } catch (_) {}
      }
    });
    ws.on('close', () => {
      result.closed = true;
      if (!result.opened) {
        clearTimeout(timer);
        settle();
      }
    });
    ws.on('error', () => {});
  });
}

test('accepts an upgrade with a valid session token and sends connection:hello', async (t) => {
  const auth = makeAuth({ valid: VALID_USER });
  const deps = { auth, config: { sessionCookieName: 'podcast_session' } };
  const env = await startHub(deps);
  t.after(() => env.close());

  const client = await connect(env.base, { token: 'valid' });

  assert.equal(client.opened, true);
  assert.ok(client.hello, 'expected a connection:hello message');
  assert.equal(client.hello.server, 'podany');
  assert.equal(typeof client.hello.ts, 'number');
});

test('rejects an upgrade with an unknown token (401)', async (t) => {
  const auth = makeAuth({ valid: VALID_USER });
  const deps = { auth, config: { sessionCookieName: 'podcast_session' } };
  const env = await startHub(deps);
  t.after(() => env.close());

  const client = await connect(env.base, { token: 'unknown' });
  assert.equal(client.opened, false);
});

test('rejects an upgrade without any token', async (t) => {
  const auth = makeAuth({ valid: VALID_USER });
  const deps = { auth, config: { sessionCookieName: 'podcast_session' } };
  const env = await startHub(deps);
  t.after(() => env.close());

  const client = await connect(env.base, {});
  assert.equal(client.opened, false);
});

test('ignores upgrades on a different path', async (t) => {
  const auth = makeAuth({ valid: VALID_USER });
  const deps = { auth, config: { sessionCookieName: 'podcast_session' } };
  const env = await startHub(deps);
  t.after(() => env.close());

  const client = await connect(env.base, { token: 'valid', path: '/nope' });
  assert.equal(client.opened, false);
});

test('routes events only to sockets of the target user', async (t) => {
  const auth = makeAuth({ valid: VALID_USER, other: OTHER_USER });
  const deps = { auth, config: { sessionCookieName: 'podcast_session' } };
  const env = await startHub(deps);
  t.after(() => env.close());

  const alice = await connect(env.base, { token: 'valid' });
  const bob = await connect(env.base, { token: 'other' });
  await new Promise((r) => setTimeout(r, 50));

  const encoded = JSON.stringify({ type: 'download:completed', payload: { id: 'dl_1' } });
  env.hub.sendToUser('u1', encoded);
  await new Promise((r) => setTimeout(r, 50));

  const aliceGot = alice.messages.some((m) => m.includes('dl_1'));
  const bobGot = bob.messages.some((m) => m.includes('dl_1'));
  assert.equal(aliceGot, true, 'alice should receive her own event');
  assert.equal(bobGot, false, 'bob must not receive another user event');
});

test('broadcastAll reaches every connected socket regardless of user', async (t) => {
  const auth = makeAuth({ valid: VALID_USER, other: OTHER_USER });
  const deps = { auth, config: { sessionCookieName: 'podcast_session' } };
  const env = await startHub(deps);
  t.after(() => env.close());

  const alice = await connect(env.base, { token: 'valid' });
  const bob = await connect(env.base, { token: 'other' });
  await new Promise((r) => setTimeout(r, 50));

  const encoded = JSON.stringify({ type: 'error', payload: { code: 'x' } });
  env.hub.broadcastAll(encoded);
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(alice.messages.some((m) => m.includes('error')), true);
  assert.equal(bob.messages.some((m) => m.includes('error')), true);
});

test('keeps a socket alive when the client answers pings with pong', async (t) => {
  const auth = makeAuth({ valid: VALID_USER });
  const deps = { auth, config: { sessionCookieName: 'podcast_session', websocketHeartbeatIntervalMs: 50, websocketHeartbeatTimeoutMs: 1000 } };
  const env = await startHub(deps);
  t.after(() => env.close());

  const ws = new WebSocket(`${env.base}${WEBSOCKET_PATH}`, { headers: { 'X-Session-Token': 'valid' } });
  let sawPing = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('did not stay alive')), 3000);
    ws.on('open', () => ws.send('hello'));
    ws.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString();
      let msg;
      try { msg = JSON.parse(text); } catch (_) { return; }
      if (msg && msg.type === EVENT_PING) {
        sawPing = true;
        ws.send(EVENT_PONG);
      }
    });
    ws.on('close', () => { clearTimeout(timer); reject(new Error('socket closed unexpectedly')); });
    ws.on('error', () => {});
    // A healthy client keeps answering pings, so missed stays ~0 and the link
    // survives well past the 1000ms timeout; a broken pong path would die ~1000ms.
    setTimeout(() => { clearTimeout(timer); resolve(undefined); }, 1500);
  });

  assert.ok(sawPing, 'server should have sent at least one ping');
});

test('terminates a socket that never answers pings (heartbeat timeout)', async (t) => {
  const auth = makeAuth({ valid: VALID_USER });
  const deps = { auth, config: { sessionCookieName: 'podcast_session', websocketHeartbeatIntervalMs: 50, websocketHeartbeatTimeoutMs: 1000 } };
  const env = await startHub(deps);
  t.after(() => env.close());

  const ws = new WebSocket(`${env.base}${WEBSOCKET_PATH}`, { headers: { 'X-Session-Token': 'valid' } });
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('still-open'), 3000);
    ws.on('open', () => {});
    ws.on('close', () => { clearTimeout(timer); resolve('closed'); });
    ws.on('error', () => {});
  });

  assert.equal(outcome, 'closed', 'inactive socket should be terminated by the heartbeat');
});
