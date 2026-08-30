const NativeWebSocket = window.__DTAM_NATIVE_WEBSOCKET__;
const BaseWebSocket = window.WebSocket;
const BELL_WS = 'wss://p2p-bell.lunarlab.uk';
const stats = window.__DTAM_BELL__ = window.__DTAM_BELL__ || {};
const RETRY_MS = [300, 700, 1500, 3000, 6000, 12000, 30000];

function update(extra = {}) {
  Object.assign(stats, extra);
  try { window.dispatchEvent(new CustomEvent('dtam-network-quality', { detail:{ ...window.__DTAM_NET__ } })); } catch (_) {}
}

function stopBell(sock) {
  clearTimeout(sock.__dtamBellRetryTimer);
  sock.__dtamBellRetryTimer = null;
  const ws = sock.__dtamBellSocket;
  sock.__dtamBellSocket = null;
  if (ws) try { ws.close(1000, 'host socket closed'); } catch (_) {}
  if (stats.owner === sock) update({ connected:false, room:'' });
}

function scheduleReconnect(sock) {
  if (sock.closed || !sock.auth || !sock.mb || sock.__dtamBellRetryTimer) return;
  const i = Math.min(Number(sock.__dtamBellRetryAttempt || 0), RETRY_MS.length - 1);
  const delay = RETRY_MS[i];
  sock.__dtamBellRetryAttempt = Math.min(i + 1, RETRY_MS.length - 1);
  sock.__dtamBellRetryTimer = setTimeout(() => {
    sock.__dtamBellRetryTimer = null;
    connectBell(sock);
  }, delay);
}

function handleWake(sock, text) {
  let message = null;
  try { message = JSON.parse(String(text)); } catch (_) { return; }
  if (message?.t === 'ready') {
    sock.__dtamBellRetryAttempt = 0;
    update({ connected:true, room:sock.room, owner:sock, lastError:'' });
    return;
  }
  if (message?.t !== 'join') return;
  const peerId = String(message.peerId || '');
  if (!/^[a-f0-9]{16,64}$/i.test(peerId) || sock.closed || !sock.mb || !sock.auth) return;
  stats.wakeups = Number(stats.wakeups || 0) + 1;
  stats.lastWakeAt = Date.now();
  // Mailbox.peer() stores the peer in mb.peers synchronously before awaiting
  // ICE, so the normal D1 poll cannot race into a duplicate connection.
  if (!sock.mb.peers.has(peerId)) {
    sock.mb.peer(peerId).catch(error => {
      stats.lastError = String(error?.message || error);
    });
  }
}

function connectBell(sock) {
  if (typeof NativeWebSocket !== 'function' || sock.closed || !sock.auth || !sock.mb) return;
  const token = String(sock.mb.hostToken || '');
  const room = String(sock.room || '');
  if (!/^\d{2}$/.test(room) || token.length < 32) return;
  const current = sock.__dtamBellSocket;
  if (current && (current.readyState === NativeWebSocket.OPEN || current.readyState === NativeWebSocket.CONNECTING)) return;

  let ws;
  try { ws = new NativeWebSocket(`${BELL_WS}/v1/rooms/${room}/host?hostToken=${encodeURIComponent(token)}`); }
  catch (error) { stats.lastError = String(error?.message || error); return scheduleReconnect(sock); }
  sock.__dtamBellSocket = ws;
  update({ room, owner:sock });

  ws.onopen = () => { sock.__dtamBellRetryAttempt = 0; update({ connected:true, room, owner:sock, lastError:'' }); };
  ws.onmessage = event => handleWake(sock, event.data);
  ws.onerror = () => { stats.lastError = 'doorbell websocket error'; };
  ws.onclose = event => {
    if (sock.__dtamBellSocket === ws) sock.__dtamBellSocket = null;
    if (stats.owner === sock) update({ connected:false });
    if (!sock.closed && event.code !== 1000) {
      stats.reconnects = Number(stats.reconnects || 0) + 1;
      scheduleReconnect(sock);
    }
  };
}

function waitForMailbox(sock, attempt = 0) {
  if (sock.closed) return;
  if (sock.auth && sock.mb?.hostToken) return connectBell(sock);
  if (attempt >= 30) return;
  setTimeout(() => waitForMailbox(sock, attempt + 1), Math.min(300, 30 + attempt * 15));
}

function patchSocket(sock) {
  if (!sock || typeof sock !== 'object' || sock.__dtamDoorbellHost) return sock;
  Object.defineProperty(sock, '__dtamDoorbellHost', { value:true, configurable:false });

  if (typeof sock.open === 'function') {
    const originalOpen = sock.open.bind(sock);
    sock.open = function doorbellOpen(mode) {
      const out = originalOpen(mode);
      if (mode === 'browser-host' || mode === 'p2p-recovered-host') waitForMailbox(this);
      return out;
    };
  }
  if (typeof sock.finish === 'function') {
    const originalFinish = sock.finish.bind(sock);
    sock.finish = function doorbellFinish(...args) {
      stopBell(this);
      return originalFinish(...args);
    };
  }
  if (typeof sock.close === 'function') {
    const originalClose = sock.close.bind(sock);
    sock.close = function doorbellClose(...args) {
      stopBell(this);
      return originalClose(...args);
    };
  }
  return sock;
}

if (typeof BaseWebSocket === 'function' && typeof NativeWebSocket === 'function' && !window.__DTAM_BELL_HOST_INSTALLED__) {
  window.__DTAM_BELL_HOST_INSTALLED__ = true;
  const WrappedWebSocket = new Proxy(BaseWebSocket, {
    construct(Target, args) { return patchSocket(Reflect.construct(Target, args, Target)); }
  });
  for (const key of ['CONNECTING','OPEN','CLOSING','CLOSED']) {
    try { Object.defineProperty(WrappedWebSocket, key, { value:BaseWebSocket[key] }); } catch (_) {}
  }
  window.WebSocket = WrappedWebSocket;
}

console.log('DTAM P2P doorbell host ready');
