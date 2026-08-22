import { GameRoom } from './worker.js?v=p2p-browser-host-4';

const originalWebSocketMessage = GameRoom.prototype.webSocketMessage;
GameRoom.prototype.webSocketMessage = async function patchedBrowserHostMessage(ws, message) {
  let packet = null;
  try {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    packet = JSON.parse(text);
  } catch (_) {}
  if (packet?.t === 'ping') {
    try { ws.send(JSON.stringify({ t: 'pong', at: packet.at })); } catch (_) {}
    return;
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
