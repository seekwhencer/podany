import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import sharp from 'sharp';

import { resolveFolder } from '../utils/resolveFolder.js';
import { getThumbnailSizes, parseBaseName, getMagicBytes } from '../utils/thumbnails.js';
import { isValidExternalUrl } from '../utils/url.js';

const USER_AGENT = 'Podany/1.0 (+SelfHosted)';

// Magic-Bytes für unterstützte Bildformate (Aufgabe 5.3: Mime-Type-Whitelist
// statt reinem `startsWith('image/')`-Check).

export class ImageService {
    constructor(config = null) {
        this.config = config;
        this.storageFolder = resolveFolder(config?.imageStorageDir);
        this.thumbnailFolder = resolveFolder(config?.thumbnailStorageDir);

        this.thumbnailSizes = getThumbnailSizes(config);
        this.storage = this.createStorage();
        this.fetchImpl = config?.fetch ?? globalThis.fetch;

        this.ensureDirectories();
    }

    async ensureDirectories() {
        await fs.mkdir(this.storageFolder, { recursive: true });
        await fs.mkdir(this.thumbnailFolder, { recursive: true });
    }

    createStorage() {
        return { folder: this.storageFolder };
    }

    // Prüft, ob ein Mime-Type in der Whitelist ist (Aufgabe 5.3).
    isImageFile(mimeType) {
        return !!mimeType && getMagicBytes().some((entry) => entry.mime === mimeType);
    }

    // Leitet aus den Magic Bytes eines Buffers die Dateierweiterung ab.
    extensionFromBytes(buffer) {
        const bytes = Array.from(buffer.subarray(0, 12));
        for (const entry of getMagicBytes()) {
            if (entry.bytes.every((b, i) => bytes[i] === b)) return entry.ext;
        }
        return null;
    }

    async fetchImage(url) {
        if (!isValidExternalUrl(url)) {
            throw new Error('Invalid or disallowed artwork URL.');
        }
        const response = await this.fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
        if (!response.ok) {
            throw new Error(`Upstream HTTP ${response.status}`);
        }
        return response;
    }

    // Lädt ein Bild herunter, speichert das Original in storageFolder und
    // generiert Thumbnails in thumbnailFolder (Aufgabe 3.2). Der Rückgabewert
    // ist der gehashte Bildname (ohne Endung) und dient als Bezeichner für
    // die gespeicherten Dateien.
    async downloadAndGenerate(url) {
        const response = await this.fetchImage(url);
        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = this.extensionFromBytes(buffer) || '.jpg';
        const name = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

        const storageFilename = `${name}${ext}`;
        const storagePath = path.join(this.storageFolder, storageFilename);
        await fs.mkdir(this.storageFolder, { recursive: true });
        await fs.writeFile(storagePath, buffer);

        await this.generateThumbnails(storagePath, storageFilename);

        return name;
    }

    // Generiert Thumbnails für eine Datei (Aufgabe 3.2).
    async generateThumbnails(filePath, filename) {
        const { baseName } = parseBaseName(filename);
        await fs.mkdir(this.thumbnailFolder, { recursive: true });
        
        for (const size of this.thumbnailSizes) {
            const thumbnailFilename = `${baseName}-${size.suffix}.jpg`;
            const thumbnailPath = path.join(this.thumbnailFolder, thumbnailFilename);

            try {
                let operation = sharp(filePath).rotate();
                if (size.width != null || size.height != null) {
                    operation = operation.resize(size.width, size.height, {
                        fit: size?.fit || 'cover',
                        position: 'center'
                    });
                }
                await operation.jpeg().toFile(thumbnailPath);
            } catch (error) {
                console.error(`Fehler beim Generieren des Thumbnails (${size.suffix}):`, error.message);
            }
        }
    }
}

export default ImageService;
