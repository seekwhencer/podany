import '../services/testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitStatements, migrate } from './migrator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('strips full-line and inline comments without keeping comment text', () => {
  const sql = [
    'CREATE TABLE t (',
    '  id VARCHAR(64) PRIMARY KEY,',
    '  created_at BIGINT -- default now',
    ');',
    '-- a full-line comment that must disappear',
    'ALTER TABLE t ADD COLUMN x INT;'
  ].join('\n');

  const stmts = splitStatements(sql);
  assert.ok(!stmts.some(s => s.includes('--')), 'no statement may retain a comment marker');
  assert.ok(!stmts.some(s => /comment/i.test(s)), 'comment text must not leak into statements');
  assert.ok(stmts.some(s => s.startsWith('CREATE TABLE t')), 'create statement preserved');
  assert.ok(stmts.some(s => s.startsWith('ALTER TABLE t ADD COLUMN x INT')), 'alter statement preserved');
});

test('schema.sql yields only CREATE/ALTER statements with no comment residue', async () => {
  const raw = await readFile(join(__dirname, 'schema.sql'), 'utf8');
  const stmts = splitStatements(raw);

  assert.ok(stmts.length > 0, 'schema splits into multiple statements');
  assert.ok(!stmts.some(s => s.includes('--')), 'no statement retains a comment marker');
  assert.ok(
    stmts.every(s => /^CREATE TABLE/.test(s) || /^ALTER TABLE/.test(s)),
    'every statement is a CREATE or ALTER'
  );

  const alters = stmts.filter(s => s.startsWith('ALTER TABLE downloads'));
  for (const col of ['timestamp', 'pub_date', 'duration', 'description', 'content', 'is_youtube', 'playlist_id']) {
    assert.ok(
      alters.some(s => new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`).test(s)),
      `schema guards missing column ${col} via idempotent ALTER`
    );
  }
});

test('migrate is idempotent across repeated runs on a fake pool', async () => {
  const calls = [];
  const fakePool = { query: async (sql) => { calls.push(sql); } };

  await migrate(fakePool);
  const first = calls.length;
  await migrate(fakePool);

  assert.equal(calls.length, first * 2, 're-running migrate re-applies the same statements');
  assert.ok(
    calls.every(s => !s.includes('--')),
    'every executed statement is free of comment markers'
  );
});
