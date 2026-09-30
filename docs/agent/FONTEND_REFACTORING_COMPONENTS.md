# Konzept: Frontend Refactoring zu einem Vanilla JS Component Pattern

## 1. Zielsetzung
Das aktuelle Frontend in `public/js/` weist eine starke Kopplung zwischen Geschäftslogik und UI auf. "Manager"-Klassen (z.B. `PlaybackManager`, `TimelineManager`, `QueueManager`) übernehmen sowohl die Datenverarbeitung als auch die direkte Manipulation des DOMs (z.B. Erstellen von HTML-Strings, Hinzufügen von Event-Listenern, Ändern von Klassen). Zudem ist die Navigationslogik fälschlicherweise in der `ModalManager`-Klasse untergebracht.

Das Ziel dieses Refactorings ist es, eine strikte Trennung nach dem **Service-Component-Pattern** zu etablieren:
- **Services:** Reine Logik-Einheiten (Daten, API, Audio-Engine, Storage, **Routing**), die keine Kenntnis vom DOM haben.
- **Components:** Reine UI-Einheiten, die den State visualisieren und Benutzerinteraktionen über Events an Services melden.

## 2. Kernprinzipien des neuen Patterns

### A. Kapselung (Encapsulation)
Jede Komponente verwaltet:
- Ihr eigenes **DOM-Element** (`this.el`).
- Ihre eigene **Template-Logik** (HTML-Generierung).
- Ihre eigenen **Event-Listener**.
- Ihren internen **Zustand** (sofern nicht globaler State).

### B. Lifecycle-Methoden
Alle Komponenten erben von einer `BaseComponent` und implementieren folgende Phasen:
- `constructor(app, props)`: Initialisierung, Übergabe von Abhängigkeiten (App-Instanz, Props).
- `render()`: Erzeugt das HTML-Template und gibt das DOM-Element zurück.
- `mount(parent)`: Fügt die Komponente in das DOM ein und initialisiert Event-Listener.
- `update(newProps)`: Reagiert auf Änderungen der Props oder des States und aktualisiert nur den notwendigen Teil des DOMs.
- `unmount()`: Entfernt die Komponente aus dem DOM und bereinigt alle Event-Listener/Timer (Memory Leak Prevention).

### C. Komposition (Composition)
Komponenten können andere Komponenten enthalten. Ein `FeedsGrid` besteht aus mehreren `FeedCard`-Komponenten. Die Hierarchie wird durch Verschachtelung im `render()`-Prozess aufgebaut.

### D. Datenfluss & Kommunikation
Um eine starre Kopplung zu vermeiden, nutzen wir zwei Wege:
1. **Top-Down (Props/State):** Eltern-Komponenten geben Daten über `update()` oder via Props an Kinder weiter.
2. **Bottom-Up (Events):** Kinder kommunizieren mit Eltern über **Custom Events**, die am `this.el` gefeuert werden (Event Bubbling). Dies hält Kinder völlig unabhängig von ihren Eltern.
3. **Cross-Component:** Für globale Änderungen (z.B. "Episode gestartet") wird der zentrale `AppState` genutzt, der über ein Observer-Pattern (Pub/Sub) Benachrichtigungen an interessierte Komponenten sendet.

## 3. Architektur-Struktur

### 3.1 Base Component (`BaseComponent.js`)
Die abstrakte Basisklasse definiert das Interface und bietet Hilfsmethoden für das DOM-Handling.

### 3.2 Komponententypen
Wir unterscheiden drei Kategorien:

| Typ | Beschreibung | Beispiele |
| :--- | :--- | :--- |
| **Layout Components** | Definieren die grobe Struktur der App. | `AppShell`, `Header`, `PlayerBar` |
| **Feature Components** | Implementieren komplexe Geschäftslogik/Views. | `FeedsGrid`, `Timeline`, `QueueView` |
| **Atomic/UI Components** | Kleine, wiederverwendbare Bausteine. | `Button`, `Modal`, `FeedCard`, `EpisodeRow` |

### 3.3 Trennung von Logik und UI
- **Services (ehemals Manager):** Bleiben für die reine Logik zuständig (z.B. `PlaybackService`, `SyncService`, `ApiClient`). Sie halten den State und führen API/Audio-Calls aus, haben aber **keinen Zugriff auf das DOM**.
- **Components:** Rufen Methoden der Services auf, aber sie *besitzen* keine Geschäftslogik. Sie sind lediglich die visuelle Repräsentation des States.

### 3.4 Router Service (`RouterService.js`)
Die zentrale Instanz für die App-Navigation. Er ist die "Single Source of Truth" für den aktuellen Standort des Benutzers.
- **Verantwortung:** Überwachung der URL/Hash, Verwaltung des Navigations-Stacks, Handling von `popstate`-Events.
- **Funktion:** Wenn eine Navigation stattfindet, informiert der Router die `AppShell` (via Event oder Observer), damit diese die entsprechende View austauscht.
- **Entkopplung:** Komponenten wie der `Header` oder `FeedCard` fordern keine DOM-Änderungen an, sondern rufen `router.navigate(route)` auf.

## 4. Implementierungs-Strategie (Phasenmodell)

### Phase 1: Foundation (Core Framework)
*Ziel: Das technische Fundament legen.*

1.  **`BaseComponent` Entwicklung:** Implementierung der abstrakten Klasse mit Lifecycle-Methoden.
2.  **State-Observer Integration:** Erweiterung von `AppState` um ein Subscription-Modell (`app.state.subscribe(path, callback)`).
3.  **`RouterService` Entwicklung:** Implementierung der zentralen Navigationslogik (Hash-Handling, History-Stack, Routing-Events).
4.  **Event-System:** Standardisierung der Kommunikation via `CustomEvent`.

### Phase 2: Shell & Layout (The Skeleton)
*Ziel: Die Grundstruktur der App als Komponentensystem etablieren.*

1.  **`AppShell` Komponente:** Der zentrale Container, der die Hauptbereiche (`Header`, `MainContent`, `PlayerBar`) verwaltet und auf Router-Events reagiert, um Views zu tauschen.
2.  **`HeaderComponent` Refactoring:** Umwandlung von `header.js` in eine reine UI-Komponente, die Navigation nur noch über den `RouterService` anfordert.
3.  **`PlayerBarComponent`:** Migration der `ui/player-ui.js` zu einer permanenten Layout-Komponente am unteren Rand.
4.  **`ModalComponent`:** Refactoring des `ModalManager` in eine reine Overlay-Komponente (ohne Navigationslogik).
5.  **`ThemeComponent`:** Migration des `ThemeManager` zur Steuerung globaler CSS-Variablen.

### Phase 3: Atomic Components (UI Building Blocks)
*Ziel: Kleine, wiederverwendbare Bausteine schaffen.*

1.  **UI-Elemente:** Implementierung von `Button`, `Input`, `Icon`, `Badge`, `Tab`, `Avatar` etc.
2.  **Status-Indikatoren:** Kleine Komponenten wie `OnlineOfflineBadge` oder `SyncStatusIndicator`.

### Phase 4: Service/Logic Extraction (Decoupling)
*Ziel: Die "Manager" von der UI befreien.*

1.  **DOM-Audit der Manager:** Identifikation aller Stellen in `PlaybackManager`, `AuthManager`, `FeedsManager` etc., an denen `document.querySelector`, `.innerHTML` oder `.classList` verwendet wird.
2.  **Extraction:** Diese Logik wird in die entsprechenden Komponenten verschoben. Der Manager liefert nur noch die Daten oder triggert den State.
3.  **Service-Transformation:** Umwandlung der Manager in reine Services, die keine Kenntnis über das DOM haben.

### Phase 5: Feature Migration (The Meat)
*Ziel: Die eigentliche App-Logik in das neue System überführen.*

1.  **Feeds Modul:** `FeedsGrid`, `FeedCard`, `PodcastDirectory`, `FeedDetailView`, `EpisodeCard`, `ShowNotes`.
2.  **Timeline Modul:** `TimelineView`, `TimelineItem`.
3.  **Queue Modul:** `QueueView`, `QueueItem`.

### Phase 6: Interaction & Advanced Features (The Brains)
*Ziel: Komplexe Interaktionen und Spezialfeatures integrieren.*

1.  **`PlaybackControls`:** Integration der Steuerungselemente innerhalb der `PlayerBar`.
2.  **`AuthFlowComponent`:** UI für Login/Registrierung.
3.  **`LiveConnectionComponent`:** Visualisierung des Live-Status.
4.  **`SettingsComponent`:** Die App-Einstellungen als eigenständige View.

### Phase 7: Final Polish & Optimization
*Ziel: Stabilität und Performance sicherstellen.*

1.  **Memory Leak Audit:** Verifizierung der korrekten `unmount()` Aufrufe (Event-Listener, Subscriptions).
2.  **Performance Tuning:** Optimierung des `update()` Mechanismus für flüssige UI-Reaktionen.
3.  **CSS Cleanup:** Sicherstellung, dass alle Styles komponentenbasiert und sauber strukturiert sind.

## 5. File-by-File Transformation Plan

### Services (Logic only, no DOM)
- `api.js` $\rightarrow$ `ApiService`: Handles all network requests.
- `auth.js` $\rightarrow$ `AuthService`: Manages session tokens, magic links, and authentication state.
- `config.js` $\rightarrow$ `Config`: Static configuration.
- `feeds.js` $\rightarrow$ `FeedsService`: Maintains feed data, handles fetching and synchronization logic.
- `helper.js` / `utils.js` $\rightarrow$ Utilities: Pure functions.
- `live/LiveClient.js` $\rightarrow$ `LiveService`: Manages WebSocket connection.
- `playback.js` $\rightarrow$ `PlaybackService`: Manages audio/YouTube engines and playback state.
- `queue.js` $\rightarrow$ `QueueService`: Manages the queue data structure and persistence.
- `router.js` (NEW) $\rightarrow$ `RouterService`: Central authority for URL/Hash and navigation history.
- `state.js` $\rightarrow$ `AppState`: Centralized state with observer pattern.
- `storage.js` $\rightarrow$ `StorageService`: Handles local storage and cache.
- `sync.js` $\rightarrow$ `SyncService`: Orchestrates synchronization between client and server.
- `timeline.js` $\rightarrow$ `TimelineService`: Handles sorting, filtering, and processing of episode lists.

### Components (UI only, manages its own DOM)
- `header.js` $\rightarrow$ `HeaderComponent`: Top navigation and search.
- `ui/modal.js` $\rightarrow$ `ModalComponent`: Generic overlay system (**Navigation logic removed**).
- `ui/player-ui.js` $\rightarrow$ `PlayerBarComponent`: Persistent bottom playback bar.
- `ui/theme.js` $\rightarrow$ `ThemeComponent`: Manages visual themes via CSS variables.
- `components/feedCard.js` $\rightarrow$ `FeedCardComponent`: Individual feed card.
- `components/feedCardRecent.js` $\rightarrow$ `FeedCardRecentComponent`: Recent episodes section within a feed card.
- `components/feedDetail.js` $\rightarrow$ `FeedDetailComponent`: Main view for a single feed.
- `components/feedDetailEpisodes.js` $\rightarrow$ `FeedDetailEpisodesComponent`: List of episodes in a feed detail view.
- `components/feedDetailHeader.js` $\rightarrow$ `FeedDetailHeaderComponent`: Header part of the feed detail view.
- `components/episodeCard.js` $\rightarrow$ `EpisodeCardComponent`: Individual episode card.
- `components/feedsGrid.js` $\rightarrow$ `FeedsGridComponent`: Grid of feed cards.
- `components/opml.js` $\rightarrow$ `OpmlComponent`: UI for OPML import/export.
- `components/podcastDirectory.js` $\rightarrow$ `PodcastDirectoryComponent`: Search and discovery UI.
- `components/showNotes.js` $\rightarrow` `ShowNotesComponent`: Modal/Overlay for episode notes.
- `timeline.js` (partially) $\rightarrow$ `TimelineComponent`: The main timeline view.
- `queue.js` (partially) $\rightarrow$ `QueueComponent`: The queue modal/view.
- `auth.js` (partially) $\rightarrow$ `AuthComponent`: The login/registration UI.

### To be removed
- `dom.js`: Replaced by component-local DOM management.

## 6. Shell-Prinzip: Leerer HTML-Body (entscheidend)

### 6.1 Die Regel
- `dev.html` **und** `index.html` haben einen **praktisch leeren `<body>`**.
- Der Body enthält **kein** semantisches App-Markup mehr (keine Header-, Tab-,
  Modal-, Player-Struktur). Alles wird aus den Komponenten heraus gerendert.
- Der Body liefert nur noch einen **Mount-Root** (ein `<div id="app">`) und die
  globalen Nicht-UI-Ressourcen:
  - `<audio id="audio-engine">` (Native-Audio-Element, bleibt als Ressource).
  - ggf. der versteckte YouTube-Player-Container (als externer Dienst, nicht als
    UI-Komponente).
- Der `<head>` bleibt für Meta, Fonts, Manifest, Icon und CSS-Imports zuständig.

### 6.2 Zielzustand des Bodies
```html
<body>
  <div id="app"><!-- von AppShell gerendert --></div>

  <!-- Nur noch Nicht-UI-Ressourcen -->
  <audio id="audio-engine" preload="auto"></audio>
  <div id="yt-player-container" hidden><!-- YouTube-Fallback --></div>
</body>
```
- Kein `id`/`class`-Wracker mehr für Header/Tabs/Modals/Player im HTML.
- `main.js` instantiiert `AppShell` und ruft `shell.mount(document.getElementById('app'))`
  auf. Die Komponente baut die komplette Struktur (`AppShell` → `Header`,
  `MainContent`/Views, `PlayerBar`).

### 6.3 Warum
- **Einzigartige Eigentumsquelle:** Das DOM gehört den Components, nicht statischem
  HTML. Keine Doppelung von Struktur (HTML + Component-Template).
- **Konsistente Migration:** Bestehende `dev.html`-Elemente (`#player-bar`,
  `#feeds-grid`, `#auth-modal`, Tabs etc.) werden nacheinander durch ihre Komponenten
  ersetzt; der Body schrumpft schrittweise.
- **Routing-freundlich:** Views werden vom Router/AppShell getauscht, nicht über
  statische `tab-panel`-Sichtbarkeit.

### 6.4 Migration des Bodies
- `index.html` (Produktion) und `dev.html` (Dev) **gleichartig** leer halten; nur
  Unterschiede (z. B. Minifizierung, Dev-Only-Scripts) bleiben.
- Solange eine Struktur noch keine Komponente hat, bleibt ihr Platzhalter als
  **leerer Container** mit fester ID/ Klasse bestehen (z. B. `<div id="feeds-grid">`),
  den die Komponente befüllt. Sobald die Komponente die Struktur selbst baut, fällt der
  Platzhalter weg.
- Ziel: am Ende steht nur noch `#app`-Root + Audio/YT-Ressourcen.

### 6.5 Abgrenzung
- **Bleibt im HTML:** `<head>`-Meta/Fonts/CSS, `<audio>`, externer YT-Container.
- **Wandert in Components:** alles Sichtbare/Interaktive (Header, Tabs, Panels, Modals,
  Player, Dock, Badges).

---

## 7. DOM-Zugriff: Kein Browser-Selector (entscheidend)

### 7.1 Verbotene Funktionen
In Components (und Services ohnehin) sind **alle** Selector-Funktionen des Browsers
verboten:
- `document.getElementById(...)`
- `document.getElementsByClassName(...)`
- `document.getElementsByTagName(...)`
- `document.querySelector(...)` / `document.querySelectorAll(...)`
- `element.querySelector(...)` / `element.querySelectorAll(...)` auf beliebigen Bäumen

Auch `document.getElementById`/`querySelector` über `this.app`-Wurzeln oder globale
`document`-Suche ist verboten.

### 7.2 Die Regel: `this.el<Name>`
Jedes Element, das eine Komponente **aktualisiert** (Text, Klasse, SRC, Status),
existiert in der Komponente als direkte Referenz:
```javascript
this.elTitle;      // z. B. Player-Titel
this.elGrid;       // z. B. Feed-Grid
this.elPlayButton; // einzelner, wiederverwendbarer Knoten
```
- Diese Referenzen werden im `render()`/Constructor aus dem **eigenen** Baum
  gewonnen und gespeichert.
- Updates laufen über die Referenz: `this.elTitle.textContent = ...`,
  `this.elPlayButton.classList.toggle('active', ...)`.
- Event-Listener werden an den gespeicherten Referenzen gebunden, nicht nach Selektor.

### 7.3 Was erlaubt ist
- Referenzen aus dem **eigenen** `this.el`-Baum holen, aber **einmalig** beim Bauen
  (nicht bei jedem Update erneut suchen):
  ```javascript
  this.elTitle = this.el.querySelector('.title'); // nur beim Aufbau, lokal begrenzt
  ```
  Auch dies ist nur akzeptiert, wenn das Element fest zum Template der Komponente
  gehört und nie per CSS-Klasse/ID „gesucht" werden muss. Ideal: Elemente über
  `createElement`/Referenzierung direkt anlegen, dann gibt es gar kein `querySelector`.
- Auf **fremden** Bäumen (`document`, `this.app.*`, andere Components) niemals suchen.

### 7.4 Begründung
- **Stabilität:** Keine Laufzeitabhängigkeit von CSS-Klassen oder IDs, die sich ändern
  können. Die Referenz zeigt garantiert auf das richtige Element.
- **Performance:** Kein wiederholtes Durchsuchen des DOMs bei jedem Update.
- **Kapselung:** Die Komponente kennt und verwaltet nur ihren eigenen Baum; sie ist
  unabhängig von globalem Markup und anderen Components.
- **Debuggbarkeit/Refactoring:** Element-Identität ist im Code sichtbar
  (`this.elTitle`), nicht in Selektor-Strings versteckt.

### 7.5 Muster bei Listen/Items
- Items/Zeilen/Karten werden über **Maps von Referenzen** verwaltet
  (`this.items.get(id).el`), nicht über `querySelectorAll('.row')`.
- Dynamisch hinzugefügte Elemente behalten ihre Referenz; sie werden nicht erneut
  per Selektor geholt.

### 7.6 Audit
- Bestehende Dateien (`header.js`, `player-ui.js`, `components/*.js`, `ui/*.js`) nach
  `getElementById`, `getElementsByClassName`, `querySelector` durchsuchen.
- Jede Fundstelle durch eine `this.el<Name>`-Referenz ersetzen; verbleibende Selectoren
  nur dort, wo sie einmalig beim Template-Aufbau lokal an `this.el` gebunden sind.

---

## 8. Beispiel: Eine einfache Komponente

```javascript
import { BaseComponent } from './BaseComponent.js';

export class PlayButton extends BaseComponent {
    constructor(app, { episodeId }) {
        super(app, { episodeId });
    }

    render() {
        const btn = document.createElement('button');
        btn.className = 'play-button';
        btn.innerHTML = `<svg>...</svg>`;
        return btn;
    }

    mount() {
        this.el.addEventListener('click', () => {
            // Kommunikation nach oben via Event
            this.el.dispatchEvent(new CustomEvent('play-requested', {
                bubbles: true,
                detail: { episodeId: this.props.episodeId }
            }));
        });
    }
}
```

---

## 7. State-Strategie & Unidirektionalität

### 7.1 Single Source of Truth
- `AppState` (`state.js`) ist die **einzige** mutierbare Quelle. Components schreiben
  nie direkt ins DOM als „Speicher" für Logik-Daten; der visuelle Zustand ist immer
  eine Projektion von `app.state`.
- Mutationen laufen zentral über Service-Methoden, z. B.
  `app.playback.play(episode)` → ändert `app.state.currentEpisode`/`playbackStatus`.
- Components **lesen** den State und **triggern** Aktionen, sie **mutieren** ihn nicht
  direkt (außer lokalem UI-Zustand wie `collapsed`, der nicht global ist).

### 7.2 Unidirektionaler Datenfluss
```
Service (Action) → AppState (State) → Component (Render) → User-Event → Service (Action) → ...
```
- Vermeide zirkuläre Ketten: Component → Service → State → Component ohne User-Input.
- Ein Event-Handler ruft eine Service-Aktion auf; der daraus resultierende State-Change
  löst via Subscription das Re-Render aus. Zwischenstep ist **immer** der State.

### 7.3 Observer / Subscription
- `AppState` wird um ein Subscription-Modell erweitert:
  ```javascript
  const unsub = app.state.subscribe('playback.current', (episode, prev) => {
      playerBar.update(episode);
  });
  // in unmount(): unsub();
  ```
- Path-Syntax: `'playback.current'`, `'feeds.0.downloading'`, `'*'` (alles) oder
  `'feeds.*'` (alle Elemente eines Arrays). Arrays/Objekte werden tief verglichen.
- **Diffing statt Full-ReRender:** `update()` rendert nur, wenn sich der subscribed
  Pfad tatsächlich geändert hat (Tiefenvergleich oder `version`-Inkrement pro Path).
- Subscriptions werden **immer** in `unmount()` aufgelöst (siehe §9).

### 7.4 Lokaler vs. globaler Zustand
- **Global** (in `AppState`): alles, was mehrere Components/Views betrifft
  (`currentEpisode`, `queue`, `searchQuery`, `sortOrder`, `filterMode`, `navHistory`).
- **Lokal** (in der Komponente, z. B. `this._open = true`): reine UI-Zustände
  (`collapsed`, `expandedRow`, `modalOpen`, `inputValue`), die nichts mit globaler
  Logik zu tun haben.

---

## 8. Dependency Injection / App-Container

### 8.1 `app` als Injektionspunkt
- Jede Komponente/Service bekommt im Constructor das `app`-Objekt übergeben
  (`constructor(app, props)`). `app` ist der zentrale Container/Registry.
- Bewährte Ableitungen (bestehende Konvention):
  ```javascript
  constructor(app, props = {}) {
      super(app, props);
      this.state = app.state;
      this.api = app.api;
      this.storage = app.storage;
      this.config = app.config;
  }
  ```

### 8.2 Zugriff auf andere Features
- **Services/Components greifen über `app` auf andere zu**, nie direkt vernetzt:
  `app.playback.play(id)`, `app.feeds.openFeedDetail(id)`, `app.router.navigate(...)`.
- Das hält die Graphen flach und die Instanzierung zentral in `main.js`.
- `main.js` ist die **einzige** Stelle, die Services/Components instantiiert und an
  `app` registriert (`app.playback = new PlaybackService(app)`). Components/Services
  kennen sich untereinander nicht durch Import.

### 8.3 Lebensdauer der Abhängigkeiten
- Services sind Singletons pro `app`-Instanz.
- Components werden je nach Typ einmal angelegt (Layout/Feature) oder pro Item
  (Atomic) und über Maps verwaltet (siehe `FRONTEND_COMPONENTS.md` Regel 3/4).

---

## 9. Router-Definition

### 9.1 Route als Datenstruktur
- Router-Tabellen-Form, nicht `if/else`-Ketten:
  ```javascript
  // router.js
  const ROUTES = [
    { name: 'timeline',  path: '/',        view: 'TimelineView' },
    { name: 'feeds',     path: '/feeds',   view: 'FeedsView' },
    { name: 'feed',      path: '/feed/:id', view: 'FeedDetailView' },
    { name: 'queue',     path: '/queue',   view: 'QueueView' },
    { name: 'settings',  path: '/settings', view: 'SettingsView' }
  ];
  ```
- `match(pathname)` → `{ route, params }` oder `null`. `:id` wird in `params`
  aufgelöst.

### 9.2 Hash- vs. History-API
- Empfehlung: **Hash-Routing** (`#/feed/123`), da die App serverseitig statisch
  gerendert wird und Hash-Navigation kein Server-Reload auslöst.
- Optional History-API nur bei serverseitigem Fallback (`fallback`-Route). Entscheidung
  dokumentieren; konsistent die ganze App hindurch.

### 9.3 Verantwortung
- Überwachung: `hashchange` (und bei History-API `popstate`).
- Single Source of Truth für den aktuellen Standort; `navHistory`-Stack für
  Rück-Navigation (Anknüpfung an `app.state.navHistory`).
- Navigation **anfordern**, nicht DOM ändern: `router.navigate('/feed/123')` löst ein
  `routechange`-Event aus; `AppShell` tauscht die View.

### 9.4 Guards
- Route-Guards als Prädikate pro Route, z. B. `auth: true` → nicht-authentisierte
  Nutzer auf Login leiten (`app.auth.isAuthenticated()`).
- Guards laufen vor dem View-Swap; bei Blockierung wird auf eine Default-/
  Error-Route umgeleitet.

### 9.5 popstate-Handling
- Beim Zurück-Navigieren den Stack (`navHistory`) korrekt reduzieren; kein doppeltes
  Pushen bei programmatischer Navigation.
- `navigate()` pusht nur bei echter Forward-Navigation, nicht bei `popstate`.

---

## 10. Async- & Error-Handling in Components

### 10.1 Zustand-Maschine pro Feature-View
Jede ansichtsbezogene Komponente durchläuft explizite Zustände:
```
idle → loading → success | error
```
- Repräsentiert über `app.state`-Flagge(n) oder lokalen Zustand
  (`this._status ∈ ['idle','loading','error','success']`).
- Jeder Zustand hat ein definiertes UI-Skelett (Skeleton beim `loading`,
  Fehlerbanner beim `error`, Leerzustand bei 0 Einträgen).

### 10.2 Fehlermodell
- `error` trägt Message + optional `code`/`status`; Components zeigen eine
  benutzerfreundliche Meldung mit Retry-Aktion.
- Fehler werden **nicht** geschluckt: `catch` → State auf `error` + optional Logging
  über `app` (kein direktes `console.error` in Components für produktive Fehler).

### 10.3 Abbrechbare Requests
- Jeder async Aufruf führt ein `AbortController` (oder Token), das in `unmount()`
  oder bei Props-/Route-Wechsel abgebrochen wird, um Race Conditions und Writes nach
  `unmount` zu vermeiden.
- Pattern:
  ```javascript
  async load() {
      this.abort?.abort();
      const ctrl = new AbortController();
      this.abort = ctrl;
      this.setStatus('loading');
      try {
          const data = await this.api.get(path, { signal: ctrl.signal });
          if (ctrl.signal.aborted) return;
          this.setData(data);
          this.setStatus('success');
      } catch (e) {
          if (ctrl.signal.aborted) return; // ignoriert
          this.setError(e);
      }
  }
  unmount() { this.abort?.abort(); }
  ```

### 10.4 Backoff / Limits
- Bekannte API-Limits (z. B. Batch-Limits) über exponentielles Backoff + Retry mit
  Cap; in Services, nicht in Components.

---

## 11. Testbarkeit

### 11.1 Services = pure/testbar
- Services enthalten keine DOM-Logik und sind deshalb mit `node --test` testbar
  (Bestand: z. B. `live/LiveClient.test.js`).
- Tests simulieren Abhängigkeiten über injizierte Mocks (`app.api`/`app.storage` als
  Fake), nie echtes DOM.

### 11.2 Components = UI-Tests
- Components gegen jsDOM testen (Render → Event → erwarteter State/Service-Aufruf).
- Prüfen: Event-Feuerung (`CustomEvent`), Subscription-Verhalten, `unmount()`-
  Bereinigung.
- Entscheidung: jsDOM-Runner (z. B. `@jsdom`/`happy-dom`) vs. Event-Spying in
  `node --test`. Dokumentieren.

### 11.3 Router = Logik-Test
- `match()`/`navigate()`/Guards als reine Logik testbar, kein DOM nötig.

---

## 12. Migration & Backward-Compliance

### 12.1 Inkrementell, nach jedem Schritt lauffähig
- Immer **eine** Komponente/Service pro Schritt; nach jedem Schritt `build` + `lint`
  grün (siehe `FRONTEND_COMPONENTS.md` Phase 11).
- Alte Manager bleiben bis zur Migration funktionsfähig; neue Components werden
  parallel eingebunden.

### 12.2 Laden ohne Build-Stau
- `public/dist/bundle.js` wird via esbuild generiert und **nie händisch** bearbeitet
  (AGENTS.md). Components werden als ES-Module importiert; der Build bündelt sie.
- Für die Dev-Verwendung: `public/dev.html` lädt die Module nicht-minifiziert.

### 12.3 Boot-Reihenfolge
- Services zuerst instantieren und an `app` registrieren, dann Components.
- Bestehende Reihenfolge beibehalten: `initApp` → `ensureLiveConnection` →
  `wireAllEvents`; Router-Service früh registrieren, da Components ihn von Beginn an
  über `app.router` nutzen.

### 12.4 CSS-Import
- Neue Komponente → CSS in `public/css/components/<name>.css`, in
  `public/css/index.css` importieren, Tokens aus `variables.css` nutzen
  (siehe `FRONTEND_COMPONENTS.md` Phase 4).

---

## 13. Memory-Leak-Regeln

### 13.1 Goldene Regel
Jeder Listener/Subscription/Timer/Abort, der in `mount()`/Constructor angelegt wird,
hat ein Gegenstück in `unmount()`. Kein „anlegen ohne Aufräumen".

### 13.2 Bereinigungs-Katalog
- **Event-Listener:** alle in `unmount()` über `this.el.removeEventListener(...)`.
  Lieber im Scope von `this.el` binden (nicht global auf `document`/`window`), damit
  `unmount()` alles in einem Zug erfasst.
- **Subscriptions:** `unsub()` aus `app.state.subscribe(...)` in `unmount()` aufrufen.
- **Timer/Intervalle:** `clearInterval`/`clearTimeout` (z. B. `sleepTimer.intervalId`).
- **Async/Abort:** `abort()` des aktuellen `AbortController`.
- **Flags:** `this._mounted = false` setzen, um Writes nach `unmount` zu blockieren.

### 13.3 Delegating statt global
- Event-Listener am `this.el` mit `{ passive: true }` wo möglich; bei Listen
  Event-Delegation am Container statt Listener pro Item.

### 13.4 Audit (Phase 7)
- `unmount()` systematisch gegen `addEventListener`/`subscribe`/`setInterval`/
  `setTimeout`/`AbortController` in der Komponente prüfen.

---

## 14. Styling-Strategie

### 14.1 Trennung Global vs. Komponente
- **Global/Tokens:** CSS-Variablen in `variables.css`; `ThemeComponent` steuert
  Theme-relevante Variablen (Farben, Kontrast) über `:root`/Data-Attribut.
- **Komponente:** pro Komponente eine Datei `public/css/components/<name>.css`;
  Klassennamen BEM-ähnlich (`block__element--modifier`).

### 14.2 Keine Style-Hardcodes in JS
- Klassen statt inline-Styles; dynamische Werte (z. B. Fortschritt) über CSS-Variable
  (`el.style.setProperty('--p', pct)`) oder eigene Klasse.

### 14.3 Responsive
- Änderungen gegen `responsive.css` prüfen; Mobile-First beibehalten.

### 14.4 Zugänglichkeit
- Semantische Elemente (`<button>`, `<nav>`, `<ul>`) und ARIA nur wo nötig;
  Focus-Management beim View-Swap und in Overlays (`ModalComponent`).

---

## 15. Shell-Cleanup / Restaufgabe nach Phase 7 (Ziel: leerer Body nach §6)

> Status: Phasen 1–7 aus §4 sind abgearbeitet. Dieser Abschnitt beschreibt die
> **Nacharbeit nach Phase 7**, die noch **nicht** in §4 als Phase gelistet ist.
> Ziel ist der praktisch leere Body nach §6.2 (`#app`-Root + `<audio>` + YT-Container,
> alles Sichtbare von Components gerendert).

### 15.1 Aktueller Zustand (Dual-System)
- Die Component-Shell (`AppShell`) ist gemountet, aber nur **teilweise aktiv**:
  - **Aktiv:** `PlayerBarComponent` (Legacy-`#player-bar`/`#player-mini` per CSS aus),
    die router-getriebene `viewArea` (.app-shell-view) ist Content-Bereich;
    statische `.tab-panel` per `.shell-active` ausgeblendet.
  - **Inert/versteckt:** `HeaderComponent` (`.app-shell__header { display:none }`).
- **Legacy-Manager treiben parallel verstecktes statisches DOM** ( gecacht in
  `dom.js`/`Elements`): `ModalService` (Add-/Sleep-/Confirm-/Queue-Modal, Status-Banner),
  `TimelineService` (Dock-Counts `#continue-count`/`#played-count`, Continue-Shelf,
  Empty-State/Quick-Add), `QueueService` (Queue-Modal/-Badge), `FeedsService`
  (Add-/Confirm-Modal, `wireEvents`), `PlayerUI` (Collapse/Expand).
- `dom.js` (`Elements`) cachevt alle statischen Refs; `app.elements` ist die
  zentrale Referenz der Legacy-Schicht.

### 15.2 Zielzustand
- `dev.html` **und** `index.html` Body nur noch: `<div id="app">` + `<audio id="audio-engine">`
  (+ YT-Container). Kein semantisches Markup mehr (kein Header/Tabs/Dock/Modals/Player).
- `main.js` instantiiert `AppShell` und mountet es auf `#app`.
- `dom.js`/`Elements` und `app.elements` entfallen (nach R8).

### 15.3 Teilaufgaben (Reihenfolge = Risiko aufwärts)
Jede R-X wird zuerst als neue Component aktiviert, Legacy per CSS-Toggle ausgeblendet,
manuell im Browser verifiziert und erst danach entfernt (inkrementell, immer-lauffähig,
§12.1).

1. **R1 Header:** `HeaderComponent` aktivieren (`.app-shell__header {display:none}` weg),
   statischen `<header>` entfernen, `ModalService.wireTabs` + `FeedsService.updateFeedCountUI`
   (feed-count) auf Component umstellen.
2. **R2 Dock:** `DockComponent` (`.chip-filter`, `#sort-order`, `#btn-refresh-all`,
   Dock-Suche) anlegen; `TimelineService.updateFilterBadges`/`wireEvents`/`updateDockVisibility`
   (Dock-Counts) entfernen; `<aside bottom-action-dock>` löschen.
3. **R3 Continue-Shelf:** Continue-Shelf in `TimelineView`/eigene Component verschieben;
   `TimelineService.renderContinueShelf`-DOM entfernen.
4. **R4 Empty-State/Quick-Add:** Onboarding-Card + Quick-Add-Form + Category-Chips +
   OPML-Trigger in `TimelineView`; `renderTimeline`-Empty-Wiring entfernen.
5. **R5 Modal-System:** `AddFeedComponent`, `SleepTimerComponent`, `ConfirmModalComponent`,
   `QueueModalComponent`, `StatusComponent` anlegen; statische Modals + `ModalService`-DOM-
   Methoden (`openAddModal`/`closeAddModal`, `openSleepModal`/`closeSleepModal`,
   `showConfirm`/`closeConfirm`, `wireSleepTimerButtons`, `wireAddModalButtons`,
   `wireConfirmModal`, `wireClearStorage`, `wireEscapeKey`, `resetAll`-DOM) entfernen.
   **Abweichung von §5:** diese Components liegen außerhalb der dortigen Component-Liste
   und müssen hiermit ausdrücklich ergänzt werden.
6. **R6 PlayerBar:** `PlayerUI`-Collapse/Expand in `PlayerBarComponent` folden;
   Legacy-`#player-mini` endgültig entfernen.
7. **R7 Auth:** `AuthFlowComponent` ist bereits Owner; statisches `#auth-modal` +
   `dom.js`-Auth-Refs + `ModalService.showAuthModal`-Fallback entfernen.
8. **R8 `dom.js`/`Elements` entfernen:** `Elements`-Klasse + `app.elements` + alle
   `elements.*`-Referenzen streiten — **nur nach R1–R7**, sonst bricht alles.
   Restliche `g(id)`-Nutzungen (Audio-Engine, YT-Engine) als begründete Engine-Ref behalten.
9. **R9 HTML leeren:** beide Body auf `#app` + `<audio>` + YT-Container reduzieren;
   `main.js` mountet `AppShell` auf `#app`.
10. **R10 CSS cleanup:** veraltete Legacy-Regeln (`.app-shell__header`,
    `#player-bar`/`#player-mini`, `.shell-active .tab-panel`) + orphaned statisches CSS entfernen.

### 15.4 Absicherung pro Schritt
- **Kein Browser-Test verfügbar** → R1–R7 manuell im Browser verifizieren, bevor
  statisches DOM entfernt wird (ohne Browser-Check riskant). R8–R9 erst am Ende, atomar.
- Pro Schritt: `npm run build` (exit 0) + `npm run lint` (exit 0) + manueller Browser-Check
  der migrierten Feature.
- R8 (dom.js) und R9 (HTML) erst nach erfolgreichem R1–R7; R10 folgt nach R9.

### 15.5 Offene Entscheidung
- R5 führt neue Components außerhalb §5 ein → in §5 Component-Liste ergänzen
  (`DockComponent`, `ShelfComponent`, `AddFeedComponent`, `SleepTimerComponent`,
  `ConfirmModalComponent`, `QueueModalComponent`, `StatusComponent`).
