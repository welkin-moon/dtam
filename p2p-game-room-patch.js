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
