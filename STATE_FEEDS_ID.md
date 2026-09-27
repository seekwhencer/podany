# ARBEITSABLAUPLAN: `this.state.feeds` → Subscription-ID statt URL

**Ziel:** Im `AppState` (`public/js/state.js`) soll `this.feeds` nicht mehr die RSS-**URL**, sondern die serverseitige **Subscription-ID** (`sub_...`) speichern.
**Status der Planung:** Entscheidung bestätigt — Implementation kann starten.
**Letzte Aktualisierung:** Plan-V2 (Entscheidungspunkt #1 bestätigt am 2026-09-27).

---

## 0. ENTSCHEIDUNG #1 (BESTÄTIGT — 2026-09-27)

> **Beschluss: Vollständige Migration auf `feed.id`. Option A ist verbindlich.**

Nur `this.feeds` umzustellen ist nicht ausreichend, weil `feeds` der zentrale Identifikator für Metadata, Episoden-Matching und Navigation ist.

**Umsetzung (Option A, verbindlich):**
- `this.feeds` = Subscription-IDs (`sub_...`).
- `feedMetadata`, Navigation (`activeFeedDetailUrl`→`activeFeedDetailId`), Episoden-Matching und NavHistory alles auf IDs umstellen.
- URLs nur noch über die Karte `feedUrlById: {[id]: url}` rekonstruieren (gebraucht für OPML-Export, RSS-Kopieren, Preview nicht-abonnierter Feeds, „isSubbed"-Check in der Directory-Suche).
- `feedIdByUrl` entfällt vollständig.
- Episoden-Matching: `ep.subscriptionId === id`.

> Option B (narrow, parallele URL→ID-Karte + URL-basierte Navigation) ist **ausgezeichnet** und wird nicht verwendet.

---

## 1. IST-ZUSTAND (Recherche-Ergebnis)

- `state.js:9,47` — `this.feeds = []` speichert **URLs**.
- `state.js:11,49` — `this.feedIdByUrl = {}` mappt `url → subscriptionId`.
- `sync.js:24` — `this.state.feeds = remoteFeeds.map(f => f.feed_url)` (URLs vom Server).
- `sync.js:25-27` — baut `feedIdByUrl` aus `f.id` + `f.feed_url`.
- `sync.js:46-53` `saveFeedToServer(url)` — ruft `addSubscription` auf, speichert `feedIdByUrl[url]=result.id`.
- `sync.js:55-59` `removeFeedFromServer(url)` — ruft `removeSubscription(url)` auf.
- Episoden in `allEpisodes`: tragen `ep.feedUrl` (URL) **und** bei Server-Ladeweg `ep.subscriptionId` (`feedService.js:52` liefert `subscription_id AS subscriptionId`). Preview-Episoden (unsubscribed) haben nur `feedUrl`, keine `subscriptionId`.
- Navigation (`modal.js`): `activeFeedDetailUrl`, `navHistory[]` ({tab, feedUrl}), Hash `#feed=<url>` — alles URL-basiert.
- OPML-Export (`feeds.js:358`) iteriert `this.state.feeds` als URLs für `xmlUrl`.
- Server `SubscriptionRoutes.js:131-143` DELETE + `Subscription.remove(userId, feedUrl)` sind **URL-basiert**. `addSubscription` liefert `{id, feed_url}` zurück (Client hat die ID already).

---

## 2. SOLL-ZUSTAND (Option A)

| Zustand | Vorher | Nachher |
|---|---|---|
| `this.feeds` | `[url, ...]` | `[id, ...]` |
| `this.feedIdByUrl` | `{url: id}` | **entfällt** (oder → `feedUrlById`) |
| `this.feedUrlById` | — | `{id: url}` (neue Karte, für Export/Copy/Preview) |
| `this.feedMetadata` | keyed by url | keyed by **id** (`meta.url` bleibt für Export/Copy) |
| `this.activeFeedDetailUrl` | url | → `activeFeedDetailId` (id) |
| NavHistory / Hash | feedUrl | feedId |
| Episoden-Matching | `ep.feedUrl === url` | `ep.subscriptionId === id` |

---

## 3. BETROFFENE STELLEN (File:Line-Inventar)

**AppState / Init**
- `public/js/state.js:9,47` — `this.feeds = []` (Doku: IDs).
- `public/js/state.js:11,49` — `feedIdByUrl` entfernen; `feedUrlById = {}` hinzufügen.
- `public/js/state.js:26,56` — `activeFeedDetailUrl` → `activeFeedDetailId`.

**Sync (`sync.js`)**
- `:24` — `map(f => f.id)`.
- `:25-27` — `feedIdByUrl` durch `feedUrlById = {[f.id]: f.feed_url}` ersetzen.
- `:46-53` `saveFeedToServer` — Signatur auf `(feedUrl, id, title, image)`; ruft `addSubscription`, lift `result.id`; speichert `feedUrlById[id]=feedUrl`. **Kein URL-Push mehr hier.**
- `:55-59` `removeFeedFromServer` — auf ID umstellen (siehe Backend-Punkt).

**Feeds (`public/js/feeds.js`) — größte Oberfläche**
- `:82` `refreshAllFeeds` — `.map(id => this.api.loadFeedById(id))` (kein `feedIdByUrl`-Lookup mehr).
- `:91` — `this.state.feeds.includes(ep.subscriptionId)` statt `ep.feedUrl`.
- `:106-154` `fetchSingleFeed(url,…)` — aufteilen: Refresh nutzt `loadFeedById(id)`; Preview behält `fetchFeed(url)`.
- `:217` Directory `isSubbed` — URL→ID über `feedUrlById`, dann Membership.
- `:272-287` `addFeed(url,…)` — erst Server-Call → `id` → `feeds.push(id)` + `feedUrlById[id]=url`; `feedMetadata[id]` befüllen.
- `:289-322` `promptRemoveFeed`/`removeFeed(url)` — auf ID umstellen; `feedUrlById[id]` löschen; Server-Delete per ID.
- `:326-353` `importOpml` — nach `saveFeedToServer` die ID holen und in `feeds`/`feedUrlById` schreiben.
- `:355-371` `exportOpml` — über `feedUrlById`/`meta.url` die `xmlUrl` rekonstruieren.
- `:441-576` `renderFeedsGrid` — über IDs iterieren, `feedMetadata[id]`, Episoden filtern per `ep.subscriptionId`.
- `:620-757` `renderFeedDetail(feedId)` + `:729` Preview — isSubbed/Metadata/Episoden/Nav auf ID; Preview-Pfad (unsubscribed) bei URL belassen.

**Modal / Navigation (`public/js/ui/modal.js`)**
- `:19,22,31,63,67,116,129` — Nav/Hash von `feedUrl` auf `feedId`; `_applyView` nutzt `feedId`.
- `:272,278` `resetAll` — `removeSubscription` per ID (oder URL aus `feedUrlById`).

**Timeline (`public/js/timeline.js`)**
- `:719` `openFeedDetail(ep.feedUrl)` — auf `ep.subscriptionId` umstellen (ID direkt).

**Auth (`public/js/auth.js`)**
- `:94` — nur `.length`, unverändert.

**Backend (`server/`)**
- DELETE subscription ist URL-basiert (`SubscriptionRoutes.js:131`, `Subscription.js:37`). **Neuer Task:** Delete-by-ID unterstützen (Endpoint `DELETE /api/subscription` mit `{id}` + `Subscription.removeById`), **oder** Fallback: bei Removal die URL aus `feedUrlById[id]` am Client nachschlagen und bestehenden URL-Delete nutzen (geringerer Backend-Aufwand).

---

## 4. SCHRITT-FÜR-SCHRITT-ABLAUF (Implementation)

> Jede Phase separat verifizieren (Syntax/Logik), bevor die nächste beginnt. Kein Node needed (AGENTS.md).

1. **AppState umstellen** (`state.js`): `feeds`-Doku → IDs; `feedIdByUrl` → `feedUrlById = {}`; `activeFeedDetailUrl` → `activeFeedDetailId` (constructor + reset).
2. **Sync anpassen** (`sync.js`): `syncFeedsWithServer` auf `f.id` + `feedUrlById`; `saveFeedToServer`/`removeFeedFromServer` auf ID-Signatur. Backend-Delete-Entscheidung aus Punkt 3 anwenden.
3. **Backend Delete-by-ID** (falls Option „Endpoint"): `Subscription.removeById` + Route; sonst Client-Fallback dokumentieren.
4. **Feeds-Logik migrieren** (`feeds.js`) in dieser Reihenfolge: `refreshAllFeeds`+`fetchSingleFeed` → `addFeed` → `removeFeed`/`promptRemoveFeed` → `importOpml`/`exportOpml` → `renderFeedsGrid` → `renderFeedDetail` (+ Preview-Pfad).
5. **Navigation umstellen** (`modal.js`): NavHistory, Hash `#feed=<id>`, `_applyView`, `resetAll`.
6. **Timeline** (`timeline.js:719`): `openFeedDetail(ep.subscriptionId)`.
7. **Cross-Check** aller restlichen `state.feeds`-Verwendungen (`auth.js`, `LiveClient.js:310` ist die Manager-Instanz, nicht betroffen).

---

## 5. RISIKEN / FALLSTRICKE

- **Preview nicht-abonnierter Feeds** braucht zwingend die URL (`fetchFeed(url)`); `feedUrlById` darf nie für unsubscribed URLs befüllt werden.
- **OPML-Export** verliert ohne `feedUrlById`/`meta.url` die `xmlUrl`.
- **Directory „isSubbed"** kann nicht ohne URL→ID-Resolution funktionieren (Kandidaten haben nur URL).
- **Episoden ohne `subscriptionId`** (nur Preview) dürfen nicht gegen `feeds` gematcht werden — nur Server-geladene Episoden tragen die ID.
- **Hash-Navigation** `#feed=…` ist deep-linking-fähig; Änderung auf ID muss mit Server/Client-Konsistenz geprüft werden (URL bleibt in `meta.url` kopierbar).
- **Backward-compat:** Bestehende Server-Subscriptions haben weiterhin `feed_url`; nur der Client-Speicherwechsel, kein Datenmigration nötig.

---

## 6. VERIFIKATION

- Manueller Flow: Login → Feeds laden (IDs in `state.feeds` prüfen) → Feed hinzufügen (ID + `feedUrlById`) → Feed-Detail öffnen (Nav per ID) → Unsubscribe → OPML-Export (xmlUrl vorhanden) → Preview eines nicht-abonnierten Feeds.
- `console.log(this.state.feeds)` nach `syncFeedsWithServer` → alle Werte müssen `sub_…`/IDs sein, keine URLs.
- Tests falls vorhanden im Repo ausführen (`*.test.js`): `subscriptionService.test.js`, `routes.test.js`, `downloadsService.test.js`, `LiveClient.test.js`.
- Hinweis: `public/dist/bundle.js` laut AGENTS.md ignorieren (nur Build-Pipeline relevant).
