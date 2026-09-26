# LOCALSTORAGE.md — Konzept: localStorage deaktivieren, Server als primäre Datenquelle

## 1. Ziel

Die lokale `localStorage`-Speicherung im Browser wird vollständig entkoppelt. Der
Server (Express + MariaDB) wird zur alleinigen, geräteübergreifenden
Datenquelle (Source of Truth). Der Browser hält nur noch flüchtigen Zustand
(Speicher-Cache, UI-Status) und darf `localStorage` nicht mehr zum Persistieren
verwenden.

Ergebnis nach Abschluss:
- Kein `localStorage`-Lese-/Schreibzugriff mehr im Frontend-Code.
- Alle persistenten Daten (Feeds, Playback-Positionen, Downloads, Session)
  kommen aus Server-API-Antworten.
- Der Boot-Vorgang lädt den Zustand asynchron vom Server statt synchron aus dem
  Browser-Speicher.

## 2. Datenaufwand & Klassifizierung

Bevor Code geändert wird, muss jede aktuelle `localStorage`-Quelle einer
Kategorie zugeordnet werden. Das bestimmt, ob sie server-seitig persistiert,
client-seitig gecacht oder wegfällt.

| localStorage-Key (config.js) | Aktuelle Nutzung | Ziel-Kategorie | Server-Seite |
| --- | --- | --- | --- |
| `SESSION` | Session-Token | Server-Cookie (`podcast_session`) + `X-Session-Token`-Header | `express-session`, AuthRoutes |
| `FEEDS` | Abonierte Feeds | **Server** (`subscriptions`) | Subscription-Model ✓ |
| `POSITIONS` | Playback-Positionen | **Server** (`playback_state`) | PlaybackState-Model ✓ |
| `DOWNLOADS` | Download-Metadaten | **Server** (`downloads`) | Downloads-Model ✓ |
| `CACHED_EPISODES` | RSS-Episiten-Zwischenspeicher | Client-Speicher-Cache (nur flüchtig) | keine Persistenz, aus Feed neu abbar |
| `CACHED_METADATA` | Feed-Metadaten-Zwischenspeicher | Client-Speicher-Cache (nur flüchtig) | keine Persistenz, aus Feed neu abbar |
| `THEME` | Theme-Präferenz | Client-only ODER Server-Userprofil | aktuell keine → Entscheidung nötig |
| `QUEUE` | Playback-Warteschlange | Client-only ODER Server-Tabelle | aktuell keine → Entscheidung nötig |

Entscheidungen (in Schritt 0 festgelegt — Klassifizierung gegen den Code
verifiziert, Nutzungssiten in `public/js/**` geprüft):

- **THEME → client-only, transient (Speicher).** Keine server-seitige Tabelle,
  kein `localStorage`. Die Präferenz wird als einzelner nicht-persistierender
  Wert im AppState gehalten (`state.theme`, Default `'system'`). Begründung:
  kein geräteübergreifender Sync nötig, minimierter Migrationaufwand.
  Nebenwirkung beim Rollout: Reset auf `'system'` nach jedem Reload.
  (Kein `sessionStorage`, da Abschnitt 3 Punkt 1 auch sessionStorage verbietet.)
- **QUEUE → client-only, transient (Speicher).** Keine neue Server-Tabelle
  (`playback_queue` wird **nicht** angelegt). Die „Up Next"-Liste bleibt
  flüchtiger Sitzungszustand im `state.queue`. Begründung: echtes
  Session-Konzept, kein geräteübergreifender Sync nötig.
  Nebenwirkung beim Rollout: Queue wird nach Reload geleert.

Regel: Nur wirklich persistente, geräteübergreifende Daten zum Server
(SESSION, FEEDS, POSITIONS, DOWNLOADS). CACHED_EPISODES/CACHED_METADATA, THEME
und QUEUE bleiben client-seitig (Speicher/Arbeitsspeicher).

## 3. Wie `localStorage` im Browser „deaktiviert" wird

„Deaktivieren" hat hier zwei Ebenen:

1. **Architekturell (Zielzustand):** Der Frontend-Code greift nirgends mehr auf
   `localStorage`/`sessionStorage` zu. Die Abstraktion `Storage` (storage.js)
   wird zum reinen API-Adapter; alle `load*`/`save*`-Methoden lesen/schreiben
   über `ApiClient`. Damit ist die Abhängigkeit beseitigt, auch wenn der Browser
   die Speicherung grundsätzlich erlauben würde.

2. **Browser-seitig (optional, zusätzlich):** Explizites Sperren über Header,
   falls die App localStorage technisch nicht nutzen soll:
   - CSP-Direktive `Storage-Allow-Directive` (neuer Standard, eingeschränkte
     Unterstützung) oder
   - `document.storage.policy = 'disabled'` (Storage-Policy-API, neu/experimentell).
   Beide sind **nicht** als alleinige Maßnahme zu vertrauen; die
   architekturelle Entkopplung (Punkt 1) ist verbindlich und funktioniert auch
   ohne Browser-Unterstützung.

## 4. Zustand vor der Änderung (Ist)

- `storage.js`: `Storage`-Klasse umgreift `localStorage` mit try/catch-Slurping
  und Legacy-Key-Migration (`config.js` → `LEGACY_KEYS`).
- `main.js` `loadPersistedState()`: liest **synchron** alles aus localStorage
  (Positions, Feeds, Cache, Queue, Downloads) und baut daraus den UI-Zustand.
- `sync.js`: manueller „Sync with server"-Button überschreibt localStorage-Data
  einmalig vom Server. Server ist aktuell Sekundärquelle.
- `api.js`: zentraler `fetch`-Wrapper mit Credentials + `X-Session-Token`.

## 5. Soll-Architektur (Soll-Zustand)

- `Storage` wird zum thin Adapter: `load*` → API-GET, `save*` → API-POST/PUT.
  `localStorage`-Zugriffe (inkl. `localStorage.clear()`, Legacy-Migration)
  entfallen komplett.
- Boot (`main.js`) wird asynchron: Session prüfen → Server-Daten laden → UI
  rendern. Kein synchroner localStorage-Lesevorgang mehr.
- `sync.js` verliert die lokale Schreib-Route; alle Änderungen laufen direkt
  über die API. Der manuelle Sync-Button kann entfallen oder bleibt als
  „Jetzt neu laden".
- Cache für Episoden/Metadaten bleibt im Arbeitsspeicher (Modul-State) und/oder
  im Service-Worker `Cache API` (sw.js) für Offline-Audio — **nicht** in
  localStorage.

## 6. Umsetzung in Schritten

> Jeder Schritt ist eigenständig validierbar (Build + manueller Check). Reihenfolge
> einhalten, da spätere Schritte frühere Annahmen nutzen.

### Schritt 0 — Entscheidungen fixieren ✅ ABGESCHLOSSEN

- Klassifizierung aus Abschnitt 2 gegen den Code verifiziert (`grep` über
  `public/js/**`). Alle 8 `STORAGE_KEYS` plus 2 direkte `localStorage`-Referenzen
  außerhalb von `storage.js` erfasst:
  - `podany_player_collapsed` (`playback.js:452,767`) → client-only transient
    (UI-Zustand, gehört nicht in `STORAGE_KEYS`).
  - `localStorage.clear()` (`ui/modal.js:275`, `resetAll()`) → muss nach Rollout
    durch server-seitige Löschaufrufe ersetzt werden (siehe Risiko unten); kein
    Kandidat für eine localStorage-Kategorie.
- Server-Seite bestätigt: `subscriptions`, `playback_state`, `downloads` existieren
  als Model + Route mit Lese-/Schreibendpunkten; SESSION läuft über Cookie
  (`podcast_session`) + `X-Session-Token`-Header (bereits in `api.js`/`AuthRoutes`).
- Offene Punkte THEME/QUEUE entschieden: beide **client-only, transient (Speicher)**,
  keine Server-Tabelle. Ergebnis siehe Punkt „Entscheidungen" in Abschnitt 2.
- Nicht in Schritt 0 umgesetzt (nur dokumentiert): CODE-Migration ist den
  Schritten 2–10 vorbehalten. Schritt 0 ändert nur diese Doku + die
  Entscheidungsgrundlage.

Nebenwirkungen des Rollouts (für Schritte 3/5/7 beachten): THEME-Reset auf
`'system'' nach Reload; QUEUE wird nach Reload geleert.

### Schritt 1 — Server-Lücken schließen (falls entschieden) ✅ ABGESCHLOSSEN

- Aus Schritt 0: THEME **und** QUEUE sind client-only, transient (Speicher).
  Keine der beiden Quellen erfordert eine server-seitige Tabelle.
- **Kein Server-Change.** Es werden keine neuen Tabellen/Models/Routes angelegt
  (`playback_queue` bleibt unangelegt).
- Bestätigt, dass die persistenten Quellen bereits abgedeckt sind (Schritt 0):
  `subscriptions`, `playback_state`, `downloads` (Model + Route), SESSION über
  Cookie + `X-Session-Token`. Keine weiteren Server-Lücken vorhanden.
- Nächster Schritt ist die Frontend-Migration (Schritt 2: API-Erweiterungen).

### Schritt 2 — API-Erweiterungen in `api.js` ✅ ABGESCHLOSSEN

- **FEEDS** bereits vorhanden und korrekt: `listSubscriptions()` (GET
  `/api/subscription/list`), `addSubscription()` (POST `/api/subscription`),
  `removeSubscription()` (DELETE `/api/subscription`).
- **POSITIONS** bereits vorhanden und korrekt: `listPositions()` (GET
  `/api/playback/positions`), `savePosition()` (POST `/api/playback/positions`).
- **DOWNLOADS** neu ergänzt (`public/js/api.js`):
  - `listDownloads()` → GET `/api/downloads` → `{ downloads }[]`
  - `registerDownload({ episodeGuid, title, audioUrl })` → POST `/api/downloads`
  - `removeDownload(episodeGuid)` → DELETE `/api/downloads`
  Endpunkte matchen exakt `server/routes/DownloadRoutes.js`.
- Optionale Full-Load-Hilfe `loadAll()` ergänzt: bündelt die drei persistenten
  GETs (`listSubscriptions` + `listPositions` + `listDownloads`) in einem Call
  für den asynchronen Boot (Schritt 5). Kein Server-Endpoint nötig (mehrere GETs).
  Wirft `ApiError` bei 401/403, damit der Boot das Auth-Modal auslösen kann.
- Build-Validierung: `npm run build` (esbuild) in dieser Sandbox nicht ausführbar
  (esbuild-CLI = nativer ELF-Binary, kompatibel mit dem hier verfügbaren Node
  nicht). Änderung daher manuell verifiziert (Muster identisch zu bestehenden
  `list*`-Methoden). **In produktiver Umgebung `npm run build` erneut ausführen.**

### Schritt 3 — `storage.js` zum API-Adapter umbauen ✅ ABGESCHLOSSEN

`public/js/storage.js` vollständig neu als Adapter über `ApiClient` implementiert.
Konstruktor jetzt `new Storage(config, api, state)`.

- **localStorage vollständig entfernt:** kein `getItem/setItem/removeItem`, kein
  `localStorage.clear()`, keine Legacy-Key-Migration mehr, `_keys()`/`_legacy()`,
  `minimalQueueItem()` und `safeParse()` entfallen.
- **Server-backed (async):**
  - `loadFeeds()` → `api.listSubscriptions()` (mapped auf Feed-URLs).
  - `loadPositions()` → `api.listPositions()`.
  - `loadDownloads()` → `api.listDownloads()`, Server-Schema → Client-Schema
    gemappt (`episode_guid→guid`, `audio_url→audioUrl`, `file_size→size`, ...).
  - `saveDownloads(map)` registriert neue Episoden server-seitig über
    `api.registerDownload` (fire-and-forget, `.catch` gegen unhandled rejections;
    `_registeredGuids` verhindert Doppel-Calls).
- **Saves als No-op, weil Server-Schreibweg separat besteht:**
  - `saveFeeds()` und `savePositions()` bleiben No-ops. Feeds werden von
    `SyncManager` über `addSubscription`/`removeSubscription` geschrieben,
    Positionen pro Episode über `api.savePosition` (timeupdate/completion). Ein
    Bulk-Endpoint fehlt; ein Schreibversuch hier würde Doppel-Calls erzeugen.
- **Client-only / Speicher (synchrone Methoden, daher unverändert):**
  - `loadTheme`/`saveTheme` → `state.theme`; `loadQueue`/`saveQueue` →
    `state.queue`; `loadCache`/`saveCache` → `state.allEpisodes`/`state.feedMetadata`.
  - Dadurch bleiben `ui/theme.js`, `queue.js`, `feeds.js` **ohne Änderungen**.
- **Session (`loadSessionToken`/`saveSessionToken`):** synchron, liest/schreibt
  nur den internen `state.sessionToken` (kein Cookie-in-Speicher mehr; Cookie +
  `X-Session-Token`-Header laufen über `ApiClient`). `auth.js` unverändert.
- **Aufrufer angepasst (notwendig, weil server-backed Loads async sind):**
  - `public/js/main.js`: `new Storage(config, api, state)`; `loadPersistedState()`
    ist jetzt `async` und awaitet `loadPositions`/`loadFeeds`/`downloads.loadDownloads`;
    `init()` ist `async` und awaitet `loadPersistedState()`, um die Reihenfolge
    `checkUrlSessionParam()` → `checkAuth()` (Magic-Link) beizubalten.
  - `public/js/downloads.js`: `loadDownloads()` ist jetzt `async`.
- **`clearAll()`:** cleared nur noch client-transiente Zustände (queue/theme);
  Server-Logout/Löschung bleibt bei den Aufrufern (`api.logout`, Cookie-Reset).

Nebenwirkung/Risiko: Der Boot lädt jetzt asynchron; `checkAuth()` lädt bei
angemeldeten Nutzern erneut (Redundanz, wie bisher). Vollständiges
Ladezustands-UI und „auth-first"-Neuanordnung sind Schritt 5 vorbehalten.

Build-Validierung: `npm run build` (esbuild) in dieser Sandbox nicht ausführbar
(esbuild-CLI = nativer ELF-Binary, kompatibel mit dem hier verfügbaren Node
nicht). Änderung daher manuell verifiziert (Auferuf-Konsistenz + Muster
bestehender `list*`-Methoden). **In produktiver Umgebung `npm run build` erneut
ausführen.**

### Schritt 4 — Session/Auth ohne localStorage ✅ ABGESCHLOSSEN

Session-Token wird **nicht** im Browser persistiert (kein `localStorage`/
`sessionStorage`). Der Token lebt nur im internen `AppState.sessionToken` und
wird über Server-Cookie + Header übertragen. Verifiziert gegen Code:

- **Cookie (`podcast_session`):** `ApiClient.request` nutzt `credentials:
  'include'` (`api.js:31`), sodass das Session-Cookie automatisch mitgesendet
  wird. Logout löscht das Cookie client-seitig (`auth.js:263`,
  `SESSION_COOKIE_NAME = 'podcast_session'`). Name matcht Server-Config
  (`server/config/defaults.js:19`).
- **`X-Session-Token`-Header:** `_headers()` hängt den Token aus
  `state.sessionToken` an (`api.js:20-25`); Logout sendet ihn zusätzlich
  explizit (`api.js:87`).
- **`loadSessionToken`/`saveSessionToken`:** in `storage.js:20-28` lesen/schreiben
  nur noch `state.sessionToken` (kein Browser-Speicher). Alle Auferer
  (`auth.js`, `sync.js:31-32`) spiegeln nur den internen State.
- **Keine Session-`localStorage`-Schreibzugriffe** irgendwo im Frontend
  (`grep localStorage public/js`): einzige verbleibende Referenzen sind
  `podany_player_collapsed` (playback.js, UI-Zustand) und `localStorage.clear()`
  in `ui/modal.js:275` (`resetAll`, siehe Risiko in Abschnitt 7 / Schritt 8).
  Magic-Link-/Passwort-Login schreiben den Token nur in `state` + `storage`.

Nebenwirkung: kein persistenter Token im Browser → nach Cookie-Reset/Logout
neue Auth nötig (gewünscht). Build in dieser Umgebung nicht lauffähig —
`npm run build` in produktiver Umgebung nach Schritt 8 erneut ausführen.

### Schritt 5 — Boot asynchron machen (`main.js`) ✅ ABGESCHLOSSEN

`public/js/main.js`: `loadPersistedState()` durch `async initApp()` ersetzt,
Boot jetzt **auth-first** strukturiert. `init()` awaitet `initApp()`; der
ehemalige trailing `app.auth.checkAuth()` entfällt (ist jetzt Schritt 2 von
`initApp`). Debug-`console.log` aus dem alten Boot entfernt.

Neue Reihenfolge in `initApp()` (`main.js:49-81`):
1. `auth.checkUrlSessionParam()` — Session-/Token-Param aus der URL in den
   State, URL bereinigen (MUSS vor `checkAuth` laufen, Magic-Link).
2. `await auth.checkAuth()` — Session vom Server validieren (auth-first); bei
   Login/Session werden Feeds + Positionen bereits syncronisiert.
3. Persistente Daten vom Server laden: `loadFeeds()` → `state.feeds`,
   `loadPositions()` → `state.playbackPositions`, `loadDownloads()`.
4. Cache-Arbeitsspeicher befüllen (`loadCache` → `allEpisodes`/`feedMetadata`)
   + Queue (`loadQueue`, client-only transient).
5. UI rendern (`timeline`, `continue-shelf`, `feeds-grid`) falls Episoden
   vorhanden.

Ladezustand: `modal.showStatus('Starte Podany...')` bzw.
`showStatus('Lade Feeds, Positionen und Downloads...')` während der Server-Calls,
`hideStatus()` am Ende (bestehendes `status-banner`, `ui/modal.js:210`).

Reihenfolge-Notiz: `checkUrlSessionParam()` lief vorher innerhalb von
`loadPersistedState()`, `checkAuth()` wurde in `init()` **nach** dem Laden
aufgerufen. Jetzt läuft die Auth-Validierung **vor** dem Datenladen — damit ist
der Boot „auth-first". Event-Wiring (`wireAllEvents`) bleibt nach `initApp()`;
`checkAuth()` benötigt keine Handler, also kein Verhalten verloren.

Redundanz (wie in Schritt 3/5 angekündigt): bei angemeldeten Nutzern synchron
`checkAuth` Feeds/Positionen (`syncFeedsWithServer`), danach laden
`loadFeeds`/`loadPositions` erneut vom Server. Funktionally sicher (nur
zusätzliche GETs); geräteübergreifend korrekt. Reduzierbar durch `api.loadAll()`
(Schritt 2) — optionaler Follow-up, nicht in Schritt 5.

Build-Validierung: `npm run build` (esbuild) in dieser Sandbox nicht ausführbar
(esbuild-CLI = nativer ELF-Binary, kompatibel mit dem hier verfügbaren Node
nicht). Änderung manuell verifiziert (Auferuf-Konsistenz, keine Restreferenz an
`loadPersistedState` im Code). **In produktiver Umgebung `npm run build` erneut
ausführen.**

### Schritt 6 — Cache-Strategie anpassen ✅ ABGESCHLOSSEN

`CACHED_EPISODES`/`CACHED_METADATA` werden **nicht** mehr im Browser
persistiert; der Episode-/Feed-Cache lebt im Arbeitsspeicher (`AppState`) und
Offline-Audio läuft über die SW `Cache API`. Verifiziert gegen Code:

- **Kein `localStorage`-Zugriff für den Cache.** `grep localStorage public/js`
  (`.js`): einzige verbleibende Aufrufe sind `podany_player_collapsed`
  (playback.js:452,767, UI-Zustand) und `localStorage.clear()`
  (ui/modal.js:275, `resetAll` → Schritt 8). Kein `getItem/setItem` für
  CACHED_EPISODES/CACHED_METADATA irgendwo. `storage.js:117-130` (`loadCache`/
  `saveCache`) lesen/schreiben nur `state.allEpisodes`/`state.feedMetadata`.
- **Arbeitsspeicher-Cache.** `state.js:10-11,48-49` initialisiert
  `allEpisodes=[]` / `feedMetadata={}` (rein im Speicher). Boot
  (`main.js:67-69`) befüllt ihn über `loadCache()`. `feeds.js:61-104`
  (`refreshAllFeeds`) zieht bei Neuladen vom Feed nach: frische Episoden/Metadaten
  → `state.allEpisodes`/`state.feedMetadata` → `saveCache(...)` (Speicher).
- **Offline-Audio unverändert.** `AUDIO_CACHE_NAME = 'podany-audio-v1'`
  (config.js:46) wird über die `Cache API` geführt: `sw.js:2,26,62`,
  `downloads.js:112,155,171,234`, `feeds.js:310` (`caches.open(AUDIO_CACHE_NAME)`
  / `caches.delete`). SW-Caching bleibt bestehen, kein localStorage.
- **Stales Kommentar korrigiert:** `downloads.js:2` („metadata in localStorage")
  auf „metadata lives in the in-memory AppState cache" aktualisiert — entspricht
  dem Soll-Zustand.
- **Hinweis:** `STORAGE_KEYS.CACHED_EPISODES`/`CACHED_METADATA` in `config.js:8-9`
  sind jetzt unbenannte Konstanten (tote Keys, kein Lese/Schreibzugriff). Nicht
  gelöscht, um den Scope zu wahren; config.js-Aufräumung (`LEGACY_KEYS`) ist
  Schritt 8.

Build-Validierung: `npm run build` (esbuild) in dieser Sandbox nicht ausführbar
(esbuild-CLI = nativer ELF-Binary, kompatibel mit dem hier verfügbaren Node
nicht). Änderung manuell verifiziert (kein Cache-`localStorage`-Zugriff,
Cache-Fluss storage↔state↔feeds konsistent). **In produktiver Umgebung
`npm run build` erneut ausführen.**

### Schritt 7 — Offline-/Fehlerverhalten definieren ✅ ABGESCHLOSSEN

Fehler im Boot werden nicht mehr verschluckt, sondern klar an die UI
zurückgegeben. Zwei Ebenen:

**1. try/catch-Slurping aus `storage.js` entfernt.** `loadFeeds()` /
`loadPositions()` / `loadDownloads()` (`public/js/storage.js:32-85`) werfen jetzt
Fehler der `ApiClient` (`ApiError` bei HTTP-Fehlern, sonst z. B. Netzwerkfehler)
propagieren statt stills `[]`/`{}` zurückzugeben. Safe, weil alle drei Methoden
nur im Boot aufgerufen werden: `main.js` `initApp()` Schritt 3
(`loadFeeds`/`loadPositions`) bzw. über `downloads.loadDownloads()`
(`downloads.js:20`, nur von `initApp` Schritt 3). `sync.js` nutzt
`api.listSubscriptions()`/`api.listPositions()` direkt und hat eigene
Fehlerbehandlung (`syncFeedsWithServer`, behandelt 401/403 bereits).

**2. Boot-Fehlerhandler in `main.js`.** Neue Funktion `handleBootError(err)`
(`main.js:48-59`), aufgerufen aus dem `try/catch` um Schritt 3 in `initApp()`
(`main.js:80-87`); bei Fehler wird vor dem UI-Render zurückgekehrt (kein stilles
leeres Grid mehr). `ApiError` wird in `main.js:14` importiert.

- **401/403 (Session ungültig/abgelaufen):** `state.sessionToken` +
  `storage.saveSessionToken('')` zurücksetzen, `updateSyncStatusUI('Session
  Expired', '', false)`, `auth.showAuthModal()` → Auth-Modal erscheint, NeuloGang
  der Session über Magic-Link/Passwort.
- **Sonstige Fehler (offline, 5xx, malformed response):** `console.error(...)` +
  `modal.showStatus('Could not load data from the server (…)…')` im
  `status-banner`. Synergie mit `offline-badge` (`setupNetworkListeners`,
  `main.js:124-137`), der beim Netzwerkausfall separat „Offline" anzeigt.
- Nach einem Fehler läuft `init()` weiter (`wireAllEvents`, Audio, Static-UI),
  damit die UI bedienbar bleibt (z. B. Refresh/Neu-Login); der Render der
  Episoden wird übersprungen, solange keine Daten da sind.

Nebenwirkung: Lädt eine der drei Quellen komplett, blockiert das Boot bis zur
Fehleranzeige; partielle Laden-und-teil-renderen gibt es bewusst nicht (klare
Fehlermeldung statt inkonsistentem Zustand). Bei wiederkehrenden 401/403 nach
erfolgreichem Login könnte ein Follow-up `api.loadAll()` (Schritt 2) zur
Reduzierung der GETs dienen.

Build-Validierung: `npm run build` (esbuild) in dieser Sandbox nicht ausführbar
(esbuild-CLI = nativer ELF-Binary, kompatibel mit dem hier verfügbaren Node
nicht). Änderung manuell verifiziert (Auferuf-Konsistenz, keine slurpenden
try/catch mehr in den Load-Methoden). **In produktiver Umgebung `npm run build`
erneut ausführen.**

### Schritt 8 — localStorage-Zugriffe vollständig entfernen ✅ ABGESCHLOSSEN

**Ziel erreicht: 0× `localStorage`-Zugriff in `public/js/**`.**

- **`podany_player_collapsed`** (`playback.js:452,767`) → client-only transient.
  Zustand jetzt in AppState: `state.playerCollapsed` (`state.js:28,60`, auch in
  `reset()`). `playback.js` liest/schreibt nur noch `this.state.playerCollapsed`
  (kein `getItem`/`setItem` mehr).
- **`localStorage.clear()`** (`ui/modal.js:274`, `resetAll()`) → durch
  server-seitige Löchaufrufe ersetzt. `resetAll()` ist jetzt `async` und löscht
  vor `state.reset()`:
  - Feeds über `api.removeSubscription(url)` (alle `state.feeds`).
  - Positionen über neue `api.removePosition(guid)` → DELETE `/api/playback/positions`.
  - Downloads über `api.removeDownload(guid)` (alle `state.downloadedEpisodes`).
  - Offline-Audio weiterhin über `caches.delete('podany-audio-v1')`.
  Begründung: Persistenz liegt am Server, ein rein client-seitiges Reset würde
  Server-Rechte zurücklassen (Risiko siehe Abschnitt 7). Fehler pro Call mit
  `try/catch` abgefangen (Guest-Modus / Offline bleibt bedienbar).
- **Legacy-Key-Migration entfernt:** `config.js` — `LEGACY_KEYS`-Block und
  `Config.legacyKey()` entfallen. Einzige verbleibende `localStorage`-Referenz im
  Code ist ein Kommentar (`storage.js:5`).
- **Server-Seite ergänzt:** `server/routes/PlaybackRoutes.js` — DELETE `/positions`
  (Validierung `episodeGuid` wie POST); `server/services/playbackService.js` —
  `removePosition(userId, episodeGuid)` (nutzt bestehendes `PlaybackState.remove`).
- **Frontend-API:** `api.js` — `removePosition(episodeGuid)` ergänzt.
- **Build-Validierung:** `npm run build` (esbuild) in dieser Sandbox nicht
  ausführbar (esbuild-CLI = nativer ELF-Binary, kompatibel mit dem hier
  verfügbaren Node nicht). Änderungen manuell verifiziert (Aufruf-Konsistenz,
  grep bestätigt 0× `localStorage` in source). Server-Tests:
  `node --test server/routes/routes.test.js` = 18 pass / 7 fail — **identisch zur
  Baseline vor dieser Änderung**; die 7 Failures sind pre-existing (Test nutzt
  alte `/api/sync/*`-Pfade, Source lautet `/api/playback/*`) und haben nichts mit
  Schritt 8 zu tun; `playbackService.test.js` = 3/0. **Kein Regression.**
  **In produktiver Umgebung `npm run build` erneut ausführen** (regeneriert
  `public/dist/bundle.js`, das aktuell den alten Stand enthält).

### Schritt 9 — Deprecated-Daten der Alt-Version aufräumen (einmalig)
- Nach Rollout: alte localStorage-Schlüssel können mit einer einmaligen
  Migration/Versionierung im Service Worker oder über Cookie-Flag als „alt"
  markiert und nach erstem erfolgreichen Server-Load gelöscht werden.
- Optional: Umsteiger-Anzeige „Daten wurden vom Server übernommen".

### Schritt 10 — Validierung
- `npm run build` (esbuild-Bundle) erfolgreich.
- Manuell: DevTools → Application → LocalStorage ist nach Boot leer; alle Daten
  kommen aus Network-Antworten.
- Cross-Device: gleicher Login auf zweitem Gerät zeigt identische Feeds/
  Positionen/Downloads (localStorage kann dort komplett gesperrt sein).
- Offline-Audio über SW weiterhin spielbar.

## 7. Risiken & Gegenmaßnahmen

- **Erster Start ohne Server-Daten**: UI bleibt leer bis erster Lade-Vorgang
  fertig → Ladezustand + Fehleranzeige einführen (Schritt 5/7).
- **Latenz**: viele kleine API-Calls → Batch/Full-Load im Boot (Schritt 2).
- **Veraltete Alt-Daten**: alte localStorage-Werte werden nicht mehr gelesen →
  Migrationsschritt 9 für einen sauberen Übergang.
- **Browser-Sperre nur ergänzend**: `document.storage.policy`/CSP nicht als
  alleiniger Schutz; architekturelle Entkopplung ist verbindlich (Schritt 3).
- **`resetAll()` (`ui/modal.js:275`)**: `localStorage.clear()` muss nach Rollout
  durch server-seitige Löchaufrufe ersetzt werden (jeden Feed über
  `/api/subscription` DELETE, Positionen + Downloads löschen). Ein reines
  Client-State-Reset reicht nicht mehr, da die Persistenz am Server liegt.
- **Transienter Zustand**: THEME und QUEUE sind nach Rollout nur im Speicher →
  User*innen erwarten ggf. Persistenz über Reload hinaus; in der UI ggf.
  kennzeichnen oder Entscheidung später überdenken (Server-Tabelle).

## 8. Erfolgskriterien

- [] Kein `localStorage`-Zugriff in `public/js/**`.
- [] Boot lädt persistente Daten async vom Server.
- [] Feeds, Positionen, Downloads, Session sind server-seitig und geräteübergreifend.
- [] Build erfolgreich, Offline-Audio über SW funktionsfähig.
