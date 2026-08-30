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
    return nativeClose.apply(this, args);
  };

  Object.defineProperty(proto, '__dtamExplicitCloseGuard', { value:true, configurable:false });
}

console.log('DTAM explicit RTCPeerConnection close guard ready');
