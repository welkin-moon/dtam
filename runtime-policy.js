import { getNetworkConfig } from './net-config.js?v=hybrid-2';

const SIGNAL = 'https://p2p-signal.lunarlab.uk';
const NativePC = window.RTCPeerConnection;
const NativeWS = window.WebSocket;
let turnIceServers = [];

function updateDiag(extra = {}) {
  const d = window.__DTAM_NET__ || (window.__DTAM_NET__ = {});
  Object.assign(d, extra);
}

async function loadTurn() {
  try {
    const r = await fetch(`${SIGNAL}/v2/turn`, { cache:'no-store' });
    if (!r.ok) throw new Error(`TURN ${r.status}`);
    const data = await r.json();
    const list = Array.isArray(data.iceServers) ? data.iceServers : [];
    turnIceServers = list.filter(x => x && (typeof x.urls === 'string' || Array.isArray(x.urls)));
    updateDiag({ turnAvailable: turnIceServers.length > 0, turnError:'' });
  } catch (e) {
    turnIceServers = [];
    updateDiag({ turnAvailable:false, turnError:String(e?.message || e) });
  }
}

if (typeof NativePC === 'function') {
  await loadTurn();
  class PolicyRTCPeerConnection extends NativePC {
    constructor(config = {}) {
      const existing = Array.isArray(config?.iceServers) ? config.iceServers : [];
      const iceServers = [...existing];
      for (const server of turnIceServers) {
        const urls = JSON.stringify(server.urls);
        if (!iceServers.some(x => JSON.stringify(x?.urls) === urls)) iceServers.push(server);
      }
      super({ ...config, iceServers });
    }
  }
  for (const key of ['generateCertificate']) {
    if (typeof NativePC[key] === 'function') PolicyRTCPeerConnection[key] = NativePC[key].bind(NativePC);
  }
  window.RTCPeerConnection = PolicyRTCPeerConnection;
}

class ServerPolicyWebSocket extends NativeWS {
  constructor(url, protocols) {
    const cfg = getNetworkConfig();
    const u = new URL(String(url), location.href);
    const explicitServer = cfg.mode === 'server';
    const isDefaultHomeServer = /(^|\.)rt-d1\.lunarlab\.uk$/i.test(u.hostname);
    if (!explicitServer && isDefaultHomeServer) {
      updateDiag({ lastError:'当前默认 Server 离线；Auto 不再尝试家庭 Server', serverSkipped:true });
      throw new DOMException('Auto mode does not use the offline home server', 'NetworkError');
    }
    if (protocols === undefined) super(url); else super(url, protocols);
  }
}

Object.defineProperties(ServerPolicyWebSocket, {
  CONNECTING:{ value:NativeWS.CONNECTING }, OPEN:{ value:NativeWS.OPEN },
  CLOSING:{ value:NativeWS.CLOSING }, CLOSED:{ value:NativeWS.CLOSED },
});
window.WebSocket = ServerPolicyWebSocket;
updateDiag({ serverPolicy:'manual-only' });
