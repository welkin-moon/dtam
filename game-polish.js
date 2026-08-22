const RULE_KEY='au-dtam-rules-v2';
const RULE_IDS=['ruleNormalImpostors','ruleShapeshifters','rulePhantoms','ruleVipers','ruleEngineers','ruleScientists','ruleTrackers','ruleNoisemakers','ruleDetectives','ruleGuardianAngels','ruleTasks','ruleSpeed','ruleKill','ruleDiscussion','ruleVoting','ruleEmergency','ruleSabotage','ruleConfirm'];
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

function installNetworkDiagnostics(){
  if(!DEBUG_UI)return;
  const more=document.getElementById('hudMoreMenu');
  if(!more||document.getElementById('networkDiagBtn'))return;
  const btn=document.createElement('button');btn.type='button';btn.id='networkDiagBtn';btn.textContent='网络诊断';
  btn.onclick=()=>{
    const d=window.__DTAM_NET__||{},c=d.configured||{},b=window.__DTAM_SIGNAL_BUDGET__||{};
    const current=d.relay?'Cloudflare TURN relay':d.mode||'unknown';
    const text=[`配置：${c.mode||'unknown'}`,`当前：${current}`,d.pair?`ICE：${d.pair}`:'',d.voiceBackend?`语音：${d.voiceBackend}`:'',c.mode==='server'&&c.serverUrl?`Server：${c.serverUrl}`:'',d.lastError?`最近异常：${d.lastError}`:'',d.recovering?'状态：房主迁移中':'',Number.isFinite(b.networkRequests)?`信令实际请求：${b.networkRequests}`:'',Number.isFinite(b.suppressedPolls)?`省略空轮询：${b.suppressedPolls}`:'',Number.isFinite(b.currentIntervalMs)?`轮询间隔：${(b.currentIntervalMs/1000).toFixed(1)}s`:''].filter(Boolean).join('\n');
    alert(text);
  };
  more.insertBefore(btn,more.lastElementChild);
}

function installInviteCopy(){
  const room=document.getElementById('roomIdDisplay'),more=document.getElementById('hudMoreMenu');
  if(!room||!more||document.getElementById('copyInviteBtn'))return;
  const btn=document.createElement('button');btn.type='button';btn.id='copyInviteBtn';btn.textContent='复制邀请';btn.title='复制房间号和游戏地址';
  btn.onclick=async()=>{const code=room.textContent?.trim()||'--';if(!/^\d{2}$/.test(code))return;const text=`Among Us 东滩版\n房间 ${code}\nhttps://d1.lunarlab.uk/`;try{await navigator.clipboard.writeText(text);btn.textContent='已复制';setTimeout(()=>btn.textContent='复制邀请',1200)}catch(_){prompt('复制邀请信息',text)}};
  more.insertBefore(btn,more.lastElementChild);
}

function isTypingTarget(t){return t instanceof HTMLInputElement||t instanceof HTMLTextAreaElement||t instanceof HTMLSelectElement||t?.isContentEditable}
function installInputSafety(){
  const clearMovement=()=>{try{window.dispatchEvent(new Event('blur'))}catch(_){}};
  document.addEventListener('focusin',e=>{if(isTypingTarget(e.target))clearMovement()});
  document.addEventListener('keydown',e=>{if(isTypingTarget(e.target)&&e.key!=='Escape')e.stopImmediatePropagation()},true);
  document.addEventListener('keyup',e=>{if(isTypingTarget(e.target)&&e.key!=='Escape')e.stopImmediatePropagation()},true);
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