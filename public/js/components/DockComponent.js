// DockComponent.js — Podany Dock (Layout / Chrome component)
// Bottom-action dock: filter chips, live counts, sort order, refresh and search.
// It owns its own DOM tree (this.el) and projects app.state; user actions are
// delegated to services via DI (app.*). Visibility is CSS-driven by AppShell's
// body[data-active-view] (timeline only) — see dock.css. See
// FRONTEND_REFACTORING_COMPONENTS.md §2, §7, §13, §15.3 R2.

import { BaseComponent } from '../BaseComponent.js';

const DOCK_FILTERS = [
    { mode: 'unplayed', label: 'Unplayed' },
    { mode: 'continue', label: 'Continue', count: true },
    { mode: 'played', label: 'Played', count: true },
    { mode: 'all', label: 'All Episodes' }
];

const SORT_OPTIONS = [
    { value: 'newest', label: 'Latest to Oldest' },
    { value: 'oldest', label: 'Oldest to Latest' },
    { value: 'title-asc', label: 'Title (A to Z)' },
    { value: 'title-desc', label: 'Title (Z to A)' },
    { value: 'podcast-asc', label: 'Podcast Name' },
    { value: 'duration-asc', label: 'Shortest First' },
    { value: 'duration-desc', label: 'Longest First' }
];

export class DockComponent extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elSearch = null;
        this.elFilters = null;
        this.elSort = null;
        this.elRefresh = null;
        this.elContinueCount = null;
        this.elPlayedCount = null;
        this.chips = [];
        this._searchDebounce = null;
    }

    render() {
        const el = this.createElement('aside', { class: 'bottom-action-dock', 'aria-label': 'Quick Actions' });

        const searchWrap = this.createElement('div', { class: 'dock-search' });
        const searchInput = this.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search episodes...';
        searchInput.setAttribute('aria-label', 'Search episodes');
        searchWrap.appendChild(searchInput);
        this.elSearch = searchInput;
        el.appendChild(searchWrap);

        const filters = this.createElement('div', { class: 'dock-filters' });
        this.chips = [];
        DOCK_FILTERS.forEach(def => {
            const chip = this.createElement('button', { class: 'chip-filter', type: 'button' });
            chip.dataset.filter = def.mode;
            if (def.count) {
                const open = this.createElement('span', { text: def.label + ' (' });
                const count = this.createElement('span', { class: 'chip-count', text: '0' });
                const close = this.createElement('span', { text: ')' });
                chip.append(open, count, close);
                if (def.mode === 'continue') this.elContinueCount = count;
                else this.elPlayedCount = count;
            } else {
                chip.textContent = def.label;
            }
            this.chips.push(chip);
            filters.appendChild(chip);
        });
        this.elFilters = filters;
        el.appendChild(filters);

        const divider = this.createElement('div', { class: 'dock-divider' });
        el.appendChild(divider);

        this.elSort = this.createElement('select', { 'aria-label': 'Sort Order' });
        SORT_OPTIONS.forEach(opt => {
            this.elSort.appendChild(this.createElement('option', { value: opt.value, text: opt.label }));
        });
        el.appendChild(this.elSort);

        this.elRefresh = this.createElement('button', { class: 'btn btn-secondary btn-sm btn-dock-refresh', type: 'button', title: 'Refresh all feeds', text: 'Refresh' });
        el.appendChild(this.elRefresh);

        return el;
    }

    onMount() {
        this.on(this.elFilters, 'click', (e) => this._onChipClick(e));
        this.on(this.elSort, 'change', (e) => this.app.timeline.setSort(e.target.value));
        this.on(this.elRefresh, 'click', () => this._refresh());
        this.on(this.elSearch, 'input', (e) => this._onSearch(e));

        this._unsubs.push(this.subscribe('filterMode', () => this._updateChip()));
        this._unsubs.push(this.subscribe('sortOrder', () => this._updateSort()));
        this._unsubs.push(this.subscribe('allEpisodes', () => this._updateCounts()));
        this._unsubs.push(this.subscribe('playbackPositions', () => this._updateCounts()));

        this._updateChip();
        this._updateSort();
        this._updateCounts();
    }

    // ── Interactions (bottom-up → services via DI) ───────────────────────────

    _onChipClick(e) {
        const chip = e.target && e.target.closest ? e.target.closest('.chip-filter') : null;
        if (!chip) return;
        this.app.timeline.setFilter(chip.dataset.filter);
    }

    _refresh() {
        if (this.app.feeds && typeof this.app.feeds.refreshAllFeeds === 'function') {
            this.app.feeds.refreshAllFeeds();
        }
    }

    _onSearch(e) {
        const q = e.target.value.trim();
        if (this._searchDebounce) clearTimeout(this._searchDebounce);
        this._searchDebounce = setTimeout(() => {
            this._searchDebounce = null;
            this.app.timeline.search(q);
        }, 250);
    }

    // ── State projection ─────────────────────────────────────────────────────

    _updateChip() {
        const mode = this.state ? this.state.filterMode : 'unplayed';
        this.chips.forEach(chip => {
            chip.classList.toggle('active', chip.dataset.filter === mode);
        });
    }

    _updateSort() {
        if (this.elSort && this.state) {
            this.elSort.value = this.state.sortOrder || 'newest';
        }
    }

    _updateCounts() {
        if (!this.app.timeline || typeof this.app.timeline.computeCounts !== 'function') return;
        const counts = this.app.timeline.computeCounts();
        if (this.elContinueCount) this.elContinueCount.textContent = String(counts.inProgress);
        if (this.elPlayedCount) this.elPlayedCount.textContent = String(counts.played);
    }

    onUnmount() {
        if (this._searchDebounce) clearTimeout(this._searchDebounce);
        this._searchDebounce = null;
        super.onUnmount();
    }
}

export default DockComponent;
