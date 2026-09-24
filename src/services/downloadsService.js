import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Downloads } from '../models/Downloads.js';
import { isValidExternalUrl } from '../utils/url.js';

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_STORAGE_DIR = path.join(process.cwd(), 'downloads');

export class DownloadsService {
  constructor(deps = {}) {
    this.downloads = deps.downloads ?? new Downloads();
    this.storageDir = deps.storageDir ?? DEFAULT_STORAGE_DIR;
    this.retentionDays = deps.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.fetchImpl = deps.fetch ?? globalThis.fetch;
  }

  async listByUser(userId) {
    return this.downloads.listByUser(userId);
  }

  async get(userId, episodeGuid) {
    return this.downloads.findByEpisode(userId, episodeGuid);
  }

  async findById(id) {
    return this.downloads.findById(id);
  }

  async register({ userId, episodeGuid, title = '', audioUrl = null }) {
    if (audioUrl && !isValidExternalUrl(audioUrl)) {
      throw new Error('Invalid or disallowed audio URL.');
    }
    const id = this.downloads.generateId('dl_');
    await this.downloads.create({
      id,
      userId,
      episodeGuid,
      title,
      audioUrl,
      filePath: null,
      fileSize: 0,
      status: 'pending',
      progress: 0
    });
    return this.downloads.findById(id);
  }

  async startDownload(record) {
    if (!record) throw new Error('Download record not found.');
    const audioUrl = record.audioUrl || record.audio_url;
    if (!audioUrl || !isValidExternalUrl(audioUrl)) {
      await this.downloads.update(record.id, { status: 'failed', error: 'Invalid or disallowed audio URL.' });
      return this.downloads.findById(record.id);
    }

    const filePath = path.join(this.storageDir, `${record.id}.mp3`);
    try {
      const response = await this.fetchImpl(audioUrl, {
        headers: { 'User-Agent': 'Podany/1.0 (+SelfHosted)' }
      });

      if (!response.ok || !response.body) {
        await this.downloads.update(record.id, {
          status: 'failed',
          error: `Upstream HTTP ${response.status}`
        });
        return this.downloads.findById(record.id);
      }

      await fs.mkdir(this.storageDir, { recursive: true });
      let size = 0;
      const sink = createWriteStream(filePath);
      try {
        for await (const chunk of response.body) {
          sink.write(chunk);
          size += Buffer.byteLength(chunk);
        }
      } finally {
        await new Promise((resolve, reject) => {
          sink.end((err) => (err ? reject(err) : resolve()));
        });
      }

      await this.downloads.update(record.id, {
        status: 'completed',
        file_path: filePath,
        file_size: size,
        progress: 100,
        received_at: Math.floor(Date.now() / 1000)
      });
    } catch (err) {
      await this.downloads.update(record.id, { status: 'failed', error: String(err.message || err) });
      try {
        await fs.rm(filePath, { force: true });
      } catch (e) {}
    }

    return this.downloads.findById(record.id);
  }

  async remove(userId, episodeGuid) {
    const record = await this.downloads.findByEpisode(userId, episodeGuid);
    await this.downloads.remove(userId, episodeGuid);
    if (record && record.file_path) {
      await this.deleteFile(record.file_path);
    }
    return { success: true, removed: episodeGuid };
  }

  async deleteById(id) {
    const record = await this.downloads.findById(id);
    await this.downloads.deleteById(id);
    if (record && record.file_path) {
      await this.deleteFile(record.file_path);
    }
    return { success: true, id };
  }

  async deleteFile(filePath) {
    try {
      await fs.rm(filePath, { force: true });
    } catch (e) {}
  }

  async cleanup(maxAgeDays = this.retentionDays) {
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeDays * 24 * 60 * 60;
    const all = await this.downloads.find(
      'SELECT * FROM downloads WHERE updated_at IS NOT NULL AND updated_at < ?',
      [cutoff]
    );
    const removed = [];
    for (const record of all) {
      if (record.file_path) await this.deleteFile(record.file_path);
      await this.downloads.deleteById(record.id);
      removed.push(record.id);
    }
    return { removed };
  }
}

export default DownloadsService;
