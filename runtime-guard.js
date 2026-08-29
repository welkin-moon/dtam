const TASK_LOAD_TIMEOUT_MS = 6000;
const ACTIVE_ROOM_KEY = 'au-dtam-active-room-v1';

function installVoiceFetchRetry() {
  if (window.__DTAM_VOICE_FETCH_RETRY__) return;
  window.__DTAM_VOICE_FETCH_RETRY__ = true;
  const baseFetch = window.fetch.bind(window);
  const retryable = (input, init = {}) => {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
      return url.hostname === 'voice.lunarlab.uk' &&
        (url.pathname.includes('/tracks/new') || url.pathname.includes('/renegotiate')) &&
        (method === 'POST' || method === 'PUT');
    } catch (_) { return false; }
  };
  window.fetch = async function voiceResilientFetch(input, init = {}) {
    try {
      return await baseFetch(input, init);
    } catch (firstError) {
      if (!retryable(input, init)) throw firstError;
      await new Promise(resolve => setTimeout(resolve, 650));
      try { return await baseFetch(input, init); }
      catch (_) { throw firstError; }
    }
  };
}

function installSameTabRoomResume() {
  const game = document.getElementById('game');
  const roomDisplay = document.getElementById('roomIdDisplay');
  const nameInput = document.getElementById('playerNameInput');
  const showJoin = document.getElementById('showJoinBtn');
  const roomInput = document.getElementById('roomIdInput');
  const join = document.getElementById('joinRoomBtn');
  const leave = document.getElementById('leaveBtn');
  if (!game || !roomDisplay || !nameInput || !showJoin || !roomInput || !join) return;

  const clear = () => { try { sessionStorage.removeItem(ACTIVE_ROOM_KEY); } catch (_) {} };
  const save = () => {
    const room = String(roomDisplay.textContent || '').trim();
    const name = String(nameInput.value || '').trim();
    const inGame = getComputedStyle(game).display !== 'none';
    if (!inGame || !/^\d{2}$/.test(room) || !name) return;
    try { sessionStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify({ room, name, at:Date.now() })); } catch (_) {}
  };

  if (leave) leave.addEventListener('click', clear, { capture:true });
  new MutationObserver(save).observe(roomDisplay, { childList:true, subtree:true, characterData:true });
  new MutationObserver(save).observe(game, { attributes:true, attributeFilter:['style','class'] });
  setInterval(save, 4000);

  let active = null;
  try { active = JSON.parse(sessionStorage.getItem(ACTIVE_ROOM_KEY) || 'null'); } catch (_) {}
  if (!active || !/^\d{2}$/.test(String(active.room || '')) || !active.name || Date.now() - Number(active.at || 0) > 6 * 60 * 60 * 1000) {
    if (active) clear();
    save();
    return;
  }
  const tokenKey = 'au-dtam-resume:' + active.room + ':' + encodeURIComponent(String(active.name).trim().slice(0,12));
  let hasToken = false;
  try { hasToken = !!localStorage.getItem(tokenKey); } catch (_) {}
  if (!hasToken) { clear(); return; }

  setTimeout(() => {
    if (getComputedStyle(game).display !== 'none') return;
    nameInput.value = String(active.name).slice(0,12);
    nameInput.dispatchEvent(new Event('change', { bubbles:true }));
    if (getComputedStyle(document.getElementById('joinSection')).display === 'none') showJoin.click();
    roomInput.value = String(active.room);
    roomInput.dispatchEvent(new Event('input', { bubbles:true }));
    join.click();
  }, 120);
}

function installTaskLoadGuard() {
  const modal = document.getElementById('taskModal');
  const body = document.getElementById('taskModalBody');
  const cancel = document.getElementById('taskCancelBtn');
  const toast = document.getElementById('gameToast');
  if (!modal || !body || !cancel || !toast) return;
  let timer = null;
  const clear = () => { clearTimeout(timer); timer = null; };
  const loading = () => modal.classList.contains('show') && /正在获取任务内容/.test(String(body.textContent || ''));
  const arm = () => {
    clear();
    if (!loading()) return;
    timer = setTimeout(() => {
      timer = null;
      if (!loading()) return;
      cancel.click();
      toast.textContent = '任务内容获取超时，请靠近任务点后重试';
      toast.classList.add('show');
    }, TASK_LOAD_TIMEOUT_MS);
  };
  new MutationObserver(arm).observe(modal, { attributes:true, attributeFilter:['class'] });
  new MutationObserver(arm).observe(body, { childList:true, subtree:true, characterData:true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); else arm(); });
}

function installVoiceErrorCopy() {
  const toast = document.getElementById('gameToast');
  if (!toast) return;
  const rewrite = () => {
    const text = String(toast.textContent || '');
    if (/Too many voice sessions|voice_rate_limited/i.test(text)) toast.textContent = '语音重连过于频繁，请稍等片刻再试';
    else if (/voice unavailable|语音服务 503/i.test(text)) toast.textContent = '语音服务暂时不可用，游戏联机不受影响';
    else if (/Voice track unavailable|voice_track_pending/i.test(text)) toast.textContent = '正在等待对方语音连接，请稍后重试';
  };
  rewrite();
  new MutationObserver(rewrite).observe(toast, { childList:true, subtree:true, characterData:true });
}

function installVoiceSinkDeduper() {
  const sink = document.getElementById('voiceSink');
  if (!sink) return;
  let scheduled = false;
  const prune = () => {
    scheduled = false;
    const audios = [...sink.querySelectorAll('audio[data-voice-key]')];
    const newest = new Map();
    for (const audio of audios) {
      const key = String(audio.dataset.voiceKey || '');
      const split = key.indexOf('|');
      const track = split >= 0 ? key.slice(split + 1) : key;
      if (!track) continue;
      const previous = newest.get(track);
      if (previous && previous !== audio) {
        try { previous.pause(); } catch (_) {}
        try { previous.srcObject = null; } catch (_) {}
        previous.remove();
      }
      newest.set(track, audio);
    }
  };
  const queue = () => { if (!scheduled) { scheduled = true; queueMicrotask(prune); } };
  new MutationObserver(queue).observe(sink, { childList:true });
  queue();
}

function clearStaticLobbyToast() {
  const toast = document.getElementById('gameToast');
  if (!toast) return;
  const clear = () => {
    if (!toast.classList.contains('show') && String(toast.textContent || '').trim() === '等待玩家加入…') toast.textContent = '';
  };
  clear();
  new MutationObserver(clear).observe(toast, { attributes:true, attributeFilter:['class'] });
}

function boot() {
  installVoiceFetchRetry();
  installSameTabRoomResume();
  installTaskLoadGuard();
  installVoiceErrorCopy();
  installVoiceSinkDeduper();
  clearStaticLobbyToast();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
else boot();
