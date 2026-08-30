const BaseWebSocket = window.WebSocket;
const REFRESH_TYPES = new Set([
  'welcome','state','game_start','resume_play','meeting','meeting_result',
  'game_over','lobby_reset','task_done','sabotage','ability_ok','noisemaker',
  'vent_state','correct'
]);

function parse(value) { try { return JSON.parse(String(value)); } catch (_) { return null; } }
function refreshHud() {
  // minimap-hud already listens for resize and performs both visibility and
  // canvas drawing there. Reuse that path rather than exposing its internals.
  try { window.dispatchEvent(new Event('resize')); } catch (_) {}
}
function patchSocket(sock) {
  if (!sock || typeof sock !== 'object' || sock.__dtamMinimapRefresh) return sock;
  Object.defineProperty(sock, '__dtamMinimapRefresh', { value:true, configurable:false });
  if (typeof sock.addEventListener === 'function') {
    sock.addEventListener('message', event => {
      const message = typeof event.data === 'string' ? parse(event.data) : null;
      if (message && REFRESH_TYPES.has(String(message.t || ''))) queueMicrotask(refreshHud);
    });
  }
  return sock;
}

if (typeof BaseWebSocket === 'function' && !window.__DTAM_MINIMAP_REFRESH_INSTALLED__) {
  window.__DTAM_MINIMAP_REFRESH_INSTALLED__ = true;
  const WrappedWebSocket = new Proxy(BaseWebSocket, {
    construct(Target, args) { return patchSocket(Reflect.construct(Target, args, Target)); }
  });
  for (const key of ['CONNECTING','OPEN','CLOSING','CLOSED']) {
    try { Object.defineProperty(WrappedWebSocket, key, { value:BaseWebSocket[key] }); } catch (_) {}
  }
  window.WebSocket = WrappedWebSocket;
}

console.log('DTAM minimap authoritative refresh ready');
