(() => {
  'use strict';

  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket || window.__dtamStableWebSocketInstalled) return;
  window.__dtamStableWebSocketInstalled = true;

  class StableWebSocket extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      this.__dtamSelfId = '';
      this.__dtamLastLocalPos = null;
      this.__dtamRedispatching = false;

      super.addEventListener('message', (event) => {
        if (this.__dtamRedispatching || typeof event.data !== 'string') return;

        let msg;
        try { msg = JSON.parse(event.data); } catch (_) { return; }
        if (!msg || typeof msg.t !== 'string') return;

        if (msg.t === 'welcome') {
          this.__dtamSelfId = String(msg.self?.id || '');
          const self = Array.isArray(msg.players)
            ? msg.players.find(p => String(p?.id || '') === this.__dtamSelfId)
            : Object.values(msg.players || {}).find(p => String(p?.id || '') === this.__dtamSelfId);
          if (self?.pos && Number.isFinite(Number(self.pos.x)) && Number.isFinite(Number(self.pos.y))) {
            this.__dtamLastLocalPos = { x: Number(self.pos.x), y: Number(self.pos.y) };
          }
          return;
        }

        if (msg.t !== 'state' || !this.__dtamSelfId || !this.__dtamLastLocalPos) return;

        const list = Array.isArray(msg.players) ? msg.players : Object.values(msg.players || {});
        const self = list.find(p => String(p?.id || '') === this.__dtamSelfId);
        if (!self?.pos) return;

        // Generic room snapshots are delayed by RTT. Feeding the local player's
        // old server position back into client prediction causes visible rollback.
        // Keep room metadata from the snapshot, but preserve the latest local
        // predicted position. Explicit server corrections remain unmodified.
        self.pos = { ...this.__dtamLastLocalPos };

        event.stopImmediatePropagation();
        this.__dtamRedispatching = true;
        try {
          this.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify(msg),
            origin: event.origin,
            lastEventId: event.lastEventId
          }));
        } finally {
          this.__dtamRedispatching = false;
        }
      });
    }

    send(data) {
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          if (msg?.t === 'pos') {
            const x = Number(msg.x), y = Number(msg.y);
            if (Number.isFinite(x) && Number.isFinite(y)) this.__dtamLastLocalPos = { x, y };
          }
        } catch (_) {}
      }
      return super.send(data);
    }
  }

  window.WebSocket = StableWebSocket;
})();
