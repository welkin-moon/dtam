import { GameRoom } from './worker.js?v=20261006-playfix1';
import {
  getNetworkConfig,
  serverTargetFor,
  describeNetworkMode,
} from './net-config.js?v=20260824-direct-m3e1';
import './native-transport-upgrade.js?v=20260829-native1';

const bootConfig = getNetworkConfig();
if (bootConfig.mode === 'server') {
  await import('./v3-bootstrap.js?v=20260824-direct-m3e1');
  await import('./v3-resilience.js?v=20260824-direct-m3e1');
}
const NativeWebSocket = window.__DTAM_NATIVE_WEBSOCKET__ || window.WebSocket,
  NativeRTCPeerConnection = window.RTCPeerConnection,
  SIGNAL = 'https://p2p-signal.lunarlab.uk',
  VER = 'hybrid-0.6.3-playfix',
  MAP_PROTOCOL_ID = 'dtam-map-150-v1';
const FAST_OUT = new Set(['pos', 'ping']),
  FAST_IN = new Set(['pos', 'pong']),
  SYNC = new Set([
    'emergency',
    'vent',
    'report',
    'kill',
    'ability',
    'task_begin',
    'task_complete',
    'sabotage_fix',
  ]);
const POLL = [120, 220, 360, 550, 850, 1300, 1900, 2800],
  JOIN_POLL = 900,
  SERVER_PRIMARY_TIMEOUT = 1800,
  ICE_GATHER = 6500,
  ICE_CONNECT = 12000,
  RECOVER_KEY = 'au-dtam-p2p-recovery:',
  SNAP_KEY = 'au-dtam-p2p-snapshot:';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  parse = (x) => {
    try {
      return JSON.parse(String(x));
    } catch (_) {
      return null;
    }
  },
  rid = () => {
    try {
      return crypto.randomUUID().replace(/-/g, '');
    } catch (_) {
      return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  };
const diag = (window.__DTAM_NET__ = {
  version: VER,
  mode: 'boot',
  configured: getNetworkConfig(),
  pair: '',
  epoch: 0,
  lastError: '',
});
function badge(text, title = text) {
  const run = () => {
    let e = document.getElementById('p2pTransportStatus');
    if (!e) {
      const l = document.getElementById('latencyStatus');
      if (!l?.parentElement) return;
      e = document.createElement('span');
      e.id = 'p2pTransportStatus';
      e.style.cssText =
        'white-space:nowrap;font-size:12px;opacity:.86;padding:2px 7px;border:1px solid currentColor;border-radius:999px';
      l.insertAdjacentElement('afterend', e);
    }
    e.textContent = text;
    e.title = title;
  };
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', run, { once: true })
    : run();
}
function ce(code, reason, clean) {
  try {
    return new CloseEvent('close', { code, reason, wasClean: clean });
  } catch (_) {
    const e = new Event('close');
    e.code = code;
    e.reason = reason;
    e.wasClean = clean;
    return e;
  }
}
async function api(path, opt = {}) {
  const r = await fetch(SIGNAL + path, {
      cache: 'no-store',
      ...opt,
      headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) },
    }),
    d = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 202) {
    const e = Error(d.message || `signal ${r.status}`);
    e.code = d.code || 'signal_error';
    e.status = r.status;
    e.data = d;
    throw e;
  }
  return { status: r.status, data: d };
}
async function waitIce(pc) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise((res) => {
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        pc.removeEventListener('icegatheringstatechange', change);
        res();
      },
      change = () => pc.iceGatheringState === 'complete' && finish(),
      t = setTimeout(finish, ICE_GATHER);
    pc.addEventListener('icegatheringstatechange', change);
  });
}
const unknownMetrics = () => ({
  rttMs: NaN,
  relay: false,
  summary: '正在确认连接路径',
  channel: 'WebRTC 路径未知',
  lossRate: 0,
  natType: '未知',
});
async function pairMetrics(pc) {
  const nativeRtt = Number(pc?.__dtamNativeRttMs);
  if (pc?.__dtamNativeOpen)
    return {
      rttMs: Number.isFinite(nativeRtt) ? nativeRtt : NaN,
      relay: false,
      summary: `Native ${String(pc.__dtamNativePath || 'direct').toUpperCase()}`,
      channel: 'Direct WebRTC',
      lossRate: 0,
      natType: 'Native Direct',
    };
  try {
    const s = await pc.getStats();
    let p = null,
      selectedId = '',
      packetsReceived = 0,
      packetsLost = 0;
    s.forEach((x) => {
      if (x.type === 'transport' && x.selectedCandidatePairId)
        selectedId = x.selectedCandidatePairId;
      if (
        x.type === 'candidate-pair' &&
        x.state === 'succeeded' &&
        (x.selected || x.nominated)
      )
        p = x;
      if (x.type === 'inbound-rtp') {
        packetsReceived += Number(x.packetsReceived || 0);
        packetsLost += Number(x.packetsLost || 0);
      }
    });
    p = s.get(selectedId) || p;
    if (!p || p.state !== 'succeeded') return unknownMetrics();
    const l = s.get(p.localCandidateId),
      r = s.get(p.remoteCandidateId),
      rt = Number(p.currentRoundTripTime),
      relay = l?.candidateType === 'relay' || r?.candidateType === 'relay',
      summary =
        [
          l?.candidateType && r?.candidateType
            ? `${l.candidateType} ↔ ${r.candidateType}`
            : '',
          l?.protocol || r?.protocol || '',
          l?.address || l?.ip || '',
        ]
          .filter(Boolean)
          .join(' · ') || 'WebRTC direct';
    const channel = relay ? 'TURN 中继' : 'Direct WebRTC';
    let natType = 'Direct (Host)';
    if (relay) natType = 'Relayed (TURN)';
    else if (
      l?.candidateType === 'srflx' ||
      r?.candidateType === 'srflx' ||
      l?.candidateType === 'prflx' ||
      r?.candidateType === 'prflx'
    )
      natType = 'NAT Hole Punch (STUN Reflexive)';
    let lossRate = 0;
    if (packetsLost > 0 && packetsLost + packetsReceived > 0)
      lossRate = Math.min(
        1,
        Math.max(0, packetsLost / (packetsLost + packetsReceived)),
      );
    else if (p.packetsDiscardedOnSend && p.packetsSent)
      lossRate = Math.min(
        1,
        Math.max(0, p.packetsDiscardedOnSend / p.packetsSent),
      );
    return {
      rttMs: Number.isFinite(rt) && rt >= 0 ? rt * 1000 : NaN,
      relay,
      summary,
      channel,
      lossRate,
      natType,
    };
  } catch (_) {
    return unknownMetrics();
  }
}
async function pairSummary(pc) {
  return (await pairMetrics(pc)).summary;
}
async function pairRtt(pc) {
  return (await pairMetrics(pc)).rttMs;
}
function qualityChanged() {
  try {
    window.dispatchEvent(
      new CustomEvent('dtam-network-quality', { detail: { ...diag } }),
    );
  } catch (_) {}
}
function recoverStore(room, v) {
  try {
    if (v) localStorage.setItem(RECOVER_KEY + room, JSON.stringify(v));
    else localStorage.removeItem(RECOVER_KEY + room);
  } catch (_) {}
}
function recoverLoad(room) {
  try {
    return JSON.parse(localStorage.getItem(RECOVER_KEY + room) || 'null');
  } catch (_) {
    return null;
  }
}
function snapStore(room, s) {
  try {
    sessionStorage.setItem(SNAP_KEY + room, JSON.stringify(s));
  } catch (_) {}
}
function snapLoad(room) {
  try {
    return JSON.parse(sessionStorage.getItem(SNAP_KEY + room) || 'null');
  } catch (_) {
    return null;
  }
}

const CHUNK_SIZE = 12288;
const chunkBuffers = new WeakMap();
const MAX_ASSEMBLED_CHARS = 262144;
function sendChunked(ch, rawText) {
  rawText = String(rawText);
  if (rawText.length > MAX_ASSEMBLED_CHARS || ch.bufferedAmount > 1048576)
    throw new DOMException('Reliable channel overloaded', 'NetworkError');
  if (rawText.length <= CHUNK_SIZE) {
    ch.send(rawText);
    return;
  }
  const id = rid(),
    total = Math.ceil(rawText.length / CHUNK_SIZE);
  for (let i = 0; i < total; i++)
    ch.send(
      JSON.stringify({
        __dtamChunk: true,
        id,
        i,
        total,
        data: rawText.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      }),
    );
}
function clearChunks(owner) {
  const groups = chunkBuffers.get(owner);
  if (groups) for (const group of groups.values()) clearTimeout(group.timer);
  chunkBuffers.delete(owner);
}
function assembleChunk(rawText, owner) {
  const packet = parse(rawText);
  if (!packet?.__dtamChunk) return rawText;
  const { id, i, total, data } = packet;
  if (
    !owner ||
    typeof id !== 'string' ||
    !/^[a-z0-9]{16,64}$/i.test(id) ||
    !Number.isInteger(total) ||
    total < 1 ||
    total > 22 ||
    !Number.isInteger(i) ||
    i < 0 ||
    i >= total ||
    typeof data !== 'string' ||
    data.length > CHUNK_SIZE
  )
    throw new Error('Invalid message fragment');
  let groups = chunkBuffers.get(owner);
  if (!groups) {
    groups = new Map();
    chunkBuffers.set(owner, groups);
  }
  let group = groups.get(id);
  if (!group) {
    if (groups.size >= 4) throw new Error('Too many fragmented messages');
    group = {
      parts: new Array(total),
      total,
      received: 0,
      chars: 0,
      timer: setTimeout(() => groups.delete(id), 30000),
    };
    groups.set(id, group);
  }
  if (group.total !== total) throw new Error('Fragment count changed');
  if (group.parts[i] === undefined) {
    group.parts[i] = data;
    group.received++;
    group.chars += data.length;
    if (group.chars > MAX_ASSEMBLED_CHARS)
      throw new Error('Fragmented message too large');
  } else if (group.parts[i] !== data)
    throw new Error('Conflicting message fragment');
  if (group.received !== total) return null;
  clearTimeout(group.timer);
  groups.delete(id);
  return group.parts.join('');
}

class Ctx {
  constructor(snapshot = null) {
    this.sockets = new Set();
    this.mem = new Map();
    if (snapshot) this.mem.set('snapshot', snapshot);
    this.room = null;
    this.closed = false;
    this.alarm = null;
    this.ready = Promise.resolve();
    this.storage = {
      get: async (k) => this.mem.get(String(k)),
      put: async (k, v) => this.mem.set(String(k), structuredClone(v)),
      setAlarm: async (t) => this.setAlarm(t),
      deleteAlarm: async () => this.delAlarm(),
    };
  }
  blockConcurrencyWhile(f) {
    this.ready = Promise.resolve().then(f);
    return this.ready;
  }
  acceptWebSocket(s) {
    this.sockets.add(s);
  }
  getWebSockets() {
    return [...this.sockets].filter((s) => !s.closed);
  }
  detach(s) {
    this.sockets.delete(s);
  }
  setRoom(r) {
    this.room = r;
  }
  setAlarm(at) {
    this.delAlarm();
    if (this.closed) return;
    this.alarm = setTimeout(
      async () => {
        this.alarm = null;
        try {
          await this.room?.alarm?.();
        } catch (e) {
          console.warn('[hybrid alarm]', e);
        }
      },
      Math.max(0, Math.min(2147483647, Number(at) - Date.now())),
    );
  }
  delAlarm() {
    if (this.alarm) clearTimeout(this.alarm);
    this.alarm = null;
  }
}
class Sock {
  constructor(ctx, send, close) {
    this.ctx = ctx;
    this.sendFn = send;
    this.closeFn = close;
    this.a = null;
    this.closed = false;
    ctx.acceptWebSocket(this);
  }
  serializeAttachment(v) {
    this.a = structuredClone(v);
  }
  deserializeAttachment() {
    return this.a;
  }
  send(x) {
    if (this.closed) throw Error('closed');
    this.sendFn(String(x));
  }
  close(c = 1000, r = '') {
    if (this.closed) return;
    this.closed = true;
    this.ctx.detach(this);
    try {
      this.closeFn?.(c, r);
    } catch (_) {}
  }
}
class Authority {
  constructor(room, snapshot = null) {
    this.roomCode = room;
    this.ctx = new Ctx(snapshot);
    this.room = new GameRoom(this.ctx, {});
    this.ctx.setRoom(this.room);
    this.peers = new Map();
  }
  async ready() {
    await this.ctx.ready;
  }
  snapshot() {
    return this.room.snapshot();
  }
  receive(sock, data) {
    if (sock.closed || this.ctx.closed) return Promise.resolve();
    const text = String(data),
      bytes = text.length * 2;
    if (
      (sock.pendingCount || 0) >= 64 ||
      (sock.pendingBytes || 0) + bytes > 262144
    ) {
      sock.close(4005, 'queue_overflow');
      return Promise.resolve();
    }
    sock.pendingCount = (sock.pendingCount || 0) + 1;
    sock.pendingBytes = (sock.pendingBytes || 0) + bytes;
    sock.queue = (sock.queue || Promise.resolve()).then(async () => {
      try {
        await this.ready();
        if (!sock.closed && !this.ctx.closed)
          await this.room.webSocketMessage(sock, text);
      } catch (error) {
        console.warn('[hybrid packet]', error);
        sock.close(4005, 'authority_error');
      } finally {
        sock.pendingCount--;
        sock.pendingBytes -= bytes;
      }
    });
    return sock.queue;
  }
  async gone(id) {
    const sock = this.peers.get(id);
    if (!sock) return;
    this.peers.delete(id);
    sock.closed = true;
    this.ctx.detach(sock);
    // close() can already have marked it closed; the player still needs to
    // become disconnected, release task locks and stop counting as a voter.
    if (!this.ctx.closed) await this.room.webSocketClose(sock);
  }
  make(id, sendControl, sendFast, close) {
    const sock = new Sock(
      this.ctx,
      (data) => (FAST_IN.has(parse(data)?.t) ? sendFast : sendControl)(data),
      close,
    );
    sock.queue = Promise.resolve();
    this.peers.set(id, sock);
    return sock;
  }
  shutdown() {
    this.ctx.closed = true;
    this.ctx.delAlarm();
    clearTimeout(this.room.persistTimer);
    this.room.persistTimer = null;
    for (const sock of this.ctx.getWebSockets())
      sock.close(4403, 'authority_lost');
    this.peers.clear();
  }
}

async function attach(authority, sock, params) {
  await authority.ready();
  if (sock.closed || authority.ctx.closed) return false;
  if (String(params.get('map') || '') !== MAP_PROTOCOL_ID)
    return reject(sock, 'version_mismatch', '客户端版本已过期，请刷新页面');
  const room = authority.room,
    name =
      String(params.get('name') || '玩家')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 12) || '玩家',
    token = String(params.get('token') || ''),
    rawClient = String(params.get('client') || ''),
    client = /^[A-Za-z0-9_-]{16,64}$/.test(rawClient) ? rawClient : '',
    rawHandoff = String(params.get('handoff') || ''),
    handoff = /^[A-Za-z0-9_-]{16,64}$/.test(rawHandoff) ? rawHandoff : '',
    create = params.get('create') === '1',
    t = Date.now();
  room.cleanupExpired(t);
  let p = token
      ? Object.values(room.players).find((x) => x.token === token)
      : null,
    resumed = false;
  const cid = rid();
  if (p && p.connected) {
    const same =
        !!client && !!p.clientInstanceId && p.clientInstanceId === client,
      legacy = !p.clientInstanceId,
      transfer =
        !!client &&
        !!handoff &&
        handoff === p.clientInstanceId &&
        client !== p.clientInstanceId;
    if (!(same || legacy || transfer))
      return reject(
        sock,
        'session_in_use',
        '这个会话正在另一实例中使用，将作为新玩家加入',
      );
  }
  if (p) {
    resumed = true;
    p.clientMoveSeq = 0;
    const old = room.socketForPlayer(p.id);
    if (old && old !== sock)
      try {
        old.close(4002, 'replaced');
      } catch (_) {}
  } else {
    if (/\d$/.test(name))
      return reject(
        sock,
        'name_invalid',
        '昵称不能以数字结尾；重名时系统会自动添加数字',
      );
    if (create && room.initialized && Object.keys(room.players).length)
      return reject(sock, 'room_exists', '房间号已存在');
    if (!create && !room.initialized)
      return reject(sock, 'room_not_found', '房间不存在');
    if (room.phase !== 'lobby')
      return reject(sock, 'game_in_progress', '游戏已经开始，只能原玩家重连');
    if (Object.keys(room.players).length >= 15)
      return reject(sock, 'room_full', '房间已满');
    if (create && !room.initialized) {
      room.initialized = true;
      room.createdAt = t;
    }
    const id = rid(),
      used = new Set(
        Object.values(room.players).map((x) => String(x.name || '')),
      );
    let assigned = name;
    if (used.has(assigned)) {
      for (let n = 2; n <= 99; n++) {
        const suffix = String(n),
          stem = [...name]
            .slice(0, Math.max(1, 12 - [...suffix].length))
            .join(''),
          candidate = stem + suffix;
        if (!used.has(candidate)) {
          assigned = candidate;
          break;
        }
      }
    }
    p = {
      id,
      token: rid(),
      clientInstanceId: client,
      name: assigned,
      color: room.nextColor(),
      animal: room.nextAnimal(),
      avatar: '',
      pos: room.spawnForIndex(Object.keys(room.players).length),
      moveSeq: 0,
      clientMoveSeq: 0,
      connected: true,
      connectionId: cid,
      joinedAt: t,
      lastSeen: t,
      lastMoveAt: t,
      lastChatAt: 0,
      role: '',
      ghostRole: '',
      alive: true,
      tasks: [],
      fakeTasks: [],
      completed: [],
      killReadyAt: 0,
      abilityReadyAt: 0,
      abilityUntil: 0,
      disguiseTargetId: '',
      hiddenUntil: 0,
      trackedId: '',
      trackUntil: 0,
      ventReadyAt: 0,
      ventExitAt: 0,
      protectedUntil: 0,
      lastCaseId: '',
      lastCaseArea: '',
      poisonedBy: '',
      poisonEndsAt: 0,
      voiceSessionId: '',
      voiceTrackName: '',
      voiceEnabled: false,
      emergencyUsed: 0,
      inVent: false,
      ventId: '',
      activeTask: null,
    };
    room.players[id] = p;
    if (!room.hostId) room.hostId = id;
  }
  if (client) p.clientInstanceId = client;
  const prev = room.hostId;
  p.connected = true;
  p.connectionId = cid;
  p.lastSeen = t;
  if (!room.players[room.hostId]?.connected) room.electHost();
  sock.serializeAttachment({
    playerId: p.id,
    token: p.token,
    connectionId: cid,
  });
  await room.persistNow();
  room.announceHostChange(prev);
  sock.send(
    JSON.stringify({
      t: 'welcome',
      room: authority.roomCode,
      mapId: MAP_PROTOCOL_ID,
      resumed,
      self: { id: p.id, token: p.token, name: p.name },
      features: {
        bushVision: true,
        mapManifest: '/maps/east-beach-v1.json',
        musicSync: true,
        roomIdentityV2: true,
        p2pFallbackV2: true,
      },
      hostId: room.hostId,
      players: room.publicPlayers(),
      profiles: room.profiles(),
      voices: room.voiceDirectory(p),
      bodies: room.bodies,
      chatHistory: room.publicChatHistory(p),
      game: room.publicGame(p.id),
      selfState: room.selfState(p),
      p2p: true,
    }),
  );
  if (!resumed)
    room.broadcast({ t: 'notice', text: `${p.name} 加入了房间` }, p.id);
  room.broadcastState();
  await room.scheduleNextAlarm();
  return true;
}
function reject(s, c, m) {
  try {
    s.send(JSON.stringify({ t: 'error', code: c, message: m }));
  } catch (_) {}
  setTimeout(() => {
    try {
      s.close(4000, c);
    } catch (_) {}
  }, 30);
  return false;
}

class Mailbox {
  constructor(room, hostToken, recovery, epoch, auth) {
    this.room = room;
    this.hostToken = hostToken;
    this.recovery = recovery;
    this.epoch = epoch;
    this.auth = auth;
    this.peers = new Map();
    this.timer = null;
    this.stopped = false;
    this.snapTimer = null;
    this.heartbeatTimer = null;
    this.heartbeatBusy = false;
    this.statsBusy = false;
    this.destroyed = false;
    this.polling = false;
    this.emptyStreak = 0;
    this.statsTimer = setInterval(() => this.sampleStats(), 1000);
  }
  start() {
    if (this.destroyed) return;
    this.stopped = false;
    this.emptyStreak = 0;
    this.poll();
    this.startSnapshots();
    this.startHeartbeat();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
  }
  startSnapshots() {
    clearInterval(this.snapTimer);
    this.snapTimer = setInterval(() => this.pushSnapshot(), 1800);
  }
  startHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeat().catch(() => {});
    this.heartbeatTimer = setInterval(
      () => this.heartbeat().catch(() => {}),
      7000,
    );
  }
  async heartbeat() {
    if (this.destroyed || this.heartbeatBusy) return;
    this.heartbeatBusy = true;
    try {
      await api(`/v2/rooms/${this.room}/heartbeat`, {
        method: 'POST',
        body: JSON.stringify({ hostToken: this.hostToken }),
      });
    } catch (e) {
      if (['room_not_found', 'forbidden'].includes(e?.code))
        this.loseAuthority();
    } finally {
      this.heartbeatBusy = false;
    }
  }
  sendSnapshotTo(p, full = true) {
    if (
      !p?.open ||
      p.dead ||
      (p.control?.readyState !== 'open' && !p.pc?.__dtamNativeOpen)
    )
      return false;
    try {
      const packet = JSON.stringify({
        __dtamRecovery: true,
        recoveryToken: this.recovery,
        epoch: this.epoch,
        standby: full,
        ...(full ? { snapshot: { ...this.auth.snapshot(), authorityEpoch: this.epoch } } : {}),
      });
      sendChunked(p.control, packet);
      if (new URLSearchParams(location.search).get('debug') === '1')
        console.info(
          '[DTAM recovery] snapshot sent',
          this.room,
          packet.length,
          this.epoch,
        );
      return true;
    } catch (e) {
      if (new URLSearchParams(location.search).get('debug') === '1')
        console.warn(
          '[DTAM recovery] snapshot send failed',
          this.room,
          String(e?.message || e),
        );
      return false;
    }
  }
  pushSnapshot() {
    const peers = [...this.peers.entries()]
      .filter(([, x]) => x.open && x.attached && !x.dead)
      .sort((a, b) => a[0].localeCompare(b[0]));
    const standbys = new Set(peers.slice(0, 2).map(([id]) => id));
    for (const [id, p] of peers) this.sendSnapshotTo(p, standbys.has(id));
  }

  async state(st) {
    try {
      await api(`/v2/rooms/${this.room}/state`, {
        method: 'POST',
        body: JSON.stringify({ hostToken: this.hostToken, state: st }),
      });
    } catch (_) {}
  }
  async poll() {
    if (this.stopped || this.destroyed || this.polling) return;
    this.polling = true;
    let nextDelay = 1500;
    try {
      const { data } = await api(
        `/v2/rooms/${this.room}/joins?hostToken=${encodeURIComponent(this.hostToken)}`,
      );
      if (this.stopped || this.destroyed) {
        this.polling = false;
        return;
      }
      if (Number(data.epoch) !== this.epoch) {
        this.loseAuthority();
        return;
      }
      let newPeers = 0;
      for (const p of data.peers || [])
        if (!this.peers.has(p.peerId)) {
          newPeers++;
          this.peer(p.peerId).catch((e) => console.warn('[peer]', e));
        }
      if (newPeers > 0) this.emptyStreak = 0;
      else this.emptyStreak++;
      const bell =
        typeof window !== 'undefined' &&
        window.__DTAM_BELL__?.connected === true &&
        String(window.__DTAM_BELL__?.room || '') === String(this.room);
      if (bell) {
        nextDelay = 15000 + Math.random() * 3000;
      } else {
        const steps = [1500, 2200, 3200, 4800, 6500, 8000],
          stepDelay = steps[Math.min(this.emptyStreak, steps.length - 1)],
          jitter = Math.random() * 600;
        nextDelay = Math.min(8000, stepDelay + jitter);
      }
    } catch (e) {
      if (this.destroyed) return;
      if (['forbidden', 'room_not_found'].includes(e?.code)) {
        this.loseAuthority();
        return;
      }
      console.warn('[poll]', e);
      const status = Number(e?.status || 0);
      if (status === 429 || (status >= 500 && status < 600)) {
        nextDelay = 10000 + Math.random() * 5000;
      } else {
        nextDelay = 3000 + Math.random() * 1000;
      }
    }
    this.polling = false;
    if (!this.stopped && !this.destroyed)
      this.timer = setTimeout(() => this.poll(), nextDelay);
  }
  async peer(id) {
    if (this.destroyed || this.peers.has(id)) return;
    const pc = new NativeRTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      bundlePolicy: 'max-bundle',
      dtamGameplay: true,
    });
    const c = pc.createDataChannel('dtam-control', {
      ordered: true,
      priority: 'high',
    });
    const f = pc.createDataChannel('dtam-fast', {
      ordered: false,
      maxRetransmits: 0,
      priority: 'high',
    });
    const st = {
      pc,
      control: c,
      fast: f,
      sock: null,
      open: false,
      dead: false,
      attached: false,
      attaching: false,
      timer: null,
    };
    this.peers.set(id, st);
    const drop = async (code = 1006, reason = 'peer_disconnected') => {
      if (st.dead) return;
      st.dead = true;
      clearTimeout(st.timer);
      clearChunks(pc);
      try {
        if (c.readyState === 'open')
          c.send(JSON.stringify({ __dtamClose: true, code, reason }));
      } catch (_) {}
      try {
        pc.close();
      } catch (_) {}
      await this.auth.gone(id);
      this.peers.delete(id);
      this.sampleStats();
    };
    const reliable = (data) => {
      if (st.dead) return;
      try {
        if (c.readyState !== 'open' && !pc.__dtamNativeOpen)
          throw new Error('Control channel closed');
        sendChunked(c, data);
      } catch (_) {
        drop(4005, 'control_overflow');
      }
    };
    const fast = (data) => {
      if (
        st.dead ||
        (f.readyState !== 'open' && !pc.__dtamNativeOpen) ||
        f.bufferedAmount > 4096
      )
        return;
      try {
        f.send(data);
      } catch (_) {}
    };
    const sock = this.auth.make(id, reliable, fast, (code, reason) =>
      drop(code, reason),
    );
    st.sock = sock;
    const pending = [];
    let pendingBytes = 0;
    c.onmessage = async (event) => {
      if (st.dead) return;
      let text;
      try {
        text = assembleChunk(
          typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data),
          pc,
        );
      } catch (_) {
        return drop(4005, 'invalid_fragment');
      }
      if (text === null) return;
      const packet = parse(text);
      if (packet?.__dtamJoin) {
        if (st.attached || st.attaching) return;
        st.attaching = true;
        try {
          const params = new URLSearchParams(String(packet.query || ''));
          if (
            params.get('room') !== this.room ||
            c.readyState !== 'open' ||
            f.readyState !== 'open'
          )
            return drop(4406, 'invalid_join');
          const ok = await attach(this.auth, sock, params);
          if (!ok || st.dead) return;
          st.attached = true;
          this.sendSnapshotTo(st, false);
          this.pushSnapshot();
          for (const queued of pending) await this.auth.receive(sock, queued);
          pending.length = 0;
          pendingBytes = 0;
        } catch (_) {
          drop(4005, 'attach_failed');
        } finally {
          st.attaching = false;
        }
        return;
      }
      if (!st.attached) {
        if (pending.length >= 32 || pendingBytes + text.length * 2 > 65536)
          return drop(4005, 'pre_attach_overflow');
        pending.push(text);
        pendingBytes += text.length * 2;
        return;
      }
      this.auth.receive(sock, text);
    };
    f.onmessage = (event) => {
      if (!st.dead && st.attached)
        this.auth.receive(
          sock,
          typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data),
        );
    };
    const open = () => {
      if (
        st.dead ||
        st.open ||
        c.readyState !== 'open' ||
        f.readyState !== 'open'
      )
        return;
      st.open = true;
      clearTimeout(st.timer);
      this.sampleStats();
    };
    c.onopen = f.onopen = open;
    c.onclose = f.onclose = () => {
      if (!pc.__dtamNativeOpen) drop();
    };
    c.onerror = f.onerror = () => {
      if (!pc.__dtamNativeOpen) drop();
    };
    pc.onconnectionstatechange = () => {
      if (
        ['failed', 'closed'].includes(pc.connectionState) &&
        !pc.__dtamNativeOpen
      )
        drop();
    };
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIce(pc);
      if (st.dead || this.destroyed) return;
      await api(`/v2/rooms/${this.room}/offers/${id}`, {
        method: 'POST',
        body: JSON.stringify({
          hostToken: this.hostToken,
          offer: pc.localDescription,
        }),
      });
      let answer = null;
      for (const delay of POLL) {
        await sleep(delay);
        if (st.dead || this.destroyed) return;
        const result = await api(
          `/v2/rooms/${this.room}/answers/${id}?hostToken=${encodeURIComponent(this.hostToken)}`,
        );
        if (result.data.ready) {
          answer = result.data.answer;
          break;
        }
      }
      if (!answer) return drop(1006, 'answer_timeout');
      if (st.dead || this.destroyed) return;
      await pc.setRemoteDescription(answer);
      if (!st.open)
        st.timer = setTimeout(() => drop(1006, 'ice_timeout'), ICE_CONNECT);
    } catch (_) {
      await drop(1006, 'negotiation_failed');
    }
  }
  async sampleStats() {
    if (this.statsBusy) return;
    this.statsBusy = true;
    try {
      const live = [...this.peers.values()].filter((p) => p.open && !p.dead),
        metrics = await Promise.all(live.map((p) => pairMetrics(p.pc))),
        samples = metrics.map((m) => m.rttMs).filter(Number.isFinite);
      diag.peerCount = live.length;
      diag.peerRttMs = samples.length ? Math.max(...samples) : NaN;
      diag.relay = metrics.some((m) => m.relay);
      diag.activeChannel =
        live.length === 0
          ? 'Mailbox'
          : metrics.some((m) => m.relay)
            ? 'TURN 中继'
            : metrics.some((m) => m.channel === 'WebRTC 路径未知')
              ? 'WebRTC 路径未知'
              : 'Direct WebRTC';
      diag.packetLossRate = metrics.length
        ? Math.max(...metrics.map((m) => m.lossRate || 0))
        : 0;
      diag.natType = metrics.find((m) => m.natType)?.natType || 'Direct (Host)';
      if (live.length === 1 && metrics[0]) diag.pair = metrics[0].summary;
      qualityChanged();
    } finally {
      this.statsBusy = false;
    }
  }
  loseAuthority() {
    if (this.destroyed) return;
    this.destroy();
    this.auth.shutdown();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    clearInterval(this.snapTimer);
    clearInterval(this.heartbeatTimer);
    clearInterval(this.statsTimer);
    for (const p of this.peers.values()) {
      clearTimeout(p.timer);
      clearChunks(p.pc);
      try {
        p.pc.close();
      } catch (_) {}
    }
    this.peers.clear();
    diag.peerCount = 0;
    diag.peerRttMs = NaN;
    qualityChanged();
  }
}

class HybridSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url, protocols) {
    const cfg = getNetworkConfig();
    diag.configured = cfg;
    if (cfg.mode === 'server') {
      diag.mode = 'server-direct-required';
      qualityChanged();
      return protocols === undefined
        ? new NativeWebSocket(serverTargetFor(url, cfg.serverUrl))
        : new NativeWebSocket(serverTargetFor(url, cfg.serverUrl), protocols);
    }
    super();
    this.url = String(url);
    this.protocol = '';
    this.extensions = '';
    this.binaryType = 'blob';
    this.readyState = 0;
    this.onopen = this.onmessage = this.onerror = this.onclose = null;
    this.cfg = cfg;
    this.params = new URL(this.url).searchParams;
    this.room = String(this.params.get('room') || '');
    this.create = this.params.get('create') === '1';
    this.native = null;
    this.pc = null;
    this.c = null;
    this.f = null;
    this.auth = null;
    this.local = null;
    this.mb = null;
    this.opened = false;
    this.closed = false;
    this.serverTried = false;
    this.lastPos = '';
    this.explicitLeave = false;
    this.statsTimer = null;
    this.statsBusy = false;
    this.joinSent = false;
    this.migrating = false;
    this.outgoingPosSeq = 0;
    this.preOpen = [];
    this.preOpenBytes = 0;
    this.lastHostPacketAt = Date.now();
    this.livenessTimer = null;
    this.lastSnapshot = null;
    this.lastRecovery = null;
    queueMicrotask(() => this.start());
  }
  get bufferedAmount() {
    return this.native
      ? Number(this.native.bufferedAmount || 0)
      : Number(this.c?.bufferedAmount || 0) +
          Number(this.f?.bufferedAmount || 0);
  }
  emit(t, e) {
    const f = this['on' + t];
    if (typeof f === 'function')
      try {
        f.call(this, e);
      } catch (x) {
        setTimeout(() => {
          throw x;
        }, 0);
      }
    try {
      this.dispatchEvent(e);
    } catch (_) {}
  }
  open(mode) {
    if (this.opened || this.closed) return;
    this.opened = true;
    this.readyState = 1;
    diag.mode = mode;
    qualityChanged();
    this.emit('open', new Event('open'));
  }
  deliver(d) {
    if (!this.closed)
      this.emit(
        'message',
        new MessageEvent('message', {
          data: String(d),
          origin: location.origin,
        }),
      );
  }
  finish(code = 1006, reason = '', clean = false) {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    if (this.pc) clearChunks(this.pc);
    this.preOpen.length = 0;
    this.preOpenBytes = 0;
    clearInterval(this.statsTimer);
    this.statsTimer = null;
    clearInterval(this.livenessTimer);
    this.livenessTimer = null;
    try {
      this.pc?.close();
    } catch (_) {}
    try {
      this.native?.close();
    } catch (_) {}
    this.auth?.shutdown();
    this.mb?.destroy();
    this.emit('close', ce(code, reason, clean));
  }
  async tryServerPrimary() {
    if (this.cfg.mode !== 'auto' || this.closed) return false;
    this.serverTried = true;
    diag.lastError = '';
    badge(
      'Auto · 检测 Server',
      '优先使用独立 Server；房间不在 Server 时继续 P2P',
    );
    let ws;
    try {
      ws = new NativeWebSocket(serverTargetFor(this.url, this.cfg.serverUrl));
    } catch (_) {
      diag.lastError = 'Server 建链失败';
      qualityChanged();
      return false;
    }
    this.native = ws;
    return await new Promise((resolve) => {
      let settled = false,
        opened = false;
      const abandon = (reason) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
          if (this.native === ws) this.native = null;
          try {
            ws.close(4000, 'server primary unavailable');
          } catch (_) {}
          diag.lastError = reason;
          qualityChanged();
          resolve(false);
        },
        adopt = (first) => {
          if (this.closed) return abandon('会话已关闭');
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.params.set('token', parse(first).self.token);
          this.open('server-primary');
          badge('Server 主链路', this.cfg.serverUrl);
          ws.onmessage = (e) => this.deliver(e.data);
          ws.onerror = (e) => this.emit('error', e);
          ws.onclose = (e) =>
            this.finish(e.code || 1006, e.reason || '', !!e.wasClean);
          if (first) queueMicrotask(() => this.deliver(first));
          resolve(true);
        },
        timer = setTimeout(
          () => abandon(opened ? 'Server 房间响应超时' : 'Server 探测超时'),
          SERVER_PRIMARY_TIMEOUT,
        );
      ws.onopen = () => {
        opened = true;
      };
      ws.onmessage = (e) => {
        let m = null;
        try {
          m = JSON.parse(String(e.data || ''));
        } catch (_) {}
        if (!this.create && m?.t === 'error' && m?.code === 'room_not_found')
          return abandon('房间不在 Server，转 P2P');
        if (m?.t === 'welcome' && m?.features?.serverPrimaryV2 !== true)
          return abandon('Server 版本过旧，转 P2P');
        if (this.closed) return abandon('会话已关闭');
        if (m?.t === 'error') {
          this.deliver(String(e.data));
          this.finish(4400, String(m.code || 'join_failed'), true);
          return abandon('Server 拒绝加入');
        }
        if (m?.t !== 'welcome') return;
        if (
          String(m.mapId || '') !== MAP_PROTOCOL_ID ||
          String(m.room || '') !== this.room ||
          !m.self?.id ||
          !m.self?.token
        )
          return abandon('Server 身份响应无效');
        adopt(String(e.data || ''));
      };
      ws.onerror = () => abandon('Server 建链失败');
      ws.onclose = () => abandon('Server 不可用');
    });
  }
  async start() {
    if (this.cfg.mode === 'auto' && (await this.tryServerPrimary())) return;
    if (this.closed) return;
    if (typeof NativeRTCPeerConnection !== 'function')
      return this.fallback('浏览器不支持 WebRTC');
    if (this.create) return this.host();
    return this.guest(recoverLoad(this.room));
  }
  async host() {
    const hostId = rid(),
      hostToken = rid() + rid();
    badge('P2P · 创建房间');
    try {
      const r = await api(`/v2/rooms/${this.room}/claim`, {
        method: 'POST',
        body: JSON.stringify({ hostId, hostToken }),
      });
      if (this.closed) return;
      const rec = {
        recoveryToken: r.data.recoveryToken,
        epoch: Number(r.data.epoch || 1),
      };
      diag.epoch = rec.epoch;
      recoverStore(this.room, rec);
      this.auth = new Authority(this.room);
      await this.auth.ready();
      if (this.closed) {
        this.auth.shutdown();
        return false;
      }
      const pending = [];
      this.local = new Sock(
        this.auth.ctx,
        (d) => (this.opened ? this.deliver(d) : pending.push(String(d))),
        (c, x) => this.finish(c, x, c === 1000),
      );
      const attached = await attach(this.auth, this.local, this.params);
      if (this.closed) return;
      if (attached) this.open('browser-host');
      for (const d of pending) this.deliver(d);
      if (!attached) return this.finish(4400, 'attach_failed', true);
      this.mb = new Mailbox(
        this.room,
        hostToken,
        rec.recoveryToken,
        rec.epoch,
        this.auth,
      );
      this.mb.start();
      badge('P2P 房主 · 临时权威', '独立 Server 不可用；P2P 数据面已接管');
    } catch (e) {
      if (e.code === 'room_exists') {
        this.open('collision');
        this.deliver(
          JSON.stringify({
            t: 'error',
            code: 'room_exists',
            message: '房间号已存在',
          }),
        );
        return setTimeout(() => this.finish(4409, 'room exists', true), 50);
      }
      return this.fallback('P2P 创建失败');
    }
  }
  async tryRecover(rec, snapshot, deadline = Date.now() + 12000) {
    if (this.closed) return false;
    const hostId = rid(),
      hostToken = rid() + rid();
    try {
      const r = await api(`/v2/rooms/${this.room}/recover`, {
        method: 'POST',
        body: JSON.stringify({
          hostId,
          hostToken,
          recoveryToken: rec.recoveryToken,
          epoch: Number(rec.epoch || 1),
        }),
      });
      if (this.closed) return false;
      const next = {
        recoveryToken: rec.recoveryToken,
        epoch: Number(r.data.epoch),
      };
      diag.epoch = next.epoch;
      recoverStore(this.room, next);
      this.params.set('create', '0');
      this.auth = new Authority(this.room, snapshot);
      await this.auth.ready();
      if (this.closed) {
        this.auth.shutdown();
        return false;
      }
      const pending = [];
      this.local = new Sock(
        this.auth.ctx,
        (d) => (this.opened ? this.deliver(d) : pending.push(String(d))),
        (c, x) => this.finish(c, x, c === 1000),
      );
      const attached = await attach(this.auth, this.local, this.params);
      if (this.closed) return false;
      if (attached) this.open('p2p-recovered-host');
      if (this.opened && attached) {
        diag.mode = 'p2p-recovered-host';
        qualityChanged();
      }
      for (const d of pending) this.deliver(d);
      if (!attached) {
        this.finish(4400, 'attach_failed', true);
        return false;
      }
      this.mb = new Mailbox(
        this.room,
        hostToken,
        next.recoveryToken,
        next.epoch,
        this.auth,
      );
      this.mb.start();
      badge('P2P · 已接管房主', '原房主掉线，已从热备快照恢复');
      return true;
    } catch (e) {
      if (e.code === 'recovery_lost' || e.code === 'host_alive') {
        if (Number(e.data?.epoch || rec.epoch) !== Number(rec.epoch)) {
          try { sessionStorage.removeItem(SNAP_KEY + this.room); } catch (_) {}
          this.__dtamRecoveryCandidate = null;
        }
        recoverStore(this.room, {
          recoveryToken: rec.recoveryToken,
          epoch: Number(e.data?.epoch || rec.epoch),
        });
        if (
          e.code === 'host_alive' &&
          Number(e.data?.epoch || rec.epoch) === Number(rec.epoch)
        ) {
          const retry =
            Math.max(450, Number(e.data?.retryAfterMs || 0)) +
            150 +
            Math.random() * 150;
          if (Date.now() + retry < deadline) {
            await sleep(retry);
            if (this.closed) return false;
            return this.tryRecover(rec, snapshot, deadline);
          }
        }

        return false;
      }
      return false;
    }
  }
  async guest(rec = null) {
    const peerId = rid();
    badge('P2P · 正在撮合');
    let jt = '';
    try {
      const r = await api(`/v2/rooms/${this.room}/join`, {
        method: 'POST',
        body: JSON.stringify({
          peerId,
          recoveryToken: rec?.recoveryToken || '',
        }),
      });
      jt = r.data.joinToken;
      if (rec)
        recoverStore(this.room, {
          ...rec,
          epoch: Number(r.data.epoch || rec.epoch),
        });
    } catch (e) {
      if (
        ['room_not_found', 'game_in_progress'].includes(e.code) &&
        this.cfg.mode === 'p2p'
      ) {
        this.open('p2p-error');
        this.deliver(
          JSON.stringify({ t: 'error', code: e.code, message: e.message }),
        );
        return setTimeout(() => this.finish(4404, e.code, true), 60);
      }
      return this.fallback('P2P 房间不可用');
    }
    let offer = null;
    for (const d of POLL) {
      await sleep(d);
      try {
        const r = await api(
          `/v2/rooms/${this.room}/offers/${peerId}?joinToken=${encodeURIComponent(jt)}`,
        );
        if (r.data.ready) {
          offer = r.data.offer;
          break;
        }
      } catch (_) {}
    }
    if (!offer) return this.fallback('P2P offer 超时');
    const pc = (this.pc = new NativeRTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      bundlePolicy: 'max-bundle',
      dtamGameplay: true,
    }));
    pc.ondatachannel = (e) => this.bind(e.channel);
    pc.onconnectionstatechange = async () => {
      if (pc.connectionState === 'connected') {
        const m = await pairMetrics(pc);
        diag.pair = m.summary;
        diag.transportRttMs = m.rttMs;
        diag.relay = m.relay;
        diag.activeChannel =
          m.channel || (m.relay ? 'Edge Tunnel' : 'Direct WebRTC');
        diag.packetLossRate = m.lossRate || 0;
        diag.natType = m.natType || 'Direct (Host)';
        badge(m.relay ? 'P2P · TURN' : 'P2P 直连', m.summary);
        qualityChanged();
        this.startStats();
      } else if (
        ['failed', 'closed'].includes(pc.connectionState) &&
        !this.closed &&
        !pc.__dtamNativeOpen
      ) {
        if (!this.opened) this.fallback('P2P ICE 失败');
        else this.handleHostMigration('ice_' + pc.connectionState);
      }
    };
    try {
      await pc.setRemoteDescription(offer);
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      await waitIce(pc);
      await api(`/v2/rooms/${this.room}/answers/${peerId}`, {
        method: 'POST',
        body: JSON.stringify({ joinToken: jt, answer: pc.localDescription }),
      });
    } catch (_) {
      return this.fallback('P2P answer 失败');
    }
    setTimeout(
      () => !this.opened && this.fallback('P2P ICE 超时'),
      ICE_CONNECT,
    );
  }
  startStats() {
    if (!this.pc || this.closed) return;
    clearInterval(this.statsTimer);
    this.sampleStats();
    this.statsTimer = setInterval(() => this.sampleStats(), 1000);
    clearInterval(this.livenessTimer);
    this.lastHostPacketAt = Date.now();
    this.livenessTimer = setInterval(() => {
      if (this.closed || this.auth || !this.opened || this.migrating) return;
      if (Date.now() - this.lastHostPacketAt > 8000) {
        this.handleHostMigration('host_silent');
      }
    }, 2000);
  }
  async sampleStats() {
    if (this.statsBusy || !this.pc || this.closed) return;
    this.statsBusy = true;
    try {
      const m = await pairMetrics(this.pc);
      if (this.closed) return;
      diag.transportRttMs = m.rttMs;
      diag.relay = m.relay;
      diag.pair = m.summary;
      diag.activeChannel =
        m.channel || (m.relay ? 'Edge Tunnel' : 'Direct WebRTC');
      diag.packetLossRate = m.lossRate || 0;
      diag.natType = m.natType || 'Direct (Host)';
      qualityChanged();
    } finally {
      this.statsBusy = false;
    }
  }
  bind(ch) {
    ch.binaryType = 'arraybuffer';
    if (ch.label === 'dtam-control') this.c = ch;
    else if (ch.label === 'dtam-fast') this.f = ch;
    else return ch.close();
    const preOpen = this.preOpen;
    const maybe = () => {
      if (
        this.joinSent ||
        this.c?.readyState !== 'open' ||
        this.f?.readyState !== 'open'
      )
        return;
      this.joinSent = true;
      badge('P2P · 正在建立会话');
      try {
        this.c.send(
          JSON.stringify({
            __dtamJoin: true,
            query: this.params.toString(),
            v: VER,
          }),
        );
      } catch (_) {
        this.finish(4005, 'join_send_failed', false);
      }
    };
    ch.onopen = maybe;
    if (ch.readyState === 'open') queueMicrotask(maybe);
    ch.onmessage = (e) => {
      if (this.closed) return;
      let text;
      try {
        text = assembleChunk(
          typeof e.data === 'string'
            ? e.data
            : new TextDecoder().decode(e.data),
          this.pc,
        );
      } catch (_) {
        return this.finish(4005, 'invalid_fragment', false);
      }
      if (!text) return;
      this.lastHostPacketAt = Date.now();
      const m = parse(text);
      if (m?.__dtamRecovery) {
        this.lastRecovery = {
          recoveryToken: m.recoveryToken,
          epoch: Number(m.epoch || 1),
        };
        diag.epoch = this.lastRecovery.epoch;
        recoverStore(this.room, this.lastRecovery);
        if (m.standby === false) {
          this.lastSnapshot = null;
          try {
            sessionStorage.removeItem(SNAP_KEY + this.room);
          } catch (_) {}
        }
        if (m.snapshot) {
          this.lastSnapshot = m.snapshot;
          snapStore(this.room, m.snapshot);
        }
        if (new URLSearchParams(location.search).get('debug') === '1')
          console.info(
            '[DTAM recovery] snapshot received',
            this.room,
            !!m.snapshot,
            Number(m.epoch || 1),
          );
        return;
      }
      if (m?.__dtamClose)
        return this.finish(
          Number(m.code || 1000),
          String(m.reason || ''),
          Number(m.code || 1000) === 1000,
        );
      if (m?.kind === 'host_migrated' || m?.t === 'host_migrated') {
        this.deliver(text);
        return;
      }
      if (!this.opened) {
        if (m?.t !== 'welcome' && m?.t !== 'error') {
          if (ch === this.f) return;
          if (
            preOpen.length >= 64 ||
            this.preOpenBytes + text.length * 2 > 262144
          )
            return this.finish(4005, 'pre_open_overflow', false);
          preOpen.push(text);
          this.preOpenBytes += text.length * 2;
          return;
        }
        if (m.t === 'error') {
          this.deliver(text);
          return this.finish(4400, String(m.code || 'join_failed'), true);
        }
        if (
          String(m.mapId || '') !== MAP_PROTOCOL_ID ||
          String(m.room || '') !== this.room ||
          !m.self?.id ||
          !m.self?.token
        )
          return this.finish(4406, 'invalid_welcome', false);
        this.params.set('token', m.self.token);
        this.open('p2p-connected');
        if (m.t === 'welcome') {
          this.startStats();
          badge('P2P 已连接', '身份握手完成，正在确认连接路径');
        }
        this.deliver(text);
        for (const packet of preOpen.splice(0)) this.deliver(packet);
        this.preOpenBytes = 0;
        return;
      }
      if (m?.t === 'welcome') {
        this.startStats();
        badge('P2P 已连接', '对齐新房主完成');
      }
      this.deliver(text);
    };
    ch.onclose = () =>
      this.opened &&
      !this.pc?.__dtamNativeOpen &&
      this.handleHostMigration('channel_closed');
    ch.onerror = () =>
      this.opened &&
      !this.pc?.__dtamNativeOpen &&
      this.handleHostMigration('channel_error');
  }
  handleHostMigration(reason = 'host_lost') {
    if (this.closed || this.auth) return;
    // Reuse the game client's fenced reconnect path. It creates a fresh socket
    // with the current resume token, then rejoins before attempting epoch CAS.
    this.finish(1006, reason, false);
  }
  fallback(reason) {
    if (this.closed || this.native || this.opened) return;
    if (this.cfg.mode === 'p2p' || this.serverTried) {
      diag.lastError = reason;
      qualityChanged();
      this.emit('error', new Event('error'));
      return this.finish(1006, reason, false);
    }
    diag.lastError = reason;
    badge('Server fallback', reason);
    let ws;
    try {
      ws = new NativeWebSocket(serverTargetFor(this.url, this.cfg.serverUrl));
    } catch (_) {
      return this.finish(1006, 'server unavailable', false);
    }
    this.native = ws;
    ws.onopen = () => {
      this.open('server-fallback');
      badge('Server fallback', this.cfg.serverUrl);
    };
    ws.onmessage = (e) => this.deliver(e.data);
    ws.onerror = (e) => this.emit('error', e);
    ws.onclose = (e) =>
      this.finish(e.code || 1006, e.reason || '', !!e.wasClean);
  }
  send(data) {
    if (this.native) return this.native.send(data);
    if (this.readyState !== 1)
      throw new DOMException('not open', 'InvalidStateError');
    const m = parse(data),
      t = String(m?.t || '');
    if (t === 'pos') {
      data = JSON.stringify({ ...m, clientSeq: ++this.outgoingPosSeq });
      this.lastPos = data;
    }
    if (t === 'leave') this.explicitLeave = true;
    if (this.auth && this.local) {
      if (SYNC.has(t) && this.lastPos)
        this.auth.receive(this.local, this.lastPos);
      this.auth.receive(this.local, String(data));
      if (t === 'start') {
        this.mb?.stop();
        this.mb?.state('started');
        badge('P2P 游戏中');
      } else if (t === 'reset') {
        this.mb?.state('lobby');
        this.mb?.start();
      }
      return;
    }
    if (t === 'pos') this.lastPos = String(data);
    try {
      if (
        SYNC.has(t) &&
        this.lastPos &&
        (this.c?.readyState === 'open' || this.pc?.__dtamNativeOpen)
      )
        sendChunked(this.c, this.lastPos);
    } catch (error) {
      this.finish(4005, 'checkpoint_failed', false);
      throw error;
    }
    const ch = FAST_OUT.has(t) ? this.f : this.c;
    if (!ch || (ch.readyState !== 'open' && !this.pc?.__dtamNativeOpen))
      throw new DOMException('transport unavailable', 'NetworkError');
    if (t === 'pos' && ch.bufferedAmount > 4096) return;
    try {
      if (ch === this.c) sendChunked(ch, data);
      else ch.send(data);
    } catch (error) {
      if (ch === this.c) this.finish(4005, 'control_overflow', false);
      throw error;
    }
  }
  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    if (this.native) {
      try {
        this.native.close(code, reason);
      } catch (_) {
        this.finish(code, reason, true);
      }
      return;
    }
    const finish = () => this.finish(code, reason, code === 1000);
    if (this.explicitLeave) {
      setTimeout(finish, 60);
      return;
    }
    finish();
  }
}
Object.defineProperties(HybridSocket.prototype, {
  CONNECTING: { value: 0 },
  OPEN: { value: 1 },
  CLOSING: { value: 2 },
  CLOSED: { value: 3 },
});
window.WebSocket = HybridSocket;
badge(
  describeNetworkMode(getNetworkConfig()),
  '可在大厅选择 Auto / P2P / Server',
);
console.log('DTAM hybrid transport', VER);
