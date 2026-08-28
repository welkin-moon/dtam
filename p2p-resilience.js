import { getNetworkConfig } from './net-config.js?v=20260824-direct-m3e1';

const SIGNAL = 'https://p2p-signal.lunarlab.uk';
const BaseWebSocket = window.WebSocket;
const RECOVER_KEY = 'au-dtam-p2p-recovery:';
const SNAP_KEY = 'au-dtam-p2p-snapshot:';
const GAMEPLAY_RECONNECT_POLL_MS = 5000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rid = () => { try { return crypto.randomUUID().replace(/-/g, ''); } catch (_) { return Math.random().toString(36).slice(2) + Date.now().toString(36); } };

function parse(value) { try { return JSON.parse(String(value)); } catch (_) { return null; } }
function loadJson(storage, key) { try { return JSON.parse(storage.getItem(key) || 'null'); } catch (_) { return null; } }
function saveRecovery(room, value) { try { localStorage.setItem(RECOVER_KEY + room, JSON.stringify(value)); } catch (_) {} }
function badge(text, title = text) {
  const el = document.getElementById('p2pTransportStatus');
  if (el) { el.textContent = text; el.title = title; }
}
function diag(extra) { Object.assign(window.__DTAM_NET__ || (window.__DTAM_NET__ = {}), extra); }
// Keep these explicit diagnostic contracts stable for the regression suite:
// diag({ remoteIceCandidates })
// diag({ localIceCandidates })
function iceCandidateCount(desc) { return (String(desc?.sdp || '').match(/(?:^|\r?\n)a=candidate:/g) || []).length; }
function noCandidateReason(side = 'local') {
  const who = side === 'remote' ? '房主浏览器' : '当前浏览器';
  return getNetworkConfig().mode === 'p2p'
    ? `${who}未提供 WebRTC ICE 候选；可能启用了 WebRTC 防泄漏或禁止非代理 UDP，请切换到 Auto`
    : `${who}未能获取 WebRTC/TURN ICE 候选，请检查网络后重试`;
}

async function signal(path, options = {}) {
  const r = await fetch(SIGNAL + path, { cache:'no-store', ...options, headers:{ 'Content-Type':'application/json', ...(options.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 202) throw Object.assign(new Error(data.message || `signal ${r.status}`), { code:data.code || 'signal_error', data });
  return data;
}

async function waitIceFast(pc, timeout = 2400) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => pc.iceGatheringState === 'complete' && finish();
    const timer = setTimeout(finish, timeout);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
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
      // Keep this comfortably below the game's 20 s connection deadline. One
      // poll per 5 s is only 720 control-plane reads per room-hour and prevents
      // background-tab reconnects from spending the whole deadline waiting.
      sock.__dtamGameplayWatch = setTimeout(tick, GAMEPLAY_RECONNECT_POLL_MS);
    }
  };
  sock.__dtamGameplayWatch = setTimeout(tick, 1000);
  diag({ gameplayReconnectWatch:true, gameplayReconnectPollMs:GAMEPLAY_RECONNECT_POLL_MS });
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

  sock.guest = async function resilientGuest(rec = null) {
    const peerId = rid();
    badge('正在加入房间…');
    diag({ joinStage:'admission', joinPeerId:peerId, joinStageAt:Date.now() });
    let joinToken = '';
    try {
      const joined = await signal(`/v2/rooms/${this.room}/join`, {
        method:'POST',
        body:JSON.stringify({ peerId, recoveryToken:rec?.recoveryToken || '' }),
      });
      joinToken = String(joined.joinToken || '');
      diag({ joinStage:'waiting-offer', joinStageAt:Date.now() });
      if (rec) saveRecovery(this.room, { ...rec, epoch:Number(joined.epoch || rec.epoch || 1) });
    } catch (e) {
      diag({ joinStage:'admission-failed', joinStageError:String(e?.message || e) });
      if (['room_not_found','game_in_progress'].includes(e.code) && this.cfg?.mode === 'p2p') {
        this.open('p2p-error');
        this.deliver(JSON.stringify({ t:'error', code:e.code, message:e.message }));
        return setTimeout(() => this.finish(4404, e.code, true), 60);
      }
      return this.fallback('房间撮合失败');
    }

    let offer = null;
    // The host's in-game reconnect watcher now runs at most 5 s apart. Keep a
    // generous offer window for timer throttling without increasing CF load.
    const offerPoll = [120,180,260,380,550,750,1000,1400,2200,3500,5200,7000];
    for (const delay of offerPoll) {
      await sleep(delay);
      if (this.closed) return;
      try {
        const data = await signal(`/v2/rooms/${this.room}/offers/${peerId}?joinToken=${encodeURIComponent(joinToken)}`);
        if (data.ready) { offer = data.offer; break; }
      } catch (e) {
        if (e.code === 'peer_not_found') return this.fallback('加入请求已过期');
      }
    }
    if (!offer) return this.fallback('等待房主响应超时');
    const remoteIceCandidates = iceCandidateCount(offer);
    diag({ remoteIceCandidates, joinStage:'creating-answer', joinStageAt:Date.now() });
    if (!remoteIceCandidates) return this.fallback(noCandidateReason('remote'));

    const pc = this.pc = new RTCPeerConnection({
      iceServers:[{ urls:'stun:stun.cloudflare.com:3478' }],
      bundlePolicy:'max-bundle',
      iceCandidatePoolSize:4,
    });
    pc.ondatachannel = e => this.bind(e.channel);
    pc.onconnectionstatechange = async () => {
      diag({ joinPcState:pc.connectionState, joinIceState:pc.iceConnectionState });
      if (pc.connectionState === 'connected') {
        diag({ joinStage:'datachannel-negotiation', joinStageAt:Date.now() });
        inspectPc(pc);
      } else if (['failed','closed'].includes(pc.connectionState) && !this.closed) {
        if (!this.opened) this.fallback('建立连接失败');
        else this.finish(1006, 'P2P host lost', false);
      }
    };

    let stage = 'set-remote-offer';
    try {
      await pc.setRemoteDescription(offer);
      stage = 'create-answer';
      const answer = await pc.createAnswer();
      stage = 'set-local-answer';
      await pc.setLocalDescription(answer);
      stage = 'gather-local-ice';
      await waitIceFast(pc, 2400);
      const localDescription = pc.localDescription;
      const localIceCandidates = iceCandidateCount(localDescription);
      diag({ localIceCandidates, joinStage:'posting-answer', joinStageAt:Date.now() });
      if (!localIceCandidates) return this.fallback(noCandidateReason('local'));
      stage = 'post-answer';
      await signal(`/v2/rooms/${this.room}/answers/${peerId}`, {
        method:'POST',
        body:JSON.stringify({ joinToken, answer:localDescription }),
      });
      diag({ joinStage:'waiting-datachannel', joinStageAt:Date.now() });
    } catch (e) {
      diag({ joinStage:`${stage}-failed`, joinStageError:String(e?.message || e), joinStageAt:Date.now() });
      return this.fallback(`连接协商失败（${stage}）`);
    }
    setTimeout(() => !this.opened && this.fallback('已交换连接信息，但数据通道建立超时'), 7000);
  };

  sock.fallback = async function resilientFallback(reason) {
    if (this.closed || this.opened) return;
    const candidate = this.__dtamRecoveryCandidate;
    const recoverable = candidate && !this.__dtamRecoveryAttempted && /offer|ICE|answer|房间不可用|响应超时|建立连接|数据通道/i.test(String(reason || ''));
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
    diag({ joinStage:'socket-open', joinStageAt:Date.now() });
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
diag({ resilience:'fast-join+in-game-reconnect+delayed-recovery', serverPolicy:getNetworkConfig().mode === 'server' ? 'manual-server' : 'p2p-only' });
