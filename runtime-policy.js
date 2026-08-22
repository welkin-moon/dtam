import { getNetworkConfig } from './net-config.js?v=hybrid-2';

const SIGNAL_HOST = 'p2p-signal.lunarlab.uk';
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
    if (!/^\/v2\/rooms\/\d{2}\/(claim|join|recover)$/.test(u.pathname)) return null;
    return u;
  } catch (_) { return null; }
}

window.fetch = async function policyFetch(input, init = {}) {
  const admission = signalAdmission(input, init);
  let nextInit = init;
  if (admission) {
    try {
      const body = JSON.parse(String(init.body || '{}'));
      body.relay = getNetworkConfig().mode === 'auto';
      nextInit = { ...init, body:JSON.stringify(body) };
    } catch (_) {}
  }

  const response = await NativeFetch(input, nextInit);
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
      super({ ...config, iceServers });
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
updateDiag({ serverPolicy:'manual-only', turnAvailable:false });
