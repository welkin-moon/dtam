(() => {
'use strict';

const HybridWebSocket = window.WebSocket;
const proto = HybridWebSocket?.prototype;
if (!proto || typeof proto._finalClose !== 'function' || typeof proto._setDirect !== 'function') return;

const originalFinalClose = proto._finalClose;
const originalSetDirect = proto._setDirect;
const originalMarkOpen = proto._markOpen;
const originalClose = proto.close;
const activeSockets = new Set();
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];

function directStillHealthy(socket) {
  if (!socket?._direct) return false;
  if (socket._control?.readyState !== 'open' || socket._fast?.readyState !== 'open') return false;
  const state = String(socket._pc?.connectionState || 'connected');
  return !['failed', 'closed'].includes(state);
}

function signalAvailable(socket) {
  return !socket?._legacy && socket?._signal?.readyState === 1;
}

function markBackupOffline(socket) {
  const diagnostics = window.__DTAM_V3_TRANSPORT__;
  if (diagnostics) {
    diagnostics.direct = true;
    diagnostics.mode = 'direct';
    diagnostics.backup = 'offline';
    diagnostics.lastError = 'Tunnel signaling lost while direct transport remains healthy';
  }
  const el = document.getElementById('transportStatus');
  if (el) {
    const current = el.textContent || 'v3 · 节点直连';
    el.textContent = current.replace(' · 备用离线', '') + ' · 备用离线';
    el.title = 'WebRTC 直连仍正常；Cloudflare Tunnel 备用信令暂不可用';
  }
  socket._signal = null;
  clearTimeout(socket._edgeTimer);
}

function clearRtcRetry(socket) {
  clearTimeout(socket._v3RtcRetryTimer);
  socket._v3RtcRetryTimer = null;
}

async function rebuildRtc(socket, trigger = 'network-change') {
  if (!socket || socket._closed || socket.readyState !== HybridWebSocket.OPEN || !signalAvailable(socket)) return;
  clearRtcRetry(socket);
  try { socket._pc?.close(); } catch (_) {}
  socket._pc = null;
  socket._control = null;
  socket._fast = null;
  socket._direct = false;
  socket._rtcStarted = false;
  const diagnostics = window.__DTAM_V3_TRANSPORT__;
  if (diagnostics) {
    diagnostics.direct = false;
    diagnostics.mode = 'tunnel';
    diagnostics.iceRefresh = trigger;
  }
  try {
    await socket._startRtc();
  } catch (err) {
    if (diagnostics) diagnostics.lastError = String(err?.message || err);
    scheduleRtcRetry(socket, trigger);
  }
}

function scheduleRtcRetry(socket, trigger = 'transport-loss', immediate = false) {
  if (!socket || socket._closed || socket.readyState !== HybridWebSocket.OPEN || !signalAvailable(socket)) return;
  if (socket._v3RtcRetryTimer) return;
  const attempt = Number(socket._v3RtcRetryAttempt || 0);
  const delay = immediate ? 0 : RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  socket._v3RtcRetryAttempt = Math.min(attempt + 1, RETRY_DELAYS_MS.length - 1);
  socket._v3RtcRetryTimer = setTimeout(() => {
    socket._v3RtcRetryTimer = null;
    rebuildRtc(socket, trigger).catch(() => scheduleRtcRetry(socket, trigger));
  }, delay);
}

proto._markOpen = function patchedMarkOpen() {
  const result = originalMarkOpen.call(this);
  activeSockets.add(this);
  this._v3RtcRetryAttempt = 0;
  return result;
};

proto._finalClose = function patchedFinalClose(code = 1006, reason = '', wasClean = false) {
  const intentionallyClosing = this.readyState === HybridWebSocket.CLOSING;
  if (!intentionallyClosing && !this._closed && directStillHealthy(this)) {
    markBackupOffline(this);
    return;
  }
  clearRtcRetry(this);
  activeSockets.delete(this);
  return originalFinalClose.call(this, code, reason, wasClean);
};

proto._setDirect = async function patchedSetDirect(value, reason = '') {
  const wasDirect = !!this._direct;
  const result = await originalSetDirect.call(this, value, reason);
  if (value) {
    clearRtcRetry(this);
    this._v3RtcRetryAttempt = 0;
    const diagnostics = window.__DTAM_V3_TRANSPORT__;
    if (diagnostics) diagnostics.backup = this._signal?.readyState === 1 ? 'online' : 'offline';
    return result;
  }

  if (!this._closed && signalAvailable(this)) {
    scheduleRtcRetry(this, wasDirect ? 'direct-path-changed' : 'initial-ice-failed');
    return result;
  }

  if (wasDirect && !this._closed) {
    const legacyOkay = this._legacy?.readyState === 1;
    if (!legacyOkay) {
      originalFinalClose.call(this, 1006, 'direct and fallback transports unavailable', false);
    }
  }
  return result;
};

proto.close = function patchedClose(code = 1000, reason = '') {
  clearRtcRetry(this);
  activeSockets.delete(this);
  return originalClose.call(this, code, reason);
};

function refreshAllRtc(trigger) {
  for (const socket of activeSockets) {
    if (!socket._closed && signalAvailable(socket)) {
      scheduleRtcRetry(socket, trigger, true);
    }
  }
}

window.addEventListener('online', () => refreshAllRtc('browser-online'));
window.addEventListener('pageshow', event => {
  if (event.persisted) refreshAllRtc('page-restored');
});

try {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  connection?.addEventListener?.('change', () => refreshAllRtc('network-interface-change'));
} catch (_) {}

console.log('DTAM v3 transport resilience enabled · dynamic IPv4/IPv6 ICE renegotiation + direct survival');
})();
