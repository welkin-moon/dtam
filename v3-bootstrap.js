(() => {
'use strict';

const NativeWebSocket = window.WebSocket;
const NativeRTCPeerConnection = window.RTCPeerConnection;
const VERSION = '3.0.0';
const EDGE_ENDPOINTS = Array.isArray(window.__DTAM_EDGE_ENDPOINTS__) && window.__DTAM_EDGE_ENDPOINTS__.length
  ? window.__DTAM_EDGE_ENDPOINTS__
  : [{ id: 'shanghai-a', signal: 'wss://edge-d1.lunarlab.uk/edge' }];
const EDGE_CONNECT_TIMEOUT_MS = 8000;
const ICE_GATHER_TIMEOUT_MS = 4500;
const FAST_TYPES = new Set(['pos', 'ping']);
const decoder = new TextDecoder();

const diagnostics = {
  version: VERSION,
  mode: 'boot',
  endpoint: '',
  direct: false,
  candidate: '',
  lastError: '',
};
window.__DTAM_V3_TRANSPORT__ = diagnostics;

function isGameSocketUrl(value) {
  try {
    const u = new URL(String(value), location.href);
    return u.hostname === 'rt-d1.lunarlab.uk' && u.pathname === '/ws';
  } catch (_) {
    return false;
  }
}

function ensureTransportBadge() {
  let el = document.getElementById('transportStatus');
  if (el) return el;
  const latency = document.getElementById('latencyStatus');
  if (!latency?.parentElement) return null;
  el = document.createElement('span');
  el.id = 'transportStatus';
  el.textContent = 'v3 · Tunnel';
  el.title = 'v3 网络传输：等待直连';
  el.style.whiteSpace = 'nowrap';
  el.style.fontSize = '12px';
  el.style.opacity = '.82';
  el.style.padding = '2px 7px';
  el.style.border = '1px solid currentColor';
  el.style.borderRadius = '999px';
  latency.insertAdjacentElement('afterend', el);
  return el;
}

function setTransportBadge(text, title = '') {
  const apply = () => {
    const el = ensureTransportBadge();
    if (!el) return;
    el.textContent = text;
    el.title = title || text;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
}

function privateV4(address) {
  if (!address) return false;
  const m = String(address).match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

async function describeSelectedPair(pc) {
  try {
    const stats = await pc.getStats();
    let pair = null;
    stats.forEach(r => {
      if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || !pair)) pair = r;
    });
    if (!pair) return { label: '节点直连', detail: 'WebRTC DataChannel 已连接' };
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    const localAddress = local?.address || local?.ip || '';
    const remoteAddress = remote?.address || remote?.ip || '';
    const types = [local?.candidateType, remote?.candidateType].filter(Boolean).join(' ↔ ');
    const lan = privateV4(localAddress) || privateV4(remoteAddress);
    const relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
    const label = relay ? 'TURN 中继' : lan ? 'LAN 直连' : '节点直连';
    const detail = [types, localAddress && remoteAddress ? `${localAddress} ↔ ${remoteAddress}` : ''].filter(Boolean).join(' · ');
    diagnostics.candidate = detail;
    return { label, detail: detail || 'WebRTC DataChannel 已连接' };
  } catch (_) {
    return { label: '节点直连', detail: 'WebRTC DataChannel 已连接' };
  }
}

function jsonType(data) {
  if (typeof data !== 'string' || data.length > 65536) return '';
  try {
    const obj = JSON.parse(data);
    return typeof obj?.t === 'string' ? obj.t : '';
  } catch (_) {
    return '';
  }
}

function eventError(message) {
  try { return new ErrorEvent('error', { message: String(message || 'transport error') }); }
  catch (_) { return new Event('error'); }
}

class HybridWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url, protocols) {
    if (!isGameSocketUrl(url)) {
      return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    }
    super();
    this.url = String(url);
    this.protocol = '';
    this.extensions = '';
    this.binaryType = 'blob';
    this.readyState = HybridWebSocket.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._signal = null;
    this._legacy = null;
    this._pc = null;
    this._control = null;
    this._fast = null;
    this._direct = false;
    this._opened = false;
    this._closed = false;
    this._endpointIndex = 0;
    this._endpoint = null;
    this._edgeTimer = null;
    this._selfId = '';
    this._needAuthoritySync = false;
    this._disconnectTimer = null;
    this._rtcStarted = false;
    this._connectNextEdge();
  }

  get bufferedAmount() {
    let n = 0;
    try { n += Number(this._signal?.bufferedAmount || 0); } catch (_) {}
    try { n += Number(this._control?.bufferedAmount || 0); } catch (_) {}
    try { n += Number(this._fast?.bufferedAmount || 0); } catch (_) {}
    return n;
  }

  _emit(type, event) {
    const cb = this[`on${type}`];
    if (typeof cb === 'function') {
      try { cb.call(this, event); } catch (err) { setTimeout(() => { throw err; }, 0); }
    }
    try { this.dispatchEvent(event); } catch (_) {}
  }

  _markOpen() {
    if (this._opened || this._closed) return;
    this._opened = true;
    this.readyState = HybridWebSocket.OPEN;
    diagnostics.mode = 'tunnel';
    diagnostics.endpoint = this._endpoint?.id || 'legacy';
    setTransportBadge('v3 · Tunnel', 'Cloudflare Tunnel 信令/备用通道');
    this._emit('open', new Event('open'));
  }

  _finalClose(code = 1006, reason = '', wasClean = false) {
    if (this._closed) return;
    this._closed = true;
    this.readyState = HybridWebSocket.CLOSED;
    clearTimeout(this._edgeTimer);
    clearTimeout(this._disconnectTimer);
    try { this._pc?.close(); } catch (_) {}
    let ev;
    try { ev = new CloseEvent('close', { code, reason, wasClean }); }
    catch (_) { ev = new Event('close'); ev.code = code; ev.reason = reason; ev.wasClean = wasClean; }
    this._emit('close', ev);
  }

  _connectNextEdge() {
    if (this._closed) return;
    if (this._endpointIndex >= EDGE_ENDPOINTS.length) {
      this._connectLegacy();
      return;
    }
    const endpoint = EDGE_ENDPOINTS[this._endpointIndex++];
    this._endpoint = endpoint;
    diagnostics.endpoint = endpoint.id;
    let signalUrl;
    try {
      signalUrl = new URL(endpoint.signal);
      const original = new URL(this.url);
      original.searchParams.forEach((value, key) => signalUrl.searchParams.set(key, value));
      signalUrl.searchParams.set('edgeVersion', VERSION);
    } catch (err) {
      diagnostics.lastError = String(err?.message || err);
      this._connectNextEdge();
      return;
    }

    let ws;
    try { ws = new NativeWebSocket(signalUrl.href); }
    catch (err) {
      diagnostics.lastError = String(err?.message || err);
      this._connectNextEdge();
      return;
    }
    this._signal = ws;
    let ready = false;
    clearTimeout(this._edgeTimer);
    this._edgeTimer = setTimeout(() => {
      if (ready || this._closed) return;
      try { ws.close(); } catch (_) {}
      this._connectNextEdge();
    }, EDGE_CONNECT_TIMEOUT_MS);

    ws.onmessage = event => {
      if (this._closed) return;
      const data = event.data;
      if (typeof data === 'string') {
        try {
          const obj = JSON.parse(data);
          if (obj && typeof obj.__v3 === 'string') {
            const kind = obj.__v3;
            if (kind === 'ready') {
              ready = true;
              clearTimeout(this._edgeTimer);
              this._markOpen();
              this._startRtc().catch(err => {
                diagnostics.lastError = String(err?.message || err);
                this._setDirect(false, 'WebRTC 建链失败，继续 Tunnel');
              });
              return;
            }
            if (kind === 'answer') {
              this._acceptAnswer(obj.description).catch(err => {
                diagnostics.lastError = String(err?.message || err);
                this._setDirect(false, 'WebRTC answer 失败');
              });
              return;
            }
            if (kind === 'transport') {
              if (obj.mode === 'fallback') this._setDirect(false, String(obj.reason || '直连不可用'));
              return;
            }
            if (kind === 'pong' || kind === 'info') return;
          }
        } catch (_) {}
      }
      this._deliverApp(data, 'tunnel');
    };
    ws.onerror = () => {};
    ws.onclose = event => {
      clearTimeout(this._edgeTimer);
      if (this._closed) return;
      if (!ready && !this._opened) {
        if (this._signal === ws) this._signal = null;
        this._connectNextEdge();
        return;
      }
      this._finalClose(event.code || 1006, event.reason || 'edge signaling closed', !!event.wasClean);
    };
  }

  _connectLegacy() {
    if (this._closed || this._legacy) return;
    diagnostics.mode = 'legacy-tunnel';
    diagnostics.endpoint = 'rt-d1';
    setTransportBadge('v3 · Tunnel fallback', 'v3 Edge 不可用，直接使用 v2.8 Tunnel 路径');
    let ws;
    try { ws = new NativeWebSocket(this.url); }
    catch (err) {
      diagnostics.lastError = String(err?.message || err);
      this._emit('error', eventError(err));
      this._finalClose(1006, 'legacy websocket failed', false);
      return;
    }
    this._legacy = ws;
    ws.onopen = () => this._markOpen();
    ws.onmessage = event => this._deliverApp(event.data, 'legacy-tunnel');
    ws.onerror = event => this._emit('error', event instanceof Event ? event : eventError('legacy websocket error'));
    ws.onclose = event => this._finalClose(event.code || 1006, event.reason || '', !!event.wasClean);
  }

  async _startRtc() {
    if (this._rtcStarted || this._closed || !this._signal || this._signal.readyState !== NativeWebSocket.OPEN) return;
    this._rtcStarted = true;
    if (typeof NativeRTCPeerConnection !== 'function') throw new Error('RTCPeerConnection unavailable');

    const pc = new NativeRTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      bundlePolicy: 'max-bundle',
    });
    this._pc = pc;
    const control = pc.createDataChannel('dtam-control', { ordered: true });
    const fast = pc.createDataChannel('dtam-fast', { ordered: false, maxRetransmits: 0 });
    control.binaryType = fast.binaryType = 'arraybuffer';
    this._control = control;
    this._fast = fast;

    const opened = () => {
      if (control.readyState === 'open' && fast.readyState === 'open') this._setDirect(true);
    };
    const closed = () => this._setDirect(false, 'DataChannel 已断开');
    control.onopen = fast.onopen = opened;
    control.onclose = fast.onclose = closed;
    control.onerror = fast.onerror = () => this._setDirect(false, 'DataChannel 错误');
    control.onmessage = event => this._deliverApp(event.data, 'direct');
    fast.onmessage = event => this._deliverApp(event.data, 'direct');

    pc.addEventListener('connectionstatechange', () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        clearTimeout(this._disconnectTimer);
        return;
      }
      if (state === 'failed' || state === 'closed') {
        this._setDirect(false, `ICE ${state}`);
      } else if (state === 'disconnected') {
        clearTimeout(this._disconnectTimer);
        this._disconnectTimer = setTimeout(() => {
          if (pc.connectionState === 'disconnected') this._setDirect(false, 'ICE disconnected');
        }, 2500);
      }
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this._waitIceGather(pc);
    if (!pc.localDescription) throw new Error('missing localDescription');
    this._signal.send(JSON.stringify({ __v3: 'offer', description: pc.localDescription, version: VERSION }));
  }

  _waitIceGather(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onState);
        resolve();
      };
      const onState = () => { if (pc.iceGatheringState === 'complete') finish(); };
      const timer = setTimeout(finish, ICE_GATHER_TIMEOUT_MS);
      pc.addEventListener('icegatheringstatechange', onState);
    });
  }

  async _acceptAnswer(description) {
    if (!this._pc || !description || this._pc.signalingState === 'closed') return;
    await this._pc.setRemoteDescription(description);
  }

  async _setDirect(value, reason = '') {
    if (this._closed) return;
    if (value) {
      if (this._direct) return;
      this._direct = true;
      diagnostics.direct = true;
      diagnostics.mode = 'direct';
      const selected = await describeSelectedPair(this._pc);
      setTransportBadge(`v3 · ${selected.label}`, selected.detail);
      return;
    }
    if (!this._direct && diagnostics.mode === 'tunnel') return;
    this._direct = false;
    diagnostics.direct = false;
    diagnostics.mode = this._legacy ? 'legacy-tunnel' : 'tunnel';
    setTransportBadge(this._legacy ? 'v3 · Tunnel fallback' : 'v3 · Tunnel', reason || 'WebRTC 不可用，使用 Cloudflare Tunnel');
  }

  _decodeData(data) {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return decoder.decode(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) return decoder.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return null;
  }

  _emitMessage(text) {
    if (this._closed) return;
    this._emit('message', new MessageEvent('message', { data: text, origin: location.origin }));
  }

  _deliverApp(data, transport) {
    const text = this._decodeData(data);
    if (text == null) {
      if (data instanceof Blob) data.text().then(value => this._deliverApp(value, transport)).catch(() => {});
      return;
    }
    let obj = null;
    try { obj = JSON.parse(text); } catch (_) {}
    if (obj?.__v3) return;

    if (obj?.t === 'welcome') this._selfId = String(obj.self?.id || '');
    if (obj?.t === 'game_start') this._needAuthoritySync = true;

    this._emitMessage(text);

    if (obj?.t === 'state' && this._needAuthoritySync && this._selfId) {
      const list = Array.isArray(obj.players) ? obj.players : Object.values(obj.players || {});
      const self = list.find(p => String(p?.id || '') === this._selfId);
      if (self?.pos && Number.isFinite(Number(self.pos.x)) && Number.isFinite(Number(self.pos.y))) {
        this._needAuthoritySync = false;
        queueMicrotask(() => this._emitMessage(JSON.stringify({ t: 'correct', x: Number(self.pos.x), y: Number(self.pos.y), v3AuthoritySync: true })));
      }
    }

    if (obj?.t === 'lobby_reset' && this._selfId) {
      const list = Array.isArray(obj.players) ? obj.players : Object.values(obj.players || {});
      const self = list.find(p => String(p?.id || '') === this._selfId);
      if (self?.pos && Number.isFinite(Number(self.pos.x)) && Number.isFinite(Number(self.pos.y))) {
        queueMicrotask(() => this._emitMessage(JSON.stringify({ t: 'correct', x: Number(self.pos.x), y: Number(self.pos.y), v3AuthoritySync: true })));
      }
    }

    if (transport === 'direct') diagnostics.mode = 'direct';
  }

  send(data) {
    if (this.readyState !== HybridWebSocket.OPEN) throw new DOMException('WebSocket is not open', 'InvalidStateError');
    if (this._legacy) {
      this._legacy.send(data);
      return;
    }

    const type = jsonType(data);
    if (this._direct) {
      if (FAST_TYPES.has(type) && this._fast?.readyState === 'open') {
        if (this._fast.bufferedAmount < 65536) this._fast.send(data);
        return;
      }
      if (this._control?.readyState === 'open' && this._control.bufferedAmount < 524288) {
        this._control.send(data);
        return;
      }
    }

    if (this._signal?.readyState === NativeWebSocket.OPEN) {
      this._signal.send(data);
      return;
    }
    throw new DOMException('No usable transport', 'NetworkError');
  }

  close(code = 1000, reason = '') {
    if (this.readyState === HybridWebSocket.CLOSED || this.readyState === HybridWebSocket.CLOSING) return;
    this.readyState = HybridWebSocket.CLOSING;
    clearTimeout(this._edgeTimer);
    clearTimeout(this._disconnectTimer);
    try { this._pc?.close(); } catch (_) {}
    if (this._legacy) {
      try { this._legacy.close(code, reason); } catch (_) { this._finalClose(code, reason, true); }
      return;
    }
    if (this._signal) {
      try { this._signal.close(code, reason); } catch (_) { this._finalClose(code, reason, true); }
      return;
    }
    this._finalClose(code, reason, true);
  }
}

Object.defineProperties(HybridWebSocket.prototype, {
  CONNECTING: { value: 0 },
  OPEN: { value: 1 },
  CLOSING: { value: 2 },
  CLOSED: { value: 3 },
});

window.WebSocket = HybridWebSocket;
setTransportBadge('v3 · Tunnel', '正在准备 v3 节点直连');
console.log(`Among Us 东滩版 v${VERSION} transport bootstrap · WebRTC direct + Tunnel fallback`);
})();
