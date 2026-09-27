import { Router } from 'express';
import { DownloadsService } from '../services/downloadsService.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { json } from '../utils/response.js';

function isString(value) {
  return typeof value === 'string' && value.length > 0;
}

export class DownloadsRoutes {
  constructor(deps = {}) {
    this.downloads = deps.downloads ?? new DownloadsService(deps);
    const authDeps = deps.authDeps ?? {};
    const sessions = deps.sessions;
    this.requireAuth = createAuthMiddleware({ ...authDeps, sessions, auth: deps.auth });
  }

  getRouter() {
    const router = Router();
    router.use(this.requireAuth);

    router.get('/', async (req, res, next) => {
      try {
        const items = await this.downloads.listByUser(req.user.id);
        return json(res, 200, { downloads: items });
      } catch (err) {
        return next(err);
      }
    });

    router.get('/serve/:id', async (req, res, next) => {
      try {
        const id = req.params?.id;
        if (!isString(id)) {
          return json(res, 400, { error: 'id parameter is required.' });
        }
        const record = await this.downloads.getForPlayback(req.user.id, id);
        if (!record) {
          return json(res, 404, { error: 'Downloaded episode not available.' });
        }
        return this.downloads.serve(record, req, res);
      } catch (err) {
        return next(err);
      }
    });

    router.post('/', async (req, res, next) => {
      try {
        const body = req.body ?? {};
        const episodeId = body.episodeId;
        const { title, audioUrl } = body;
        if (!isString(episodeId)) {
          return json(res, 400, { error: 'episodeId is required.' });
        }
        const record = await this.downloads.register({ userId: req.user.id, episodeGuid: episodeId, title, audioUrl });
        return json(res, 200, { success: true, download: record });
      } catch (err) {
        return next(err);
      }
    });

    router.post('/:id/start', async (req, res, next) => {
      try {
        const record = await this.downloads.findById(req.params.id);
        if (!record || record.user_id !== req.user.id) {
          return json(res, 404, { error: 'Download not found.' });
        }
        const updated = await this.downloads.startDownload(record);
        return json(res, 200, { success: true, download: updated });
      } catch (err) {
        return next(err);
      }
    });

    router.delete('/', async (req, res, next) => {
      try {
        const body = req.body ?? {};
        const episodeId = body.episodeId;
        if (!isString(episodeId)) {
          return json(res, 400, { error: 'episodeId is required.' });
        }
        const result = await this.downloads.remove(req.user.id, episodeId);
        return json(res, 200, result);
      } catch (err) {
        return next(err);
      }
    });

    router.delete('/:id', async (req, res, next) => {
      try {
        const result = await this.downloads.deleteById(req.params.id);
        return json(res, 200, result);
      } catch (err) {
        return next(err);
      }
    });

    return router;
  }
}
