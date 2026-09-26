import { Router } from 'express';
import { PlaybackService } from '../services/playbackService.js';
import { json } from '../utils/response.js';
import { EVENT_PLAYBACK_POSITION_UPDATED } from '../live/protocol.js';

function isString(value) {
  return typeof value === 'string' && value.length > 0;
}

export class PlaybackRoutes {
  constructor(deps = {}) {
    this.playback = deps.playback ?? new PlaybackService(deps);
    this.liveEmitter = deps.liveEmitter ?? null;
  }

  _emit(type, payload, userId) {
    if (!this.liveEmitter || !userId) return;
    try {
      this.liveEmitter.emit({ userId, type, payload });
    } catch (err) {
      console.error('[server] LiveEmitter failed to deliver playback event:', err.message);
    }
  }

  getRouter() {
    const router = Router();

    router.get('/positions', async (req, res, next) => {
      try {
        const result = await this.playback.listPositions(req.user.id);
        return json(res, 200, result);
      } catch (err) {
        return next(err);
      }
    });

    router.post('/positions', async (req, res, next) => {
      try {
        const { episodeGuid, positionSeconds, completed } = req.body ?? {};
        if (!isString(episodeGuid)) {
          return json(res, 400, { error: 'episodeGuid is required.' });
        }
        const result = await this.playback.savePosition({
          userId: req.user.id,
          episodeGuid,
          positionSeconds: Number.isFinite(Number(positionSeconds)) ? Number(positionSeconds) : 0,
          completed: Boolean(completed)
        });
        this._emit(EVENT_PLAYBACK_POSITION_UPDATED, {
          episodeGuid,
          positionSeconds: Number.isFinite(Number(positionSeconds)) ? Number(positionSeconds) : 0,
          completed: Boolean(completed)
        }, req.user.id);
        return json(res, 200, result);
      } catch (err) {
        return next(err);
      }
    });

    router.delete('/positions', async (req, res, next) => {
      try {
        const { episodeGuid } = req.body ?? {};
        if (!isString(episodeGuid)) {
          return json(res, 400, { error: 'episodeGuid is required.' });
        }
        const result = await this.playback.removePosition(req.user.id, episodeGuid);
        this._emit(EVENT_PLAYBACK_POSITION_UPDATED, { episodeGuid, positionSeconds: null, completed: false }, req.user.id);
        return json(res, 200, result);
      } catch (err) {
        return next(err);
      }
    });

    return router;
  }
}

export default PlaybackRoutes;
