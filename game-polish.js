const RULE_KEY='au-dtam-rules-v2';
const RULE_IDS=['ruleNormalImpostors','ruleShapeshifters','rulePhantoms','ruleVipers','ruleEngineers','ruleScientists','ruleTrackers','ruleNoisemakers','ruleDetectives','ruleGuardianAngels','ruleTasks','ruleSpeed','ruleKill','ruleDiscussion','ruleVoting','ruleEmergency','ruleSabotage','ruleConfirm'];

function loadRules(){try{return JSON.parse(localStorage.getItem(RULE_KEY)||'null')}catch(_){return null}}
function saveRules(){const out={};for(const id of RULE_IDS){const el=document.getElementById(id);if(!el)continue;out[id]=el.type==='checkbox'?!!el.checked:el.value}try{localStorage.setItem(RULE_KEY,JSON.stringify(out))}catch(_){}}
function restoreRules(){const saved=loadRules();if(!saved)return;for(const [id,value] of Object.entries(saved)){const el=document.getElementById(id);if(!el)continue;if(el.type==='checkbox')el.checked=!!value;else if([...el.options||[]].some(o=>o.value===String(value)))el.value=String(value)}const first=document.getElementById('ruleNormalImpostors');if(first)first.dispatchEvent(new Event('change',{bubbles:true}))}

function installRulePersistence(){for(const id of RULE_IDS){const el=document.getElementById(id);if(el)el.addEventListener('change',saveRules)}restoreRules()}

function installHostVisibilityWarning(){
  let previousTitle=document.title;
  const apply=()=>{
    const mode=String(window.__DTAM_NET__?.mode||'');
    const host=mode==='browser-host'||mode==='p2p-recovered-host';
    if(document.hidden&&host){previousTitle=document.title;document.title='⚠ P2P 房主请保持页面前台 · '+previousTitle;const badge=document.getElementById('p2pTransportStatus');if(badge){badge.textContent='P2P 房主 · 页面后台';badge.title='移动浏览器可能冻结后台页面；重连信令会自动降频'}}else if(!document.hidden&&document.title.startsWith('⚠ P2P 房主请保持页面前台 · ')){document.title=previousTitle}}
  document.addEventListener('visibilitychange',apply);
}

function installNetworkDiagnostics(){
  const more=document.getElementById('hudMoreMenu');
  if(!more||document.getElementById('networkDiagBtn'))return;
  const btn=document.createElement('button');btn.type='button';btn.id='networkDiagBtn';btn.textContent='网络状态';
  btn.onclick=()=>{
    const d=window.__DTAM_NET__||{},c=d.configured||{},b=window.__DTAM_SIGNAL_BUDGET__||{};
    const current=d.relay?'Cloudflare 中继':d.mode||'unknown';
    const text=[
      `配置：${c.mode||'unknown'}`,
      `当前：${current}`,
      d.pair?`ICE：${d.pair}`:'',
      d.voiceBackend?`语音：${d.voiceBackend}`:'',
      c.mode==='server'&&c.serverUrl?`Server：${c.serverUrl}`:'',
      d.lastError?`最近异常：${d.lastError}`:'',
      d.recovering?'状态：房主迁移中':'',
      Number.isFinite(b.networkRequests)?`本页信令实际请求：${b.networkRequests}`:'',
      Number.isFinite(b.suppressedPolls)?`已省略空轮询：${b.suppressedPolls}`:'',
      Number.isFinite(b.currentIntervalMs)?`当前大厅轮询间隔：${(b.currentIntervalMs/1000).toFixed(1)}s`:'',
    ].filter(Boolean).join('\n');
    alert(text)
  };
  more.insertBefore(btn,more.lastElementChild);
}

function installInviteCopy(){
  const room=document.getElementById('roomIdDisplay');if(!room||document.getElementById('copyInviteBtn'))return;
  const btn=document.createElement('button');btn.type='button';btn.id='copyInviteBtn';btn.textContent='邀请';btn.title='复制房间号和当前联机方式';
  btn.style.cssText='font:inherit;border:1px solid currentColor;border-radius:999px;background:transparent;padding:3px 8px;opacity:.8;cursor:pointer';
  btn.onclick=async()=>{const code=room.textContent?.trim()||'--',cfg=window.__DTAM_NET__?.configured||{};if(!/^\d{2}$/.test(code))return;const url=new URL('https://d1.lunarlab.uk/');url.searchParams.set('transport',cfg.mode||'auto');if(cfg.mode==='server'&&cfg.serverUrl)url.searchParams.set('server',cfg.serverUrl);const text=`Among Us 东滩版 房间 ${code}\n联机：${cfg.mode||'auto'}\n${url.href}`;try{await navigator.clipboard.writeText(text);btn.textContent='已复制';setTimeout(()=>btn.textContent='邀请',1200)}catch(_){prompt('复制邀请信息',text)}};
  room.insertAdjacentElement('afterend',btn);
}

function isTypingTarget(t){return t instanceof HTMLInputElement||t instanceof HTMLTextAreaElement||t instanceof HTMLSelectElement||t?.isContentEditable}
function installInputSafety(){
  const clearMovement=()=>{try{window.dispatchEvent(new Event('blur'))}catch(_){}};
  document.addEventListener('focusin',e=>{if(isTypingTarget(e.target))clearMovement()});
  document.addEventListener('keydown',e=>{if(isTypingTarget(e.target)&&e.key!=='Escape')e.stopImmediatePropagation()},true);
  document.addEventListener('keyup',e=>{if(isTypingTarget(e.target)&&e.key!=='Escape')e.stopImmediatePropagation()},true);
}

function installTaskFailureRecovery(){
  const toast=document.getElementById('gameToast');
  const modal=document.getElementById('taskModal');
  const cancel=document.getElementById('taskCancelBtn');
  if(!toast||!modal||!cancel)return;
  const fix=()=>{
    const text=String(toast.textContent||'');
    if(!modal.classList.contains('show'))return;
    if(/无法开始这个任务|靠近任务点后重试|task_unavailable/i.test(text)){
      cancel.click();
      setTimeout(()=>{if(modal.classList.contains('show'))modal.classList.remove('show')},0);
    }
  };
  new MutationObserver(fix).observe(toast,{childList:true,subtree:true,characterData:true});
}

function installSafeAreaAssist(){
  const style=document.createElement('style');
  style.textContent=`
    #hud{padding-left:max(8px,env(safe-area-inset-left));padding-right:max(8px,env(safe-area-inset-right));padding-top:max(6px,env(safe-area-inset-top))}
    #chatPanel,#playerPanel{max-height:calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 16px)}
    #chatInputArea{padding-bottom:max(8px,env(safe-area-inset-bottom))}
    @media(max-width:760px) and (orientation:landscape){#hud{gap:6px}.hud-left,.hud-right{gap:5px}.my-name{max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#p2pTransportStatus{display:none}}
  `;
  document.head.appendChild(style);
}

function boot(){installInputSafety();installTaskFailureRecovery();installSafeAreaAssist();installRulePersistence();installHostVisibilityWarning();installNetworkDiagnostics();installInviteCopy()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
