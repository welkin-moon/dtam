import { GameRoom } from './worker.js?v=p2p-browser-host-3';

const NativeWebSocket = window.WebSocket;
const NativeRTCPeerConnection = window.RTCPeerConnection;
const SIGNAL_ORIGIN = 'https://p2p-signal.lunarlab.uk';
const FALLBACK_HOST = 'rt-d1.lunarlab.uk';
const VERSION = 'p2p-cf-mailbox-0.1';
const MAX_PLAYERS = 15;
const RECONNECT_GRACE_MS = 180000;
const JOIN_POLL_MS = 2200;
const OFFER_POLL = [180, 320, 550, 850, 1300, 1900, 2800, 4000];
const ANSWER_POLL = [180, 320, 550, 850, 1300, 1900, 2800, 4000];
const ICE_GATHER_TIMEOUT_MS = 6500;
const ICE_CONNECT_TIMEOUT_MS = 12000;
const FAST_TYPES = new Set(['pos']);
const POSITION_SYNC_TYPES = new Set(['emergency','vent','report','kill','ability','task_begin','task_complete','sabotage_fix']);

const diagnostics = window.__DTAM_P2P__ = {
  version: VERSION,
  strategy: 'cloudflare-worker+d1-mailbox',
  mode: 'boot', room: '', role: '', peers: 0, selectedPair: '', lastError: '',
};

function isGameSocketUrl(value) {
  try { const u = new URL(String(value), location.href); return u.hostname === FALLBACK_HOST && u.pathname === '/ws'; }
  catch (_) { return false; }
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
function closeEvent(code, reason, clean) {
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
async function api(path, options = {}) {
  const res = await fetch(SIGNAL_ORIGIN + path, {
    cache: 'no-store',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) {
    const err = new Error(data.message || `signal ${res.status}`);
    err.code = data.code || 'signal_error'; err.status = res.status; throw err;
  }
  return { status: res.status, data };
}
async function waitIceGathering(pc) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', onChange); resolve(); };
    const onChange = () => { if (pc.iceGatheringState === 'complete') finish(); };
    const timer = setTimeout(finish, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}
async function selectedPairSummary(pc) {
  try {
    const stats = await pc.getStats(); let pair = null;
    stats.forEach(r => { if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || !pair)) pair = r; });
    if (!pair) return 'WebRTC direct';
    const l = stats.get(pair.localCandidateId), r = stats.get(pair.remoteCandidateId);
    return [l?.candidateType && r?.candidateType ? `${l.candidateType} ↔ ${r.candidateType}` : '', l?.protocol || '', l?.address || l?.ip || ''].filter(Boolean).join(' · ') || 'WebRTC direct';
  } catch (_) { return 'WebRTC direct'; }
}

class BrowserDOContext {
  constructor() {
    this.sockets = new Set(); this.memory = new Map(); this.room = null; this.alarmTimer = null; this.ready = Promise.resolve();
    this.storage = {
      get: async key => this.memory.get(String(key)),
      put: async (key, value) => this.memory.set(String(key), structuredClone(value)),
      setAlarm: async at => this.setAlarm(at), deleteAlarm: async () => this.deleteAlarm(),
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
    this.alarmTimer = setTimeout(async () => { this.alarmTimer = null; try { await this.room?.alarm?.(); } catch (e) { console.warn('[P2P] alarm', e); } }, delay);
  }
  deleteAlarm() { if (this.alarmTimer) clearTimeout(this.alarmTimer); this.alarmTimer = null; }
}
class AuthoritySocket {
  constructor(ctx, sendFn, closeFn) { this.ctx = ctx; this.sendFn = sendFn; this.closeFn = closeFn; this.attachment = null; this.closed = false; ctx.acceptWebSocket(this); }
  serializeAttachment(v) { this.attachment = structuredClone(v); }
  deserializeAttachment() { return this.attachment; }
  send(data) { if (this.closed) throw new Error('closed'); this.sendFn(String(data)); }
  close(code = 1000, reason = '') { if (this.closed) return; this.closed = true; this.ctx.detach(this); try { this.closeFn?.(code, reason); } catch (_) {} }
}

class BrowserAuthority {
  constructor(roomCode) {
    this.roomCode = roomCode; this.ctx = new BrowserDOContext(); this.room = new GameRoom(this.ctx, {}); this.ctx.attachRoom(this.room); this.peerSockets = new Map();
  }
  async ready() { await this.ctx.ready; }
  reject(sock, code, message) { try { sock.send(JSON.stringify({ t: 'error', code, message })); } catch (_) {} setTimeout(() => { try { sock.close(4000, code); } catch (_) {} }, 30); return false; }
  async attachPlayer(sock, params) {
    await this.ready();
    const create = params.get('create') === '1', name = sanitizeName(params.get('name')), token = String(params.get('token') || ''), rawClientInstance = String(params.get('client') || ''), clientInstance = /^[A-Za-z0-9_-]{16,64}$/.test(rawClientInstance) ? rawClientInstance : '', rawHandoffInstance = String(params.get('handoff') || ''), handoffInstance = /^[A-Za-z0-9_-]{16,64}$/.test(rawHandoffInstance) ? rawHandoffInstance : '', t = Date.now(), room = this.room;
    if (room.initialized && !Object.keys(room.players).length) room.resetIfEmpty(); room.cleanupExpired(t);
    let player = token ? Object.values(room.players).find(p => p.token === token) : null, resumed = false;
    if (player && player.name !== name) player = null;
    const connectionId = randomId();
    if (player && player.connected) { const same = !!clientInstance && !!player.clientInstanceId && player.clientInstanceId === clientInstance, legacy = !player.clientInstanceId, transfer = !!clientInstance && !!handoffInstance && handoffInstance === player.clientInstanceId && clientInstance !== player.clientInstanceId; if (!(same || legacy || transfer)) return this.reject(sock, 'session_in_use', '这个会话正在另一实例中使用，将作为新玩家加入'); }
    if (player) {
      if (t - Number(player.lastSeen || t) <= RECONNECT_GRACE_MS || player.connected) { const old = room.socketForPlayer(player.id); if (old && old !== sock) try { old.close(4002, 'replaced'); } catch (_) {} resumed = true; }
      else { delete room.players[player.id]; player = null; }
    }
    if (!player) {
      if (create && room.initialized && Object.keys(room.players).length) return this.reject(sock, 'room_exists', '房间号已存在');
      if (!create && !room.initialized) return this.reject(sock, 'room_not_found', '房间不存在');
      if (room.phase !== 'lobby') return this.reject(sock, 'game_in_progress', '游戏已经开始，只能用原会话重连');
      if (Object.keys(room.players).length >= MAX_PLAYERS) return this.reject(sock, 'room_full', '房间已满');
      if (create && !room.initialized) { room.initialized = true; room.createdAt = t; }
      const id = randomId();
      player = { id, token: randomId(), clientInstanceId: clientInstance, name, color: room.nextColor(), animal: room.nextAnimal(), avatar: '', pos: room.spawnForIndex(Object.keys(room.players).length), connected: true, connectionId, joinedAt: t, lastSeen: t, lastMoveAt: t, lastChatAt: 0, role: '', ghostRole: '', alive: true, tasks: [], fakeTasks: [], completed: [], killReadyAt: 0, abilityReadyAt: 0, abilityUntil: 0, disguiseTargetId: '', hiddenUntil: 0, trackedId: '', trackUntil: 0, ventReadyAt: 0, ventExitAt: 0, protectedUntil: 0, lastCaseId: '', lastCaseArea: '', poisonedBy: '', poisonEndsAt: 0, voiceSessionId: '', voiceTrackName: '', voiceEnabled: false, emergencyUsed: 0, inVent: false, ventId: '', activeTask: null };
      room.players[id] = player; if (!room.hostId) room.hostId = id;
    }
    if (clientInstance) player.clientInstanceId = clientInstance;
    const previousHostId = room.hostId; player.connected = true; player.connectionId = connectionId; player.lastSeen = t; if (!room.players[room.hostId]?.connected) room.electHost();
    sock.serializeAttachment({ playerId: player.id, token: player.token, connectionId }); await room.persistNow(); room.announceHostChange(previousHostId);
    sock.send(JSON.stringify({ t: 'welcome', room: this.roomCode, resumed, self: { id: player.id, token: player.token }, hostId: room.hostId, players: room.publicPlayers(), profiles: room.profiles(), voices: room.voiceDirectory(player), bodies: room.bodies, game: room.publicGame(player.id), selfState: room.selfState(player), p2p: true }));
    if (!resumed) room.broadcast({ t: 'notice', text: `${player.name} 加入了房间` }, player.id); room.broadcastState(); await room.scheduleNextAlarm(); return true;
  }
  async receive(sock, data) { try { await this.room.webSocketMessage(sock, data); } catch (e) { console.warn('[P2P] packet', e); } }
  async markPeerGone(peerId) {
    const sock = this.peerSockets.get(peerId); if (!sock) return; this.peerSockets.delete(peerId);
    if (!sock.closed) { sock.closed = true; this.ctx.detach(sock); try { await this.room.webSocketClose(sock); } catch (_) {} }
  }
  makePeerSocket(peerId, sendControl, sendFast, closePeer) {
    const sock = new AuthoritySocket(this.ctx, data => { const packet = parseJson(data); (packet?.t === 'pos' ? sendFast : sendControl)(data); }, (code, reason) => closePeer(code, reason));
    this.peerSockets.set(peerId, sock); return sock;
  }
  shutdown() { this.ctx.deleteAlarm(); }
}

class HostMailbox {
  constructor(roomCode, hostToken, authority) { this.roomCode = roomCode; this.hostToken = hostToken; this.authority = authority; this.peers = new Map(); this.pollTimer = null; this.stopped = false; }
  start() { this.stopped = false; this.poll(); }
  stop() { this.stopped = true; clearTimeout(this.pollTimer); this.pollTimer = null; }
  async setState(state) { try { await api(`/v1/rooms/${this.roomCode}/state`, { method: 'POST', body: JSON.stringify({ hostToken: this.hostToken, state }) }); } catch (_) {} }
  async poll() {
    if (this.stopped) return;
    try {
      const { data } = await api(`/v1/rooms/${this.roomCode}/joins?hostToken=${encodeURIComponent(this.hostToken)}`);
      for (const p of data.peers || []) if (!this.peers.has(p.peerId)) this.acceptPeer(p.peerId).catch(e => console.warn('[P2P] accept peer', e));
    } catch (e) { console.warn('[P2P] join poll', e); }
    if (!this.stopped) this.pollTimer = setTimeout(() => this.poll(), JOIN_POLL_MS);
  }
  async acceptPeer(peerId) {
    const pc = new NativeRTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' });
    const control = pc.createDataChannel('dtam-control', { ordered: true });
    const fast = pc.createDataChannel('dtam-fast', { ordered: true, maxRetransmits: 0 });
    const state = { pc, control, fast, sock: null, opened: false, dead: false }; this.peers.set(peerId, state);
    const drop = async () => { if (state.dead) return; state.dead = true; try { pc.close(); } catch (_) {} await this.authority.markPeerGone(peerId); this.peers.delete(peerId); diagnostics.peers = this.peers.size; };
    const maybeOpen = async () => {
      if (state.opened || control.readyState !== 'open' || fast.readyState !== 'open') return;
      state.opened = true; diagnostics.peers = this.peers.size;
      const sock = this.authority.makePeerSocket(peerId, data => { if (control.readyState === 'open') control.send(data); }, data => { if (fast.readyState === 'open') fast.send(data); }, (code, reason) => { try { control.send(JSON.stringify({ __dtamClose: true, code, reason })); } catch (_) {} drop(); });
      state.sock = sock;
      control.onmessage = e => { const text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data); const msg = parseJson(text); if (msg?.__dtamJoin) this.authority.attachPlayer(sock, new URLSearchParams(String(msg.query || ''))); else this.authority.receive(sock, text); };
      fast.onmessage = e => this.authority.receive(sock, typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data));
      setBadge(`P2P 房主 · ${this.peers.size} 直连`, 'Cloudflare 只参与入房 SDP mailbox；游戏数据走 WebRTC');
    };
    control.onopen = fast.onopen = maybeOpen; control.onclose = fast.onclose = drop; control.onerror = fast.onerror = drop;
    pc.onconnectionstatechange = () => { if (['failed','closed'].includes(pc.connectionState)) drop(); };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await waitIceGathering(pc);
    await api(`/v1/rooms/${this.roomCode}/offers/${peerId}`, { method: 'POST', body: JSON.stringify({ hostToken: this.hostToken, offer: pc.localDescription }) });
    let answer = null;
    for (const delay of ANSWER_POLL) {
      await sleep(delay); if (state.dead) return;
      const r = await api(`/v1/rooms/${this.roomCode}/answers/${peerId}?hostToken=${encodeURIComponent(this.hostToken)}`);
      if (r.data.ready) { answer = r.data.answer; break; }
    }
    if (!answer) return drop(); await pc.setRemoteDescription(answer);
    setTimeout(() => { if (!state.opened) drop(); }, ICE_CONNECT_TIMEOUT_MS);
  }
  async destroy() {
    this.stop(); for (const p of this.peers.values()) try { p.pc.close(); } catch (_) {} this.peers.clear();
    try { await fetch(`${SIGNAL_ORIGIN}/v1/rooms/${this.roomCode}?hostToken=${encodeURIComponent(this.hostToken)}`, { method: 'DELETE', keepalive: true, cache: 'no-store' }); } catch (_) {}
  }
}

class P2PWebSocket extends EventTarget {
  static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
  constructor(url, protocols) {
    if (!isGameSocketUrl(url)) return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    super(); this.url = String(url); this.protocol=''; this.extensions=''; this.binaryType='blob'; this.readyState=P2PWebSocket.CONNECTING;
    this.onopen=this.onmessage=this.onerror=this.onclose=null; this._params=new URL(this.url).searchParams; this._room=String(this._params.get('room')||''); this._create=this._params.get('create')==='1'; this._opened=false; this._closed=false; this._native=null; this._pc=null; this._control=null; this._fast=null; this._authority=null; this._authoritySocket=null; this._hostMailbox=null; this._hostToken=''; this._lastPosition='';
    diagnostics.room=this._room; diagnostics.role=this._create?'host':'peer'; queueMicrotask(()=>this._start());
  }
  get bufferedAmount(){return this._native?Number(this._native.bufferedAmount||0):Number(this._control?.bufferedAmount||0)+Number(this._fast?.bufferedAmount||0);}
  _emit(type,event){const cb=this[`on${type}`];if(typeof cb==='function')try{cb.call(this,event);}catch(e){setTimeout(()=>{throw e;},0)}try{this.dispatchEvent(event)}catch(_){}}
  _open(mode){if(this._opened||this._closed)return;this._opened=true;this.readyState=P2PWebSocket.OPEN;diagnostics.mode=mode;this._emit('open',new Event('open'));}
  _deliver(data){if(!this._closed)this._emit('message',new MessageEvent('message',{data:String(data),origin:location.origin}));}
  _finish(code=1006,reason='',clean=false){if(this._closed)return;this._closed=true;this.readyState=P2PWebSocket.CLOSED;try{this._pc?.close()}catch(_){}this._authority?.shutdown();this._emit('close',closeEvent(code,reason,clean));}
  async _start(){if(typeof NativeRTCPeerConnection!=='function'){this._fallback('浏览器不支持 WebRTC');return;}if(this._create)await this._startHost();else await this._startGuest();}
  async _startHost(){
    const hostId=randomId(),hostToken=randomId()+randomId();this._hostToken=hostToken;setBadge('P2P · 占用房间号','Cloudflare mailbox 仅用于撮合');
    try{await api(`/v1/rooms/${this._room}/claim`,{method:'POST',body:JSON.stringify({hostId,hostToken})});}
    catch(e){if(e.code==='room_exists'){this._open('p2p-collision');this._deliver(JSON.stringify({t:'error',code:'room_exists',message:'房间号已存在'}));setTimeout(()=>this._finish(4409,'room exists',true),50);return;}this._fallback('P2P 信令不可用');return;}
    this._authority=new BrowserAuthority(this._room);await this._authority.ready();
    this._authoritySocket=new AuthoritySocket(this._authority.ctx,data=>this._deliver(data),(code,reason)=>this._finish(code,reason,code===1000));
    this._open('browser-host');setBadge('P2P 房主 · 浏览器权威','大厅只用少量 Cloudflare mailbox 请求；游戏数据不经过 Cloudflare');
    await this._authority.attachPlayer(this._authoritySocket,this._params);
    this._hostMailbox=new HostMailbox(this._room,hostToken,this._authority);this._hostMailbox.start();window.__DTAM_P2P_HOST__=this._hostMailbox;
  }
  async _startGuest(){
    const peerId=randomId();setBadge('P2P · 请求加入','向自己的 Cloudflare mailbox 登记一次');let joinToken='';
    try{const r=await api(`/v1/rooms/${this._room}/join`,{method:'POST',body:JSON.stringify({peerId})});joinToken=r.data.joinToken;}
    catch(e){if(['room_not_found','game_in_progress'].includes(e.code)){this._open('p2p-error');this._deliver(JSON.stringify({t:'error',code:e.code,message:e.message}));setTimeout(()=>this._finish(4404,e.code,true),60);return;}this._fallback('P2P 房间发现失败');return;}
    let offer=null;
    try{for(const delay of OFFER_POLL){await sleep(delay);const r=await api(`/v1/rooms/${this._room}/offers/${peerId}?joinToken=${encodeURIComponent(joinToken)}`);if(r.data.ready){offer=r.data.offer;break;}}}
    catch(_){ }
    if(!offer){this._fallback('房主未完成 P2P offer');return;}
    const pc=new NativeRTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}],bundlePolicy:'max-bundle'});this._pc=pc;
    pc.ondatachannel=e=>this._bindChannel(e.channel);pc.onconnectionstatechange=async()=>{if(pc.connectionState==='connected'){const s=await selectedPairSummary(pc);diagnostics.selectedPair=s;setBadge('P2P 直连',s);}else if(['failed','closed'].includes(pc.connectionState)&&!this._closed){if(!this._opened)this._fallback('P2P ICE 失败');else this._finish(1006,'P2P ICE failed',false);}};
    try{await pc.setRemoteDescription(offer);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await waitIceGathering(pc);await api(`/v1/rooms/${this._room}/answers/${peerId}`,{method:'POST',body:JSON.stringify({joinToken,answer:pc.localDescription})});}
    catch(_){this._fallback('P2P answer 交换失败');return;}
    setTimeout(()=>{if(!this._opened)this._fallback('P2P ICE 建链超时');},ICE_CONNECT_TIMEOUT_MS);
  }
  _bindChannel(ch){ch.binaryType='arraybuffer';if(ch.label==='dtam-control')this._control=ch;else if(ch.label==='dtam-fast')this._fast=ch;else{try{ch.close()}catch(_){}return;}
    const maybe=()=>{if(this._opened||this._control?.readyState!=='open'||this._fast?.readyState!=='open')return;this._open('p2p-direct');setBadge('P2P 直连','SDP 已交换完成；Cloudflare 已退出数据面');this._control.send(JSON.stringify({__dtamJoin:true,query:this._params.toString(),v:VERSION}));};
    ch.onopen=maybe;ch.onmessage=e=>{const text=typeof e.data==='string'?e.data:new TextDecoder().decode(e.data),p=parseJson(text);if(p?.__dtamClose){this._finish(Number(p.code||1000),String(p.reason||''),Number(p.code||1000)===1000);return;}this._deliver(text);};ch.onclose=()=>{if(this._opened)this._finish(1006,'P2P channel closed',false)};ch.onerror=()=>{if(this._opened)this._finish(1006,'P2P channel error',false)};
  }
  _fallback(reason){if(this._closed||this._native||this._opened)return;diagnostics.lastError=reason;diagnostics.mode='home-fallback';setBadge('P2P → 家中 fallback',reason+'；尝试 rt-d1');try{this._pc?.close()}catch(_){}let ws;try{ws=new NativeWebSocket(this.url)}catch(_){this._finish(1006,'fallback unavailable',false);return;}this._native=ws;ws.onopen=()=>{this._open('home-fallback');setBadge('家中服务器 fallback','P2P 不可用，当前使用 rt-d1')};ws.onmessage=e=>this._deliver(e.data);ws.onerror=e=>this._emit('error',e instanceof Event?e:new Event('error'));ws.onclose=e=>this._finish(e.code||1006,e.reason||'',!!e.wasClean);}
  send(data){if(this._native){this._native.send(data);return;}if(this.readyState!==P2PWebSocket.OPEN)throw new DOMException('WebSocket is not open','InvalidStateError');
    const packet=parseJson(data),type=String(packet?.t||'');
    if(this._authority&&this._authoritySocket){this._authority.receive(this._authoritySocket,String(data));if(type==='start'){this._hostMailbox?.stop();this._hostMailbox?.setState('started');setBadge('P2P 游戏中 · CF 0 请求','大厅信令轮询已停止；游戏数据只走 WebRTC');}else if(type==='reset'){this._hostMailbox?.setState('lobby');this._hostMailbox?.start();}return;}
    if(type==='pos')this._lastPosition=String(data);if(POSITION_SYNC_TYPES.has(type)&&this._lastPosition&&this._fast?.readyState==='open')this._fast.send(this._lastPosition);const target=FAST_TYPES.has(type)?this._fast:this._control;if(!target||target.readyState!=='open')throw new DOMException('P2P transport unavailable','NetworkError');if(type==='pos'&&target.bufferedAmount>65536)return;target.send(data);
  }
  close(code=1000,reason=''){if(this.readyState>=P2PWebSocket.CLOSING)return;this.readyState=P2PWebSocket.CLOSING;if(this._native){try{this._native.close(code,reason)}catch(_){this._finish(code,reason,true)}return;}if(this._authority&&this._authoritySocket){this._authority.receive(this._authoritySocket,JSON.stringify({t:'leave'})).finally(async()=>{await this._hostMailbox?.destroy();if(window.__DTAM_P2P_HOST__===this._hostMailbox)window.__DTAM_P2P_HOST__=null;this._finish(code,reason,true)});return;}try{if(this._control?.readyState==='open')this._control.send(JSON.stringify({t:'leave'}))}catch(_){}this._finish(code,reason,true);}
}
Object.defineProperties(P2PWebSocket.prototype,{CONNECTING:{value:0},OPEN:{value:1},CLOSING:{value:2},CLOSED:{value:3}});
window.WebSocket=P2PWebSocket;
setBadge('P2P · CF mailbox','自己的 Cloudflare 仅负责短时 SDP mailbox；无需 Durable Objects');
console.log('DTAM experimental P2P transport',VERSION);
await import('./game.js?v=20260918-v302session6-cf');
