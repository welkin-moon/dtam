const PC = window.RTCPeerConnection;
const stats = window.__DTAM_PC_CLOSE_GUARD__ = window.__DTAM_PC_CLOSE_GUARD__ || {
  explicitCloses:0,
  suppressedCallbacks:0,
};

if (typeof PC === 'function' && !PC.prototype.__dtamExplicitCloseGuard) {
  const proto = PC.prototype;
  const nativeClose = proto.close;
  const nativeAdd = proto.addEventListener;
  const nativeRemove = proto.removeEventListener;
  const listenerMaps = new WeakMap();
  const guardedTypes = new Set(['connectionstatechange', 'iceconnectionstatechange']);

  function listenerMap(pc, type) {
    let byType = listenerMaps.get(pc);
    if (!byType) { byType = new Map(); listenerMaps.set(pc, byType); }
    let map = byType.get(type);
    if (!map) { map = new WeakMap(); byType.set(type, map); }
    return map;
  }

  proto.addEventListener = function dtamGuardedAddEventListener(type, listener, options) {
    if (!guardedTypes.has(String(type)) || (!listener || (typeof listener !== 'function' && typeof listener.handleEvent !== 'function'))) {
      return nativeAdd.call(this, type, listener, options);
    }
    const map = listenerMap(this, String(type));
    let wrapped = map.get(listener);
    if (!wrapped) {
      const pc = this;
      wrapped = function dtamConnectionListener(event) {
        if (pc.__dtamExplicitlyClosed) {
          stats.suppressedCallbacks++;
          return;
        }
        if (typeof listener === 'function') return listener.call(pc, event);
        return listener.handleEvent.call(listener, event);
      };
      map.set(listener, wrapped);
    }
    return nativeAdd.call(this, type, wrapped, options);
  };

  proto.removeEventListener = function dtamGuardedRemoveEventListener(type, listener, options) {
    if (guardedTypes.has(String(type)) && listener) {
      const wrapped = listenerMaps.get(this)?.get(String(type))?.get(listener);
      if (wrapped) return nativeRemove.call(this, type, wrapped, options);
    }
    return nativeRemove.call(this, type, listener, options);
  };

  proto.close = function dtamExplicitClose(...args) {
    this.__dtamExplicitlyClosed = true;
    stats.explicitCloses++;

    try {
      if (typeof this.getSenders === 'function') {
        const senders = this.getSenders() || [];
        for (const sender of senders) {
          try {
            if (sender?.track) {
              sender.track.stop();
            }
          } catch (_) {}
        }
      }
    } catch (_) {}

    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
    this.onicecandidate = null;
    this.onicecandidateerror = null;
    this.onsignalingstatechange = null;
    this.onicegatheringstatechange = null;
    this.ontrack = null;
    this.ondatachannel = null;
    this.onnegotiationneeded = null;

    return nativeClose.apply(this, args);
  };

  Object.defineProperty(proto, '__dtamExplicitCloseGuard', { value:true, configurable:false });
}

// ==========================================
// WebRTC Spatial Proximity Audio Engine
// ==========================================
const AudioCtxClass = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

class DtamSpatialAudioManager {
  constructor() {
    this.ctx = null;
    this.tracks = new Map(); // key -> { track, playerId, source, gainNode, pannerNode, audioEl, currentVolume }
    this.localState = { myPlayerId: '', pos: { x: 50, y: 50 }, alive: true };
    this.players = {};
    this.meetingPhase = false;
    this.phase = 'lobby';
    this.timer = null;
    this.CLIENT_TO_NETWORK = 150 / 100; // ratio mapping client coord to network grid
  }

  ensureContext() {
    if (!this.ctx && typeof AudioCtxClass === 'function') {
      try {
        this.ctx = new AudioCtxClass();
      } catch (e) {
        console.warn('[SpatialAudio] AudioContext init error', e);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  registerTrack(key, track, playerId, audioEl) {
    this.ensureContext();
    if (this.tracks.has(key)) {
      this.unregisterTrack(key);
    }

    if (!this.ctx || !track) {
      if (audioEl) {
        audioEl.muted = false;
        audioEl.volume = 1.0;
      }
      return;
    }

    try {
      const stream = new MediaStream([track]);
      const source = this.ctx.createMediaStreamSource(stream);
      const gainNode = this.ctx.createGain();
      gainNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

      let pannerNode = null;
      if (typeof this.ctx.createPanner === 'function') {
        pannerNode = this.ctx.createPanner();
        pannerNode.panningModel = 'HRTF';
        pannerNode.distanceModel = 'linear';
        pannerNode.refDistance = 1;
        pannerNode.maxDistance = 100;
        pannerNode.rolloffFactor = 1;
        if (pannerNode.positionX) {
          pannerNode.positionX.setValueAtTime(0, this.ctx.currentTime);
          pannerNode.positionY.setValueAtTime(0, this.ctx.currentTime);
          pannerNode.positionZ.setValueAtTime(-0.5, this.ctx.currentTime);
        } else if (typeof pannerNode.setPosition === 'function') {
          pannerNode.setPosition(0, 0, -0.5);
        }
      }

      if (pannerNode) {
        source.connect(gainNode);
        gainNode.connect(pannerNode);
        pannerNode.connect(this.ctx.destination);
      } else {
        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);
      }

      // Mute the raw audio element so sound is rendered exclusively through Web Audio spatial graph
      if (audioEl) {
        audioEl.muted = true;
        audioEl.volume = 0;
      }

      this.tracks.set(key, {
        track,
        playerId: String(playerId || ''),
        source,
        gainNode,
        pannerNode,
        audioEl,
        currentVolume: 1.0
      });

      this.startLoop();
      this.applyProximity();
    } catch (e) {
      console.warn('[SpatialAudio] setup failed, fallback to element audio:', e);
      if (audioEl) {
        audioEl.muted = false;
        audioEl.volume = 1.0;
      }
    }
  }

  unregisterTrack(key) {
    const item = this.tracks.get(key);
    if (!item) return;
    this.tracks.delete(key);
    try {
      item.source?.disconnect();
      item.gainNode?.disconnect();
      item.pannerNode?.disconnect();
    } catch (_) {}
    if (this.tracks.size === 0) {
      this.stopLoop();
    }
  }

  clear() {
    for (const [key] of this.tracks) {
      this.unregisterTrack(key);
    }
    this.tracks.clear();
    this.stopLoop();
  }

  updateState({ myPlayerId, myPos, players, gameState, selfState }) {
    if (myPlayerId) this.localState.myPlayerId = myPlayerId;
    if (myPos && Number.isFinite(myPos.x) && Number.isFinite(myPos.y)) {
      this.localState.pos = { x: myPos.x, y: myPos.y };
    }
    if (selfState) {
      this.localState.alive = selfState.alive !== false;
    }
    if (players) {
      this.players = players;
    }
    if (gameState) {
      this.phase = gameState.phase || 'lobby';
      this.meetingPhase = (gameState.phase === 'meeting') || !!gameState.meeting;
    }
    this.applyProximity();
  }

  calculateVolumeAndPan(item) {
    // 1. Meeting Phase: Automatically reset to 100% volume without attenuation
    if (this.meetingPhase) {
      return { volume: 1.0, panX: 0, panY: 0 };
    }

    // In lobby or ended phase: 100% volume
    if (this.phase === 'lobby' || this.phase === 'ended') {
      return { volume: 1.0, panX: 0, panY: 0 };
    }

    const speaker = this.players[item.playerId];
    const listenerAlive = this.localState.alive;
    const speakerAlive = speaker ? (speaker.alive !== false) : true;

    // 2. Ghost isolation: Dead players are muted to alive players. Ghosts can hear each other.
    if (!speakerAlive && listenerAlive) {
      return { volume: 0.0, panX: 0, panY: 0 };
    }

    const myPos = this.localState.pos;
    const targetPos = speaker?.pos || myPos;

    // Distance in actual map grid units
    const clientDist = Math.hypot(targetPos.x - myPos.x, targetPos.y - myPos.y);
    const gridDist = clientDist * this.CLIENT_TO_NETWORK;

    // 3. Proximity Attenuation rules:
    // - distance < 2.5 grids: 100% volume
    // - 2.5 ~ 6 grids: linear smooth decay down to 15%
    // - > 6 grids: completely mute (0%)
    let volume = 1.0;
    if (gridDist < 2.5) {
      volume = 1.0;
    } else if (gridDist <= 6.0) {
      const progress = (gridDist - 2.5) / (6.0 - 2.5); // 0 to 1
      volume = 1.0 - progress * (1.0 - 0.15); // decays from 1.0 to 0.15
    } else {
      volume = 0.0;
    }

    // 2D Spatial Positioning
    const dx = (targetPos.x - myPos.x) * this.CLIENT_TO_NETWORK;
    const dy = (targetPos.y - myPos.y) * this.CLIENT_TO_NETWORK;
    const panX = Math.max(-10, Math.min(10, dx));
    const panY = Math.max(-10, Math.min(10, -dy));

    return { volume, panX, panY };
  }

  applyProximity() {
    if (!this.tracks.size) return;
    const now = this.ctx?.currentTime || 0;

    for (const [, item] of this.tracks.entries()) {
      const { volume, panX, panY } = this.calculateVolumeAndPan(item);
      item.currentVolume = volume;

      if (item.gainNode && this.ctx) {
        try {
          if (typeof item.gainNode.gain.setTargetAtTime === 'function') {
            item.gainNode.gain.setTargetAtTime(volume, now, 0.04);
          } else {
            item.gainNode.gain.setValueAtTime(volume, now);
          }
        } catch (_) {}
      }

      if (item.pannerNode && this.ctx) {
        try {
          if (item.pannerNode.positionX && typeof item.pannerNode.positionX.setTargetAtTime === 'function') {
            item.pannerNode.positionX.setTargetAtTime(panX, now, 0.05);
            item.pannerNode.positionY.setTargetAtTime(panY, now, 0.05);
            item.pannerNode.positionZ.setTargetAtTime(-0.5, now, 0.05);
          } else if (typeof item.pannerNode.setPosition === 'function') {
            item.pannerNode.setPosition(panX, panY, -0.5);
          }
        } catch (_) {}
      }

      // If audio element fallback is playing:
      if (item.audioEl && (!this.ctx || item.audioEl.muted === false)) {
        try { item.audioEl.volume = volume; } catch (_) {}
      }
    }
  }

  startLoop() {
    if (this.timer) return;
    this.timer = setInterval(() => this.applyProximity(), 60);
  }

  stopLoop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

window.__DTAM_SPATIAL_AUDIO__ = window.__DTAM_SPATIAL_AUDIO__ || new DtamSpatialAudioManager();

console.log('DTAM explicit RTCPeerConnection close guard & Spatial Proximity Audio ready');
