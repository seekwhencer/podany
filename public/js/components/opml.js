// opml.js — Podany Opml
// OPML import (parse RSS outlines, subscribe new feeds) and export (serialize
// current subscriptions to a downloadable OPML file).

import { escapeHtml } from '../utils.js';

export class Opml {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
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
                alert(`Successfully imported ${addedCount} podcast feeds!`);
            } else {
                alert('No new podcast feeds found in this OPML file.');
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
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'podany_subscriptions.opml';
        a.click();
    }
}

export default Opml;
