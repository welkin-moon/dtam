(() => {
'use strict';

const HybridWebSocket = window.WebSocket;
const NativeRTCPeerConnection = window.RTCPeerConnection;
const proto = HybridWebSocket?.prototype;
if (!proto || typeof proto._finalClose !== 'function' || typeof proto._setDirect !== 'function') return;

const originalFinalClose = proto._finalClose;
const originalSetDirect = proto._setDirect;
const originalMarkOpen = proto._markOpen;
const originalSend = proto.send;
const originalClose = proto.close;
const originalDeliverApp = proto._deliverApp;
const activeSockets = new Set();
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const RTC_HANDSHAKE_TIMEOUT_MS = 20000;
const DIRECT_REQUIRED_GRACE_MS = 25000;
const POSITION_SYNC_TYPES = new Set([
  'emergency',
  'vent',
  'report',
  'kill',
  'ability',
  'task_begin',
  'task_complete',
  'sabotage_fix',
]);

function parsePacket(data) {
  if (typeof data !== 'string' || data.length > 65536) return null;
  try { return JSON.parse(data); } catch (_) { return null; }
}

function phaseFromPacket(packet) {
  const phase = packet?.game?.phase;
  return typeof phase === 'string' ? phase : '';
}

function packetStartsGameplay(packet) {
  const phase = phaseFromPacket(packet);
  return packet?.t === 'game_start' || packet?.t === 'resume_play' || phase === 'playing' || phase === 'meeting';
}

function packetEndsGameplay(packet) {
  const phase = phaseFromPacket(packet);
  return packet?.t === 'game_over' || packet?.t === 'lobby_reset' || phase === 'lobby' || phase === 'ended';
}

function setGameplayPaused(socket, paused, reason = '') {
  if (!socket || socket._v3GameplayPaused === paused) return;
  socket._v3GameplayPaused = paused;
  document.documentElement.toggleAttribute('data-direct-reconnecting', paused);
  window.dispatchEvent(new CustomEvent('dtam-direct-required', {
    detail: { paused, reason, generation: Number(socket._v3RtcGeneration || 0) },
  }));
}

function clearDirectDeadline(socket) {
  clearTimeout(socket?._v3DirectDeadlineTimer);
  if (socket) socket._v3DirectDeadlineTimer = null;
}

function armDirectDeadline(socket, reason = 'Server 直连中断') {
  if (!socket || socket._closed || socket._v3DirectDeadlineTimer) return;
  setGameplayPaused(socket, true, reason);
  socket._v3DirectDeadlineTimer = setTimeout(() => {
    socket._v3DirectDeadlineTimer = null;
    if (socket._closed || !socket._v3GameActive || directStillHealthy(socket)) return;
    try {
      socket._emitMessage(JSON.stringify({
        t: 'error',
        code: 'direct_required',
        message: 'Server 直连恢复超时，正在重新连接',
        close: true,
      }));
    } catch (_) {}
    try { originalClose.call(socket, 4410, 'server direct transport required'); }
    catch (_) { originalFinalClose.call(socket, 4410, 'server direct transport required', false); }
  }, DIRECT_REQUIRED_GRACE_MS);
}

function clearQualitySampler(socket) {
  clearInterval(socket?._v3QualityTimer);
  if (socket) socket._v3QualityTimer = null;
}

function startQualitySampler(socket) {
  clearQualitySampler(socket);
  const sample = async () => {
    if (!directStillHealthy(socket)) return;
    try {
      const stats = await socket._pc.getStats();
      let pair = null;
      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && (report.nominated || !pair)) pair = report;
      });
      const seconds = Number(pair?.currentRoundTripTime);
      const rttMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : NaN;
      const diagnostics = window.__DTAM_V3_TRANSPORT__;
      if (diagnostics) diagnostics.rttMs = rttMs;
      window.dispatchEvent(new CustomEvent('dtam-network-quality', {
        detail: { mode: 'server-direct', direct: true, rttMs },
      }));
    } catch (_) {}
  };
  sample();
  socket._v3QualityTimer = setInterval(sample, 2000);
}

function directStillHealthy(socket) {
  if (!socket?._direct) return false;
  if (socket._control?.readyState !== 'open' || socket._fast?.readyState !== 'open') return false;
  const state = String(socket._pc?.connectionState || 'connected');
  return !['failed', 'closed'].includes(state);
}

function signalAvailable(socket) {
  return !socket?._legacy && socket?._signal?.readyState === 1;
}

function markBackupOffline(socket) {
  const diagnostics = window.__DTAM_V3_TRANSPORT__;
  if (diagnostics) {
    diagnostics.direct = true;
    diagnostics.mode = 'direct';
    diagnostics.backup = 'offline';
    diagnostics.lastError = 'Tunnel signaling lost while direct transport remains healthy';
  }
  const el = document.getElementById('transportStatus');
  if (el) {
    const current = el.textContent || 'v3 · 节点直连';
    el.textContent = current.replace(' · 备用离线', '') + ' · 备用离线';
    el.title = 'WebRTC 直连仍正常；Cloudflare Tunnel 备用信令暂不可用';
  }
  socket._signal = null;
  clearTimeout(socket._edgeTimer);
}

function clearRtcRetry(socket) {
  clearTimeout(socket._v3RtcRetryTimer);
  socket._v3RtcRetryTimer = null;
}

function invalidateRtc(socket) {
  socket._v3RtcGeneration = Number(socket._v3RtcGeneration || 0) + 1;
  clearTimeout(socket._disconnectTimer);
  clearTimeout(socket._v3RtcHandshakeTimer);
  socket._disconnectTimer = null;
  socket._v3RtcHandshakeTimer = null;
}

async function rebuildRtc(socket, trigger = 'network-change') {
  if (!socket || socket._closed || socket.readyState !== HybridWebSocket.OPEN || !signalAvailable(socket)) return;
  clearRtcRetry(socket);
  invalidateRtc(socket);
  const oldPc = socket._pc;
  socket._pc = null;
  socket._control = null;
  socket._fast = null;
  socket._direct = false;
  socket._rtcStarted = false;
  try { oldPc?.close(); } catch (_) {}

  const diagnostics = window.__DTAM_V3_TRANSPORT__;
  if (diagnostics) {
    diagnostics.direct = false;
    diagnostics.mode = 'tunnel';
    diagnostics.iceRefresh = trigger;
  }
  try {
    await socket._startRtc();
  } catch (err) {
    if (diagnostics) diagnostics.lastError = String(err?.message || err);
    scheduleRtcRetry(socket, trigger);
  }
}

function scheduleRtcRetry(socket, trigger = 'transport-loss', immediate = false) {
  if (!socket || socket._closed || socket.readyState !== HybridWebSocket.OPEN || !signalAvailable(socket)) return;
  if (socket._v3RtcRetryTimer) return;
  const attempt = Number(socket._v3RtcRetryAttempt || 0);
  const delay = immediate ? 0 : RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  socket._v3RtcRetryAttempt = Math.min(attempt + 1, RETRY_DELAYS_MS.length - 1);
  socket._v3RtcRetryTimer = setTimeout(() => {
    socket._v3RtcRetryTimer = null;
    rebuildRtc(socket, trigger).catch(() => scheduleRtcRetry(socket, trigger));
  }, delay);
}

// Replace the bootstrap RTC constructor with a generation-fenced version. Address/interface
// changes can close an old PeerConnection after a replacement has already started; every
// callback therefore proves that it still belongs to the current generation before mutating
// the HybridWebSocket state.
proto._startRtc = async function generationAwareStartRtc() {
  if (this._rtcStarted || this._closed || !signalAvailable(this)) return;
  if (typeof NativeRTCPeerConnection !== 'function') throw new Error('RTCPeerConnection unavailable');

  this._rtcStarted = true;
  const generation = Number(this._v3RtcGeneration || 0) + 1;
  this._v3RtcGeneration = generation;
  const signal = this._signal;
  const pc = new NativeRTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
    bundlePolicy: 'max-bundle',
  });
  this._pc = pc;

  // Old samples are disposable, but ordering is still useful: maxRetransmits=0 avoids
  // retransmitting stale positions while ordered=true prevents position time-travel.
  const control = pc.createDataChannel('dtam-control', { ordered: true });
  const fast = pc.createDataChannel('dtam-fast', { ordered: true, maxRetransmits: 0 });
  control.binaryType = fast.binaryType = 'arraybuffer';
  this._control = control;
  this._fast = fast;

  const current = () =>
    !this._closed && this._v3RtcGeneration === generation && this._pc === pc;

  const opened = () => {
    if (!current()) return;
    if (control.readyState === 'open' && fast.readyState === 'open') this._setDirect(true);
  };
  const closed = () => {
    if (current()) this._setDirect(false, 'DataChannel 已断开');
  };
  const errored = () => {
    if (current()) this._setDirect(false, 'DataChannel 错误');
  };
  control.onopen = fast.onopen = opened;
  control.onclose = fast.onclose = closed;
  control.onerror = fast.onerror = errored;
  control.onmessage = event => {
    if (current()) this._deliverApp(event.data, 'direct');
  };
  fast.onmessage = event => {
    if (current()) this._deliverApp(event.data, 'direct');
  };

  pc.addEventListener('connectionstatechange', () => {
    if (!current()) return;
    const state = pc.connectionState;
    if (state === 'connected') {
      clearTimeout(this._disconnectTimer);
      this._disconnectTimer = null;
      return;
    }
    if (state === 'failed' || state === 'closed') {
      this._setDirect(false, `ICE ${state}`);
    } else if (state === 'disconnected') {
      clearTimeout(this._disconnectTimer);
      this._disconnectTimer = setTimeout(() => {
        if (current() && pc.connectionState === 'disconnected') {
          this._setDirect(false, 'ICE disconnected');
        }
      }, 2500);
    }
  });

  try {
    const offer = await pc.createOffer();
    if (!current()) return;
    await pc.setLocalDescription(offer);
    if (!current()) return;
    await this._waitIceGather(pc);
    if (!current()) return;
    if (!pc.localDescription) throw new Error('missing localDescription');
    if (this._signal !== signal || signal?.readyState !== 1) {
      throw new Error('signaling unavailable after ICE gather');
    }
    signal.send(JSON.stringify({
      __v3: 'offer',
      description: pc.localDescription,
      version: '3.0.1',
      rtcGeneration: generation,
    }));
    clearTimeout(this._v3RtcHandshakeTimer);
    this._v3RtcHandshakeTimer = setTimeout(() => {
      if (!current() || this._direct) return;
      this._rtcStarted = false;
      this._setDirect(false, 'WebRTC 协商超时，继续 Tunnel');
    }, RTC_HANDSHAKE_TIMEOUT_MS);
  } catch (err) {
    if (current()) this._rtcStarted = false;
    throw err;
  }
};

proto._acceptAnswer = async function generationAwareAcceptAnswer(description) {
  if (!description || this._closed) return;
  const answerGeneration = Number(description.v3Generation);
  if (Number.isFinite(answerGeneration) && answerGeneration !== Number(this._v3RtcGeneration || 0)) return;
  const pc = this._pc;
  if (!pc || pc.signalingState === 'closed') return;
  const answer = {
    type: description.type,
    sdp: description.sdp,
  };
  await pc.setRemoteDescription(answer);
};

proto._deliverApp = function directOnlyGameplayDelivery(data, transport) {
  const text = typeof data === 'string' ? data : this._decodeData?.(data);
  const packet = parsePacket(text);
  if (!packet || packet.__v3) return originalDeliverApp.call(this, data, transport);

  const endsGameplay = packetEndsGameplay(packet);
  const startsGameplay = packetStartsGameplay(packet);
  if (endsGameplay) {
    this._v3GameActive = false;
    clearDirectDeadline(this);
    setGameplayPaused(this, false);
  } else if (startsGameplay) {
    this._v3GameActive = true;
  }

  // The initial welcome/error envelope may use Tunnel. Once a match is active, every
  // authoritative gameplay packet must arrive over the WebRTC DataChannel.
  const initialEnvelope = packet.t === 'welcome' || packet.t === 'error';
  if (transport !== 'direct' && this._v3GameActive && !initialEnvelope) {
    armDirectDeadline(this, '检测到非直连游戏数据，正在重建 Server 直连');
    return;
  }

  const result = originalDeliverApp.call(this, data, transport);
  if (this._v3GameActive && !directStillHealthy(this)) {
    armDirectDeadline(this, '等待 Server 直连后继续游戏');
  }
  return result;
};

proto._markOpen = function patchedMarkOpen() {
  const result = originalMarkOpen.call(this);
  activeSockets.add(this);
  this._v3RtcRetryAttempt = 0;
  return result;
};

proto._finalClose = function patchedFinalClose(code = 1006, reason = '', wasClean = false) {
  const intentionallyClosing = this.readyState === HybridWebSocket.CLOSING;
  if (!intentionallyClosing && !this._closed && directStillHealthy(this)) {
    markBackupOffline(this);
    return;
  }
  clearRtcRetry(this);
  clearDirectDeadline(this);
  clearQualitySampler(this);
  setGameplayPaused(this, false);
  invalidateRtc(this);
  activeSockets.delete(this);
  return originalFinalClose.call(this, code, reason, wasClean);
};

proto._setDirect = async function patchedSetDirect(value, reason = '') {
  const wasDirect = !!this._direct;
  const result = await originalSetDirect.call(this, value, reason);
  if (value) {
    clearTimeout(this._v3RtcHandshakeTimer);
    this._v3RtcHandshakeTimer = null;
    clearRtcRetry(this);
    this._v3RtcRetryAttempt = 0;
    const diagnostics = window.__DTAM_V3_TRANSPORT__;
    if (diagnostics) diagnostics.backup = this._signal?.readyState === 1 ? 'online' : 'offline';
    clearDirectDeadline(this);
    setGameplayPaused(this, false);
    startQualitySampler(this);
    return result;
  }

  clearQualitySampler(this);
  const diagnostics = window.__DTAM_V3_TRANSPORT__;
  if (diagnostics) diagnostics.rttMs = NaN;
  if (this._v3GameActive) armDirectDeadline(this, reason || 'Server 直连中断，正在重建');

  // Closing the previous generation causes the server to announce fallback before the new
  // non-trickle offer has necessarily finished gathering. Do not restart the replacement
  // from that stale signal. A real current-generation negotiation failure is covered by
  // local ICE failure/error callbacks or the explicit handshake timeout above.
  const pcState = String(this._pc?.connectionState || '');
  if (!wasDirect && this._rtcStarted && (pcState === 'new' || pcState === 'connecting')) {
    return result;
  }

  if (!this._closed && signalAvailable(this)) {
    scheduleRtcRetry(this, wasDirect ? 'direct-path-changed' : 'initial-ice-failed');
    return result;
  }

  if (wasDirect && !this._closed) {
    const legacyOkay = this._legacy?.readyState === 1;
    if (!legacyOkay) {
      originalFinalClose.call(this, 1006, 'direct and fallback transports unavailable', false);
    }
  }
  return result;
};

proto.send = function patchedSend(data) {
  const packet = parsePacket(data);
  const type = typeof packet?.t === 'string' ? packet.t : '';
  if (type === 'pos') this._v3LastPositionPacket = data;

  const gameplayPacket = !!this._v3GameActive || type === 'start';
  if (gameplayPacket) {
    if (!directStillHealthy(this)) {
      if (type === 'leave' && signalAvailable(this)) return originalSend.call(this, data);
      armDirectDeadline(this, type === 'start' ? '所有玩家完成 Server 直连后才能开始' : 'Server 直连中断，游戏已暂停');
      scheduleRtcRetry(this, 'direct-required-gameplay', true);
      throw new DOMException('Server direct transport required', 'NetworkError');
    }

    // Keep proximity-sensitive actions and the exact position they depend on on the same
    // reliable ordered channel. No Tunnel fallback is permitted after gameplay begins.
    if (POSITION_SYNC_TYPES.has(type)) {
      const position = this._v3LastPositionPacket;
      const control = this._control;
      if (control?.readyState === 'open' && control.bufferedAmount < 524288) {
        try {
          if (position) control.send(position);
          control.send(data);
          return;
        } catch (_) {}
      }
      this._setDirect(false, '可靠 DataChannel 写入失败');
      throw new DOMException('Server direct control channel unavailable', 'NetworkError');
    }

    if ((type === 'pos' || type === 'ping') && this._fast?.readyState === 'open') {
      if (this._fast.bufferedAmount < 65536) {
        this._fast.send(data);
        return;
      }
      if (type === 'pos' || type === 'ping') return;
    }

    if (this._control?.readyState === 'open' && this._control.bufferedAmount < 524288) {
      this._control.send(data);
      return;
    }

    this._setDirect(false, 'DataChannel 写入失败');
    throw new DOMException('Server direct transport unavailable', 'NetworkError');
  }

  // v2.8 intentionally flushes position immediately before proximity-sensitive actions.
  // Two DataChannels would otherwise lose the original WebSocket ordering guarantee, so in
  // direct mode the latest position + action are sent on the same reliable control stream.
  if (this._direct && POSITION_SYNC_TYPES.has(type)) {
    const position = this._v3LastPositionPacket;
    const control = this._control;
    if (control?.readyState === 'open' && control.bufferedAmount < 524288) {
      try {
        if (position) control.send(position);
        control.send(data);
        return;
      } catch (_) {
        // Keep both packets on the same fallback stream if the control stream rejected them.
      }
    }

    this._setDirect(false, '可靠 DataChannel 写入失败');
    throw new DOMException('Server direct control channel unavailable', 'NetworkError');
  }

  return originalSend.call(this, data);
};

proto.close = function patchedClose(code = 1000, reason = '') {
  clearRtcRetry(this);
  clearDirectDeadline(this);
  clearQualitySampler(this);
  setGameplayPaused(this, false);
  invalidateRtc(this);
  activeSockets.delete(this);
  return originalClose.call(this, code, reason);
};

function refreshAllRtc(trigger) {
  for (const socket of activeSockets) {
    if (!socket._closed && signalAvailable(socket)) {
      scheduleRtcRetry(socket, trigger, true);
    }
  }
}

window.addEventListener('online', () => refreshAllRtc('browser-online'));
window.addEventListener('pageshow', event => {
  if (event.persisted) refreshAllRtc('page-restored');
});

console.log('DTAM v3 transport resilience enabled · generation-fenced dynamic ICE + ordered action sync');
})();
