import '../services/testEnv.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  TABLE_MIGRATIONS,
  SKIPPED_TABLES,
  coerceValue,
  mapRows,
  buildUpsertSql,
  detectSourceFormat,
  parseSqlDump,
  readSqliteFile,
  readJsonFile,
  readSource,
  defaultSourcePath
} from './migrateSources.js';
import { parseArgs, resolveSource, planMigration } from './migrate-data.js';

test('coerceValue converts epoch/numeric columns and stringifies the rest', () => {
  assert.equal(coerceValue('created_at', '1790199324'), 1790199324);
  assert.equal(coerceValue('created_at', 1790199324), 1790199324);
  assert.equal(coerceValue('position_seconds', '12.5'), 12.5);
  assert.equal(coerceValue('used', '0'), 0);
  assert.equal(coerceValue('created_at', null), null);
  assert.equal(coerceValue('created_at', 'not-a-number'), 0);
  assert.equal(coerceValue('email', 'test@example.com'), 'test@example.com');
  assert.equal(coerceValue('id', 'usr_123'), 'usr_123');
});

test('mapRows keeps only mapped columns in target order with coerced types', () => {
  const raw = [{ id: 'usr_1', email: 'a@b.com', created_at: '1790199324', extra: 'ignored' }];
  const mapped = mapRows('users', raw);
  assert.deepEqual(Object.keys(mapped[0]), ['id', 'email', 'created_at']);
  assert.equal(mapped[0].created_at, 1790199324);
  assert.equal(mapped[0].extra, undefined);
});

test('buildUpsertSql excludes the primary key from the update clause', () => {
  const sql = buildUpsertSql('users', ['id', 'email', 'created_at'], 'id');
  assert.equal(sql, 'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email), created_at = VALUES(created_at)');

  const tokenSql = buildUpsertSql('auth_tokens', ['token_hash', 'user_id', 'expires_at', 'used', 'created_at'], 'token_hash');
  assert.match(tokenSql, /^INSERT INTO auth_tokens \(token_hash, user_id, expires_at, used, created_at\) VALUES \(\?, \?, \?, \?, \?\) ON DUPLICATE KEY UPDATE user_id = VALUES\(user_id\), expires_at = VALUES\(expires_at\), used = VALUES\(used\), created_at = VALUES\(created_at\)$/);
});

test('TABLE_MIGRATIONS and SKIPPED_TABLES match the intended scope', () => {
  assert.deepEqual(Object.keys(TABLE_MIGRATIONS).sort(), ['auth_tokens', 'playback_state', 'subscriptions', 'users']);
  assert.ok(SKIPPED_TABLES.has('user_sessions'));
  assert.ok(SKIPPED_TABLES.has('downloads'));
});

test('detectSourceFormat keys off the extension then sniffs content', async () => {
  assert.equal(await detectSourceFormat('/tmp/dump.sqlite'), 'sqlite');
  assert.equal(await detectSourceFormat('/tmp/dump.sqlite3'), 'sqlite');
  assert.equal(await detectSourceFormat('/tmp/dump.db'), 'sqlite');
  assert.equal(await detectSourceFormat('/tmp/dump.sql'), 'sql');
  assert.equal(await detectSourceFormat('/tmp/dump.json'), 'json');
});

const SAMPLE_DUMP = `PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, created_at INTEGER);
INSERT INTO "users" ("id", "email", "created_at") VALUES('usr_1', 'a@b.com', 1790199324);
INSERT INTO "users" VALUES('usr_2', 'c@d.com', 1790199400);
INSERT INTO "subscriptions" VALUES('sub_1', 'usr_1', 'https://example.com/feed', 'Show ''Best''', NULL, 1790199500);
COMMIT;
`;

test('parseSqlDump handles explicit columns, implicit columns, quotes and NULL', () => {
  const parsed = parseSqlDump(SAMPLE_DUMP);
  assert.deepEqual(parsed.users, [
    { id: 'usr_1', email: 'a@b.com', created_at: '1790199324' },
    { id: 'usr_2', email: 'c@d.com', created_at: '1790199400' }
  ]);
  assert.deepEqual(parsed.subscriptions, [
    { id: 'sub_1', user_id: 'usr_1', feed_url: 'https://example.com/feed', title: "Show 'Best'", artwork: null, created_at: '1790199500' }
  ]);
});

test('readSqliteFile reads only the migrated tables', async () => {
  const file = join(tmpdir(), `podany-migrate-test-${process.pid}.sqlite`);
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, created_at INTEGER);
    CREATE TABLE user_sessions (session_hash TEXT PRIMARY KEY, user_id TEXT, expires_at INTEGER, created_at INTEGER);
    INSERT INTO users VALUES ('usr_42', 'migration@example.com', 1790200000);
  `);
  db.close();

  const read = await readSqliteFile(file);
  assert.ok(read.users);
  assert.equal(read.users.length, 1);
  assert.equal(read.users[0].email, 'migration@example.com');
  assert.equal(read.users[0].created_at, 1790200000);
  // user_sessions exists in the source but is intentionally not migrated, so it
  // surfaces as an empty presence marker rather than undefined.
  assert.deepEqual(read.user_sessions, []);

  const mapped = mapRows('users', read.users);
  assert.equal(mapped[0].created_at, 1790200000);

  try { await import('node:fs').then(f => f.rmSync(file)); } catch {}
});

test('readSource dispatches to the SQLite reader by format', async () => {
  const file = join(tmpdir(), `podany-migrate-src-${process.pid}.sqlite`);
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE playback_state (id TEXT, user_id TEXT, episode_guid TEXT, position_seconds REAL, completed INTEGER, last_listened_at INTEGER);`);
  db.exec(`INSERT INTO playback_state VALUES ('p1','usr_1','guid-1',42.5,0,1790201000);`);
  db.close();

  const source = await readSource(file, { format: 'sqlite' });
  assert.equal(source.playback_state.length, 1);
  assert.equal(source.playback_state[0].position_seconds, 42.5);

  try { await import('node:fs').then(f => f.rmSync(file)); } catch {}
});

test('readJsonFile supports results and table-keyed shapes', async () => {
  const resultsShape = { results: [{ id: 'usr_9', email: 'z@z.com', created_at: 1790202000 }] };
  const fromResults = await readJsonFileContent(resultsShape);
  assert.deepEqual(fromResults.users, resultsShape.results);

  const keyedShape = { subscriptions: [{ id: 's1', user_id: 'usr_1', feed_url: 'https://x/feed', title: 'T', artwork: null, created_at: 1790202000 }] };
  const fromKeyed = await readJsonFileContent(keyedShape);
  assert.deepEqual(fromKeyed.subscriptions, keyedShape.subscriptions);
});

async function readJsonFileContent(json) {
  const { writeFileSync } = await import('node:fs');
  const file = join(tmpdir(), `podany-migrate-json-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(json));
  try {
    return await readJsonFile(file);
  } finally {
    const { rmSync } = await import('node:fs');
    rmSync(file);
  }
}

test('parseArgs recognizes source, tables and dry-run flags', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--tables', 'users,subscriptions']), { source: null, dryRun: true, tables: 'users,subscriptions' });
  assert.deepEqual(parseArgs(['--source=/tmp/x.sql', '--tables=users']), { source: '/tmp/x.sql', dryRun: false, tables: 'users' });
  assert.deepEqual(parseArgs(['-h']), { source: null, dryRun: false, tables: null, help: true });
});

test('resolveSource prefers explicit path, then env, then the Miniflare default', () => {
  assert.equal(resolveSource('/tmp/whatever.sqlite'), '/tmp/whatever.sqlite');
  const saved = process.env.MIGRATE_SOURCE;
  process.env.MIGRATE_SOURCE = '/tmp/from-env.sqlite';
  assert.equal(resolveSource(null), '/tmp/from-env.sqlite');
  if (saved === undefined) delete process.env.MIGRATE_SOURCE; else process.env.MIGRATE_SOURCE = saved;

  const def = defaultSourcePath();
  assert.ok(def === null || typeof def === 'string');
});

test('planMigration reports source counts and marks skipped tables', async () => {
  const file = join(tmpdir(), `podany-migrate-plan-${process.pid}.sqlite`);
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, created_at INTEGER);`);
  db.exec(`CREATE TABLE user_sessions (session_hash TEXT PRIMARY KEY, user_id TEXT, expires_at INTEGER, created_at INTEGER);`);
  db.exec(`INSERT INTO users VALUES ('usr_7', 'plan@example.com', 1790203000);`);
  db.exec(`INSERT INTO user_sessions VALUES ('sess_1', 'usr_7', 1790204000, 1790203000);`);
  db.close();

  const { format, summary, skipped } = await planMigration(file, {});
  assert.equal(format, 'sqlite');
  assert.equal(summary.users.source, 1);
  assert.equal(summary.auth_tokens.source, 0);
  assert.equal(summary.users.target, undefined);
  assert.ok(skipped.includes('user_sessions'));

  try { await import('node:fs').then(f => f.rmSync(file)); } catch {}
});
