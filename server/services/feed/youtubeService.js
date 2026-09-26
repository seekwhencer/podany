import { PodcastService } from './podcastService.js';

const USER_AGENT = 'Podany/1.0 (+SelfHosted)';

export class YouTubeService {
    constructor(options = {}) {
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
        this.userAgent = options.userAgent ?? USER_AGENT;
        this.podcast = options.podcastService ?? new PodcastService(options);
    }

    isYouTubeUrl(inputUrl) {
        try {
            const parsed = new URL(inputUrl);
            if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) {
                return { isYouTube: true, playlistId: parsed.searchParams.get('list') };
            }
        } catch (e) { }
        return { isYouTube: false, playlistId: null };
    }

    async fetchFeed(inputUrl) {
        let playlistId = null;
        try {
            const parsed = new URL(inputUrl);
            playlistId = parsed.searchParams.get('list');
        } catch (e) { }

        if (!playlistId) {
            throw new Error('Invalid or disallowed feed URL parameter.');
        }

        const rssUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
        try {
            const res = await this.fetchImpl(rssUrl, {
                headers: { 'User-Agent': this.userAgent, Accept: 'application/atom+xml, application/xml, text/xml, */*' }
            });
            if (res.ok) {
                const xmlText = await res.text();
                const feedData = this.podcast.parsePodcastXml(xmlText, rssUrl, inputUrl);
                if (feedData.episodes && feedData.episodes.length > 0) {
                    feedData.episodes.forEach((ep) => {
                        if (ep && !ep.playlistId) ep.playlistId = playlistId;
                    });
                    return feedData;
                }
            }
        } catch (err) { }
        return this.fetchYouTubeOEmbedFallback(playlistId, inputUrl);
    }

    async fetchYouTubeOEmbedFallback(playlistId, originalUrl) {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
            `https://www.youtube.com/playlist?list=${playlistId}`
        )}&format=json`;

        const res = await this.fetchImpl(oembedUrl);
        if (!res.ok) {
            throw new Error(`YouTube Playlist (ID: ${playlistId}) not found or is set to Private.`);
        }

        const data = await res.json();
        const title = data.title || 'YouTube Music Podcast Playlist';
        const author = data.author_name || 'YouTube Creator';
        const artwork = data.thumbnail_url || 'https://i.ytimg.com/vi/default.jpg';

        const singleEpisode = {
            guid: `yt-playlist-${playlistId}`,
            title: `${title} (Full Playlist)`,
            description: `YouTube Music Podcast Playlist by ${author}. Click play to stream all episodes in sequence.`,
            pubDate: new Date().toUTCString(),
            timestamp: Date.now(),
            audioUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
            duration: '',
            artwork,
            podcastTitle: title,
            feedUrl: originalUrl,
            isYouTube: true,
            isYouTubePlaylist: true,
            playlistId
        };

        return {
            title,
            description: `YouTube Music Podcast Playlist (${author})`,
            author,
            artwork,
            feedUrl: originalUrl,
            episodesCount: 1,
            updatedAt: new Date().toISOString(),
            episodes: [singleEpisode]
        };
    }
}

export default YouTubeService;
