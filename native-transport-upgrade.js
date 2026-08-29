import './native-bridge.js?v=20260829-native1';

const api = window.__DTAM_NATIVE_P2P__;
const BasePC = window.RTCPeerConnection;
const contexts = new WeakMap();
const liveNative = new Map();

const rid = () => {
  try { return crypto.randomUUID().replace(/-/g, ''); }
  catch (_) { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
};
const parse = value => { try { return JSON.parse(String(value)); } catch (_) { return null; } };

function emitQuality() {
  const d = window.__DTAM_NET__ || (window.__DTAM_NET__ = {});
  const active = [...liveNative.values()].filter(x => x.open);
  d.nativeAvailable = !!api?.available;
  d.nativeActive = active.length > 0;
  if (active.length) {
    const rtts = active.map(x => Number(x.rttMs)).filter(Number.isFinite);
    const paths = [...new Set(active.map(x => String(x.path || 'native').toUpperCase()))];
    const maxRtt = rtts.length ? Math.max(...rtts) : NaN;
    d.nativePath = paths.join('+');
    d.route = `Native ${d.nativePath} direct`;
    d.relay = false;
    d.transportRttMs = maxRtt;
    d.peerRttMs = maxRtt;
    d.nativeLinks = active.length;
    const badge = document.getElementById('p2pTransportStatus');
    if (badge) {
      badge.textContent = `Native ${d.nativePath} 直连`;
      badge.title = `${d.route}${Number.isFinite(maxRtt) ? ` · RTT ${Math.round(maxRtt)} ms` : ''}`;
    }
  } else {
    d.nativePath = '';
    d.nativeLinks = 0;
  }
  try { window.dispatchEvent(new CustomEvent('dtam-network-quality', { detail:{...d} })); } catch (_) {}
}

function wireSend(ctx, payload) {
  const ch = ctx.control;
  if (!ch || ch.readyState !== 'open') return false;
  try { ch.__dtamWireSend(JSON.stringify(payload)); return true; }
  catch (_) { return false; }
}

function nativeEvent(ctx, event) {
  if (!event || event.id !== ctx.nativeId) return;
  if (event.event === 'open') {
    ctx.nativeOpen = true;
    ctx.pc.__dtamNativeOpen = true;
    ctx.pc.__dtamNativePath = String(event.path || 'native');
    if (ctx.control) ctx.control.__dtamNativeOpen = true;
    if (ctx.fast) ctx.fast.__dtamNativeOpen = true;
    api.markActive(true);
    liveNative.set(ctx.nativeId, { open:true, path:String(event.path || 'native'), rttMs:NaN });
    emitQuality();
    return;
  }
  if (event.event === 'stats') {
    const item = liveNative.get(ctx.nativeId) || { open:ctx.nativeOpen, path:'native', rttMs:NaN };
    item.open = ctx.nativeOpen;
    item.path = String(event.path || item.path || 'native');
    item.rttMs = Number(event.rttMs);
    liveNative.set(ctx.nativeId, item);
    ctx.pc.__dtamNativeRttMs = item.rttMs;
    ctx.pc.__dtamNativePath = item.path;
    emitQuality();
    return;
  }
  if (event.event === 'message' && ctx.nativeOpen) {
    const ch = event.channel === 'fast' ? ctx.fast : ctx.control;
    if (ch) {
      try { ch.dispatchEvent(new MessageEvent('message', { data:String(event.data ?? ''), origin:location.origin })); }
      catch (e) { console.warn('[DTAM native dispatch]', e); }
    }
    return;
  }
  if (event.event === 'close' || event.event === 'error') {
    downgrade(ctx, String(event.message || event.reason || 'native link closed'));
  }
}

function cleanupNative(ctx) {
  if (ctx.nativeOff) { try { ctx.nativeOff(); } catch (_) {} ctx.nativeOff = null; }
  if (ctx.nativeId) { try { api?.close(ctx.nativeId); } catch (_) {} liveNative.delete(ctx.nativeId); }
  if (ctx.nativeOpen) api?.markActive(false);
  ctx.nativeOpen = false;
  ctx.pc.__dtamNativeOpen = false;
  ctx.pc.__dtamNativeRttMs = NaN;
  if (ctx.control) ctx.control.__dtamNativeOpen = false;
  if (ctx.fast) ctx.fast.__dtamNativeOpen = false;
  emitQuality();
}

function downgrade(ctx, reason='native unavailable') {
  if (!ctx.nativeId && !ctx.nativeOpen) return;
  if (new URLSearchParams(location.search).get('debug') === '1') console.warn('[DTAM native] downgrade', reason);
  cleanupNative(ctx);
  ctx.nativeStarted = false;
  ctx.nativeId = '';
}

function bindNative(ctx, id) {
  if (ctx.nativeOff) ctx.nativeOff();
  ctx.nativeId = id;
  ctx.nativeOff = api.on(id, event => nativeEvent(ctx, event));
}

async function startOffer(ctx) {
  if (!api?.available || !ctx.initiator || !ctx.remoteCap || ctx.nativeStarted || ctx.nativeOpen) return;
  ctx.nativeStarted = true;
  const id = rid();
  const secret = rid() + rid();
  bindNative(ctx, id);
  try {
    const prepared = await api.prepare(id, secret);
    if (!wireSend(ctx, { __dtamNative:1, op:'offer', v:1, id, secret, descriptor:prepared.descriptor })) throw new Error('bootstrap channel closed');
  } catch (e) { downgrade(ctx, e?.message || String(e)); }
}

async function acceptOffer(ctx, msg) {
  if (!api?.available || ctx.initiator || ctx.nativeStarted || ctx.nativeOpen) return;
  const id = String(msg.id || '');
  const secret = String(msg.secret || '');
  if (!id || secret.length < 32 || !msg.descriptor) return;
  ctx.nativeStarted = true;
  bindNative(ctx, id);
  try {
    const prepared = await api.prepare(id, secret);
    if (!wireSend(ctx, { __dtamNative:1, op:'answer', v:1, id, descriptor:prepared.descriptor })) throw new Error('bootstrap channel closed');
    if (api.connect(id, msg.descriptor) !== 0) throw new Error('native connect rejected');
  } catch (e) { downgrade(ctx, e?.message || String(e)); }
}

function acceptAnswer(ctx, msg) {
  if (!api?.available || !ctx.initiator || !ctx.nativeStarted || ctx.nativeOpen) return;
  if (String(msg.id || '') !== ctx.nativeId || !msg.descriptor) return;
  if (api.connect(ctx.nativeId, msg.descriptor) !== 0) downgrade(ctx, 'native connect rejected');
}

function protocolMessage(ctx, event) {
  const msg = parse(event.data);
  if (msg?.__dtamNative !== 1) return;
  // This protocol is consumed below the game layer. A normal browser loads this
  // module too, so wrapper capability probes never leak into GameRoom packets.
  event.stopImmediatePropagation?.();
  if (msg.op === 'cap') {
    if (msg.available === true) {
      ctx.remoteCap = true;
      startOffer(ctx);
    }
  } else if (msg.op === 'offer') {
    acceptOffer(ctx, msg);
  } else if (msg.op === 'answer') {
    acceptAnswer(ctx, msg);
  }
}

function maybeReady(ctx) {
  if (ctx.capSent || ctx.control?.readyState !== 'open' || ctx.fast?.readyState !== 'open') return;
  ctx.capSent = true;
  // All clients have the interceptor, but only wrappers advertise native support.
  if (api?.available) wireSend(ctx, { __dtamNative:1, op:'cap', v:1, available:true, host:api.host });
}

function trackChannel(ctx, ch) {
  if (!ch || ch.__dtamNativeTracked || !['dtam-control','dtam-fast'].includes(ch.label)) return ch;
  ch.__dtamNativeTracked = true;
  ch.__dtamWireSend = ch.send.bind(ch);
  const kind = ch.label === 'dtam-fast' ? 'fast' : 'control';
  if (kind === 'fast') ctx.fast = ch; else ctx.control = ch;
  ch.send = function dtamNativeAwareSend(data) {
    if (ctx.nativeOpen && ctx.nativeId && api?.available) {
      const rc = api.send(ctx.nativeId, kind, String(data));
      if (rc === 0) return;
      downgrade(ctx, `native send ${rc}`);
    }
    return ch.__dtamWireSend(data);
  };
  if (kind === 'control') ch.addEventListener('message', event => protocolMessage(ctx, event));
  ch.addEventListener('open', () => maybeReady(ctx));
  ch.addEventListener('close', () => {
    // Keep native teardown tied to the PeerConnection lifecycle. Existing hybrid
    // close semantics stay authoritative, so a failed upgrade always falls back.
    if (ctx.pc.connectionState === 'closed') cleanupNative(ctx);
  });
  queueMicrotask(() => maybeReady(ctx));
  return ch;
}

if (typeof BasePC === 'function') {
  class NativeUpgradeRTCPeerConnection extends BasePC {
    constructor(config = {}) {
      super(config);
      const ctx = {
        pc:this, initiator:false, control:null, fast:null, capSent:false, remoteCap:false,
        nativeStarted:false, nativeOpen:false, nativeId:'', nativeOff:null,
      };
      contexts.set(this, ctx);
      this.addEventListener('datachannel', event => trackChannel(ctx, event.channel));
    }
    createDataChannel(label, options = {}) {
      const ctx = contexts.get(this);
      if (ctx && ['dtam-control','dtam-fast'].includes(label)) ctx.initiator = true;
      return trackChannel(ctx, super.createDataChannel(label, options));
    }
    close() {
      const ctx = contexts.get(this);
      if (ctx) cleanupNative(ctx);
      return super.close();
    }
  }
  if (typeof BasePC.generateCertificate === 'function') NativeUpgradeRTCPeerConnection.generateCertificate = BasePC.generateCertificate.bind(BasePC);
  window.RTCPeerConnection = NativeUpgradeRTCPeerConnection;
}

console.log('DTAM native transport upgrade', api?.available ? `ready (${api.host})` : 'browser passthrough');
