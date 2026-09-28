# WORKFLOW.md — Frontend-Teil `public/`

Arbeitsablauf für Entwicklung, Build und Wartung des Frontends von Podany.
Gilt für alle Dateien unter `public/` (außer `public/dist/bundle.js`, wird aus
`public/js/main.js` gebaut — nicht händisch bearbeiten).

---

## 1. Aufbau von `public/`

```
public/
├── index.html              # Single-Page-Shell (Container, Panels, Tabs)
├── dev.html                # Dev-Start ohne Bundle-Minifizierung
├── manifest.webmanifest    # PWA-Manifest
├── icon.svg
├── sw.js                   # Service Worker (Offline/Caching)
├── css/
│   ├── index.css           # Sammel-Import
│   ├── variables.css       # Farben/Tokens
│   ├── global.css, typo.css, forms.css, responsive.css
│   └── components/*.css    # pro Komponente eine Datei
└── js/
    ├── main.js             # Entry Point: legt App + Manager an, Boot-Sequenz
    ├── config.js           # Konstanten (Fallsback-Artwork etc.)
    ├── state.js            # Zentrale Datenhaltung (feeds, episodes, metadata…)
    ├── dom.js              # „elements": Zugriff auf Shell-Node-IDs
    ├── api.js              # Fetch zum Backend (ApiClient, ApiError)
    ├── storage.js          # Cache + Session-Token (IndexedDB/localStorage)
    ├── sync.js             # Server-Sync (Feeds hoch/runter)
    ├── playback.js         # Audio-Engine (+ YouTube)
    ├── queue.js            # Client-only Wiedergabe-Warteschlange
    ├── timeline.js         # Sortieren/Rendern der Episoden-Tabelle
    ├── auth.js             # Magic-Link-Login, Session-Check
    ├── utils.js            # Hilfsfunktionen (escapeHtml etc.)
    ├── ui/                 # Shell-Helfer
    │   ├── modal.js        # Confirm/Status/Modale
    │   ├── player-ui.js    # Player-Oberfläche
    │   └── theme.js        # Dark/Light-Theme
    ├── live/
    │   ├── LiveClient.js   # WebSocket für Live-Updates
    │   └── LiveClient.test.js
    └── components/         # UI-Komponenten/Manager
        ├── feedsGrid.js        # Grid + Empty-State (hält die Card-Sammlung)
        ├── feedCard.js         # Card-Renderer/-Instanz
        ├── feedCardRecent.js   # Recent-Episode-Abschnitt einer Card
        ├── feedDetail.js       # Detail-Panel
        ├── feedDetailEpisodes.js
        ├── feedDetailHeader.js
        ├── episodeCard.js      # Episoden-Zeile (Timeline)
        ├── podcastDirectory.js # iTunes-Verlauf-Suche
        ├── showNotes.js        # Show Notes
        └── opml.js             # OPML Import/Export
```

---

## 2. Schichten und Abhängigkeiten

```
main.js (App-Boot)
  │  legt an, übergibt gemeinsames `app`
  ▼
Manager: config · state · elements · api · storage · theme · modal · playerUI
         · auth · feeds · playback · queue · sync · timeline · live
  │  greifen über this.app.<manager>  ineinander
  ▼
components/: Grid, Card, Detail, EpisodeCard …  (UI-Erzeugung)
  │
  ▼
css/components/*.css  (pro Komponente eine Datei)
```

Regeln:
- **Flache Abhängigkeiten:** Manager/Komponenten vernetzen über `this.app.<manager>.<method>()`,
  nie direkt untereinander (`this.grid` von einem anderen Manager aus ansprechen → über `this.app.feeds.grid`).
- **Ein Shared-Objekt pro Sache:** `state` (Daten), `elements` (DOM-IDs), `api`/`storage`
  (Infrastruktur) existieren einmal und werden abgeleitet.

---

## 3. Boot-Sequenz (startet in `main.js → app.init()`)

1. `theme.init()` — Theme anwenden.
2. `initApp()` — auth-first:
   - Session-Param aus URL ziehen (`auth.checkUrlSessionParam`)
   - Session validieren (`auth.checkAuth`)
   - Persistente Daten laden (`storage.loadFeeds`/`loadPositions`)
   - Cache + Queue befüllen
   - UI rendern (`timeline.*`, `feeds.renderFeedsGrid`)
3. `ensureLiveConnection()` — WebSocket öffnen (idempotent).
4. `wireAllEvents()` — Event-Listener aller Manager.
5. `playback.setupAudioEngines()`, `setupNetworkListeners()`, `refreshStaticUI()`,
   `initServiceWorker()`, `modal.initNavigationRoute()`.

Fehler während des Boots werden nicht verschluckt: 401/403 → Auth-Flow, sonst
Ladefehler-Banner (`handleBootError`).

---

## 4. Typischer Arbeitsablauf für eine Änderung

1. **Verstehen:** betroffene Komponente + zugehöriges `css/components/*.css` lokalisieren.
2. **Typ klären:** Instanz (A) oder Factory (B)? → `public/FRONTEND_COMPONENTS.md` Regel 1.
3. **Ändern:** nur die nötigen JS-Dateien + CSS-Datei (nie `dist/bundle.js`).
4. **Vernetzen:** über `this.app.<manager>`, Event-Site beachten (`FRONTEND_COMPONENTS.md` Regel 8).
5. **Bauen:** `npm run build` (esbuild → `public/dist/bundle.js`).
6. **Prüfen:** `npm run lint` (eslint). Bei Logik-Änderungen: `npm test` (`node --test`).
7. **Manuell testen:** `public/dev.html` im Browser (dev, nicht minifiziert).

---

## 5. Neue Komponente hinzufügen

1. Datei in `public/js/components/` anlegen (Name = was wird produziert).
2. Constructor nimmt `app` an, leitet `this.state`/`this.elements`/… ab
   (`FRONTEND_COMPONENTS.md` Regel 7).
3. Typ umsetzen: Instanz mit `this.el`+`update()`/`destroy()`, oder Factory
   mit `.render(id)` + Map im Grid/Manager (`FRONTEND_COMPONENTS.md` Regeln 2–4).
4. CSS in `public/css/components/<name>.css` anlegen und in `index.css` importieren.
5. Falls nötig: in `main.js` als Manager anlegen und in `wireAllEvents()` wiren.
6. Build + Lint + manueller Test (`dev.html`).

---

## 6. Build & Tests

| Befehl | Zweck |
| --- | --- |
| `npm run build` | Bundle aus `public/js/main.js` bundlen + minifizieren → `public/dist/bundle.js` |
| `npm run lint` | ESLint über `public/js` |
| `npm test` | Unit-Tests mit `node --test` (z. B. `live/LiveClient.test.js`) |
| `npm run dev` | Backend starten (Frontend wird dabei aus `dist` bedient) |

Hinweise:
- `public/dist/bundle.js` ist **generiert** — nie händisch editieren.
- Node läuft in dieser Umgebung unter `/home/mk/n/bin/node`.
- `node --check` / andere Node-Syntaxchecks nicht verwenden.

---

## 7. Konventionen

- ES-Module (`import`/`export`), kein CommonJS.
- Klassennamen `PascalCase`, Instanzen `camelCase`.
- Kommentare kurz und sachlich; kein Prosa.
- Keine Secrets/Keys im Frontend, keine Logs von Tokens.
- UI-Texte bilingual denkbar, aber Code sauber halten.
