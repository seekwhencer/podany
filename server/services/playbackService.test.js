import './testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackService } from './playbackService.js';

class InMemoryPlayback {
  constructor() {
    this.rows = [];
  }
  generateId(prefix = '') {
    return `${prefix}pos_${this.rows.length + 1}`;
  }
  async listByUser(userId) {
    return this.rows.filter((r) => r.user_id === userId);
  }
  async upsert({ id, userId, episodeGuid, positionSeconds = 0, completed = 0 }) {
    const existing = this.rows.find((r) => r.user_id === userId && r.episode_guid === episodeGuid);
    if (existing) {
      existing.position_seconds = positionSeconds;
      existing.completed = completed;
      existing.last_listened_at = Math.floor(Date.now() / 1000);
    } else {
      this.rows.push({
        id,
        user_id: userId,
        episode_guid: episodeGuid,
        position_seconds: positionSeconds,
        completed,
        last_listened_at: Math.floor(Date.now() / 1000)
      });
    }
    return { affectedRows: 1 };
  }
}

function buildPlayback(deps = {}) {
  const playback = deps.playback ?? new InMemoryPlayback();
  return { service: new PlaybackService({ playback }), playback };
}

test('listPositions maps rows to a positions object keyed by episode guid', async () => {
  const { service } = buildPlayback();
  await service.savePosition({ userId: 'u1', episodeGuid: 'ep-1', positionSeconds: 42, completed: false });
  await service.savePosition({ userId: 'u1', episodeGuid: 'ep-2', positionSeconds: 900, completed: true });
  const result = await service.listPositions('u1');
  assert.deepEqual(Object.keys(result.positions).sort(), ['ep-1', 'ep-2']);
  assert.equal(result.positions['ep-1'].position, 42);
  assert.equal(result.positions['ep-1'].completed, false);
  assert.equal(result.positions['ep-2'].completed, true);
});

test('savePosition upserts the same episode without duplicating rows', async () => {
  const { service, playback } = buildPlayback();
  await service.savePosition({ userId: 'u1', episodeGuid: 'ep-1', positionSeconds: 10 });
  const result = await service.savePosition({ userId: 'u1', episodeGuid: 'ep-1', positionSeconds: 20, completed: true });
  assert.equal(result.success, true);
  assert.equal(result.positionSeconds, 20);
  assert.equal(playback.rows.length, 1);
  assert.equal(playback.rows[0].position_seconds, 20);
  assert.equal(playback.rows[0].completed, 1);
});

test('savePosition coerces a non-number position to zero', async () => {
  const { service } = buildPlayback();
  const result = await service.savePosition({ userId: 'u1', episodeGuid: 'ep-1', positionSeconds: 'garbage' });
  assert.equal(result.positionSeconds, 0);
});
