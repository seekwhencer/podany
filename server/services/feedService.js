import { isValidExternalUrl } from '../utils/url.js';
import { PodcastService } from './feed/podcastService.js';
import { YouTubeService } from './feed/youtubeService.js';

export class FeedService {
    constructor(options = {}) {
        this.podcast = options.podcastService ?? new PodcastService(options);
        this.youtube = options.youtubeService ?? new YouTubeService({ ...options, podcastService: this.podcast });
    }

    async fetchFeeds(urls) {
        const validUrls = (urls || []).filter((u) => typeof u === 'string' && isValidExternalUrl(u));
        const results = await Promise.allSettled(validUrls.map((u) => this.fetchFeed(u)));
        return results
            .filter((r) => r.status === 'fulfilled' && r.value)
            .map((r) => r.value);
    }

    async fetchFeed(inputUrl) {
        if (!isValidExternalUrl(inputUrl)) {
            throw new Error('Invalid or disallowed feed URL parameter.');
        }

        const youtube = this.youtube.isYouTubeUrl(inputUrl);
        if (youtube.isYouTube && youtube.playlistId) {
            return this.youtube.fetchFeed(inputUrl);
        }

        return this.podcast.fetchFeed(inputUrl);
    }
}

export default FeedService;
