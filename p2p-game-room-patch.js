import { GameRoom } from './worker.js?v=p2p-browser-host-4';

const VOICE_SYNC = 'https://voice.lunarlab.uk/v1/sync';
const VOICE_SYNC_DEBOUNCE_MS = 120;
const VOICE_SYNC_RETRY_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const voiceSyncState = new WeakMap();

function voiceSignature(room) {
  const players = Object.values(room?.players || {}).map(p => ({
    playerId:String(p.id || ''),
    gameToken:String(p.token || ''),
    alive:p.alive !== false,
    connected:p.connected !== false,
    sessionId:String(p.voiceSessionId || ''),
    trackName:String(p.voiceTrackName || ''),
    enabled:!!p.voiceEnabled,
  })).sort((a,b) => a.playerId.localeCompare(b.playerId));
  return JSON.stringify({ phase:String(room?.phase || 'lobby'), players });
}

function scheduleVoiceSync(room) {
  const host = window.__DTAM_HOST_SIGNAL__;
  if (!host?.room || !host?.hostToken || host.room.length !== 2) return;
  const signature = voiceSignature(room);
  let state = voiceSyncState.get(room);
  if (!state) {
    state = { signature:'', timer:null, inFlight:false, pending:false, retryAttempt:0, retryAt:0 };
    voiceSyncState.set(room, state);
  }
  if (state.signature === signature && !state.pending) return;
  state.pending = true;
  if (state.inFlight || state.timer) return;
  const t = Date.now();
  const delay = state.retryAt > t ? Math.max(VOICE_SYNC_DEBOUNCE_MS, state.retryAt - t) : VOICE_SYNC_DEBOUNCE_MS;
  state.timer = setTimeout(async () => {
    state.timer = null;
    if (state.inFlight) return;
    state.inFlight = true;
    state.pending = false;
    const current = voiceSignature(room);
    try {
      const liveHost = window.__DTAM_HOST_SIGNAL__;
      if (!liveHost?.room || !liveHost?.hostToken || liveHost.room.length !== 2) return;
      const players = Object.values(room?.players || {}).map(p => ({
        playerId:String(p.id || ''), gameToken:String(p.token || ''), alive:p.alive !== false,
        connected:p.connected !== false, sessionId:String(p.voiceSessionId || ''),
        trackName:String(p.voiceTrackName || ''), enabled:!!p.voiceEnabled,
      }));
      const r = await fetch(VOICE_SYNC, {
        method:'POST', cache:'no-store', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ room:liveHost.room, hostToken:liveHost.hostToken, phase:String(room?.phase || 'lobby'), players }),
      });
      if (!r.ok) throw new Error(`voice sync ${r.status}`);
      state.signature = current;
      state.retryAttempt = 0;
      state.retryAt = 0;
    } catch (_) {
      state.pending = true;
      const base = VOICE_SYNC_RETRY_MS[Math.min(state.retryAttempt, VOICE_SYNC_RETRY_MS.length - 1)];
      const hidden = typeof document !== 'undefined' && document.hidden;
      const slowed = hidden ? Math.min(60000, Math.max(5000, base * 2)) : base;
      const jitter = Math.round(slowed * (0.8 + Math.random() * 0.4));
      state.retryAttempt = Math.min(state.retryAttempt + 1, VOICE_SYNC_RETRY_MS.length - 1);
      state.retryAt = Date.now() + jitter;
    } finally {
      state.inFlight = false;
      if (state.pending || voiceSignature(room) !== state.signature) scheduleVoiceSync(room);
    }
  }, delay);
}

const originalPersistNow = GameRoom.prototype.persistNow;
GameRoom.prototype.persistNow = async function patchedPersistNow(...args) {
  const out = await originalPersistNow.apply(this, args);
  scheduleVoiceSync(this);
  return out;
};

const originalVoiceDirectory = GameRoom.prototype.voiceDirectory;
GameRoom.prototype.voiceDirectory = function patchedVoiceDirectory(viewer = null) {
  if (this.phase !== 'meeting') return originalVoiceDirectory.call(this, viewer);
  const phase = this.phase;
  this.phase = 'playing';
  try { return originalVoiceDirectory.call(this, viewer); }
  finally { this.phase = phase; }
};

const originalWebSocketMessage = GameRoom.prototype.webSocketMessage;
GameRoom.prototype.webSocketMessage = async function patchedBrowserHostMessage(ws, message) {
  let packet = null;
  try {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    packet = JSON.parse(text);
  } catch (_) {}

  if (packet?.t === 'ping') {
    try { ws.send(JSON.stringify({ t:'pong', at:packet.at, serverAt:Date.now() })); } catch (_) {}
    return;
  }

  if (packet?.t === 'chat' && this.phase === 'meeting') {
    const phase = this.phase;
    this.phase = 'playing';
    try { return await originalWebSocketMessage.call(this, ws, message); }
    finally { this.phase = phase; }
  }

  const result = await originalWebSocketMessage.call(this, ws, message);
  if (['voice_publish','voice_state','start','kill','report','emergency','vote','reset','leave'].includes(String(packet?.t || ''))) {
    scheduleVoiceSync(this);
  }
  return result;
};

const originalStartGame = GameRoom.prototype.startGame;
GameRoom.prototype.startGame = async function validatedBrowserHostStart(player) {
  if (player?.id !== this.hostId || this.phase !== 'lobby') return originalStartGame.call(this, player);
  const active = Object.values(this.players || {}).filter(p => p.connected);
  const maxImpostors = Math.max(1, Math.floor((active.length - 1) / 2));
  const requestedImpostors = Number(this.settings?.normalImpostors || 0) + Number(this.settings?.shapeshifters || 0) + Number(this.settings?.phantoms || 0) + Number(this.settings?.vipers || 0);
  if (requestedImpostors > maxImpostors) {
    this.sendTo(player.id, { t:'error', code:'role_overflow', message:`当前 ${active.length} 人最多可设置 ${maxImpostors} 名内鬼；现在设置了 ${requestedImpostors} 名` });
    return;
  }
  const crewSlots = Math.max(0, active.length - requestedImpostors);
  const requestedSpecialCrew = Number(this.settings?.engineers || 0) + Number(this.settings?.scientists || 0) + Number(this.settings?.trackers || 0) + Number(this.settings?.noisemakers || 0) + Number(this.settings?.detectives || 0);
  if (requestedSpecialCrew > crewSlots) {
    this.sendTo(player.id, { t:'error', code:'crew_role_overflow', message:`当前只有 ${crewSlots} 个船员位，但设置了 ${requestedSpecialCrew} 个特殊船员职业` });
    return;
  }
  return originalStartGame.call(this, player);
};

const originalBeginTask = GameRoom.prototype.beginTask;
GameRoom.prototype.beginTask = async function browserTaskFeedback(player, id, ws) {
  const before = String(player?.activeTask?.token || '');
  await originalBeginTask.call(this, player, id, ws);
  const after = String(player?.activeTask?.token || '');
  if (this.phase === 'playing' && player?.connected && before === after) {
    try { ws.send(JSON.stringify({ t:'error', code:'task_unavailable', message:'现在无法开始这个任务，请靠近任务点后重试' })); } catch (_) {}
  }
};
