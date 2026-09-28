# FRONTEND_COMPONENTS.md

Regeln für die Architektur von Frontend-Komponenten in `public/js`. Abstrakt
gehalten, so sie auf alle Komponenten/Ordner von `public/` übertragbar sind.

---

## 1. Grundentscheidung: Instanz oder Factory?

Bevor eine Komponente geschrieben wird, ist der Typ festzulegen. Die Frage:
**Ist die Klasse eine echte Komponente (Instanz) oder ein Renderer/Fabrik, der
Komponenten erzeugt?**

### Muster A — Echte Component-Instanz
- `new Component(app, id)` baut **ein** eigenes DOM-Element und speichert es als `this.el`.
- Das Objekt besitzt das Element mit fester Identität.
- Das Objekt kann sich selbst `update()`/`destroy()`.
- Jede Instanz = ein Item (eine Card, ein Episode, ein Row).

### Muster B — Factory / Renderer
- `new Renderer(app)` wird **einmal** angelegt.
- `.render(id)` (oder ähnlich) liefert bei jedem Aufruf einen **neuen**, zustandslosen
  DOM-Knoten zurück.
- Die Klasse ist keine Komponente, sie erzeugt nur Knoten.
- Die Identität liegt in einer Map des Managers/Grid, nicht im Knoten selbst.

### Entscheidungshilfe
| Signal | Muster |
| --- | --- |
| Item braucht eigenen Lebenslauf (update/destroy), lokalen Zustand oder eigenen Event-Site | **A – Instanz** |
| Items werden billig zentral neu gerendert, Zustand bleibt zentral | **B – Factory** |
| „Eine unter vielen" sichtbaren Karten/Zeilen | meist **A** |
| „Hilfsklasse, die X produziert" | meist **B** |

> In `public/js/components/feedCard.js` war es Muster B (`FeedCard` = Renderer,
> `renderFeedCard(id)` liefert den Knoten). Wunsch der Architektur: Umstellung auf
> Muster A — `new FeedCard(app, id)` = eine echte Card, Factory im Grid/Manager.

---

## 2. DOM-Eigentum (der entscheidende Faktor)

- **Instanz (A):** Das Objekt *besitzt* genau einen Knoten (`this.el`). Der Knoten
  ist stabil, wiederverwendbar, hat eine Identität über Zeit.
- **Factory (B):** Der Knoten ist ephemeral — wird bei Bedarf neu erzeugt, hat keine
  dauerhafte Identität außerhalb der Sammlung, die ihn hält.

Regel: Wenn ein Element über mehrere Aufrufe hinweg gleich bleiben soll
(Event-Listener, Scroll-Position, Fokus), muss es eine Instanz (A) sein.

---

## 3. Wer legt die Instanzen an = die Factory

- Die Sammlung/Manager, die `new Component()` für viele Items ausführt, **ist die
  Factory**.
- Der Orchestrator (z. B. `feeds.js`) *steuert* nur (`createCard`/`updateCard`), er
  **ist nicht** die Factory.
- Factory und Item-Klasse sind getrennt: `FeedCards` (Factory) ↔ `FeedCard` (Instanz).

---

## 4. Map-Inhalt folgt dem Muster

- **Muster A:** Map speichert die Objekte selbst → `cards.get(id).update()`.
- **Muster B:** Map speichert Snapshots → `{ el, els }` (oder nur `el`).

Die Map ist der einzige Ort, an dem die Identität der Items liegt.

---

## 5. Dateiname vs. Klassenname

- **Dateiname** beschreibt, *was* produziert wird → `feedCard.js` (erzeugt Cards).
- **Klassenname** drückt den *Typ* aus:
  - Factory/Renderer → `...Renderer`, `...Factory`, `...Grid`
  - Echte Komponente → `Card`, `Episode`, `Row`
- Name muss nicht zur Datei passen. Vermeide einen Klassennamen, der eine Instanz
  vorgibt, die aber ein Renderer ist (oder umgekehrt).

---

## 6. Unterteilung in eigene Renderer

Teilbereiche einer Komponente sind eigene Renderer-Klassen, die die Komponente
einbindet — auch sie sind keine Komponenten selbst.

- Beispiel: `feedCardRecent.js` = Renderer nur für den Recent-Episode-Abschnitt,
  eingebunden in `feedCard.js` via `new FeedCardRecent(this.app)`.
- Regel: Ein Renderer bekommt immer das gemeinsame `app` übergeben, nie Rohdaten.

---

## 7. Das gemeinsame `app`-Konvention

Jede Manager-/Komponenten-Klasse:
- nimmt im Constructor das `app`-Objekt an (`constructor(app)`),
- leitet ab: `this.state`, `this.elements`, `this.config`, `this.api`, `this.storage`.
- Greift über `this.app.<manager>.<method>()` auf andere Features zu
  (z. B. `this.app.feeds.openFeedDetail(id)`), nie direkt vernetzt.

Dies hält die Abhängigkeiten flach und die Instanzierung zentral in `main.js`.

---

## 8. Event-Site und Interaktion

- Handler referenzieren `this.app` (nicht die Eltern-Klasse), damit die Instanz
  unabhängig bleibt.
- Stoppropagation bewusst setzen, wenn ein Parent-Handler zur gleichen Zeit feuert
  (z. B. Card-Klick → Detail, aber Button → Aktion):
  `if (e.target.closest('.btn-action')) return;` vor der Parent-Aktion.
- Dynamisch erzeugte Knoten (Muster B) erhalten ihre Handler beim Erzeugen;
  Instanzen (A) können sie im Constructor binden.

---

## 9. Checkliste beim Hinzufügen einer neuen Komponente

1. Typ bestimmen: Instanz (A) oder Factory (B)? (Regel 1 + Entscheidungshilfe)
2. Dateiname = was wird produziert; Klassenname = der Typ (Regel 5).
3. Constructor nimmt `app` an, leitet Shared-Objekte ab (Regel 7).
4. Bei Instanz: `this.el` setzen, `update()`/`destroy()` anbieten (Regel 2).
5. Factory: Erzeugung + Speicherung in einer Map des Managers/Grid (Regel 3/4).
6. Handler über `this.app.<manager>` vernetzen (Regel 7/8).
7. Build (`npm run build`) und Lint (`npm run lint`) ausführen.

---

## 10. Arbeitsablauf in Phasen (Frontend)

Ein wiederkehrender Phasenplan für das Arbeiten an `public/js` + `public/css`.
Kann auch für Änderungen an bestehenden Komponenten verwendet werden (ab Phase 1
oder 2 einsteigen, wenn nur ein Teil betroffen ist).

### Phase 0 — Bestandsaufnahme
- Betroffene Komponente + zugehöriges `css/components/*.css` lokalisieren.
- Datenfluss nachzeichnen: Wer liefert die Daten? (`state`, `api`, `storage`)
  Und wer ruft die Komponente auf? (`main.js` → Manager → `components/`).
- Prüfen, ob ein ähnlicher Typ schon existiert (Wiederholung vermeiden).

### Phase 1 — Typ & Schnittstelle festlegen
- Instanz (A) oder Factory (B) bestimmen → Regel 1 + Entscheidungshilfe.
- Constructor-Signatur festlegen: `constructor(app)` + nötige Parameter (z. B. `id`).
- Schnittstelle definieren: öffentliche Methoden (`render`/`update`/`destroy`,
  oder `createCard`/`updateCard` bei Factory).

### Phase 2 — Datenfluss & Zustand
- Festlegen, welche Daten die Komponente braucht und wie sie reinfließen
  (`this.state.*`, `this.api.*`, Callbacks über `this.app.*`).
- Bei Instanz: entscheiden, was Zustand ist (`this.el` stabil) vs. neu gerendert.
- Identität der Items klären → Map-Inhalt festlegen (Regel 3/4).

### Phase 3 — Implementierung (JS)
- Datei in `public/js/components/` anlegen (Name = Produkt, Regel 5).
- Constructor: `app` annehmen, Shared-Objekte ableiten (Regel 7).
- Instanz: `this.el` bauen + Handler binden; Factory: `.render(id)` + Map.
- Networking/Interaktion immer über `this.app.<manager>.<method>()` (Regel 7/8).
- Stoppropagation bewusst setzen bei überlagernden Clicks (Regel 8).

### Phase 4 — Styling
- CSS in `public/css/components/<name>.css` anlegen (pro Komponente eine Datei).
- In `public/css/index.css` importieren; Tokens aus `variables.css` nutzen.
- Responsive-Verhalten gegen `responsive.css` prüfen.

### Phase 5 — Vernetzung & Boot
- Bei neuem Manager: in `main.js` anlegen, `app` übergeben.
- Events in `wireAllEvents()` wiren.
- Boot-Reihenfolge beachten (`initApp` → `ensureLiveConnection` → `wireAllEvents`).

### Phase 6 — Build & Qualität
- `npm run build` (esbuild → `public/dist/bundle.js`).
- `npm run lint` (eslint über `public/js`).
- Bei Logik: `npm test` (`node --test`, z. B. `live/LiveClient.test.js`).
- `public/dist/bundle.js` bleibt generiert, nie händisch bearbeiten.

### Phase 7 — Maneller Test
- `public/dev.html` im Browser (dev, nicht minifiziert).
- Szenario abarbeiten: Render, Interaktion, Fehlerzustand, Leerezustand.
- Im DevTools prüfen: keine Fehler im Console, korrekte Event-Kette.

### Phase 8 — Wartung / Änderung
- Lebenslauf der Komponente beachten: `update()` bei Datenänderung,
  `destroy()` beim Entfernen (Regel 2).
- Bei Architektur-Umbau (B → A oder umgekehrt): Map-Inhalt, Factory-Zuständigkeit
  und alle Aufrufer gleichzeitig anpassen (Regel 3/4).

---

## 11. Arbeitsablauf: Umbau der bestehenden Codebase nach diesen Regeln

Vorgehen, um *vorhandene* Komponenten an die Regeln anzupassen (z. B. Factory →
Instanz). Inkrementell: immer nur eine Komponente, nach jedem Schritt bleibt das
Frontend lauffähig (`build` + `lint` grün). Nicht alles auf einmal umbauen.

### Phase 0 — Audit / Ist-Analyse
- Alle Klassen in `public/js/components/` gegen die Regeln klassifizieren:
  Typ (A/B), bestehende Map-Semantik, Aufrufer, Event-Site, CSS-Zugehörigkeit.
- Ergebnis in einer Tabelle festhalten, z. B.:

  | Datei | Aktuell (A/B) | Soll (A/B) | Aufrufer | Risiko |
  | --- | --- | --- | --- | --- |
  | `feedCard.js` | B (Renderer) | A (Instanz) | `feedsGrid.js`, `feeds.js` | mittel |
  | `episodeCard.js` | ? | ? | `timeline.js` | niedrig |

- Verstöße gegen die anderen Regeln notieren (`this.app.*`, Event-Site, Name).

### Phase 1 — Priorisierung & Zerlegung
- Reihenfolge bestimmen: niediges Risiko / hohe Wirkung zuerst; Abhängigkeiten
  beachten (Aufrufer vor oder nach der Komponente umbauen, je nach Typ).
- Großer Umbau in kleine Schritte zerlegen, von denen jeder separat build-grün ist.
- Für jede Komponente alle Aufrufer vorher listen (`grep` nach `.render*`,
  `.card.`, `feedCards`, `this.app.feeds.card`).

### Phase 2 — Migration pro Komponente (für jede wiederholen)
1. Zieltyp festlegen (A oder B) → Regel 1.
2. Vertrag planen: Constructor-Signatur, öffentliche Methoden, Map-Inhalt
   (Regel 3/4). Bei B → A: neue Instanz mit `this.el`; bei A → B: Renderer +
   `.render(id)` zurück.
3. Komponente umbauen (ggf. separate Factory-Klasse neu anlegen).
4. Aufrufer anpassen: Grid-Map (`{ el, els }` → Instanz oder umgekehrt),
   Delegatoren in `feeds.js`/Manager.
5. CSS beibehalten; nur Namen anpassen, wenn Regel 5 verletzt.

### Phase 3 — Vernetzung vereinheitlichen
- Überall `this.app.<manager>.<method>()` durchsetzen (Regel 7), direkte
  Manager-zu-Manager-Referenzen auflösen.
- Event-Site prüfen, Stoppropagation wo Parent + Child feuern (Regel 8).
- Map-Inhalt über die ganze Codebase auf einen Nenner bringen (Regel 4).

### Phase 4 — Qualitätssicherung nach jedem Schritt
- Nach jeder Komponente: `npm run build`, `npm run lint`, `npm test`.
- Maneller Test der betroffenen Ansicht in `public/dev.html`.
- Ziel: nach jedem Schritt ein lauffähiger Commit-Stand, kein Breakage.

### Phase 5 — Abschlussscan
- Audit (Phase 0) wiederholen: alle Komponenten entsprechen jetzt den Regeln.
- Nicht mehr genutzte Methoden/Imports aufräumen.
- Beispiele in diesem Dokument (z. B. `feedCard.js`) auf den Ist-Zustand anpassen.
