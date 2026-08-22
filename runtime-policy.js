import { getNetworkConfig } from './net-config.js?v=hybrid-2';

const SIGNAL_HOST = 'p2p-signal.lunarlab.uk';
const VOICE_HOST = 'voice.lunarlab.uk';
const OLD_VOICE_HOST = 'rt-d1.lunarlab.uk';
const NativePC = window.RTCPeerConnection;
const NativeWS = window.WebSocket;
const NativeFetch = window.fetch.bind(window);
let turnIceServers = [];

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
    }
  }
  if (typeof NativePC.generateCertificate === 'function') {
    PolicyRTCPeerConnection.generateCertificate = NativePC.generateCertificate.bind(NativePC);
  }
  window.RTCPeerConnection = PolicyRTCPeerConnection;
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
updateDiag({ serverPolicy:'manual-only', turnAvailable:false, voiceBackend:'cloudflare-edge' });
