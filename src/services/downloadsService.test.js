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
  async create({ id, userId, episodeGuid, title = '', audioUrl = null, filePath = null, fileSize = 0, status = 'pending', progress = 0 }) {
    const now = Math.floor(Date.now() / 1000);
    this.rows.push({
      id,
      user_id: userId,
      episode_guid: episodeGuid,
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

async function buildDownloads() {
  const downloads = new InMemoryDownloads();
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'podany-dl-'));
  const service = new DownloadsService({ downloads, storageDir });
  return { service, downloads, storageDir };
}

test('register creates a pending download record and rejects invalid audio urls', async () => {
  const { service, downloads } = await buildDownloads();
  const record = await service.register({ userId: 'u1', episodeGuid: 'ep-1', title: 'Ep One', audioUrl: 'https://cdn.example.com/ep1.mp3' });
  assert.match(record.id, /^dl_/);
  assert.equal(record.status, 'pending');
  assert.equal(record.audio_url, 'https://cdn.example.com/ep1.mp3');
  assert.equal(downloads.rows.length, 1);
  await assert.rejects(
    () => service.register({ userId: 'u1', episodeGuid: 'ep-2', audioUrl: 'http://localhost/secret.mp3' }),
    /Invalid or disallowed audio URL/
  );
});

test('startDownload streams the file to disk and marks the record completed', async () => {
  const { service, downloads, storageDir } = await buildDownloads();
  const record = await service.register({ userId: 'u1', episodeGuid: 'ep-1', audioUrl: 'https://cdn.example.com/ep1.mp3' });
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://cdn.example.com/ep1.mp3');
    return { ok: true, status: 200, body: makeBody([Buffer.from('abcdef'), Buffer.from('ghijkl')]) };
  };
  service.fetchImpl = fetchImpl;

  const done = await service.startDownload(record);
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
  const record = await service.register({ userId: 'u1', episodeGuid: 'ep-1', audioUrl: 'https://cdn.example.com/ep1.mp3' });
  service.fetchImpl = async () => ({ ok: true, status: 200, body: makeBody([Buffer.from('data')]) });
  const done = await service.startDownload(record);
  assert.ok(done.file_path);

  const result = await service.remove('u1', 'ep-1');
  assert.equal(result.success, true);
  assert.equal(downloads.rows.length, 0);
  await assert.rejects(() => fs.access(done.file_path));
});

test('cleanup removes expired records and their files', async () => {
  const { service, downloads } = await buildDownloads();
  const record = await service.register({ userId: 'u1', episodeGuid: 'ep-1', audioUrl: 'https://cdn.example.com/ep1.mp3' });
  service.fetchImpl = async () => ({ ok: true, status: 200, body: makeBody([Buffer.from('old')]) });
  const done = await service.startDownload(record);
  assert.ok(done.file_path);

  for (const row of downloads.rows) {
    row.updated_at = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;
  }

  const result = await service.cleanup(30);
  assert.deepEqual(result.removed, [record.id]);
  assert.equal(downloads.rows.length, 0);
  await assert.rejects(() => fs.access(done.file_path));
});
