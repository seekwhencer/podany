import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Downloads } from '../models/Downloads.js';
import { isValidExternalUrl } from '../utils/url.js';
import { ImageService } from './imageService.js';

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_CONCURRENCY = 4;

export class DownloadsService {
    constructor(deps = {}) {
        this.downloads = deps.downloads ?? new Downloads();
        this.storageDir = deps.storageDir ?? deps.config?.episodesStorageDir;
        this.retentionDays = deps.retentionDays ?? DEFAULT_RETENTION_DAYS;
        this.fetchImpl = deps.fetch ?? globalThis.fetch;
        this.concurrency = this._resolveConcurrency(deps);
        this.images = deps.imageService ?? new ImageService(deps.config);
        this.queue = [];
        this.activeCount = 0;
    }

    _resolveConcurrency(deps) {
        const raw = deps.concurrency != null
            ? deps.concurrency
            : (deps.config?.downloadConcurrency ?? DEFAULT_CONCURRENCY);
        const value = Number.parseInt(raw, 10);
        return Number.isFinite(value) && value > 0 ? value : 1;
    }

    enqueue(record) {
        if (!record) return record;
        this.queue.push(record);
        this._processQueue();
        return record;
    }

    _processQueue() {
        while (this.activeCount < this.concurrency && this.queue.length > 0) {
            const record = this.queue.shift();
            this.activeCount += 1;
            this.startDownload(record).finally(() => {
                this.activeCount -= 1;
                this._processQueue();
            });
        }
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

    async register({ userId, episodeGuid, title = '', audioUrl = null, subscriptionId = null, artwork = '' }) {
        if (audioUrl && !isValidExternalUrl(audioUrl)) {
            throw new Error('Invalid or disallowed audio URL.');
        }
        let image = '';
        if (artwork) {
            try {
                image = await this.images.downloadAndGenerate(artwork);
            } catch (err) {
                console.error(`[server] Could not generate artwork thumbnail for episode ${episodeGuid}:`, err.message);
            }
        }
        const id = this.downloads.generateId('dl_');
        await this.downloads.create({
            id,
            userId,
            episodeGuid,
            subscriptionId,
            title,
            artwork,
            image,
            audioUrl,
            filePath: null,
            fileSize: 0,
            status: 'pending',
            progress: 0
        });
        const created = await this.downloads.findById(id);
        this.enqueue(created);
        return created;
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
            } catch (e) { }
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
        } catch (e) { }
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
