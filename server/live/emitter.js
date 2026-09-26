import { encode } from './protocol.js';

export class LiveEmitter {
  constructor(deps = {}) {
    this.hub = deps.hub ?? null;
  }

  emit({ userId, type, payload }) {
    if (!this.hub || !userId) return;
    try {
      this.hub.sendToUser(userId, encode(type, payload));
    } catch (err) {
      console.error('[server] LiveEmitter failed to deliver event:', err.message);
    }
  }

  broadcastAll(type, payload) {
    if (!this.hub || typeof this.hub.broadcastAll !== 'function') return;
    try {
      this.hub.broadcastAll(encode(type, payload));
    } catch (err) {
      console.error('[server] LiveEmitter failed to broadcast event:', err.message);
    }
  }
}

export default LiveEmitter;
