const RULE_KEY='au-dtam-rules-v2';
const RULE_IDS=['ruleNormalImpostors','ruleShapeshifters','rulePhantoms','ruleVipers','ruleEngineers','ruleScientists','ruleTrackers','ruleNoisemakers','ruleDetectives','ruleGuardianAngels','ruleTasks','ruleSpeed','ruleKill','ruleDiscussion','ruleVoting','ruleEmergency','ruleSabotage','ruleMusicControl','ruleConfirm'];
const DEBUG_UI=(()=>{try{const q=new URLSearchParams(location.search);return q.get('debug')==='1'||localStorage.getItem('au-dtam-debug')==='1'}catch(_){return false}})();
if(DEBUG_UI)document.documentElement.classList.add('dtam-debug');

function loadRules(){try{return JSON.parse(localStorage.getItem(RULE_KEY)||'null')}catch(_){return null}}
function saveRules(){const out={};for(const id of RULE_IDS){const el=document.getElementById(id);if(!el)continue;out[id]=el.type==='checkbox'?!!el.checked:el.value}try{localStorage.setItem(RULE_KEY,JSON.stringify(out))}catch(_){}}
function restoreRules(){const saved=loadRules();if(!saved)return;for(const [id,value] of Object.entries(saved)){const el=document.getElementById(id);if(!el)continue;if(el.type==='checkbox')el.checked=!!value;else if([...el.options||[]].some(o=>o.value===String(value)))el.value=String(value)}const first=document.getElementById('ruleNormalImpostors');if(first)first.dispatchEvent(new Event('change',{bubbles:true}))}
function installRulePersistence(){for(const id of RULE_IDS){const el=document.getElementById(id);if(el)el.addEventListener('change',saveRules)}restoreRules()}

function installHostVisibilityWarning(){
  let previousTitle=document.title;
  const apply=()=>{
    const mode=String(window.__DTAM_NET__?.mode||'');
    const host=mode==='browser-host'||mode==='p2p-recovered-host';
    if(document.hidden&&host){previousTitle=document.title;document.title='⚠ 房主请保持游戏页面前台 · '+previousTitle}
    else if(!document.hidden&&document.title.startsWith('⚠ 房主请保持游戏页面前台 · ')){document.title=previousTitle}
  };
  document.addEventListener('visibilitychange',apply);
}

let diagUpdateTimer=null;
let lastFocusedElement=null;

function escapeDiag(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}

function copyTextFallback(text){
  const field=document.createElement('textarea');
  field.value=text;
  field.setAttribute('readonly','');
  field.style.cssText='position:fixed;inset:auto auto 0 -9999px;opacity:0';
  document.body.appendChild(field);
  field.select();
  let copied=false;
  try{copied=document.execCommand('copy')}catch(_){}
  field.remove();
  return copied;
}

function ensureDiagDialog(){
  let overlay=document.getElementById('dtamDiagOverlay');
  if(overlay)return overlay;
  overlay=document.createElement('div');
  overlay.id='dtamDiagOverlay';
  overlay.className='dtam-diag-overlay';
  overlay.setAttribute('aria-hidden','true');
  overlay.setAttribute('role','presentation');

  overlay.innerHTML=`
    <div class="dtam-diag-card" role="dialog" aria-modal="true" aria-labelledby="dtamDiagTitle">
      <div class="dtam-diag-head">
        <div class="dtam-diag-title-wrap">
          <span class="dtam-diag-badge" id="dtamDiagBadge">在线</span>
          <h2 id="dtamDiagTitle">网络连接与诊断</h2>
        </div>
        <button type="button" class="dtam-diag-close" id="dtamDiagCloseBtn" aria-label="关闭诊断">×</button>
      </div>
      <div class="dtam-diag-body" id="dtamDiagBody"></div>
      <div class="dtam-diag-actions">
        <button type="button" class="btn btn-outline" id="dtamDiagCopyBtn">复制诊断数据</button>
        <button type="button" class="btn btn-primary" id="dtamDiagDismissBtn">完成</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeHandler=()=>closeDiagDialog();
  const closeBtn=overlay.querySelector('#dtamDiagCloseBtn');
  const dismissBtn=overlay.querySelector('#dtamDiagDismissBtn');
  const copyBtn=overlay.querySelector('#dtamDiagCopyBtn');

  if(closeBtn)closeBtn.onclick=closeHandler;
  if(dismissBtn)dismissBtn.onclick=closeHandler;
  overlay.onclick=e=>{if(e.target===overlay)closeHandler()};
  overlay.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      e.stopPropagation();
      closeHandler();
      return;
    }
    if(e.key==='Tab'){
      const focusable=[...overlay.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled&&el.offsetParent!==null);
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
    }
  });

  if(copyBtn){
    copyBtn.onclick=async()=>{
      const data=collectDiagnosticData();
      const text=formatDiagnosticText(data);
      try{
        await navigator.clipboard.writeText(text);
        copyBtn.textContent='已复制 ✓';
        setTimeout(()=>{copyBtn.textContent='复制诊断数据'},1500);
      }catch(_){
        if(copyTextFallback(text)){
          copyBtn.textContent='已复制 ✓';
          setTimeout(()=>{copyBtn.textContent='复制诊断数据'},1500);
        }else{
          copyBtn.textContent='复制失败，请重试';
          setTimeout(()=>{copyBtn.textContent='复制诊断数据'},1800);
        }
      }
    };
  }

  return overlay;
}

function collectDiagnosticData(){
  const d=window.__DTAM_NET__||{};
  const v3=window.__DTAM_V3_TRANSPORT__||{};
  const c=d.configured||{};
  const b=window.__DTAM_SIGNAL_BUDGET__||{};
  const latencyEl=document.getElementById('latencyStatus');
  const connEl=document.getElementById('connectionStatus');
  const roomEl=document.getElementById('roomIdDisplay');
  const countEl=document.getElementById('playerCountNum');

  const latencyText=latencyEl?(latencyEl.textContent||'').trim():'-- ms';
  const latencyQuality=latencyEl?latencyEl.getAttribute('data-quality')||'unknown':'unknown';
  const connState=connEl?connEl.getAttribute('data-state')||'offline':'offline';
  const connText=connEl?(connEl.textContent||'').trim():'未知';
  const roomCode=roomEl?(roomEl.textContent||'').trim():'--';
  const playerCount=countEl?(countEl.textContent||'').trim():'1';

  const currentMode=v3.direct?(v3.label||'Server 直连'):d.relay?'Cloudflare TURN 中继':(d.mode||'自动探测 / 直连');
  const configMode=c.mode||'auto';
  const icePair=v3.candidate||d.pair||(d.relay?'TURN Relay':v3.direct?'WebRTC DataChannel':'Host P2P / Server');
  const voiceBackend=d.voiceBackend||'WebRTC Audio';
  const reqCount=Number.isFinite(b.networkRequests)?b.networkRequests:'--';
  const suppressed=Number.isFinite(b.suppressedPolls)?b.suppressedPolls:'--';
  const pollInterval=Number.isFinite(b.currentIntervalMs)?`${(b.currentIntervalMs/1000).toFixed(1)}s`:'--';
  const lastError=d.lastError||'';
  const recovering=!!d.recovering;

  return {
    roomCode,
    playerCount,
    latencyText,
    latencyQuality,
    connState,
    connText,
    configMode,
    currentMode,
    icePair,
    voiceBackend,
    serverUrl:c.serverUrl||'',
    reqCount,
    suppressed,
    pollInterval,
    lastError,
    recovering,
    directRequired:v3.directRequired===true,
    direct:v3.direct===true,
    time:new Date().toLocaleTimeString()
  };
}

function formatDiagnosticText(data){
  return [
    `=== Among Us 东滩版 网络诊断报告 ===`,
    `时间：${data.time}`,
    `房间号：${data.roomCode} | 在线玩家：${data.playerCount}`,
    `连接状态：${data.connText} (${data.connState})`,
    `网络延迟：${data.latencyText} [${data.latencyQuality}]`,
    `配置模式：${data.configMode}`,
    `运行线路：${data.currentMode}`,
    `ICE 配对：${data.icePair}`,
    `语音通道：${data.voiceBackend}`,
    data.serverUrl?`服务器地址：${data.serverUrl}`:'',
    `信令实际请求：${data.reqCount}`,
    `省略空轮询：${data.suppressed}`,
    `轮询间隔：${data.pollInterval}`,
    data.recovering?`状态：房主迁移中`:'',
    data.lastError?`最近异常：${data.lastError}`:'异常监控：正常'
  ].filter(Boolean).join('\n');
}

function renderDiagBody(data){
  const body=document.getElementById('dtamDiagBody');
  const badge=document.getElementById('dtamDiagBadge');
  if(!body)return;

  if(badge){
    badge.textContent=data.connState==='online'?'连接正常':(data.connState==='connecting'?'正在连接':'已断开');
    badge.setAttribute('data-state',data.connState);
  }

  const getQualityText=(q)=>{
    switch(q){
      case 'good':return '极佳';
      case 'fair':return '良好';
      case 'poor':return '稍慢';
      case 'bad':return '高延迟';
      default:return '检测中';
    }
  };

  const latency=escapeDiag(data.latencyText),room=escapeDiag(data.roomCode),count=escapeDiag(data.playerCount),configMode=escapeDiag(data.configMode),currentMode=escapeDiag(data.currentMode),icePair=escapeDiag(data.icePair),voiceBackend=escapeDiag(data.voiceBackend),reqCount=escapeDiag(data.reqCount),suppressed=escapeDiag(data.suppressed),pollInterval=escapeDiag(data.pollInterval),lastError=escapeDiag(data.lastError);
  body.innerHTML=`
    <div class="dtam-diag-highlight">
      <div class="dtam-diag-stat">
        <span class="dtam-diag-stat-label">网络往返延迟 (RTT)</span>
        <div class="dtam-diag-stat-value" data-quality="${data.latencyQuality}">
          ${latency}
          <small class="dtam-diag-pill" data-quality="${data.latencyQuality}">${getQualityText(data.latencyQuality)}</small>
        </div>
      </div>
      <div class="dtam-diag-stat">
        <span class="dtam-diag-stat-label">房间与玩家</span>
        <div class="dtam-diag-stat-value font-mono">
          房号 ${room} <small class="dtam-diag-pill">${count} 人在线</small>
        </div>
      </div>
    </div>
    <div class="dtam-diag-grid">
      <div class="dtam-diag-cell">
        <span class="dtam-diag-label">配置模式</span>
        <strong class="dtam-diag-val">${configMode}</strong>
      </div>
      <div class="dtam-diag-cell">
        <span class="dtam-diag-label">当前运行传输</span>
        <strong class="dtam-diag-val">${currentMode}${data.directRequired?` <small class="dtam-diag-pill" data-quality="${data.direct?'good':'bad'}">${data.direct?'直连已验证':'等待直连'}</small>`:''}</strong>
      </div>
      <div class="dtam-diag-cell">
        <span class="dtam-diag-label">ICE 节点 / 线路</span>
        <strong class="dtam-diag-val font-mono">${icePair}</strong>
      </div>
      <div class="dtam-diag-cell">
        <span class="dtam-diag-label">语音后端</span>
        <strong class="dtam-diag-val">${voiceBackend}</strong>
      </div>
      <div class="dtam-diag-cell">
        <span class="dtam-diag-label">信令请求 / 省略空轮询</span>
        <strong class="dtam-diag-val font-mono">${reqCount} 次 / 省略 ${suppressed}</strong>
      </div>
      <div class="dtam-diag-cell">
        <span class="dtam-diag-label">动态轮询间隔</span>
        <strong class="dtam-diag-val font-mono">${pollInterval}</strong>
      </div>
    </div>
    ${data.lastError?`<div class="dtam-diag-error-box"><span class="dtam-diag-error-title">⚠ 异常记录</span><p>${lastError}</p></div>`:''}
    ${data.recovering?`<div class="dtam-diag-warn-box"><span>🔄 房主迁移恢复进行中…</span></div>`:''}
    <div class="dtam-diag-foot-note">轻触延迟或状态徽章可随时调出此诊断面板</div>
  `;
}

function openDiagDialog(){
  const overlay=ensureDiagDialog();
  lastFocusedElement=document.activeElement;
  renderDiagBody(collectDiagnosticData());
  overlay.setAttribute('aria-hidden','false');
  overlay.classList.add('open');
  document.body.classList.add('dtam-diag-open');

  if(diagUpdateTimer)clearInterval(diagUpdateTimer);
  diagUpdateTimer=setInterval(()=>{
    if(overlay.classList.contains('open')){
      renderDiagBody(collectDiagnosticData());
    }else{
      clearInterval(diagUpdateTimer);
      diagUpdateTimer=null;
    }
  },1000);

  const closeBtn=overlay.querySelector('#dtamDiagCloseBtn');
  if(closeBtn)closeBtn.focus();
}

function closeDiagDialog(){
  const overlay=document.getElementById('dtamDiagOverlay');
  if(overlay){
    overlay.setAttribute('aria-hidden','true');
    overlay.classList.remove('open');
  }
  document.body.classList.remove('dtam-diag-open');
  if(diagUpdateTimer){
    clearInterval(diagUpdateTimer);
    diagUpdateTimer=null;
  }
  if(lastFocusedElement&&typeof lastFocusedElement.focus==='function'){
    try{lastFocusedElement.focus()}catch(_){}
  }
}

function installNetworkDiagnostics(){
  ensureDiagDialog();

  const bindTrigger=(el)=>{
    if(!el||el.__diagBound)return;
    el.__diagBound=true;
    el.style.cursor='pointer';
    el.setAttribute('role','button');
    el.setAttribute('tabindex','0');
    el.setAttribute('aria-haspopup','dialog');
    el.setAttribute('aria-label','查看网络连接与延迟诊断');
    el.title='点击查看网络诊断';

    el.addEventListener('click',e=>{
      e.preventDefault();
      openDiagDialog();
    });
    el.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){
        e.preventDefault();
        openDiagDialog();
      }
    });
  };

  bindTrigger(document.getElementById('latencyStatus'));
  bindTrigger(document.getElementById('connectionStatus'));

  if(DEBUG_UI){
    const more=document.getElementById('hudMoreMenu');
    if(more&&!document.getElementById('networkDiagBtn')){
      const btn=document.createElement('button');
      btn.type='button';
      btn.id='networkDiagBtn';
      btn.textContent='网络诊断';
      btn.onclick=()=>openDiagDialog();
      more.insertBefore(btn,more.lastElementChild);
    }
  }
}

function installInviteCopy(){
  const room=document.getElementById('roomIdDisplay'),more=document.getElementById('hudMoreMenu');
  if(!room||!more||document.getElementById('copyInviteBtn'))return;
  const btn=document.createElement('button');btn.type='button';btn.id='copyInviteBtn';btn.textContent='复制邀请';btn.title='复制可直接带入房号的邀请链接';
  btn.onclick=async()=>{const code=room.textContent?.trim()||'--';if(!/^\d{2}$/.test(code))return;const u=new URL(location.href);u.search='';u.hash='';u.searchParams.set('room',code);const text=`Among Us 东滩版 · 房间 ${code}\n${u}`;try{await navigator.clipboard.writeText(text);btn.textContent='已复制 ✓';setTimeout(()=>btn.textContent='复制邀请',1200)}catch(_){prompt('复制邀请信息',text)}};
  more.insertBefore(btn,more.lastElementChild);
}

function isTypingTarget(t){return t instanceof HTMLInputElement||t instanceof HTMLTextAreaElement||t instanceof HTMLSelectElement||t?.isContentEditable}
function installInputSafety(){
  const clearMovement=()=>{try{window.dispatchEvent(new Event('blur'))}catch(_){}};
  document.addEventListener('focusin',e=>{if(isTypingTarget(e.target))clearMovement()});
}

function installTaskFailureRecovery(){
  const toast=document.getElementById('gameToast'),modal=document.getElementById('taskModal'),cancel=document.getElementById('taskCancelBtn');
  if(!toast||!modal||!cancel)return;
  const fix=()=>{const text=String(toast.textContent||'');if(!modal.classList.contains('show'))return;if(/无法开始这个任务|靠近任务点后重试|task_unavailable/i.test(text)){cancel.click();setTimeout(()=>{if(modal.classList.contains('show'))modal.classList.remove('show')},0)}};
  new MutationObserver(fix).observe(toast,{childList:true,subtree:true,characterData:true});
}

function installShellState(){
  const game=document.getElementById('game'),lobby=document.getElementById('lobbyPanel');
  if(!game||!lobby)return;
  const apply=()=>game.classList.toggle('lobby-visible',lobby.classList.contains('show'));
  apply();new MutationObserver(apply).observe(lobby,{attributes:true,attributeFilter:['class']});
}

function installPlayerCopyCleanups(){
  const note=document.getElementById('roleCountNote');
  if(note)note.textContent='至少保留 1 名内鬼；职业数量需与当前玩家人数匹配。';
  const rewrite=el=>{
    if(!el)return;
    const text=String(el.textContent||'');
    if(text.includes('无法连接到实时服务器'))el.textContent='无法建立连接，请检查网络后重试';
  };
  const menuStatus=document.getElementById('menuStatus'),toast=document.getElementById('gameToast');
  rewrite(menuStatus);rewrite(toast);
  if(menuStatus)new MutationObserver(()=>rewrite(menuStatus)).observe(menuStatus,{childList:true,subtree:true,characterData:true});
  if(toast)new MutationObserver(()=>rewrite(toast)).observe(toast,{childList:true,subtree:true,characterData:true});
}

function boot(){installInputSafety();installTaskFailureRecovery();installShellState();installPlayerCopyCleanups();installRulePersistence();installHostVisibilityWarning();installNetworkDiagnostics();installInviteCopy()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
