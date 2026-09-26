import { Router } from 'express';
import path from 'node:path';

const IMAGE_NAME_PATTERN = /^[0-9a-f]+(?:-full|-large|-thumb)\.jpg$/i;

export class ImageRoutes {
  constructor(deps = {}) {
    this.config = deps.config;
  }

  getRouter() {
    const router = Router();

    router.get('/:imagename', (req, res, next) => {
      try {
        const imagename = req.params.imagename;
        if (!imagename || typeof imagename !== 'string' || !IMAGE_NAME_PATTERN.test(imagename)) {
          return res.status(400).type('text/plain').send('Invalid image name.');
        }

        const baseDir = path.resolve(this.config.thumbnailStorageDir);
        const filePath = path.resolve(baseDir, imagename);
        if (filePath !== baseDir && !filePath.startsWith(baseDir + path.sep)) {
          return res.status(403).type('text/plain').send('Forbidden.');
        }

        return res.sendFile(filePath);
      } catch (err) {
        return next(err);
      }
    });

    return router;
  }
}

export default ImageRoutes;
