// HeaderComponent.js — Podany Header (Layout / Atomic component)
// Pure UI: top navigation + search. It does NOT own navigation logic; it
// requests navigation via app.router.navigate(...) and feature actions via
// app.* (DI). DOM handling follows the BaseComponent pattern (this.el + stored
// this.el<Name> refs, listeners on this.el). See FRONTEND_REFACTORING_COMPONENTS.md §2, §7, §9.
//
// In Phase 2 the header was mounted by AppShell but kept inert (display:none via
// .app-shell__header) while the legacy static header stayed active. R1 activated
// it (rule removed) and removed the static <header> from the HTML; the tabs and
// the feed-count badge now live here, driven by the router / AppState.

import { BaseComponent } from '../BaseComponent.js';

const TAB_PATH = {
    timeline: '/',
    feeds: '/feeds',
    settings: '/settings'
};

export class HeaderComponent extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.router = app ? app.router : null;
        this.elSearchInput = null;
        this.elAddBtn = null;
        this.elSettingsGear = null;
        this.elEmailLabel = null;
        this.elAccountToggle = null;
        this.elStatusIndicator = null;
        this.elTabs = [];
    }

    render() {
        const el = this.createElement('header', { class: 'app-header app-shell__header' });

        const logoArea = this.createElement('div', { class: 'logo-area' });
        logoArea.append(this.createElement('h1', { text: 'Podany' }));
        const offlineBadge = this.createElement('div', { class: 'offline-badge hidden', text: 'Offline' });
        logoArea.append(offlineBadge);

        const searchWrap = this.createElement('div', { class: 'header-search' });
        const searchBar = this.createElement('div', { class: 'search-bar' });
        const searchInput = this.createElement('input');
        searchInput.type = 'text';
        searchInput.id = 'search-input';
        searchInput.placeholder = 'Search loaded episodes...';
        searchInput.setAttribute('aria-label', 'Search episodes');
        searchBar.append(searchInput);
        searchWrap.append(searchBar);

        const nav = this.createElement('nav', { class: 'nav-tabs', 'aria-label': 'Main Navigation' });
        this.elTabs = [];
        const tabs = [
            { name: 'timeline', label: 'Timeline', active: true },
            { name: 'feeds', label: 'Feeds', badge: true },
            { name: 'settings', label: 'Settings', hidden: true }
        ];
        for (const def of tabs) {
            const btn = this.createElement('button', { class: 'nav-tab' + (def.active ? ' active' : '') });
            btn.dataset.tab = def.name;
            if (def.hidden) {
                btn.style.display = 'none';
                btn.setAttribute('aria-hidden', 'true');
            }
            if (def.badge) {
                const label = this.createElement('span', { text: 'Feeds' });
                const badge = this.createElement('span', { class: 'tab-badge', text: '0' });
                btn.append(label, badge);
            } else {
                btn.textContent = def.label;
            }
            this.elTabs.push(btn);
            nav.append(btn);
        }

        const actions = this.createElement('div', { class: 'header-actions' });
        const addBtn = this.createElement('button', { class: 'btn btn-primary btn-header-add' });
        addBtn.id = 'btn-open-add-modal';
        addBtn.title = 'Add Podcast Feed';
        addBtn.textContent = '+ Add Podcast';

        const settingsGear = this.createElement('button', { class: 'btn-icon btn-header-settings' });
        settingsGear.id = 'btn-open-settings';
        settingsGear.title = 'Settings';
        settingsGear.setAttribute('aria-label', 'Open Settings');
        settingsGear.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

        const userPill = this.createElement('div', { class: 'user-status-pill', tabindex: '0', role: 'button', 'aria-label': 'User Account' });
        const statusIndicator = this.createElement('span', { class: 'status-indicator' });
        const pillDetails = this.createElement('span', { class: 'user-pill-details' });
        this.elEmailLabel = this.createElement('span', { id: 'user-email-label', text: 'Guest Mode' });
        const accountToggle = this.createElement('button', { class: 'btn-pill-action', text: 'Log In' });
        this.elAccountToggle = accountToggle;
        this.elStatusIndicator = statusIndicator;
        pillDetails.append(this.elEmailLabel, accountToggle);
        userPill.append(statusIndicator, pillDetails);

        actions.append(addBtn, settingsGear, userPill);

        el.append(logoArea, searchWrap, nav, actions);

        this.elSearchInput = searchInput;
        this.elAddBtn = addBtn;
        this.elSettingsGear = settingsGear;
        this.elFeedsBadge = this.elTabs[1] && this.elTabs[1].querySelector ? this.elTabs[1].querySelector('.tab-badge') : null;

        // Navigation: request via the router (no view logic here). Delegated
        // click handler on the nav container (§13.3).
        this.on(nav, 'click', (event) => {
            const tab = event.target && event.target.closest ? event.target.closest('.nav-tab') : null;
            if (!tab) return;
            this._navigate(tab.dataset.tab);
        });
        this.on(this.elSettingsGear, 'click', () => this._navigate('settings'));
        this.on(this.elAddBtn, 'click', () => {
            if (this.app && this.app.modal && typeof this.app.modal.openAddFeed === 'function') {
                this.app.modal.openAddFeed();
            }
        });

        return el;
    }

    _navigate(tab) {
        if (!this.router) return;
        const path = TAB_PATH[tab] || '/';
        this.router.navigate(path);
        this.emit('navigation-requested', { tab, path });
    }

    // ── Presentation helpers (state projection, no navigation logic) ─────────
    updateFeedCount(count) {
        if (this.elFeedsBadge) {
            this.elFeedsBadge.textContent = String(count != null ? count : 0);
        }
    }

    setUser({ email, loggedIn }) {
        if (!this.elEmailLabel) return;
        if (loggedIn && email) {
            this.elEmailLabel.textContent = email;
        } else {
            this.elEmailLabel.textContent = 'Guest Mode';
        }
    }

    // Auth-status projection (§7.3): driven by AuthService.updateSyncStatusUI,
    // which sets state.authStatus + notify('authStatus'). The legacy static
    // header is still driven in parallel (Phase 5).
    setAuthStatus(status) {
        const s = status || { email: 'Guest Mode', isConnected: false };
        if (this.elStatusIndicator) {
            this.elStatusIndicator.classList.toggle('online', !!s.isConnected);
        }
        if (this.elEmailLabel) {
            this.elEmailLabel.textContent = s.email || 'Guest Mode';
        }
        if (this.elAccountToggle) {
            this.elAccountToggle.textContent = s.isConnected ? 'Sign Out' : 'Log In';
        }
    }

    onMount() {
        this._unsubs.push(this.subscribe('authStatus', (status) => this.setAuthStatus(status)));
        // Feed count is projected live from AppState (§15.3 R1): the component
        // owns the badge; no service writes it into the removed static header.
        this._unsubs.push(this.subscribe('feeds', () => this.updateFeedCount(this.state.feeds.length)));
        this.updateFeedCount(this.state.feeds.length);
    }

    setOffline(isOffline) {
        // No-op in Phase 2: the legacy header/offline-badge stays wired. Kept for
        // Phase 4 activation so the component can own the badge then.
    }
}

export default HeaderComponent;
