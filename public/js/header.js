import { dc, g, qa, q } from './helper.js';

export default class HeaderComponent {
    constructor(app) {
        this.app = app;
        this.elements = this.app.elements;
        this.state = this.app.state;
        this.navHistory = [];


        this.el = '';
    }

    render() {
        this.el = dc('header');
        this.el.className = 'app-header';
        this.el.innerHTML = `
      <div class="logo-area">
        <h1>Podany</h1>
        <div id="offline-badge" class="offline-badge hidden">Offline</div>
      </div>

      <div class="header-search">
        <div class="search-bar">
          <input type="text" id="search-input" placeholder="Search loaded episodes..." aria-label="Search episodes">
        </div>
      </div>

      <nav class="nav-tabs" aria-label="Main Navigation">
        <button class="nav-tab active" data-tab="timeline" id="btn-tab-timeline">Timeline</button>
        <button class="nav-tab" data-tab="feeds" id="btn-tab-feeds"><span>Feeds</span><span class="tab-badge" id="feed-count">0</span></button>
        <button class="nav-tab" data-tab="downloads" id="btn-tab-downloads"><span>Downloads</span><span class="tab-badge" id="downloads-tab-count"></span></button>
        <!-- Settings tab hidden from nav, triggered by gear icon in header -->
        <button class="nav-tab" data-tab="settings" id="btn-tab-settings" style="display:none;" aria-hidden="true">Settings</button>
      </nav>

      <div class="header-actions">
        <button class="btn btn-primary btn-header-add" id="btn-open-add-modal" title="Add Podcast Feed">
          <span>+ Add Podcast</span>
        </button>

        <!-- Settings gear icon -->
        <button class="btn-icon btn-header-settings" id="btn-open-settings" title="Settings" aria-label="Open Settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>

        <div class="user-status-pill" id="user-status-pill" tabindex="0" role="button" aria-label="User Account">
          <span class="status-indicator" id="status-indicator"></span>
          <span class="user-pill-details">
            <span id="user-email-label">Guest Mode</span>
            <button class="btn-pill-action" id="btn-account-toggle">Log In</button>
          </span>
        </div>
      </div>
        `;

        this.searchInput = q(this.el, '#search-input');
        this.btnOpenAddModal = q(this.el, '#btn-open-add-modal');
        
        //this.btnTabTimeline = q(this.el, 'btn-tab-timeline');
        //this.btnTabFeeds = q(this.el, 'btn-tab-feeds');
        //this.btnTabDownloads = q(this.el, 'btn-tab-downloads');
        //this.btnTabSettings = q(this.el, 'btn-tab-settings');

        this.btnOpenSettings = q(this.el, 'btn-open-settings');
        this.btnAccountToggle = g(this.el, 'btn-account-toggle');

        this.elements.tabs = qa(this.el, '.nav-tab'); 


        return this.el;
    }

    // ── Navigation stack ────────────────────────────────────────────────────

    _currentView() {
        if (this.state.activeFeedDetailId) return { tab: null, feedTarget: this.state.activeFeedDetailId };
        const activeTab = this.elements.tabs ?
            ([...this.elements.tabs].find(t => t.classList.contains('active'))?.dataset.tab) || 'timeline' : 'timeline';
        return { tab: activeTab, feedTarget: null };
    }

    _applyView({ tab, feedTarget }) {
        if (this.elements.tabs) this.elements.tabs.forEach(t => t.classList.remove('active'));
        if (this.elements.panels) this.elements.panels.forEach(p => p.classList.remove('active'));
        if (this.elements.btnOpenSettings) this.elements.btnOpenSettings.classList.remove('is-active');

        if (feedTarget) {
            this.state.activeFeedDetailId = feedTarget;
            if (this.elements.panelFeedDetail) this.elements.panelFeedDetail.classList.add('active');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            const meta = this.state.feedMetadata[feedTarget] || {};
            if (this.elements.searchInput) {
                this.elements.searchInput.placeholder = `Search in ${meta.title || 'podcast'}...`;
            }
            this.app.feeds.renderFeedDetail(feedTarget);
        } else {
            this.state.activeFeedDetailId = null;
            if (this.elements.panelFeedDetail) this.elements.panelFeedDetail.classList.remove('active');
            const targetTab = tab || 'timeline';
            const tabEl = this.elements.byId(`tab-${targetTab}`);
            if (tabEl) tabEl.classList.add('active');
            const panelEl = this.elements.byId(`panel-${targetTab}`);
            if (panelEl) panelEl.classList.add('active');
            if (targetTab === 'settings' && this.elements.btnOpenSettings) {
                this.elements.btnOpenSettings.classList.add('is-active');
            }
            if (targetTab === 'feeds') {
                if (this.elements.searchInput) this.elements.searchInput.placeholder = 'Search subscribed podcasts...';
                this.app.feeds.renderFeedsGrid();
            } else if (targetTab === 'timeline') {
                if (this.elements.searchInput) this.elements.searchInput.placeholder = 'Search loaded episodes...';
                this.app.timeline.renderTimeline();
            }
        }
        this.app.feeds.updateDockVisibility();
    }

    navigateTo(tab, feedTarget, pushBrowser = true) {
        const cur = this._currentView();
        if (cur.tab === tab && cur.feedTarget === feedTarget) return;
        this.state.navHistory.push(cur);

        if (pushBrowser) {
            const hash = feedTarget ? `feed=${encodeURIComponent(feedTarget)}` : (tab || 'timeline');
            window.history.pushState({ tab, feedTarget }, '', '#' + hash);
        }
        this._applyView({ tab, feedTarget });
    }

    navigateBack() {
        const openModal = [
            this.elements.showNotesModal, this.elements.queueModal, this.elements.addModal,
            this.elements.sleepModal, this.elements.confirmModal
        ].find(m => m && !m.classList.contains('hidden'));
        if (openModal) {
            openModal.classList.add('hidden');
            return true;
        }

        if (window.history.length > 1) {
            window.history.back();
            return true;
        }
        if (this.state.navHistory.length > 0) {
            const prev = this.state.navHistory.pop();
            this._applyView(prev);
            return true;
        }
        this._applyView({ tab: 'timeline', feedTarget: null });
        return false;
    }

    initNavigationRoute() {
        window.addEventListener('popstate', (e) => {
            let modalClosed = false;
            const modals = [
                this.elements.showNotesModal, this.elements.queueModal, this.elements.addModal,
                this.elements.sleepModal, this.elements.confirmModal
            ];
            for (const m of modals) {
                if (m && !m.classList.contains('hidden')) {
                    m.classList.add('hidden');
                    modalClosed = true;
                }
            }
            if (modalClosed) return;

            if (e.state && (e.state.tab !== undefined || e.state.feedTarget !== undefined)) {
                this._applyView(e.state);
            } else if (window.location.hash) {
                const raw = window.location.hash.slice(1);
                if (raw.startsWith('feed=')) {
                    this._applyView({ tab: null, feedTarget: decodeURIComponent(raw.slice(5)) });
                } else if (['timeline', 'feeds', 'downloads', 'settings'].includes(raw)) {
                    this._applyView({ tab: raw, feedTarget: null });
                } else {
                    this._applyView({ tab: 'timeline', feedTarget: null });
                }
            } else {
                this._applyView({ tab: 'timeline', feedTarget: null });
            }
        });

        const hash = window.location.hash ? window.location.hash.slice(1) : '';
        if (hash.startsWith('feed=')) {
            const feedTarget = decodeURIComponent(hash.slice(5));
            this._applyView({ tab: null, feedTarget });
            window.history.replaceState({ tab: null, feedTarget }, '', '#' + hash);
        } else if (['timeline', 'feeds', 'downloads', 'settings'].includes(hash)) {
            this._applyView({ tab: hash, feedTarget: null });
            window.history.replaceState({ tab: hash, feedTarget: null }, '', '#' + hash);
        } else {
            window.history.replaceState({ tab: 'timeline', feedTarget: null }, '', '#timeline');
        }
    }

    wireTabs() {
        if (!this.elements.tabs) return;
        this.elements.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;
                this.navigateTo(targetTab);
            });
        });
        if (this.elements.btnOpenSettings) {
            this.elements.btnOpenSettings.addEventListener('click', () => this.navigateTo('settings'));
        }
    }

    init() {

    }
}