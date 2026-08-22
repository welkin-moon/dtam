import { GameRoom } from './worker.js?v=p2p-browser-host-4';

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
    try { ws.send(JSON.stringify({ t: 'pong', at: packet.at, serverAt: Date.now() })); } catch (_) {}
    return;
  }

  if (packet?.t === 'chat' && this.phase === 'meeting') {
    const phase = this.phase;
    this.phase = 'playing';
    try { return await originalWebSocketMessage.call(this, ws, message); }
    finally { this.phase = phase; }
  }

  return originalWebSocketMessage.call(this, ws, message);
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
