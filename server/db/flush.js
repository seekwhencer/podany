import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import config from '../config/index.js';
import db, { configureDb } from './connection.js';

const TABLES_TO_FLUSH = ['playback_state', 'downloads', 'subscriptions', 'auth_tokens'];

function flushDirs() {
  return [
    { label: 'Episodes (Downloads)', dir: config.episodesStorageDir },
    { label: 'Images', dir: config.imageStorageDir },
    { label: 'Thumbnails', dir: config.thumbnailStorageDir },
  ];
}

function parseArgs(argv) {
  const opts = { dryRun: false, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '-n') opts.dryRun = true;
    else if (arg === '--yes' || arg === '-y' || arg === '--force') opts.force = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

function printHelp() {
  console.log(`flush — delete all data except users and remove downloaded media.

This removes every row from playback_state, downloads, subscriptions and
auth_tokens (users is kept) and deletes episode audio files, images and
thumbnails from disk. This cannot be undone.

Usage:
  npm run flush [options]

Options:
  --dry-run   Report what would be deleted without changing anything.
  --yes       Skip the confirmation prompt (required for real runs).
  -h, --help  Show this help.`);
}

async function askConfirm() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) =>
      rl.question(
        'This permanently deletes all data except users and all media. Type "DELETE" to confirm: ',
        resolve
      )
    );
    return answer.trim() === 'DELETE';
  } finally {
    rl.close();
  }
}

async function countTable(table) {
  const [rows] = await db.query(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0].n);
}

async function countDir(dir) {
  try {
    return (await fs.readdir(dir)).length;
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
}

async function flushTables() {
  for (const table of TABLES_TO_FLUSH) {
    await db.run(`DELETE FROM ${table}`);
  }
}

async function clearDir(dir) {
  let files = 0;
  const entries = await fs.readdir(dir);
  for (const entry of entries) {
    await fs.rm(path.join(dir, entry), { recursive: true, force: true });
    files++;
  }
  return files;
}

async function flushFiles() {
  const results = [];
  for (const { label, dir } of flushDirs()) {
    const count = await clearDir(dir);
    results.push({ label, dir, count });
  }
  return results;
}

function printSummary(dbCounts, fileCounts) {
  console.log('Database rows to remove (users kept):');
  for (const { table, count } of dbCounts) {
    console.log(`  ${table.padEnd(18)} ${count}`);
  }
  console.log('Media files to remove:');
  for (const { label, dir, count } of fileCounts) {
    console.log(`  ${label.padEnd(20)} ${count}  (${dir})`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return; }

  configureDb(config);

  let dbCounts, fileCounts;
  try {
    await db.ping();

    dbCounts = (await Promise.all(
      TABLES_TO_FLUSH.map(async (table) => ({ table, count: await countTable(table) }))
    ));
    fileCounts = await Promise.all(
      flushDirs().map(async ({ label, dir }) => ({ label, dir, count: await countDir(dir) }))
    );

    printSummary(dbCounts, fileCounts);

    const totalRows = dbCounts.reduce((sum, r) => sum + r.count, 0);
    const totalFiles = fileCounts.reduce((sum, r) => sum + r.count, 0);

    if (opts.dryRun) {
      console.log(`\n[flush] Dry run — ${totalRows} DB row(s) and ${totalFiles} file(s) would be removed. No changes written.`);
      return;
    }

    const confirmed = opts.force || await askConfirm();
    if (!confirmed) {
      console.log('\n[flush] Aborted by user.');
      process.exitCode = 1;
      return;
    }

    await flushTables();
    await flushFiles();

    console.log(`\n[flush] Done — removed ${totalRows} DB row(s) and ${totalFiles} media file(s).`);
  } catch (err) {
    console.error('[flush] Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.close().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, parseArgs, TABLES_TO_FLUSH, flushDirs };
