# Konzept: `document.querySelector*` durch komponenten-gebundene Elementzugriffe ersetzen

**Bereich:** Nur Frontend in `public/` (JS).
**Status des Dokuments:** Freigegeben.
**Erstellt:** 2026-09-28

---

## 1. Zweck

Das Frontend soll **nicht mehr** über globale Selektoren auf das DOM zugreifen:

- `document.querySelector(...)`
- `document.querySelectorAll(...)`
- `document.getElementsByClassName(...)`
- `document.getElementsByTagName(...)`
- `document.getElementById(...)` **außer** innerhalb der zentralen Element-Cache-Klasse (`dom.js`).

Stattdessen ist jedes relevante Element über eine **explizite Referenz in einer Klasse** ansprechbar, z. B. `this.element`, `this.gridElement`, `this.playBtn`, oder über ein pro View angelegtes `els`-Objekt / Registry-Map.

**Warum:** Globale Selektor-Lookups sind die Hauptursache für fragile Updates dynamischer Listen (Karten, Queue-Zeilen, Chips). Sie laufen gegen das *gesamte* Dokument, sind bei Re-Render fehleranfällig und schwer zu testen. Explizite Referenzen machen Abhängigkeiten sichtbar und ermöglichen stabile Updates ohne DOM-Suche.

---

## 2. Ist-Zustand (Bestandsaufnahme)

### 2.1 Was schon gut ist
`public/js/dom.js` (`Elements`-Klasse) cached **statische** DOM-Elemente aus `index.html` über `getElementById` (und ein paar class-basierte Overays über `q`/`qa`). Komponenten greifen über `this.elements.*` darauf zu — das bleibt so.

### 2.2 Was das Problem ist
Dynamisch erzeugte Nodes (Episode-Karten, Feed-Karten, Queue-Zeilen, Chips) werden **nicht** referenziert. Stattdessen wird jedes Mal das ganze Dokument durchsucht:

```js
const cards = document.querySelectorAll('.episode-card');   // playback.js:708
cards.forEach(card => card.querySelector('.btn-play-ep') ...);
```

### 2.3 Erfasste Stellen (Auszug, sortiert nach Kategorie)
Vollständiger Inventar-Abgleich über `grep` in `public/js` (siehe Abschnitt 6 für die detaillierte Tabelle).

- **Dokumentweite Iterationen über dynamische Listen** → brauchen Registry-en:
  `playback.js` (489, 558, 708, 732), `queue.js` (66, 208, 227), `timeline.js` (422), `live/LiveClient.js` (259, 290).
- **Lookups frisch erzeugter Local-Nodes** → Referenzen beim Bau einfangen:
  `components/episodeCard.js`, `components/feedCard.js`, `components/feedDetailHeader.js`, `components/podcastDirectory.js`, `components/feedDetailEpisodes.js`, `components/feedsGrid.js`, `components/showNotes.js`, `queue.js` (Zeilen), `timeline.js` (Progress-Track).
- **`document.getElementById` außerhalb von `dom.js`** → in `Elements` versetzen oder über `elements.byId()`:
  `feeds.js` (230, 231), `playback.js` (44, 358), `timeline.js` (304, 341–344, 390), `components/feedsGrid.js` (133–136, 182), `ui/modal.js` (43, 45).
- **Einzelner Sonderfall:** `playback.js:400` prüft, ob der YouTube-IFrame-`<script>` schon existiert → durch boolesches Flag ersetzen.

---

## 3. Zielzustand (Soll-Konzept)

**Prinzip „Element-Eigentum" (Element Ownership):** Wer einen Node erzeugt, hält auch die Referenz darauf. Es gibt drei Muster:

### Muster A — Pro-View-Referenzen (`els`-Objekt / Properties)
Komponenten, die **eine** Karte/Zeile bauen, fangen die benötigten Child-Elemente beim Bau ab und hören direkt darauf.

```js
// BEFORE (episodeCard.js)
card.innerHTML = `...<button class="btn-play-ep">…</button>...`;
card.querySelector('.btn-play-ep').addEventListener('click', ...);

// AFTER
const els = {};
card.innerHTML = `...`;                       // Template bleibt
// ODER (sauberer): Kinder per createElement + els.playBtn = ...
els.playBtn = card.__playBtn;                 // Referenz beim Bau einfangen
els.playBtn.addEventListener('click', ...);
return { el: card, els };                      // an Registry übergeben
```

### Muster B — Registry für wiederholte Items
Komponenten, die **viele** gleiche Items erzeugen (Episode-Karten), führen eine `Map(id → { el, els })`. Zustand-Updates iterieren über die Registry, nicht über das Dokument.

```js
// BEFORE (playback.js)
const cards = document.querySelectorAll('.episode-card');
cards.forEach(card => card.querySelector('.btn-play-ep') ...);

// AFTER
for (const { el, els } of this.app.timeline.episodeCards.values()) {
    if (String(el.dataset.id) === String(id)) {
        els.playBtn.innerHTML = icon;
    }
}
```

### Muster C — Statische Elemente zentral
Alle statischen Elemente bleiben in `dom.js` (`this.elements.*`). Neu hinzukommende class-basierte Static-Refs (z. B. `.player-track-info`, `.icon-play`) werden dort als Properties ergänzt (id wo möglich, sonst eigene Cache-Methode).

---

## 4. Regeln & Definitionen

| Kategorie | Status | Beispiel |
|---|---|---|
| Globale Lookups auf `document` | **verboten** | `document.querySelector`, `querySelectorAll`, `getElementsBy*`, `getElementById` (außer `dom.js`) |
| Dynamische Listen-Updates | **Registry / captured refs** | `for (const x of registry.values())` |
| Einzelne Local-Nodes | **Referenz beim Bau einfangen** | `els.playBtn = ...` |
| Statische Shell-Elemente | **`this.elements.*` / `elements.byId()`** | `this.elements.feedsGrid` |
| `<script>`/Existenz-Check | **boolesches Flag** | `this.state.ytScriptTagAdded` |
| DOM-Erzeugung/-Modifikation | **erlaubt** | `createElement`, `createDocumentFragment`, `appendChild`, `body.classList`, `head.appendChild` |
| `document.elementFromPoint` | **erlaubt (transitional)** | `queue.js:206` — kein Selektor; ggf. später über Drag-Target ersetzen |
| `DOMParser`-Dokumente | **erlaubt, außerhalb des Scope** | `doc.querySelectorAll` in `opml.js`, `showNotes.js` — transienteres Parsing, kein Zugriff auf `document` |
| `element.querySelector` auf Local-Nodes | **Übergangslösung, Ziel: Elimination** | Nur wenn `createElement` unpraktisch; mit Deadline auf captured refs umstellen |

> **Begründung für `DOMParser`:** Die Vorgabe verbietet gezielt `document.*`. `DOMParser().parseFromString(...)` liefert ein *eigenes*, flüchtiges `Document` zum Parsen — kein Zugriff auf die Seiten-Doku. Diese Stellen bleiben vorerst erlaubt; bei Bedarf später gleichwertig umstellen.

---

## 5. Kernstück: die Episode-Karte

Die `EpisodeCard` ist der Engpass: Sie wird von `TimelineManager` und `FeedDetailEpisodes` erzeugt, ihr Zustand wird aber von `playback`, `queue`, `timeline` und `live/LiveClient` extern aktualisiert (Play/Queue/Played/Fortstand/Download-Badge). Aktuell löst jedes dieser Module das über `document.querySelectorAll('.episode-card')`.

**Umstellung:**
- `TimelineManager` führt `this.episodeCards = new Map()` (`id → { el, els }`).
- `createEpisodeCard(ep)` liefert `{ el, els }` zurück; `els` hält alle Buttons/Tracks/Badges.
- `FeedDetailEpisodes` füllt dieselbe Registry (oder eine zweite, wird aber bei Wechsel geleert).
- `playback.syncPlaybackButtons()`, `updateProgress()`, `updateDuration()`, `queue.updateQueueUI()`, `timeline.toggleMarkPlayed()` und `LiveClient`-Updates iterieren über `episodeCards`.
- **Wichtig:** Bei jedem Re-Render die Registry leeren (`clear()`), bevor neu befüllt wird, sonst hängen veraltete Referenzen.

---

## 6. Inventar-Tabelle (Stelle → Ziel)

### 6.1 Dokumentweite Iterationen → Registry
| Datei:Zeile | Aktuell | Ziel |
|---|---|---|
| playback.js:400 | `document.querySelector('script[src*=youtube]')` | Flag `this.state.ytScriptTagAdded` |
| playback.js:489 | `document.querySelectorAll('.episode-card[data-id=...]')` | `episodeCards` nach `id` gefiltert |
| playback.js:558 | `document.querySelector('.episode-card[data-id=...]')` | `episodeCards.get(id)?.el` |
| playback.js:708 | `document.querySelectorAll('.episode-card')` | `episodeCards.values()` |
| playback.js:732 | `document.querySelectorAll('.recent-ep-row')` | Feed-Karten-Registry / Event-Delegation |
| queue.js:66 | `document.querySelectorAll('.episode-card')` | `this.app.timeline.episodeCards.values()` |
| queue.js:208,227 | `document.querySelectorAll('.queue-item-row')` | `this.queueRows.values()` |
| timeline.js:422 | `document.querySelectorAll('.episode-card[data-id=...]')` | `episodeCards.values()` |
| live/LiveClient.js:259 | `document.querySelector('.episode-card[data-id=...]')` | `this.app.timeline.episodeCards.get(id)` |
| live/LiveClient.js:290 | `document.querySelectorAll('.episode-card')` | `this.app.timeline.episodeCards.values()` |
| ui/modal.js:21 | `document.querySelector('.nav-tab.active')` | `this.elements.tabs` nach `.active` durchsuchen |
| feeds.js:265 | `document.querySelectorAll('#modal-category-chips .category-chip')` | Chips cache-n (statisch) |

### 6.2 Local-Node-Lookups → Referenzen einfangen
| Datei:Zeile | Ziel |
|---|---|
| components/episodeCard.js:109,117,125,133,138,143,148,153 | `els`-Objekt, Listener direkt |
| components/feedCard.js:110,115 | Zeilen-/Button-Referenzen capture |
| components/feedCard.js:131 | `grid.querySelector('[data-feed-id=...]')` → Grid-Registry |
| components/feedDetailHeader.js:26,32,70,74,88,91 | Referenzen auf `header.__els` speichern |
| components/podcastDirectory.js:113 | `subBtn` beim Bau fangen |
| components/feedDetailEpisodes.js:63 | artwork-Flag/Referenz (ohne query) |
| components/feedsGrid.js:186,191 | Chips beim Befüllen capture |
| components/showNotes.js:100 | Timestamp-Buttons während Generierung capture |
| queue.js:196,232,238 | Zeilen-Refs in `queueRows`-Registry |
| timeline.js:448,465 | Fill/Resume-Ref am Progress-Track halten |

### 6.3 `getElementById` außerhalb von `dom.js` → `Elements` / `byId()`
| Datei:Zeile | Ziel |
|---|---|
| dom.js:8,9 | `q`/`qa` class-basierte Overays → ids oder Cache-Methode |
| feeds.js:230,231 | in `Elements` (`tabFeeds`, `panelFeeds`) |
| playback.js:44,358 | in `Elements` (`ytPlayer`, `ytPlayerContainer`) |
| timeline.js:304,341–344,390 | in `Elements` (sentinel, empty-quick-*, opml-trigger) |
| components/feedsGrid.js:133–136,182 | Onboarding-Refs capture / cache |
| ui/modal.js:43,45 | dynamische ids → `elements.byId(\`tab-${t}\`)` |

### 6.4 Bleibt erlaubt (außerhalb des Verbots)
- `dom.js` als **einzige** sanctioned Stelle für `document.getElementById`.
- `DOMParser`-Dokumente: `showNotes.js:37,40`, `opml.js:20` (`doc.querySelectorAll`).
- Erzeugung/Modifikation: `createElement`, `createDocumentFragment`, `appendChild`, `body.classList`, `head.appendChild`.
- `document.elementFromPoint` (`queue.js:206`) — transitional.

---

## 7. Phasenplan

### Phase 0 — Grundlagen & Guardrails
- [ ] Konzept freigeben.
- [ ] Naming-Conventions fixieren (siehe Abschnitt 8).
- [ ] ESLint-Regel `no-restricted-syntax` für `document.querySelector*`/`getElementsBy*`/`getElementById` (außer `dom.js`) einrichten → verhindert Regressionen ab jetzt.
- [ ] Build-Pipeline (esbuild → `public/dist/bundle.js`) als Verifikations-Basis markieren.

### Phase 1 — Statische Elemente vollständig in `Elements`
- [ ] Alle `getElementById`-Stellen außerhalb von `dom.js` (6.3) in `dom.js` versetzen bzw. über `elements.byId()` aufrufen.
- [ ] Class-basierte Static-Refs in `dom.js` ergänzen (`.player-track-info`, Icons).
- [ ] Ziel: Außerhalb von `dom.js` kein `document.*`-Lookup mehr für die statische Shell.

### Phase 2 — Captured References (Single-Node-Views)
- [ ] `episodeCard.js`: `els`-Objekt, Listener direkt, Rückgabe `{ el, els }`.
- [ ] `feedDetailHeader.js`: Referenzen auf `header.__els`.
- [ ] `feedCard.js`, `podcastDirectory.js`, `feedDetailEpisodes.js`, `feedsGrid.js` (Chips), `showNotes.js` (Timestamps), `queue.js` (Zeilen).
- [ ] Ziel: Kein `card.querySelector(...)`/`row.querySelector(...)` mehr.

### Phase 3 — Registry für dynamische Listen
- [ ] `TimelineManager.episodeCards` Map einführen; `FeedDetailEpisodes` anschließen.
- [ ] `QueueManager.queueRows` Map einführen.
- [ ] Dokumentweite Iterationen (6.1) auf Registry-en umstellen: `playback` (syncPlaybackButtons, updateProgress, updateDuration), `queue.updateQueueUI`, `timeline.toggleMarkPlayed`, `live/LiveClient`.
- [ ] YouTube-Script-Check (playback.js:400) → Flag.

### Phase 4 — Komponentengrenzen überschreitender Zugriff
- [ ] `LiveClient` erhält Zugriff auf `this.app.timeline.episodeCards` (statt document-Suche).
- [ ] Kategorie-Chips (`feeds.js:265`, `timeline.js:394`) cache-n.
- [ ] `modal.js:21` (`.nav-tab.active`) über `this.elements.tabs`.

### Phase 5 — Aufräum, Verifikation, Absicherung
- [ ] Letzte verbleibende `document.*`-Lookups beseitigen (außer erlaubte Kategorie 4).
- [ ] `live/LiveClient.test.js` an neue Zugriffspfade anpassen (Mock ggf. Registry-stub).
- [ ] ESLint-Regel läuft; Build (esbuild) kompiliert fehlerfrei.
- [ ] Smoke-Tests der betroffenen Flows: Karten rendern/aktualisieren, Queue-Reorder, Mark-Played, Download-Badge, Show-Notes-Timestamps, Navigation.

---

## 8. Naming-Conventions (freigegeben)

> Naming laut Abschnitt 8 festgelegt und freigegeben (Phase 0). Keine inhaltlichen Änderungen mehr; die Phasen 1–5 verwenden ausschließlich diese Bezeichnungen.

- Statische Shell-Elemente: `this.elements.<idCamelCase>` (z. B. `feedsGrid`, `playerBar`).
- Dynamische Single-Views: lokales `els`-Objekt mit sprechenden Keys (`els.playBtn`, `els.queueBtn`, `els.progressTrack`).
- Registry für Listen: `this.<pluralNoun>` als `Map(id → { el, els })` (z. B. `episodeCards`, `queueRows`).
- Pro-View-Container-Ref: `this.<area>Element` (z. B. `this.gridElement`, `this.listElement`).
- Anhängen einer Referenz an einen Node (falls Rückgabe unpraktisch): `node.__els = els` (privates Prefix).

---

## 9. Risiken & Gegenmaßnahmen

| Risiko | Gegenmaß |
|---|---|
| Re-Render hinterläässt veraltete Registry-Referenzen | Registry bei jedem Befüllen vorab `clear()`; nur aktuelle Nodes halten |
| Viele kleine Properties statt einem `els` | `els`-Objekt oder Map als eine Referenz pro View |
| `LiveClient`/`playback`/`queue` hängen an verschiedenen Kartensätzen | Eine zentrale Registry (`TimelineManager.episodeCards`) als Single Source of Truth |
| `getElementById` mit dynamischer id (`tab-${t}`) | `elements.byId(id)`-Helfer, der intern `getElementById` nutzt (single sanctioned wrapper) |
| Scope-Klarheit (`document.*` vs. `DOMParser`) | In Konzept explizit dokumentiert (Abschnitt 4); ESLint nur auf `document.*` |
| Regressionen nach Umbau | ESLint-Regel ab Phase 0 + Build-Check pro Phase |

---

## 10. Definition-of-Done (Endzustand)

- In `public/js` (außer `dom.js`) existiert **kein** `document.querySelector/querySelectorAll/getElementsBy*/getElementById` mehr.
- Jedes dynamische Element ist über eine Klassen-Referenz (`this.*`, `els.*`, Registry) erreichbar.
- `dom.js` ist die einzige Stelle mit sanctioned `document.getElementById`.
- ESLint-Regel verhindert neue Verstöße; Build kompiliert fehlerfrei; betroffene Flows getestet.
