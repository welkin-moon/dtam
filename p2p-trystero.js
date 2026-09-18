import { GameRoom } from './worker.js?v=p2p-browser-host-2';

const NativeWebSocket = window.WebSocket;
const FALLBACK_HOST = 'rt-d1.lunarlab.uk';
const VERSION = 'p2p-nostr-0.1';
const MAX_PLAYERS = 15;
const RECONNECT_GRACE_MS = 180000;
const DISCOVERY_TIMEOUT_MS = 5500;
const CREATOR_PROBE_MS = 900;
const APP_ID = 'dtam-lunarlab-p2p-v1';
const FAST_TYPES = new Set(['pos']);
const POSITION_SYNC_TYPES = new Set(['emergency','vent','report','kill','ability','task_begin','task_complete','sabotage_fix']);
const trysteroPromise = import('https://esm.run/trystero');

const diagnostics = window.__DTAM_P2P__ = {
  version: VERSION,
  strategy: 'trystero/nostr',
  mode: 'boot',
  room: '',
  role: '',
  peers: 0,
  hostPeerId: '',
  lastError: '',
};

function isGameSocketUrl(value) {
  try {
    const u = new URL(String(value), location.href);
    return u.hostname === FALLBACK_HOST && u.pathname === '/ws';
  } catch (_) { return false; }
}
function sanitizeName(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (text || '玩家').slice(0, 12);
}
function randomId() {
  try { return crypto.randomUUID().replace(/-/g, ''); }
  catch (_) { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
}
function parseJson(text) { try { return JSON.parse(String(text)); } catch (_) { return null; } }
function makeCloseEvent(code, reason, clean) {
  try { return new CloseEvent('close', { code, reason, wasClean: clean }); }
  catch (_) { const e = new Event('close'); e.code = code; e.reason = reason; e.wasClean = clean; return e; }
}
function ensureBadge() {
  let el = document.getElementById('p2pTransportStatus');
  if (el) return el;
  const latency = document.getElementById('latencyStatus');
  if (!latency?.parentElement) return null;
  el = document.createElement('span');
  el.id = 'p2pTransportStatus';
  el.style.cssText = 'white-space:nowrap;font-size:12px;opacity:.86;padding:2px 7px;border:1px solid currentColor;border-radius:999px';
  latency.insertAdjacentElement('afterend', el);
  return el;
}
function setBadge(text, title = text) {
  const run = () => { const el = ensureBadge(); if (el) { el.textContent = text; el.title = title; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
}

class BrowserDOContext {
  constructor() {
    this.sockets = new Set();
    this.memory = new Map();
    this.room = null;
    this.alarmTimer = null;
    this.ready = Promise.resolve();
    this.storage = {
      get: async key => this.memory.get(String(key)),
      put: async (key, value) => this.memory.set(String(key), structuredClone(value)),
      setAlarm: async at => this.setAlarm(at),
      deleteAlarm: async () => this.deleteAlarm(),
    };
  }
  blockConcurrencyWhile(fn) { this.ready = Promise.resolve().then(fn); return this.ready; }
  acceptWebSocket(ws) { this.sockets.add(ws); }
  getWebSockets() { return [...this.sockets].filter(ws => !ws.closed); }
  detach(ws) { this.sockets.delete(ws); }
  attachRoom(room) { this.room = room; }
  setAlarm(at) {
    this.deleteAlarm();
    const delay = Math.max(0, Math.min(2147483647, Number(at) - Date.now()));
    this.alarmTimer = setTimeout(async () => {
      this.alarmTimer = null;
      try { await this.room?.alarm?.(); } catch (e) { console.warn('[DTAM P2P] alarm', e); }
    }, delay);
  }
  deleteAlarm() { if (this.alarmTimer) clearTimeout(this.alarmTimer); this.alarmTimer = null; }
}

class AuthoritySocket {
  constructor(ctx, send, close) {
    this.ctx = ctx;
    this.sendFn = send;
    this.closeFn = close;
    this.attachment = null;
    this.closed = false;
    ctx.acceptWebSocket(this);
  }
  serializeAttachment(v) { this.attachment = structuredClone(v); }
  deserializeAttachment() { return this.attachment; }
  send(data) { if (this.closed) throw new Error('closed'); this.sendFn(String(data)); }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true;
    this.ctx.detach(this);
    try { this.closeFn?.(code, reason); } catch (_) {}
  }
}

class BrowserAuthority {
  constructor(roomCode, controlAction, fastAction) {
    this.roomCode = roomCode;
    this.controlAction = controlAction;
    this.fastAction = fastAction;
    this.ctx = new BrowserDOContext();
    this.room = new GameRoom(this.ctx, {});
    this.ctx.attachRoom(this.room);
    this.peerSockets = new Map();
    this.localSocket = null;
  }
  async ready() { await this.ctx.ready; }
  async attachPlayer(sock, params) {
    await this.ready();
    const create = params.get('create') === '1';
    const name = sanitizeName(params.get('name'));
    const token = String(params.get('token') || '');
    const rawClientInstance = String(params.get('client') || '');
    const clientInstance = /^[A-Za-z0-9_-]{16,64}$/.test(rawClientInstance) ? rawClientInstance : '';
    const rawHandoffInstance = String(params.get('handoff') || '');
    const handoffInstance = /^[A-Za-z0-9_-]{16,64}$/.test(rawHandoffInstance) ? rawHandoffInstance : '';
    const now = Date.now();
    const room = this.room;
    if (room.initialized && !Object.keys(room.players).length) room.resetIfEmpty();
    room.cleanupExpired(now);
    let player = token ? Object.values(room.players).find(p => p.token === token) : null;
    let resumed = false;
        const connectionId = randomId();
    if (player && player.connected) { const same = !!clientInstance && !!player.clientInstanceId && player.clientInstanceId === clientInstance, legacy = !player.clientInstanceId, transfer = !!clientInstance && !!handoffInstance && handoffInstance === player.clientInstanceId && clientInstance !== player.clientInstanceId; if (!(same || legacy || transfer)) return this.reject(sock, 'session_in_use', '这个会话正在另一实例中使用，将作为新玩家加入'); }
    if (player) {
      if (now - Number(player.lastSeen || now) <= RECONNECT_GRACE_MS || player.connected) {
        const old = room.socketForPlayer(player.id);
        if (old && old !== sock) try { old.close(4002, 'replaced'); } catch (_) {}
        resumed = true;
      } else { delete room.players[player.id]; player = null; }
    }
    if (!player) {
      if (/\d$/.test(name)) return this.reject(sock, 'name_invalid', '昵称不能以数字结尾；重名时系统会自动添加数字');
      if (create && room.initialized && Object.keys(room.players).length) return this.reject(sock, 'room_exists', '房间号已存在');
      if (!create && !room.initialized) return this.reject(sock, 'room_not_found', '房间不存在');
      if (room.phase !== 'lobby') return this.reject(sock, 'game_in_progress', '游戏已经开始，只能用原会话重连');
      if (Object.keys(room.players).length >= MAX_PLAYERS) return this.reject(sock, 'room_full', '房间已满');
      if (create && !room.initialized) { room.initialized = true; room.createdAt = now; }
      const id = randomId(), used = new Set(Object.values(room.players).map(p => String(p.name || ''))); let assignedName = name; if (used.has(assignedName)) { for (let n = 2; n <= 99; n++) { const suffix = String(n), stem = [...name].slice(0, Math.max(1, 12 - [...suffix].length)).join(''), candidate = stem + suffix; if (!used.has(candidate)) { assignedName = candidate; break; } } }
      player = {
        id, token: randomId(), clientInstanceId: clientInstance, name: assignedName, color: room.nextColor(), animal: room.nextAnimal(), avatar: '',
        pos: room.spawnForIndex(Object.keys(room.players).length), connected: true, connectionId,
        joinedAt: now, lastSeen: now, lastMoveAt: now, lastChatAt: 0,
        role: '', ghostRole: '', alive: true, tasks: [], fakeTasks: [], completed: [],
        killReadyAt: 0, abilityReadyAt: 0, abilityUntil: 0, disguiseTargetId: '', hiddenUntil: 0,
        trackedId: '', trackUntil: 0, ventReadyAt: 0, ventExitAt: 0, protectedUntil: 0,
        lastCaseId: '', lastCaseArea: '', poisonedBy: '', poisonEndsAt: 0,
        voiceSessionId: '', voiceTrackName: '', voiceEnabled: false,
        emergencyUsed: 0, inVent: false, ventId: '', activeTask: null,
      };
      room.players[id] = player;
      if (!room.hostId) room.hostId = id;
    }
    if (clientInstance) player.clientInstanceId = clientInstance;
    const previousHostId = room.hostId;
    player.connected = true; player.connectionId = connectionId; player.lastSeen = now;
    if (!room.players[room.hostId]?.connected) room.electHost();
    sock.serializeAttachment({ playerId: player.id, token: player.token, connectionId });
    await room.persistNow();
    room.announceHostChange(previousHostId);
    sock.send(JSON.stringify({
      t: 'welcome', room: this.roomCode, resumed, self: { id: player.id, token: player.token, name: player.name }, hostId: room.hostId,
      players: room.publicPlayers(), profiles: room.profiles(), voices: room.voiceDirectory(player), bodies: room.bodies,
      game: room.publicGame(player.id), selfState: room.selfState(player), p2p: true,
    }));
    if (!resumed) room.broadcast({ t: 'notice', text: `${player.name} 加入了房间` }, player.id);
    room.broadcastState();
    await room.scheduleNextAlarm();
    return true;
  }
  reject(sock, code, message) {
    try { sock.send(JSON.stringify({ t: 'error', code, message })); } catch (_) {}
    setTimeout(() => { try { sock.close(4000, code); } catch (_) {} }, 30);
    return false;
  }
  async receive(sock, data) {
    try { await this.room.webSocketMessage(sock, data); }
    catch (e) { console.warn('[DTAM P2P] packet', e); }
  }
  async markPeerGone(peerId) {
    const sock = this.peerSockets.get(peerId);
    if (!sock) return;
    this.peerSockets.delete(peerId);
    if (!sock.closed) {
      sock.closed = true; this.ctx.detach(sock);
      try { await this.room.webSocketClose(sock); } catch (_) {}
    }
  }
  makePeerSocket(peerId) {
    const sock = new AuthoritySocket(
      this.ctx,
      data => {
        const packet = parseJson(data);
        const action = packet?.t === 'pos' ? this.fastAction : this.controlAction;
        action.send(data, { target: peerId }).catch?.(() => {});
      },
      (code, reason) => this.controlAction.send(JSON.stringify({ __dtamClose: true, code, reason }), { target: peerId }).catch?.(() => {})
    );
    this.peerSockets.set(peerId, sock);
    return sock;
  }
  shutdown() { this.ctx.deleteAlarm(); }
}

class P2PWebSocket extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url, protocols) {
    if (!isGameSocketUrl(url)) return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    super();
    this.url = String(url); this.protocol = ''; this.extensions = ''; this.binaryType = 'blob';
    this.readyState = P2PWebSocket.CONNECTING;
    this.onopen = this.onmessage = this.onerror = this.onclose = null;
    this._params = new URL(this.url).searchParams;
    this._roomCode = String(this._params.get('room') || '');
    this._create = this._params.get('create') === '1';
    this._opened = false; this._closed = false; this._native = null;
    this._trRoom = null; this._control = null; this._fast = null; this._hello = null;
    this._hostPeerId = ''; this._authority = null; this._authoritySocket = null;
    this._lastPosition = ''; this._timer = null;
    diagnostics.room = this._roomCode; diagnostics.role = this._create ? 'host' : 'peer';
    queueMicrotask(() => this._start());
  }
  get bufferedAmount() { return this._native ? Number(this._native.bufferedAmount || 0) : 0; }
  _emit(type, event) {
    const cb = this[`on${type}`]; if (typeof cb === 'function') try { cb.call(this, event); } catch (e) { setTimeout(() => { throw e; }, 0); }
    try { this.dispatchEvent(event); } catch (_) {}
  }
  _markOpen(mode) {
    if (this._opened || this._closed) return;
    this._opened = true; this.readyState = P2PWebSocket.OPEN; diagnostics.mode = mode;
    this._emit('open', new Event('open'));
  }
  _deliver(data) { if (!this._closed) this._emit('message', new MessageEvent('message', { data: String(data), origin: location.origin })); }
  _finalClose(code = 1006, reason = '', clean = false) {
    if (this._closed) return;
    this._closed = true; clearTimeout(this._timer); this.readyState = P2PWebSocket.CLOSED;
    try { this._trRoom?.leave(); } catch (_) {}
    this._authority?.shutdown();
    this._emit('close', makeCloseEvent(code, reason, clean));
  }
  async _start() {
    let trystero;
    try { trystero = await trysteroPromise; }
    catch (e) { this._fallbackNative('公共 P2P 模块加载失败'); return; }
    if (this._closed) return;
    const roomId = `dtam:${this._roomCode}`;
    try {
      this._trRoom = trystero.joinRoom({ appId: APP_ID }, roomId);
    } catch (e) { this._fallbackNative('公共 rendezvous 初始化失败'); return; }
    this._hello = this._trRoom.makeAction('dtam-host');
    this._control = this._trRoom.makeAction('dtam-control');
    this._fast = this._trRoom.makeAction('dtam-fast');

    this._hello.onMessage = (data, meta) => this._onHello(data, meta?.peerId || '');
    this._control.onMessage = (data, meta) => this._onControl(data, meta?.peerId || '');
    this._fast.onMessage = (data, meta) => this._onFast(data, meta?.peerId || '');
    this._trRoom.onPeerJoin = peerId => {
      diagnostics.peers++;
      if (this._authority) this._hello.send({ kind: 'host', v: VERSION }, { target: peerId }).catch?.(() => {});
    };
    this._trRoom.onPeerLeave = peerId => {
      diagnostics.peers = Math.max(0, diagnostics.peers - 1);
      if (this._authority) this._authority.markPeerGone(peerId);
      if (!this._authority && peerId === this._hostPeerId && this._opened) this._finalClose(4411, 'P2P host left', false);
    };

    if (this._create) {
      setBadge('P2P · 探测房间', '通过公共 Nostr relay 探测是否已有房主');
      this._timer = setTimeout(() => this._becomeHost(), CREATOR_PROBE_MS);
    } else {
      setBadge('P2P · 寻找房主', '公共 Nostr 只用于发现，游戏数据随后走 WebRTC');
      this._timer = setTimeout(() => { if (!this._hostPeerId && !this._opened) this._fallbackNative('未发现 P2P 房主'); }, DISCOVERY_TIMEOUT_MS);
    }
  }
  _onHello(data, peerId) {
    if (!data || data.kind !== 'host' || !peerId) return;
    if (this._create && !this._authority) {
      clearTimeout(this._timer);
      this._markOpen('p2p-collision');
      this._deliver(JSON.stringify({ t: 'error', code: 'room_exists', message: '房间号已存在' }));
      setTimeout(() => this._finalClose(4409, 'room exists', true), 50);
      return;
    }
    if (this._authority) return;
    if (this._hostPeerId && this._hostPeerId !== peerId) return;
    this._hostPeerId = peerId; diagnostics.hostPeerId = peerId; clearTimeout(this._timer);
    this._markOpen('p2p-direct');
    setBadge('P2P · WebRTC', '公共 Nostr 只用于撮合；游戏数据为浏览器直连');
    this._control.send({ __dtamJoin: true, query: this._params.toString(), v: VERSION }, { target: peerId }).catch?.(() => this._fallbackNative('P2P join 发送失败'));
  }
  async _becomeHost() {
    if (this._closed || this._authority) return;
    this._authority = new BrowserAuthority(this._roomCode, this._control, this._fast);
    await this._authority.ready();
    this._authoritySocket = new AuthoritySocket(
      this._authority.ctx,
      data => this._deliver(data),
      (code, reason) => this._finalClose(code, reason, code === 1000)
    );
    this._authority.localSocket = this._authoritySocket;
    this._markOpen('browser-host');
    setBadge('P2P 房主 · 浏览器权威', 'GameRoom 正运行在本浏览器；Nostr 仅负责发现其他浏览器');
    await this._authority.attachPlayer(this._authoritySocket, this._params);
    this._hello.send({ kind: 'host', v: VERSION }).catch?.(() => {});
  }
  async _onControl(data, peerId) {
    if (this._authority) {
      if (!peerId) return;
      if (data?.__dtamJoin) {
        let sock = this._authority.peerSockets.get(peerId);
        if (!sock) sock = this._authority.makePeerSocket(peerId);
        await this._authority.attachPlayer(sock, new URLSearchParams(String(data.query || '')));
        return;
      }
      const sock = this._authority.peerSockets.get(peerId);
      if (!sock) return;
      await this._authority.receive(sock, typeof data === 'string' ? data : JSON.stringify(data));
      return;
    }
    if (peerId !== this._hostPeerId) return;
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const parsed = parseJson(text);
    if (parsed?.__dtamClose) { this._finalClose(Number(parsed.code || 1000), String(parsed.reason || ''), Number(parsed.code || 1000) === 1000); return; }
    this._deliver(text);
  }
  async _onFast(data, peerId) {
    if (this._authority) {
      const sock = this._authority.peerSockets.get(peerId); if (!sock) return;
      await this._authority.receive(sock, typeof data === 'string' ? data : JSON.stringify(data));
      return;
    }
    if (peerId !== this._hostPeerId) return;
    this._deliver(typeof data === 'string' ? data : JSON.stringify(data));
  }
  _fallbackNative(reason) {
    if (this._closed || this._native || this._opened) return;
    diagnostics.lastError = reason; diagnostics.mode = 'home-fallback';
    clearTimeout(this._timer);
    try { this._trRoom?.leave(); } catch (_) {}
    setBadge('P2P → 家中 fallback', `${reason}；尝试 rt-d1.lunarlab.uk`);
    let ws;
    try { ws = new NativeWebSocket(this.url); } catch (_) { this._finalClose(1006, 'fallback unavailable', false); return; }
    this._native = ws;
    ws.onopen = () => { this._markOpen('home-fallback'); setBadge('家中服务器 fallback', 'P2P 不可用，当前使用 rt-d1'); };
    ws.onmessage = e => this._deliver(e.data);
    ws.onerror = e => this._emit('error', e instanceof Event ? e : new Event('error'));
    ws.onclose = e => this._finalClose(e.code || 1006, e.reason || '', !!e.wasClean);
  }
  send(data) {
    if (this._native) { this._native.send(data); return; }
    if (this.readyState !== P2PWebSocket.OPEN) throw new DOMException('WebSocket is not open', 'InvalidStateError');
    if (this._authority && this._authoritySocket) { this._authority.receive(this._authoritySocket, String(data)); return; }
    if (!this._hostPeerId) throw new DOMException('P2P host unavailable', 'NetworkError');
    const packet = parseJson(data), type = String(packet?.t || '');
    if (type === 'pos') this._lastPosition = String(data);
    if (POSITION_SYNC_TYPES.has(type) && this._lastPosition) this._fast.send(this._lastPosition, { target: this._hostPeerId }).catch?.(() => {});
    const action = FAST_TYPES.has(type) ? this._fast : this._control;
    action.send(String(data), { target: this._hostPeerId }).catch?.(() => {});
  }
  close(code = 1000, reason = '') {
    if (this.readyState >= P2PWebSocket.CLOSING) return;
    this.readyState = P2PWebSocket.CLOSING;
    if (this._native) { try { this._native.close(code, reason); } catch (_) { this._finalClose(code, reason, true); } return; }
    if (this._authority && this._authoritySocket) {
      this._authority.receive(this._authoritySocket, JSON.stringify({ t: 'leave' })).finally(() => this._finalClose(code, reason, true));
      return;
    }
    if (this._hostPeerId) this._control.send(JSON.stringify({ t: 'leave' }), { target: this._hostPeerId }).catch?.(() => {});
    this._finalClose(code, reason, true);
  }
}
Object.defineProperties(P2PWebSocket.prototype, {
  CONNECTING: { value: 0 }, OPEN: { value: 1 }, CLOSING: { value: 2 }, CLOSED: { value: 3 },
});

window.WebSocket = P2PWebSocket;
setBadge('P2P · Nostr rendezvous', '不使用自己的 Worker/DO；公共网络仅负责发现，数据走 WebRTC');
console.log('DTAM P2P browser-host experiment', VERSION);
await import('./game.js?v=20260918-v302session6-nostr');
