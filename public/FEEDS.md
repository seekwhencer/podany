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

1. **Preview für nicht-subskribierte Feeds** (`renderFeedDetail`, `feeds.js:735`): **ENTSCHEIDUNG → Option (a) umgesetzt.** Preview wird **beibehalten, aber streng auf nicht-subskribierte URLs beschränkt** — es ist der einzige verbleibende URL-Fetch. Bedingung in `renderFeedDetail`: `totalCount === 0 && !isSubbed` (`feeds.js:738`). Subskribierte Feeds werden ausschließlich DB-basiert über `loadFeedById` geladen (`refreshAllFeeds` → `fetchSingleFeed` löst `url→id` auf). Der Fallback auf `fetchFeed(url)` in `fetchSingleFeed` (`feeds.js:109`) bleibt als transientes Sicherheitsnetz für den Add-Race-Bereich bestehen (Feed existiert, aber `id` wurde durch `saveFeedToServer` noch nicht zurückgegeben). `api.fetchFeeds(urls)` (Bulk, nie im Frontendgerufen) wurde entfernt; nur `api.fetchFeed(url)` bleibt bestehen.

2. **YouTube-Feeds** (Playlists): Beim Add-Time-Parse entsteht oft nur eine „Single-Episode"-
     Repräsentation. Muss in `downloads` als Episode persistierbar sein; `isYouTube`/`playlistId`
      in den Metadaten mit speichern (Option A: `is_youtube`). → ✅ **umgesetzt**: `downloads.playlist_id VARCHAR(64)` (schema + Migrator-Guard), Persistierung über `register`→`create`, `playlistId` wird im YouTube-Parser (Atom- + OEmbed-Pfad) mitgeführt, `getFeedById` rekonstruiert `isYouTubePlaylist`.

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

**Schritt 4.1 — Entscheidung dokumentieren & umsetzen** — ✅ DONE (Option a).
- Entscheidung: **Preview beibehalten, streng auf nicht-subskribierte URLs beschränkt** (einziger verbleibender URL-Fetch über `fetchFeed`). Details zu §6.1.
- Umsetzung: `api.fetchFeeds(urls)` (tot, niegerufen) entfernt; nur `fetchFeed(url)` bleibt (`api.js`). Preview-Bedingung in `renderFeedDetail` = `totalCount === 0 && !isSubbed`; Fallback in `fetchSingleFeed` auf `fetchFeed` nur wenn keine `id` bekannt (Add-Race). Kommentare zur Einordnung ergänzt (`feeds.js`, `api.js`).

### Phase 5 — YouTube & Randbedingungen

**Schritt 5.1 — YouTube-Feeds (`youtubeService.js`, `downloads.is_youtube`)** — ✅ DONE.
- `downloads` um `playlist_id VARCHAR(64)` erweitert (`server/db/schema.sql`: `CREATE TABLE` + idempotentes `ALTER TABLE ... ADD COLUMN IF NOT EXISTS playlist_id` für Bestandsdaten, da der Migrator `schema.sql` jedes Mal komplett anwendet).
- `server/models/Downloads.js`: `playlist_id` in `UPDATABLE` + `create()`-INSERT aufgenommen.
- `server/services/downloadsService.js` `register()`: nimmt `playlistId` an und reicht sie an `downloads.create()` weiter.
- `server/routes/SubscriptionRoutes.js` `enqueueEpisodesForFeed`: gibt `playlistId: episode.playlistId || null` mit (neben dem bereits bestehenden `isYoutube: episode.isYouTube ? 1 : 0`).
- `server/services/feed/youtubeService.js` `fetchFeed`: spritzt bei der Atom-/Videos.xml-Pfade `playlistId` in jede geparste Episode (`isYouTube` ist dort bereits gesetzt), damit auch Multi-Episode-YouTube-Feeds die Metadaten mitführen. OEmbed-Single-Episode hat `playlistId`/`isYouTubePlaylist` bereits.
- `server/services/feedService.js` `getFeedById`: liefert `e.playlist_id AS playlistId` und rekonstruiert `isYouTubePlaylist` (`CASE WHEN playlist_id IS NOT NULL AND <> ''`) für DB-geladene Episoden, damit die YouTube-Player-Logik (`playback.js`) Playlist-Playback auch nach dem DB-Laden auslöst.

**Schritt 5.2 — Offline-Audio unverändert prüfen** — ✅ UNVERÄNDERT bestätigt.
- Service-Worker-Cache (`podany-audio-v1`, `public/js/config.js:39`), `audioProxyUrl`/`streamAudio` (`public/js/api.js:224/228`) und Cache-Invalidation (`public/js/ui/modal.js:292`) unverändert; keine Frontend-Änderung an Audio-Pfad. Die Änderungen betreffen nur die serverseitige Episoden-Metadaten-Persistierung (`playlist_id`) und den Lese-Output von `getFeedById`.

### Phase 6 — Migration bestehender Daten & Verifikation

**Schritt 6.1 — Bestandsdaten (`server/db/migrator.js`, `server/db/schema.sql`) — ✅ DONE.**
- **Bug behoben:** `splitStatements()` in `migrator.js` hat Full-Line-Comments (`-- …`) nicht korrekt entfernt (nur das `--`-Präfix, der Text blieb und wurde an die nachfolgende Statement Zeile gehängt). Dadurch war das letzte `schema.sql`-Statement ein ungültiges Gemisch aus Kommentar-Text + `ALTER TABLE`, das bei `migrate()` mit echter DB gefailed wäre. Jetzt wird jede Line ab `--` abgeschnitten → saubere Statement-Aufteilung.
- **Idempotente Guards ergänzt:** Bisher bekam nur `playlist_id` einen `ADD COLUMN IF NOT EXISTS`-Guard; die 6 Metadaten-Spalten (`timestamp`, `pub_date`, `duration`, `description`, `content`, `is_youtube`) standen nur in `CREATE TABLE` (gilt nur frische DBs). Für Bestandsdaten jetzt 7 idempotente `ALTER TABLE downloads ADD COLUMN IF NOT EXISTS …`-Statements am Ende von `schema.sql`. `npm run migrate` fügt bestehenden DBs sämliche neue Spalten fehlerfrei und wiederholungssicher hinzu.
- Bestands-Rows ohne gefüllte neue Spalten → fehlende Felder leer; Sortierung fällt auf `0` (§6.5). Reiner Lesezugriff bleibt funktionsfähig. Backfill nicht nötig, da Add/Refresh die Spalten bei neuem Parsen füllt.
- Regressionstest `server/db/migrator.test.js` (+3 Tests) deckt Comment-Stripping, Schema-Aufteilung und Idempotenz ab.

**Schritt 6.2 — Frontend-Check (statische Verifikation, Sandbox ohne Browser) — ✅ DONE.**
- Pfade verifiziert: Subskribierte laden DB-basiert über `loadFeedById(id)` (`feeds.js:111`, `api.js:190`); url→id-Mapping in `sync.js:27/50`; Preview streng auf nicht-subskribierte URLs (`renderFeedDetail`, `feeds.js:737`: `totalCount === 0 && !isSubbed`); Add-Race-Fallback auf `fetchFeed(url)` nur ohne bekannte `id`.
- **Bug behoben:** `timeline.js` newest/älteste/podcast-Sortierung rechnete roh `b.timestamp - a.timestamp` → `NaN` für Bestandsdaten-Episoden ohne `timestamp` (schlechter als das in §6.5 dokumentierte „Fallback auf 0"). Jetzt null-safe `(x.timestamp || 0)`, deckungsgleich mit der bereits korrekt geguardeten `Continue`-Sortierung (`timeline.js:91,155`). Sortierung ist damit deterministisch.

**Schritt 6.3 — Build/Tests — ✅ DONE.**
- Frontend-Bundle neu gebaut (`./node_modules/.bin/esbuild … --outfile=public/dist/bundle.js`, exit 0, 122.1 kb). Kein Lint/Typecheck-Skript im Projekt vorhanden; Build über esbuild (native binary, nicht via `node`) ausgeführt.
- Test-Suite: `node --test` → 123 Tests, **116 pass, 7 fail**. Die 7 Fehler sind pre-existing (`auth send-link`, `sync *`-Routes, alle 404 statt 200) und unabhängig von dieser Änderung — gegen `HEAD`-Baseline verifiziert (identischer Failure-Set, +3 neue migrator-Tests, 0 neue Fehler).

---

## 9. Bezug zur bestehenden Doku
- Datenmodell/Strategie der localStorage-Entkopplung: `public/LOCALSTORAGE.md`
  (Server = Source of Truth; Feeds/Positionen/Downloads sind server-persistiert).
- Boot/Lade-Reihenfolge: `public/js/main.js` (`initApp` → `refreshAllFeeds` über `sync.js`).
- Episoden-Rendering/Filtering: `public/js/timeline.js`.
