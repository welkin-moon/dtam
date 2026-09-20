(() => {
  const startedAt = Date.now();
  const errors = [];
  const mark = (kind, value) => errors.push({ kind, value: String(value || '') });
  addEventListener('error', e => mark('error', e.message || e.error));
  addEventListener('unhandledrejection', e => mark('rejection', e.reason?.stack || e.reason));

  const el = id => document.getElementById(id);
  const snapshot = stage => ({
    stage,
    atMs: Date.now() - startedAt,
    readyState: document.readyState,
    menuStatus: el('menuStatus')?.textContent || '',
    menuDisplay: getComputedStyle(el('menu')).display,
    gameDisplay: getComputedStyle(el('game')).display,
    room: el('roomIdDisplay')?.textContent || '',
    connection: el('connectionStatus')?.textContent || '',
    transport: el('p2pTransportStatus')?.textContent || '',
    createDisabled: !!el('createRoomBtn')?.disabled,
    createOnclick: typeof el('createRoomBtn')?.onclick,
    net: window.__DTAM_NET__ || null,
    errors: [...errors]
  });

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const done = result => {
    let out = el('dtam-browser-probe');
    if (!out) {
      out = document.createElement('pre');
      out.id = 'dtam-browser-probe';
      out.style.cssText = 'position:fixed;z-index:999999;inset:auto 8px 8px 8px;max-height:45vh;overflow:auto;background:#111;color:#fff;padding:10px;font:12px monospace;white-space:pre-wrap';
      document.body.appendChild(out);
    }
    out.textContent = JSON.stringify(result);
    document.documentElement.dataset.dtamProbe = 'done';
  };

  (async () => {
    const before = snapshot('before');
    let manifest = null;
    try {
      const r = await fetch('/assets/music/manifest.json', { cache: 'no-store' });
      manifest = { status: r.status, ok: r.ok, body: await r.json().catch(() => null) };
    } catch (e) {
      manifest = { error: String(e) };
    }

    try {
      const input = el('playerNameInput');
      if (input) {
        input.value = 'Probe';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      el('createRoomBtn')?.click();
    } catch (e) {
      mark('click', e?.stack || e);
    }

    for (let i = 0; i < 28; i++) {
      await wait(500);
      if (getComputedStyle(el('game')).display !== 'none') break;
      if (['连接失败', '连接超时，请稍后重试'].some(x => (el('menuStatus')?.textContent || '').includes(x))) break;
    }

    done({ before, after: snapshot('after'), manifest });
  })().catch(e => done({ fatal: String(e?.stack || e), errors }));
})();
