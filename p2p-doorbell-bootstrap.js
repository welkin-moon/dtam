const SIGNAL_HOST = 'p2p-signal.lunarlab.uk';
const BELL = 'https://p2p-bell.lunarlab.uk';

// hybrid-transport replaces window.WebSocket with an in-page transport. Keep a
// reference to the browser implementation for the independent wake-up socket.
if (!window.__DTAM_NATIVE_WEBSOCKET__) window.__DTAM_NATIVE_WEBSOCKET__ = window.WebSocket;

const stats = window.__DTAM_BELL__ = window.__DTAM_BELL__ || {
  connected:false,
  room:'',
  notified:0,
  delivered:0,
  wakeups:0,
  reconnects:0,
  lastError:'',
  lastNotifyAt:0,
  lastWakeAt:0,
};

if (!window.__DTAM_BELL_FETCH_INSTALLED__) {
  window.__DTAM_BELL_FETCH_INSTALLED__ = true;
  const baseFetch = window.fetch.bind(window);

  function joinRequest(input, init = {}) {
    try {
      const request = input instanceof Request ? input : null;
      const url = new URL(request ? request.url : String(input), location.href);
      const method = String(init.method || request?.method || 'GET').toUpperCase();
      const match = url.hostname === SIGNAL_HOST && method === 'POST'
        ? url.pathname.match(/^\/v2\/rooms\/(\d{2})\/join$/)
        : null;
      return match ? { room:match[1] } : null;
    } catch (_) { return null; }
  }

  async function notify(room, data) {
    const peerId = String(data?.peerId || '');
    const joinToken = String(data?.joinToken || '');
    if (!peerId || !joinToken) return;
    stats.notified++;
    stats.lastNotifyAt = Date.now();
    try {
      const response = await baseFetch(`${BELL}/v1/rooms/${room}/notify`, {
        method:'POST', cache:'no-store', keepalive:true,
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ peerId, joinToken }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        stats.delivered += Number(result.delivered || 0);
        stats.lastError = '';
      } else stats.lastError = `notify ${response.status}`;
    } catch (error) {
      // Doorbell is an acceleration path only. The existing D1 mailbox remains
      // authoritative and polling continues when this request fails.
      stats.lastError = String(error?.message || error);
    }
  }

  window.fetch = async function dtamDoorbellFetch(input, init = {}) {
    const join = joinRequest(input, init);
    const response = await baseFetch(input, init);
    if (join && response.ok) {
      response.clone().json().then(data => notify(join.room, data)).catch(() => {});
    }
    return response;
  };
}

console.log('DTAM P2P doorbell bootstrap ready');
