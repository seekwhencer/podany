// auth.js — Podany AuthService
// Magic-link login, session detection, auth-status projection, logout/reset.
// DOM-free: it only mutates app.state + notify() and drives the API / live / sync
// services. The login/registration UI lives in AuthFlowComponent (its own DOM).
// See FRONTEND_REFACTORING_COMPONENTS.md §4, §5.

import { SESSION_COOKIE_NAME } from '../Config.js';

export class AuthService {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.api = app.api;
        this.storage = app.storage;
        this.pendingToken = null;
    }

    // ── Modal open/close (drives AuthFlowComponent via state.authModalOpen) ───

    openAuthModal() {
        this.state.authModalOpen = true;
        this.state.notify('authModalOpen');
    }

    closeAuthModal() {
        this.state.authModalOpen = false;
        this.state.notify('authModalOpen');
    }

    // Backward-compatible alias (legacy callers / tests reference showAuthModal).
    showAuthModal() {
        this.openAuthModal();
    }

    // ── Session detection ───────────────────────────────────────────────────

    checkUrlSessionParam() {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionParam = urlParams.get('session');
        const tokenParam = urlParams.get('token');
        if (sessionParam) {
            this.state.sessionToken = sessionParam;
            this.storage.saveSessionToken(sessionParam);
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (tokenParam) {
            this.pendingToken = tokenParam;
            window.history.replaceState({}, document.title, window.location.pathname);
        } else {
            const stored = this.storage.loadSessionToken();
            this.state.sessionToken = stored || '';
        }
    }

    async checkAuth() {
        if (this.pendingToken) {
            const token = this.pendingToken;
            this.pendingToken = null;
            try {
                const result = await this.api.verify(token);
                if (result && result.sessionToken) {
                    this.state.sessionToken = result.sessionToken;
                    this.storage.saveSessionToken(result.sessionToken);
                    if (result.user) this.state.userEmail = result.user.email || '';
                    this.closeAuthModal();
                    this.updateSyncStatusUI('Authenticated via Magic Session (Server Synced)', this.state.userEmail, true);
                    await this.app.ensureLiveConnection();
                    await this.app.sync.syncFeedsWithServer();
                    return;
                }
            } catch (e) {
                // Invalid/expired token → fall through to guest flow below.
            }
        }

        if (this.state.sessionToken) {
            this.closeAuthModal();
            this.updateSyncStatusUI('Authenticated via Magic Session (Server Synced)');
            await this.app.ensureLiveConnection();
            await this.app.sync.syncFeedsWithServer();
            return;
        }

        let me = null;
        try {
            me = await this.api.me();
        } catch (e) {
            me = null;
        }

        if (me && me.user) {
            this.closeAuthModal();
            if (me.sessionToken) {
                this.state.sessionToken = me.sessionToken;
                this.storage.saveSessionToken(me.sessionToken);
            }
            this.state.userEmail = me.user.email || '';
            this.updateSyncStatusUI('Authenticated via Session Cookie (Server Synced)', this.state.userEmail, true);
            await this.app.ensureLiveConnection();
            await this.app.sync.syncFeedsWithServer();
            return;
        }

        this.openAuthModal();
        this.updateSyncStatusUI('Logged in as guest / local device storage');
        if (this.state.feeds.length > 0) {
            await this.app.feeds.refreshAllFeeds();
        } else {
            this.app.timeline.renderTimeline();
        }
    }

    // ── Auth-status projection (§7.1/§7.3) ──────────────────────────────────
    // Only app.state is mutated; HeaderComponent / SettingsView project it.
    updateSyncStatusUI(statusText, email = '', isConnected = false) {
        this.state.authStatus = {
            text: statusText,
            email: email || (isConnected ? 'Logged In' : 'Guest Mode'),
            isConnected
        };
        this.state.notify('authStatus');
    }

    // ── Magic link ──────────────────────────────────────────────────────────

    getWebmailProvider(email) {
        if (!email || !email.includes('@')) return null;
        const domain = email.split('@')[1].toLowerCase().trim();
        if (domain === 'gmail.com' || domain === 'googlemail.com') {
            return { name: 'Gmail', url: 'https://mail.google.com/' };
        }
        if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.de'].includes(domain)) {
            return { name: 'Outlook', url: 'https://outlook.live.com/mail/' };
        }
        if (domain === 'ue-germany.de') {
            return { name: 'Outlook (UE Germany)', url: 'https://outlook.office.com/mail/' };
        }
        if (['yahoo.com', 'ymail.com', 'yahoo.de', 'yahoo.fr', 'yahoo.co.uk'].includes(domain)) {
            return { name: 'Yahoo Mail', url: 'https://mail.yahoo.com/' };
        }
        if (['icloud.com', 'me.com', 'mac.com'].includes(domain)) {
            return { name: 'iCloud Mail', url: 'https://www.icloud.com/mail/' };
        }
        if (domain === 'proton.me' || domain === 'protonmail.com') {
            return { name: 'Proton Mail', url: 'https://mail.proton.me/' };
        }
        if (domain.startsWith('gmx.')) {
            return { name: 'GMX', url: 'https://www.gmx.net/' };
        }
        if (domain === 'web.de') {
            return { name: 'WEB.DE', url: 'https://web.de/' };
        }
        if (domain === 't-online.de') {
            return { name: 'Telekom Mail', url: 'https://email.t-online.de/' };
        }
        if (domain === 'posteo.de' || domain === 'posteo.net' || domain === 'posteo.org') {
            return { name: 'Posteo', url: 'https://posteo.de/' };
        }
        if (domain === 'mailbox.org') {
            return { name: 'mailbox.org', url: 'https://mailbox.org/' };
        }
        if (domain === 'freenet.de') {
            return { name: 'freenet Mail', url: 'https://email.freenet.de/' };
        }
        if (domain === 'zoho.com' || domain === 'zoho.eu') {
            return { name: 'Zoho Mail', url: 'https://mail.zoho.com/' };
        }
        if (domain === 'fastmail.com' || domain === 'fastmail.fm') {
            return { name: 'Fastmail', url: 'https://app.fastmail.com/' };
        }
        if (domain === 'ionos.de' || domain === 'ionos.com' || domain === 'online.de') {
            return { name: 'IONOS Webmail', url: 'https://mail.ionos.de/' };
        }
        return { name: domain, url: `https://${domain}` };
    }

    // Returns a structured success object (message + optional verify link /
    // provider button) or throws on failure. AuthFlowComponent renders the
    // fields with CSS classes (no inline-style HTML), keeping the service
    // DOM-free. `signal` aborts the in-flight request (§10.3).
    async submitMagic(email, { signal = null } = {}) {
        let data;
        try {
            data = await this.api.sendLink({ email, origin: this._origin(), signal });
        } catch (e) {
            if (signal && signal.aborted) throw e;
            throw new Error(e && e.message ? e.message : 'Failed to send the link');
        }
        if (!data || !data.success) {
            throw new Error((data && data.error) || 'Failed to send the link');
        }

        const provider = this.getWebmailProvider(email);
        return {
            ok: true,
            message: 'Sign-in link sent! Check your email inbox (and spam folder) to complete sign in.',
            verifyUrl: data.verifyUrl || null,
            verifyLabel: data.sandboxNotice || data.devNotice || 'Sign in instantly',
            provider: provider ? { name: provider.name, url: provider.url } : null
        };
    }

    _origin() {
        return (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
    }

    // Password login. Runs the full async flow (session token, live connection,
    // feed sync) and closes the modal on success. Returns { ok, error }.
    async submitPassword(email, password, { signal = null } = {}) {
        if (!email || !email.includes('@')) return { ok: false, error: 'Email is required.' };
        if (!password) return { ok: false, error: 'Password is required.' };

        try {
            const data = await this.api.loginWithPassword({ email, password, signal });
            if (!data.success || !data.sessionToken) {
                throw new Error(data.error || 'Failed to sign in');
            }
            this.state.sessionToken = data.sessionToken;
            this.storage.saveSessionToken(data.sessionToken);
            if (data.user) this.state.userEmail = data.user.email || '';
            this.closeAuthModal();
            this.updateSyncStatusUI('Authenticated via Password Login (Server Synced)', this.state.userEmail, true);

            await this.app.ensureLiveConnection();
            await this.app.sync.syncFeedsWithServer();
            this.app.feeds.updateFeedCountUI();
            return { ok: true };
        } catch (e) {
            return { ok: false, error: `Error: ${e.message}` };
        }
    }

    // ── Logout / full reset ─────────────────────────────────────────────────

    async handleLogout() {
        const currentToken = this.state.sessionToken;
        if (this.app.live && typeof this.app.live.close === 'function') {
            this.app.live.close();
        }
        try {
            await this.api.logout(currentToken);
        } catch (e) { }

        this.storage.clearAll();
        document.cookie = `${SESSION_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;`;
        window.history.replaceState({}, document.title, window.location.pathname);

        this.state.reset();
        this.state.pageSize = this.app.config.pageSize;
        // reset() clears the fields above without notifying; re-project the cleared
        // state onto the component views (TimelineView shelf/list, feeds, ...).
        this.state.notify('allEpisodes');
        this.state.notify('playbackPositions');
        this.state.notify('currentEpisode');
        this.state.notify('filteredEpisodes');
        this.state.notify('filterMode');

        // Audio + YouTube engines are PlaybackService-owned resources; the full
        // pause/clear/stop lives in resetEngines() (kept here for the reset flow).
        this.app.playback.resetEngines();

        this.app.playback.syncPlaybackButtons();
        this.app.feeds.updateFeedCountUI();
        this.app.queue.updateQueueUI();
        this.app.timeline.renderTimeline();
        this.app.feeds.renderFeedsGrid();
        this.updateSyncStatusUI('Logged Out', '', false);
        this.openAuthModal();
    }

    handleAccountToggle() {
        if (this.state.authStatus && this.state.authStatus.isConnected) {
            this.handleLogout();
        } else {
            this.openAuthModal();
        }
    }
}

export default AuthService;
