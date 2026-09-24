import { error } from '../utils/response.js';

export function notFoundHandler(req, res, next) {
  return error(res, 404, 'Not found');
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const isParseError = err.type === 'entity.parse.failed' || err instanceof SyntaxError;
  const status = err.status || (isParseError ? 400 : 500);
  const message = status < 500 ? (err.message || 'Error') : 'Internal server error';

  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, err);
  }

  return error(res, status, message);
}

export default errorHandler;
