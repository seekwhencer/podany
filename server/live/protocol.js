const DEFAULT_WEBSOCKET_PATH = '/live';

const EVENT_CONNECTION_HELLO = 'connection:hello';
const EVENT_PING = 'ping';
const EVENT_PONG = 'pong';
const EVENT_DOWNLOAD_PROGRESS = 'download:progress';
const EVENT_DOWNLOAD_COMPLETED = 'download:completed';
const EVENT_DOWNLOAD_FAILED = 'download:failed';
const EVENT_DOWNLOAD_ALL_FROM_SUBSCRIPTION_COMPLETED = 'download:all-subscription-downloads-completed';
const EVENT_IMAGE_COMPLETED = 'image:completed';
const EVENT_THUMBNAIL_READY = 'thumbnail:ready';
const EVENT_SUBSCRIPTION_ADDED = 'subscription:added';
const EVENT_SUBSCRIPTION_REMOVED = 'subscription:removed';
const EVENT_PLAYBACK_POSITION_UPDATED = 'playback:position-updated';
const EVENT_SESSION_CLOSED = 'session:closed';
const EVENT_ERROR = 'error';

const EVENT_NAMES = new Set([
  EVENT_CONNECTION_HELLO,
  EVENT_PING,
  EVENT_PONG,
  EVENT_DOWNLOAD_PROGRESS,
  EVENT_DOWNLOAD_COMPLETED,
  EVENT_DOWNLOAD_FAILED,
  EVENT_DOWNLOAD_ALL_FROM_SUBSCRIPTION_COMPLETED,
  EVENT_IMAGE_COMPLETED,
  EVENT_THUMBNAIL_READY,
  EVENT_SUBSCRIPTION_ADDED,
  EVENT_SUBSCRIPTION_REMOVED,
  EVENT_PLAYBACK_POSITION_UPDATED,
  EVENT_SESSION_CLOSED,
  EVENT_ERROR
]);

function normalizePath(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return DEFAULT_WEBSOCKET_PATH;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function resolveWebSocketPath(config) {
  const value = config?.websOCKETPath ?? config?.WEBSOCKET_PATH ?? config?.websocketPath ?? DEFAULT_WEBSOCKET_PATH;
  return normalizePath(value);
}

const WEBSOCKET_PATH = DEFAULT_WEBSOCKET_PATH;

function encode(type, payload) {
  return JSON.stringify({ type, payload: payload || {} });
}

function decode(raw) {
  if (typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
    return null;
  }
  const payload = parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : {};
  return { type: parsed.type, payload };
}

export {
  WEBSOCKET_PATH,
  DEFAULT_WEBSOCKET_PATH,
  EVENT_CONNECTION_HELLO,
  EVENT_PING,
  EVENT_PONG,
  EVENT_DOWNLOAD_PROGRESS,
  EVENT_DOWNLOAD_COMPLETED,
  EVENT_DOWNLOAD_FAILED,
  EVENT_DOWNLOAD_ALL_FROM_SUBSCRIPTION_COMPLETED,
  EVENT_IMAGE_COMPLETED,
  EVENT_THUMBNAIL_READY,
  EVENT_SUBSCRIPTION_ADDED,
  EVENT_SUBSCRIPTION_REMOVED,
  EVENT_PLAYBACK_POSITION_UPDATED,
  EVENT_SESSION_CLOSED,
  EVENT_ERROR,
  EVENT_NAMES,
  normalizePath,
  resolveWebSocketPath,
  encode,
  decode
};
