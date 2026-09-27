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
  async remove(userId, episodeId) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.user_id === userId && r.episode_id === episodeId));
    return { affectedRows: before - this.rows.length };
  }
  async upsert({ id, userId, episodeId, positionSeconds = 0, completed = 0 }) {
    const existing = this.rows.find((r) => r.user_id === userId && r.episode_id === episodeId);
    if (existing) {
      existing.position_seconds = positionSeconds;
      existing.completed = completed;
      existing.last_listened_at = Math.floor(Date.now() / 1000);
    } else {
      this.rows.push({
        id,
        user_id: userId,
        episode_id: episodeId,
        position_seconds: positionSeconds,
        completed,
        last_listened_at: Math.floor(Date.now() / 1000)
      });
    }
    return { affectedRows: 1 };
  }
}

class InMemoryDownloads {
  constructor() {
    this.rows = [];
  }
  generateId(prefix = '') {
    return `${prefix}dl_${this.rows.length + 1}`;
  }
  async findByIdAndUser(userId, id) {
    return this.rows.find((r) => r.id === id && r.user_id === userId) ?? null;
  }
  async findByEpisode(userId, episodeGuid) {
    return this.rows.find((r) => r.user_id === userId && r.episode_guid === episodeGuid) ?? null;
  }
  async create({ id, userId, episodeGuid, status = 'pending' }) {
    this.rows.push({ id, user_id: userId, episode_guid: episodeGuid, status });
    return { affectedRows: 1 };
  }
}

function buildPlayback(deps = {}) {
  const playback = deps.playback ?? new InMemoryPlayback();
  const downloads = deps.downloads ?? new InMemoryDownloads();
  return { service: new PlaybackService({ playback, downloads }), playback, downloads };
}

test('listPositions maps rows to a positions object keyed by episodeId', async () => {
  const { service, downloads } = buildPlayback();
  downloads.rows.push({ id: 'dl-1', user_id: 'u1', episode_guid: 'a' });
  downloads.rows.push({ id: 'dl-2', user_id: 'u1', episode_guid: 'b' });
  await service.savePosition({ userId: 'u1', episodeId: 'dl-1', positionSeconds: 42, completed: false });
  await service.savePosition({ userId: 'u1', episodeId: 'dl-2', positionSeconds: 900, completed: true });
  const result = await service.listPositions('u1');
  assert.deepEqual(Object.keys(result.positions).sort(), ['dl-1', 'dl-2']);
  assert.equal(result.positions['dl-1'].position, 42);
  assert.equal(result.positions['dl-1'].completed, false);
  assert.equal(result.positions['dl-2'].completed, true);
});

test('savePosition upserts the same episode without duplicating rows', async () => {
  const { service, playback } = buildPlayback();
  await service.savePosition({ userId: 'u1', episodeId: 'dl-1', positionSeconds: 10 });
  const result = await service.savePosition({ userId: 'u1', episodeId: 'dl-1', positionSeconds: 20, completed: true });
  assert.equal(result.success, true);
  assert.equal(result.positionSeconds, 20);
  assert.equal(playback.rows.length, 1);
  assert.equal(playback.rows[0].position_seconds, 20);
  assert.equal(playback.rows[0].completed, 1);
});

test('savePosition coerces a non-number position to zero', async () => {
  const { service } = buildPlayback();
  const result = await service.savePosition({ userId: 'u1', episodeId: 'dl-1', positionSeconds: 'garbage' });
  assert.equal(result.positionSeconds, 0);
});

test('savePosition lazily anchors a missing download and keys playback by the new id', async () => {
  const { service, downloads } = buildPlayback();
  const result = await service.savePosition({ userId: 'u1', episodeId: 'ep-anchor', positionSeconds: 7 });
  assert.equal(result.success, true);
  assert.match(result.episodeId, /^dl_/);
  assert.equal(downloads.rows.length, 1);
  assert.equal(downloads.rows[0].episode_guid, 'ep-anchor');
  assert.equal(downloads.rows[0].status, 'pending');
  const positions = await service.listPositions('u1');
  assert.ok(positions.positions[result.episodeId]);
  assert.equal(positions.positions[result.episodeId].position, 7);
});

test('savePosition reuses an existing anchor when the feed guid is sent again', async () => {
  const { service, downloads } = buildPlayback();
  const first = await service.savePosition({ userId: 'u1', episodeId: 'ep-repeat', positionSeconds: 3 });
  const second = await service.savePosition({ userId: 'u1', episodeId: 'ep-repeat', positionSeconds: 9 });
  assert.equal(first.episodeId, second.episodeId);
  assert.equal(downloads.rows.length, 1);
  const positions = await service.listPositions('u1');
  assert.equal(positions.positions[first.episodeId].position, 9);
});

test('savePosition uses an existing download id directly without anchoring', async () => {
  const { service, downloads } = buildPlayback();
  downloads.rows.push({ id: 'dl_existing', user_id: 'u1', episode_guid: 'ep-x' });
  const result = await service.savePosition({ userId: 'u1', episodeId: 'dl_existing', positionSeconds: 1 });
  assert.equal(result.episodeId, 'dl_existing');
  assert.equal(downloads.rows.length, 1);
});

test('removePosition deletes the playback row keyed by episodeId', async () => {
  const { service, playback } = buildPlayback();
  const saved = await service.savePosition({ userId: 'u1', episodeId: 'dl-1', positionSeconds: 5 });
  const result = await service.removePosition('u1', saved.episodeId);
  assert.equal(result.success, true);
  assert.equal(result.episodeId, saved.episodeId);
  assert.equal(playback.rows.length, 0);
});
