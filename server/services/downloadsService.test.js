import './testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DownloadsService } from './downloadsService.js';

class InMemoryDownloads {
  constructor() {
    this.rows = [];
  }
  generateId(prefix = '') {
    return `${prefix}dl_${this.rows.length + 1}`;
  }
  async create({ id, userId, episodeGuid, subscriptionId = null, title = '', audioUrl = null, filePath = null, fileSize = 0, status = 'pending', progress = 0 }) {
    const now = Math.floor(Date.now() / 1000);
    this.rows.push({
      id,
      user_id: userId,
      episode_guid: episodeGuid,
      subscription_id: subscriptionId,
      title,
      audio_url: audioUrl,
      file_path: filePath,
      file_size: fileSize,
      status,
      progress,
      error: null,
      created_at: now,
      updated_at: now,
      received_at: null
    });
    return { affectedRows: 1 };
  }
  async findById(id) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findByEpisode(userId, episodeGuid) {
    return this.rows.find((r) => r.user_id === userId && r.episode_guid === episodeGuid) ?? null;
  }
  async update(id, fields = {}) {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, fields);
    return { affectedRows: row ? 1 : 0 };
  }
  async listByUser(userId) {
    return this.rows.filter((r) => r.user_id === userId);
  }
  async find(sql, params = []) {
    if (sql.includes('updated_at < ?')) {
      const cutoff = params[0];
      return this.rows.filter((r) => r.updated_at !== null && r.updated_at < cutoff);
    }
    return [];
  }
  async remove(userId, episodeGuid) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.user_id === userId && r.episode_guid === episodeGuid));
    return { affectedRows: before - this.rows.length };
  }
  async deleteById(id) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return { affectedRows: before - this.rows.length };
  }
}

function makeBody(chunks) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    }
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeout = 2000) {
  const start = Date.now();
  for (;;) {
    const result = await predicate();
    if (result) return result;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await delay(5);
  }
}

async function buildDownloads() {
  const downloads = new InMemoryDownloads();
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'podany-dl-'));
  const service = new DownloadsService({ downloads, storageDir });
  return { service, downloads, storageDir };
}

test('register creates a pending download record and rejects invalid audio urls', async () => {
  const { service, downloads } = await buildDownloads();
  service.fetchImpl = async () => ({ ok: true, status: 200, body: makeBody([]) });
  const record = await service.register({ userId: 'u1', episodeGuid: 'ep-1', title: 'Ep One', audioUrl: 'https://cdn.example.com/ep1.mp3' });
  assert.match(record.id, /^dl_/);
  assert.equal(record.status, 'pending');
  assert.equal(record.audio_url, 'https://cdn.example.com/ep1.mp3');
  assert.equal(downloads.rows.length, 1);
  assert.equal(record.subscription_id, null);
  await assert.rejects(
    () => service.register({ userId: 'u1', episodeGuid: 'ep-2', audioUrl: 'http://localhost/secret.mp3' }),
    /Invalid or disallowed audio URL/
  );
});

test('register links a download to its subscription id and still auto-starts', async () => {
  const { service, downloads } = await buildDownloads();
  service.fetchImpl = async () => ({ ok: true, status: 200, body: makeBody([]) });
  const record = await service.register({ userId: 'u1', episodeGuid: 'ep-1', title: 'Ep One', audioUrl: 'https://cdn.example.com/ep1.mp3', subscriptionId: 'sub_123' });
  assert.equal(record.subscription_id, 'sub_123');
  assert.equal(downloads.rows[0].subscription_id, 'sub_123');
  assert.equal(record.status, 'pending');
});


test('register starts an automatic download that streams the file to disk', async () => {
  const { service, downloads, storageDir } = await buildDownloads();
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://cdn.example.com/ep1.mp3');
    return { ok: true, status: 200, body: makeBody([Buffer.from('abcdef'), Buffer.from('ghijkl')]) };
  };
  service.fetchImpl = fetchImpl;

  const record = await service.register({ userId: 'u1', episodeGuid: 'ep-1', audioUrl: 'https://cdn.example.com/ep1.mp3' });
  assert.equal(record.status, 'pending');
  const done = await waitFor(async () => {
    const row = await downloads.findById(record.id);
    return row && row.status === 'completed' ? row : null;
  });
  assert.equal(done.status, 'completed');
  assert.equal(done.file_size, 12);
  assert.equal(done.progress, 100);
  assert.ok(done.received_at > 0);
  assert.equal(path.dirname(done.file_path), storageDir);
  const content = await fs.readFile(done.file_path);
  assert.equal(content.toString(), 'abcdefghijkl');
  assert.equal(downloads.rows[0].status, 'completed');
});

test('startDownload marks the record failed and removes partial files on upstream errors', async () => {
  const { service, downloads } = await buildDownloads();
  const record = await service.register({ userId: 'u1', episodeGuid: 'ep-1', audioUrl: 'https://cdn.example.com/ep1.mp3' });
  service.fetchImpl = async () => ({ ok: false, status: 503, body: null });

  const done = await service.startDownload(record);
  assert.equal(done.status, 'failed');
  assert.match(done.error, /Upstream HTTP 503/);
  assert.equal(downloads.rows[0].status, 'failed');
});

test('startDownload fails fast for disallowed urls without fetching', async () => {
  const { service, downloads } = await buildDownloads();
  const now = Math.floor(Date.now() / 1000);
  downloads.rows.push({
    id: 'dl_x',
    user_id: 'u1',
    episode_guid: 'ep-9',
    title: '',
    audio_url: 'http://169.254.169.254/latest/meta-data',
    file_path: null,
    file_size: 0,
    status: 'pending',
    progress: 0,
    error: null,
    created_at: now,
    updated_at: now,
    received_at: null
  });
  const record = await downloads.findById('dl_x');
  let fetchCalls = 0;
  service.fetchImpl = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200, body: makeBody([]) };
  };
  const done = await service.startDownload(record);
  assert.equal(done.status, 'failed');
  assert.equal(fetchCalls, 0);
});

test('remove deletes the row and the stored file', async () => {
  const { service, downloads } = await buildDownloads();
  service.fetchImpl = async () => ({ ok: true, status: 200, body: makeBody([Buffer.from('data')]) });
  const record = await service.register({ userId: 'u1', episodeGuid: 'ep-1', audioUrl: 'https://cdn.example.com/ep1.mp3' });
  const done = await waitFor(async () => {
    const row = await downloads.findById(record.id);
    return row && row.file_path ? row : null;
  });
  assert.ok(done.file_path);

  const result = await service.remove('u1', 'ep-1');
  assert.equal(result.success, true);
  assert.equal(downloads.rows.length, 0);
  await assert.rejects(() => fs.access(done.file_path));
});

test('cleanup removes expired records and their files', async () => {
  const { service, downloads } = await buildDownloads();
  service.fetchImpl = async () => ({ ok: true, status: 200, body: makeBody([Buffer.from('old')]) });
  const record = await service.register({ userId: 'u1', episodeGuid: 'ep-1', audioUrl: 'https://cdn.example.com/ep1.mp3' });
  const done = await waitFor(async () => {
    const row = await downloads.findById(record.id);
    return row && row.file_path ? row : null;
  });
  assert.ok(done.file_path);

  for (const row of downloads.rows) {
    row.updated_at = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;
  }

  const result = await service.cleanup(30);
  assert.deepEqual(result.removed, [record.id]);
  assert.equal(downloads.rows.length, 0);
  await assert.rejects(() => fs.access(done.file_path));
});

test('register triggers an automatic download without an explicit start call', async () => {
  const { service, downloads } = await buildDownloads();
  let started = false;
  service.fetchImpl = async () => {
    started = true;
    return { ok: true, status: 200, body: makeBody([Buffer.from('x')]) };
  };
  const record = await service.register({ userId: 'u1', episodeGuid: 'ep-1', audioUrl: 'https://cdn.example.com/ep.mp3' });
  assert.equal(record.status, 'pending');
  await waitFor(async () => started && (await downloads.findById(record.id))?.status === 'completed');
  assert.equal(started, true);
  assert.equal((await downloads.findById(record.id)).status, 'completed');
});

test('queue limits concurrent downloads to downloadConcurrency', async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'podany-dl-'));
  const downloads = new InMemoryDownloads();
  const service = new DownloadsService({ downloads, storageDir, config: { downloadConcurrency: 2 } });

  let inFlight = 0;
  let maxInFlight = 0;
  let releaseAll = () => {};
  const gate = new Promise((resolve) => (releaseAll = resolve));
  service.fetchImpl = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await gate;
    inFlight -= 1;
    return { ok: true, status: 200, body: makeBody([Buffer.from('x')]) };
  };

  for (let i = 0; i < 6; i += 1) {
    await service.register({ userId: 'u1', episodeGuid: `ep-${i}`, audioUrl: 'https://cdn.example.com/ep.mp3' });
  }

  await delay(50);
  assert.equal(maxInFlight, 2);

  releaseAll();
  await waitFor(() => downloads.rows.every((row) => row.status === 'completed'));
  assert.equal(downloads.rows.length, 6);
  assert.equal(downloads.rows.filter((row) => row.status === 'completed').length, 6);
});

test('queue drains in FIFO order when concurrency is 1', async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'podany-dl-'));
  const downloads = new InMemoryDownloads();
  const service = new DownloadsService({ downloads, storageDir, config: { downloadConcurrency: 1 } });

  const startedUrls = [];
  let releaseAll = () => {};
  const gate = new Promise((resolve) => (releaseAll = resolve));
  service.fetchImpl = async (url) => {
    startedUrls.push(url);
    await gate;
    return { ok: true, status: 200, body: makeBody([Buffer.from('x')]) };
  };

  for (let i = 0; i < 3; i += 1) {
    await service.register({ userId: 'u1', episodeGuid: `ep-${i}`, audioUrl: `https://cdn.example.com/ep-${i}.mp3` });
  }

  await delay(50);
  assert.equal(startedUrls.length, 1);
  releaseAll();
  await waitFor(() => downloads.rows.every((row) => row.status === 'completed'));
  assert.deepEqual(startedUrls, [
    'https://cdn.example.com/ep-0.mp3',
    'https://cdn.example.com/ep-1.mp3',
    'https://cdn.example.com/ep-2.mp3'
  ]);
});
