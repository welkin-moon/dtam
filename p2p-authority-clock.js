import { GameRoom } from './worker.js?v=20260824-direct-m3e1';

const RECONNECT_GRACE_MS = 180000;
const liveRooms = new Set();
const reconciling = new WeakSet();
const stats = window.__DTAM_AUTHORITY_CLOCK__ = window.__DTAM_AUTHORITY_CLOCK__ || {
  checks:0,
  reconciles:0,
  lastReason:'',
  lastAt:0,
};

function deadlineDue(room, now = Date.now()) {
  if (!room) return false;
  if (Number(room.doorLockUntil || 0) > 0 && now >= Number(room.doorLockUntil)) return true;
  if (room.phase === 'playing' && Number(room.sabotage?.endsAt || 0) > 0 && now >= Number(room.sabotage.endsAt)) return true;

  const meeting = room.phase === 'meeting' ? room.meeting : null;
  if (meeting) {
    if (meeting.stage === 'discussion' && now >= Number(meeting.discussionEndsAt || 0)) return true;
    if (meeting.stage === 'voting' && now >= Number(meeting.votingEndsAt || 0)) return true;
    if (meeting.stage === 'result' && now >= Number(meeting.resumeAt || 0)) return true;
  }

  for (const body of room.bodies || []) {
    const at = Number(body?.dissolveAt || 0);
    if (at > 0 && now >= at) return true;
  }
  for (const player of Object.values(room.players || {})) {
    const ventAt = Number(player?.ventExitAt || 0);
    if (player?.role === 'engineer' && player?.inVent && ventAt > 0 && now >= ventAt) return true;
    if (player?.connected === false && Number(player?.lastSeen || 0) > 0 && now >= Number(player.lastSeen) + RECONNECT_GRACE_MS) return true;
  }
  return false;
}

async function reconcile(room, reason = 'packet') {
  liveRooms.add(room);
  stats.checks++;
  if (reconciling.has(room) || !deadlineDue(room)) return false;
  reconciling.add(room);
  stats.reconciles++;
  stats.lastReason = reason;
  stats.lastAt = Date.now();
  try {
    await room.alarm();
    return true;
  } catch (error) {
    console.warn('[DTAM authority clock]', error);
    return false;
  } finally {
    reconciling.delete(room);
  }
}

const previousPersistNow = GameRoom.prototype.persistNow;
GameRoom.prototype.persistNow = async function authorityClockPersist(...args) {
  liveRooms.add(this);
  return previousPersistNow.apply(this, args);
};

const previousWebSocketMessage = GameRoom.prototype.webSocketMessage;
GameRoom.prototype.webSocketMessage = async function authorityClockMessage(ws, message) {
  await reconcile(this, 'peer-activity');
  return previousWebSocketMessage.call(this, ws, message);
};

function reconcileVisible() {
  if (document.hidden) return;
  for (const room of liveRooms) reconcile(room, 'foreground').catch(() => {});
}
document.addEventListener('visibilitychange', reconcileVisible);
window.addEventListener('pageshow', reconcileVisible);

console.log('DTAM browser authority clock guard ready');
