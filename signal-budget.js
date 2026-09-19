const NativeFetch = window.fetch.bind(window);
const SIGNAL_HOST = 'p2p-signal.lunarlab.uk';
const FAST_MS = 1200;
const VISIBLE_STEPS = [1200, 1600, 2100, 2600, 3000];
// When the hibernatable doorbell is healthy it is the primary join wakeup.
// Keep D1 polling only as a safety net for a lost bell notification. 8-10 s
// still leaves room for ICE setup inside the 20 s client connection budget.
const BELL_VISIBLE_MS = 8000;
const BELL_HIDDEN_MS = 10000;
const HIDDEN_MS = 5000;
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

function bellPrimary(room) {
  const bell = window.__DTAM_BELL__;
  return bell?.connected === true && String(bell.room || '') === String(room || '');
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
  const room = (pollUrl.pathname.match(/^\/v2\/rooms\/(\d{2})\/joins$/) || [])[1] || '';
  const state = states.get(key) || { nextAt: 0, emptyStreak: 0, epoch: 1, roomState: 'lobby', bellPrimary: false };
  const now = Date.now();
  const bell = bellPrimary(room);
  if (state.bellPrimary !== bell) {
    state.bellPrimary = bell;
    state.nextAt = 0;
    state.emptyStreak = 0;
  }
  const visibleInterval = bell ? BELL_VISIBLE_MS : VISIBLE_STEPS[Math.min(state.emptyStreak, VISIBLE_STEPS.length - 1)];
  const interval = document.hidden ? (bell ? BELL_HIDDEN_MS : HIDDEN_MS) : visibleInterval;
  stats.currentIntervalMs = interval;
  stats.bellPrimary = bell;
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
    const bellNow = bellPrimary(room);
    state.bellPrimary = bellNow;
    const nextVisible = bellNow ? BELL_VISIBLE_MS : VISIBLE_STEPS[Math.min(state.emptyStreak, VISIBLE_STEPS.length - 1)];
    const nextInterval = document.hidden ? (bellNow ? BELL_HIDDEN_MS : HIDDEN_MS) : nextVisible;
    state.nextAt = Date.now() + Math.max(FAST_MS, bellNow ? nextInterval : nextInterval - FAST_MS / 3);
    stats.currentIntervalMs = nextInterval;
    stats.bellPrimary = bellNow;
  } catch (_) {
    state.nextAt = Date.now() + FAST_MS;
  }
  states.set(key, state);
  return response;
};

window.addEventListener('dtam-network-config', () => {
  for (const state of states.values()) state.nextAt = 0;
});

// If a browser-host returns to the foreground, do not keep the old hidden-tab
// cooldown. The mailbox's next poll can then hit D1 immediately.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  for (const state of states.values()) state.nextAt = 0;
  stats.currentIntervalMs = FAST_MS;
});
