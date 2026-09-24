import { Router } from 'express';
import { UserService } from '../services/userService.js';
import { json } from '../utils/response.js';

export function createUserRoutes(deps = {}) {
  const router = Router();
  const service = deps.userService ?? new UserService(deps);

  router.get('/options', async (req, res, next) => {
    try {
      const result = await service.getOptions(req.user.id);
      if (!result) {
        return json(res, 404, { error: 'User not found.' });
      }
      return json(res, 200, result);
    } catch (err) {
      return next(err);
    }
  });

  router.patch('/options', async (req, res, next) => {
    try {
      const { color } = req.body ?? {};
      const result = await service.updateOptions(req.user.id, { color });
      if (!result) {
        return json(res, 404, { error: 'User not found.' });
      }
      return json(res, 200, result);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export default createUserRoutes;
