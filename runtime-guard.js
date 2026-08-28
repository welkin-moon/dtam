const TASK_LOAD_TIMEOUT_MS = 6000;

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
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear(); else arm();
  });
}

function installVoiceErrorCopy() {
  const toast = document.getElementById('gameToast');
  if (!toast) return;
  const rewrite = () => {
    const text = String(toast.textContent || '');
    if (/Too many voice sessions|voice_rate_limited/i.test(text)) {
      toast.textContent = '语音重连过于频繁，请稍等片刻再试';
    } else if (/voice unavailable|语音服务 503/i.test(text)) {
      toast.textContent = '语音服务暂时不可用，游戏联机不受影响';
    } else if (/Voice track unavailable|voice_track_pending/i.test(text)) {
      toast.textContent = '正在等待对方语音连接，请稍后重试';
    }
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
    // Keys are <sessionId>|<trackName>. A transport rebuild may leave an old
    // session for the same physical remote track alive after the replacement
    // session arrives. Keep the newest DOM node for each trackName.
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
  const queue = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(prune);
  };
  new MutationObserver(queue).observe(sink, { childList:true });
  queue();
}

function clearStaticLobbyToast() {
  const toast = document.getElementById('gameToast');
  if (!toast) return;
  const clear = () => {
    if (!toast.classList.contains('show') && String(toast.textContent || '').trim() === '等待玩家加入…') {
      toast.textContent = '';
    }
  };
  clear();
  new MutationObserver(clear).observe(toast, { attributes:true, attributeFilter:['class'] });
}

function boot() {
  installTaskLoadGuard();
  installVoiceErrorCopy();
  installVoiceSinkDeduper();
  clearStaticLobbyToast();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
else boot();
