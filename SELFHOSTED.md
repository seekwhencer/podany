# SELFHOSTED — Konzept: Podany auf eigenem Server (Express + MariaDB)

## 1. Ziel

Die aktuelle Cloudflare-Pages-/Workers-App in eine **selbstgehostete Version** überführt werden, die:

- auf einem eigenen Server läuft (**Express.js**, kein Cloudflare/`workerd`)
- eine echte Datenbank nutzt (**MariaDB** statt D1/SQLite)
- **Login/Authentifizierung** mit Sessions bietet (Magic-Link bleibt erhalten, lokaler Dev-Modall kommt dazu)
- zentral **konfigurierbar** ist über **Env-Vars** (keine Hardcoded URLs mehr)
- **Storage** für Audio-Proxy / Offline-Downloads sauber abbildet
- durchgehend in **ES6-Modulen mit `import`/`export`** geschrieben ist
- **zerlegt** ist: keine 185-KB-Einzeldateien mehr, sondern kleine Module und **Klassen**

Die Cloudflare-Deployment-Pfade (`wrangler.json`, `functions/`, `public/`) werden nach und nach durch den Self-Hosted-Stack ersetzt; Self-Hosted ist der **einzig** vorgesehene Stack (`src/`, `server.js`).

---

## 2. Ist-Zustand (kurz)

| Bereich | Aktuell | Ziel |
| :--- | :--- | :--- |
| Frontend | `public/app.js` (~185 KB, 1 Datei, IIFE) | ES6-Module + Klassen |
| Backend | Cloudflare Pages Functions in `functions/api/` | Express-Routes in `src/` |
| DB-Binding | `env.DB` (D1/SQLite) | MariaDB-Pool (`mysql2`) |
| Auth | Magic-Link Resend + Cookie `podcast_session` / `X-Session-Token` | Magic-Link + lokaler Login + Express-Sessions |
| Config | `wrangler.json` vars + `.dev.vars` secrets | Env-Vars + Config-Loader |
| Storage | PWA CacheStorage + Audio-Proxy-Funktion | Audio-Proxy als Express-Route + optionaler Server-Download-Speicher |
| Deployment | Cloudflare Pages / Miniflare-Docker | Docker-Compose mit Express- + MariaDB-Container |

---

## 3. Technische Entscheidungen

- **Server:** `express` (v4). JSON-Body-Parsing, statische Dateien, Middleware-Chaining.
- **DB-Treiber:** `mysql2` (Promise-API) mit Connection-Pool. Kein ORM-Zwang; kleine Data-Access-**Klassen** kapseln die Queries. Optional `sequelize`/`knex` nur wenn Relationen/Relations-Queries überhandnehmen.
- **Sessions:** `express-session` mit `connect-mysql`/`mysql2`-Store (Sitzungen in MariaDB) **oder** eigener `user_sessions`-Table wie aktuell. Cookie `HttpOnly, SameSite=Lax, Secure` (HTTPS-Betrieb).
- **Secrets/Hashing:** `crypto` (Node builtin) für SHA-256-Token-Hashes und `randomUUID` — identisch zum aktuellen `crypto.subtle`-Ansatz, nur Node-native.
- **Env-Config:** `dotenv` aus `.env` (lokal), sonst reine Env-Vars. Zentrale Config-Klasse liest und validiert alles.
- **Email:** Resend bleibt Option (`RESEND_API_KEY`). Ohne Key → **lokaler Modus**: Verify-URL wird direkt im UI/Log ausgegeben (wie heute schon im Dev-Fall).
- **Modulsystem:** `"type": "module"` in `package.json`, alle Dateien ES6 mit `import`/`export`.

---

## 4. Neue Projektstruktur

```
podany/
├── src/                      # Self-Hosted Backend (ES6 + Klassen)
│   ├── server.js             # Express-Einstieg: App, Middleware, Routes, Start
│   ├── config/
│   │   ├── index.js          # Config-Klasse: liest/validiert Env-Vars
│   │   └── defaults.js       # Standardwerte
│   ├── db/
│   │   ├── connection.js     # MariaDB-Pool (MySQLPool-Klasse)
│   │   ├── migrator.js       # wendet schema.sql idempotent an
│   │   └── schema.sql        # MariaDB-adaptiertes Schema
│   ├── models/               # Data-Access-Klassen (je Tabelle eine)
│   │   ├── BaseModel.js      # Basis: Query-Helfer, Pool-Referenz
│   │   ├── User.js
│   │   ├── AuthToken.js
│   │   ├── Session.js
│   │   ├── Subscription.js
│   │   └── PlaybackState.js
│   ├── services/             # Business-Logik-Klassen
│   │   ├── AuthService.js    # Magic-Link, Sessions, Login
│   │   ├── FeedService.js    # RSS-/YouTube-Fetch + XML-Parsing
│   │   ├── AudioProxyService.js  # Range-fähiger Audio-Proxy
│   │   ├── SyncService.js    # Feeds/Positionen zusammenführen
│   │   └── EmailService.js   # Resend-Wrapper + lokaler Modus
│   ├── middleware/
│   │   ├── auth.js           # Request-Authentifizierung (Cookie/Header-Token)
│   │   ├── cors.js
│   │   └── errorHandler.js
│   ├── routes/
│   │   ├── index.js          # Router-Zusammenführung
│   │   ├── auth.routes.js    # /api/auth/*
│   │   ├── sync.routes.js    # /api/sync/*
│   │   └── feed.routes.js    # /api/feed/*, /api/audio-proxy/*
│   └── utils/
│       ├── crypto.js         # hashToken, generateToken
│       ├── url.js            # SSRF-Validierung (isValidExternalUrl)
│       └── response.js       # JSON-Response-Helfer
├── public/                   # Frontend (unverändertes HTML/CSS/sw.js)
├── .env.example              # Env-Var-Vorlage
├── docker-compose.yml        # express-app + mariadb
├── Dockerfile                # Node-Image, `npm run build`+start
├── package.json              # "type": "module", Express-Dependencies
└── SELFHOSTED.md             # dieses Konzept
```

> Das Frontend (`public/app.js`) wird **parallel zerlegt** (siehe Abschnitt 9). Bis dahin kann der Server das aktuelle `public/` statisch ausliefern, um schrittweise zu migrieren.

---

## 5. Datenbank: MariaDB statt SQLite/D1

### 5.1 Schema-Konvertierung (`schema.sql` → `mariadb.schema.sql`)

Kleine Dialekt-Unterschiede müssen angepasst werden:

| D1/SQLite | MariaDB | Grund |
| :--- | :--- | :--- |
| `id TEXT PRIMARY KEY` | `VARCHAR(64) PRIMARY KEY` | `TEXT` darf in MariaDB keine PK sein |
| `email TEXT` | `email VARCHAR(255) UNIQUE NOT NULL` | Länge begrenzen |
| `created_at INTEGER DEFAULT (unixepoch())` | `BIGINT UNSIGNED NOT NULL DEFAULT (UNIX_TIMESTAMP())` | Funktionale Defaults ab 10.2.1 möglich; Unix-Epoch-Sekunden bleiben kompatibel zum App-Code |
| `ON CONFLICT(user_id, feed_url) DO UPDATE …` | `INSERT … ON DUPLICATE KEY UPDATE …` | Unterschiedliche Upsert-Syntax |
| `RETURNING user_id` (im UPDATE) | `SELECT ... WHERE ...` oder letztes `INSERT_ID` | MariaDB unterstützt `RETURNING` nicht (außer via Trigger/MariaDB 10.5+ eingeschränkt) → Verify-Logik leicht umschreiben |

Beispiel Tabelle:

```sql
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL DEFAULT (UNIX_TIMESTAMP())
);
```

**Wichtig:** App-Code nutzt durchgehend Unix-Epoch-Sekunden (`Math.floor(Date.now()/1000)`, `unixepoch()`). Bleibt man bei `BIGINT`-Epoch, bleibt die Logik **identisch** — kein Datumsformat-Wechsel. Alternative: `DATETIME`/`TIMESTAMP` + `CURRENT_TIMESTAMP`, dann muss der Code umgestellt werden (nur wenn gewünscht).

### 5.2 Migration

- `migrator.js` wendet `mariadb.schema.sql` beim Start **idempotent** an (`CREATE TABLE IF NOT EXISTS`).
- Bei bestehenden D1-Daten: **Migrations-Skript** liest D1/SQLite aus und schreibt in MariaDB (einmalig, `npm run migrate:data`).
- Indizes für häufige Filter (`user_id`, `user_id+feed_url`, `user_id+episode_guid`) explizit anlegen.

---

## 6. Authentifizierung & Login

Quelle ist der aktuelle Magic-Link-Flow (`send-link` → Email mit `verify/?token=` → `verify` → Session-Cookie). Er wird als **`AuthService`-Klasse** neu implementiert:

- **Magic-Link (Produktion):** `EmailService` sendet über Resend (`RESEND_API_KEY`). Token wird SHA-256-gehasst in `auth_tokens` gespeichert (aktuelles Design bleibt erhalten).
- **Lokaler Dev-Modus:** ohne Resend-Key liefert `send-link` die `verifyUrl` zurück; das UI leitet direkt ein (heute schon so). Für rein lokale Tests kann zusätzlich ein **direkter Login** (`POST /api/auth/login` mit Email → Session ohne Emailweg) ergänzt werden.
- **Sessions:** nach Verify wird ein 32-Byte-Session-Token generiert, gehasst und in `user_sessions` abgelegt (30 Tage). Authentifizierung läuft über **Cookie** `podcast_session` **oder** Header `X-Session-Token` — beides wird vom `auth`-Middleware behandelt (kompatibel zum Frontend). **Hinweis (festgelegt):** Sessions werden **nicht** in der Datenbank persistiert; `express-session` nutzt einen In-Memory-Store. Session-Rows werden beim Logout verworfen; keine Persistenz in MariaDB.
- **Logout:** Session-Row löschen + Cookie auf `Max-Age=0` setzen.
- **Rate Limiting:** pro Email/Tag und Registrierungsrate (aktuelle Limits: 5 Links/10 min, 30 Neue/10 min) als Middleware/Klasse.

Klassen: `AuthService`, `AuthToken` (Model), `Session` (Model), `EmailService`.

---

## 7. Konfiguration & Env-Vars

Zentrale **`Config`-Klasse** (`config/index.js`) liert alle Werte, validiert Typen und liefert Default aus `defaults.js`. Quelle: Prozess-Env + `.env` (lokal, per `dotenv`).

| Variable | Typ | Pflicht | Beschreibung |
| :--- | :--- | :--- | :--- |
| `PORT` | number | nein (default 8788) | Express-Port |
| `HOST` | string | nein | Bind-Interface |
| `DB_HOST` | string | ja | MariaDB-Host |
| `DB_PORT` | number | nein (3306) | MariaDB-Port |
| `DB_NAME` | string | ja | Datenbankname |
| `DB_USER` | string | ja | DB-User |
| `DB_PASSWORD` | string | ja | DB-Passwort |
| `DB_POOL_MAX` | number | nein (10) | Connection-Pool-Größe |
| `APP_URL` | string | ja | Kanonische Basis-URL (Magic-Links, Cookies-Origin) |
| `FROM_EMAIL` | string | nein | Absenderadresse |
| `RESEND_API_KEY` | secret | nein | Resend (optional → lokaler Modus) |
| `SESSION_SECRET` | secret | ja | Signierung der Session-Cookie |
| `COOKIE_SECURE` | boolean | nein (true bei HTTPS) | `Secure`-Flag |
| `RATE_LIMIT_LINKS_PER_HOUR` | number | nein | Login-Limit pro Email |
| `CORS_ORIGIN` | string/`*` | nein | Erlaubte Origins |

`.env.example` dokumentiert alle Variablen. Secrets niemals committen.

---

## 8. Storage

### 8.1 Audio-Proxy (`AudioProxyService` + Route)

Ersetzt `audio-proxy.js`. Proxied externe Audio-URLs mit **Range-Support** (`HTTP 206`) für die PWA-Offline-Caching des Service Workers. SSRF-Validierung über `utils/url.js` (`isValidExternalUrl`) bleibt erhalten. Express-Route `/api/audio-proxy?url=…`.

### 8.2 Offline-Downloads

Zwei Optionen (Entcheidung getroffen: **Option B, serverseitig**):

- **A) Client-seitig:** *nicht gewählt.*
- **B) Server-seitig (ausgewählt):** Downloads auf dem Host (Dateisystem-Volume oder Object Storage) ablegen; `downloads`-Table in MariaDB, Route `/api/downloads`. Geräteübergreifend offline. Platz- und Bereinigungsstrategie ist beim Aufbau nachzutragen.

---

## 9. Frontend: `app.js` zerlegen (ES6 + Klassen)

Das 185-KB-Einzelfile wird in logische ES6-Module mit **Klassen** aufgeteilt, die über `import` geladen werden. Express liefert sie als Module aus (kein Bundler nötig; nativer Browser-ESM).

Vorschlag für `public/js/`:

```
public/js/
├── main.js            # Einstieg: Module importieren, App initialisieren
├── config.js          # API-Basis-URL, Feature-Flags (Config-Klasse)
├── api.js             # ApiClient-Klasse (fetch-Wrapper, Auth-Header/Cookie)
├── state.js           # AppState-Klasse (zentraler State wie heute `state`)
├── storage.js         # Storage-Klasse (localStorage/IndexedDB-Wrapper)
├── auth.js            # AuthManager-Klasse (Login/Magic-Link/Logout)
├── feeds.js           # FeedsManager (Fetch, Parse-UI, Grid, Detail)
├── playback.js        # PlaybackManager (Audio/YT-Engines, Queue)
├── sync.js            # SyncManager (D1→Server-Sync umstellen)
├── queue.js           # Queue-Klasse
├── downloads.js       # Download/Offline-Klasse
├── timeline.js        # Timeline-/Card-Rendering
├── ui/                # kleine UI-Helfer-Klassen (Modal, Theme, PlayerUI…)
│   ├── modal.js
│   ├── theme.js
│   └── player-ui.js
└── utils.js           # Formatierer (Zeit, Dauer, Datum)
```

**Umstellungsprinzip:**
- `state` → `AppState`-Instanz (Singleton), `elements`-Cache bleibt oder wird in eine DOM-Helfer-Klasse verschoben.
- API-Calls laufen über `ApiClient` statt direktem `fetch` — zentraler Ort für Auth-Token/Cookie und Fehlerbehandlung.
- `sync.js` ersetzt die D1-Sync-Funktionen durch Aufrufe der Express-API (`/api/sync/*`).
- YouTube-/Audio-Engines → Klassen in `playback.js`.
- Schrittweise: Erst Kern (Auth, Feeds, Sync, Playback), dann Features (Queue, Downloads, Timeline, Directory-Search).

**Build (ausgewählt):** `esbuild` — die ES6-Module in `public/js/` werden mit esbuild gebündelt und getree-shaken. Nativer Browser-ESM ohne Build bleibt als Fallback bestehen, ist aber nicht der Plan.

---

## 10. Server-Architektur (Express)

- `server.js`: erstellt Express-App, registriert Middleware (`cors`, JSON-Parsing, `express.static('public')`, `express-session`), lädt Routes, startet Listener nach DB-Migration.
- **Middleware `auth.js`**: liert Session-Token aus Cookie/Header, löst über `Session`-Model den User (JOIN auf `users`), legt `req.user` ab. Schützt `/api/sync/*`, `/api/feed/*`.
- **Routes** delegieren an Services (`AuthService`, `FeedService`, `SyncService`). Services nutzen Models für DB-Zugriff. Trennung: Route (HTTP) → Service (Logik) → Model (Daten).
- **Fehlerbehandlung:** zentraler `errorHandler`-Middleware, keine `try/catch`-Wüste mehr pro Route.
- **SSRF-Schutz:** `isValidExternalUrl` (`utils/url.js`) für alle externen URLs (Feeds, Audio-Proxy).

Schichten: `routes/` → `services/` → `models/` → `db/connection.js`.

---

## 11. Deployment (Docker)

`docker-compose.yml` mit zwei Services:

```yaml
services:
  db:
    image: mariadb:11
    environment:
      MARIADB_DATABASE: ${DB_NAME}
      MARIADB_USER: ${DB_USER}
      MARIADB_PASSWORD: ${DB_PASSWORD}
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
    volumes:
      - podany-mariadb:/var/lib/mysql
    restart: unless-stopped
  app:
    build: .
    depends_on:
      db: { condition: service_healthy }
    environment:
      DB_HOST: db
      DB_PORT: "3306"
      DB_NAME: ${DB_NAME}
      DB_USER: ${DB_USER}
      DB_PASSWORD: ${DB_PASSWORD}
      APP_URL: ${APP_URL}
      FROM_EMAIL: ${FROM_EMAIL}
      RESEND_API_KEY: ${RESEND_API_KEY}   # optional
      SESSION_SECRET: ${SESSION_SECRET}
    ports:
      - "8788:8788"
    restart: unless-stopped
volumes:
  podany-mariadb:
```

- `Dockerfile`: Node-Image, `"type":"module"`, `npm ci`, kopiert `src/` + `public/`, CMD `node src/server.js`.
- App führt beim Start die DB-Migration aus (`migrator.js`) — kein separater Setup-Schritt nötig.
- Healthcheck: App wartet auf DB-Erreichbarkeit, wiederholt Verbindungsversuche.

---

## 12. Umstellungs-/Migrationsstrategie

1. **Backend neu aufbauen** in `src/` (Express + MariaDB + Klassen), Frontend vorerst altes `public/` ausliefern.
2. **Datenmigration** D1/SQLite → MariaDB (einmaliges Skript).
3. **Self-Hosted lokal testen** (`docker compose up --build`).
4. **Frontend schrittweise modularisieren** (`public/js/`), parallel zum alten `app.js`; Umschaltung letzter Schritt.
5. **Cloudflare-Variante ablösen:** Logik aus `functions/` nach `src/` migrieren, Cloudflare-Pfade (`wrangler.json`, `functions/`, `public/`) entfallen; Self-Hosted bleibt einziger Stack.
6. Feature-Gate für lokalen Login vs. Magic-Link über Env-Var (`AUTH_MODE=magic|local|mixed`).

---

## 13. Neue Dependencies (`package.json`)

```json
{
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "db:migrate": "node src/db/migrator.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-session": "^1.18.0",
    "mysql2": "^3.11.0"
  }
}
```

Sessions laufen In-Memory (`express-session`), ein DB-Session-Store (`connect-mysql2`/`session-store`) wird **nicht** benötigt.

---

## 14. Offene Entscheidungen (beantwortet / festgelegt)

Die folgenden Entscheidungen wurden getroffen und sind nun verbindlich:

| Entscheidung | Antwort | Konsequenz |
| :--- | :--- | :--- |
| **Login-Modus** | ja, auch direkter Email-Login | `AUTH_MODE=magic\|local\|mixed` (Abschnitt 6, 12) |
| **Timestamps** | UNIX Epoch | BIGINT-Epoch bleibt, App-Code bleibt identisch (Abschnitt 5.1) |
| **Downloads** | serverseitig | Option B (Abschnitt 8.2): `downloads`-Table + `/api/downloads`-Route |
| **Sessions** | nicht in der Datenbank | In-Memory-Store (`express-session`), Cookie/`X-Session-Token` wie aktuell; keine `user_sessions`-Table, kein DB-Store |
| **Frontend-Build** | esbuild | Build-Stufe mit esbuild für Bundle/Tree-Shaking (Abschnitt 9) |
| **Cloudflare-Variante** | vollständig durch Self-Hosted ersetzen | Cloudflare-Pfade (`wrangler.json`, `functions/`, `public/`) entfallen später; Self-Hosted ist der einzige Stack (Abschnitt 1, 12) |

### Details zu den Entscheidungen

- **Login (`AUTH_MODE`):** Magic-Link bleibt Kernflow; lokaler Dev-Modall/direkter Email-Login (`POST /api/auth/login` ohne Emailweg) kommt dazu. Werte: `magic` (nur Magic-Link), `local` (nur lokaler Login), `mixed` (beides).
- **Timestamps:** Bei `BIGINT UNSIGNED` Unix-Epoch-Sekunden bleiben; kein Datumsformat-Wechsel im App-Code.
- **Downloads serverseitig:** Episoden auf dem Host ablegen (Volume/Object Storage), `downloads`-Table in MariaDB, Route `/api/downloads`, geräteübergreifend offline. Bereinigungs-/Platzstrategie ist nachzutragen.
- **Sessions nicht in DB:** `express-session` mit In-Memory-Store (kein `connect-mysql2`). Cookie `podcast_session` (`HttpOnly, SameSite=Lax, Secure`) bzw. Header `X-Session-Token`. Session-Rows werden beim Logout verworfen; Persistenz entfällt.
- **Build esbuild:** Frontend-Module (`public/js/`) mit esbuild gebündelt und getree-shaken; nativer Browser-ESM als Fallback nur falls nötig.
- **Cloudflare ersetzen:** Self-Hosted wird zum primären/einzigem Deployment-Stack. Migration der Logik aus `functions/` nach `src/`, Schema bleibt kompatibel.

---

## 15. Arbeitsablaufplan für die agentische Abarbeitung

Plan für die schrittweise Umsetzung des Self-Hosted-Stacks. Phasen sind **sequenziell abhängig**, wo eine niedrigere Schicht von einer höheren genutzt wird. Innerhalb einer Phase können unabhängige Module **parallel** (eigene Agent Manager Sessions) bearbeitet werden. Jede Phase liefert ein lauffähiges, getestetes Teilsystem und hängt an der vorherigen an.

**Grundregeln für alle Agenten:**
- Durchgehend ES6-Module (`import`/`export`), `"type": "module"`.
- Trennung `routes/ → services/ → models/ → db/connection.js`. Keine Logik in Routes.
- Externe URLs immer über `utils/url.js` (`isValidExternalUrl`) validieren (SSRF-Schutz).
- Timestamps durchgehend UNIX-Epoch-Sekunden (`Math.floor(Date.now()/1000)`).
- Secrets nie committen; alle Config-Werte über die `Config`-Klasse (Abschnitt 7).
- Pro Phase: `npm run lint`/`node --check` und ein funktionaler Test/Lokaler Lauf vor Abschluss.

### Phase 0 — Projekt-Scaffolding & Konfiguration (Blockiere alle anderen)
Erzeugt die Basis, ohne die nichts läuft.
- `package.json` (`"type": "module"`, Dependencies: express, cors, dotenv, express-session, mysql2, esbuild; Scripts: start/dev/db:migrate/build).
- `src/config/defaults.js` + `src/config/index.js` (Config-Klasse: lesen/validieren, Defaults).
- `.env.example` (alle Env-Vars, Abschnitt 7), `.gitignore`, `.dockerignore`.
- Abnahme: `Config` liert alle Werte korrekt, ungültige Pflichtvars werfen einen klaren Fehler.

### Phase 1 — Datenbank-Schicht (abhängig von Phase 0)
- `src/db/schema.sql` (MariaDB-adaptiert: `VARCHAR(64)` PKs, `BIGINT` Epoch-Upserts mit `ON DUPLICATE KEY UPDATE`, Indizes; Abschnitt 5.1).
- `src/db/connection.js` (`MySQLPool`-Klasse, `mysql2` Pool, `DB_POOL_MAX`).
- `src/db/migrator.js` (wendet schema.sql idempotent an, `npm run db:migrate`).
- Abnahme: lokaler MariaDB-Pool verbindet, Migration legt alle Tabellen/Indizes an.

### Phase 2 — Models / Data-Access (abhängig von Phase 1)
Parallelisierbar, da jedes Model isoliert ist. Basieren auf `BaseModel`.
- `src/models/BaseModel.js` (Query-Helfer, Pool-Referenz).
- `src/models/User.js`, `AuthToken.js`, `Subscription.js`, `PlaybackState.js`, `Downloads.js` (`downloads`-Table für serverseitige Downloads, Abschnitt 8.2).
- Hinweis: **keine** `Session`-Tabelle/Sessions-Model (Sessions In-Memory, Abschnitt 6/14).
- Abnahme: jedes Model führt CRUD/Upsert gegen die DB aus; Tests pro Model.

### Phase 3 — Utilities (parallel zu Phase 1/2 möglich, keine DB-Abhängigkeit)
- `src/utils/crypto.js` (`hashToken` SHA-256, `generateToken`, Node `crypto`).
- `src/utils/url.js` (`isValidExternalUrl`, SSRF-Schutz).
- `src/utils/response.js` (JSON-Response-Helfer).
- Abnahme: Unit-Tests für Hashing, Token-Generierung und URL-Validierung.

### Phase 4 — Services / Business-Logik (abhängig von Phase 1–3)
Parallelisierbar je nach Service.
- `src/services/EmailService.js` (Resend-Wrapper + lokaler Modus ohne Key, Abschnitt 7).
- `src/services/AuthService.js` (Magic-Link, lokaler Login je `AUTH_MODE`, Session-Erzeugung/Verwurf, Rate Limiting pro Email/Tag).
- `src/services/FeedService.js` (RSS-/YouTube-Fetch + XML-Parsing, SSRF-gültige URLs).
- `src/services/AudioProxyService.js` (range-fähiger Proxy, HTTP 206, SSRF-Schutz).
- `src/services/SyncService.js` (Feeds/Positionen zusammenführen; Sync über API statt D1).
- `src/services/DownloadsService.js` (serverseitige Downloads: Speichern/Auflisten/Löschen, Volume/Object Storage, Bereinigung).

### Phase 5 — Middleware (abhängig von Phase 3)
- `src/middleware/cors.js` (CORS_ORIGIN, Abschnitt 7).
- `src/middleware/auth.js` (Session-Token aus Cookie/Header → `req.user`, schützt `/api/sync/*`, `/api/feed/*`).
- `src/middleware/errorHandler.js` (zentrale Fehlerbehandlung).
- Rate-Limiting als Middleware/Klasse (Abschnitt 6).


### Phase 6 — Routes (abhängig von Phase 4, 5)
Parallelisierbar je Router.
- `src/routes/index.js` (Zusammenführung).
- `src/routes/auth.routes.js` (`/api/auth/*`: send-link, verify, login, logout).
- `src/routes/sync.routes.js` (`/api/sync/*`).
- `src/routes/feed.routes.js` (`/api/feed/*`, `/api/audio-proxy/*`, `/api/downloads/*`).

### Phase 7 — Server-Einstieg & Start (abhängig von Phase 5, 6)
- `src/server.js` (Express-App, Middleware-Chaining, `express.static('public')`, `express-session` In-Memory, Routes, Listener nach DB-Migration, Healthcheck auf DB).

### Phase 8 — Deployment / Docker (parallel zu Phase 7, abhängig von Phase 0)
- `Dockerfile` (Node, `npm ci`, kopiert `src/`+`public/`, CMD `node src/server.js`).
- `docker-compose.yml` (express-app + mariadb, Abschnitt 11; Compose-Files für Prod vorhanden prüfen).
- `docker-entrypoint.sh` (Warten auf DB, Migration beim Start, Healthcheck).
- Abnahme: `docker compose up --build` bringt beide Container hoch, App ist erreichbar.

### Phase 9 — Frontend modularisieren + esbuild-Build (parallel, nur statische Abhängigkeit zu Phase 6/7 API)
- Zerlegung von `public/app.js` in ES6-Klassen nach `public/js/` (Abschnitt 9): `main`, `config`, `ApiClient`, `AppState`, `Storage`, `AuthManager`, `FeedsManager`, `PlaybackManager`, `SyncManager`, `Queue`, `Downloads`, `Timeline`, `ui/*`, `utils`.
- Build-Stufe mit **esbuild** (Bundle + Tree-Shaking); `public/` weiterhin statisch auslieferbar.
- Abnahme: gebundelter Build läuft, UI ruft die Express-API über `ApiClient` auf.

### Phase 10 — Datenmigration D1/SQLite → MariaDB (abhängig von Phase 1, 2)
- Einmaliges Skript (`npm run migrate:data`) liert D1/SQLite aus und schreibt in MariaDB.
- Abnahme: bestehende User/Feeds/States/Subscriptions/Downloads appearen korrekt in MariaDB.

### Phase 11 — Integrationstest & lokaler Lauf (abhängig von Phase 7–10)
- Full-Stack-Test in Docker: Magic-Link/lokaler Login, Sync, Feed-Fetch, Audio-Proxy (206), Downloads, Offline.
- Abnahme: End-to-End-Flow ohne Fehler; Rate Limits greifen.

### Phase 12 — Cloudflare-Variante ablösen (letzter Schritt, abhängig von Phase 7–11)
- Logik aus `functions/` endgültig nach `src/` übernommen, Schema-Konzept bleibt kompatibel.
- Cloudflare-Pfade (`wrangler.json`, `functions/`, `public/`) entfernen; Self-Hosted ist einziger Stack.
- Abnahme: kein Cloudflare-Referenz mehr im Repo, Self-Hosted deployt und produktiv.

### Empfohlene Parallelisierung (Agent Manager)
- **Phase 3** (Utils) und **Phase 0** (Scaffolding) früh starten; Utils parallel zu Phase 1/2.
- Innerhalb von **Phase 2** (Models), **Phase 4** (Services) und **Phase 6** (Routes) je Modul eine eigene Session.
- **Phase 8** (Docker) läuft parallel zu **Phase 7** (Server).
- **Phase 9** (Frontend/esbuild) kann parallel zu **Phase 7–8** laufen, da es nur an der fertigen API-Schnittstelle hängt.
- Phasen 0→12 sind die kritische Kette; erst Phase 7 (lauffähiger Server) erlaubt Phase 11.
