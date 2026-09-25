import path from 'path';

// Basispfad für relative Pfade = Verzeichnis, aus dem der Server gestartet wurde.
const __rootPath = process.cwd();

// Prüft, dass ein optionaler Parameter ein nicht-leerer String ist.
function validateParam(name, value) {
    if (value !== null && value !== undefined && typeof value !== 'string') {
        throw new TypeError(`Erwarteter String für ${name}, erhalten: ${typeof value}`);
    }
    if (typeof value === 'string' && value.trim() === '') {
        throw new Error(`${name} darf nicht leer sein`);
    }
}

/**
 * Löst einen Konfigurationspfad auf.
 *
 * - Absolute Pfade werden 1:1 übernommen und dürfen auch außerhalb des
 *   Projektordners (process.cwd()) liegen.
 * - Relative Pfade werden relativ zu process.cwd() aufgelöst.
 * - Ein absoluter subDir ersetzt den Basisordner vollständig; ein relativer
 *   subDir wird an den (ggf. absoluten) Basisordner angehängt.
 */
export function resolveFolder(dir = null, subDir = null) {
    validateParam('dir', dir);
    validateParam('subDir', subDir);

    let base = __rootPath;

    if (dir) {
        base = path.isAbsolute(dir) ? dir : path.join(base, dir);
    }
    if (subDir) {
        base = path.isAbsolute(subDir) ? subDir : path.join(base, subDir);
    }

    return path.resolve(base);
}
