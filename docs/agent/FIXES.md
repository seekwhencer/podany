# Fixes

> Scope: nur Frontend, nur `public/`. Jede Nummer: Erwartet / Ist / Ursache (file:line) / Ansatz.

## 1. Navigation Timeline ↔ Feeds: kein Server-Refresh beim View-Wechsel

**Erwartet:** Wechselt man über die Header-Tabs zwischen `Timeline` (`/`) und `Feeds` (`/feeds`), soll *vor* dem Anzeigen des neuen Views ein Request an den Server und der aktuelle Bestand (Feeds + Episoden + Positionen) geholt werden, damit beide Views auf frischen Daten projektieren.

**Ist:** Der Tab-Klick holt keine Daten. Die Views projektierten nur aus dem bereits im `app.state` vorhandenen Bestand (geladen bei Boot via `Storage.loadFeeds`/`loadPositions` oder durch isolierte Refresh-Punkte). Beim Wechsel zwischen Timeline und Feeds wird daher ggf. veralteter Bestand angezeigt.

**Ursache (kein Navigations-Hook für Refresh):**
- Tab-Klick → `HeaderComponent._navigate` ruft nur `router.navigate(path)` + `emit('navigation-requested')` — kein Fetch. `public/js/components/HeaderComponent.js:124-129` (Handler `:109-113`).
- `RouterService.navigate` schreibt nur Hash + `navHistory` + `routechange`. Kein Side-Effect auf Daten. `public/js/Router.js:79-92`.
- `AppShell._swapView` unmountet den alten / mountet den neuen View. Kein Fetch. `public/js/components/AppShell.js:194-228`.
- `refreshAllFeeds()` wird aktuell NUR ausgelöst durch: Boot (`SyncService.js:31-33`), Login (`AuthService.js:105-107`), Dock-Refresh-Button (`DockComponent.js:112-115`), OPML-Import (`OpmlComponent.js:77-78`), Feed-Detail-Mount (`FeedDetailView.js:34-36` → `refreshSingleFeed`). Ein Wechsel Timeline↔Feeds triggert nichts.

**Ansatz:** In `AppShell._swapView` (oder einen Router-Navigations-Hook) eine Bedingung einbauen: Wechsel zwischen `timeline` und `feeds` (oder generell View-Wechsel) → `app.feeds.refreshAllFeeds()` awaited/abgearbeitet, bevor der neue View projektiert. Deduplikation/Sperrung bereits in `FeedsService.refreshAllFeeds` vorhanden (`_refreshActive`, `_refreshQueued`, `FeedsService.js:52-68`) — also sicher wiederholbar.

## 2. Feed-Detail: seek-requested im `ep-progress-track` hat keine Wirkung

**Erwartet:** Klick auf den Fortschrittsbalken (`ep-progress-track`) einer Episode-Karte im Feed-Detail-View löst `seek-requested` aus und startet/des Episoden an der geklickten Position (`playEpisode(episode, time)`).

**Ist:** Das Suchen hat in der Feed-Detail-Ansicht keine sichtbare Wirkung (Audio/YouTube springt nicht bzw. startet neu ohne Zielposition).

**Ursache (mehrfach, Prüfpunkte):**
- Event-Kette ist vorhanden und mit Timeline identisch: Karten-Klick → `EpisodeCardComponent` emits `seek-requested` `{episode, time}` (`public/js/components/EpisodeCardComponent.js:144-153`) → Handler `FeedDetailEpisodesComponent.js:30` → `playEpisode(episode, detail.time || 0)`. (Timeline: `TimelineView.js:330-332`.) Die Kette selbst ist also nicht das Problem.
- `PlaybackService.playEpisode(episode, overrideStartTime)` (`public/js/services/PlaybackService.js:298-438`) setzt `startTime` korrekt, schreibt `playbackPositions[ep.id].position` (`:307-311`) und notified. Für Audio: `this.audio.currentTime = startTime` sofort (`:418`, ggf. vor Metadata ignoriert) + `pendingStartTime` (`:414`), der via `applyPendingAudioSeek()` auf `loadedmetadata`/`canplay`/`playing` nachgejoint wird (`:88-106`, Wired `:111-114` + `:131-136`). Für YouTube: `loadVideoById({videoId, startSeconds})` (`:345`) bzw. `seekTo` auf `onReady` (`:368-370`).
- Mögliche Auslöser für "keine Wirkung":
  - `ep-progress-track` wird nur gerendert, wenn `_hasProgress` true → aktiv ODER `savedPos.position > 2` (`EpisodeCardComponent.js:175-178`, gebaut in `render()` `:91-93`). Episoden ohne Position zeigen keinen Balken → nichts zu klicken.
  - Klick-Handler bricht ab bei `rect.width <= 0` (`:148`) — Track mit Breite 0 (Layout noch nicht durch) → kein `seek-requested`.
  - `pendingStartTime`-Seek schlägt fehl, wenn `applyPendingAudioSeek` nicht feuert (z. B. Engine bereits aktiv, Audio-`src`/Proxy-Wechsel, oder YouTube-Pfad ohne `startSeconds`).
  - `playEpisode` schreibt ohnehin `position: startTime || 2` (`:308`) — bei `time === 0` (Klick ganz links) wird trotzdem `2` gesetzt; das ist kein Seek-Fehler, aber zu beachten.

**Ansatz:** Erst im Browser reproduzieren (Dev-Server `http://localhost:8788`), welche der Bedingungen eintritt. Prüfen: (a) wird `seek-requested` in Feed-Detail überhaupt emittiert (Listener auf `elProgressTrack` vorhanden / `rect.width > 0`)? (b) landet `playEpisode(episode, time)` mit `time > 0` und wird `pendingStartTime`/`applyPendingAudioSeek` oder YouTube `startSeconds`/`seekTo` korrekt angewandt? Ggf. `applyPendingAudioSeek` robuster machen (auch auf `seekable`-Änderung / `durationchange`) und/oder YouTube-`startSeconds` garantiert setzen.

## 3. Playerbar: `lin…` — URSACHE UNKLAR (Fixes-Text unvollständig)

**Status:** Der Stichpunkt in `FIXES.md` ist abgeschnitten (`"playerbar: lin`). Ohne den vollständigen Text kann die konkrete Ursache nicht bestimmt werden. Bitte vollständigen Text nachreichen.

**Bekannte PlayerBar-Entitäten zur schnellen Lokalisierung (falls „lin…" eines davon meint):**
- `PlayerBarComponent` (Layout): `public/js/components/PlayerBarComponent.js` — Track-Info links (`elTrackInfo`), Cover (`:128-131`, seit Commit `50f2313` → `artworkUrl(episode.image,'full')`), Titel/Podcast-Text, Collapse/Expand (`:102-116`), Queue-/Notes-Buttons.
- `PlaybackControls` (Zentrum): Transport + Scrubber (`elSeek` range `:57`), `input`-Event → `seekToPct` (`PlaybackControls.js:80-84` → `PlaybackService.seekToPct` `:256-265`), Speed, Sleep-Timer, Live-Fill via `livePlayback` (`:186-196`).
- Mögliche Deutungen von „lin…": linearer Fortschritts-Fill (`ep-progress-fill` / `--seek-pct`), Text-Abschneidung/Ellipsis eines Titels, `line`-Separator, oder `loading`-Zustand. **Klärung erforderlich.**

## 4. `confirm-modal`: `btn-close`, `confirm-modal__cancel`, `confirm-modal__confirm` ohne Wirkung

**Erwartet:** Nach `show(...)` schließt das Dialogfenster beim Klick auf `btn-close`, `confirm-modal__cancel` (→ abgelehnt) oder `confirm-modal__confirm` (→ bestätigt): Overlay wird ausgeblendet, Modal aus der Escape-Stack entfernt, und der aufrufende Promise (`ModalService.showConfirm`) mit `'confirmed'`/`'cancelled'` aufgelöst.

**Ist:** Die drei Buttons lösen zwar das korrekte Event aus (der aufrufende Promise wird aufgelöst — z. B. `promptRemoveFeed` führt die Abmeldung durch `FeedsService.js:238-240` aus), aber der Dialog bleibt **sichtbar offen** (Overlay nie `.hidden`) und bleibt im Escape-Stack. Der Klick „wirkt" optisch nicht.

**Ursache (Race in `close()`-Guard):**
- `confirm()`/`cancel()` setzen `this._open = false`, emitten das Event und rufen danach `this.close()` (`ConfirmModalComponent.js:83-95`).
- `close()` hat einen Early-Return-Guard `if (!this._open) return;` (`public/js/components/ConfirmModalComponent.js:74`). Da `_open` bereits `false` ist, wird `close()` vor dem Ausblenden des Overlays (`:77`) und dem `popModal` (`:78`) zurückgeworfen.
- Folge: `elOverlay.classList.add('hidden')` und `ModalService.popModal(this)` werden nie ausgeführt. Nur der Aufruf via Escape (`closeTopModal` → `close()`, bei offenem Dialog `_open === true`) läuft korrekt durch (`:48-52` ModalService, `:150-153` AppShell).

**Ansatz:** `close()` so umbauen, dass es immer Overlay ausblendet + Stack entfernt, ohne doppelt zu emitten. Z. B. Trennung von „auflösen/emitten" und „ausblenden":
- `confirm()`/`cancel()`: `_open=false`, korrektes Event emitten, dann nur `_hide()` (`.hidden` + `popModal`), **kein** weiteres Emit.
- `close()` (Escape/programmatisch): bei `_open === true` → als `confirm-cancelled` auflösen + `_hide()`.
- Guard `if (!this._open) return;` in `close()` beibehalten, aber nur um die *Emit*-Logik, nicht um `_hide()`.
