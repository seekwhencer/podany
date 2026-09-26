import { WebSocketServer } from 'ws';

import {
  WEBSOCKET_PATH,
  EVENT_CONNECTION_HELLO,
  EVENT_PING,
  EVENT_PONG,
  encode
} from './protocol.js';
import { getSessionToken } from '../middleware/auth.js';

export class LiveHub {
  constructor(deps = {}) {
    this.auth = deps.auth ?? null;
    this.config = deps.config ?? null;
    this.wss = null;
    this.socketsByUser = new Map();
    this.wsToUser = new Map();
    this.pongState = new Map();
    this.heartbeatTimer = null;
    this.attached = false;
  }

  get websocketPath() {
    const raw = this.config?.websocketPath;
    if (raw) {
      const value = String(raw).trim();
      if (value !== '') return value.startsWith('/') ? value : `/${value}`;
    }
    return WEBSOCKET_PATH;
  }

  get heartbeatIntervalMs() {
    return this.config?.websocketHeartbeatIntervalMs ?? 30000;
  }

  get heartbeatTimeoutMs() {
    return this.config?.websocketHeartbeatTimeoutMs ?? 60000;
  }

  _heartbeatThreshold() {
    const interval = this.heartbeatIntervalMs;
    const timeout = this.heartbeatTimeoutMs;
    const base = Math.ceil(timeout / Math.max(1, interval));
    return Math.max(2, base);
  }

  attach(server) {
    if (!server || this.attached) return this;
    this.wss = new WebSocketServer({ noServer: true });
    this.attached = true;

    server.on('upgrade', (req, socket, head) => {
      this._handleUpgrade(req, socket, head).catch((err) => {
        console.error('[server] LiveHub upgrade error:', err.message);
        try { socket.destroy(); } catch (_) {}
      });
    });

    this.startHeartbeat();
    return this;
  }

  async _handleUpgrade(req, socket, head) {
    const pathname = String(req.url || '').split('?')[0];
    if (pathname !== this.websocketPath) {
      this._reject(socket);
      return;
    }

    const token = this.auth ? getSessionToken(req, this.config?.sessionCookieName) : null;
    if (!token) {
      this._reject(socket);
      return;
    }

    let user;
    try {
      user = await this.auth.resolveUser(token);
    } catch (err) {
      user = null;
    }

    if (!user || !user.id) {
      this._reject(socket);
      return;
    }

    const wss = this.wss;
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      this._onConnected(ws);
    });
  }

  _reject(socket) {
    try {
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\n' +
        'Connection: close\r\n' +
        'Content-Length: 0\r\n' +
        '\r\n'
      );
    } catch (_) {}
    try { socket.destroy(); } catch (_) {}
  }

  _onConnected(ws) {
    const userId = ws.user.id;
    let set = this.socketsByUser.get(userId);
    if (!set) {
      set = new Set();
      this.socketsByUser.set(userId, set);
    }
    set.add(ws);
    this.wsToUser.set(ws, userId);
    this.pongState.set(ws, { missed: 0 });

    // handleUpgrade's callback fires only after the socket is OPEN, so send the
    // initial hello directly instead of waiting for an 'open' event.
    this._send(ws, encode(EVENT_CONNECTION_HELLO, { server: 'podany', ts: Date.now() }));

    ws.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString();
      if (text === EVENT_PONG) {
        const state = this.pongState.get(ws);
        if (state) state.missed = 0;
      }
    });

    ws.on('close', () => this._unregister(ws));
    ws.on('error', () => {});
  }

  _unregister(ws) {
    const userId = this.wsToUser.get(ws);
    if (userId) {
      const set = this.socketsByUser.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) this.socketsByUser.delete(userId);
      }
    }
    this.wsToUser.delete(ws);
    this.pongState.delete(ws);
    try { ws.terminate(); } catch (_) {}
  }

  sendToUser(userId, encodedMsg) {
    const set = this.socketsByUser.get(userId);
    if (!set || set.size === 0) return;
    for (const ws of set) this._send(ws, encodedMsg);
  }

  broadcastAll(encodedMsg) {
    for (const set of this.socketsByUser.values()) {
      for (const ws of set) this._send(ws, encodedMsg);
    }
  }

  _send(ws, msg) {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(msg);
    } catch (err) {
      console.error('[server] LiveHub send failed:', err.message);
    }
  }

  startHeartbeat() {
    if (this.heartbeatTimer || !this.attached) return;
    this.heartbeatTimer = setInterval(() => this._tick(), this.heartbeatIntervalMs);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _tick() {
    const now = Date.now();
    const threshold = this._heartbeatThreshold();
    for (const [ws, state] of this.pongState) {
      this._send(ws, encode(EVENT_PING, { ts: now }));
      state.missed += 1;
      if (state.missed >= threshold) {
        try { ws.terminate(); } catch (_) {}
      }
    }
  }

  get userCount() {
    return this.socketsByUser.size;
  }

  get socketCount() {
    let n = 0;
    for (const set of this.socketsByUser.values()) n += set.size;
    return n;
  }

  close() {
    this.stopHeartbeat();
    for (const ws of this.wsToUser.keys()) {
      try { ws.terminate(); } catch (_) {}
    }
    this.socketsByUser.clear();
    this.wsToUser.clear();
    this.pongState.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.attached = false;
  }
}

export default LiveHub;
