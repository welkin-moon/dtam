const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = process.cwd();
const assert = (ok, message) => { if (!ok) throw new Error(`[authority routing] ${message}`); };
const hybrid = fs.readFileSync(`${root}/hybrid-transport.js`, 'utf8');
const resilience = fs.readFileSync(`${root}/p2p-resilience.js`, 'utf8');
const classStart = hybrid.indexOf('class HybridSocket extends EventTarget {');
const classEnd = hybrid.indexOf('\nwindow.WebSocket = HybridSocket;', classStart);
const propertyStart = hybrid.indexOf('\nObject.defineProperties(HybridSocket.prototype', classStart);
const patchStart = resilience.indexOf('function patchSocket(sock) {');
const patchEnd = resilience.indexOf('\nconst WrappedWebSocket', patchStart);
assert(classStart >= 0 && propertyStart > classStart && classEnd > propertyStart, 'could not find the production HybridSocket implementation');
assert(patchStart >= 0 && patchEnd > patchStart, 'could not find the production resilient patchSocket implementation');

const nativeSockets = [];
class FakeNativeWebSocket {
  constructor(url) { this.url = String(url); this.readyState = 0; this.closed = false; nativeSockets.push(this); }
  open() { this.readyState = 1; this.onopen?.({}); }
  message(data) { return this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) }); }
  close(code = 1000, reason = '') { this.closed = true; this.readyState = 3; this.onclose?.({ code, reason, wasClean: code === 1000 }); }
  send() {}
}
class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(k) { return this.data.has(String(k)) ? this.data.get(String(k)) : null; }
  setItem(k, v) { this.data.set(String(k), String(v)); }
  removeItem(k) { this.data.delete(String(k)); }
}
class TestMessageEvent extends Event { constructor(type, init = {}) { super(type); this.data = init.data; this.origin = init.origin || ''; } }
class TestCloseEvent extends Event { constructor(type, init = {}) { super(type); this.code = init.code || 1006; this.reason = init.reason || ''; this.wasClean = !!init.wasClean; } }
const realSetTimeout = setTimeout;
const shortSetTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms >= 1000 ? 35 : ms, ...args);
const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();
const config = { mode: 'auto', serverUrl: 'wss://server.example.test/ws' };
let apiImpl = async () => { throw Object.assign(new Error('unconfigured test API'), { status: 500 }); };
const context = vm.createContext({
  Event, EventTarget, MessageEvent: TestMessageEvent, CloseEvent: TestCloseEvent,
  URL, URLSearchParams, AbortSignal, DOMException, TextEncoder, TextDecoder,
  crypto: webcrypto, localStorage, sessionStorage, location: { origin: 'https://game.example.test' },
  setTimeout: shortSetTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
  queueMicrotask: () => {},
  window: { WebSocket: FakeNativeWebSocket, RTCPeerConnection: function FakePeerConnection() {}, __DTAM_NET: {} },
  document: { readyState: 'complete', getElementById: () => null },
  __nativeSockets: nativeSockets,
  __api: (...args) => apiImpl(...args),
});
const classSource = hybrid.slice(classStart, classEnd);
const propertiesSource = hybrid.slice(propertyStart, hybrid.indexOf('\n', hybrid.indexOf('});', propertyStart) + 3));
const patchSource = resilience.slice(patchStart, patchEnd);
vm.runInContext(`
  const NativeWebSocket = window.WebSocket;
  const NativeRTCPeerConnection = window.RTCPeerConnection;
  const SERVER_PRIMARY_TIMEOUT = 1800;
  const MAP_PROTOCOL_ID = 'dtam-map-150-v1';
  const RECOVER_KEY = 'au-dtam-p2p-recovery:';
  const SNAP_KEY = 'au-dtam-p2p-snapshot:';
  const SIGNAL = 'https://p2p-signal.example.test';
  const diag = new Proxy(function (extra) { Object.assign(window.__DTAM_NET, extra); }, {
    get(target, key) { return key in target ? target[key] : window.__DTAM_NET[key]; },
    set(target, key, value) { target[key] = value; window.__DTAM_NET[key] = value; return true; },
  });
  const api = async (path, options) => { const result = await globalThis.__api(path, options); globalThis.__lastApi = result; return result; };
  const getNetworkConfig = () => ({ ...globalThis.__config });
  const serverTargetFor = (_url, serverUrl) => serverUrl;
  const qualityChanged = () => {};
  const badge = () => {};
  const parse = value => { try { return JSON.parse(String(value)); } catch (_) { return null; } };
  const ce = (code, reason, clean) => new CloseEvent('close', { code, reason, wasClean: clean });
  const clearChunks = () => {};
  const recoverLoad = () => null;
  const loadJson = (storage, key) => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch (_) { return null; } };
  const saveRecovery = () => {};
  const rid = () => '0123456789abcdef0123456789abcdef';
  const stopGameplayWatch = sock => { if (sock.__dtamGameplayWatch) clearTimeout(sock.__dtamGameplayWatch); sock.__dtamGameplayWatch = null; };
  const startGameplayWatch = () => {};
  ${classSource}
  ${propertiesSource}
  ${patchSource}
  globalThis.__makeSocket = (room = '42', create = false, query = '') => {
    const s = new HybridSocket('wss://game.example.test/ws?room=' + room + '&create=' + (create ? '1' : '0') + query);
    s.cfg = getNetworkConfig();
    patchSocket(s);
    return s;
  };
  globalThis.__resetDiag = () => { for (const key of Object.keys(diag)) delete diag[key]; window.__DTAM_NET = {}; };
  globalThis.__config = { mode: 'auto', serverUrl: 'wss://server.example.test/ws' };
`, context, { filename: 'production-authority-routing-vm.js' });

const pause = ms => new Promise(resolve => realSetTimeout(resolve, ms));
async function waitFor(test, message, timeout = 1000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (test()) return; await pause(2); }
  throw new Error(`[authority routing] timed out waiting for ${message}`);
}
function makeSocket({ room = '42', create = false, token = '' } = {}) {
  nativeSockets.length = 0;
  context.__resetDiag();
  context.__config = { mode: 'auto', serverUrl: 'wss://server.example.test/ws' };
  const query = token ? `&token=${encodeURIComponent(token)}` : '';
  return context.__makeSocket(room, create, query);
}
function setApi(fn) { apiImpl = fn; context.__api = (...args) => apiImpl(...args); }
function apiError(status, code, message = 'test failure') { return Object.assign(new Error(message), { status, code }); }
function welcome(room = '42') { return { t: 'welcome', room, mapId: 'dtam-map-150-v1', features: { serverPrimaryV2: true }, self: { id: 'server-player', token: 'server-token' } }; }
function roomClaim() { return { status: 200, data: { ok: true, hostId: 'a'.repeat(32), epoch: 7 } }; }
function recordP2p(socket) {
  socket.__p2pCalls = [];
  socket.guest = async rec => { socket.__p2pCalls.push({ mode: 'guest', rec }); return 'p2p-guest'; };
  socket.host = async () => { socket.__p2pCalls.push({ mode: 'host' }); return 'p2p-host'; };
}

async function p2pClaimSkipsNative() {
  const socket = makeSocket(); recordP2p(socket);
  const calls = [];
  setApi(async path => { calls.push(path); return roomClaim(); });
  await socket.start();
  assert(calls.length === 1 && calls[0] === '/v2/rooms/42/info', 'the current P2P claim must be checked first');
  assert(nativeSockets.length === 0, 'an existing P2P claim must skip NativeWebSocket');
  assert(socket.p2pPinned && socket.__p2pCalls.some(x => x.mode === 'guest'), `claimed room must pin P2P and route the join there (pinned=${socket.p2pPinned}, closed=${socket.closed}, lastError=${context.window.__DTAM_NET.lastError}, routes=${JSON.stringify(socket.__p2pCalls)}, cfg=${JSON.stringify(socket.cfg)})`);
}

async function missingRoomAllowsServer() {
  const socket = makeSocket(); recordP2p(socket);
  let infoCalls = 0;
  setApi(async path => {
    assert(path === '/v2/rooms/42/info', 'Server probe must confirm authority only through room info');
    infoCalls++;
    throw apiError(404, 'room_not_found');
  });
  const started = socket.start();
  await waitFor(() => nativeSockets.length === 1, 'NativeWebSocket after a confirmed 404');
  const native = nativeSockets[0]; native.open();
  await native.message(welcome());
  await started;
  assert(infoCalls === 2, 'a candidate Server welcome must be rechecked against signal authority');
  assert(socket.readyState === 1 && socket.native === native && context.window.__DTAM_NET.mode === 'server-primary', 'a genuine Server room with no P2P claim must be adopted');
  assert(socket.__p2pCalls.length === 0, 'a valid Server room must not enter the P2P backend');
}

async function uncertainAuthorityRejectsBothBackends() {
  const cases = [
    ['lookup timeout', async () => { throw Object.assign(new Error('lookup timed out'), { name: 'AbortError' }); }],
    ['503', async () => { throw apiError(503, 'unavailable'); }],
    ['malformed response', async () => ({ status: 200, data: { ok: true, hostId: '', epoch: 'bad' } })],
  ];
  for (const [label, fn] of cases) {
    const socket = makeSocket(); recordP2p(socket); setApi(fn);
    await socket.start();
    assert(socket.closed, `${label} must close the undecided connection`);
    assert(nativeSockets.length === 0, `${label} must not enter the NativeWebSocket backend`);
    assert(socket.__p2pCalls.length === 0, `${label} must not enter the P2P backend`);
  }
}

async function claimAppearingDuringProbeWins() {
  const socket = makeSocket(); recordP2p(socket);
  let infoCalls = 0;
  setApi(async path => {
    assert(path === '/v2/rooms/42/info', 'both authority checks must use the signal info endpoint');
    if (++infoCalls === 1) throw apiError(404, 'room_not_found');
    return roomClaim();
  });
  const started = socket.start();
  await waitFor(() => nativeSockets.length === 1, 'Server probe socket');
  const native = nativeSockets[0]; native.open();
  await native.message(welcome());
  await started;
  assert(infoCalls === 2 && socket.p2pPinned, 'the second check must observe and pin the newly claimed P2P room');
  assert(native.closed && socket.native === null, 'the Server probe must be abandoned after the P2P claim appears');
  assert(socket.__p2pCalls.some(x => x.mode === 'guest'), 'join must continue through P2P after the late claim');
  assert(context.window.__DTAM_NET.mode !== 'server-primary', 'the colliding Server welcome must not become the active authority');
}

async function deferredAuthorityLookupCannotKillP2p() {
  const socket = makeSocket();
  socket.__p2pCalls = [];
  socket.guest = async rec => { socket.__p2pCalls.push({ mode: 'guest', rec }); socket.open('p2p-after-probe-timeout'); };
  let infoCalls = 0, rejectSecond;
  const secondLookup = new Promise((_, reject) => { rejectSecond = reject; });
  setApi(async path => {
    assert(path === '/v2/rooms/42/info', 'late lookup must still use the signal authority endpoint');
    if (++infoCalls === 1) throw apiError(404, 'room_not_found');
    return secondLookup;
  });
  const started = socket.start();
  await waitFor(() => nativeSockets.length === 1, 'Server probe socket');
  const native = nativeSockets[0]; native.open();
  const welcomeHandling = native.message(welcome());
  await waitFor(() => infoCalls === 2, 'pending post-welcome authority query');
  await waitFor(() => socket.__p2pCalls.some(x => x.mode === 'guest'), 'probe timeout to activate P2P', 1000);
  await started;
  assert(socket.opened && socket.readyState === 1 && !socket.closed, 'P2P route must be open before the delayed lookup completes');
  assert(native.closed && socket.native === null, 'timed-out Server probe must already be detached');
  rejectSecond(apiError(503, 'late_unavailable', 'late authority lookup rejection'));
  await welcomeHandling;
  await pause(5);
  assert(socket.opened && socket.readyState === 1 && !socket.closed, 'a rejection from the obsolete lookup must not finish the newer P2P connection');
  assert(context.window.__DTAM_NET.mode === 'p2p-after-probe-timeout' && socket.native === null, 'the late rejection must not adopt or restore NativeWebSocket');
}

async function inTimePostWelcomeLookupFailureIsFailClosed() {
  const socket = makeSocket(); recordP2p(socket);
  let infoCalls = 0;
  setApi(async path => {
    assert(path === '/v2/rooms/42/info', 'the in-time post-welcome check must query signal authority');
    if (++infoCalls === 1) throw apiError(404, 'room_not_found');
    throw apiError(503, 'authority_unavailable');
  });
  const started = socket.start();
  await waitFor(() => nativeSockets.length === 1, 'Server probe socket');
  const native = nativeSockets[0]; native.open();
  await native.message(welcome());
  await started;
  assert(infoCalls === 2, 'Server welcome must trigger a second authority lookup');
  assert(socket.closed && socket.readyState === 3 && native.closed, 'an in-time authority lookup failure must close the undecided socket');
  assert(socket.__p2pCalls.length === 0 && socket.native === null, 'an in-time authority lookup failure must fail closed without entering either backend');
  assert(context.window.__DTAM_NET.mode !== 'server-primary', 'an unconfirmed Server welcome must never become active');
}

async function lateWelcomeCannotBeAdopted() {
  const socket = makeSocket(); recordP2p(socket);
  setApi(async () => { throw apiError(404, 'room_not_found'); });
  const started = socket.start();
  await waitFor(() => nativeSockets.length === 1, 'Server probe socket');
  const native = nativeSockets[0]; native.open();
  const lateHandler = native.onmessage;
  await waitFor(() => socket.__p2pCalls.some(x => x.mode === 'guest'), 'probe timeout to route into P2P', 1000);
  await started;
  await lateHandler({ data: JSON.stringify(welcome()) });
  assert(native.closed && socket.native === null, 'a welcome arriving after probe timeout must not be adopted');
  assert(context.window.__DTAM_NET.mode !== 'server-primary', 'late welcome must not reopen the Server authority');
  assert(socket.__p2pCalls.some(x => x.mode === 'guest'), 'the timed-out probe must leave P2P as the active route');
}

async function createCollisionUsesClaimPath() {
  const socket = makeSocket({ create: true });
  const received = [];
  socket.addEventListener('message', event => received.push(JSON.parse(event.data)));
  const calls = [];
  setApi(async (path, options) => {
    calls.push({ path, method: options?.method || 'GET' });
    if (path === '/v2/rooms/42/info') return roomClaim();
    if (path === '/v2/rooms/42/claim') throw apiError(409, 'room_exists');
    throw new Error(`unexpected API route ${path}`);
  });
  await socket.start();
  assert(nativeSockets.length === 0, 'a same-code P2P claim during create must not create a Server room');
  assert(calls.map(x => x.path).join(',') === '/v2/rooms/42/info,/v2/rooms/42/claim', 'create collision must follow info then authoritative P2P claim');
  assert(socket.p2pPinned && context.window.__DTAM_NET.mode === 'collision', 'claim collision must retain P2P authority and use the collision path');
  assert(received.some(x => x.t === 'error' && x.code === 'room_exists'), 'the existing same-code room must be reported as room_exists');
  await pause(60);
}

async function pinnedP2pCannotFallback() {
  const socket = makeSocket();
  socket.p2pPinned = true;
  await socket.fallback('simulated P2P backend failure');
  assert(nativeSockets.length === 0, 'a room pinned to P2P must never use native Server fallback');
  assert(socket.closed && socket.native === null, 'a pinned P2P failure must close safely instead of joining another authority');
}

async function resumingP2pSkipsProbe() {
  const socket = makeSocket({ token: 'existing-resume-token' }); recordP2p(socket);
  localStorage.setItem('au-dtam-p2p-recovery:42', JSON.stringify({ recoveryToken: 'saved-recovery', epoch: 9 }));
  const calls = [];
  setApi(async path => { calls.push(path); throw new Error(`unexpected API ${path}`); });
  await socket.start();
  assert(calls.length === 0, 'a token-backed P2P resume must not perform a Server authority probe');
  assert(socket.__p2pCalls.length === 1 && socket.__p2pCalls[0].mode === 'guest', 'resume must continue through P2P guest admission');
  assert(socket.__p2pCalls[0].rec?.recoveryToken === 'saved-recovery', 'P2P resume must retain the loaded recovery record');
  localStorage.removeItem('au-dtam-p2p-recovery:42');
}

(async () => {
  await p2pClaimSkipsNative();
  await missingRoomAllowsServer();
  await uncertainAuthorityRejectsBothBackends();
  await claimAppearingDuringProbeWins();
  await deferredAuthorityLookupCannotKillP2p();
  await inTimePostWelcomeLookupFailureIsFailClosed();
  await lateWelcomeCannotBeAdopted();
  await createCollisionUsesClaimPath();
  await pinnedP2pCannotFallback();
  await resumingP2pSkipsProbe();
  console.log('[authority routing] ok: production HybridSocket + resilientStart route claims, unknown authority, late welcomes, create collisions, and P2P resume safely');
})().catch(error => { console.error(error); process.exitCode = 1; });
