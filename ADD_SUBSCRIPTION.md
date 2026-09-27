# Konzept: Serverseitiges Asynchronisieren des Subscription-Add-Flows (ADD_SUBSCRIPTION)

## 1. Ziel & Nicht-Ziel

**Ziel:** Der POST-Flow zum Abonnieren eines Feeds (`POST /api/subscription`) soll
nicht mehr auf das Herunterladen aller Episoden und das Generieren aller
Thumbnails warten. Sobald der Feed geholt **und in der Datenbank gespeichert**
ist, wird dem Browser **exakt dieselbe Response** gesendet wie jetzt auch
(`{ success, feedUrl, id }`). Das langsame (Feed-Parsing, Podcast-Cover,
Episode-Thumbnails, Audio-Downloads) läuft danach im Hintergrund weiter.

**Nicht-Ziel (dieses Konzept nicht):**
- Änderung des Response-Formats / der Response-Daten (bleibt identisch).
- Änderung der Feed-Lese-/Anzeigelogik am Frontend (`loadFeedById`,
  `refreshAllFeeds`) — nur als Abhängigkeit dokumentiert.
- Umbau des Download-Queues oder der Audio-Serve-Pfade.
- Änderung der Subscription-/Episode-Identifikatoren (siehe `GUID.md`).

---

## 2. Aktuelle Lage (Ist-Zustand)

`POST /api/subscription` (`server/routes/SubscriptionRoutes.js:78-120`) läuft
sequenziell und **wartet bis zum Ende** ab, bevor `res.json()` gesendet wird:

| Schritt | Code | Aufwand | blockiert Response? |
|---|---|---|---|
| 1 Feed holen/parisen | `SubscriptionRoutes.js:86` → `feed.fetchFeeds([feedUrl])` | hoch (RSS/YouTube-Playlist) | ✅ |
| 2 Subscription + Podcast-Cover | `SubscriptionRoutes.js:100` → `subscriptionService.addSubscription` (`:20` generiert **1** Cover via `ImageService.downloadAndGenerate`) | mittel (1 Bild, sharp) | ✅ |
| 3 Episoden anlegen | `SubscriptionRoutes.js:113` → `await this.enqueueEpisodesForFeed(...)` | **hoch** | ✅ |
| ↳ je Episode Register | `downloadsService.register` (`:100-141`) | **hoch** | ✅ (sequiell) |
|   ├─ Episode-Cover | `downloadsService.js:106-112` (`downloadAndGenerate`, sharp, **pro Episode**) | **hoch** | ✅ |
|   ├─ Record anlegen | `downloadsService.js:117-137` (INSERT, `status=pending`) | niedrig | ✅ |
|   └─ Audio enqueue | `downloadsService.js:139` → `enqueue` → `_processQueue` (concurrency-limitiert) | niedrig* | *\non-blocking* |

**Engpass:** Zeile 113 (`await enqueueEpisodesForFeed`) wartet auf **jede**
Episode. Innerhalb von `register()` wird pro Episode das Cover **sequenziell**
generiert (`downloadAndGenerate`, `downloadsService.js:106-112`), bevor der
Download-Record angelegt wird. Bei N Episoden = N hintereinander laufende
Image-Downloads + sharp-Resizes → die Response kann sehr spät kommen.

Das eigentliche **Audio-Holen** ist bereits nicht-blockierend (Queue,
`_processQueue`, `downloadsService.js:77-86`) und läuft auch nach `register()`
weiter. Es ist also **nur** das Cover-Generieren (und optional Parsing/Cover),
was die Response aufhält.

**Wichtig – was der Browser von der Response sieht:**
Die POST-Response enthält **keine** Episoden, sondern nur
`{ success, feedUrl, id }` (`SubscriptionRoutes.js:115`, `api.js:105-113`).
Episoden werden später separat gelesen: `feeds.addFeed` (`feeds.js:272-287`) →
`saveFeedToServer` setzt `feedIdByUrl[url]=id` → `refreshAllFeeds` →
`fetchSingleFeed` → `loadFeedById(id)` → `GET /api/feed/:id` →
`feedService.getFeedById` (`feedService.js:36-81`) liest Episoden **aus der DB**.

→ Die Episoden müssen also nicht zwingend vor der Response in der DB stehen,
**aber** sie müssen es sein, damit das Feed-Detail nach dem Add direkt Episoden
zeigt (sonst „No episodes found", bis erneut geladen wird).

---

## 3. Zielbild (Soll-Zustand)

Der Handler teilt sich in zwei Pfade:

**Fast path (awaited, Teil der HTTP-Response – unverändertes Format):**
1. Feed holen/parisen (`fetchFeeds`).
2. Subscription-Anlage + Podcast-Cover (`addSubscription`).
3. **Alle Episode-Records als `pending` in die DB einfügen** (noch ohne Cover,
   noch kein Audio). Nur DB-Inserts → schnell.
4. `res.json(200, { success, feedUrl, id })` senden (**identisch zu jetzt**).

**Background path (nicht awaited, läuft nach Response weiter):**
5. Für jeden Record: Cover asynchron generieren → Record aktualisieren
   (`image`) → Events `IMAGE_COMPLETED` / `THUMBNAIL_READY` emitten.
6. Audio-Downloads laufen über die bestehende Queue (`_processQueue`) weiter →
   `status=completed`, `filename`, `file_size`; Event `DOWNLOAD_COMPLETED`.

Die vom Browser empfangenen Daten bleiben **identisch**. Das Feed-Detail zeigt
Episoden sofort (Records existieren); Thumbnails und Download-Status tragen sich
live (via WebSocket) oder bei der nächsten Refresh-Schleife ein.

---

## 4. Zentrale Entscheidungen

1. **Was wird vor der Response gespeichert? (A2 empfohlen)**
   - **A2 (empfohlen):** Subscription **+** alle Episode-Records (`pending`) in
     der DB, dann Response. Feed-Detail zeigt sofort alle Episoden; nur Cover/Audio
     fehlt noch. Response unverändert. Bester Trade-off.
   - **A1 (schnellste Response):** Nur Subscription-Anlage, dann Response;
     Episode-Records erst im Hintergrund anlegen. ⚠️ Nach dem Add zeigt
     `loadFeedById` kurz **keine** Episoden → Feed-Detail „No episodes", bis
     erneut geladen/refresh wird. Nur empfehlen, wenn sofortige Response
     Priorität vor sofort sichtbaren Episoden hat.

2. **`downloadsService.register()` entkoppeln.** Derzeit generiert `register()`
   das Cover **bevor** der Record angelegt wird und wartet darauf
   (`downloadsService.js:106-139`). Umstellen auf: Record anlegen → Audio
   enqueue → **separat**, non-awaiting, Cover generieren → `update(image)` →
   Events. Das Cover-Generieren wird damit zur eigenen, fire-and-forget-Aktion
   (z. B. `generateArtwork(id)`), die nach dem Response weiterläuft.

3. **Podcast-Cover (`addSubscription`, `subscriptionService.js:20`) auf dem Fast
   path behalten.** Es ist nur ein Bild und wird sofort im Feed-Grid angezeigt.
   Optional später auch async, wenn maximale Fast-Path-Geschwindigkeit nötig.

4. **Hintergrund-Job fehlersicher machen.** Nicht-awaiting bedeutet nicht
   „ignoriert": Job mit eigenem `try/catch` + `.catch()` gegen
   `UnhandledPromiseRejection` (Prozess-Crash) kapseln, Fehler loggen, ggf.
   `download:failed` emitten.

5. **Gemeinsame Queue nutzen.** Der Background-Job muss dieselbe
   `DownloadsService`-Instanz (`this.downloads` in `SubscriptionRoutes`)
   verwenden, damit die geteilte Queue/Concurrency (`_processQueue`) gilt.

---

## 5. Phasen mit Arbeitsschritten

### Phase 1 — Server: Fast path ohne Warten auf Downloads/Thumbnails
1. `SubscriptionRoutes.post('/')`: `await this.enqueueEpisodesForFeed(...)`
   (`SubscriptionRoutes.js:113`) durch einen **nicht-awaiting** Background-Aufruf
   ersetzen (Job starten, Response sofort). Job referenziert `this.downloads`.
2. `enqueueEpisodesForFeed`: bleibt logisch gleich (Dedupe über `episode_guid`),
   ruft aber eine nicht-wartende Register-Variante auf (kein Cover-Await).
3. `downloadsService.register()`: Record zuerst anlegen (`pending`, `image=''`),
   Audio enqueue, dann Cover asynchron (`generateArtwork`) → `update` + Events.
4. Background-Job mit `try/catch`/`.catch()` kapseln, Fehler loggen.

### Phase 2 — Frontend: Live-Aktualisierung freischalten (Abhängigkeit)
> Derzeit ist die Event-Verarbeitung in `LiveClient._onMessage` durch den
> frühen `return;` (`public/js/live/LiveClient.js:193`) **tot** —
> `_handleArtwork`, `_handleDownload`, `_handleSubscription` werden nicht
> aufgerufen. Damit Thumbnails/Download-Status nach dem Add **live** erscheinen,
> muss dieser `return;` entfallen (oder nach dem Background ein Refresh getriggert
> werden).
1. `LiveClient.js:193` (`return;`) entfernen, damit Switch/Handler laufen.
2. `_handleArtwork` (`:261-292`) aktualisiert `ep.image` + `.episode-artwork.src`.
3. `_handleDownload` (`:231-259`) aktualisiert `.ep-download-badge`
   (progress/completed/failed).
4. `_handleSubscription` (`:294-299`) rendert Grid neu (bereits vorhanden).

### Phase 3 — Verifikation
1. Add eines Feeds mit vielen Episoden: Response kommt sofort (Timing messen),
   Body = `{ success, feedUrl, id }`.
2. Feed-Detail zeigt Episoden direkt; Thumbnails + Download-Badges tragen sich
   live (WS) bzw. nach Refresh ein.
3. Server-Neustart während Background: persistierte `pending`-Records überleben,
   Downloads können wiederaufgenommen werden.

---

## 6. Betroffene Dateien

**Backend**
- `server/routes/SubscriptionRoutes.js` — Fast/Background-Trennung in POST (`:78-120`).
- `server/services/subscriptionService.js` — `addSubscription` (Cover auf Fast path behalten).
- `server/services/downloadsService.js` — `register()` entkoppeln (`:100-141`),
  Cover async (`generateArtwork`), Queue bleibt (`:70-86`).

**Frontend (Abhängigkeit für Live-Anzeige)**
- `public/js/live/LiveClient.js` — `return;` bei :193 entfernen, Handler freischalten.
- `public/js/feeds.js`, `public/js/api.js`, `public/js/sync.js` — **unverändert**
  (nur Lese-/Anzeigelogik; funktioniert mit A2 ohne Änderung).

---

## 7. Risiken & Randbedingungen

- **Live-Anzeige hängt an `LiveClient.js:193`.** Ohne Freischalten der Handler
  erscheinen Thumbnails/Download-Status nicht live; Alternative: Background-Ende
  per Event/Refresh am Frontend auslösen.
- **Response enthält keine Episoden** (nur `{ success, feedUrl, id }`) → mit A2
  reichen die angelegten Records aus, damit das Detail sofort gefüllt ist.
- **Persistenz:** Background läuft nur, solange der Server-Prozess lebt. Bei
  Neustart im laufenden Download bleiben Records als `pending`/`failed`
  bestehen (Wiederaufnahme möglich). Nichts wird „verloren", was in der DB steht.
- **Concurrency:** Audio-Downloads bleiben concurrency-limitiert
  (`_processQueue`, Default 4); hunderte Enqueues nur in die Queue, kein
  Speicherspike.
- **Dedupe** über `episode_guid` (`enqueueEpisodesForFeed`,
  `SubscriptionRoutes.js:33-42`) bleibt erhalten → kein Doppel-Anlegen beim
  wiederholten Abonnieren.
- **Response-Format ändert sich nicht** → kein brechender Frontend-Vertrag.

---

## 8. Verifikation

| Prüfpunkt | Kommando / Methode | Erwartet |
|---|---|---|
| Response-Timing nach Add | DevTools/Network: Zeit bis `POST /api/subscription` antwortet | deutlich kleiner als vorher (kein Warten auf Downloads) |
| Response-Body | Body der Response | `{ "success": true, "feedUrl": …, "id": "sub_…" }` (identisch) |
| Episoden sichtbar | Feed-Detail nach Add | alle Episoden sofort (Records angelegt) |
| Thumbnails/Downloads | Live oder nach Refresh | Covers + Download-Badges füllen sich |
| Server-Restart während Background | Prozess neustarten | `pending`-Records bleiben, Wiederaufnahme |
| Tests | `node --test` (`npm test`) | betroffene Tests grün (Sandbox-Ausnahmen siehe `GUID.md §8.3`) |
