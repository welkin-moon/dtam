import { GameRoom } from './worker.js?v=20260824-direct-m3e1';

const VOICE_SYNC = 'https://voice.lunarlab.uk/v1/sync';
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
    state = { signature:'', timer:null, inFlight:false, pending:false };
    voiceSyncState.set(room, state);
  }
  if (state.signature === signature && !state.pending) return;
  state.pending = true;
  clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    if (state.inFlight) return;
    state.inFlight = true;
    state.pending = false;
    const current = voiceSignature(room);
    try {
      const players = Object.values(room?.players || {}).map(p => ({
        playerId:String(p.id || ''), gameToken:String(p.token || ''), alive:p.alive !== false,
        connected:p.connected !== false, sessionId:String(p.voiceSessionId || ''),
        trackName:String(p.voiceTrackName || ''), enabled:!!p.voiceEnabled,
      }));
      const r = await fetch(VOICE_SYNC, {
        method:'POST', cache:'no-store', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ room:host.room, hostToken:host.hostToken, phase:String(room?.phase || 'lobby'), players }),
      });
      if (r.ok) state.signature = current;
    } catch (_) {
      state.pending = true;
    } finally {
      state.inFlight = false;
      if (state.pending || voiceSignature(room) !== state.signature) scheduleVoiceSync(room);
    }
  }, 120);
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
    try { ws.send(JSON.stringify({ t:'pong', at:packet.at, seq:packet.seq, serverAt:Date.now() })); } catch (_) {}
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
