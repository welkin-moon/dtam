const BaseWebSocket = window.WebSocket;
const STALE_GRACE_MS = 45000;

const stats = window.__DTAM_STABILITY_GUARD__ = window.__DTAM_STABILITY_GUARD__ || {
  patchedSockets: 0,
  suppressedStaleCloses: 0,
  sessionTakeovers: 0,
  lastInboundAt: 0,
  lastStaleAgeMs: 0,
};

function setDiag(extra) {
  Object.assign(window.__DTAM_NET__ || (window.__DTAM_NET__ = {}), extra);
  try { window.dispatchEvent(new CustomEvent('dtam-network-quality', { detail:{ ...window.__DTAM_NET__ } })); } catch (_) {}
}

function showTakeoverNotice() {
  const game = document.getElementById('game');
  const menu = document.getElementById('menu');
  const menuStatus = document.getElementById('menuStatus');
  const connection = document.getElementById('connectionStatus');
  const toast = document.getElementById('gameToast');

  // Do not call the game's normal leave path here: it clears the shared resume
  // token that the newly-active tab/device needs for future recovery.
  if (game) game.style.display = 'none';
  if (menu) menu.style.display = 'flex';
  window._gameLoopRunning = false;

  const applyCopy = () => {
    if (menuStatus) {
      menuStatus.textContent = '这个玩家已在另一个页面或设备接管；当前页面已停止自动重连';
      menuStatus.className = 'error';
    }
    if (connection) {
      connection.textContent = '已被接管';
      connection.dataset.state = 'offline';
    }
    if (toast) {
      toast.textContent = '连接已由另一个页面接管';
      toast.classList.add('show');
    }
  };
  applyCopy();
  // game.js handles the close event synchronously and may rewrite the small
  // connection badge; restore the more useful takeover copy afterwards.
  setTimeout(applyCopy, 0);
}

function patchSocket(sock) {
  if (!sock || typeof sock !== 'object' || sock.__dtamStabilityGuard) return sock;
  Object.defineProperty(sock, '__dtamStabilityGuard', { value:true, configurable:false });
  stats.patchedSockets++;

  sock.__dtamLastInboundAt = Date.now();
  stats.lastInboundAt = sock.__dtamLastInboundAt;

  if (typeof sock.deliver === 'function') {
    const originalDeliver = sock.deliver.bind(sock);
    sock.deliver = function guardedDeliver(...args) {
      this.__dtamLastInboundAt = Date.now();
      stats.lastInboundAt = this.__dtamLastInboundAt;
      return originalDeliver(...args);
    };
  } else if (typeof sock.addEventListener === 'function') {
    sock.addEventListener('message', () => {
      sock.__dtamLastInboundAt = Date.now();
      stats.lastInboundAt = sock.__dtamLastInboundAt;
    });
  }

  if (typeof sock.close === 'function') {
    const originalClose = sock.close.bind(sock);
    sock.close = function guardedClose(code = 1000, reason = '') {
      if (Number(code) === 4001 && String(reason) === 'stale') {
        const age = Date.now() - Number(this.__dtamLastInboundAt || 0);
        stats.lastStaleAgeMs = age;
        // game.js starts suspecting a stale link after 15 s. WebRTC already has
        // ICE consent/channel failure detection, so give the app-layer heartbeat
        // another 30 s before it is allowed to tear down an otherwise-live link.
        // Any inbound packet resets this grace period.
        if (age < STALE_GRACE_MS) {
          stats.suppressedStaleCloses++;
          setDiag({ heartbeatGrace:true, heartbeatAgeMs:age, lastError:'' });
          return;
        }
      }
      return originalClose(code, reason);
    };
  }

  if (typeof sock.finish === 'function') {
    const originalFinish = sock.finish.bind(sock);
    sock.finish = function guardedFinish(code = 1006, reason = '', clean = false) {
      const takeover = Number(code) === 4002 && /replaced|takeover|superseded/i.test(String(reason));
      if (takeover) {
        stats.sessionTakeovers++;
        setDiag({ sessionReplaced:true, recovering:false, lastError:'session taken over by another page' });
        showTakeoverNotice();
      }
      return originalFinish(code, reason, clean);
    };
  }

  return sock;
}

if (typeof BaseWebSocket === 'function' && !window.__DTAM_STABILITY_WS_INSTALLED__) {
  window.__DTAM_STABILITY_WS_INSTALLED__ = true;
  const WrappedWebSocket = new Proxy(BaseWebSocket, {
    construct(Target, args) {
      return patchSocket(Reflect.construct(Target, args, Target));
    }
  });
  for (const key of ['CONNECTING','OPEN','CLOSING','CLOSED']) {
    try { Object.defineProperty(WrappedWebSocket, key, { value:BaseWebSocket[key] }); } catch (_) {}
  }
  window.WebSocket = WrappedWebSocket;
}

console.log('DTAM P2P stability guard ready');
