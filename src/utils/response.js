export function json(res, status, payload, extraHeaders = {}) {
  return res
    .status(status)
    .set({ 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders })
    .send(JSON.stringify(payload));
}

export function error(res, status, message, extraHeaders = {}) {
  return json(res, status, { error: message }, extraHeaders);
}

export function notFound(res, extraHeaders = {}) {
  return error(res, 404, 'Not found', extraHeaders);
}
