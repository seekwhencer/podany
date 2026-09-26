# FEEDS — Konzept: `api/feed/fetch` von URL-basiert auf DB-ID-basiert

> Wechsel des Feed-Ladevorgangs vom „Quelle neu laden + parsen" hin zu einem reinen
> Datenbank-Lesezugriff. Der Endpunkt soll künftig die **DB-ID des Feeds** (Subscription)
> als Eingnahme nehmen und die bereits in der DB liegenden Daten (Feed + seine
> Downloads = Episoden) zurückgeben. Kein Fetch und kein Parser mehr auf die Feed-URL.

---

## 1. Ziel und Problemstellung

### Ist-Zustand (`api/feed/fetch`)
- Client ruft `api.fetchFeed(url)` → `POST /api/feed/fetch` mit `{ url }`.
- Server (`FeedRoutes.post('/fetch')` → `FeedService.fetchFeeds(urls)`) **lädt die Feed-Quelle
  erneut vom Internet und parst RSS/Atom** (`podcastService.js` / `youtubeService.js`).
- Ergebnis: `{ title, artwork, episodesCount, description, episodes: [...] }`.
- Client speichert Metadaten in `state.feedMetadata[url]` und Episoden in `state.allEpisodes`.

### Probleme
- **Jeder Refresh lädt + parst jede Feed-Quelle erneut** (Netzwerk, Latenz, Rate-Limits,
  Ausfall der Quelle = leerer Client).
- Redundant: Feed-Episoden sind bereits als `downloads`-Rows in der DB vorhanden.
- Parse-Logik (RSS/Atom/YouTube) wird bei jedem Laden wiederholt statt einmalig beim Hinzufügen.

### Soll-Zustand
- Endpunkt nimmt die **DB-ID des Feeds** (`subscriptions.id`, Präfix `sub_`) entgegen.
- Server liefert **nur einen DB-Lesezugriff**: Subscription-Daten + deren `downloads` (Episoden).
- **Kein Fetch, kein Parser auf die Feed-URL.** Quelle wird nur noch beim *ersten Hzufügen*
  (Add-Subscription) einmalig geladen — nicht bei jedem Laden/Refresh.

---

## 2. Datenmodell (Ist)

### `subscriptions` (ein Feed)
| Spalte | Typ | Anmerkung |
|---|---|---|
| `id` | varchar(64) | Primary Key, Präfix `sub_` |
| `user_id` | varchar(64) | FK → users |
| `feed_url` | text | RSS/YouTube-URL (Größenkey für den Client) |
| `title`, `artwork`, `image`, `description`, `category`, `language`, `pubDate` | various | Metadaten beim Add-Time-Parse gespeichert |
| `created_at` | bigint | |

`Subscription.listByUser` liefert bereits `id`, `feed_url`, `title`, `artwork`, `image`,
`description`, `category`, `language`, `pubDate` + `episodes_count` (Subquery auf `downloads`).

### `downloads` (die Episoden des Users = „Downloads" eines Feeds)
| Spalte | Typ | Anmerkung |
|---|---|---|
| `id` | varchar(64) | Primary Key, Präfix `dl_` |
| `user_id` | varchar(64) | FK → users |
| `episode_guid` | text | Eindeutiger Key pro User+Episode |
| `subscription_id` | varchar(64) | FK → subscriptions (welcher Feed) |
| `title` | varchar(512) | |
| `artwork`, `image` | text | |
| `audio_url` | text | Stream-/Download-URL |
| `file_path`, `file_size` | text / bigint | Lokal gespeicherte Audio-Datei |
| `status`, `progress`, `error` | various | Download-Status |
| `created_at`, `updated_at`, `received_at` | bigint | |

---

## 3. Kritische Lücke: `downloads` speichert nicht alle Episoden-Felder

Der Client benötigt für die Anzeige/Sortierung einer Episode (siehe `timeline.js`:
`createEpisodeCard`, `processAndSortEpisodes`, `openShowNotes`) folgende Felder:

| Feld | Client-Nutzung | In `downloads`? |
|---|---|---|
| `guid` | Gruppierung, Playback, Positions-Sync | ✅ `episode_guid` |
| `title` | Anzeige | ✅ `title` |
| `podcastTitle` | Anzeige, Sortierung | ❌ → aus `subscriptions.title` |
| `feedUrl` | Gruppierung, Detail-Navigation | ❌ → aus `subscriptions.feed_url` |
| `timestamp` | Sortierung (neueste/älteste, „Continue") | ❌ **nicht gespeichert** |
| `pubDate` | Datums-Anzeige (Fallback) | ❌ **nicht gespeichert** |
| `duration` | Dauer-Anzeige, -Sortierung | ❌ **nicht gespeichert** |
| `artwork` | Thumbnail | ✅ `artwork` |
| `description` | Card + Show Notes | ❌ **nicht gespeichert** (`downloads` hat keine Description-Spalte) |
| `content` | Show Notes (HTML) | ❌ **nicht gespeichert** |
| `isYouTube` | YouTube-spezifisches Rendering | ❌ **nicht gespeichert** |
| `audioUrl` | Playback | ✅ `audio_url` |

**Folge:** Ein reiner `downloads`-Read kann aktuell *nicht* die vollen Episoden-Objekte
rekonstruieren. Die Metadaten (`timestamp`, `duration`, `description`, `content`, …) werden
beim Add-Time-Parse verworfen und nur `title`/`audioUrl`/`artwork` persistiert
(siehe `SubscriptionRoutes.enqueueEpisodesForFeed` → `downloads.register`).

### Entscheidung erforderlich (Soll)
Die Episoden-Metadaten müssen **beim ersten Parsen (Add-Subscription) in `downloads`
persistiert** werden, damit der Leseendpunkt sie ohne Fetch liefern kann. Zwei Optionen:

- **Option A — Explizite Spalten (empfohlen, passt zum normalisierten Schema):**
  Ergänzung von `timestamp` (bigint), `pub_date` (text), `duration` (varchar),
  `description` (text), `content` (longtext), `is_youtube` (tinyint) in `downloads`.
  Populate beim `register`/`enqueue` aus dem geparsten Episode-Objekt.
- **Option B — JSON-Spalte `episode_meta`:** Flexibler, bricht aber mit dem
  Spalten-Konventionen der DB; Indizieren/Sortieren auf DB-Ebene entfällt.

> Empfehlung: **Option A**, um Konsistenz mit den bestehenden Tabellen zu wahren und
> Sortierung/Filterung auch serverseitig zu ermöglichen. Migration über `server/db/migrator.js`.

---

## 4. Endpunkt-Design (Soll)

### Primär: einzelner Feed nach ID
```
GET /api/feed/:id        (auth-required)
```
- Eingabe: `subscriptions.id` (`sub_...`).
- Output:
  ```json
  {
    "feed":  { "id", "feed_url", "title", "artwork", "image", "description",
               "category", "language", "pubDate", "episodesCount" },
    "episodes": [
      { "guid", "title", "podcastTitle", "feedUrl", "timestamp", "pubDate",
        "duration", "artwork", "description", "content", "isYouTube", "audioUrl" }
    ]
  }
  ```
- `episodes` werden aus `downloads JOIN subscriptions` rekonstruiert:
  `podcastTitle = subscription.title`, `feedUrl = subscription.feed_url`.
- **Kein Fetch/Parse.** Bei 404 (kein Subscription) → `200 { feed: null, episodes: [] }`
  oder `404` — Client zeigt „keine Daten".

### Option (optional, effizienter Boot): Bulk-Endpunkt
```
GET /api/feeds         (auth-required)  → { feeds: [ { id, ...sub, episodes: [...] } ] }
```
Ein Aufruf statt N Aufrufen beim Boot. Passend zur „Server als Source of Truth" / async-boot
Strategie. Kann parallel zu `listSubscriptions`/`listPositions`/`listDownloads` laufen
(`api.loadAll()` erweitern).

> Scope dieser Änderung: Endpunkt-Lesezugriff. Der **Add-Flow** (`POST /api/subscription`)
> bleibt bestehen und lädt die Quelle **einmalig beim Hzufügen** — das ist notwendig, um
> Episoden überhaupt erst zu entdecken. Nur die wiederholten Lese-/Refresh-Calls entfallen.

---

## 5. Frontend-Änderungen

### `api.js`
- `fetchFeed(url)` / `fetchFeeds(urls)` (POST `/api/feed/fetch`) **entfernen**.
- Neue Methode: `loadFeedById(id)` → `GET /api/feed/:id` → `{ feed, episodes }`.
- Optional: `loadFeeds()` (Bulk) für den Boot.

### `sync.js` — URL→ID-Mapping aufbauen
- `listSubscriptions()` liefert bereits `id` + `feed_url` (aus `Subscription.listByUser`).
- Mapping im State halten: `state.feedIdByUrl[url] = id`.
- `syncFeedsWithServer()`: nach dem Laden der Feeds das Mapping aus `subs.feeds` bauen.

### `feeds.js` — von URL- auf ID-basiertem Laden
- `state.feeds` bleibt Array von URLs (UI/OPML/Add arbeiten mit URLs).
- `refreshAllFeeds()`: pro Feed `url → id` auflösen und `loadFeedById(id)` rufen statt
  `fetchFeed(url)`. Merge in `state.allEpisodes` / `state.feedMetadata` analog zum Ist.
- `fetchSingleFeed(url, …)`: auf `loadFeedById(id)` umstellen; `id` aus `state.feedIdByUrl`.
- `renderFeedDetail()`: Preview-Laden für **nicht** Subskribierte siehe §6.

---

## 6. Randbedingungen und offene Fragen

1. **Preview für nicht-subskribierte Feeds** (`renderFeedDetail`, `feeds.js:722`):
     Aktuell wird `fetchSingleFeed` genutzt, um Episoden *vor* dem Folgen VORANZEIGEN zu können.
     Ohne Subscription-Row existiert kein `id` → kein DB-Lesezugriff.
     → **Offen:** Preview beibehalten (nur für nicht-subskribierte URLs, also der einzige
     verbleibende URL-Fetch) **oder** Preview-Funktion einschränken/entfallen lassen.

2. **YouTube-Feeds** (Playlists): Beim Add-Time-Parse entsteht oft nur eine „Single-Episode"-
     Repräsentation. Muss in `downloads` als Episode persistierbar sein; `isYouTube`/`playlistId`
     in den Metadaten mit speichern (Option A: `is_youtube`).

3. **Offline-Audio unverändert**: Service-Worker-Cache (`podany-audio-v1`) und
   `audioProxyUrl`/`streamAudio` bleiben bestehen; nur die Episoden-*Metadaten*-Ladestrategie
   ändert sich.

4. **Add-Subscription muss Metadaten persistieren** (§3): Ohne Populate von
   `timestamp/pubDate/duration/description/content/isYouTube` in `downloads` liefert der
   Leseendpunkt nur bare Felder. Dies ist eine zwingende Voraussetzung.

5. **Bestehende Daten (Migration)**: Alte `downloads`-Rows ohne neue Spalten → fehlende
   Felder sind leer; Sortierung fällt auf `created_at`/`0`. Reiner Lesezugriff bleibt
   funktionsfähig, nur „neueste/älteste"-Sortierung eingeschränkt, bis Feeds neu geladen
   wurden. Migration/Backfill optional.

6. **`episodes_count`**: Aus dem Subquery `COUNT(downloads)` ableibar; nach §3-Option-A auch
   aus der zurückgegebenen `episodes`-Liste berechenbar.

---

## 7. Umsetzungsreihenfolge (Vorschlag)

1. Schema-Ergänzung `downloads` (§3, Option A) + Migrator.
2. `downloads.register`/`enqueueEpisodesForFeed`: Episode-Metadaten in neuen Spalten speichern.
3. Server: neuer Leseendpunkt `GET /api/feed/:id` (Service + Route, auth-required).
4. Frontend: `api.loadFeedById`, Mapping in `sync.js`, Umstellung `feeds.js`.
5. Preview-Frage (§6.1) klären und entsprechend implementieren.
6. Tests: `feedService.test.js`/neuer Feed-Read-Test; Frontend-Manuell-Check Refresh ohne Netz.

---

## 8. Arbeitsschritte (detailliert, an Code-Entitäten orientiert)

> Die Schritte sind so sortiert, dass jeder ein für sich abgeschlossenes, testbares
> Inkrement liefert. Abhängigkeiten laufen von unten nach oben (§8.1 → §8.5).
> Alle Dateinamen/Pfade beziehen sich auf den Ist-Stand dieser Repo-Kopie.

### Phase 1 — Episoden-Metadaten beim Add persistieren (Voraussetzung für §3)

**Schritt 1.1 — Schema erweitern (`server/db/schema.sql`)**
- Neue Spalten zur `downloads`-Tabelle hinzufügen: `timestamp BIGINT UNSIGNED`, `pub_date TEXT`, `duration VARCHAR(64)`, `description TEXT`, `content LONGTEXT`, `is_youtube TINYINT NOT NULL DEFAULT 0`.
- Hinweis zum Migrator (`server/db/migrator.js`): `migrate()` wendet **jedes Mal** die ganze `schema.sql` an und nutzt nur `CREATE TABLE IF NOT EXISTS`. Ein reines `ALTER TABLE ... ADD COLUMN` schlägt beim 2. Lauf fehl (Spalte existiert). Daher entweder
  - die `CREATE TABLE downloads`-Definition komplett um die Spalten ergänzen (gilt nur für frische DBs), **und** zusätzlich ein migrationsrobustes `ALTER TABLE`-Muster verwenden, das einen Check enthält, **oder**
  - einen separaten datenbankseitigen Guard bauen (`ADD COLUMN` nur falls nicht vorhanden).
  → Entscheidung dokumentieren; für Bestandsdaten optional Backfill sehen (§6.5).

**Schritt 1.2 — Modell anpassen (`server/models/Downloads.js`)**
- `UPDATABLE`-Array um `timestamp`, `pub_date`, `duration`, `description`, `content`, `is_youtube` erweitern.
- `create(...)`-Signatur um die neuen Felder erweitern und ins `INSERT` aufnehmen (Default `is_youtube = 0`, Rest leer/`null`).
- Ggf. `listByUser`/neue Lese-Methode nach Sortierfeld (`timestamp`/`created_at`) erweitern.

**Schritt 1.3 — Service: Metadaten beim Register mitnehmen (`server/services/downloadsService.js`)**
- `register({…, timestamp, pubDate, duration, description, content, isYoutube})`: Werte an `downloads.create()` weitergeben.
- `startDownload`/`update` unverändert; neue Spalten werden nur beim Anlegen gefüllt.

**Schritt 1.4 — Route: Enqueue mit vollen Metadaten (`server/routes/SubscriptionRoutes.js`)**
- `enqueueEpisodesForFeed` → `downloads.register` die geparsten Felder mitgeben:
  `timestamp`, `pubDate`, `duration`, `description`, `content`, `isYoutube` aus dem Episode-Objekt (`episode.timestamp`, `episode.pubDate`, `episode.duration`, `episode.description`, `episode.content`, `episode.isYouTube`).
- Validierung/Default-Werte zentral in `register` halten (leere Werte → leer/null, kein Crash).

**Schritt 1.5 — Parser: sicherstellen, dass Felder vorhanden sind (`server/services/feed/podcastService.js`, `youtubeService.js`)**
- Prüfen, dass geparste Episode-Objekte die Felder `timestamp`/`pubDate`, `duration`, `description`, `content`, `isYouTube` liefern; falls nicht, im Parser ergänzen (nicht in der Route nachträglich generieren).

### Phase 2 — Server-Leseendpunkt (`GET /api/feed/:id`)

**Schritt 2.1 — Service: Feed-by-ID-Lesezugriff (`server/services/feedService.js`)**
- Neue Methode `getFeedById(userId, feedId)`:
  - Subscription über `Subscription.findOne(id)` (nur wenn `user_id = userId`).
  - Episoden aus `downloads JOIN subscriptions` für `subscription_id = feedId` → `podcastTitle = title`, `feedUrl = feed_url`.
  - Output-Shape wie §4: `{ feed: {...}, episodes: [...] }`.
- `episodesCount` aus Subquery (`Subscription.listByUser` liefert es bereits) oder aus der Episodenliste.

**Schritt 2.2 — Route registrieren (`server/routes/FeedRoutes.js`)**
- `GET /:id` (auth-required via Router-Reihenfolge in `server/routes/index.js`), ruft `feedService.getFeedById`.
- 404-Handling: kein Subscription → `200 { feed: null, episodes: [] }` (§4).
- `POST /fetch` vorerst beibehalten (Preview, §6.1 offen) oder als Deprecated markieren.

**Schritt 2.3 — Tests (`server/services/feedService.test.js`, `server/routes/routes.test.js`)**
- Unit-Test für `getFeedById` mit gemockten Modellen (Join, Mapping, 404-Fall).
- Route-Test: auth-pflichtig, korrektes Response-Shape.

### Phase 3 — Frontend von URL- auf ID-basiertes Laden

**Schritt 3.1 — API-Methode (`public/js/api.js`)**
- Neu: `loadFeedById(id)` → `GET /api/feed/:id` → `{ feed, episodes }`.
- Optional: `loadFeeds()` (Bulk, §4 Option) für den Boot.
- `fetchFeed`/`fetchFeeds` beibehalten bis Preview-Frage geklärt ist; später entfernen (§5).

**Schritt 3.2 — URL→ID-Mapping (`public/js/sync.js`)**
- In `syncFeedsWithServer()`: aus `subs.feeds` (`id` + `feed_url`) `state.feedIdByUrl[url] = id` bauen.
- Mapping in State halten und bei `removeFeed`/Add frisch halten.

**Schritt 3.3 — Laden umstellen (`public/js/feeds.js`)**
- `refreshAllFeeds()`: pro `url → id` auflösen, `loadFeedById(id)` rufen; Ergebnis in `state.allEpisodes`/`state.feedMetadata` merge-analog zum Ist (Key = `guid`, Metadaten-Key = `url`).
- `fetchSingleFeed(url, …)`: auf `loadFeedById(id)` umstellen, `id` aus `state.feedIdByUrl`.
- `renderFeedDetail()`: bei Subskribiertem `loadFeedById` nutzen; Preview nur für nicht-subskribierte URLs (§6.1).

**Schritt 3.4 — Boot erweitern (`public/js/main.js`, `public/js/api.js loadAll`)**
- Ggf. Bulk-Call (`loadFeeds`) in `loadAll()` integrieren, um N-Einzelaufrufe beim Start zu vermeiden (§4 Option).

### Phase 4 — Preview-Frage (§6.1) klären

**Schritt 4.1 — Entscheidung dokumentieren**
- Option (a): Preview beibehalten **nur** für nicht-subskribierte URLs (einziger verbleibender URL-Fetch über `fetchFeed`).
- Option (b): Preview einschränken/entfallen lassen (Detail nur nach Follow).
- Umsetzung entsprechend in `feeds.js` (`renderFeedDetail`, `fetchSingleFeed`) und `api.js`.

### Phase 5 — YouTube & Randbedingungen

**Schritt 5.1 — YouTube-Feeds (`youtubeService.js`, `downloads.is_youtube`)**
- Sicherstellen, dass Playlist-Episoden als Episode persistierbar sind und `is_youtube = 1` setzen; `isYouTube`/`playlistId` in den Metadaten mitführen (§6.2).

**Schritt 5.2 — Offline-Audio unverändert prüfen**
- Service-Worker-Cache (`podany-audio-v1`), `audioProxyUrl`/`streamAudio` bleiben bestehen; nur Episoden-Metadaten-Ladestrategie ändert sich (§6.3).

### Phase 6 — Migration bestehender Daten & Verifikation

**Schritt 6.1 — Bestandsdaten (`server/db/migrate-data.js` oder Backfill-Skript)**
- Alte `downloads`-Rows ohne neue Spalten → fehlende Felder leer; Sortierung fällt auf `created_at`/`0`. Reiner Lesezugriff bleibt funktionsfähig (§6.5). Backfill optional, ausgelöst beim nächsten Add/Refresh.

**Schritt 6.2 — Manueller Frontend-Check**
- Refresh ohne Netzwerk: Feeds/Episoden aus DB geladen (kein leerer Client).
- Sortierung „neueste/älteste"/„Continue" nach `timestamp`; Fallback auf `created_at`.
- Feed-Detail für subskribierte und nicht-subskribierte Feeds.

**Schritt 6.3 — Typcheck/Build**
- Frontend-Bundle neu bauen (`npm run build`, esbuild) — in dieser Sandbox nicht mit verfügbarem Node ausführbar, Build in produktiver Umgebung ausführen (siehe `SERVER.md`).
- Bei vorhandenen Lint/Typecheck-Skripten diese laufen lassen.

---

## 9. Bezug zur bestehenden Doku
- Datenmodell/Strategie der localStorage-Entkopplung: `public/LOCALSTORAGE.md`
  (Server = Source of Truth; Feeds/Positionen/Downloads sind server-persistiert).
- Boot/Lade-Reihenfolge: `public/js/main.js` (`initApp` → `refreshAllFeeds` über `sync.js`).
- Episoden-Rendering/Filtering: `public/js/timeline.js`.
