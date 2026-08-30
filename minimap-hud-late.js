let installing = false;

async function installWhenReady() {
  if (installing || document.getElementById('dtamMiniHud')) return true;
  if (!document.getElementById('minimapOverlay')) return false;
  installing = true;
  try {
    // The first minimap-hud module may execute while hybrid-transport is still
    // awaiting game.js. Importing it under a second module URL re-runs only the
    // DOM installer; its WebSocket tap is protected by a global one-time flag.
    await import('./minimap-hud.js?v=20260830-minimap1&late=1');
    try { window.dispatchEvent(new Event('resize')); } catch (_) {}
    return !!document.getElementById('dtamMiniHud');
  } catch (error) {
    console.warn('[DTAM minimap late install]', error);
    return false;
  } finally {
    installing = false;
  }
}

if (!(await installWhenReady())) {
  const observer = new MutationObserver(async () => {
    if (await installWhenReady()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
}

console.log('DTAM minimap late installer ready');
