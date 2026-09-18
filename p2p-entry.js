import { GameRoom } from './worker.js?v=p2p-browser-host-1';

const NativeWebSocket = window.WebSocket;
const NativeRTCPeerConnection = window.RTCPeerConnection;
const SIGNAL_URL = 'wss://p2p-signal.lunarlab.uk/signal';
const FALLBACK_HOST = 'rt-d1.lunarlab.uk';
const VERSION = 'p2p-0.1';
const MAX_PLAYERS = 15;
const RECONNECT_GRACE_MS = 180000;
const SIGNAL_TIMEOUT_MS = 7000;
const ICE_TIMEOUT_MS = 12000;
const FAST_TYPES = new Set(['pos']);
const POSITION_SYNC_TYPES = new Set(['emergency','vent','report','kill','ability','task_begin','task_complete','sabotage_fix']);

const diagnostics = {
  version: VERSION,
  mode: 'boot',
  room: '',
  role: '',
  peers: 0,
  selectedPair: '',
  lastError: '',
  signal: 'connecting',
};
window.__DTAM_P2P__ = diagnostics;

function isGameSocketUrl(value) {
  try {
    const u = new URL(String(value), location.href);
    return u.hostname === FALLBACK_HOST && u.pathname === '/ws';
  } catch (_) {
    return false;
  }
}

function sanitizeName(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (text || '玩家').slice(0, 12);
}

function randomPeerId() {
  try { return crypto.randomUUID().replace(/-/g, ''); }
  catch (_) { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

function parseJson(text) {
  try { return JSON.parse(String(text)); } catch (_) { return null; }
}

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
  el.textContent = 'P2P · 准备中';
  el.style.whiteSpace = 'nowrap';
  el.style.fontSize = '12px';
  el.style.opacity = '.85';
  el.style.padding = '2px 7px';
  el.style.border = '1px solid currentColor';
  el.style.borderRadius = '999px';
  latency.insertAdjacentElement('afterend', el);
  return el;
}

function setBadge(text, title = text) {
  const apply = () => {
    const el = ensureBadge();
    if (!el) return;
    el.textContent = text;
    el.title = title;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
}

function updateHostBadge() {
  const host = window.__DTAM_P2P_HOST__;
  if (!host) return;
  const n = host.connectedPeerCount();
  diagnostics.peers = n;
  setBadge(`P2P 房主 · ${n} 直连`, `浏览器内 GameRoom 权威核心 · ${n} 个 WebRTC peer`);
}

async function describePair(pc) {
  try {
    const stats = await pc.getStats();
    let pair = null;
    stats.forEach(r => {
      if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || !pair)) pair = r;
    });
    if (!pair) return 'WebRTC direct';
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    const bits = [local?.candidateType, remote?.candidateType].filter(Boolean).join(' ↔ ');
    const proto = [local?.protocol, remote?.protocol].filter(Boolean).join('/');
    const addr = [local?.address || local?.ip, remote?.address || remote?.ip].filter(Boolean).join(' ↔ ');
    return [bits, proto, addr].filter(Boolean).join(' · ') || 'WebRTC direct';
  } catch (_) {
    return 'WebRTC direct';
  }
}

class BrowserDOContext {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.sockets = new Set();
    this.memory = new Map();
    this.room = null;
    this.alarmTimer = null;
    this.ready = Promise.resolve();
    this.storage = {
      get: async key => this.memory.get(String(key)),
      put: async (key, value) => { this.memory.set(String(key), structuredClone(value)); },
      setAlarm: async at => this.setAlarm(at),
      deleteAlarm: async () => this.deleteAlarm(),
    };
  }
  blockConcurrencyWhile(fn) {
    this.ready = Promise.resolve().then(fn);
    return this.ready;
  }
  acceptWebSocket(ws) { this.sockets.add(ws); }
  getWebSockets() { return [...this.sockets].filter(ws => !ws.closed); }
  detach(ws) { this.sockets.delete(ws); }
  attachRoom(room) { this.room = room; }
  setAlarm(at) {
    this.deleteAlarm();
    const delay = Math.max(0, Math.min(2147483647, Number(at) - Date.now()));
    this.alarmTimer = setTimeout(async () => {
      this.alarmTimer = null;
      try { await this.room?.alarm?.(); } catch (error) { console.warn('[DTAM P2P] alarm', error); }
    }, delay);
  }
  deleteAlarm() {
    if (this.alarmTimer) clearTimeout(this.alarmTimer);
    this.alarmTimer = null;
  }
}

class AuthoritySocket {
  constructor(ctx, sendFn, closeFn, authorityCloseFn) {
    this.ctx = ctx;
    this.sendFn = sendFn;
    this.closeFn = closeFn;
    this.authorityCloseFn = authorityCloseFn;
    this.attachment = null;
    this.closed = false;
    this.ctx.acceptWebSocket(this);
  }
  serializeAttachment(value) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return this.attachment; }
  send(data) {
    if (this.closed) throw new Error('socket closed');
    this.sendFn(String(data));
  }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true;
    this.ctx.detach(this);
    try { this.closeFn?.(code, reason); } catch (_) {}
    queueMicrotask(() => { try { this.authorityCloseFn?.(); } catch (_) {} });
  }
}

class BrowserRoomHost {
  constructor(roomCode, signal) {
    this.roomCode = roomCode;
    this.signal = signal;
    this.ctx = new BrowserDOContext(roomCode);
    this.room = new GameRoom(this.ctx, {});
    this.ctx.attachRoom(this.room);
    this.peers = new Map();
    this.localAuthoritySocket = null;
  }

  async ready() { await this.ctx.ready; }

  connectedPeerCount() {
    let n = 0;
    for (const peer of this.peers.values()) if (peer.control?.readyState === 'open' && peer.fast?.readyState === 'open') n++;
    return n;
  }

  async attachPlayer(authoritySocket, params) {
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
    const staleEmpty = room.initialized && !Object.keys(room.players).length;
    if (staleEmpty) room.resetIfEmpty();
    room.cleanupExpired(now);

    let player = token ? Object.values(room.players).find(p => p.token === token) : null;
    let resumed = false;
    if (player && player.name !== name) player = null;
    const connectionId = randomPeerId();
    if (player && player.connected) { const same = !!clientInstance && !!player.clientInstanceId && player.clientInstanceId === clientInstance, legacy = !player.clientInstanceId, transfer = !!clientInstance && !!handoffInstance && handoffInstance === player.clientInstanceId && clientInstance !== player.clientInstanceId; if (!(same || legacy || transfer)) return this.reject(authoritySocket, 'session_in_use', '这个会话正在另一实例中使用，将作为新玩家加入'); }

    if (player) {
      if (now - Number(player.lastSeen || now) <= RECONNECT_GRACE_MS || player.connected) {
        const old = room.socketForPlayer(player.id);
        if (old && old !== authoritySocket) try { old.close(4002, 'replaced'); } catch (_) {}
        resumed = true;
      } else {
        delete room.players[player.id];
        player = null;
      }
    }

    if (!player) {
      if (create && room.initialized && Object.keys(room.players).length) return this.reject(authoritySocket, 'room_exists', '房间号已存在');
      if (!create && !room.initialized) return this.reject(authoritySocket, 'room_not_found', '房间不存在');
      if (room.phase !== 'lobby') return this.reject(authoritySocket, 'game_in_progress', '游戏已经开始，只能用原会话重连');
      if (Object.keys(room.players).length >= MAX_PLAYERS) return this.reject(authoritySocket, 'room_full', '房间已满');
      if (create && !room.initialized) { room.initialized = true; room.createdAt = now; }
      const id = randomPeerId();
      player = {
        id,
        token: randomPeerId(),
        clientInstanceId: clientInstance,
        name,
        color: room.nextColor(),
        animal: room.nextAnimal(),
        avatar: '',
        pos: room.spawnForIndex(Object.keys(room.players).length),
        connected: true,
        connectionId,
        joinedAt: now,
        lastSeen: now,
        lastMoveAt: now,
        lastChatAt: 0,
        role: '', ghostRole: '', alive: true,
        tasks: [], fakeTasks: [], completed: [],
        killReadyAt: 0, abilityReadyAt: 0, abilityUntil: 0,
        disguiseTargetId: '', hiddenUntil: 0, trackedId: '', trackUntil: 0,
        ventReadyAt: 0, ventExitAt: 0, protectedUntil: 0,
        lastCaseId: '', lastCaseArea: '', poisonedBy: '', poisonEndsAt: 0,
        voiceSessionId: '', voiceTrackName: '', voiceEnabled: false,
        emergencyUsed: 0, inVent: false, ventId: '', activeTask: null,
      };
      room.players[id] = player;
      if (!room.hostId) room.hostId = id;
    }

    if (clientInstance) player.clientInstanceId = clientInstance;
    const previousHostId = room.hostId;
    player.connected = true;
    player.connectionId = connectionId;
    player.lastSeen = now;
    if (!room.players[room.hostId]?.connected) room.electHost();
    authoritySocket.serializeAttachment({ playerId: player.id, token: player.token, connectionId });
    await room.persistNow();
    room.announceHostChange(previousHostId);
    authoritySocket.send(JSON.stringify({
      t: 'welcome', room: this.roomCode, resumed,
      self: { id: player.id, token: player.token }, hostId: room.hostId,
      players: room.publicPlayers(), profiles: room.profiles(), voices: room.voiceDirectory(player),
      bodies: room.bodies, game: room.publicGame(player.id), selfState: room.selfState(player),
      p2p: true,
    }));
    if (!resumed) room.broadcast({ t: 'notice', text: `${player.name} 加入了房间` }, player.id);
    room.broadcastState();
    await room.scheduleNextAlarm();
    return true;
  }

  reject(socket, code, message) {
    try { socket.send(JSON.stringify({ t: 'error', code, message })); } catch (_) {}
    setTimeout(() => { try { socket.close(4000, code); } catch (_) {} }, 40);
    return false;
  }

  async receive(authoritySocket, data) {
    try { await this.room.webSocketMessage(authoritySocket, data); }
    catch (error) { console.warn('[DTAM P2P] game packet', error); }
  }

  async disconnect(authoritySocket) {
    if (!authoritySocket || authoritySocket.closed) return;
    authoritySocket.closed = true;
    this.ctx.detach(authoritySocket);
    try { await this.room.webSocketClose(authoritySocket); } catch (_) {}
  }

  async attachLocal(clientSocket, params) {
    const authority = new AuthoritySocket(
      this.ctx,
      data => clientSocket._deliver(data),
      (code, reason) => clientSocket._serverClosed(code, reason),
      () => this.room.webSocketClose(authority).catch(() => {})
    );
    this.localAuthoritySocket = authority;
    clientSocket._authority = authority;
    clientSocket._roomHost = this;
    clientSocket._markOpen('host');
    await this.attachPlayer(authority, params);
  }

  sendSignal(message) {
    if (this.signal?.readyState === NativeWebSocket.OPEN) this.signal.send(JSON.stringify(message));
  }

  handleSignal(msg) {
    const peerKey = String(msg.peer || msg.from || '');
    if (!peerKey) return;
    if (msg.kind === 'peer-join') { this.createPeer(peerKey).catch(error => console.warn('[DTAM P2P] peer create', error)); return; }
    const peer = this.peers.get(peerKey);
    if (!peer) return;
    if (msg.kind === 'answer') {
      peer.pc.setRemoteDescription(msg.description).then(async () => {
        peer.remoteSet = true;
        for (const c of peer.pendingCandidates.splice(0)) try { await peer.pc.addIceCandidate(c); } catch (_) {}
      }).catch(() => this.dropPeer(peerKey));
    } else if (msg.kind === 'candidate' && msg.candidate) {
      if (peer.remoteSet) peer.pc.addIceCandidate(msg.candidate).catch(() => {});
      else peer.pendingCandidates.push(msg.candidate);
    } else if (msg.kind === 'peer-left') {
      this.dropPeer(peerKey);
    }
  }

  async createPeer(peerKey) {
    this.dropPeer(peerKey);
    const pc = new NativeRTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' });
    const control = pc.createDataChannel('dtam-control', { ordered: true });
    const fast = pc.createDataChannel('dtam-fast', { ordered: true, maxRetransmits: 0 });
    const peer = { peerKey, pc, control, fast, authority: null, pendingCandidates: [], remoteSet: false, joinParams: null, iceTimer: null };
    this.peers.set(peerKey, peer);

    const onOpen = () => {
      if (control.readyState === 'open' && fast.readyState === 'open') {
        clearTimeout(peer.iceTimer);
        updateHostBadge();
      }
    };
    control.onopen = fast.onopen = onOpen;
    control.onclose = fast.onclose = () => this.dropPeer(peerKey);
    control.onerror = fast.onerror = () => this.dropPeer(peerKey);
    control.onmessage = event => this.onPeerMessage(peer, event.data, false);
    fast.onmessage = event => this.onPeerMessage(peer, event.data, true);
    pc.onicecandidate = event => { if (event.candidate) this.sendSignal({ kind: 'candidate', to: peerKey, candidate: event.candidate.toJSON?.() || event.candidate }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.dropPeer(peerKey);
      if (pc.connectionState === 'connected') updateHostBadge();
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal({ kind: 'offer', to: peerKey, description: pc.localDescription });
    peer.iceTimer = setTimeout(() => {
      if (pc.connectionState !== 'connected') this.dropPeer(peerKey);
    }, ICE_TIMEOUT_MS);
  }

  async onPeerMessage(peer, raw, fast) {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    if (!peer.authority) {
      const hello = parseJson(text);
      if (!hello || hello.__p2p !== 'join' || fast) return;
      const params = new URLSearchParams(String(hello.query || ''));
      const authority = new AuthoritySocket(
        this.ctx,
        data => {
          const packet = parseJson(data);
          const target = packet?.t === 'pos' ? peer.fast : peer.control;
          if (target?.readyState === 'open') target.send(data);
        },
        (code, reason) => {
          try { if (peer.control?.readyState === 'open') peer.control.send(JSON.stringify({ __p2p: 'close', code, reason })); } catch (_) {}
          try { peer.pc.close(); } catch (_) {}
        },
        () => this.room.webSocketClose(authority).catch(() => {})
      );
      peer.authority = authority;
      const ok = await this.attachPlayer(authority, params);
      if (!ok) setTimeout(() => this.dropPeer(peer.peerKey), 80);
      return;
    }
    await this.receive(peer.authority, text);
  }

  dropPeer(peerKey) {
    const peer = this.peers.get(peerKey);
    if (!peer) return;
    this.peers.delete(peerKey);
    clearTimeout(peer.iceTimer);
    try { peer.pc.close(); } catch (_) {}
    if (peer.authority && !peer.authority.closed) {
      const authority = peer.authority;
      authority.closed = true;
      this.ctx.detach(authority);
      this.room.webSocketClose(authority).catch(() => {});
    }
    updateHostBadge();
  }

  shutdown() {
    for (const key of [...this.peers.keys()]) this.dropPeer(key);
    this.ctx.deleteAlarm();
    try { this.signal?.close(1000, 'host shutdown'); } catch (_) {}
  }
}

class P2PWebSocket extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url, protocols) {
    if (!isGameSocketUrl(url)) return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    super();
    this.url = String(url);
    this.protocol = '';
    this.extensions = '';
    this.binaryType = 'blob';
    this.readyState = P2PWebSocket.CONNECTING;
    this.onopen = this.onmessage = this.onerror = this.onclose = null;
    this._params = new URL(this.url).searchParams;
    this._room = String(this._params.get('room') || '');
    this._create = this._params.get('create') === '1';
    this._peerKey = randomPeerId();
    this._signal = null;
    this._pc = null;
    this._control = null;
    this._fast = null;
    this._pendingCandidates = [];
    this._remoteSet = false;
    this._opened = false;
    this._closed = false;
    this._native = null;
    this._signalReady = false;
    this._lastPositionPacket = '';
    this._signalTimer = null;
    this._iceTimer = null;
    diagnostics.room = this._room;
    diagnostics.role = this._create ? 'host' : 'peer';
    queueMicrotask(() => this._start());
  }

  get bufferedAmount() {
    if (this._native) return Number(this._native.bufferedAmount || 0);
    return Number(this._control?.bufferedAmount || 0) + Number(this._fast?.bufferedAmount || 0);
  }

  _emit(type, event) {
    const cb = this[`on${type}`];
    if (typeof cb === 'function') try { cb.call(this, event); } catch (error) { setTimeout(() => { throw error; }, 0); }
    try { this.dispatchEvent(event); } catch (_) {}
  }

  _markOpen(mode = 'peer') {
    if (this._opened || this._closed) return;
    this._opened = true;
    this.readyState = P2PWebSocket.OPEN;
    diagnostics.mode = mode === 'host' ? 'browser-host' : 'p2p-direct';
    this._emit('open', new Event('open'));
  }

  _deliver(data) {
    if (this._closed) return;
    this._emit('message', new MessageEvent('message', { data: String(data), origin: location.origin }));
  }

  _serverClosed(code = 1000, reason = '') {
    this._finalClose(code, reason, code === 1000);
  }

  _finalClose(code = 1006, reason = '', clean = false) {
    if (this._closed) return;
    this._closed = true;
    clearTimeout(this._signalTimer); clearTimeout(this._iceTimer);
    this.readyState = P2PWebSocket.CLOSED;
    try { this._pc?.close(); } catch (_) {}
    this._emit('close', makeCloseEvent(code, reason, clean));
  }

  async _start() {
    if (this._closed) return;
    if (typeof NativeRTCPeerConnection !== 'function') { this._fallbackNative('浏览器不支持 WebRTC'); return; }
    const role = this._create ? 'host' : 'peer';
    const signalUrl = new URL(SIGNAL_URL);
    signalUrl.searchParams.set('room', this._room);
    signalUrl.searchParams.set('role', role);
    signalUrl.searchParams.set('peer', this._peerKey);
    let signal;
    try { signal = new NativeWebSocket(signalUrl.href); }
    catch (error) { this._fallbackNative(String(error?.message || error)); return; }
    this._signal = signal;
    diagnostics.signal = 'connecting';
    this._signalTimer = setTimeout(() => {
      if (!this._signalReady && !this._opened) this._fallbackNative('P2P 信令超时');
    }, SIGNAL_TIMEOUT_MS);

    signal.onopen = () => { diagnostics.signal = 'online'; };
    signal.onerror = () => {};
    signal.onmessage = event => this._onSignal(parseJson(event.data));
    signal.onclose = () => {
      diagnostics.signal = 'offline';
      if (!this._signalReady && !this._opened) { this._fallbackNative('P2P 信令不可用'); return; }
      if (this._opened && this._pc?.connectionState === 'connected') setBadge('P2P 直连 · 信令离线', '当前 DataChannel 仍在工作；不能建立新 ICE 路径');
      if (this._create && this._opened) setBadge('P2P 房主 · 信令离线', '现有直连仍可继续；新玩家暂时无法加入');
    };
  }

  async _onSignal(msg) {
    if (!msg || this._closed) return;
    if (msg.kind === 'room-exists' && this._create) {
      clearTimeout(this._signalTimer);
      this._signalReady = true;
      this._markOpen('host');
      this._deliver(JSON.stringify({ t: 'error', code: 'room_exists', message: '房间号已存在' }));
      setTimeout(() => this._finalClose(4409, 'room exists', true), 60);
      return;
    }
    if (msg.kind === 'no-host' && !this._create) { this._fallbackNative('没有在线 P2P 房主'); return; }
    if (msg.kind === 'host-ready' && this._create) {
      clearTimeout(this._signalTimer);
      this._signalReady = true;
      diagnostics.signal = 'online';
      const host = new BrowserRoomHost(this._room, this._signal);
      window.__DTAM_P2P_HOST__ = host;
      await host.attachLocal(this, this._params);
      updateHostBadge();
      return;
    }
    if (this._create) {
      window.__DTAM_P2P_HOST__?.handleSignal(msg);
      return;
    }
    if (msg.kind === 'peer-ready') { this._signalReady = true; clearTimeout(this._signalTimer); return; }
    if (msg.kind === 'offer') { await this._acceptOffer(msg.description); return; }
    if (msg.kind === 'candidate' && msg.candidate) {
      if (this._remoteSet && this._pc) this._pc.addIceCandidate(msg.candidate).catch(() => {});
      else this._pendingCandidates.push(msg.candidate);
      return;
    }
    if (msg.kind === 'host-left') {
      if (!this._opened) this._fallbackNative('P2P 房主已离线'); else this._finalClose(4411, 'P2P host left', false);
    }
  }

  _sendSignal(message) {
    if (this._signal?.readyState === NativeWebSocket.OPEN) this._signal.send(JSON.stringify(message));
  }

  async _acceptOffer(description) {
    if (!description || this._closed) return;
    if (this._pc) try { this._pc.close(); } catch (_) {}
    const pc = new NativeRTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' });
    this._pc = pc;
    this._pendingCandidates = [];
    this._remoteSet = false;
    pc.ondatachannel = event => this._bindChannel(event.channel);
    pc.onicecandidate = event => { if (event.candidate) this._sendSignal({ kind: 'candidate', candidate: event.candidate.toJSON?.() || event.candidate }); };
    pc.onconnectionstatechange = async () => {
      if (pc.connectionState === 'connected') {
        clearTimeout(this._iceTimer);
        const pair = await describePair(pc);
        diagnostics.selectedPair = pair;
        setBadge('P2P 直连', pair);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (!this._opened) this._fallbackNative('P2P ICE 失败'); else this._finalClose(1006, 'P2P ICE failed', false);
      }
    };
    await pc.setRemoteDescription(description);
    this._remoteSet = true;
    for (const c of this._pendingCandidates.splice(0)) try { await pc.addIceCandidate(c); } catch (_) {}
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this._sendSignal({ kind: 'answer', description: pc.localDescription });
    this._iceTimer = setTimeout(() => {
      if (!this._opened) this._fallbackNative('P2P ICE 建链超时');
    }, ICE_TIMEOUT_MS);
  }

  _bindChannel(channel) {
    channel.binaryType = 'arraybuffer';
    if (channel.label === 'dtam-control') this._control = channel;
    else if (channel.label === 'dtam-fast') this._fast = channel;
    else { try { channel.close(); } catch (_) {} return; }
    channel.onmessage = event => {
      const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
      const control = parseJson(text);
      if (control?.__p2p === 'close') { this._finalClose(Number(control.code || 1000), String(control.reason || ''), Number(control.code || 1000) === 1000); return; }
      this._deliver(text);
    };
    channel.onopen = () => {
      if (this._control?.readyState === 'open' && this._fast?.readyState === 'open' && !this._opened) {
        this._markOpen('peer');
        diagnostics.mode = 'p2p-direct';
        this._control.send(JSON.stringify({ __p2p: 'join', query: this._params.toString(), version: VERSION }));
      }
    };
    channel.onclose = () => { if (this._opened) this._finalClose(1006, 'P2P data channel closed', false); };
    channel.onerror = () => { if (this._opened) this._finalClose(1006, 'P2P data channel error', false); };
  }

  _fallbackNative(reason) {
    if (this._closed || this._native || this._opened) return;
    diagnostics.lastError = reason;
    diagnostics.mode = 'home-fallback';
    setBadge('P2P → 家中回退', reason + '；尝试 rt-d1.lunarlab.uk');
    clearTimeout(this._signalTimer); clearTimeout(this._iceTimer);
    try { this._signal?.close(); } catch (_) {}
    try { this._pc?.close(); } catch (_) {}
    let ws;
    try { ws = new NativeWebSocket(this.url); }
    catch (_) { this._finalClose(1006, 'fallback unavailable', false); return; }
    this._native = ws;
    ws.binaryType = this.binaryType;
    ws.onopen = () => { this._markOpen('fallback'); setBadge('家中服务器 fallback', 'P2P 不可用，当前使用 rt-d1'); };
    ws.onmessage = event => this._deliver(event.data);
    ws.onerror = event => this._emit('error', event instanceof Event ? event : new Event('error'));
    ws.onclose = event => this._finalClose(event.code || 1006, event.reason || '', !!event.wasClean);
  }

  send(data) {
    if (this._native) { this._native.send(data); return; }
    if (this.readyState !== P2PWebSocket.OPEN) throw new DOMException('WebSocket is not open', 'InvalidStateError');
    if (this._roomHost && this._authority) { this._roomHost.receive(this._authority, String(data)); return; }
    const packet = parseJson(data);
    const type = String(packet?.t || '');
    if (type === 'pos') this._lastPositionPacket = String(data);
    if (POSITION_SYNC_TYPES.has(type) && this._control?.readyState === 'open') {
      if (this._lastPositionPacket) this._control.send(this._lastPositionPacket);
      this._control.send(data);
      return;
    }
    const target = FAST_TYPES.has(type) ? this._fast : this._control;
    if (!target || target.readyState !== 'open') throw new DOMException('P2P transport unavailable', 'NetworkError');
    if (FAST_TYPES.has(type) && target.bufferedAmount > 65536) return;
    target.send(data);
  }

  close(code = 1000, reason = '') {
    if (this.readyState === P2PWebSocket.CLOSED || this.readyState === P2PWebSocket.CLOSING) return;
    this.readyState = P2PWebSocket.CLOSING;
    if (this._native) { try { this._native.close(code, reason); } catch (_) { this._finalClose(code, reason, true); } return; }
    if (this._roomHost && this._authority) {
      const host = this._roomHost;
      host.receive(this._authority, JSON.stringify({ t: 'leave' })).finally(() => {
        host.shutdown();
        if (window.__DTAM_P2P_HOST__ === host) window.__DTAM_P2P_HOST__ = null;
        this._finalClose(code, reason, true);
      });
      return;
    }
    try { this._control?.close(); this._fast?.close(); this._pc?.close(); this._signal?.close(); } catch (_) {}
    this._finalClose(code, reason, true);
  }
}

Object.defineProperties(P2PWebSocket.prototype, {
  CONNECTING: { value: 0 }, OPEN: { value: 1 }, CLOSING: { value: 2 }, CLOSED: { value: 3 },
});

window.WebSocket = P2PWebSocket;
setBadge('P2P · 准备中', '房主浏览器权威 + WebRTC DataChannel；失败时尝试家中 rt-d1');
console.log('DTAM experimental P2P browser-host transport', VERSION);

await import('./game.js?v=20260918-v302session6-p2p');
