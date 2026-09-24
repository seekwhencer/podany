import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import db from './connection.js';
import {
  TABLE_MIGRATIONS,
  SKIPPED_TABLES,
  detectSourceFormat,
  defaultSourcePath,
  readSource,
  mapRows,
  buildUpsertSql
} from './migrateSources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { source: null, dryRun: false, tables: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '-n') opts.dryRun = true;
    else if (arg === '--tables') opts.tables = argv[++i];
    else if (arg.startsWith('--tables=')) opts.tables = arg.slice('--tables='.length);
    else if (arg === '--source') opts.source = argv[++i];
    else if (arg.startsWith('--source=')) opts.source = arg.slice('--source='.length);
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

function resolveSource(explicit) {
  if (explicit) return explicit;
  if (process.env.MIGRATE_SOURCE) return process.env.MIGRATE_SOURCE;
  return defaultSourcePath();
}

function printHelp() {
  console.log(`migrate:data — copy data from a D1/SQLite source into MariaDB.

Usage:
  npm run migrate:data [options]

Options:
  --source <path>   Source file (.sqlite, .sql dump, or .json export).
                    Defaults to $MIGRATE_SOURCE or the local Miniflare D1 file.
  --tables <list>   Comma-separated tables to migrate (default: all known tables).
  --dry-run         Report what would be migrated without writing to MariaDB.
  -h, --help        Show this help.`);
}

function formatSummary(summary, skipped) {
  const lines = [];
  lines.push('');
  lines.push('Migration summary');
  lines.push('-----------------');
  for (const [table, { source, target }] of Object.entries(summary)) {
    if (target === undefined) {
      lines.push(`  ${table.padEnd(18)} source=${String(source).padStart(4)}  (not migrated)`);
    } else if (target > source) {
      lines.push(`  ${table.padEnd(18)} source=${String(source).padStart(4)}  target=${String(target).padStart(4)}  (target had pre-existing rows)`);
    } else if (target < source) {
      lines.push(`  ${table.padEnd(18)} source=${String(source).padStart(4)}  target=${String(target).padStart(4)}  << DATA LOSS`);
    } else {
      lines.push(`  ${table.padEnd(18)} source=${String(source).padStart(4)}  target=${String(target).padStart(4)}  OK`);
    }
  }
  if (skipped.length) {
    lines.push('');
    lines.push('Skipped (present in source, not migrated):');
    for (const table of skipped) lines.push(`  - ${table}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function planMigration(sourcePath, opts) {
  const format = await detectSourceFormat(sourcePath);
  const raw = await readSource(sourcePath, { format });

  const requested = opts.tables
    ? opts.tables.split(',').map(t => t.trim()).filter(Boolean)
    : Object.keys(TABLE_MIGRATIONS);

  const summary = {};
  const skipped = [];
  for (const table of requested) {
    if (SKIPPED_TABLES.has(table)) {
      skipped.push(table);
      continue;
    }
    if (!TABLE_MIGRATIONS[table]) {
      console.warn(`[migrate:data] Unknown table "${table}", skipping.`);
      continue;
    }
    summary[table] = { source: (raw[table] ?? []).length, target: undefined };
  }

  // On a full run, surface every skipped table present in the source so the
  // operator knows what is intentionally left behind. On a filtered run only
  // explicitly requested skipped tables are reported (handled above).
  if (!opts.tables) {
    for (const table of Object.keys(raw)) {
      if (SKIPPED_TABLES.has(table) && !skipped.includes(table)) {
        skipped.push(table);
      }
    }
  }

  return { format, raw, summary, skipped };
}

async function writeMigration(pool, raw, tables) {
  for (const table of tables) {
    const { columns, pk } = TABLE_MIGRATIONS[table];
    const sql = buildUpsertSql(table, columns, pk);
    const rows = mapRows(table, raw[table] ?? []);
    if (rows.length === 0) continue;

    const connection = await pool.beginTransaction();
    try {
      for (const row of rows) {
        await connection.execute(sql, columns.map(c => row[c]));
      }
      await connection.commit();
    } catch (err) {
      await connection.rollback().catch(() => {});
      throw err;
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return; }

  const sourcePath = resolveSource(opts.source);
  if (!sourcePath) {
    console.error('[migrate:data] No source provided. Use --source <path> or set MIGRATE_SOURCE.');
    process.exitCode = 1;
    return;
  }

  let connected = false;
  try {
    const { format, raw, summary, skipped } = await planMigration(sourcePath, opts);
    console.log(`[migrate:data] Source: ${sourcePath} (${format})`);
    console.log(`[migrate:data] Tables to migrate: ${Object.keys(summary).join(', ') || '(none)'}`);

    if (opts.dryRun) {
      console.log('[migrate:data] Dry run — no changes written.');
      console.log(formatSummary(summary, skipped));
      return;
    }

    await db.ping();
    connected = true;
    await writeMigration(db, raw, Object.keys(summary));

    for (const table of Object.keys(summary)) {
      const count = Number(await db.firstColumn(`SELECT COUNT(*) FROM ${table}`));
      summary[table].target = count;
    }

    console.log(formatSummary(summary, skipped));

    let lost = false;
    for (const { source, target } of Object.values(summary)) {
      if (target !== undefined && target < source) lost = true;
    }
    if (lost) {
      console.error('[migrate:data] WARNING: one or more tables have fewer rows in the target than the source.');
      process.exitCode = 1;
    } else {
      console.log('[migrate:data] Done.');
    }
  } catch (err) {
    console.error('[migrate:data] Failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (connected) await db.close().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, parseArgs, resolveSource, planMigration, writeMigration, formatSummary };
