const STORAGE_MODE = 'au-dtam-net-mode';
const STORAGE_SERVER = 'au-dtam-server-url';
const DEFAULT_SERVER = 'wss://rt-d1.lunarlab.uk/ws';
const MODES = new Set(['auto', 'p2p', 'server']);

function safeGet(key, fallback = '') {
  try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}
function debugUiEnabled() {
  const query = new URLSearchParams(location.search);
  return query.get('debug') === '1' || safeGet('au-dtam-debug', '') === '1';
}

export function normalizeServerUrl(value = DEFAULT_SERVER) {
  let raw = String(value || '').trim() || DEFAULT_SERVER;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'wss://' + raw;
  raw = raw.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
  const url = new URL(raw);
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Server 必须使用 ws:// 或 wss://');
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (location.protocol === 'https:' && url.protocol === 'ws:' && !local) throw new Error('HTTPS 页面只能连接远端 wss:// Server');
  if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
  url.hash = '';
  return url.href;
}

export function getNetworkConfig() {
  const query = new URLSearchParams(location.search);
  const qMode = String(query.get('transport') || '').toLowerCase();
  const savedMode = safeGet(STORAGE_MODE, 'auto');
  const mode = MODES.has(qMode) ? qMode : (MODES.has(savedMode) ? savedMode : 'auto');
  const rawServer = query.get('server') || safeGet(STORAGE_SERVER, DEFAULT_SERVER) || DEFAULT_SERVER;
  let serverUrl = DEFAULT_SERVER;
  let serverError = '';
  try { serverUrl = normalizeServerUrl(rawServer); }
  catch (error) { serverError = String(error?.message || error); }
  return { mode, serverUrl, serverError };
}

export function serverTargetFor(originalUrl, configuredUrl) {
  const original = new URL(String(originalUrl), location.href);
  const target = new URL(normalizeServerUrl(configuredUrl));
  target.search = original.search;
  target.hash = '';
  return target.href;
}

export function describeNetworkMode(config = getNetworkConfig()) {
  if (config.mode === 'server') return 'Server';
  if (config.mode === 'p2p') return '仅 P2P';
  return 'Auto';
}

function injectNetworkPanel() {
  if (!debugUiEnabled()) return;
  document.documentElement.classList.add('dtam-debug');
  const card = document.querySelector('#menu .card');
  if (!card || document.getElementById('networkMode')) return;
  const profile = card.querySelector('.profile-picker');
  const wrap = document.createElement('details');
  wrap.id = 'networkPanel';
  wrap.className = 'network-panel';
  wrap.innerHTML = `
    <summary>开发者网络设置</summary>
    <div class="network-panel-head"><strong>联机方式</strong><span id="networkModeHint"></span></div>
    <div class="network-grid">
      <label class="field network-field"><span>模式</span><select id="networkMode">
        <option value="auto">Auto</option>
        <option value="p2p">仅 P2P</option>
        <option value="server">Server</option>
      </select></label>
      <label class="field network-field" id="serverUrlField"><span>Server WebSocket</span><input id="serverUrlInput" type="url" inputmode="url" autocomplete="url" spellcheck="false" placeholder="wss://example.com/ws" /></label>
    </div>
    <div class="network-actions"><button type="button" class="btn btn-outline profile-btn" id="serverResetBtn">恢复默认 Server</button><small id="serverValidation"></small></div>
    <small class="network-note">仅用于联机调试。普通玩家默认使用 Auto。</small>`;
  if (profile) profile.insertAdjacentElement('afterend', wrap); else card.prepend(wrap);

  const modeEl = document.getElementById('networkMode');
  const serverEl = document.getElementById('serverUrlInput');
  const fieldEl = document.getElementById('serverUrlField');
  const hintEl = document.getElementById('networkModeHint');
  const validationEl = document.getElementById('serverValidation');
  const resetEl = document.getElementById('serverResetBtn');
  const initial = getNetworkConfig();
  modeEl.value = initial.mode;
  serverEl.value = initial.serverUrl;

  const validate = () => {
    let error = '';
    try {
      const normalized = normalizeServerUrl(serverEl.value);
      validationEl.textContent = normalized;
      validationEl.dataset.state = 'ok';
    } catch (e) {
      error = String(e?.message || e);
      validationEl.textContent = error;
      validationEl.dataset.state = 'error';
    }
    return !error;
  };
  const sync = () => {
    const mode = MODES.has(modeEl.value) ? modeEl.value : 'auto';
    safeSet(STORAGE_MODE, mode);
    if (validate()) {
      const normalized = normalizeServerUrl(serverEl.value);
      serverEl.value = normalized;
      safeSet(STORAGE_SERVER, normalized);
    }
    fieldEl.classList.toggle('network-muted', mode !== 'server');
    serverEl.disabled = mode !== 'server';
    resetEl.disabled = mode !== 'server';
    hintEl.textContent = mode;
    window.dispatchEvent(new CustomEvent('dtam-network-config', { detail: getNetworkConfig() }));
  };
  modeEl.addEventListener('change', sync);
  serverEl.addEventListener('change', sync);
  serverEl.addEventListener('blur', validate);
  resetEl.addEventListener('click', () => { serverEl.value = DEFAULT_SERVER; sync(); });
  sync();

  const style = document.createElement('style');
  style.textContent = `
    #networkPanel{margin:12px 0;padding:10px 12px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:12px;background:color-mix(in srgb,currentColor 4%,transparent)}
    #networkPanel>summary{cursor:pointer;font-size:12px;font-weight:700;opacity:.75}
    .network-panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:10px 0 8px}.network-panel-head span{font-size:12px;opacity:.7}
    .network-grid{display:grid;grid-template-columns:minmax(170px,.8fr) minmax(220px,1.4fr);gap:10px}.network-field{margin:0!important}.network-field span{display:block;font-size:12px;opacity:.72;margin-bottom:5px}
    .network-field select,.network-field input{width:100%;box-sizing:border-box}.network-muted{opacity:.45}.network-muted input:disabled{cursor:not-allowed}.network-actions{display:flex;align-items:center;gap:10px;margin-top:8px;min-height:28px}.network-actions small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.68}.network-actions small[data-state="error"]{color:#ef4444;opacity:1}.network-note{display:block;margin-top:6px;opacity:.65;line-height:1.45}
    @media(max-width:640px){.network-grid{grid-template-columns:1fr}.network-actions{align-items:flex-start;flex-direction:column}.network-actions small{white-space:normal}}
  `;
  document.head.appendChild(style);
}

if (debugUiEnabled()) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectNetworkPanel, { once: true });
  else injectNetworkPanel();
}

export { DEFAULT_SERVER };