// main.js — Podany Frontend Entry Point
// Wires the modularized managers into a single app container and runs the boot
// sequence on DOMContentLoaded. Bundled with esbuild to public/dist/bundle.js.
//
// Services (each receives the shared `app` container):
//   config, state, dom, api, storage — shared infrastructure
//   theme, modal                      — shell / UI helpers
//   auth, feeds, playback, queue, sync, timeline — features


// Factories
import Config from './Config.js';
import AppState from './State.js';
import RouterService from './Router.js';
import { ApiClient, ApiError } from './Api.js';
import Storage from './Storage.js';

// The App Shell
import AppShell from './components/AppShell.js';

// Views
import TimelineView from './components/TimelineView.js';
import FeedsView from './components/FeedsView.js';
import FeedDetailView from './components/FeedDetailView.js';
import QueueView from './components/QueueView.js';
import SettingsView from './components/SettingsView.js';

// Components
import ThemeComponent from './components/ThemeComponent.js';
import ModalComponent from './components/ModalComponent.js';

// Services
import ThemeService from './services/ThemeService.js';
import ModalService from './services/ModalService.js';
import AuthService from './services/AuthService.js';
import FeedsService from './services/FeedsService.js';
import PlaybackService from './services/PlaybackService.js';
import QueueService from './services/QueueService.js';
import SyncService from './services/SyncService.js';
import TimelineService from './services/TimelineService.js';

// The Websocket Client
import LiveClient from './LiveClient.js';

export class App {
    constructor() {
        this.config = new Config();
        this.state = new AppState();
        this.router = new RouterService(this);
        // Static non-UI engine resources, fetched once from the HTML (§6.2). Only
        // the audio engine and the YouTube fallback (container + player) remain;
        // the #app mount root is acquired in init() below. Passed to services as
        // references via app.dom; no module queries the global document for them.
        this.dom = {
            audio: document.getElementById('audio-engine'),
            ytPlayerContainer: document.getElementById('yt-player-container'),
            ytPlayer: document.getElementById('yt-player')
        };
        this.api = new ApiClient(this.config, this.state);
        this.storage = new Storage(this.config, this.api, this.state);
        this.theme = new ThemeService(this);
        this.modal = new ModalService(this);
        this.auth = new AuthService(this);
        this.feeds = new FeedsService(this);
        this.playback = new PlaybackService(this);
        this.queue = new QueueService(this);
        this.sync = new SyncService(this);
        this.timeline = new TimelineService(this);
    }

    // Boot error handler (Schritt 7): surface server errors instead of a silent
    // empty state. Auth failures (401/403) re-trigger the auth flow; other errors
    // (offline, 5xx, malformed response) are shown in the status banner.
    handleBootError(err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            this.state.sessionToken = '';
            this.storage.saveSessionToken('');
            this.auth.updateSyncStatusUI('Session Expired', '', false);
            this.auth.showAuthModal();
            return;
        }
        const detail = (err && err.message) ? err.message : String(err);
        console.error('Boot: could not load persistent data from server', detail);
        this.modal.showStatus(`Could not load data from the server (${detail}). Check your connection and try again.`);
    }

    // Auth-first async boot. Validates the session with the server first, then
    // loads the persistent data (feeds, positions, downloads), populates the
    // in-memory cache + transient queue, and finally renders the UI. A loading
    // status is shown while the server calls are in flight.
    async initApp() {
        this.modal.showStatus('Starte Podany...');

        // 1. Session-/Token-Param aus der URL ziehen (Magic-Link): in den State,
        //    URL bereinigen. MUSS vor checkAuth laufen.
        this.auth.checkUrlSessionParam();

        // 2. Session vom Server validieren (auth-first). Bei erfolgreichem
        //    Login/Session werden Feeds + Positionen bereits syncronisiert.
        await this.auth.checkAuth();

        // 3. Persistente Daten vom Server laden (Feeds/Positionen).
        //    Fehler werden nicht verschluckt: 401/403 -> Auth-Flow, sonst
        //    Ladefehler an die UI statt eines stillen leeren Zustands (Schritt 7).
        this.modal.showStatus('Lade Feeds und Positionen...');
        try {
            this.state.feeds = await this.storage.loadFeeds();
            this.state.playbackPositions = await this.storage.loadPositions();
        } catch (err) {
            this.handleBootError(err);
            return;
        }

        // 4. Cache-Arbeitsspeicher befüllen (flüchtig) + Queue (client-only).
        const cache = this.storage.loadCache();
        if (cache.episodes) this.state.allEpisodes = cache.episodes;
        if (cache.metadata) this.state.feedMetadata = cache.metadata;
        this.queue.loadQueue();

        // 5. UI rendern.
        if (this.state.allEpisodes && this.state.allEpisodes.length > 0) {
            this.timeline.processAndSortEpisodes();
            this.timeline.renderTimeline();
            this.feeds.renderFeedsGrid();
        }

        this.modal.hideStatus();
    }

    // Opens the live WebSocket once a session token is available (boot or after
    // login). Idempotent: reuses the existing LiveClient if one is already up.
    async ensureLiveConnection() {
        if (!this.state.sessionToken) return;
        if (this.live && this.live.isActive) return;
        if (this.live) {
            return this.live.forceReconnect();
        } else {
            this.live = new LiveClient(this);
            return this.live.connect();
        }
    }

    wireAllEvents() {
        this.theme.wireThemeButtons();
        this.modal.init();
        // Auth UI is now self-wiring via AuthFlowComponent (mounted by AppShell).
        this.feeds.wireEvents();
        this.queue.wireEvents();
        this.timeline.wireEvents();
    }

    refreshStaticUI() {
        this.queue.updateQueueUI();
        this.feeds.updateFeedCountUI();
        this.feeds.updateDockVisibility();
    }

    setupNetworkListeners() {
        // Offline/online projection onto the header's own offline-badge is owned
        // by HeaderComponent (R1); this only keeps the reconnect wiring.
        const reconnect = () => {
            if (this.live && typeof this.live.forceReconnect === 'function') {
                this.live.forceReconnect();
            }
        };
        window.addEventListener('online', reconnect);
        window.addEventListener('offline', reconnect);
    }

    initServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => { });
        }
    }

    async init() {
        this.theme.init();
        await this.initApp();
        await this.ensureLiveConnection();
        this.wireAllEvents();
        this.playback.setupAudioEngines();
        this.setupNetworkListeners();
        this.refreshStaticUI();
        //this.initServiceWorker();
        // Navigation is owned by RouterService (constructed in App()); it seeds
        // `current` and AppShell._seedInitialView() applies the first view. The
        // legacy ModalService.initNavigationRoute() was removed (Phase 4.2).

        // §6.2: the static HTML only provides the #app mount root. AppShell owns
        // the .app-container + .main-content structure and builds it on #app; its
        // Header/PlayerBar/Dock/Views are active (R1-R7). ThemeComponent has no
        // visible chrome (it drives :root) and mounts as a detached controller.
        const appRoot = document.getElementById('app');

        this.themeComponent = new ThemeComponent(this);
        this.themeComponent.mount(appRoot);

        this.modalComponent = new ModalComponent(this);

        this.shell = new AppShell(this);
        this.shell.mount(appRoot);

        // Phase 5: register real feature views with the router-driven shell.
        this.shell.registerView('timeline', () => new TimelineView(this));
        this.shell.registerView('feeds', () => new FeedsView(this));
        this.shell.registerView('feed', (ctx) => new FeedDetailView(this, ctx));
        this.shell.registerView('queue', () => new QueueView(this));
        this.shell.registerView('settings', () => new SettingsView(this));
    }
}

// Boot the single app instance once the DOM is ready.
const app = new App();

// Wire the YouTube Iframe API callback (loaded as a classic <script> before the
// module bundle). Fires window.onYouTubeIframeAPIReady once the API is ready.
window.onYouTubeIframeAPIReady = () => app.playback.onYouTubeIframeAPIReady();
if (window.YT && window.YT.Player) {
    app.playback.initYouTubePlayer();
}

document.addEventListener('DOMContentLoaded', () => app.init());

export default app;
