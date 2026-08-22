import { getNetworkConfig } from './net-config.js?v=hybrid-2';

const SIGNAL = 'https://p2p-signal.lunarlab.uk';
const BaseWebSocket = window.WebSocket;
const RECOVER_KEY = 'au-dtam-p2p-recovery:';
const SNAP_KEY = 'au-dtam-p2p-snapshot:';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parse(value) { try { return JSON.parse(String(value)); } catch (_) { return null; } }
function loadJson(storage, key) { try { return JSON.parse(storage.getItem(key) || 'null'); } catch (_) { return null; } }
function badge(text, title = text) {
  const el = document.getElementById('p2pTransportStatus');
  if (el) { el.textContent = text; el.title = title; }
}
function diag(extra) { Object.assign(window.__DTAM_NET__ || (window.__DTAM_NET__ = {}), extra); }

async function signal(path, options = {}) {
  const r = await fetch(SIGNAL + path, { cache:'no-store', ...options, headers:{ 'Content-Type':'application/json', ...(options.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 202) throw Object.assign(new Error(data.message || `signal ${r.status}`), { code:data.code || 'signal_error', data });
  return data;
}

function stopGameplayWatch(sock) {
  clearTimeout(sock.__dtamGameplayWatch);
  sock.__dtamGameplayWatch = null;
}

function startGameplayWatch(sock) {
  if (!sock?.mb || !sock?.auth || !sock?.local) return;
  stopGameplayWatch(sock);
  const tick = async () => {
    if (sock.closed || !sock.mb || !sock.auth) return;
    try {
      const data = await signal(`/v2/rooms/${sock.room}/joins?hostToken=${encodeURIComponent(sock.mb.hostToken)}`);
      sock.mb.epoch = Number(data.epoch || sock.mb.epoch);
      for (const p of data.peers || []) {
        if (!sock.mb.peers.has(p.peerId)) sock.mb.peer(p.peerId).catch(() => {});
      }
    } catch (_) {}
    if (!sock.closed && sock.__dtamGameplayWatch !== null) {
      sock.__dtamGameplayWatch = setTimeout(tick, document.hidden ? 20000 : 12000);
    }
  };
  sock.__dtamGameplayWatch = setTimeout(tick, 1800);
  diag({ gameplayReconnectWatch:true });
}

async function inspectPc(pc) {
  if (!pc?.getStats) return;
  try {
    const stats = await pc.getStats();
    let pair = null;
    stats.forEach(x => { if (x.type === 'candidate-pair' && x.state === 'succeeded' && (x.nominated || !pair)) pair = x; });
    if (!pair) return;
    const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
    const relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
    const detail = [local?.candidateType && remote?.candidateType ? `${local.candidateType} ↔ ${remote.candidateType}` : '', local?.protocol || ''].filter(Boolean).join(' · ');
    diag({ relay, pair:detail || (relay ? 'TURN relay' : 'WebRTC direct') });
    badge(relay ? 'Cloudflare 中继' : 'P2P 直连', detail || (relay ? 'TURN relay' : 'WebRTC direct'));
  } catch (_) {}
}

function patchSocket(sock) {
  if (!sock || typeof sock !== 'object' || typeof sock.start !== 'function' || sock.__dtamResilience) return sock;
  sock.__dtamResilience = true;

  sock.start = async function resilientStart() {
    if (typeof this.host !== 'function' || typeof this.guest !== 'function') return;
    if (this.create) return this.host();
    const rec = loadJson(localStorage, RECOVER_KEY + this.room);
    const snapshot = loadJson(sessionStorage, SNAP_KEY + this.room);
    this.__dtamRecoveryCandidate = rec && snapshot ? { rec, snapshot } : null;
    return this.guest(rec || null);
  };

  sock.fallback = async function resilientFallback(reason) {
    if (this.closed || this.opened) return;
    const candidate = this.__dtamRecoveryCandidate;
    const recoverable = candidate && !this.__dtamRecoveryAttempted && /offer|ICE|answer|房间不可用/i.test(String(reason || ''));
    if (recoverable) {
      this.__dtamRecoveryAttempted = true;
      badge('房主连接中断，正在迁移…', String(reason || ''));
      diag({ lastError:String(reason || ''), recovering:true });
      await sleep(900 + Math.random() * 700);
      try {
        const won = await this.tryRecover(candidate.rec, candidate.snapshot);
        if (won) {
          diag({ recovering:false });
          badge('已恢复 · 新房主');
          return true;
        }
      } catch (_) {}
    }
    diag({ lastError:String(reason || ''), recovering:false, serverSkipped:true });
    badge('联机失败', String(reason || ''));
    try { this.emit('error', new Event('error')); } catch (_) {}
    return this.finish(1006, String(reason || 'P2P connection failed'), false);
  };

  const originalSend = sock.send.bind(sock);
  sock.send = function resilientSend(data) {
    const packet = parse(data), type = String(packet?.t || '');
    const out = originalSend(data);
    if (this.auth && this.local) {
      if (type === 'start') {
        startGameplayWatch(this);
        badge('P2P 游戏中 · 支持断线重连');
      } else if (type === 'reset') {
        stopGameplayWatch(this);
      }
    }
    return out;
  };

  const originalOpen = sock.open.bind(sock);
  sock.open = function resilientOpen(mode) {
    const out = originalOpen(mode);
    setTimeout(() => {
      if (this.pc?.connectionState === 'connected') inspectPc(this.pc);
      if (this.mb?.peers) for (const p of this.mb.peers.values()) if (p.pc?.connectionState === 'connected') inspectPc(p.pc);
    }, 500);
    return out;
  };

  const originalFinish = sock.finish.bind(sock);
  sock.finish = function resilientFinish(...args) {
    stopGameplayWatch(this);
    return originalFinish(...args);
  };

  const originalClose = sock.close.bind(sock);
  sock.close = function resilientClose(code = 1000, reason = '') {
    const room = this.room;
    const hostToken = this.mb?.hostToken || window.__DTAM_HOST_SIGNAL__?.hostToken || '';
    const connected = this.auth?.room ? Object.values(this.auth.room.players || {}).filter(p => p.connected).length : 0;
    if (this.auth && hostToken && connected <= 1) {
      fetch(`${SIGNAL}/v2/rooms/${room}?hostToken=${encodeURIComponent(hostToken)}`, { method:'DELETE', keepalive:true, cache:'no-store' }).catch(() => {});
      try { localStorage.removeItem(RECOVER_KEY + room); sessionStorage.removeItem(SNAP_KEY + room); } catch (_) {}
    }
    stopGameplayWatch(this);
    return originalClose(code, reason);
  };

  return sock;
}

const WrappedWebSocket = new Proxy(BaseWebSocket, {
  construct(Target, args) {
    const socket = Reflect.construct(Target, args, Target);
    return patchSocket(socket);
  }
});
for (const key of ['CONNECTING','OPEN','CLOSING','CLOSED']) {
  try { Object.defineProperty(WrappedWebSocket, key, { value:BaseWebSocket[key] }); } catch (_) {}
}
window.WebSocket = WrappedWebSocket;
diag({ resilience:'in-game-reconnect+delayed-recovery', serverPolicy:getNetworkConfig().mode === 'server' ? 'manual-server' : 'p2p-only' });
