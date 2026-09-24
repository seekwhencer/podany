# Podany

Private podcast RSS feed aggregator and web player, self-hosted with Express and MariaDB.

## Screenshots

<table>
  <tr>
    <td align="center" width="50%"><b>Desktop Dark Mode</b></td>
    <td align="center" width="50%"><b>Desktop Light Mode</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/preview-dark.png" alt="Desktop Dark Mode" /></td>
    <td><img src="docs/screenshots/preview-light.png" alt="Desktop Light Mode" /></td>
  </tr>
  <tr>
    <td align="center"><b>Mobile Feeds</b></td>
    <td align="center"><b>Mobile Active Playback</b></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/mobile-feeds.png" width="320" alt="Mobile Feeds" /></td>
    <td align="center"><img src="docs/screenshots/mobile-player.png" width="320" alt="Mobile Active Playback" /></td>
  </tr>
</table>

## Features

- **Audio & YouTube Playback**: Streams standard podcast RSS enclosures (MP3, M4A, AAC) and YouTube playlists/channels.
- **Offline Audio Caching (PWA)**: Service worker with Range request support (`HTTP 206`) for offline listening and CacheStorage management.
- **Cross-Device Sync**: Multi-user subscription and playback position synchronization backed by MariaDB.
- **Passwordless Auth**: Magic link login via Resend with cryptographic token verification; `AUTH_MODE` switches between magic-link, direct local email login, or both (`magic`\|`local`\|`mixed`). An optional seeded default user can log in with a password for local/dev use.
- **Directory Search**: Search Apple Podcasts directory or paste direct RSS/YouTube URLs.
- **Show Notes & Chapters**: Rich show notes with clickable links and interactive seek timestamps.
- **Playback Controls**: Non-destructive skip (preserves position in Continue Listening), dedicated mark-as-listened button, variable speed (0.8x - 2.0x), and sleep timer.
- **OPML Support**: Export and import subscription lists in standard OPML format.
- **Responsive Interface**: Minimalist dark and light themes, optimized single-column layout on mobile, and desktop multi-column grid.

## Technology Stack

- **Frontend**: Vanilla JavaScript (ES6+ classes), bundled with esbuild to `public/dist/bundle.js`; HTML5 Audio, CSS3 Variables, PWA Service Worker.
- **Backend**: Express v4 (`src/`), ES modules (`"type": "module"`), layered `routes → services → models → db`.
- **Database**: MariaDB via `mysql2` connection pool; schema in `src/db/schema.sql`.
- **Auth**: Magic-link tokens (SHA-256 hashed) + in-memory session cookies via `express-session`.
- **Email Delivery**: Resend REST API (optional; without a key the verify URL is returned directly for local dev).

## Project Structure

```
podany/
├── src/                        # Self-Hosted backend (ES6 classes)
│   ├── server.js               # Express entrypoint: app, middleware, routes, start
│   ├── config/                 # Config class + defaults (env vars)
│   ├── db/                     # MariaDB pool, migrator, schema.sql, data-migration
│   ├── models/                 # Data-access classes (BaseModel, User, AuthToken, Subscription, PlaybackState, Downloads)
│   ├── services/               # Business logic (Auth, Feed, Sync, AudioProxy, Downloads, Email, User, SessionStore, RateLimiter)
│   ├── middleware/             # auth, cors, errorHandler, rateLimit
│   ├── routes/                 # auth, sync, user, feed (+ audio-proxy, downloads)
│   └── utils/                  # crypto, url (SSRF guard), response, password helpers
├── public/                     # Static frontend + bundled JS
│   ├── index.html              # Production home page
│   ├── dev.html                # Development home page (served when AUTH_MODE=local / no Resend key)
│   ├── css/                    # Modular CSS (index.css imports variables, typo, forms, global, components/)
│   │   ├── variables.css       # :root theme tokens
│   │   ├── typo.css            # base reset + layout primitives
│   │   ├── forms.css           # form field styling
│   │   ├── global.css          # global/base rules
│   │   └── components/         # per-component nested CSS (buttons, header, player, ...)
│   ├── icon.svg                # PWA app icon
│   ├── manifest.webmanifest    # PWA manifest
│   ├── sw.js                   # PWA service worker
│   ├── auth/verify/index.html  # Standalone magic-link verify page
│   ├── js/                     # Modular frontend source (import/export classes)
│   └── dist/bundle.js          # esbuild output (built by `npm run build`)
├── docker-compose.yml          # Express app + MariaDB
├── Dockerfile
├── docker-entrypoint.sh        # Wait for DB, apply schema, start server
├── .env.example                # All environment variables
├── package.json
└── README.md
```

## Database Schema

Timestamps are Unix epoch seconds (`BIGINT`), matching the app code directly. See `src/db/schema.sql` for the full definition. Key tables:

- `users` — id, email (unique), created_at
- `auth_tokens` — token_hash (unique), user_id, expires_at, used, created_at
- `subscriptions` — id, user_id, feed_url, title, artwork, created_at (unique on user_id + feed_url)
- `playback_state` — id, user_id, episode_guid, position_seconds, completed, last_listened_at (unique on user_id + episode_guid)
- `downloads` — server-side offline episodes (id, user_id, episode_guid, file_path, status, ...)

## Local Development

### Prerequisites

- Node.js 18 or higher
- MariaDB 11 running and reachable

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   # edit .env (at minimum set DB_* credentials and SESSION_SECRET)
   ```

3. Apply the database schema:
   ```bash
   npm run db:migrate
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:8788` in your browser.

Without a `RESEND_API_KEY`, `/api/auth/send-link` returns the verify URL directly so you can sign in locally. Set `AUTH_MODE=local` to expose a direct email login that skips email entirely.

## Deployment (Docker Compose)

```bash
cp .env.example .env      # then edit the values (optional; defaults are shown in docker-compose.yml)
docker compose up --build
```

This starts two services — `db` (MariaDB 11) and `app` (Express). The container entrypoint waits for MariaDB, applies the schema on startup, then starts the server. Open `http://localhost:8788`.

## Data Migration (Cloudflare D1 / SQLite → MariaDB)

If you are moving an existing install from Cloudflare D1 (SQLite) or a raw SQLite/SQL/JSON export into MariaDB:

```bash
# Point at a D1 dump, .sqlite file, or `wrangler d1 export --format json` file
npm run migrate:data -- --source ./my-export.json

# Preview without writing
npm run migrate:data -- --source ./my-export.sqlite --dry-run
```

The script reads the known tables and upserts them into the MariaDB schema. See `src/db/migrate-data.js`.

## Configuration

All values are read by the `Config` class from process env + `.env` (see `.env.example`).

| Name | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | number | `8788` | Express listen port |
| `HOST` | string | `0.0.0.0` | Bind interface |
| `DB_HOST` | string | — | MariaDB host |
| `DB_PORT` | number | `3306` | MariaDB port |
| `DB_NAME` | string | — | Database name |
| `DB_USER` | string | — | DB user |
| `DB_PASSWORD` | string | — | DB password |
| `DB_POOL_MAX` | number | `10` | Connection-pool size |
| `APP_URL` | string | — | Canonical base URL (magic links, cookie origin) |
| `FROM_EMAIL` | string | — | Sender address for login emails |
| `RESEND_API_KEY` | secret | — | Resend key; empty = local dev mode |
| `SESSION_SECRET` | secret | — | Signs the session cookie (required) |
| `AUTH_MODE` | `magic`\|`local`\|`mixed` | `magic` | Login flow |
| `COOKIE_SECURE` | boolean | `true` | Set `Secure` on the cookie (use `false` over plain HTTP) |
| `RATE_LIMIT_LINKS_PER_HOUR` | number | `60` | Login links allowed per email per hour |
| `CORS_ORIGIN` | string / `*` | `*` | Allowed CORS origin |
| `MAGIC_LINK_ENABLED` | boolean | `true` | Enable magic-link login (disabled entirely when `false`, returns 403) |
| `ENVIRONMENT` | `development`\|`production` | `production` | Runtime environment; `development` serves `dev.html` |
| `DEFAULT_USER_EMAIL` | string | — | Seeds a default user on startup (idempotent); empty disables it |
| `DEFAULT_USER_PASSWORD` | secret | — | Password for the seeded default user (`AUTH_MODE=local`/`mixed`) |
| `DEFAULT_USER_COLOR` | string | `#d8cdbe` | Accent color for the seeded default user |

Secrets are never committed; keep `.env` private.

## Testing

```bash
npm test
```

Runs the Node.js built-in test runner across the backend units (services, models, middleware, routes, utils).

## License

MIT License. Copyright (c) 2026 Steffen Klaue.  

## Selfhosting Edition

Refactoring, File-Splitting, Server, Database, Docker-Setup by Matthias Kallenbach,  [skwncr.net](https://skwncr.net) using VS Code + Kilo Code + local AI on 32G VRAM with llama.cpp and Tiel Coder 35B (MTP UD Q6) on 220K tokens context per session.
