// FeedsGridComponent.js — Podany FeedsGrid (Feature Component)
// Grid of subscribed-feed cards + onboarding empty state. Renders into its own
// tree and reacts to app.state (feeds / searchQuery / feedMetadata). Emits
// open-feed / unsubscribe-requested handling via delegated events -> services.
// See spec §4, §13.

import { BaseComponent } from '../BaseComponent.js';
import FeedCardComponent from './FeedCardComponent.js';

const STARTER_FEEDS = [
    { feed: 'https://feeds.megaphone.fm/NATIONALAERONAUTICSANDSPACEADMINISTRATION8162188566', name: "NASA's Curious Universe" },
    { feed: 'https://feeds.simplecast.com/EmVW7VGp', name: 'Radiolab' },
    { feed: 'https://www.deutschlandfunk.de/forschung-aktuell-102.xml', name: 'Forschung aktuell (DLF)' },
    { feed: 'https://www.ndr.de/nachrichten/info/podcast4696.xml', name: 'ARD Klima-Update' },
    { feed: 'https://feeds.simplecast.com/NM3_bR51', name: 'ZEIT WISSEN' },
    { feed: 'https://podcasts.files.bbci.co.uk/w13xtvb6.rss', name: 'The Climate Question (BBC)' }
];

export class FeedsGridComponent extends BaseComponent {
    constructor(app) {
        super(app, {});
        this.cards = new Map();
        this.elGrid = null;
        this.elEmptyHost = null;
        this._searchDebounce = null;
    }

    render() {
        this.el = this.createElement('div', { class: 'feeds-grid-view' });
        this.elGrid = this.createElement('div', { class: 'feeds-grid' });
        this.el.appendChild(this.elGrid);
        this.elEmptyHost = this.createElement('div', { class: 'feeds-empty-host' });
        this.el.appendChild(this.elEmptyHost);
        return this.el;
    }

    onMount() {
        this.subscribe('feeds', () => this._render());
        this.subscribe('searchQuery', () => this._render());
        this.subscribe('feedMetadata', () => this._render());

        this.on(this.el, ['open-feed', 'unsubscribe-requested', 'play-requested'], (e) => {
            const detail = e.detail || {};
            if (e.type === 'open-feed' && detail.feedId) {
                this.app.router.navigate(`/feed/${detail.feedId}`);
            } else if (e.type === 'unsubscribe-requested' && detail.feedId) {
                this.app.feeds.promptRemoveFeed(detail.feedId);
            } else if (e.type === 'play-requested' && detail.episode) {
                this.app.playback.toggleEpisodePlayback(detail.episode);
            }
        });

        this._render();
    }

    _render() {
        this._clearCards();
        this.elEmptyHost.innerHTML = '';

        if (this.state.feeds.length === 0) {
            this._renderOnboarding();
            return;
        }

        const q = (this.state.searchQuery || '').trim().toLowerCase();
        let feeds = this.state.feeds;
        if (q) {
            feeds = feeds.filter(id => {
                const meta = this.state.feedMetadata[id] || {};
                const url = this.state.feedUrlById[id] || '';
                return (meta.title && meta.title.toLowerCase().includes(q)) ||
                    (meta.author && meta.author.toLowerCase().includes(q)) ||
                    url.toLowerCase().includes(q);
            });
        }

        if (feeds.length === 0) {
            this.elGrid.innerHTML = '';
            const box = this.createElement('div', { class: 'empty-state' });
            const h3 = this.createElement('h3', { text: 'No matching podcasts' });
            const p = this.createElement('p', { text: `No podcasts in your library match "${q}".` });
            box.append(h3, p);
            this.elGrid.appendChild(box);
            return;
        }

        feeds.forEach(id => {
            const card = new FeedCardComponent(this.app, { feedId: id });
            card.mount(this.elGrid);
            this.cards.set(String(id), card);
        });
    }

    _clearCards() {
        for (const [id, card] of this.cards) {
            if (card && typeof card.unmount === 'function') card.unmount();
            this.cards.delete(id);
        }
    }

    _renderOnboarding() {
        const board = this.createElement('div', { class: 'empty-state onboarding-card' });

        const iconWrap = this.createElement('div', { class: 'empty-icon-wrap' });
        const icon = this.createElement('svg', { width: '24', height: '24', viewBox: '0 0 24 24' });
        icon.innerHTML = '<path d="M4 11a9 9 0 0 1 9 9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 4a16 16 0 0 1 16 16" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="5" cy="19" r="1" fill="currentColor"/>';
        iconWrap.appendChild(icon);

        const h3 = this.createElement('h3', { text: 'Your podcast library is empty' });
        const p = this.createElement('p', { text: 'Search any podcast by name, paste an RSS feed URL, or import an OPML backup to start listening.' });

        const quickAdd = this.createElement('div', { class: 'empty-quick-add' });
        const form = this.createElement('form', { class: 'quick-add-form' });
        form.setAttribute('action', 'javascript:void(0);');
        const inputWrap = this.createElement('div', { class: 'quick-add-input-wrap' });
        const input = this.createElement('input', { type: 'text', placeholder: 'Search podcast name or paste RSS URL...', autocomplete: 'off' });
        const submit = this.createElement('button', { class: 'btn btn-primary btn-quick-submit', type: 'submit', text: 'Add' });
        inputWrap.append(input, submit);
        form.appendChild(inputWrap);
        const results = this.createElement('div', { class: 'quick-results-container', id: 'fg-quick-results' });
        quickAdd.append(form, results);

        const actions = this.createElement('div', { class: 'empty-actions' });
        const opml = this.createElement('button', { class: 'btn btn-secondary', type: 'button', text: 'Import OPML File' });
        actions.appendChild(opml);

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
        this.elEmptyHost.appendChild(board);

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
            submit.textContent = (val.startsWith('http://') || val.startsWith('https://')) ? 'Add Feed' : 'Search';
            if (this._searchDebounce) clearTimeout(this._searchDebounce);
            if (!val || val.startsWith('http://') || val.startsWith('https://')) { results.innerHTML = ''; return; }
            this._searchDebounce = setTimeout(() => { if (results) this.app.feeds.searchPodcastDirectory(val, results); }, 350);
        });
        this.on(opml, 'click', () => { if (this.app.dom.opmlFileInput) this.app.dom.opmlFileInput.click(); });
        Array.from(sgrid.querySelectorAll('.starter-suggestion-chip')).forEach(chip => {
            this.on(chip, 'click', () => { if (chip.dataset.feed) this.app.feeds.addFeed(chip.dataset.feed); });
        });
    }

    unmount() {
        if (this._searchDebounce) clearTimeout(this._searchDebounce);
        this._clearCards();
        super.unmount();
    }
}

export default FeedsGridComponent;
