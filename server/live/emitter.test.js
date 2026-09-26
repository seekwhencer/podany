import '../services/testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveEmitter } from './emitter.js';
import {
  EVENT_DOWNLOAD_COMPLETED,
  EVENT_SESSION_CLOSED,
  encode
} from './protocol.js';

function makeRecordingHub() {
  const sent = [];
  return {
    sent,
    sendToUser(userId, encoded) {
      sent.push({ userId, encoded });
    },
    broadcastAll(encoded) {
      sent.push({ all: true, encoded });
    }
  };
}

test('emit is a no-op when no hub is wired', () => {
  const emitter = new LiveEmitter();
  assert.doesNotThrow(() => emitter.emit({ userId: 'u1', type: EVENT_DOWNLOAD_COMPLETED, payload: {} }));
  assert.doesNotThrow(() => emitter.broadcastAll(EVENT_SESSION_CLOSED, {}));
});

test('emit is a no-op without a userId', () => {
  const hub = makeRecordingHub();
  const emitter = new LiveEmitter({ hub });
  assert.doesNotThrow(() => emitter.emit({ type: EVENT_DOWNLOAD_COMPLETED, payload: {} }));
  assert.equal(hub.sent.length, 0);
});

test('emit routes an encoded message to the correct user group', () => {
  const hub = makeRecordingHub();
  const emitter = new LiveEmitter({ hub });

  emitter.emit({ userId: 'u42', type: EVENT_DOWNLOAD_COMPLETED, payload: { id: 'dl_1' } });

  assert.equal(hub.sent.length, 1);
  assert.equal(hub.sent[0].userId, 'u42');
  assert.deepEqual(JSON.parse(hub.sent[0].encoded), {
    type: EVENT_DOWNLOAD_COMPLETED,
    payload: { id: 'dl_1' }
  });
});

test('emit delivers to every socket of a user via the hub', () => {
  const delivered = [];
  const hub = {
    sendToUser(userId, encoded) {
      if (userId !== 'u7') return;
      delivered.push(encoded);
    }
  };
  const emitter = new LiveEmitter({ hub });

  emitter.emit({ userId: 'u7', type: EVENT_SESSION_CLOSED, payload: { reason: 'logout' } });

  assert.equal(delivered.length, 1);
  assert.deepEqual(JSON.parse(delivered[0]), {
    type: EVENT_SESSION_CLOSED,
    payload: { reason: 'logout' }
  });
});

test('broadcastAll forwards when the hub supports it', () => {
  const hub = makeRecordingHub();
  const emitter = new LiveEmitter({ hub });

  emitter.broadcastAll(EVENT_DOWNLOAD_COMPLETED, { id: 'dl_x' });

  assert.equal(hub.sent.length, 1);
  assert.equal(hub.sent[0].all, true);
});

test('broadcastAll is a no-op when the hub does not implement it', () => {
  const hub = { sendToUser() {} };
  const emitter = new LiveEmitter({ hub });
  assert.doesNotThrow(() => emitter.broadcastAll(EVENT_DOWNLOAD_COMPLETED, {}));
});

test('emit swallows errors thrown by the hub without re-throwing', () => {
  const hub = {
    sendToUser() {
      throw new Error('socket exploded');
    }
  };
  const emitter = new LiveEmitter({ hub });
  assert.doesNotThrow(() => emitter.emit({ userId: 'u1', type: EVENT_DOWNLOAD_COMPLETED, payload: {} }));
});

test('encode produces the canonical { type, payload } shape', () => {
  const raw = encode(EVENT_DOWNLOAD_COMPLETED, { id: 'dl_9' });
  assert.deepEqual(JSON.parse(raw), { type: EVENT_DOWNLOAD_COMPLETED, payload: { id: 'dl_9' } });
});
