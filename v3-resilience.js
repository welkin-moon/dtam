(() => {
'use strict';

const HybridWebSocket = window.WebSocket;
const proto = HybridWebSocket?.prototype;
if (!proto || typeof proto._finalClose !== 'function' || typeof proto._setDirect !== 'function') return;

const originalFinalClose = proto._finalClose;
const originalSetDirect = proto._setDirect;

function directStillHealthy(socket) {
  if (!socket?._direct) return false;
  if (socket._control?.readyState !== 'open' || socket._fast?.readyState !== 'open') return false;
  const state = String(socket._pc?.connectionState || 'connected');
  return !['failed', 'closed'].includes(state);
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

proto._finalClose = function patchedFinalClose(code = 1006, reason = '', wasClean = false) {
  const intentionallyClosing = this.readyState === HybridWebSocket.CLOSING;
  if (!intentionallyClosing && !this._closed && directStillHealthy(this)) {
    markBackupOffline(this);
    return;
  }
  return originalFinalClose.call(this, code, reason, wasClean);
};

proto._setDirect = async function patchedSetDirect(value, reason = '') {
  const wasDirect = !!this._direct;
  const result = await originalSetDirect.call(this, value, reason);
  if (!value && wasDirect && !this._closed) {
    const signalOkay = this._signal?.readyState === 1;
    const legacyOkay = this._legacy?.readyState === 1;
    if (!signalOkay && !legacyOkay) {
      originalFinalClose.call(this, 1006, 'direct and fallback transports unavailable', false);
    }
  }
  return result;
};

console.log('DTAM v3 transport resilience enabled · direct survives signaling loss');
})();
