import '../services/testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMemoryPool } from './memoryPool.js';
import { PlaybackState } from './PlaybackState.js';

function build(initial = {}) {
  const pool = makeMemoryPool(initial);
  return { pool, playback: new PlaybackState(pool) };
}

test('listByUser returns rows keyed by episode_id', async () => {
  const { playback } = build({ playback_state: [
    { id: 'dl_1', user_id: 'u1', episode_id: 'dl_1', position_seconds: 10, completed: 0, last_listened_at: 1 },
    { id: 'dl_2', user_id: 'u1', episode_id: 'dl_2', position_seconds: 20, completed: 1, last_listened_at: 2 },
    { id: 'dl_3', user_id: 'u2', episode_id: 'dl_3', position_seconds: 5, completed: 0, last_listened_at: 3 }
  ]});
  const rows = await playback.listByUser('u1');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.episode_id).sort(), ['dl_1', 'dl_2']);
  assert.ok(!('episode_guid' in rows[0]), 'projection excludes episode_guid');
});

test('findByEpisode looks up by episode_id only for the owning user', async () => {
  const { playback } = build({ playback_state: [
    { id: 'dl_1', user_id: 'u1', episode_id: 'dl_1', episode_guid: 'g1', position_seconds: 42, completed: 0, last_listened_at: 1 }
  ]});
  const found = await playback.findByEpisode('u1', 'dl_1');
  assert.equal(found.episode_id, 'dl_1');
  assert.equal(found.position_seconds, 42);
  assert.equal(await playback.findByEpisode('u2', 'dl_1'), null);
  assert.equal(await playback.findByEpisode('u1', 'dl_999'), null);
});

test('upsert inserts a new row keyed by episode_id', async () => {
  const { playback, pool } = build();
  await playback.upsert({ id: 'pos_1', userId: 'u1', episodeId: 'dl_1', positionSeconds: 42, completed: 1 });
  const [row] = pool.tables.playback_state;
  assert.equal(row.episode_id, 'dl_1');
  assert.equal(row.position_seconds, 42);
  assert.equal(row.completed, 1);
  assert.equal(row.user_id, 'u1');
});

test('upsert updates the existing row on primary-key conflict', async () => {
  const { playback, pool } = build({ playback_state: [
    { id: 'pos_1', user_id: 'u1', episode_id: 'dl_1', position_seconds: 10, completed: 0, last_listened_at: 1 }
  ]});
  await playback.upsert({ id: 'pos_1', userId: 'u1', episodeId: 'dl_1', positionSeconds: 99, completed: 1 });
  assert.equal(pool.tables.playback_state.length, 1);
  assert.equal(pool.tables.playback_state[0].position_seconds, 99);
  assert.equal(pool.tables.playback_state[0].completed, 1);
});

test('remove deletes the row by episode_id for the user', async () => {
  const { playback, pool } = build({ playback_state: [
    { id: 'pos_1', user_id: 'u1', episode_id: 'dl_1', position_seconds: 10, completed: 0, last_listened_at: 1 },
    { id: 'pos_2', user_id: 'u1', episode_id: 'dl_2', position_seconds: 10, completed: 0, last_listened_at: 1 },
    { id: 'pos_3', user_id: 'u2', episode_id: 'dl_3', position_seconds: 10, completed: 0, last_listened_at: 1 }
  ]});
  const res = await playback.remove('u1', 'dl_1');
  assert.equal(res.affectedRows, 1);
  assert.equal(pool.tables.playback_state.length, 2);
  assert.ok(!pool.tables.playback_state.some((r) => r.episode_id === 'dl_1'));
});

test('upsert issues INSERT referencing the episode_id column', async () => {
  const captured = [];
  const pool = makeMemoryPool();
  const origRun = pool.run.bind(pool);
  pool.run = async (sql, params) => { captured.push({ sql, params }); return origRun(sql, params); };
  const playback = new PlaybackState(pool);
  await playback.upsert({ id: 'pos_1', userId: 'u1', episodeId: 'dl_1', positionSeconds: 5 });
  assert.match(captured[0].sql, /INSERT INTO playback_state \([^)]*episode_id[^)]*\)/);
  assert.equal(captured[0].params[2], 'dl_1');
});
