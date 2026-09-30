// AddFeedComponent.js — Podany AddFeed (Atomic / UI component)
// The "add feed" modal: RSS/URL input + submit, podcast-directory search with
// category chips and paginated results, and error feedback. Owns its own DOM
// tree and communicates upward via CustomEvents (feed-added / feed-open-requested).
// Drives app.feeds for all actions. See FRONTEND_REFACTORING_COMPONENTS.md §2, §7, §10, §13.

import { BaseComponent } from '../BaseComponent.js';

export class AddFeedComponent extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elOverlay = null;
        this.elUrlInput = null;
        this.elSubmitBtn = null;
        this.elSearchInput = null;
        this.elSearchBtn = null;
        this.elResults = null;
        this.elError = null;
        this.elStatus = null;
        this._searchDebounce = null;
        this._submitting = false;
        this._open = false;
    }

    render() {
        const overlay = this.createElement('div', { class: 'modal-overlay add-feed hidden' });
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Add a podcast');

        const card = this.createElement('div', { class: 'modal-card add-feed__card' });

        const header = this.createElement('div', { class: 'modal-header' });
        const title = this.createElement('h2', { class: 'add-feed__title', text: 'Add a podcast' });
        const close = this.createElement('button', { class: 'btn-close', 'aria-label': 'Close', text: '×' });
        header.append(title, close);

        const urlForm = this.createElement('form', { class: 'add-feed__url-form' });
        const urlLabel = this.createElement('label', { class: 'add-feed__label', text: 'Podcast URL (RSS)' });
        this.elUrlInput = this.createElement('input', {
            type: 'url',
            class: 'add-feed__url-input',
            placeholder: 'https://example.com/feed.xml',
            autocomplete: 'off'
        });
        this.elSubmitBtn = this.createElement('button', { class: 'add-feed__submit btn btn--primary', type: 'submit', text: 'Add feed' });
        urlForm.append(urlLabel, this.elUrlInput, this.elSubmitBtn);

        const searchForm = this.createElement('form', { class: 'add-feed__search-form' });
        const searchWrap = this.createElement('div', { class: 'add-feed__search-wrap' });
        this.elSearchInput = this.createElement('input', {
            type: 'text',
            class: 'add-feed__search-input',
            placeholder: 'Search podcast directory',
            autocomplete: 'off'
        });
        this.elSearchBtn = this.createElement('button', { class: 'add-feed__search-btn btn btn--secondary', type: 'submit', text: 'Search' });
        searchWrap.append(this.elSearchInput, this.elSearchBtn);
        searchForm.append(searchWrap);

        const chipsWrap = this.createElement('div', { class: 'modal-category-chips add-feed__chips' });
        const chipsLabel = this.createElement('span', { class: 'add-feed__chips-label', text: 'Browse:' });
        const categories = ['News', 'Technology', 'Knowledge', 'Culture', 'Music'];
        categories.forEach(cat => {
            const chip = this.createElement('button', {
                type: 'button',
                class: 'category-chip add-feed__chip',
                text: cat
            });
            chip.dataset.category = cat;
            this.on(chip, 'click', (e) => {
                e.preventDefault();
                this.elSearchInput.value = cat;
                this._search();
            });
            chipsWrap.append(chip);
        });
        chipsWrap.prepend(chipsLabel);

        this.elStatus = this.createElement('div', { class: 'add-feed__status help-text' });
        this.elError = this.createElement('div', { class: 'add-feed__error help-text' });
        this.elError.style.display = 'none';

        this.elResults = this.createElement('div', { class: 'add-feed__results' });

        card.append(header, urlForm, searchForm, chipsWrap, this.elStatus, this.elError, this.elResults);
        overlay.append(card);

        this.elOverlay = overlay;

        this.on(close, 'click', () => this.close());
        this.on(overlay, 'click', (event) => {
            if (event.target === overlay) this.close();
        });
        this.on(urlForm, 'submit', (e) => { e.preventDefault(); this._submit(); });
        this.on(searchForm, 'submit', (e) => { e.preventDefault(); this._search(); });
        this.on(this.elSearchInput, 'input', () => this._debounceSearch());
        // Delegated listener for directory result clicks (§13.3).
        this.on(this.elResults, 'podcast-directory-select', (event) => {
            const feedUrl = (event.detail || {}).feedUrl;
            if (!feedUrl) return;
            this.close();
            this.app.feeds.openFeedDetail(feedUrl);
        });

        return overlay;
    }

    onMount() {
        if (this.app && this.app.modal) this.app.modal.register('addFeed', this);
    }

    // ── Open / close ─────────────────────────────────────────────────────────

    open() {
        this.elUrlInput.value = '';
        this.elSearchInput.value = '';
        this.elResults.innerHTML = '';
        this._hideError();
        this._setStatus('');
        this._open = true;
        this.elOverlay.classList.remove('hidden');
        this.setTimeout(() => { if (this._mounted && this.elUrlInput) this.elUrlInput.focus(); }, 0);
    }

    close() {
        this._open = false;
        this._submitting = false;
        this._clearDebounce();
        if (this.elSubmitBtn) {
            this.elSubmitBtn.textContent = 'Add feed';
            this.elSubmitBtn.disabled = false;
        }
        this.elOverlay.classList.add('hidden');
        if (this.app && this.app.modal) this.app.modal.popModal(this);
    }

    // ── Submit (async, state machine idle -> loading -> success | error) §10.1 ─

    async _submit() {
        const url = this.elUrlInput ? this.elUrlInput.value.trim() : '';
        if (!url || this._submitting) return;
        this._submitting = true;
        if (this.elSubmitBtn) {
            this.elSubmitBtn.textContent = 'Adding...';
            this.elSubmitBtn.disabled = true;
        }
        this._hideError();
        this._setStatus('Adding feed…');

        try {
            const id = await this.app.feeds.addFeed(url);
            if (!this._mounted) return;
            if (id) {
                this._setStatus('');
                if (this.elSubmitBtn) this.elSubmitBtn.textContent = 'Subscribed!';
                this.emit('feed-added', { url });
                this.setTimeout(() => { if (this._mounted) this.close(); }, 1200);
            } else {
                this._submitting = false;
                if (this.elSubmitBtn) {
                    this.elSubmitBtn.textContent = 'Add feed';
                    this.elSubmitBtn.disabled = false;
                }
                this._setStatus('');
                this._setError('Could not add this feed. Check the URL and try again.');
            }
        } catch (e) {
            if (!this._mounted) return;
            this._submitting = false;
            if (this.elSubmitBtn) {
                this.elSubmitBtn.textContent = 'Add feed';
                this.elSubmitBtn.disabled = false;
            }
            this._setStatus('');
            this._setError(e && e.message ? e.message : 'Could not add this feed. Check the URL and try again.');
        }
    }

    // ── Directory search (debounced) ─────────────────────────────────────────

    _debounceSearch() {
        this._clearDebounce();
        this._searchDebounce = this.setTimeout(() => {
            this._searchDebounce = null;
            this._search();
        }, 350);
    }

    _clearDebounce() {
        if (this._searchDebounce !== null) {
            clearTimeout(this._searchDebounce);
            this._searchDebounce = null;
        }
    }

    _search() {
        const query = this.elSearchInput ? this.elSearchInput.value.trim() : '';
        if (!query) {
            if (this.elResults) this.elResults.innerHTML = '';
            return;
        }
        if (this.elResults) this.elResults.innerHTML = '';
        const dir = this.app && this.app.feeds && this.app.feeds.directory;
        if (dir && typeof dir.searchPodcastDirectory === 'function') {
            dir.searchPodcastDirectory(query, this.elResults);
        }
    }

    // ── Feedback helpers ─────────────────────────────────────────────────────

    _setStatus(msg) {
        if (!this.elStatus) return;
        this.elStatus.textContent = msg || '';
        this.elStatus.style.display = msg ? 'block' : 'none';
    }

    _setError(msg) {
        if (!this.elError) return;
        this.elError.textContent = msg || '';
        this.elError.style.display = msg ? 'block' : 'none';
    }

    _hideError() {
        this._setError('');
    }
}

export default AddFeedComponent;
