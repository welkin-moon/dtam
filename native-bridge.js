const android = typeof window.DtamNative?.command === 'function';
const webview2 = !!window.chrome?.webview && typeof window.chrome.webview.postMessage === 'function';
const available = android || webview2;
const listeners = new Map();
const descriptorWaiters = new Map();
let activeLinks = 0;

function emit(event) {
  if (!event || typeof event !== 'object') return;
  const id = String(event.id || '');
  if (event.event === 'descriptor' && descriptorWaiters.has(id)) {
    const waiter = descriptorWaiters.get(id);
    descriptorWaiters.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve(event);
  }
  const set = listeners.get(id);
  if (set) for (const fn of [...set]) {
    try { fn(event); } catch (e) { console.warn('[DTAM native listener]', e); }
  }
  try { window.dispatchEvent(new CustomEvent('dtam-native-event', { detail:event })); } catch (_) {}
}

function parseAndEmit(value) {
  if (!value) return;
  try { emit(typeof value === 'string' ? JSON.parse(value) : value); }
  catch (e) { console.warn('[DTAM native event parse]', e); }
}

window.__dtamNativeDispatch = parseAndEmit;
if (webview2) {
  window.chrome.webview.addEventListener('message', event => {
    const data = event.data;
    if (data?.dtamNativeEvent) parseAndEmit(data.dtamNativeEvent);
  });
}

let androidPollTimer = null;
function pollAndroid() {
  if (!android || typeof window.DtamNative?.poll !== 'function') return;
  let count = 0;
  while (count++ < 64) {
    let raw = null;
    try { raw = window.DtamNative.poll(); } catch (_) { break; }
    if (!raw) break;
    parseAndEmit(raw);
  }
  const delay = activeLinks > 0 ? (document.hidden ? 20 : 4) : 80;
  androidPollTimer = setTimeout(pollAndroid, delay);
}
// Older APK builds use JS polling; newer builds also push from the native main looper.
if (android) androidPollTimer = setTimeout(pollAndroid, 0);

function command(payload) {
  if (!available) return -1;
  if (android) {
    try { return Number(window.DtamNative.command(JSON.stringify(payload))); }
    catch (_) { return -2; }
  }
  try {
    window.chrome.webview.postMessage({ dtamNativeCommand:payload });
    return 0;
  } catch (_) { return -2; }
}

function on(id, fn) {
  id = String(id || '');
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(fn);
  return () => {
    const set = listeners.get(id);
    set?.delete(fn);
    if (set && !set.size) listeners.delete(id);
  };
}

function prepare(id, secret) {
  id = String(id || '');
  if (!available || !id) return Promise.reject(new Error('native transport unavailable'));
  if (descriptorWaiters.has(id)) return descriptorWaiters.get(id).promise;
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  const timer = setTimeout(() => {
    if (descriptorWaiters.get(id)?.promise === promise) descriptorWaiters.delete(id);
    reject(new Error('native descriptor timeout'));
  }, 6000);
  descriptorWaiters.set(id, { promise, resolve, reject, timer });
  const rc = command({ op:'prepare', id, secret:String(secret || '') });
  if (rc !== 0) {
    clearTimeout(timer);
    descriptorWaiters.delete(id);
    reject(new Error(`native prepare failed (${rc})`));
  }
  return promise;
}

function connect(id, remote) { return command({ op:'connect', id:String(id), remote }); }
function send(id, channel, data) { return command({ op:'send', id:String(id), channel:String(channel), data:String(data) }); }
function status(id) { return command({ op:'status', id:String(id) }); }
function close(id) {
  activeLinks = Math.max(0, activeLinks - 1);
  descriptorWaiters.delete(String(id));
  return command({ op:'close', id:String(id) });
}
function markActive(onValue) { activeLinks = Math.max(0, activeLinks + (onValue ? 1 : -1)); }

window.__DTAM_NATIVE_P2P__ = Object.freeze({
  available,
  host: android ? 'android-webview' : webview2 ? 'webview2' : '',
  prepare, connect, send, close, status, on, markActive,
});
if (available) {
  const d = window.__DTAM_NET__ || (window.__DTAM_NET__ = {});
  d.nativeAvailable = true;
  d.nativeHost = android ? 'android-webview' : 'webview2';
}
console.log('DTAM native bridge', available ? (android ? 'android-webview' : 'webview2') : 'browser-only');
