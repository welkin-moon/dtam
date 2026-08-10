(() => {
  'use strict';

  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket || window.__dtamStableWebSocketInstalled) return;
  window.__dtamStableWebSocketInstalled = true;

  function patchSocket(ws) {
    let selfId = '';
    let lastLocalPos = null;
    let redispatching = false;

    const nativeSend = ws.send.bind(ws);
    ws.send = (data) => {
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          if (msg?.t === 'pos') {
            const x = Number(msg.x), y = Number(msg.y);
            if (Number.isFinite(x) && Number.isFinite(y)) lastLocalPos = { x, y };
          }
        } catch (_) {}
      }
      return nativeSend(data);
    };

    ws.addEventListener('message', (event) => {
      if (redispatching || typeof event.data !== 'string') return;

      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (!msg || typeof msg.t !== 'string') return;

      if (msg.t === 'welcome') {
        selfId = String(msg.self?.id || '');
        const self = Array.isArray(msg.players)
          ? msg.players.find(p => String(p?.id || '') === selfId)
          : Object.values(msg.players || {}).find(p => String(p?.id || '') === selfId);
        if (self?.pos && Number.isFinite(Number(self.pos.x)) && Number.isFinite(Number(self.pos.y))) {
          lastLocalPos = { x: Number(self.pos.x), y: Number(self.pos.y) };
        }
        return;
      }

      if (msg.t !== 'state' || !selfId || !lastLocalPos) return;
      const list = Array.isArray(msg.players) ? msg.players : Object.values(msg.players || {});
      const self = list.find(p => String(p?.id || '') === selfId);
      if (!self?.pos) return;

      // Room snapshots arrive one RTT behind local prediction. Keep the room
      // metadata, but never feed that delayed local coordinate back into the
      // prediction loop; doing so causes visible rollback/jitter at high RTT.
      self.pos = { ...lastLocalPos };

      event.stopImmediatePropagation();
      redispatching = true;
      try {
        ws.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify(msg),
          origin: event.origin,
          lastEventId: event.lastEventId
        }));
      } finally {
        redispatching = false;
      }
    });

    return ws;
  }

  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args, NewTarget) {
      const ws = Reflect.construct(Target, args, Target);
      return patchSocket(ws);
    }
  });
})();
