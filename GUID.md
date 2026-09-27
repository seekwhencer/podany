# Konzept: episodeGuid → episodeId (Downloads-ID als kanonischer Identifier)

## 1. Ziel & Nicht-Ziel

**Ziel:** Über die gesamte Codebasis hinweg wird `episodeGuid` / `episode_guid` als
Identifier für eine Episode durch `episodeId` ersetzt. Als Wert dient **nicht**
das Datenbankfeld `downloads.episode_guid`, sondern das Primärfeld
**`downloads.id`** (z. B. `dl_<uuid>`).

`episodeId` ≡ `downloads.id` (der pro User+Episode angelegte Download-Record).

**Nicht-Ziel (dieses Konzept nicht):**
- Umbau von Playlist-/Subscription-Ids (`sub_…`) — bereits in Commit
  `59e856c` auf `id` umgestellt.
- Änderung der Audio-/Image-Serve-Pfade (`/api/downloads/serve/:id` bleibt).
- Neualegung der DB-Engine oder Migration von MariaDB weg.

---

## 2. Aktuelle Lage (Ist-Zustand)

Derzeit ist `episode_guid` der globale, feed-basierte Episode-Schlüssel und überall
als Identifier in Gebrauch:

| Ebene | Stelle | Current |
|---|---|---|
| Schema | `server/db/schema.sql:40,44,52,73`, `podany.sql:54,68,82,87` | `playback_state` + `downloads` mit `episode_guid` + Unique `(user_id, episode_guid)` |
| Model | `server/models/Downloads.js:14,43,76`, `PlaybackState.js:11,16,23,35` | `findByEpisode(userId, episodeGuid)`, `upsert/remove` über `episode_guid` |
| Service | `downloadsService.js:92,100,263`, `playbackService.js:11,21,33` | Keying über `episode_guid`; Positions-Map `positions[episode_guid]` |
| Routes | `DownloadRoutes.js:49,75`, `PlaybackRoutes.js:39,62` | `req.body.episodeGuid`, Validierung, Emit-Payload |
| Events | `downloadsService.js:113-114,148`, `PlaybackRoutes.js:49,67` | WebSocket-Payloads mit `episodeGuid` |
| Frontend API | `public/js/api.js:129,138` | `savePosition/removePosition(episodeGuid)` + Body-Schlüssel |
| Frontend State | `sync.js:73-90`, `playback.js:195,318-334`, `timeline.js:31-148,383-390`, `feeds.js:486-566` | `playbackPositions[ep.guid]`, Queue/DownloadStatus/Artwork-Matching über `ep.guid` |
| Live-Client | `public/js/live/LiveClient.js:227,255,296` | `payload.episodeGuid` → Matching `e.guid === guid` |
| Vertrag/Doku | `swagger.yml:68,84,320,...`, `FEEDS.md:52,70`, `SERVER.md:112`, `README.md:119,120`, `WEBSOCKET.md:140,155-158`, `LOCALSTORAGE.md` | Body-Felder + Tabellen-Doku |

**Wichtige Randinfo:** Beim Abonnieren eines Feeds legt `enqueueEpisodesForFeed`
(`server/routes/SubscriptionRoutes.js:32`) **für jede Episode einen
`downloads`-Anleg**e (Status `pending`) an → jede User+Episode-Kombination hat
bereits eine `downloads.id`. Das ist die Basis dafür, dass `episodeId` für
Playback-Positionen nutzbar ist.

---

## 3. Zielbild (Soll-Zustand)

- **Kanonischer Identifier** für alle Playback-/Download-/Event-Operationen =
  `downloads.id` (`episodeId`, Prefix `dl_…`).
- **`downloads.episode_guid` bleibt als Spalte bestehen** (globale Eindeutigkeit,
  nötig für Feed-Deduplikation in `enqueueEpisodesForFeed`). Sie wird **nicht mehr
  als App-Schlüssel** verwendet, nur noch als stabile globale Referenz/Anlege-Key.
- **`playback_state`:** Schlüssel wird `episode_id` (= `downloads.id`), Unique
  `(user_id, episode_id)` + FK auf `downloads(id)`. `episode_guid` optional als
  denormalisierte Spalte zur Migration/Fehlersuche erhalten.
- **Frontend:** `ep.id` trägt die `downloads.id`; `playbackPositions`, Queue,
  `downloadStatus`, Artwork-Matching und Card-Lookup werden über `ep.id` keyed.
- **API-Vertrag:** Body-Felder `episodeGuid` → `episodeId` (Swagger + Client).

### 3.1 Zentrale Entscheidungen (Empfehlungen)

1. **`episode_guid` in `downloads` behalten.** Notwendig für globales
   Deduplikation beim Enqueue. Nur der *Schlüsselgebrauch* ändert sich.
2. **Playback-Positionen auch für noch nicht geladene Episoden ermöglichen**
   („Lazy Anchor"): Bei `savePosition` wird bei fehlendem
   `downloads`-Record (Look-up über `episode_guid`) idempotent ein Anlege-Record
   angelegt (Unique `(user_id, episode_guid)` schützt gegen Doppelanlage), um an
   eine `episodeId` zu kommen. So bleibt „jede Episode trackbar" erhalten,
   trotzdem Keying über `downloads.id`.
3. **Abwärtskompatibilität beim Vertrag:** Backend akzeptiert während einer
   Übergangsphase **beide** Schlüssel (`episodeId` primär, `episodeGuid` als
   Fallback → auf `episodeId` normalisiert). Nach Frontend-Umschaltung + Release
   wird `episodeGuid`-Fallback entfernt. Verhindert brechende Lücke zwischen
   Backend- und Frontend-Deploy.
4. **Bestehende Positions-Daten:** Alte `playback_state`-Rows (Key = `episode_guid`)
    haben noch keine `downloads.id`. Migrationsstrategie siehe §6.

### 3.2 Phase 0 — Decision Log / Sign-off-Status

> Status: **Provisorisch angenommen** (Phase 0 umgesetzt). #1 und #3 sind
> konzeptionell unmissverständlich → als angenommen markiert. **#2 (Lazy Anchor)**
> und **#4 (Migration)** sind die zwei risikoreichen Entscheidungen und stehen
> explizit unter Vorbehalt: vor Start von Phase 1 schriftliche Freigabe durch den
> Stakeholder erforderlich. Bei Ablehnung/Änderung dieser zwei Punkte müssen
> Phase 1 (Schema/FK) und Phase 7 (Migration) entsprechend angepasst werden.

| # | Entscheidung | Status | Anmerkung |
|---|---|---|---|
| 1 | `episode_guid` in `downloads` behalten (Spalte/Anlege-Key) | ✅ angenommen | Notwendig für Feed-Dedupe; nur Schlüsselgebrauch ändert sich. |
| 2 | **Lazy Anchor** — `savePosition` legt fehlenden `downloads`-Record idempotent an | ⚠️ **Freigabe ausstehend** | Overhead: erste Positions-Speicherung legt Record an (einmalig, Unique geschützt). Alternative: Position nur wenn `downloads` existiert → nicht-trackbare Episoden verlieren Fortschritt. |
| 3 | Abwärts-Fallback: Backend akzeptiert `episodeId` + `episodeGuid`, normalisiert auf `episodeId` | ✅ angenommen | Verhindert brechende Backend↔Frontend-Lücke; in Phase 6 entfernt. |
| 4 | **Migration bestehender Positions-Daten** (Phase 7) | ⚠️ **Freigabe ausstehend** | Einmaliger Drop der alten Unique-Key + Befüllen von `episode_id`; FK `downloads(id)` erfordert Mapping jeder alten Row auf eine `downloads.id`. Datenverlustrisiko bei falscher Reihenfolge → Rollback-Konzept in Phase 7 dokumentieren. |

---

## 4. Vertragskontrakt (Contract-First)

Alle Body-Felder und Event-Payloads ändern den Schlüssel:

```
# vor
{ "episodeGuid": "dl_abc", "positionSeconds": 42, "completed": false }
# nach
{ "episodeId": "dl_abc", "positionSeconds": 42, "completed": false }
```

Event-Payloads (WebSocket): `{ "id", "episodeId", "subscriptionId?", "progress" | "title" | "fileSize" | "error" }`.
Server antwortet bei Position/Download-Ops mit `episodeId` statt `episodeGuid`.

---

## 5. Phasen mit Arbeitsschritten

> Prinzip: **Vertrag vor Implementierung**, Backend akzeptiert zuerst beide
> Schlüssel (§3.1 #3), dann Frontend, dann Fallback entfernen. Jede Phase hält
> Backend↔Frontend-kompatibel.

### Phase 0 — Grundlagen & Freigabe der Entscheidungen
1. Diese Entscheidungen (§3.1) mit Stakeholder absegnen (insb. #2 Lazy Anchor, #4 Migration).
2. `swagger.yml` Body/Schema auf `episodeId` aktualisieren (Vertragsquelle wahr).
3. Schema-Entwurf für `playback_state.episode_id` + FK skizzieren.
4. Definition of Done + Verifikationskommandos fixieren (§8).

### Phase 1 — Datenlage (Schema + Models)
1. `server/db/schema.sql`: `playback_state` → `episode_id` (Unique `(user_id, episode_id)`, FK `downloads(id)`); optional `episode_guid` als Erhalt-Spalte. `downloads` unverändert (`episode_guid` bleibt).
2. `podany.sql` entsprechend anpassen (Seed/Docker).
3. `server/models/PlaybackState.js`: `findByEpisode(userId, episodeId)`, `upsert({…, episodeId})`, `remove(userId, episodeId)`; `listByUser` liefert `episode_id`.
4. `server/models/Downloads.js`: `remove(userId, episodeId)` über `id`; `findByEpisode` bleibt als Anlege-Hilfe (`episode_guid`) bestehen, `findById`/`findByIdAndUser` unverändert.
5. Unit-Tests der Models anpassen.

### Phase 2 — Services + Routes (Vertrag: beide Schlüssel akzeptiert)
1. `server/services/playbackService.js`: `savePosition/removePosition/listPositions` über `episodeId`; **Lazy Anchor** einbauen (fehlender `downloads`-Record → idempotent anlegen). Positions-Map keyed by `episodeId`.
2. `server/services/downloadsService.js`: `register` nimmt weiterhin `episodeGuid` zum Anlegen (Spalte), gibt aber `id` zurück; `remove(userId, episodeId)` über `id`; Emit-Payloads `episodeGuid`→`episodeId`.
3. `server/routes/PlaybackRoutes.js`: `req.body.episodeId` (Fallback `episodeGuid`), Validierung, Emit-Payload `episodeId`.
4. `server/routes/DownloadRoutes.js`: `DELETE /` über `episodeId`; Success-Antwort `episodeId`.
5. `SubscriptionRoutes.js` **unverändert** (Enqueue bleibt über globales `episode.guid`).
6. Routes/Service-Tests anpassen (`routes.test.js`, `playbackService.test.js`, `downloadsService.test.js`).

### Phase 3 — Live/Protocol-Events
1. Event-Payloads konsequent `episodeId` (`LiveClient.js`, `downloadsService.js`, `PlaybackRoutes.js`).
2. `public/js/live/LiveClient.test.js` Test-Daten auf `episodeId` umstellen.
3. `WEBSOCKET.md` Payload-Tabelle aktualisieren.

### Phase 4 — Frontend (Umschaltung auf episodeId)
1. `public/js/api.js`: `savePosition/removePosition(episodeId)` + Body-Schlüssel `episodeId`.
2. `public/js/sync.js`: `savePlaybackPositionToServer(episodeId, …)`; `state.playbackPositions` keyed by `episodeId`.
3. `public/js/playback.js`, `timeline.js`, `feeds.js`: alle `playbackPositions[ep.guid]` → `[ep.id]`, Queue/DownloadStatus/Artwork-Matching/Cards über `ep.id`; Aufrufe `savePlaybackPositionToServer(ep.id, …)`.
4. `LiveClient.js`: `payload.episodeId` + Matching `e.id === episodeId`.
5. **Bedingen:** Server akzeptiert während dieser Phase noch `episodeGuid` (Phase-2-Fallback), damit kein brechende Lücke.

### Phase 5 — Tests & Verifikation
1. Alle betroffenen Tests auf `episodeId` umstellen und grün laufen lassen (§8).
2. Frontend-Tests (`LiveClient.test.js`) aktualisiert.
3. Contract-Check: Backend antwortet/akzeptiert `episodeId`; Fallback `episodeGuid` noch funktional.

### Phase 6 — Fallback entfernen + Build + Doku
1. Backend-Fallback `episodeGuid` aus Routes/Services entfernen (nur noch `episodeId`).
2. `npm run build` (produktiv) → `public/dist/bundle.js` regenerieren (**manuell ignorieren**, AGENTS.md).
3. Doku aktualisieren: `swagger.yml`, `FEEDS.md`, `SERVER.md`, `README.md`, `WEBSOCKET.md`, `LOCALSTORAGE.md`, `SELFHOSTED.md`.

### Phase 7 — Migration bestehender Daten
1. Skript: für bestehende `playback_state`-Rows (`episode_guid`) passenden `downloads.id` ermitteln (Anlegen falls fehlbar) und `episode_id` befüllen; ggf. alte Rows mappen oder als Deprecated markieren.
2. Migrationsprotokoll + Rollback-Hinweis dokumentieren.

---

## 6. Migration & Risiken

- **Datenverlust bei Positionen:** Alte Rows keyed by `episode_guid` ohne
  `downloads.id`. Gegenmaßnahme: Phase-7-Script legt `downloads`-Anlege-Records
  an und überträgt Positionen auf `episode_id`.
- **Brechende Lücke Backend↔Frontend:** durch Phase-2-Fallback (#3) vermieden.
- **Lazy-Anchor-Overhead:** erste Positions-Speicherung einer neuen Episode legt
  einen `downloads`-Record an (idempotent, durch Unique geschützt).
- **`episode_guid` in `downloads` bleibt** → kein Datenverlust für Feed-Dedupe;
  nur Schlüsselgebrauch ändert sich.
- **`public/dist/bundle.js`** wird nicht manuell bearbeitet (AGENTS.md); über
  `npm run build` regenerieren.

---

## 7. Betroffene Dateien (Checkliste)

**Backend**
- `server/db/schema.sql`, `podany.sql`
- `server/models/PlaybackState.js`, `server/models/Downloads.js`
- `server/services/playbackService.js`, `server/services/downloadsService.js`
- `server/routes/PlaybackRoutes.js`, `server/routes/DownloadRoutes.js`
- `server/live/protocol.js` (Payloads), `server/routes/SubscriptionRoutes.js` (**unverändert**)

**Frontend**
- `public/js/api.js`, `sync.js`, `playback.js`, `timeline.js`, `feeds.js`
- `public/js/live/LiveClient.js` (+ `.test.js`)

**Tests**
- `server/routes/routes.test.js`, `server/services/playbackService.test.js`,
  `server/services/downloadsService.test.js`, `server/db/migrate-data.test.js`

**Vertrag/Doku**
- `swagger.yml`, `FEEDS.md`, `SERVER.md`, `README.md`, `WEBSOCKET.md`,
  `LOCALSTORAGE.md`, `SELFHOSTED.md`
- (`public/dist/bundle.js` → Build, manuell ignorieren)

---

## 8. Erfolgskriterien / Verifikation

### 8.1 Definition of Done (gesamtkonzept)

- [ ] **Kein `episodeGuid`/`episode_guid` mehr als *Identifier*** in
      Code/Routes/Events/Frontend-State. `episode_guid` nur noch als Spalte/Anlege-Key
      in `downloads` + Enqueue (`enqueueEpisodesForFeed`).
- [ ] **API akzeptiert `episodeId`**; Payloads (REST + WebSocket) liefern `episodeId`.
- [ ] **Abwärts-Fallback** (`episodeGuid` → `episodeId`) in Phase 2/3 funktional,
      in Phase 6 entfernt.
- [ ] `playback_state`-Schlüssel = `downloads.id` (`episode_id`), Unique
      `(user_id, episode_id)` + FK `downloads(id)` intakt.
- [ ] `public/dist/bundle.js` über `npm run build` regeneriert (nicht manuell bearbeitet).

### 8.2 Verifikationskommandos

| Schritt | Kommando | Anmerkung |
|---|---|---|
| Schema anwenden | `npm run db:migrate` | Wendet `schema.sql` idempotent an (Migrator strippt `--`-Kommentare). |
| Tests laufen lassen | `npm test` | = `node --test`. |
| Bundle bauen | `npm run build` | In dieser Sandbox **nicht lauffähig** (esbuild = nativer ELF). In produktiver Umgebung ausführen → regeneriert `public/dist/bundle.js`. |
| Daten migrieren | `npm run migrate:data [--source <path>] [--dry-run]` | Phase 7 (episode_guid → episode_id). |

### 8.3 Sandbox-Hinweise (AGENTS.md)

- Node nicht als `node` verfügbar; bei Bedarf `/home/mk/n/bin/node` nutzen. Kein
  `node --check`.
- `node --test` meldet vorliegende DB-abhängige Fehler in `routes.test.js`
  (Sync/Auth-Pfade, keine MariaDB in der Sandbox) → laut AGENTS.md ignorieren.
- `public/dist/bundle.js` NIEMALS manuell lesen/bearbeiten.

### 8.4 Phasen-spezifische DoD-Verifikation

- **Phase 1:** Model-Unit-Tests grün (`PlaybackState`/`Downloads` über `episode_id`).
- **Phase 2:** `routes.test.js` + `playbackService.test.js` + `downloadsService.test.js`
  grün; Backend akzeptiert `episodeId` **und** `episodeGuid` (Fallback).
- **Phase 3:** `LiveClient.test.js` auf `episodeId` umgestellt, grün.
- **Phase 5:** Betroffene Tests auf `episodeId` umgestellt, `npm test` grün
  (Sandbox-Ausnahme §8.3). Contract-Check: `episodeId` akzeptiert/liefert,
  `episodeGuid`-Fallback noch funktional.
- **Phase 6:** Fallback `episodeGuid` aus Backend entfernt; `npm run build` in
  produktiver Umgebung → Bundle frisch.
