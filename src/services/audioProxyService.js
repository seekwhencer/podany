import { isValidExternalUrl } from '../utils/url.js';

const USER_AGENT = 'Podany/1.0 (+SelfHosted)';

const FORWARD_HEADER_NAMES = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag'
];

export class AudioProxyService {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? USER_AGENT;
  }

  corsHeaders() {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, X-Session-Token',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type'
    };
  }

  async fetch({ url, method = 'GET', range }) {
    if (!url || !isValidExternalUrl(url)) {
      throw new Error('Invalid or disallowed url parameter');
    }

    const upstreamHeaders = new Headers();
    if (range) upstreamHeaders.set('Range', range);
    upstreamHeaders.set('User-Agent', this.userAgent);

    const upstreamResponse = await this.fetchImpl(url, { method, headers: upstreamHeaders });

    const headers = new Headers(this.corsHeaders());
    FORWARD_HEADER_NAMES.forEach((name) => {
      const val = upstreamResponse.headers.get(name);
      if (val) headers.set(name, val);
    });
    if (!headers.has('accept-ranges')) {
      headers.set('accept-ranges', 'bytes');
    }

    return {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
      body: upstreamResponse.body
    };
  }
}

export default AudioProxyService;
