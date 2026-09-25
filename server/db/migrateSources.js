import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Source tables that are migrated into the MariaDB target schema, with the
// target columns to keep (in order) and the primary-key column used to skip
// the ON DUPLICATE KEY UPDATE clause. Timestamps are Unix epoch seconds in both
// D1/SQLite and MariaDB, so values pass through unchanged.
export const TABLE_MIGRATIONS = {
  users: { columns: ['id', 'email', 'created_at'], pk: 'id' },
  auth_tokens: { columns: ['token_hash', 'user_id', 'expires_at', 'used', 'created_at'], pk: 'token_hash' },
  subscriptions: { columns: ['id', 'user_id', 'feed_url', 'title', 'created_at'], pk: 'id' },
  playback_state: { columns: ['id', 'user_id', 'episode_guid', 'position_seconds', 'completed', 'last_listened_at'], pk: 'id' }
};

// Present in the D1 source but intentionally NOT migrated into MariaDB.
// Sessions are kept in-memory (express-session) and downloads are a new feature.
export const SKIPPED_TABLES = new Set(['user_sessions', 'downloads']);

// Source column order per table, used to map positional VALUES from a SQL dump
// that omits an explicit column list. Matches the D1/SQLite schema exactly.
export const SOURCE_COLUMN_ORDER = {
  users: ['id', 'email', 'created_at'],
  auth_tokens: ['token_hash', 'user_id', 'expires_at', 'used', 'created_at'],
  user_sessions: ['session_hash', 'user_id', 'expires_at', 'created_at'],
  subscriptions: ['id', 'user_id', 'feed_url', 'title', 'artwork', 'created_at'],
  playback_state: ['id', 'user_id', 'episode_guid', 'position_seconds', 'completed', 'last_listened_at']
};

// Columns whose values are numeric (Unix epoch seconds or counts). Everything
// else is stringified.
export const NUMERIC_COLUMNS = new Set([
  'created_at', 'expires_at', 'last_listened_at', 'used', 'completed',
  'position_seconds', 'file_size', 'progress', 'received_at'
]);

export function coerceValue(column, raw) {
  if (raw === undefined || raw === null) return null;
  if (NUMERIC_COLUMNS.has(column)) {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    return Number.isNaN(n) ? 0 : n;
  }
  return String(raw);
}

// Turn raw source rows (keyed by source column name) into target-shaped rows
// containing only the mapped columns, with values coerced to their target type.
export function mapRows(sourceTable, rawRows) {
  const { columns } = TABLE_MIGRATIONS[sourceTable];
  if (!columns) return [];
  return (rawRows ?? []).map(row => {
    const out = {};
    for (const column of columns) out[column] = coerceValue(column, row?.[column]);
    return out;
  });
}

export function buildUpsertSql(targetTable, columns, pkColumn) {
  const cols = columns.join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const updateable = columns.filter(c => c !== pkColumn);
  const updates = updateable.map(c => `${c} = VALUES(${c})`).join(', ');
  const updateClause = updates ? ` ON DUPLICATE KEY UPDATE ${updates}` : '';
  return `INSERT INTO ${targetTable} (${cols}) VALUES (${placeholders})${updateClause}`;
}

export function detectSourceFormat(filePath) {
  const lower = String(filePath).toLowerCase();
  if (/\.(sqlite|sqlite3|db)$/.test(lower)) return 'sqlite';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.json')) return 'json';

  if (!existsSync(filePath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }
  const head = readFile(filePath).then(r => r.slice(0, 4096).trimStart());
  return head.then(text => {
    if (text.startsWith('{') || text.startsWith('[')) return 'json';
    if (/^\s*CREATE\s+TABLE|INSERT\s+INTO/i.test(text)) return 'sql';
    return 'sqlite';
  }).catch(() => 'sqlite');
}

async function sqliteTableNames(db) {
  const rows = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  return rows.map(r => r.name);
}

export async function readSqliteFile(filePath) {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const tables = new Set(await sqliteTableNames(db));
    const result = {};
    for (const table of Object.keys(TABLE_MIGRATIONS)) {
      if (!tables.has(table)) continue;
      const columns = SOURCE_COLUMN_ORDER[table];
      const stmt = db.prepare(`SELECT ${columns.join(', ')} FROM "${table}"`);
      result[table] = stmt.all();
    }
    for (const table of SKIPPED_TABLES) {
      if (tables.has(table)) result[table] = [];
    }
    return result;
  } finally {
    db.close();
  }
}

function parseColumnList(text) {
  return text
    .split(',')
    .map(part => part.replace(/^[ "\[`']+|[ "\[`']+$/g, '').trim())
    .filter(Boolean);
}

function extractParenGroup(text, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && i + 1 < text.length) { i++; continue; }
      if (ch === quote) {
        if (text[i + 1] === quote) { i++; } else { quote = null; }
      }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return { content: text.slice(openIndex + 1, i), next: i + 1 };
    }
  }
  return { content: text.slice(openIndex + 1), next: text.length };
}

function parseValueTokens(str) {
  const values = [];
  let current = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === '\\' && i + 1 < str.length) { current += str[i + 1]; i++; continue; }
      if (ch === quote) {
        if (str[i + 1] === quote) { current += quote; i++; continue; }
        quote = null; continue;
      }
      current += ch; continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (ch === ',') { values.push({ raw: current, started }); current = ''; started = false; continue; }
    current += ch; started = true;
  }
  values.push({ raw: current, started });
  return values;
}

function tokenToValue(token) {
  if (!token.started) return null;
  const trimmed = token.raw.trim();
  const upper = trimmed.toUpperCase();
  if (upper === 'NULL') return null;
  if (upper === 'TRUE') return 1;
  if (upper === 'FALSE') return 0;
  return trimmed;
}

function dumpRowToObject(table, columns, tokens) {
  const sourceColumns = columns || SOURCE_COLUMN_ORDER[table];
  const row = {};
  for (let i = 0; i < sourceColumns.length; i++) {
    row[sourceColumns[i]] = i < tokens.length ? tokenToValue(tokens[i]) : null;
  }
  return row;
}

export function parseSqlDump(text) {
  const out = {};
  const insertRe = /INSERT\s+INTO\s+"?([\w.]+)"?/gi;
  let match;
  while ((match = insertRe.exec(text)) !== null) {
    let idx = match.index + match[0].length;
    const table = match[1].replace(/^["`']+|["`']+$/g, '');

    let columns = null;
    const colsMatch = /^\s*\(([^()]*)\)\s*/.exec(text.slice(idx));
    if (colsMatch) {
      columns = parseColumnList(colsMatch[1]);
      idx += colsMatch[0].length;
    }

    if (!/^\s*VALUES\s*/i.exec(text.slice(idx))) continue;
    const open = text.indexOf('(', idx);
    if (open === -1) continue;

    // SQLite/wrangler dumps emit one row per INSERT statement, so parse the
    // single value tuple that follows VALUES and stop at the statement end.
    const { content } = extractParenGroup(text, open);
    const tokens = parseValueTokens(content);
    if (!out[table]) out[table] = [];
    if (tokens.some(t => t.started || t.raw.trim() !== '')) {
      out[table].push(dumpRowToObject(table, columns, tokens));
    }
  }
  return out;
}

export async function readSqlFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  return keepMigratedAndSkipped(parseSqlDump(text));
}

function normalizeJson(json) {
  if (Array.isArray(json)) return { _: json };
  if (Array.isArray(json.results)) {
    const out = {};
    for (const row of json.results) {
      const table = json.table || json.name || matchTableByKeys(row) || '_';
      if (!out[table]) out[table] = [];
      out[table].push(row);
    }
    return out;
  }
  return json;
}

// Infer a source table name by matching a row's key order against the known
// source schemas (used for Cloudflare `--format json` exports that omit a name).
function matchTableByKeys(row) {
  if (!row || typeof row !== 'object') return null;
  const keys = Object.keys(row);
  for (const [table, order] of Object.entries(SOURCE_COLUMN_ORDER)) {
    if (order.length === keys.length && order.every((col, i) => col === keys[i])) return table;
  }
  return null;
}

// Keep only migrated tables plus markers for skipped tables present in the
// source, so callers can report what was intentionally left behind.
function keepMigratedAndSkipped(parsed) {
  const result = {};
  for (const table of Object.keys(TABLE_MIGRATIONS)) {
    if (parsed[table]) result[table] = parsed[table];
  }
  for (const table of SKIPPED_TABLES) {
    if (parsed[table]) result[table] = [];
  }
  return result;
}

export async function readJsonFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  return keepMigratedAndSkipped(normalizeJson(JSON.parse(text)));
}

export async function readSource(filePath, options = {}) {
  const format = options.format || (await detectSourceFormat(filePath));
  switch (format) {
    case 'sqlite':
      return readSqliteFile(filePath);
    case 'sql':
      return readSqlFile(filePath);
    case 'json':
      return readJsonFile(filePath);
    default:
      throw new Error(`Unsupported source format: ${format}`);
  }
}

export function defaultSourcePath() {
  const dir = join(__dirname, '..', '..', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(f => f.endsWith('.sqlite')).sort();
  return files.length ? join(dir, files[files.length - 1]) : null;
}
