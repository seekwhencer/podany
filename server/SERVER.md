# Server (podany)

Selbstgehosteter Podcast-RSS-Aggregator mit Web-Player. Stack: **Node.js (ESM-Module)** + **Express 4** + **MariaDB** (`mysql2`), Bildverarbeitung über `sharp`.

## Einstiegspunkt

Der Server startet aus **`server/index.js`**.

```bash
npm start      # node server/index.js
npm run dev    # node --watch server/index.js (Hot-Reload)
npm run db:migrate   # Schema manuell anwenden (node server/db/migrator.js)
npm run migrate:data # Daten-Migration (einzelnes Skript, nicht Teil des Starts)
npm run build    # Frontend-Bundle (esbuild, siehe unten)
npm test         # node --test (alle *.test.js)
```

## Architektur

`server/index.js` exportiert drei Funktionen und nutzt **Dependency-Injection** über ein optionales `deps`-Objekt (ermöglicht Tests):

- **`createApp(deps)`** — baut die Express-App (Middleware-Kette).
- **`start(deps)`** — wartet auf DB, migriert das Schema, startet den Listener, registriert Shutdown-Handler.
- **`seedDefaultUser()`** — legt bei Start einen Default-User an (siehe Abschnitt „Default-User").
- Der Datei-Selbststart (`import.meta.url === file://${process.argv[1]}`) ruft `start()` bei direkter Ausführung auf.

```mermaid
flowchart TD
    A[start()] --> B[createApp(deps)]
    B --> C[CORS + JSON-Parser + Session]
    C --> D[/api Router]
    D --> E[express.static public/]
    E --> F[SPA-Fallback index.html/dev.html]
    F --> G[notFound + errorHandler]
    A --> H[waitForDb: DB-Ping mit Retry]
    H --> I[migrate: Schema anwenden]
    I --> J[seedDefaultUser]
    J --> K[app.listen auf host:port]
    K --> L[SIGINT/SIGTERM → graceful shutdown]
```

### Middleware-Kette (`createApp`)

1. `createCors({ config })` — CORS konfigurieren (`credentials: true`, erlaubte Header inkl. `X-Session-Token`, `Range`).
2. `express.json({ limit: '1mb' })` — JSON-Body-Limit.
3. `express-session` — Session-Cookie **`podany_session`** (`httpOnly`, `sameSite: lax`, `secure` je nach Config).
4. `/api` → Router (`createAppRouter`) mit den Endpunkten.
5. Swagger-Serve (nur `development`): `GET /swagger.yml` aus dem Repo-Wurzelverzeichnis.
6. Home-Page-Serve (`/`): `dev.html` in `development`, sonst `index.html`.
7. `express.static(PUBLIC_DIR)` — statische Dateien aus `public/`.
8. **SPA-Fallback** (Zeilen 67–70): Alle nicht-`/api`-Routes liefern die Home-Page, damit Client-Side-Routing und Magic-Link-Callbacks (`/auth/verify/?token=…`) funktionieren.
9. `notFoundHandler` + `errorHandler` — zentrale Fehlerbehandlung.

## Konfiguration (`server/config/index.js` + `defaults.js`)

Singleton via **Proxy** (lazy init beim ersten Zugriff). Liest `.env` (`dotenv/config`) und validiert Umgebungsvariablen streng (`_require` wirft bei fehlenden Pflichtvars).

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | ja | DB-Verbindung |
| `APP_URL` | ja | öffentliche Basis-URL (Schluss-slash wird abgeschnitten) |
| `SESSION_SECRET` | ja | Secret für Session-Signatur |
| `PORT`, `HOST` | nein | Standard 8788 / 0.0.0.0 |
| `DOWNLOADS_DIR`, `EPISODES_DIR`, `FEEDS_DIR`, `IMAGES_DIR`, `THUMBNAILS_DIR` | nein | lokale Storage-Verzeichnisse unter `data/` |
| `DOWNLOADS_CONCURRENCY` | nein | parallele Downloads (Standard 4) |
| `DB_PORT`, `DB_POOL_MAX` | nein | Port und Pool-Größe (Standard 3306 / 10) |
| `FROM_EMAIL` | nein | Absenderadresse (Standard `onboarding@resend.dev`) |
| `RESEND_API_KEY` | nein | aktiviert E-Mail-Versand (Magic Link) |
| `COOKIE_SECURE` | nein | Cookie nur über HTTPS (Standard `true`) |
| `RATE_LIMIT_LINKS_PER_HOUR` | nein | Begrenzung von Feed-Link-Anfragen |
| `CORS_ORIGIN` | nein | erlaubte CORS-Origin (Standard `*`) |
| `AUTH_MODE` | nein | `magic` \| `local` \| `mixed` (Standard `local`) |
| `MAGIC_LINK_ENABLED` | nein | Magic-Link-Login deaktivieren |
| `ENVIRONMENT` | nein | `production` (Standard) / `development` |
| `DEFAULT_USER_EMAIL` | nein | E-Mail des beim Start angelegten Default-Users (leer = deaktiviert) |
| `DEFAULT_USER_PASSWORD` | nein | Passwort des Default-Users (leer = kein Password-Login für diesen User) |
| `DEFAULT_USER_COLOR` | nein | Standardfarbe des Default-Users (Hex wie `#aabbcc`, Standard `#d8cdbe`) |

Ableitete Werte: `resendEnabled`, `localLoginEnabled`, `magicLinkEnabled`, `isDev` (true, wenn kein Resend aktiv).

Standard-Cookie-Name (`defaults.sessionCookieName` = **`podcast_session`**) wird von der Auth-Schicht (`AuthRoutes`, `createAuthMiddleware`) verwendet — das ist der Cookie, der den Session-Token enthält. Der `express-session`-Cookie läuft separat unter dem hartkodierten Namen `podany_session`.

## Datenbank (`server/db/`)

- **`connection.js`** — `MySQLPool`-Wrapper um `mysql2/promise` mit Connection-Pool. Abstrahierte Methoden: `query`, `execute`, `rows`, `row`, `firstColumn`, `run`, `beginTransaction`, `getConnection`, `ping`, `close`.
- **`migrator.js`** — wendet `schema.sql` an (wird in `start()` und über `npm run db:migrate` aufgerufen). Teilt SQL in Statements auf (Block-/Zeilen-Kommentare werden entfernt).
- **`schema.sql`** — Tabellen: `users`, `auth_tokens`, `subscriptions`, `playback_state`, `downloads` (alle mit `user_id` → FK auf `users`, `ON DELETE CASCADE`).
- **`migrate-data.js`** / **`migrateSources.js`** — Daten-Migrationen (einzelne Skripte, nicht Teil des Startablaufs).

`start()` ruft `waitForDb()` auf: pollt die MariaDB per `ping()` bis zu 30× mit 1s Abstand, falls die DB beim Start noch nicht bereit ist (typisch in Docker).

## Default-User

Nach erfolgreicher Migration legt `start()` über `seedDefaultUser()` einen Default-User an, wenn `DEFAULT_USER_EMAIL` gesetzt ist (`server/index.js:98`). Der Vorgang ist idempotent (kein Doppel-Anlegen) und schlägt still, aber ohne Abbruch des Starts, fehl. Ein gesetztes `DEFAULT_USER_PASSWORD` wird mit `hashPassword()` (scrypt + zufälliges Salt) gehasht und als `password_hash` gespeichert, sodass der Default-User sich mit Passwort einloggen kann. Die Farbe erhält der User aus `DEFAULT_USER_COLOR` (Standard `#d8cdbe`).

## Router & Endpunkte (`server/routes/`)

Alle liegen unter `/api`. `createAppRouter` (`routes/index.js`) registriert die einzelnen Router; die Middleware `auth.js` (`createAuthMiddleware`) setzt `req.user` aus dem Session-Token (aus `X-Session-Token`-Header oder `podcast_session`-Cookie).

| Bereich | Endpunkte | Auth |
|---|---|---|
| `/auth` | `POST /send-link`, `/verify`, `/login` (`email` + optionales `password`), `/logout`, `GET /me` | öffentlich (Login-Flow) |
| `/subscription` | `GET /list`, `POST /` (Feed hinzufügen + Episoden enqueue), `DELETE /` | **Pflicht** |
| `/playback` | `GET /positions`, `POST /positions`, `DELETE /positions` | **Pflicht** |
| `/user` | `GET /options`, `PATCH /options` (z. B. `color`) | **Pflicht** |
| `/feed` | `POST /fetch` (RSS/YouTube-Feeds holen) | öffentlich |
| `/audio-proxy` | `GET /?url=…` (streamt Audio mit Range-Support + CORS) | öffentlich |
| `/downloads` | `GET /`, `POST /`, `POST /:id/start`, `DELETE /`, `DELETE /:id` | **Pflicht** |

- **`/auth/login`** akzeptiert ein optionales `password`: mit Passwort läuft ein Password-Check (`loginWithPassword`), ohne Passwort wie bisher der E-Mail-only-Login (`login`).
- **`/subscription`** lädt die Feed-Quelle beim Hinzufügen einmalig (`POST /` → `feed.fetchFeeds`), speichert die Subscription und enqueue die gefundenen Episoden als `downloads`-Rows.
- **`/playback`** — `DELETE /positions` (Schritt 8 der localStorage-Entkopplung) löscht eine Position über `episodeGuid`.

## Services (`server/services/`)

Jeder Route entspricht ein oder mehrere Services; alle akzeptieren ein `deps`-Objekt für Mocking:

- **`authService`** — Magic-Link- und Local-Login-Logik (E-Mail + optionales Passwort), Session-Token, Rate-Limiting.
- **`sessionStore`** — verwaltet Session-Tokens mit TTL (In-Memory `Map`).
- **`userService`** — User-Optionen (z. B. `color`) abfragen und aktualisieren.
- **`subscriptionService`** — Abonnements pro User (Liste, Add inkl. artwork-Thumbnail, Remove).
- **`playbackService`** — Play-Positionen pro User (Liste, Save/Upsert, Remove).
- **`feedService`** — RSS/Feed-Parsing und `-fetch`; delegiert an `podcastService` / `youtubeService`.
- **`feed/podcastService`** / **`feed/youtubeService`** — RSS/Atom- bzw. YouTube-Playlist-Parsing.
- **`audioProxyService`** — streamt externe Audio-URLs (Range-Support).
- **`downloadsService`** — Download-Registrierung, -Abruf, Queue mit begrenzter Parallelität, Dateilöschung, Cleanup.
- **`imageService`** — lädt Bilder herunter, speichert Origin + generiert Thumbnails (`sharp`).
- **`emailService`** — E-Mail-Versand über Resend.
- **`rateLimiter`** — Request-Begrenzung (fensterbasiert).

## Modelle (`server/models/`)

ORM-ähnliche Wrapper um die Tabellen: `User`, `Subscription`, `PlaybackState`, `AuthToken`, `Downloads` (plus `BaseModel` als Basis). `BaseModel` delegiert auf den `MySQLPool` (`find`/`findOne`/`firstColumn`/`execute`) und stellt `generateId(prefix)` + `now()` bereit.

## Middleware (`server/middleware/`)

- **`auth.js`** — `createAuthMiddleware()` (setzt `req.user`, wirft 401 wenn kein gültiger Token) + `getSessionToken()` (Liest `X-Session-Token`-Header oder `podcast_session`-Cookie).
- **`cors.js`** — `createCors()` konfiguriert Origin/Credentials/Methoden/Headers.
- **`errorHandler.js`** — `notFoundHandler` (404) + `errorHandler` (parsbare Body-Fehler → 400, sonst 500).
- **`rateLimit.js`** — `createRateLimiter()` setzt `X-RateLimit-Remaining`, wirft 429 bei Überschreitung.

## Utilities (`server/utils/`)

- **`crypto.js`** — `hashToken()` (sha256), `generateToken()`.
- **`password.js`** — `hashPassword()` / `verifyPassword()` für User-Passwörter (scrypt + zufälliges Salt).
- **`response.js`** — `json()` / `error()` / `notFound()`-Helper für einheitliche JSON-Antworten.
- **`url.js`** — `isValidExternalUrl()` schützt Audio-Proxy und Feed-Fetch vor SSRF (blockiert Private/Loopback/cloud-Metadata-Hosts).
- **`resolveFolder.js`** — löcht ein Storage-Verzeichnis relativ zum CWD auf.
- **`thumbnails.js`** — Thumbnail-Größen, Base-Name-Parsing, Magic-Bytes/Mime-Whitelist für `imageService`.

## Tests

```bash
npm test   # node --test (läuft über alle *.test.js)
```

Jeder Service, jede Route und jedes Middleware-Modul verfügt über eine zugeordnete Testdatei. Services lassen sich über das `deps`-Objekt mit Mocks injecten.

## Frontend-Bundle

Der Build (`npm run build`, esbuild) bundelt `public/js/main.js` nach `public/dist/bundle.js`:

```bash
esbuild public/js/main.js --bundle --minify --outfile=public/dist/bundle.js --format=esm
```

> In dieser Sandbox ist die esbuild-CLI (nativer ELF-Binary) nicht mit dem verfügbaren Node ausführbar; Build in produktiver Umgebung ausführen.

## Bezug zur Doku

- localStorage-Entkopplung / Server als Source of Truth: `public/LOCALSTORAGE.md`.
- Feed-Ladestrategie (URL- auf ID-basiert): `public/FEEDS.md`.
