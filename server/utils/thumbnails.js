import path from 'path';

/**
 * Zentrale Konfiguration & Hilfsfunktionen für Thumbnails (Aufgabe 4.1).
 *
 * Vermeidet die bisherige Dopplung der Größen-Defaultliste und des
 * baseName-Parsings in upload.js, thumbnails.js und den Routen.
 */

/**
 * Standard-Thumbnail-Größen.
 * `width`/`height` === null bedeutet "keine Skalierung" (Originalgröße).
 */
export const DEFAULT_THUMBNAIL_SIZES = [
    { width: 150, height: 150, suffix: 'thumb', fit: 'cover' },
    { width: 400, height: 400, suffix: 'medium', fit: 'cover' },
    { width: 800, height: 800, suffix: 'large', fit: 'cover' },
    { width: null, height: null, suffix: 'full', fit: 'cover' }
];

const IMAGE_MAGIC_BYTES = [
    // JPEG: FF D8 FF
    { ext: '.jpg', mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    { ext: '.png', mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    // GIF: GIF87a / GIF89a
    { ext: '.gif', mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },
    { ext: '.gif', mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
    // WEBP: RIFF....WEBP
    { ext: '.webp', mime: 'image/webp', bytes: [0x49, 0x52, 0x46, 0x46, 0x2e, 0x32, 0x34, 0x30, 0x57, 0x45, 0x42, 0x50] },
    // BMP: BM
    { ext: '.bmp', mime: 'image/bmp', bytes: [0x42, 0x4d] }
];

export function getMagicBytes() {
    return IMAGE_MAGIC_BYTES;
}

/**
 * Liefert die konfigurierten Größen oder die Defaultliste.
 *
 * @param {object} [config]
 * @returns {Array<{width:number|null,height:number|null,suffix:string,fit:string}>}
 */
export function getThumbnailSizes(config) {
    if (Array.isArray(config?.thumbnails?.sizes) && config.thumbnails.sizes.length > 0) {
        return config.thumbnails.sizes;
    }
    return DEFAULT_THUMBNAIL_SIZES;
}

/**
 * Baut das Map von URL-Segmentsnamen auf Dateisuffix abgeleitet aus den
 * Thumbnail-Größen (konfiguriert oder Default). Der Segmentname entspricht
 * dem Suffix. Ein Size mit width/height === null (keine Skalierung, z. B.
 * "full") liefert null.
 *
 * @param {object} [config]
 * @returns {Record<string, string|null>}
 */
export function getSizeMap(config) {
    const map = {};
    for (const size of getThumbnailSizes(config)) {
        map[size.suffix] = size.width === null ? null : size.suffix;
    }
    return map;
}

/**
 * Liefert die gültige URL-Segmentsnamen für Thumbnails.
 *
 * @param {object} [config]
 * @returns {string[]}
 */
export function getAllowedSizes(config) {
    return Object.keys(getSizeMap(config));
}

/**
 * Liefert das Dateisuffix für einen URL-Segmentsnamen.
 *
 * @param {string} sizename
 * @param {object} [config]
 * @returns {string|null}
 */
export function getSizeSuffix(sizename, config) {
    return getSizeMap(config)[sizename] ?? null;
}

/**
 * Normalisiert eine Datei auf ihren Basisnamen (ohne Präfix wie
 * "thumb-", "small-" etc. und ohne Endung). Entfernt ein führendes
 * Kleinbuchstaben-Präfix gefolgt von einem Bindestrich.
 *
 * @param {string} filename
 * @returns {{baseName:string, ext:string}}
 */
export function parseBaseName(filename) {
    const ext = path.extname(filename);
    const nameWithoutExt = path.basename(filename, ext);
    const baseName = nameWithoutExt.replace(/^[a-z]+-/, '');
    return { baseName, ext };
}

