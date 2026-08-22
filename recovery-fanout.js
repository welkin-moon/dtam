const PC = window.RTCPeerConnection;
if (typeof PC === 'function') {
  const nativeCreate = PC.prototype.createDataChannel;
  const nativeSend = RTCDataChannel.prototype.send;
  const controls = new Set();

  function dropClosed() {
    for (const ch of controls) if (ch.readyState === 'closed') controls.delete(ch);
  }

  PC.prototype.createDataChannel = function patchedCreateDataChannel(label, options) {
    const ch = nativeCreate.call(this, label, options);
    if (label === 'dtam-control') {
      controls.add(ch);
      ch.addEventListener('close', () => controls.delete(ch), { once: true });
    }
    return ch;
  };

  RTCDataChannel.prototype.send = function recoveryAwareSend(data) {
    if (this.label === 'dtam-control' && typeof data === 'string' && data.includes('__dtamRecovery')) {
      try {
        const packet = JSON.parse(data);
        if (packet?.__dtamRecovery && packet.recoveryToken) {
          dropClosed();
          const meta = JSON.stringify({
            __dtamRecovery: true,
            recoveryToken: String(packet.recoveryToken),
            epoch: Number(packet.epoch || 1),
          });
          for (const ch of controls) {
            if (ch !== this && ch.readyState === 'open') {
              try { nativeSend.call(ch, meta); } catch (_) {}
            }
          }
        }
      } catch (_) {}
    }
    return nativeSend.call(this, data);
  };
}
