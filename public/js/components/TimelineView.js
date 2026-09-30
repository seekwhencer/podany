// TimelineView.js — Podany TimelineView (Feature Component)
// The / view: continue shelf + paginated episode list + onboarding empty state.
// It is self-contained (builds its own tree) and reacts to app.state via
// subscriptions. Search / filter / sort controls live in the shell (legacy header
// search + legacy dock) and drive state; this view projects filteredEpisodes.
// User actions are handled by delegating emitted events to services. See spec
// §4, §10, §13.

import { BaseComponent } from '../BaseComponent.js';
import EpisodeCardComponent from './EpisodeCardComponent.js';

const STARTER_FEEDS = [
    { feed: 'https://feeds.megaphone.fm/NATIONALAERONAUTICSANDSPACEADMINISTRATION8162188566', name: "NASA's Curious Universe" },
    { feed: 'https://feeds.simplecast.com/EmVW7VGp', name: 'Radiolab' },
    { feed: 'https://www.deutschlandfunk.de/forschung-aktuell-102.xml', name: 'Forschung aktuell (DLF)' },
    { feed: 'https://www.ndr.de/nachrichten/info/podcast4696.xml', name: 'ARD Klima-Update' },
    { feed: 'https://feeds.simplecast.com/NM3_bR51', name: 'ZEIT WISSEN' },
    { feed: 'https://podcasts.files.bbci.co.uk/w13xtvb6.rss', name: 'The Climate Question (BBC)' }
];

export class TimelineView extends BaseComponent {
    constructor(app) {
        super(app, {});
        this.elShelf = null;
        this.elShelfGrid = null;
        this.elShelfToggle = null;
        this.elShelfLabel = null;
        this.elListHost = null;
        this.elSentinel = null;
        this._shelfCards = new Map();
        this._listCards = new Map();
        this._observer = null;
        this._sigList = null;
        this._sigShelf = null;
        this._searchDebounce = null;
        this._onResize = null;
    }

    render() {
        this.el = this.createElement('div', { class: 'timeline-view' });

        this.elShelf = this.createElement('div', { class: 'continue-shelf' });
        const shelfHeader = this.createElement('div', { class: 'shelf-header' });
        const group = this.createElement('div', { class: 'shelf-header-group' });
        const title = this.createElement('div', { class: 'shelf-title', text: 'Continue Listening' });
        this.elShelfToggle = this.createElement('button', { class: 'btn-shelf-toggle', ariaLabel: 'Toggle Continue Shelf' });
        this.elShelfLabel = this.createElement('span', { class: 'continue-toggle-label', text: 'Show all' });
        const chevron = this.createElement('svg', { class: 'chevron-icon', width: '14', height: '14', viewBox: '0 0 24 24' });
        chevron.innerHTML = '<polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" stroke-width="2"/>';
        this.elShelfToggle.append(this.elShelfLabel, chevron);
        group.append(title, this.elShelfToggle);
        shelfHeader.appendChild(group);
        this.elShelf.appendChild(shelfHeader);

        this.elShelfGrid = this.createElement('div', { class: 'shelf-grid' });
        this.elShelf.appendChild(this.elShelfGrid);
        this.el.appendChild(this.elShelf);

        this.elListHost = this.createElement('div', { class: 'episode-list' });
        this.el.appendChild(this.elListHost);

        this.elSentinel = this.createElement('div', { class: 'timeline-sentinel' });
        this.el.appendChild(this.elSentinel);

        return this.el;
    }

    onMount() {
        this.subscribe('filteredEpisodes', () => this._handleStateChange());
        this.subscribe('allEpisodes', () => this._handleStateChange());
        this.subscribe('playbackPositions', () => this._handleStateChange());
        this.subscribe('currentEpisode', () => this._handleStateChange());
        this.subscribe('filterMode', () => this._handleStateChange());
        this.subscribe('continueCollapsed', () => this._handleStateChange());

        this.on(this.el, ['play-requested', 'resume-requested', 'seek-requested', 'queue-toggled', 'mark-played', 'open-notes', 'open-feed'], (e) => this._onDelegatedClick(e));
        if (this.elShelfToggle) this.on(this.elShelfToggle, 'click', () => {
            this.state.continueCollapsed = !this.state.continueCollapsed;
            this.state.notify('continueCollapsed');
        });

        // Capacity is responsive; re-project the collapsed shelf on resize (moved
        // out of the legacy TimelineService resize hook — §13 cleanup in unmount).
        this._onResize = () => {
            clearTimeout(this.refreshShelfTimeout);
            this.refreshShelfTimeout = setTimeout(() => {
                if (this.state.continueCollapsed && this.state.allEpisodes.length > 0) {
                    this._clearMap(this._shelfCards, this.elShelfGrid);
                    this._renderShelf();
                }
            }, 1000);
        };
        window.addEventListener('resize', this._onResize);

        this._handleStateChange();
        this._setupSentinel();
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    _handleStateChange() {
        const sigList = this._listSignature();
        const sigShelf = this._shelfSignature();
        if (sigList !== this._sigList) { this._sigList = sigList; this._renderList(); }
        if (sigShelf !== this._sigShelf) { this._sigShelf = sigShelf; this._renderShelf(); }
    }

    _renderShelf() {
        if (!this.elShelf) return;
        const inProgress = this.app.timeline.computeContinueEpisodes();

        if (inProgress.length === 0 || this.state.filterMode === 'played') {
            this.elShelf.classList.add('hidden');
            this._clearMap(this._shelfCards, this.elShelfGrid);
            return;
        }

        this.elShelf.classList.remove('hidden');
        const capacity = this.app.timeline.getContinueRowCapacity();
        const collapsed = this.state.continueCollapsed;
        const visible = collapsed ? inProgress.slice(0, capacity) : inProgress;

        const shouldToggle = inProgress.length > capacity;
        if (this.elShelfToggle) {
            this.elShelfToggle.style.display = shouldToggle ? 'inline-flex' : 'none';
            if (this.elShelfLabel) this.elShelfLabel.textContent = collapsed ? `Show all (${inProgress.length})` : 'Show less';
        }
        this.elShelf.classList.toggle('is-expanded', !collapsed && shouldToggle);

        this._renderCards(this._shelfCards, this.elShelfGrid, visible);
    }

    _renderList() {
        this._clearMap(this._listCards, this.elListHost);

        if (this.state.feeds.length === 0) {
            this._renderOnboarding();
            return;
        }

        if (this.state.filteredEpisodes.length === 0) {
            this.elListHost.innerHTML = '';
            this.elListHost.appendChild(this._emptyEpisodesState());
            return;
        }

        this.state.timelinePage = 1;
        this._appendBatch();
    }

    _appendBatch() {
        if (this.elSentinel && this.elSentinel.parentNode) this.elSentinel.parentNode.removeChild(this.elSentinel);

        const start = (this.state.timelinePage - 1) * this.state.pageSize;
        const end = this.state.timelinePage * this.state.pageSize;
        const batch = this.state.filteredEpisodes.slice(start, end);

        this._renderCards(this._listCards, this.elListHost, batch);

        if (end < this.state.filteredEpisodes.length) {
            this.elListHost.appendChild(this.elSentinel);
        }
    }

    _renderCards(map, host, episodes) {
        episodes.forEach(ep => {
            const key = String(ep.id);
            const existing = map.get(key);
            if (existing) { host.appendChild(existing.el); return; }
            const card = new EpisodeCardComponent(this.app, { episode: ep });
            card.mount(host);
            map.set(key, card);
        });
    }

    _clearMap(map, host) {
        for (const [key, card] of map) {
            if (card && typeof card.unmount === 'function') card.unmount();
            map.delete(key);
        }
    }

    // ── Empty / onboarding states ──────────────────────────────────────────────

    _emptyEpisodesState() {
        let title = 'No episodes found';
        let msg = 'Try clearing your search query or refreshing your feeds.';
        if (this.state.filterMode === 'played') { title = 'No played episodes'; msg = 'Episodes you finish or mark as played will appear here.'; }
        else if (this.state.filterMode === 'continue') { title = 'No episodes in progress'; msg = 'Episodes you start listening to will appear here.'; }
        else if (this.state.filterMode === 'unplayed') { title = 'All caught up'; msg = 'You have listened to all episodes.'; }

        const box = this.createElement('div', { class: 'empty-state' });
        const h3 = this.createElement('h3', { text: title });
        const p = this.createElement('p', { text: msg });
        box.append(h3, p);
        return box;
    }

    _renderOnboarding() {
        this.elListHost.innerHTML = '';
        const board = this.createElement('div', { class: 'empty-state onboarding-card' });

        const iconWrap = this.createElement('div', { class: 'empty-icon-wrap' });
        const icon = this.createElement('svg', { width: '24', height: '24', viewBox: '0 0 24 24' });
        icon.innerHTML = '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="1.8"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="1.8"/>';
        iconWrap.appendChild(icon);

        const h3 = this.createElement('h3', { text: 'No podcasts added yet' });
        const p = this.createElement('p', { text: 'Search by podcast name, paste any RSS feed URL, or import your existing library.' });

        const quickAdd = this.createElement('div', { class: 'empty-quick-add' });
        const form = this.createElement('form', { class: 'quick-add-form' });
        form.setAttribute('action', 'javascript:void(0);');
        const inputWrap = this.createElement('div', { class: 'quick-add-input-wrap' });
        const input = this.createElement('input', { type: 'text', placeholder: 'Search podcast or paste RSS URL...', autocomplete: 'off' });
        const submit = this.createElement('button', { class: 'btn btn-primary btn-quick-submit', type: 'submit', text: 'Add' });
        inputWrap.append(input, submit);
        form.appendChild(inputWrap);
        const categoryChips = this.createElement('div', { class: 'empty-category-chips', id: 'tv-category-chips' });
        ['News', 'Tech', 'Wissen', 'Culture', 'Music'].forEach(cat => {
            const chip = this.createElement('button', { class: 'category-chip', type: 'button', text: cat });
            chip.dataset.category = cat;
            categoryChips.appendChild(chip);
        });
        const results = this.createElement('div', { class: 'quick-results-container', id: 'tv-quick-results' });
        const opmlTrigger = this.createElement('button', { class: 'btn btn-secondary', type: 'button', text: 'Import OPML File' });
        quickAdd.append(form, categoryChips, results);

        const actions = this.createElement('div', { class: 'empty-actions' });
        actions.appendChild(opmlTrigger);

        const suggestions = this.createElement('div', { class: 'starter-suggestions-section' });
        const stitle = this.createElement('div', { class: 'starter-suggestions-title', text: 'Discover Science, Planet & Climate shows:' });
        const sgrid = this.createElement('div', { class: 'starter-suggestions-grid' });
        STARTER_FEEDS.forEach(item => {
            const chip = this.createElement('div', { class: 'starter-suggestion-chip' });
            chip.dataset.feed = item.feed;
            const name = this.createElement('span', { class: 'starter-chip-name', text: item.name });
            const add = this.createElement('span', { class: 'starter-chip-add', text: '+ Follow' });
            chip.append(name, add);
            sgrid.appendChild(chip);
        });
        suggestions.append(stitle, sgrid);

        board.append(iconWrap, h3, p, quickAdd, actions, suggestions);
        this.elListHost.appendChild(board);

        this._wireOnboarding({ form, input, submit, results, opmlTrigger, categoryChips, sgrid });
    }

    _wireOnboarding({ form, input, submit, results, opmlTrigger, categoryChips, sgrid }) {
        this.on(form, 'submit', (e) => {
            e.preventDefault();
            const val = input.value.trim();
            if (!val) return;
            if (val.startsWith('http://') || val.startsWith('https://')) {
                submit.textContent = 'Adding...';
                this.app.feeds.addFeed(val);
                input.value = '';
                results.innerHTML = '';
            } else {
                if (this._searchDebounce) clearTimeout(this._searchDebounce);
                this.app.feeds.searchPodcastDirectory(val, results);
            }
        });

        this.on(input, 'input', () => {
            const val = input.value.trim();
            if (submit) {
                submit.textContent = ((val.startsWith('http://') || val.startsWith('https://')) ? 'Add Feed' : 'Search');
            }
            if (this._searchDebounce) clearTimeout(this._searchDebounce);
            if (!val || val.startsWith('http://') || val.startsWith('https://')) {
                if (results) results.innerHTML = '';
                return;
            }
            this._searchDebounce = setTimeout(() => {
                if (results) this.app.feeds.searchPodcastDirectory(val, results);
            }, 350);
        });

        this.on(opmlTrigger, 'click', () => {
            if (this.app.dom.opmlFileInput) this.app.dom.opmlFileInput.click();
        });

        const chips = categoryChips ? Array.from(categoryChips.querySelectorAll('.category-chip')) : [];
        chips.forEach(chip => {
            this.on(chip, 'click', () => {
                input.value = chip.dataset.category;
                if (submit) submit.textContent = 'Search';
                this.app.feeds.searchPodcastDirectory(chip.dataset.category, results);
            });
        });

        const chipsGrid = sgrid ? Array.from(sgrid.querySelectorAll('.starter-suggestion-chip')) : [];
        chipsGrid.forEach(chip => {
            this.on(chip, 'click', () => {
                const feedUrl = chip.dataset.feed;
                if (feedUrl) this.app.feeds.addFeed(feedUrl);
            });
        });
    }

    // ── Pagination ─────────────────────────────────────────────────────────────

    _setupSentinel() {
        if (this._observer) { this._observer.disconnect(); this._observer = null; }
        this._observer = new IntersectionObserver((entries) => {
            if (this._mounted && entries[0] && entries[0].isIntersecting) {
                this._observer.disconnect();
                this.state.timelinePage++;
                this.state.notify('timelinePage');
                this._appendBatch();
            }
        }, { rootMargin: '400px' });
        this._observer.observe(this.elSentinel);
    }

    // ── Event delegation (bottom-up → services) ────────────────────────────────

    _onDelegatedClick(e) {
        const detail = e.detail || {};
        switch (e.type) {
            case 'play-requested':
                if (detail.episode) this.app.playback.toggleEpisodePlayback(detail.episode);
                return;
            case 'resume-requested':
                if (detail.episode) this.app.playback.toggleEpisodePlayback(detail.episode);
                return;
            case 'seek-requested':
                if (detail.episode) this.app.playback.playEpisode(detail.episode, detail.time || 0);
                return;
            case 'queue-toggled':
                if (detail.episode) this.app.queue.toggleEpisodeQueue(detail.episode);
                return;
            case 'mark-played':
                if (detail.episode) this.app.timeline.toggleMarkPlayed(detail.episode);
                return;
            case 'open-notes':
                if (detail.episode) this.app.timeline.openShowNotes(detail.episode);
                return;
            case 'open-feed':
                if (detail.feedId) this.app.router.navigate(`/feed/${detail.feedId}`);
                return;
            default:
                return;
        }
    }

    _listSignature() {
        return JSON.stringify({
            n: this.state.feeds.length,
            ids: this.state.filteredEpisodes.map(e => e.id),
            mode: this.state.filterMode,
            page: this.state.timelinePage
        });
    }

    _shelfSignature() {
        return JSON.stringify({
            all: this.state.allEpisodes.map(e => e.id),
            positions: this.state.playbackPositions,
            current: this.state.currentEpisode ? this.state.currentEpisode.guid : null,
            mode: this.state.filterMode,
            collapsed: this.state.continueCollapsed
        });
    }

    unmount() {
        if (this._onResize) {
            window.removeEventListener('resize', this._onResize);
            this._onResize = null;
        }
        if (this._observer) { this._observer.disconnect(); this._observer = null; }
        if (this._searchDebounce) clearTimeout(this._searchDebounce);
        this._clearMap(this._shelfCards, this.elShelfGrid);
        this._clearMap(this._listCards, this.elListHost);
        super.unmount();
    }
}

export default TimelineView;
