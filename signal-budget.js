const NativeFetch = window.fetch.bind(window);
const SIGNAL_HOST = 'p2p-signal.lunarlab.uk';
const FAST_MS = 1200;
const VISIBLE_STEPS = [1200, 1600, 2100, 2600, 3000];
const HIDDEN_MS = 12000;
const states = new Map();
const stats = window.__DTAM_SIGNAL_BUDGET__ = {
  networkRequests: 0,
  suppressedPolls: 0,
  lastPollAt: 0,
  currentIntervalMs: FAST_MS,
};

function isJoinPoll(input, init) {
  if (String(init?.method || 'GET').toUpperCase() !== 'GET') return null;
  try {
    const u = new URL(input instanceof Request ? input.url : String(input), location.href);
    return u.hostname === SIGNAL_HOST && /^\/v2\/rooms\/\d{2}\/joins$/.test(u.pathname) ? u : null;
  } catch (_) { return null; }
}

function synthetic(state) {
  return new Response(JSON.stringify({
    ok: true,
    epoch: Number(state.epoch || 1),
    state: String(state.roomState || 'lobby'),
    peers: [],
    budgetCached: true,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

window.fetch = async function budgetedFetch(input, init = {}) {
  const pollUrl = isJoinPoll(input, init);
  if (!pollUrl) {
    const u = (() => { try { return new URL(input instanceof Request ? input.url : String(input), location.href); } catch (_) { return null; } })();
    if (u?.hostname === SIGNAL_HOST) stats.networkRequests++;
    return NativeFetch(input, init);
  }

  const key = pollUrl.pathname;
  const state = states.get(key) || { nextAt: 0, emptyStreak: 0, epoch: 1, roomState: 'lobby' };
  const now = Date.now();
  const visibleInterval = VISIBLE_STEPS[Math.min(state.emptyStreak, VISIBLE_STEPS.length - 1)];
  const interval = document.hidden ? HIDDEN_MS : visibleInterval;
  stats.currentIntervalMs = interval;
  if (now < state.nextAt) {
    stats.suppressedPolls++;
    return synthetic(state);
  }

  stats.networkRequests++;
  stats.lastPollAt = now;
  const response = await NativeFetch(input, init);
  try {
    const data = await response.clone().json();
    const peers = Array.isArray(data.peers) ? data.peers : [];
    state.epoch = Number(data.epoch || state.epoch || 1);
    state.roomState = String(data.state || state.roomState || 'lobby');
    state.emptyStreak = peers.length ? 0 : Math.min(state.emptyStreak + 1, VISIBLE_STEPS.length - 1);
    const nextInterval = document.hidden ? HIDDEN_MS : VISIBLE_STEPS[Math.min(state.emptyStreak, VISIBLE_STEPS.length - 1)];
    state.nextAt = Date.now() + Math.max(FAST_MS, nextInterval - FAST_MS / 3);
    stats.currentIntervalMs = nextInterval;
  } catch (_) {
    state.nextAt = Date.now() + FAST_MS;
  }
  states.set(key, state);
  return response;
};

window.addEventListener('dtam-network-config', () => {
  for (const state of states.values()) state.nextAt = 0;
});

// If a lobby host returns to the foreground, do not keep the old 12s hidden-tab
// cooldown. The mailbox's next poll can then hit D1 immediately instead of
// missing an already-waiting guest for another hidden interval.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  for (const state of states.values()) state.nextAt = 0;
  stats.currentIntervalMs = FAST_MS;
});
