// Client-side tests for LiveClient: URL derivation, exponential reconnect
// backoff, the permanent-auth-failure cutoff, lifecycle (close/forceReconnect)
// and message dispatch. Browser globals (location/WebSocket) are mocked and
// timers are driven deterministically with node:test's mock.timers; the module
// under test is the real public/js/live/LiveClient.js.

import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { LiveClient } from './LiveClient.js';
import { WS_RECONNECT_BASE_MS, WS_RECONNECT_MAX_MS, WS_RECONNECT_MAX_FAILURES } from '../config.js';

mock.timers.enable({ timers: ['setTimeout', 'clearTimeout'] });
after(() => { mock.timers.reset(); });

// ── Mocks ───────────────────────────────────────────────────────────────────

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url, opts) {
    this.url = url;
    this.opts = opts || {};
    this.readyState = FakeWebSocket.CONNECTING;
    this._sent = [];
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    FakeWebSocket.instances.push(this);
  }

  send(data) { this._sent.push(data); }
  close() { this.readyState = FakeWebSocket.CLOSING; }

  fireOpen() { this.readyState = FakeWebSocket.OPEN; if (this.onopen) this.onopen(); }
  fireClose() { if (this.onclose) this.onclose(); }
  fireError() { if (this.onerror) this.onerror({}); }
  fireMessage(data) { if (this.onmessage) this.onmessage({ data }); }
}

globalThis.WebSocket = FakeWebSocket;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.CSS = { escape: (value) => String(value) };

function setProtocol(protocol, host) {
  globalThis.location = { protocol, host };
}

function lastInstance() {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

// Advance the reconnect clock far enough to fire the single pending reconnect.
function fireReconnect() {
  mock.timers.tick(WS_RECONNECT_MAX_MS + 5000);
}

function captureSchedule(fn) {
  const real = globalThis.setTimeout;
  const captured = [];
  globalThis.setTimeout = (cb, delay, ...args) => {
    captured.push(delay);
    return real.call(globalThis, cb, delay, ...args);
  };
  try {
    fn();
    return captured;
  } finally {
    globalThis.setTimeout = real;
  }
}

function makeApp(extra = {}) {
  const calls = {};
  const record = (name) => (..._args) => { calls[name] = (calls[name] || 0) + 1; };
  const app = {
    state: { sessionToken: 'tok', downloadStatus: {}, playbackPositions: {} },
    elements: {},
    config: {},
    api: {},
    auth: { showAuthModal: record('showAuthModal'), handleLogout: record('handleLogout') },
    feeds: { updateFeedCountUI: record('updateFeedCountUI'), renderFeedsGrid: record('renderFeedsGrid') },
    playback: { syncPlaybackButtons: record('syncPlaybackButtons'), renderTimeline: record('renderTimeline'), renderContinueShelf: record('renderContinueShelf') },
    timeline: { allEpisodeCards: () => [] },
    ...extra
  };
  app.calls = calls;
  return app;
}

function freshClient(app) {
  FakeWebSocket.instances.length = 0;
  return new LiveClient(app);
}

// ── URL derivation ────────────────────────────────────────────────────────────

test('derives a wss:// URL on https origins', () => {
  setProtocol('https:', 'podany.test:8788');
  const client = new LiveClient(makeApp());
  assert.equal(client.url, 'wss://podany.test:8788/live');
});

test('derives a ws:// URL on plain-http origins', () => {
  setProtocol('http:', 'localhost:8788');
  const client = new LiveClient(makeApp());
  assert.equal(client.url, 'ws://localhost:8788/live');
});

// ── Connection gating ─────────────────────────────────────────────────────────

test('connect() is a no-op without a session token', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  app.state.sessionToken = null;
  const client = freshClient(app);
  client.connect();
  assert.equal(FakeWebSocket.instances.length, 0);
  assert.equal(client._ws, null);
});

test('connect() opens a WebSocket on the derived URL when a session exists', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  const client = freshClient(app);
  client.connect();
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.equal(FakeWebSocket.instances[0].url, 'ws://localhost/live');
});

test('connect() guards against duplicate in-flight connections', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  const client = freshClient(app);
  client.connect();
  client.connect();
  assert.equal(FakeWebSocket.instances.length, 1);
});

// ── Open / backoff lifecycle ──────────────────────────────────────────────────

test('onopen marks the client connected', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  const client = freshClient(app);
  client.connect();
  lastInstance().fireOpen();
  assert.equal(client._connected, true);
  assert.equal(client.isConnected, true);
});

test('reconnect delays double each failed attempt and stay within the cap', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  const client = freshClient(app);

  client.connect();
  lastInstance().fireOpen(); // connected -> attempts reset to 0

  // After an open, each subsequent drop reschedules with a doubling backoff.
  // The first three drops yield base*2^0..2 before pre-open failures would
  // accumulate; assert the exponential shape and the hard cap.
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const captured = captureSchedule(() => lastInstance().fireClose());
    const delay = captured[captured.length - 1];
    const exp = Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_BASE_MS * Math.pow(2, i));
    assert.ok(delay >= exp, `cycle ${i}: delay ${delay} should be >= base ${exp}`);
    assert.ok(delay < exp + exp / 4 + 1, `cycle ${i}: delay ${delay} should stay within jitter of ${exp}`);
    assert.ok(delay <= WS_RECONNECT_MAX_MS, `cycle ${i}: delay ${delay} must not exceed the cap`);
    fireReconnect(); // rebuild without opening; attempts persists
  }
});

test('a dropped-but-opened connection schedules exactly one reconnect', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  const client = freshClient(app);
  client.connect();
  lastInstance().fireOpen();
  lastInstance().fireClose();
  assert.notEqual(client._reconnectTimer, null);
  fireReconnect();
  assert.equal(client._reconnectTimer, null);
});

test('repeated pre-open rejections trigger a permanent auth failure', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  const client = freshClient(app);

  client.connect(); // first (unopened) attempt; each drop counts as a failure
  for (let i = 0; i < WS_RECONNECT_MAX_FAILURES; i++) {
    lastInstance().fireClose(); // never opened -> counts as a connection failure
    if (client._closed) break;
    fireReconnect(); // rebuild without opening
  }

  assert.equal(client._closed, true);
  assert.equal(client._reconnectTimer, null);
  assert.equal(app.calls.showAuthModal, 1);
});

// ── Lifecycle: close / forceReconnect ─────────────────────────────────────────

test('close() stops reconnect and drops the socket', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  const client = freshClient(app);
  client.connect();
  lastInstance().fireOpen();
  const before = FakeWebSocket.instances.length;

  client.close();

  assert.equal(client._ws, null);
  assert.equal(client._closed, true);
  assert.equal(client._reconnectTimer, null);
  assert.equal(FakeWebSocket.instances.length, before, 'close must not schedule a new connection');
});

test('forceReconnect resets failure counters and opens a fresh socket', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  const client = freshClient(app);

  // Accumulate two pre-open failures, then rebuild to a mid-connecting socket.
  client.connect();
  lastInstance().fireClose();
  fireReconnect();
  lastInstance().fireClose();
  fireReconnect();
  assert.equal(client._connectFailures, 2);

  // The rebuilt socket is still mid-connection; let it open so the client
  // reaches a clean, connected state before forcing a reconnect.
  lastInstance().fireOpen();
  assert.equal(client._connected, true);

  const before = FakeWebSocket.instances.length;
  client.forceReconnect();

  assert.equal(FakeWebSocket.instances.length, before + 1);
  assert.equal(client._closed, false);
  assert.equal(client._reconnectTimer, null);
});

// ── Message dispatch ──────────────────────────────────────────────────────────

test('answers server pings with a bare "pong"', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  const client = freshClient(app);
  client.connect();
  const ws = lastInstance();
  ws.fireOpen();
  ws.fireMessage(JSON.stringify({ type: 'ping', payload: { ts: 1 } }));
  assert.ok(ws._sent.includes('pong'));
});

test('download:completed records status in the download state', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  const client = freshClient(app);
  client.connect();
  const ws = lastInstance();
  ws.fireOpen();
  ws.fireMessage(JSON.stringify({ type: 'download:completed', payload: { episodeId: 'ep1', title: 'T' } }));
  assert.equal(client.state.downloadStatus.ep1.status, 'completed');
});

test('subscription:added refreshes the feeds UI', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  const client = freshClient(app);
  client.connect();
  const ws = lastInstance();
  ws.fireOpen();
  ws.fireMessage(JSON.stringify({ type: 'subscription:added', payload: { feedUrl: 'https://x/feed', title: 'X' } }));
  assert.equal(app.calls.updateFeedCountUI, 1);
  assert.equal(app.calls.renderFeedsGrid, 1);
});

test('session:closed logs out and stops reconnecting', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  const client = freshClient(app);
  client.connect();
  const ws = lastInstance();
  ws.fireOpen();
  ws.fireMessage(JSON.stringify({ type: 'session:closed', payload: { reason: 'logout' } }));
  assert.equal(app.calls.handleLogout, 1);
  assert.equal(client._closed, true);
  assert.equal(client._reconnectTimer, null);
});

test('ignores malformed / non-JSON messages without throwing', () => {
  setProtocol('http:', 'localhost');
  const app = makeApp();
  const client = freshClient(app);
  client.connect();
  const ws = lastInstance();
  ws.fireOpen();
  assert.doesNotThrow(() => ws.fireMessage('not-json-at-all'));
  assert.doesNotThrow(() => ws.fireMessage(JSON.stringify({ noType: true })));
});
