// OpmlComponent.js — Podany Opml (Atomic / UI component)
// OPML import (parse RSS outlines, subscribe new feeds) and export (serialize the
// current subscriptions to a downloadable OPML file). Owns its own DOM and drives
// the sync service via app.sync / app.feeds. See FRONTEND_REFACTORING_COMPONENTS.md
// §2, §7, §13.

import { BaseComponent } from '../BaseComponent.js';
import { escapeHtml } from '../utils.js';

export class OpmlComponent extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elImportLabel = null;
        this.elFileInput = null;
        this.elExportBtn = null;
        this.elStatus = null;
    }

    render() {
        const el = this.createElement('div', { class: 'opml-component' });

        this.elStatus = this.createElement('p', { class: 'opml-status' });
        this.elStatus.style.display = 'none';

        const actions = this.createElement('div', { class: 'settings-actions' });
        const importLabel = this.createElement('label', { class: 'btn btn-secondary', text: 'Import OPML File' });
        this.elFileInput = this.createElement('input', { type: 'file', accept: '.opml,.xml' });
        this.elFileInput.style.display = 'none';
        importLabel.appendChild(this.elFileInput);
        this.elExportBtn = this.createElement('button', { class: 'btn btn-secondary', text: 'Export Subscriptions (OPML)' });
        actions.append(importLabel, this.elExportBtn);

        el.append(this.elStatus, actions);

        this.on(this.elFileInput, 'change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) this.importOpml(file);
            e.target.value = '';
        });
        this.on(this.elExportBtn, 'click', () => this.exportOpml());

        return el;
    }

    _setStatus(text, color) {
        if (!this.elStatus) return;
        this.elStatus.style.display = 'block';
        this.elStatus.style.color = color || 'var(--text-secondary)';
        this.elStatus.textContent = text;
    }

    importOpml(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const xmlText = e.target.result;
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlText, 'text/xml');
            const outlines = doc.querySelectorAll('outline[xmlUrl], outline[xmlurl]');

            let addedCount = 0;
            for (const node of outlines) {
                const feedUrl = node.getAttribute('xmlUrl') || node.getAttribute('xmlurl');
                if (!feedUrl) continue;
                const existingId = this.state.feedUrlById[feedUrl];
                if (existingId && this.state.feeds.includes(existingId)) continue;

                const result = await this.app.sync.saveFeedToServer(feedUrl, node.getAttribute('text') || '');
                const id = result && result.id;
                if (id) {
                    this.state.feeds.push(id);
                    this.state.feedUrlById = { ...this.state.feedUrlById, [id]: feedUrl };
                    addedCount++;
                }
            }

            if (addedCount > 0) {
                this.app.storage.saveFeeds(this.state.feeds);
                this.app.feeds.refreshAllFeeds();
                this._setStatus(`Successfully imported ${addedCount} podcast feeds!`, '#22c55e');
            } else {
                this._setStatus('No new podcast feeds found in this OPML file.', 'var(--text-secondary)');
            }
        };
        reader.readAsText(file);
    }

    exportOpml() {
        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>Podany Export</title>\n  </head>\n  <body>\n`;

        this.state.feeds.forEach(id => {
            const meta = this.state.feedMetadata[id] || {};
            const url = this.state.feedUrlById[id] || '';
            const title = meta.title ? escapeHtml(meta.title) : 'Podcast';
            xml += `    <outline type="rss" text="${title}" title="${title}" xmlUrl="${escapeHtml(url)}"/>\n`;
        });

        xml += `  </body>\n</opml>`;

        const blob = new Blob([xml], { type: 'text/xml' });
        const a = this.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'podany_subscriptions.opml';
        a.click();
    }
}

export default OpmlComponent;
