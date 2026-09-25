import { isValidExternalUrl } from '../../utils/url.js';

const USER_AGENT = 'Podany/1.0 (+SelfHosted)';
const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*';

export class PodcastService {
    constructor(options = {}) {
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
        this.userAgent = options.userAgent ?? USER_AGENT;
        this.accept = options.accept ?? ACCEPT;
    }

    async fetchFeed(inputUrl) {
        if (!isValidExternalUrl(inputUrl)) {
            throw new Error('Invalid or disallowed feed URL parameter.');
        }

        const response = await this.fetchImpl(inputUrl, {
            headers: { 'User-Agent': this.userAgent, Accept: this.accept }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Unable to fetch feed`);
        }

        const xmlText = await response.text();
        return this.parsePodcastXml(xmlText, inputUrl, inputUrl);
    }

    parsePodcastXml(xml, feedUrl, originalUrl) {
        const getTagContent = (xmlSegment, tagName) => {
            const regex = new RegExp(
                `<(${tagName}|itunes:${tagName}|yt:${tagName}|media:${tagName})[^>]*>([\\s\\S]*?)<\\/\\1\\b[^>]*>`,
                'i'
            );
            const match = xmlSegment.match(regex);
            return match && match[2] ? cleanText(match[2]) : '';
        };

        const getAttribute = (xmlSegment, tagName, attrName) => {
            const regex = new RegExp(
                `<(${tagName}|itunes:${tagName}|yt:${tagName}|media:${tagName})[^>]*\\b${attrName}=["']([^"']+)["'][^>]*>`,
                'i'
            );
            const match = xmlSegment.match(regex);
            return match ? match[2] : '';
        };

        const getRawTagContent = (xmlSegment, tagName) => {
            const regex = new RegExp(
                `<(${tagName}|content:${tagName}|itunes:${tagName}|yt:${tagName}|media:${tagName})[^>]*>([\\s\\S]*?)<\\/\\1\\b[^>]*>`,
                'i'
            );
            const match = xmlSegment.match(regex);
            if (!match || !match[2]) return '';
            let val = match[2];
            val = val.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
            return val;
        };

        const cleanText = (str) => {
            if (!str) return '';
            return str
                .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
                .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
                .replace(/&ndash;/g, '–')
                .replace(/&mdash;/g, '—')
                .replace(/&hellip;/g, '…')
                .replace(/&bull;/g, '•')
                .replace(/&rsquo;/g, '’')
                .replace(/&lsquo;/g, '‘')
                .replace(/&rdquo;/g, '”')
                .replace(/&ldquo;/g, '“')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        };

        const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"');

        let title = '';
        let description = '';
        let author = '';
        let artwork = '';
        let link = '';

        if (isAtom) {
            title = getTagContent(xml, 'title') || 'YouTube Podcast Feed';
            author = getTagContent(xml, 'name') || 'YouTube Creator';
            description = `YouTube Playlist Feed (${originalUrl})`;
            link = getAttribute(xml, 'link', 'href') || originalUrl;
        } else {
            const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i);
            const channelXml = channelMatch ? channelMatch[1] : xml;

            title = getTagContent(channelXml, 'title') || 'Untitled Podcast';
            description = getTagContent(channelXml, 'description') || getTagContent(channelXml, 'summary');
            author = getTagContent(channelXml, 'author') || getTagContent(channelXml, 'owner');
            link = getTagContent(channelXml, 'link') || getAttribute(channelXml, 'link', 'href') || '';

            artwork = getAttribute(channelXml, 'image', 'href') || getAttribute(channelXml, 'itunes:image', 'href');
            if (!artwork) {
                const imageTag = channelXml.match(/<image[^>]*>([\s\S]*?)<\/image>/i);
                if (imageTag) artwork = getTagContent(imageTag[1], 'url');
            }
            if (artwork && artwork.startsWith('http://')) {
                artwork = artwork.replace(/^http:\/\//i, 'https://');
            }
        }

        const items = [];

        if (isAtom) {
            const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
            let entryMatch;
            while ((entryMatch = entryRegex.exec(xml)) !== null) {
                const entryXml = entryMatch[1];
                const epTitle = getTagContent(entryXml, 'title') || 'Untitled Video';
                const epVideoId = getTagContent(entryXml, 'videoId');
                const epGuid = getTagContent(entryXml, 'id') || epVideoId;
                const epPubDate = getTagContent(entryXml, 'published') || getTagContent(entryXml, 'updated');
                const rawEntryContent =
                    getRawTagContent(entryXml, 'content') ||
                    getRawTagContent(entryXml, 'summary') ||
                    getRawTagContent(entryXml, 'description');
                const epDesc =
                    getTagContent(entryXml, 'description') || getTagContent(entryXml, 'summary') || cleanText(rawEntryContent);
                const epThumb = getAttribute(entryXml, 'media:thumbnail', 'url');

                let audioUrl = getAttribute(entryXml, 'media:content', 'url');
                const alternateLink = getAttribute(entryXml, 'link', 'href');

                if (!audioUrl && epVideoId) {
                    audioUrl = `https://www.youtube.com/watch?v=${epVideoId}`;
                } else if (!audioUrl && alternateLink) {
                    audioUrl = alternateLink;
                }

                let timestamp = 0;
                if (epPubDate) {
                    const parsed = Date.parse(epPubDate);
                    if (!isNaN(parsed)) timestamp = parsed;
                }

                if (audioUrl) {
                    items.push({
                        guid: epGuid,
                        title: epTitle,
                        description: epDesc ? (epDesc.substring(0, 240) + (epDesc.length > 240 ? '...' : '')) : '',
                        content: rawEntryContent || epDesc,
                        pubDate: epPubDate,
                        timestamp,
                        audioUrl,
                        duration: '',
                        artwork: epThumb || artwork,
                        podcastTitle: title,
                        feedUrl: originalUrl,
                        isYouTube: true,
                        videoId: epVideoId
                    });
                }
            }
        } else {
            const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
            let itemMatch;
            while ((itemMatch = itemRegex.exec(xml)) !== null) {
                const itemXml = itemMatch[1];
                const epTitle = getTagContent(itemXml, 'title') || 'Untitled Episode';
                const epGuid = getTagContent(itemXml, 'guid') || getTagContent(itemXml, 'link') || epTitle;
                const epPubDate = getTagContent(itemXml, 'pubDate') || getTagContent(itemXml, 'published');
                const rawContent =
                    getRawTagContent(itemXml, 'encoded') ||
                    getRawTagContent(itemXml, 'description') ||
                    getRawTagContent(itemXml, 'summary');
                const epDescription =
                    getTagContent(itemXml, 'description') || getTagContent(itemXml, 'summary') || cleanText(rawContent);
                let epDuration = getTagContent(itemXml, 'duration');
                if (epDuration === '0:00' || epDuration === '0' || epDuration === '00:00' || epDuration === '00:00:00') {
                    epDuration = '';
                }

                let audioUrl = getAttribute(itemXml, 'enclosure', 'url') || getAttribute(itemXml, 'media:content', 'url');
                let epArtwork =
                    getAttribute(itemXml, 'image', 'href') || getAttribute(itemXml, 'itunes:image', 'href') || artwork;
                if (epArtwork && epArtwork.startsWith('http://')) {
                    epArtwork = epArtwork.replace(/^http:\/\//i, 'https://');
                }

                let timestamp = 0;
                if (epPubDate) {
                    const parsed = Date.parse(epPubDate);
                    if (!isNaN(parsed)) timestamp = parsed;
                }

                if (audioUrl) {
                    items.push({
                        guid: epGuid,
                        title: epTitle,
                        description: epDescription ? (epDescription.substring(0, 240) + (epDescription.length > 240 ? '...' : '')) : '',
                        content: rawContent || epDescription,
                        pubDate: epPubDate,
                        timestamp,
                        audioUrl,
                        duration: epDuration || '',
                        artwork: epArtwork,
                        podcastTitle: title,
                        feedUrl: originalUrl
                    });
                }
            }
        }

        items.sort((a, b) => b.timestamp - a.timestamp);

        return {
            title,
            description: description.substring(0, 500),
            author,
            artwork: artwork || (items.length > 0 ? items[0].artwork : ''),
            link: link || originalUrl,
            feedUrl: originalUrl,
            episodesCount: items.length,
            updatedAt: new Date().toISOString(),
            episodes: items.slice(0, 2000)
        };
    }
}

export default PodcastService;
