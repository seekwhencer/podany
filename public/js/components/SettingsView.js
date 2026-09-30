// SettingsView.js — Podany SettingsView (Feature Component)
// The /settings route: appearance (theme), cloud sync status + controls, OPML
// import/export (OpmlComponent), and local-cache reset. Owns its own DOM, projects
// app.state and triggers services via app. See spec §4, §5.

import { BaseComponent } from '../BaseComponent.js';
import OpmlComponent from './OpmlComponent.js';

const THEMES = [
    { val: 'system', label: 'System' },
    { val: 'dark', label: 'Dark' },
    { val: 'light', label: 'Light' }
];

export class SettingsView extends BaseComponent {
    constructor(app) {
        super(app, {});
        this.elFileSync = null;
        this.elLoginBtn = null;
        this.elSyncNowBtn = null;
        this.elClearBtn = null;
        this.themeButtons = [];
        this.opml = null;
    }

    render() {
        this.el = this.createElement('div', { class: 'settings-view' });

        const apCard = this._card('Appearance');
        const apP = this.createElement('p', { text: 'Choose interface theme or match your system preferences.' });
        const group = this.createElement('div', { class: 'theme-switch-group' });
        THEMES.forEach(t => {
            const btn = this.createElement('button', { class: 'btn btn-secondary btn-theme', text: t.label });
            btn.dataset.themeVal = t.val;
            group.appendChild(btn);
            this.themeButtons.push(btn);
        });
        apCard.append(apP, group);
        this.el.appendChild(apCard);

        const syncCard = this._card('Cloud Sync Status');
        this.elSyncStatus = this.createElement('p', { text: this._syncText() });
        this.elLoginBtn = this.createElement('button', { class: 'btn btn-secondary', id: 'settings-login', text: 'Account / Magic Login' });
        this.elSyncNowBtn = this.createElement('button', { class: 'btn btn-secondary', id: 'settings-sync-now', text: 'Sync Now' });
        syncCard.append(this.elSyncStatus, this.elLoginBtn, this.elSyncNowBtn);
        this.el.appendChild(syncCard);

        const opmlCard = this._card('Import / Export Feeds (OPML)');
        const opmlP = this.createElement('p', { text: 'Easily transfer subscriptions from YouTube Music, Apple Podcasts, or Pocket Casts using OPML.' });
        this.opml = new OpmlComponent(this.app);
        opmlCard.append(opmlP);
        this.opml.mount(opmlCard);
        this.el.appendChild(opmlCard);

        const dangerCard = this._card('Clear Local Cache', 'danger-zone');
        dangerCard.append(
            this.createElement('h3', { text: 'Clear Local Cache' }),
            this.createElement('p', { text: 'Reset local storage, cached episode state, and cleared preferences.' })
        );
        this.elClearBtn = this.createElement('button', { class: 'btn btn-danger', id: 'settings-clear-storage', text: 'Clear All Storage' });
        dangerCard.appendChild(this.elClearBtn);
        this.el.appendChild(dangerCard);

        return this.el;
    }

    onMount() {
        this.themeButtons.forEach(btn => this.on(btn, 'click', () => this.app.theme.set(btn.dataset.themeVal)));
        this.on(this.elLoginBtn, 'click', () => this.app.auth.showAuthModal());
        this.on(this.elSyncNowBtn, 'click', () => this._syncNow());
        this.on(this.elClearBtn, 'click', () => this._resetAll());

        // Live theme active-state (§7.3): re-highlight the active theme button
        // whenever the theme changes from any source.
        this._unsubs.push(this.subscribe('theme', () => this._applyThemeUI()));
        this._applyThemeUI();
    }

    _card(title, extraClass = '') {
        const card = this.createElement('div', { class: `settings-card ${extraClass}`.trim() });
        card.appendChild(this.createElement('h3', { text: title }));
        return card;
    }

    _syncNow() {
        if (this.app && this.app.sync && typeof this.app.sync.syncFeedsWithServer === 'function') {
            this.app.sync.syncFeedsWithServer();
        }
    }

    // Global reset: confirm via ConfirmModalComponent, then run ModalService.resetAll.
    async _resetAll() {
        const result = await this.app.modal.showConfirm(
            'Do you really want to unsubscribe from all podcasts and clear all local state?',
            { confirmLabel: 'Clear everything', cancelLabel: 'Cancel', danger: true }
        );
        if (result === 'confirmed' && this.app.modal && typeof this.app.modal.resetAll === 'function') {
            await this.app.modal.resetAll();
        }
    }

    _syncText() {
        const email = this.state && this.state.userEmail;
        return email ? `Logged in as ${email}` : 'Logged in as guest / local state';
    }

    _applyThemeUI() {
        // Reflect the saved theme as active. ThemeComponent owns :root; we mirror
        // the choice here so the settings UI stays consistent and live.
        let saved = 'system';
        if (this.state && this.state.theme) {
            saved = this.state.theme;
        } else if (this.app.storage && typeof this.app.storage.loadTheme === 'function') {
            saved = this.app.storage.loadTheme() || 'system';
        }
        this.themeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.themeVal === saved));
    }

    unmount() {
        if (this.opml && typeof this.opml.unmount === 'function') this.opml.unmount();
        super.unmount();
    }
}

export default SettingsView;
