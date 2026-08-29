import { getNetworkConfig } from './net-config.js?v=20260824-direct-m3e1';

const SIGNAL_HOST = 'p2p-signal.lunarlab.uk';
const VOICE_HOST = 'voice.lunarlab.uk';
const OLD_VOICE_HOST = 'rt-d1.lunarlab.uk';
const NativePC = window.RTCPeerConnection;
const NativeWS = window.WebSocket;
const NativeFetch = window.fetch.bind(window);
const trackedPcs = new Set();
let turnIceServers = [];
let fastDropCount = 0;

function updateDiag(extra = {}) {
  const d = window.__DTAM_NET__ || (window.__DTAM_NET__ = {});
  Object.assign(d, extra);
}

function signalAdmission(input, init = {}) {
  if (String(init.method || 'GET').toUpperCase() !== 'POST') return null;
  try {
    const u = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (u.hostname !== SIGNAL_HOST) return null;
    const m = u.pathname.match(/^\/v2\/rooms\/(\d{2})\/(claim|join|recover)$/);
    return m ? { url:u, room:m[1], action:m[2] } : null;
  } catch (_) { return null; }
}

function rewriteVoiceTarget(input) {
  try {
    const raw = input instanceof Request ? input.url : String(input);
    const u = new URL(raw, location.href);
    if (u.hostname !== OLD_VOICE_HOST || !u.pathname.startsWith('/voice/')) return input;
    u.protocol = 'https:';
    u.hostname = VOICE_HOST;
    u.port = '';
    updateDiag({ voiceBackend:'cloudflare-edge' });
    return u.href;
  } catch (_) { return input; }
}

function candidateFamily(candidate) {
  const address = String(candidate?.address || candidate?.ip || '');
  if (address.includes(':')) return 'IPv6';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return 'IPv4';
  return '';
}

function tuneDataChannel(channel) {
  if (!channel || channel.__dtamLowLatencyTuned) return channel;
  channel.__dtamLowLatencyTuned = true;
  if (channel.label === 'dtam-fast') {
    try { channel.bufferedAmountLowThreshold = 512; } catch (_) {}
    const nativeSend = channel.send.bind(channel);
    channel.send = function dtamFastSend(data) {
      if (channel.readyState === 'open' && Number(channel.bufferedAmount || 0) > 4096) {
        fastDropCount += 1;
        updateDiag({ fastDrops:fastDropCount, fastBufferedAmount:Number(channel.bufferedAmount || 0) });
        return;
      }
      return nativeSend(data);
    };
  }
  return channel;
}

function paintTransportRtt(rttMs, route, relay) {
  if (!Number.isFinite(rttMs)) return;
  const el = document.getElementById('latencyStatus');
  if (!el) return;
  const r = Math.max(0, Math.round(rttMs));
  const q = r < 40 ? 'good' : r < 90 ? 'fair' : r < 180 ? 'poor' : 'bad';
  el.textContent = `${r} ms`;
  el.dataset.quality = q;
  el.dataset.rtt = String(r);
  el.dataset.path = relay ? 'TURN' : 'P2P';
  el.title = `${relay ? 'TURN 中继' : 'P2P 直连'} · ${route || 'WebRTC'} · ICE RTT ${r} ms`;
}

async function samplePeerConnections() {
  if (window.__DTAM_NET__?.nativeActive) { setTimeout(samplePeerConnections, document.hidden ? 3000 : 1200); return; }
  const paths = [];
  for (const pc of [...trackedPcs]) {
    if (!pc || pc.connectionState === 'closed') { trackedPcs.delete(pc); continue; }
    if (!['connected','completed'].includes(String(pc.connectionState)) && String(pc.iceConnectionState) !== 'connected' && String(pc.iceConnectionState) !== 'completed') continue;
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach(row => {
        if (row.type === 'candidate-pair' && row.state === 'succeeded' && (row.nominated || !pair)) pair = row;
      });
      if (!pair) continue;
      const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
      const rttMs = Number.isFinite(Number(pair.currentRoundTripTime)) ? Number(pair.currentRoundTripTime) * 1000 : NaN;
      const relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
      const protocol = String(local?.protocol || remote?.protocol || '').toUpperCase();
      const family = candidateFamily(local) || candidateFamily(remote);
      const localType = String(local?.candidateType || '?');
      const remoteType = String(remote?.candidateType || '?');
      paths.push({
        rttMs,
        relay,
        protocol,
        family,
        localType,
        remoteType,
        networkType:String(local?.networkType || ''),
        relayProtocol:String(local?.relayProtocol || remote?.relayProtocol || ''),
      });
    } catch (_) {}
  }
  if (paths.length) {
    const finite = paths.map(x => x.rttMs).filter(Number.isFinite);
    const worstRtt = finite.length ? Math.max(...finite) : NaN;
    const relay = paths.some(x => x.relay);
    const representative = paths.slice().sort((a,b) => (Number.isFinite(b.rttMs)?b.rttMs:-1) - (Number.isFinite(a.rttMs)?a.rttMs:-1))[0];
    const route = [
      `${representative.localType}↔${representative.remoteType}`,
      representative.protocol,
      representative.family,
      representative.relayProtocol ? `via ${representative.relayProtocol}` : '',
    ].filter(Boolean).join(' · ');
    updateDiag({
      transportRttMs:worstRtt,
      peerRttMs:worstRtt,
      relay,
      pair:`${representative.localType} ↔ ${representative.remoteType} · ${representative.protocol.toLowerCase()}`,
      route,
      transportPaths:paths,
      transportSampleAt:Date.now(),
    });
    paintTransportRtt(worstRtt, route, relay);
    const badge = document.getElementById('p2pTransportStatus');
    if (badge) {
      badge.dataset.transportRtt = Number.isFinite(worstRtt) ? String(Math.round(worstRtt)) : '';
      badge.title = `${route || (relay ? 'TURN relay' : 'WebRTC direct')}${Number.isFinite(worstRtt) ? ` · ICE RTT ${Math.round(worstRtt)} ms` : ''}`;
    }
  }
  setTimeout(samplePeerConnections, document.hidden ? 3000 : 1200);
}

window.fetch = async function policyFetch(input, init = {}) {
  const admission = signalAdmission(input, init);
  let nextInput = rewriteVoiceTarget(input);
  let nextInit = init;
  if (admission) {
    try {
      const body = JSON.parse(String(init.body || '{}'));
      body.relay = getNetworkConfig().mode === 'auto';
      if ((admission.action === 'claim' || admission.action === 'recover') && body.hostToken) {
        window.__DTAM_HOST_SIGNAL__ = {
          room:admission.room,
          hostToken:String(body.hostToken),
          action:admission.action,
          at:Date.now(),
        };
      }
      nextInit = { ...init, body:JSON.stringify(body) };
    } catch (_) {}
  }

  const response = await NativeFetch(nextInput, nextInit);
  if (admission && response.ok) {
    try {
      const data = await response.clone().json();
      const list = Array.isArray(data?.iceServers) ? data.iceServers : [];
      turnIceServers = list.filter(x => x && (typeof x.urls === 'string' || Array.isArray(x.urls)));
      updateDiag({
        turnAvailable:turnIceServers.length > 0,
        turnError:turnIceServers.length ? '' : (getNetworkConfig().mode === 'auto' ? 'TURN credential unavailable; trying direct P2P' : ''),
      });
    } catch (_) {}
  }
  return response;
};

if (typeof NativePC === 'function') {
  class PolicyRTCPeerConnection extends NativePC {
    constructor(config = {}) {
      const existing = Array.isArray(config?.iceServers) ? config.iceServers : [];
      const iceServers = [...existing];
      if (getNetworkConfig().mode === 'auto') {
        for (const server of turnIceServers) {
          const urls = JSON.stringify(server.urls);
          if (!iceServers.some(x => JSON.stringify(x?.urls) === urls)) iceServers.push(server);
        }
      }
      const pool = Number.isInteger(config?.iceCandidatePoolSize) ? config.iceCandidatePoolSize : 4;
      super({ ...config, iceServers, iceCandidatePoolSize:pool });
      trackedPcs.add(this);
      this.addEventListener('datachannel', event => tuneDataChannel(event.channel));
      this.addEventListener('connectionstatechange', () => {
        if (this.connectionState === 'closed') trackedPcs.delete(this);
      });
    }
    createDataChannel(label, options = {}) {
      let next = options || {};
      if (label === 'dtam-fast') {
        next = { ...next, ordered:false, maxRetransmits:0, priority:'high' };
        delete next.maxPacketLifeTime;
      } else if (label === 'dtam-control') {
        next = { ...next, priority:'high' };
      }
      return tuneDataChannel(super.createDataChannel(label, next));
    }
  }
  if (typeof NativePC.generateCertificate === 'function') {
    PolicyRTCPeerConnection.generateCertificate = NativePC.generateCertificate.bind(NativePC);
  }
  window.RTCPeerConnection = PolicyRTCPeerConnection;
  setTimeout(samplePeerConnections, 1200);
}

class ServerPolicyWebSocket extends NativeWS {
  constructor(url, protocols) {
    const cfg = getNetworkConfig();
    if (cfg.mode !== 'server') {
      updateDiag({
        lastError:'P2P 建链失败；当前模式不会尝试家庭 Server',
        serverSkipped:true,
      });
      throw new DOMException('Server fallback is disabled outside Server mode', 'NetworkError');
    }
    if (protocols === undefined) super(url); else super(url, protocols);
  }
}

Object.defineProperties(ServerPolicyWebSocket, {
  CONNECTING:{ value:NativeWS.CONNECTING }, OPEN:{ value:NativeWS.OPEN },
  CLOSING:{ value:NativeWS.CLOSING }, CLOSED:{ value:NativeWS.CLOSED },
});
window.WebSocket = ServerPolicyWebSocket;
updateDiag({ serverPolicy:'manual-only', turnAvailable:false, voiceBackend:'cloudflare-edge', fastChannel:'unordered-unreliable' });
