import { Router } from 'express';
import { Readable } from 'node:stream';
import { AudioProxyService } from '../services/audioProxyService.js';
import { isValidExternalUrl } from '../utils/url.js';
import { json } from '../utils/response.js';

export class AudioProxyRoutes {
  constructor(deps = {}) {
    this.config = deps.config;
    this.audioProxy = deps.audioProxy ?? new AudioProxyService(deps);
  }

  getRouter() {
    const router = Router();

    router.get('/', async (req, res, next) => {
      try {
        const url = req.query?.url;
        if (!url || typeof url !== 'string') {
          return json(res, 400, { error: 'url parameter is required.' });
        }
        if (!isValidExternalUrl(url)) {
          return json(res, 400, { error: 'Invalid or disallowed url parameter.' });
        }
        const range = req.headers.range;
        const result = await this.audioProxy.fetch({ url, method: 'GET', range });
        res.status(result.status);
        result.headers.forEach((value, key) => res.set(key, value));
        res.set('access-control-allow-origin', this.config.corsOrigin);
        res.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
        res.set('access-control-allow-headers', 'Range, Content-Type, X-Session-Token');
        res.set('access-control-expose-headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
        const stream = Readable.fromWeb(result.body);
        stream.on('error', (err) => next(err));
        stream.pipe(res);
      } catch (err) {
        return next(err);
      }
    });

    return router;
  }
}
