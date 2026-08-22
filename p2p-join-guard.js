const NativeSend = window.RTCDataChannel?.prototype?.send;
if (typeof NativeSend === 'function' && !window.__DTAM_JOIN_GUARD__) {
  window.__DTAM_JOIN_GUARD__ = true;
  window.RTCDataChannel.prototype.send = function guardedSend(data) {
    if (typeof data === 'string' && data.includes('"__dtamJoin":true')) {
      const channel = this;
      setTimeout(() => {
        if (channel.readyState !== 'open') return;
        try { NativeSend.call(channel, data); } catch (_) {}
      }, 80);
      return;
    }
    return NativeSend.call(this, data);
  };
}
