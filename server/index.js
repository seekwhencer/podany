import express from 'express';
import fs from 'node:fs';
import session from 'express-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import config from './config/index.js';
import db, { configureDb } from './db/connection.js';
import { migrate } from './db/migrator.js';
import { createCors } from './middleware/cors.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createAppRouter } from './routes/index.js';
import { User } from './models/User.js';
import { hashPassword } from './utils/password.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

configureDb(config);

export function createApp(deps = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.use(createCors({ config }));
  app.use(express.json({ limit: '1mb' }));

  app.use(session({
    name: 'podany_session',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/'
    }
  }));

  const homePage = config.environment === 'development' ? 'dev.html' : 'index.html';

  app.use('/api', createAppRouter({ ...deps, config }));

  // Serve the OpenAPI spec for Swagger UI (dev stack).
  if (config.environment === 'development') {
    const swaggerSpecPath = join(process.cwd(), 'swagger.yml');
    app.get('/swagger.yml', (req, res, next) => {
      if (!fs.existsSync(swaggerSpecPath)) return next();
      res.type('application/x-yaml').sendFile(swaggerSpecPath);
    });
  }

  // Serve the configured home page for the root path before express.static,
  // which would otherwise always serve index.html as its default document.
  app.use((req, res, next) => {
    if (req.url === '/' || req.url === '') {
      return res.sendFile(join(PUBLIC_DIR, homePage));
    }
    next();
  });

  app.use(express.static(PUBLIC_DIR));

  // SPA fallback: serve the home page for non-API routes so magic-link callbacks
  // (/auth/verify/?token=…) and client-side deep links resolve to the app.
  app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/api')) return next();
    res.sendFile(join(PUBLIC_DIR, homePage));
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

async function waitForDb(retries = 30, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await db.ping();
      return attempt;
    } catch (err) {
      const last = attempt === retries;
      if (!last) {
        console.log(
          `[server] Waiting for MariaDB (${db.options.host}:${db.options.port}) — ` +
          `attempt ${attempt}/${retries}: ${err.message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        throw err;
      }
    }
  }
}

export async function seedDefaultUser() {
  if (!config.defaultUserEnabled) return false;
  const users = new User();
  const id = users.generateId('usr_');
  const passwordHash = config.defaultUserPassword ? hashPassword(config.defaultUserPassword) : null;
  const result = await users.seedDefault({
    id,
    email: config.defaultUserEmail,
    passwordHash,
    color: config.defaultUserColor
  });
  return result.seeded;
}

export async function start(deps = {}) {
  const app = createApp(deps);

  try {
    const attempts = await waitForDb();
    const statements = await migrate(db);
    console.log(`[server] Connected to MariaDB after ${attempts} attempt(s); applied ${statements} statement(s).`);
  } catch (err) {
    console.error('[server] Database migration failed:', err.message);
    process.exitCode = 1;
    throw err;
  }

  try {
    if (await seedDefaultUser()) {
      console.log('[server] Seeded default user.');
    }
  } catch (err) {
    console.warn('[server] Could not seed default user:', err.message);
  }

  const server = app.listen(config.port, config.host, () => {
    const { port, address } = server.address();
    console.log(`[server] Podany listening on http://${address}:${port}`);
    console.log(
      `[server] config: APP_URL=${config.appUrl} AUTH_MODE=${config.authMode} ` +
      `email=${config.resendEnabled ? 'resend' : 'local'} cookieSecure=${config.cookieSecure}`
    );
  });

  async function shutdown(signal) {
    console.log(`\n[server] Received ${signal}, shutting down...`);
    server.close(() => {
      db.close().finally(() => process.exit(0));
    });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    console.error('[server] Fatal startup error:', err);
    process.exit(1);
  });
}

export { PUBLIC_DIR };
