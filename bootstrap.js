// Install each transport wrapper before the game can create a socket. Keep the
// authority patches on the same GameRoom module instance as the actual host.
const modules = [
  './net-config.js?v=20260824-direct-m3e1',
  './signal-budget.js?v=20261006-playfix2',
  './runtime-policy.js?v=20261006-playfix2',
  './p2p-game-room-patch.js?v=20261006-playfix2',
  './p2p-authority-clock.js?v=20261006-playfix2',
  './voice-pc-close-guard.js?v=20260830-voice1',
  './p2p-doorbell-bootstrap.js?v=20260908-v301net2',
  './hybrid-transport.js?v=20261006-playfix2',
  './p2p-resilience.js?v=20261006-playfix2',
  './p2p-doorbell-host.js?v=20260908-v301net2',
  './p2p-stability-guard.js?v=20260830-stability1',
  './game.js?v=20261006-playfix2',
  './game-polish.js?v=20260918-archmusic1',
  './minimap-hud.js?v=20260908-v301perf1',
  './minimap-hud-refresh.js?v=20260830-minimap2',
  './runtime-guard.js?v=20260830-joinbudget1',
];
try {
  for (const module of modules) await import(module);
  window.__DTAM_BOOT_READY__ = true;
} catch (error) {
  console.error('[DTAM startup]', error);
  const status = document.getElementById('menuStatus');
  if (status) {
    status.textContent = '游戏加载失败，请刷新页面重试';
    status.className = 'error';
  }
  for (const id of ['createRoomBtn', 'joinRoomBtn']) {
    const button = document.getElementById(id);
    if (button) button.disabled = true;
  }
}
