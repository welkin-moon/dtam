const RULE_KEY='au-dtam-rules-v2';
const RULE_IDS=['ruleNormalImpostors','ruleShapeshifters','rulePhantoms','ruleVipers','ruleEngineers','ruleScientists','ruleTrackers','ruleNoisemakers','ruleDetectives','ruleGuardianAngels','ruleTasks','ruleSpeed','ruleKill','ruleDiscussion','ruleVoting','ruleEmergency','ruleSabotage','ruleConfirm'];

function loadRules(){try{return JSON.parse(localStorage.getItem(RULE_KEY)||'null')}catch(_){return null}}
function saveRules(){const out={};for(const id of RULE_IDS){const el=document.getElementById(id);if(!el)continue;out[id]=el.type==='checkbox'?!!el.checked:el.value}try{localStorage.setItem(RULE_KEY,JSON.stringify(out))}catch(_){}}
function restoreRules(){const saved=loadRules();if(!saved)return;for(const [id,value] of Object.entries(saved)){const el=document.getElementById(id);if(!el)continue;if(el.type==='checkbox')el.checked=!!value;else if([...el.options||[]].some(o=>o.value===String(value)))el.value=String(value)}const first=document.getElementById('ruleNormalImpostors');if(first)first.dispatchEvent(new Event('change',{bubbles:true}))}

function guardTypingControls(){
  document.addEventListener('keydown',e=>{const t=e.target;if(t instanceof HTMLInputElement||t instanceof HTMLTextAreaElement||t instanceof HTMLSelectElement||t?.isContentEditable)e.stopImmediatePropagation()},true);
  document.addEventListener('keyup',e=>{const t=e.target;if(t instanceof HTMLInputElement||t instanceof HTMLTextAreaElement||t instanceof HTMLSelectElement||t?.isContentEditable)e.stopImmediatePropagation()},true);
}

function installRulePersistence(){for(const id of RULE_IDS){const el=document.getElementById(id);if(el)el.addEventListener('change',saveRules)}restoreRules()}

function installHostVisibilityWarning(){
  let previousTitle=document.title;
  const apply=()=>{
    const mode=String(window.__DTAM_NET__?.mode||'');
    const host=mode==='browser-host'||mode==='p2p-recovered-host';
    if(document.hidden&&host){previousTitle=document.title;document.title='⚠ P2P 房主请保持页面前台 · '+previousTitle;const badge=document.getElementById('p2pTransportStatus');if(badge){badge.textContent='P2P 房主 · 页面后台';badge.title='移动浏览器可能冻结后台页面；建议房主保持此页前台'}}else if(!document.hidden&&document.title.startsWith('⚠ P2P 房主请保持页面前台 · ')){document.title=previousTitle}}
  document.addEventListener('visibilitychange',apply);
}

function installNetworkDiagnostics(){
  const more=document.getElementById('hudMoreMenu');
  if(!more||document.getElementById('networkDiagBtn'))return;
  const btn=document.createElement('button');btn.type='button';btn.id='networkDiagBtn';btn.textContent='网络状态';
  btn.onclick=()=>{const d=window.__DTAM_NET__||{};const c=d.configured||{};const text=[`模式：${c.mode||d.mode||'unknown'}`,`当前：${d.mode||'unknown'}`,d.pair?`ICE：${d.pair}`:'',c.serverUrl?`Server：${c.serverUrl}`:'',d.lastError?`最近回退：${d.lastError}`:''].filter(Boolean).join('\n');alert(text)};
  more.insertBefore(btn,more.lastElementChild);
}

function installInviteCopy(){
  const room=document.getElementById('roomIdDisplay');if(!room||document.getElementById('copyInviteBtn'))return;
  const btn=document.createElement('button');btn.type='button';btn.id='copyInviteBtn';btn.textContent='邀请';btn.title='复制房间号和当前联机方式';
  btn.style.cssText='font:inherit;border:1px solid currentColor;border-radius:999px;background:transparent;padding:3px 8px;opacity:.8;cursor:pointer';
  btn.onclick=async()=>{const code=room.textContent?.trim()||'--',cfg=window.__DTAM_NET__?.configured||{};if(!/^\d{2}$/.test(code))return;const url=new URL(location.href);url.searchParams.set('transport',cfg.mode||'auto');if(cfg.mode==='server'&&cfg.serverUrl)url.searchParams.set('server',cfg.serverUrl);const text=`Among Us 东滩版 房间 ${code}\n联机：${cfg.mode||'auto'}\n${url.href}`;try{await navigator.clipboard.writeText(text);btn.textContent='已复制';setTimeout(()=>btn.textContent='邀请',1200)}catch(_){prompt('复制邀请信息',text)}};
  room.insertAdjacentElement('afterend',btn);
}

function boot(){guardTypingControls();installRulePersistence();installHostVisibilityWarning();installNetworkDiagnostics();installInviteCopy()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
