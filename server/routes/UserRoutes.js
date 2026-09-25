import { Router } from 'express';
import { UserService } from '../services/userService.js';
import { json } from '../utils/response.js';

export class UserRoutes {
  constructor(deps = {}) {
    this.service = deps.userService ?? new UserService(deps);
  }

  getRouter() {
    const router = Router();

    router.get('/options', async (req, res, next) => {
      try {
        const result = await this.service.getOptions(req.user.id);
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
        const result = await this.service.updateOptions(req.user.id, { color });
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
}

export default UserRoutes;
