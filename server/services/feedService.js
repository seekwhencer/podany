import { isValidExternalUrl } from '../utils/url.js';
import { PodcastService } from './feed/podcastService.js';
import { YouTubeService } from './feed/youtubeService.js';
import { Subscription } from '../models/Subscription.js';
import { Downloads } from '../models/Downloads.js';

export class FeedService {
    constructor(options = {}) {
        this.podcast = options.podcastService ?? new PodcastService(options);
        this.youtube = options.youtubeService ?? new YouTubeService({ ...options, podcastService: this.podcast });
        this.subscriptions = options.subscriptions ?? new Subscription();
        this.downloads = options.downloads ?? new Downloads();
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

    async getFeedById(userId, feedId) {
        const query =
            `SELECT s.id, s.feed_url, s.title, s.artwork, s.image, s.description, s.category, s.language, s.pubDate, s.created_at,
                (SELECT COUNT(*) FROM downloads d WHERE d.subscription_id = s.id) AS episodes_count
             FROM subscriptions s
             WHERE s.id = ? AND s.user_id = ?`;

        const subscription = await this.subscriptions.findOne(query, [feedId, userId]);

        console.log('>>>', query);

        if (!subscription) {
            return { feed: null, episodes: [] };
        }

        const episodes = await this.downloads.find(
            `SELECT e.id, e.user_id AS userId, e.episode_guid AS guid, e.subscription_id AS subscriptionId,
                    e.title, e.artwork, e.image, e.audio_url AS audioUrl, e.filename, e.file_size AS fileSize,
                    e.status AS downloadStatus, e.progress, e.error, e.created_at AS createdAt,
                    e.updated_at AS updatedAt, e.received_at AS receivedAt, e.timestamp, e.pub_date AS pubDate,
                    e.duration, e.description, e.content, e.is_youtube AS isYouTube, e.playlist_id AS playlistId,
                    CASE WHEN e.playlist_id IS NOT NULL AND e.playlist_id <> '' THEN 1 ELSE 0 END AS isYouTubePlaylist,
                    CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END AS locallyAvailable,
                    s.title AS podcastTitle, s.feed_url AS feedUrl
              FROM downloads e
              JOIN subscriptions s ON s.id = e.subscription_id
              WHERE e.subscription_id = ? AND e.user_id = ?
              ORDER BY e.timestamp DESC, e.created_at DESC`,
            [feedId, userId]
        );

        const feed = {
            id: subscription.id,
            feed_url: subscription.feed_url,
            title: subscription.title,
            artwork: subscription.artwork,
            image: subscription.image,
            description: subscription.description,
            category: subscription.category,
            language: subscription.language,
            pubDate: subscription.pubDate,
            episodesCount: Number(subscription.episodes_count ?? 0)
        };

        return { feed, episodes };
    }
}

export default FeedService;
