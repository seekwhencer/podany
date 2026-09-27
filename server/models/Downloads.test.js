import '../services/testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMemoryPool } from './memoryPool.js';
import { Downloads } from './Downloads.js';

function build(initial = {}) {
  const pool = makeMemoryPool(initial);
  return { pool, downloads: new Downloads(pool) };
}

test('create inserts a download record', async () => {
  const { downloads, pool } = build();
  await downloads.create({ id: 'dl_1', userId: 'u1', episodeGuid: 'g1', title: 'Ep', audioUrl: 'https://x/a.mp3', status: 'pending' });
  const [row] = pool.tables.downloads;
  assert.equal(row.id, 'dl_1');
  assert.equal(row.episode_guid, 'g1');
  assert.equal(row.user_id, 'u1');
  assert.equal(row.status, 'pending');
});

test('findById / findByIdAndUser resolve by id', async () => {
  const { downloads } = build({ downloads: [
    { id: 'dl_1', user_id: 'u1', episode_guid: 'g1', status: 'pending' }
  ]});
  const found = await downloads.findById('dl_1');
  assert.equal(found.id, 'dl_1');
  assert.equal((await downloads.findByIdAndUser('u1', 'dl_1')).id, 'dl_1');
  assert.equal(await downloads.findByIdAndUser('u2', 'dl_1'), null);
  assert.equal(await downloads.findById('dl_nope'), null);
});

test('findByEpisode still keys on episode_guid (enqueue helper)', async () => {
  const { downloads } = build({ downloads: [
    { id: 'dl_1', user_id: 'u1', episode_guid: 'g1', status: 'pending' }
  ]});
  const found = await downloads.findByEpisode('u1', 'g1');
  assert.equal(found.id, 'dl_1');
  assert.equal(await downloads.findByEpisode('u2', 'g1'), null);
  assert.equal(await downloads.findByEpisode('u1', 'g9'), null);
});

test('update applies provided fields and bumps updated_at', async () => {
  const { downloads, pool } = build({ downloads: [
    { id: 'dl_1', user_id: 'u1', episode_guid: 'g1', status: 'pending', progress: 0, updated_at: 100 }
  ]});
  await downloads.update('dl_1', { status: 'completed', progress: 100 });
  const row = pool.tables.downloads[0];
  assert.equal(row.status, 'completed');
  assert.equal(row.progress, 100);
  assert.ok(row.updated_at > 100);
});

test('listByUser orders by created_at ascending', async () => {
  const { downloads } = build({ downloads: [
    { id: 'dl_2', user_id: 'u1', episode_guid: 'g2', created_at: 200 },
    { id: 'dl_1', user_id: 'u1', episode_guid: 'g1', created_at: 100 },
    { id: 'dl_3', user_id: 'u2', episode_guid: 'g3', created_at: 50 }
  ]});
  const rows = await downloads.listByUser('u1');
  assert.deepEqual(rows.map((r) => r.id), ['dl_1', 'dl_2']);
});

test('listByStatus filters by status', async () => {
  const { downloads } = build({ downloads: [
    { id: 'dl_1', user_id: 'u1', episode_guid: 'g1', status: 'pending', created_at: 1 },
    { id: 'dl_2', user_id: 'u1', episode_guid: 'g2', status: 'completed', created_at: 2 }
  ]});
  const rows = await downloads.listByStatus('pending');
  assert.deepEqual(rows.map((r) => r.id), ['dl_1']);
});

test('remove deletes by id for the owning user (not episode_guid)', async () => {
  const { downloads, pool } = build({ downloads: [
    { id: 'dl_1', user_id: 'u1', episode_guid: 'g1', status: 'pending' },
    { id: 'dl_2', user_id: 'u1', episode_guid: 'g2', status: 'pending' },
    { id: 'dl_3', user_id: 'u2', episode_guid: 'g3', status: 'pending' }
  ]});
  const res = await downloads.remove('u1', 'dl_1');
  assert.equal(res.affectedRows, 1);
  assert.equal(pool.tables.downloads.length, 2);
  assert.ok(!pool.tables.downloads.some((r) => r.id === 'dl_1'));
  const none = await downloads.remove('u1', 'g2');
  assert.equal(none.affectedRows, 0);
  assert.equal(pool.tables.downloads.length, 2);
});

test('deleteById removes a single row by id', async () => {
  const { downloads, pool } = build({ downloads: [
    { id: 'dl_1', user_id: 'u1', episode_guid: 'g1' },
    { id: 'dl_2', user_id: 'u1', episode_guid: 'g2' }
  ]});
  const res = await downloads.deleteById('dl_2');
  assert.equal(res.affectedRows, 1);
  assert.deepEqual(pool.tables.downloads.map((r) => r.id), ['dl_1']);
});

test('remove issues DELETE keyed on the id column', async () => {
  const captured = [];
  const pool = makeMemoryPool();
  const origRun = pool.run.bind(pool);
  pool.run = async (sql, params) => { captured.push({ sql, params }); return origRun(sql, params); };
  const downloads = new Downloads(pool);
  await downloads.remove('u1', 'dl_1');
  assert.match(captured[0].sql, /DELETE FROM downloads WHERE user_id = \? AND id = \?/);
  assert.deepEqual(captured[0].params, ['u1', 'dl_1']);
});
