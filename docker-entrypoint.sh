#!/bin/sh
# Container entrypoint for the Podany self-hosted Express + MariaDB stack.
# 1) Wait for MariaDB to accept connections.
# 2) Apply schema.sql idempotently on startup.
# 3) Hand off to the container CMD (node server/server.js).
set -e

echo "[podany] Waiting for MariaDB at ${DB_HOST}:${DB_PORT:-3306} ..."

node --input-type=module -e '
import db from "./server/db/connection.js";
let ready = false;
for (let attempt = 1; attempt <= 60 && !ready; attempt++) {
  try {
    await db.ping();
    ready = true;
  } catch (err) {
    if (attempt === 60) {
      console.error("[podany] MariaDB not reachable after 60s:", err.message);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
console.log("[podany] MariaDB is ready.");
'

echo "[podany] Applying database schema ..."
npm run --silent db:migrate

exec "$@"
