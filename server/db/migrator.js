import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import db from './connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, 'schema.sql');

export function splitStatements(sql) {
  const noBlockComments = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = noBlockComments.split(/\r?\n/);
  const stripped = lines
    .map(line => {
      const dashIndex = line.indexOf('--');
      return dashIndex !== -1 ? line.slice(0, dashIndex) : line;
    })
    .join('\n');

  return stripped
    .split(';')
    .map(statement => statement.trim())
    .filter(statement => statement.length > 0);
}

export async function migrate(pool = db, schemaPath = SCHEMA_PATH) {
  const raw = await readFile(schemaPath, 'utf8');
  const statements = splitStatements(raw);

  for (const statement of statements) {
    await pool.query(statement);
  }

  return statements.length;
}

async function main() {
  try {
    await db.ping();
    const count = await migrate();
    console.log(`[db:migrate] Applied ${count} statement(s) to '${db.options.database}'.`);
    await db.close();
  } catch (err) {
    console.error('[db:migrate] Migration failed:', err.message);
    process.exitCode = 1;
    await db.close().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { db };
