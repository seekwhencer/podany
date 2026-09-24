# Server (podany)

Selbstgehosteter Podcast-RSS-Aggregator mit Web-Player. Stack: **Node.js (ESM-Module)** + **Express 4** + **MariaDB** (`mysql2`).

## Einstiegspunkt

Der Server startet aus **`src/server.js`** (es gibt kein Verzeichnis `src/server/`).

```bash
npm start      # node src/server.js
npm run dev    # node --watch src/server.js (Hot-Reload)
npm run db:migrate   # Schema manuell anwenden
```

## Architektur

`src/server.js` exportiert zwei Funktionen und nutzt **Dependency-Injection** über ein optionales `deps`-Objekt (ermöglicht Tests):

- **`createApp(deps)`** — baut die Express-App (Middleware-Kette).
- **`start(deps)`** — wartet auf DB, migriert das Schema, startet den Listener, registriert Shutdown-Handler.
- Der Datei-Selbststart (`import.meta.url === file://${process.argv[1]}`) ruft `start()` bei direkter Ausführung auf.

```mermaid
flowchart TD
    A[start()] --> B[createApp(deps)]
    B --> C[CORS + JSON-Parser + Session]
    C --> D[/api Router]
    D --> E[express.static public/]
    E --> F[SPA-Fallback index.html]
    F --> G[notFound + errorHandler]
    A --> H[waitForDb: DB-Ping mit Retry]
    H --> I[migrate: Schema anwenden]
    I --> J[app.listen auf host:port]
    J --> K[SIGINT/SIGTERM → graceful shutdown]
```

### Middleware-Kette (`createApp`)

1. `createCors()` — CORS konfigurieren
2. `express.json({ limit: '1mb' })` — JSON-Body-Limit
3. `express-session` — Session-Cookie `podany_session` (`httpOnly`, `sameSite: lax`, `secure` je nach Config)
4. `/api` → Router mit den Endpunkten
5. `express.static(PUBLIC_DIR)` — statische Dateien aus `public/`
6. **SPA-Fallback** (Zeilen 41–44): Alle nicht-`/api`-Routes liefern `index.html`, damit Client-Side-Routing und Magic-Link-Callbacks (`/auth/verify/?token=…`) funktionieren
7. `notFoundHandler` + `errorHandler` — zentrale Fehlerbehandlung

## Konfiguration (`src/config/index.js`)

Singleton via **Proxy** (lazy init beim ersten Zugriff). Liest `.env` und validiert Umgebungsvariablen streng (`_require` wirft bei fehlenden Pflichtvars).

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | ja | DB-Verbindung |
| `APP_URL` | ja | öffentliche Basis-URL (Schluss-slash wird abgeschnitten) |
| `SESSION_SECRET` | ja | Secret für Session-Signatur |
| `PORT`, `HOST` | nein | Standard 3000 / 0.0.0.0 |
| `DB_PORT`, `DB_POOL_MAX` | nein | Port und Pool-Größe |
| `AUTH_MODE` | nein | `magic` \| `local` \| `mixed` |
| `MAGIC_LINK_ENABLED` | nein | Magic-Link-Login deaktivieren (Standard `true`) |
| `RESEND_API_KEY` | nein | aktiviert E-Mail-Versand (Magic Link) |
| `FROM_EMAIL` | nein | Absenderadresse |
| `COOKIE_SECURE` | nein | Cookie nur über HTTPS |
| `CORS_ORIGIN` | nein | erlaubte CORS-Origin |
| `RATE_LIMIT_LINKS_PER_HOUR` | nein | Begrenzung von Feed-Link-Anfragen |
| `DEFAULT_USER_EMAIL` | nein | E-Mail des beim Start angelegten Default-Users (leer = deaktiviert) |
| `DEFAULT_USER_PASSWORD` | nein | Passwort des Default-Users (leer = kein Password-Login für diesen User) |
| `DEFAULT_USER_COLOR` | nein | Standardfarbe des Default-Users (Hex wie `#aabbcc`) |

Ableitete Werte: `resendEnabled`, `localLoginEnabled`, `magicLinkEnabled`, `isDev` (true, wenn kein Resend aktiv).

## Datenbank (`src/db/`)

- **`connection.js`** — `MySQLPool`-Wrapper um `mysql2/promise` mit Connection-Pool. Wiederholt das Proxy-Singleton-Pattern. Abstrahierte Methoden: `query`, `execute`, `rows`, `row`, `firstColumn`, `run`, `beginTransaction`, `getConnection`, `ping`, `close`.
- **`migrator.js`** — wendet `schema.sql` an (wird in `start()` aufgerufen).
- **`migrate-data.js`** / **`migrateSources.js`** — Daten-Migrationen (einzelne Skripte, nicht Teil des Startablaufs).

`start()` ruft `waitForDb()` auf: pollt die MariaDB per `ping()` bis zu 30× mit 1s Abstand, falls die DB beim Start noch nicht bereit ist (typisch in Docker).

## Default-User

Nach erfolgreicher Migration legt `start()` über `seedDefaultUser()` einen Default-User an, wenn `DEFAULT_USER_EMAIL` gesetzt ist (`server.js:24`). Der Vorgang ist idempotent (kein Doppel-Anlegen) und schlägt still, aber ohne Abbruch des Starts, fehl. Ein gesetztes `DEFAULT_USER_PASSWORD` wird mit `hashPassword()` gehasht und als `password_hash` gespeichert, sodass der Default-User sich mit Passwort einloggen kann. Die Farbe erhält der User aus `DEFAULT_USER_COLOR` (Standard `#d8cdbe`).

## Router & Endpunkte (`src/routes/`)

Alle liegen unter `/api`. Die Middleware `auth.js` (`createAuthMiddleware`) setzt `req.user` aus dem Session-Token.

| Bereich | Endpunkte | Auth |
|---|---|---|
| `/auth` | `POST /send-link`, `/verify`, `/login` (`email` + optionales `password`), `/logout`, `GET /me` | öffentlich (Login-Flow) |
| `/sync` | `GET/POST/DELETE /subscriptions`, `GET/POST /positions` | **Pflicht** |
| `/user` | `GET /options`, `PATCH /options` (z. B. `color`) | **Pflicht** |
| `/feed` | `POST /fetch` (RSS-Feeds holen) | öffentlich |
| `/audio-proxy` | `GET /?url=…` (streamt Audio mit Range-Support + CORS) | öffentlich |
| `/downloads` | CRUD für Downloads (`GET/POST /`, `POST /:id/start`, `DELETE /`, `DELETE /:id`) | **Pflicht** |

Der `/auth/login`-Endpunkt akzeptiert ein optionales `password`: Mit Passwort läuft ein Password-Check (`loginWithPassword`), ohne Passwort wie bisher der E-Mail-only-Login (`login`).

## Services (`src/services/`)

Jeder Route entspricht ein Service:

- **`authService`** — Magic-Link- und Local-Login-Logik (E-Mail + optionales Passwort), Session-Token.
- **`userService`** — User-Optionen (z. B. `color`) abfragen und aktualisieren.
- **`sessionStore`** — verwaltet Session-Tokens mit TTL.
- **`syncService`** — Abonnements und Play-Positionen pro User.
- **`feedService`** — RSS/Feed-Parsing und `-fetch`.
- **`audioProxyService`** — streamt externe Audio-URLs (Range-Support).
- **`downloadsService`** — Download-Registrierung und -Abruf.
- **`emailService`** — E-Mail-Versand über Resend.
- **`rateLimiter`** — Request-Begrenzung.

## Modelle (`src/models/`)

ORM-ähnliche Wrapper um die Tabellen: `User`, `Subscription`, `PlaybackState`, `AuthToken`, `Downloads` (plus `BaseModel` als Basis).

## Utilities (`src/utils/`)

- **`crypto.js`** — Generierung sicherer Tokens.
- **`password.js`** — `hashPassword()` / `verifyPassword()` für User-Passwörter (scrypt + zufälliges Salt).
- **`response.js`** — `json()`-Helper für einheitliche JSON-Antworten.
- **`url.js`** — `isValidExternalUrl()` schützt den Audio-Proxy vor SSRF.

## Tests

```bash
npm test   # node --test (läuft über alle *.test.js)
```

Jeder Service, jede Route und jedes Middleware-Modul verfügt über eine zugeordnete Testdatei. Services lassen sich über das `deps`-Objekt mit Mocks injecten.
