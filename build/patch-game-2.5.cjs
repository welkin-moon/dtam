const fs = require('fs');
let src = fs.readFileSync('game.js', 'utf8');
const hits = {};
function replaceOnce(before, after, name) {
  const count = src.split(before).length - 1;
  hits[name] = count;
  if (count !== 1) throw new Error(`[2.5 patch] ${name}: expected 1 match, got ${count}`);
  src = src.replace(before, after);
}
function replaceRegex(re, after, name, expected = 1) {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const count = [...src.matchAll(new RegExp(re.source, flags))].length;
  hits[name] = count;
  if (count !== expected) throw new Error(`[2.5 patch] ${name}: expected ${expected}, got ${count}`);
  src = src.replace(re, after);
}
function replaceAllChecked(before, after, name, min = 1) {
  const count = src.split(before).length - 1;
  hits[name] = count;
  if (count < min) throw new Error(`[2.5 patch] ${name}: expected >=${min}, got ${count}`);
  src = src.split(before).join(after);
}

replaceRegex(
  /const IMPOSTOR_ROLES = new Set\(\[[^\n]*?const isImpostorRole = role => IMPOSTOR_ROLES\.has\(role\);/,
  `const IMPOSTOR_ROLES = new Set(['impostor','shapeshifter','phantom','viper']);
const CREW_ROLES = new Set(['crewmate','engineer','scientist','tracker','noisemaker','detective']);
const ROLE_META = {
  impostor:{label:'普通内鬼',desc:'没有额外职业技能，依靠击杀、破坏和通风管制造人数优势。',action:''},
  shapeshifter:{label:'变形者',desc:'短时间伪装成附近玩家。',action:'变形'},
  phantom:{label:'隐身者',desc:'短时间从其他玩家视野中消失。',action:'隐身'},
  viper:{label:'毒蛇',desc:'击杀后的尸体会逐渐溶解并最终消失。',action:''},
  crewmate:{label:'普通船员',desc:'完成任务、获取信息并找出内鬼。',action:''},
  engineer:{label:'工程师',desc:'可以短时间使用通风管，之后进入冷却。',action:''},
  scientist:{label:'科学家',desc:'可临时查看全员生命体征；完成任务会帮助恢复能力。',action:'生命体征'},
  tracker:{label:'追踪者',desc:'标记附近玩家，并在地图上短时间追踪位置。',action:'追踪'},
  noisemaker:{label:'噪音制造者',desc:'被击杀时会向其他船员发出死亡位置警报。',action:''},
  detective:{label:'侦探',desc:'调查附近玩家，读取其在最近案件发生时所在的区域。',action:'调查'},
  guardian:{label:'守护天使',desc:'死亡后保护一名附近船员，短时间抵挡一次击杀。',action:'保护'}
};
const isImpostorRole = role => IMPOSTOR_ROLES.has(role);
const isCrewRole = role => CREW_ROLES.has(role);`,
  'role constants'
);

replaceRegex(
  /const DEFAULT_SETTINGS = \{[^\n]*\};/,
  `const DEFAULT_SETTINGS = {normalImpostors:1,shapeshifters:0,phantoms:0,vipers:0,engineers:0,scientists:0,trackers:0,noisemakers:0,detectives:0,guardianAngels:0,impostors:1,tasksPerCrew:4,moveSpeed:4.6,killCooldown:20,discussion:15,voting:45,emergencyMeetings:1,sabotageCooldown:20,confirmEjects:true};`,
  'default settings'
);

replaceRegex(
  /<label>变形<select id="ruleMorphers">[\s\S]*?<div class="role-count-note" id="roleCountNote">[^<]*<\/div>/,
  `<details class="role-group" open><summary>内鬼身份 <span class="role-summary-note" id="impRoleSummary">总数 1</span></summary><div class="role-setting-grid">
      <label>普通内鬼<select id="ruleNormalImpostors"><option>0</option><option selected>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
      <label>变形者<select id="ruleShapeshifters"><option selected>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
      <label>隐身者<select id="rulePhantoms"><option selected>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
      <label>毒蛇<select id="ruleVipers"><option selected>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
    </div></details>
    <details class="role-group"><summary>船员身份 <span class="role-summary-note" id="crewRoleSummary">其余为普通船员</span></summary><div class="role-setting-grid">
      <label>工程师<select id="ruleEngineers"><option selected>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
      <label>科学家<select id="ruleScientists"><option selected>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
      <label>追踪者<select id="ruleTrackers"><option selected>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
      <label>噪音制造者<select id="ruleNoisemakers"><option selected>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
      <label>侦探<select id="ruleDetectives"><option selected>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
      <label>守护天使<select id="ruleGuardianAngels"><option selected>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
    </div></details>
    <div class="role-count-note" id="roleCountNote">至少保留 1 名内鬼；职业数量超过可用玩家时由服务器自动裁剪。</div>`,
  'role settings UI'
);

replaceRegex(
  /<label>速度<select id="ruleSpeed">[\s\S]*?<\/select><\/label>/,
  `<label class="speed-rule">速度<select id="ruleSpeed"><option value="3.45">0.75×</option><option value="4.6" selected>1.0×</option><option value="5.75">1.25×</option><option value="6.9">1.5×</option><option value="8.05">1.75×</option><option value="9.2">2.0×</option><option value="10.35">2.25×</option><option value="11.5">2.5×</option><option value="12.65">2.75×</option><option value="13.8">3.0×</option></select></label>`,
  'speed options'
);

replaceOnce('game.appendChild(action);', 'game.appendChild(action);action.appendChild(interactBtn);', 'unified action dock');

replaceRegex(
  /const meeting=document\.createElement\('div'\);meeting\.id='meetingOverlay';meeting\.innerHTML=`[\s\S]*?`;game\.appendChild\(meeting\);/,
  `const meeting=document.createElement('div');meeting.id='meetingOverlay';meeting.innerHTML=\`
    <div class="meeting-card"><div class="meeting-head"><div><div class="eyebrow">会议</div><h2 id="meetingTitle">讨论</h2></div><div id="meetingTimer">--</div></div>
    <div id="meetingBody"></div>
    <div id="meetingComms"><button id="meetingMicBtn" type="button">麦克风关</button><button id="meetingChatBtn" type="button">聊天</button><span class="meeting-progress" id="meetingVoteProgress"></span></div>
    <div id="meetingResult"></div><div id="voteGrid"></div><div class="meeting-actions"><button id="skipVoteBtn" type="button">跳过投票</button></div></div>\`;game.appendChild(meeting);`,
  'meeting workspace'
);

replaceOnce(
  "const sink=document.createElement('div');sink.id='voiceSink';sink.className='voice-sink';game.appendChild(sink);",
  "const sink=document.createElement('div');sink.id='voiceSink';sink.className='voice-sink';game.appendChild(sink);const unlock=document.createElement('button');unlock.id='voiceUnlockBtn';unlock.type='button';unlock.hidden=true;unlock.textContent='启用语音播放';game.appendChild(unlock);const vitals=document.createElement('div');vitals.id='vitalsOverlay';vitals.innerHTML='<div id=\"vitalsCard\"><div class=\"tool-head\"><div><div class=\"eyebrow\">科学家</div><h2>生命体征</h2></div><button id=\"vitalsClose\" type=\"button\">×</button></div><div id=\"vitalsGrid\"></div></div>';game.appendChild(vitals);",
  'voice unlock and vitals UI'
);

replaceRegex(
  /const meetingOverlay=\$\('meetingOverlay'\),meetingTitle=\$\('meetingTitle'\),meetingTimer=\$\('meetingTimer'\),meetingBody=\$\('meetingBody'\);\nconst voteGrid=\$\('voteGrid'\),skipVoteBtn=\$\('skipVoteBtn'\),endOverlay=/,
  `const meetingOverlay=$('meetingOverlay'),meetingTitle=$('meetingTitle'),meetingTimer=$('meetingTimer'),meetingBody=$('meetingBody'),meetingMicBtn=$('meetingMicBtn'),meetingChatBtn=$('meetingChatBtn'),meetingVoteProgress=$('meetingVoteProgress'),meetingResult=$('meetingResult');
const voteGrid=$('voteGrid'),skipVoteBtn=$('skipVoteBtn'),endOverlay=`,
  'meeting references'
);

replaceRegex(
  /const mapBtn=\$\('mapBtn'\),micBtn=\$\('micBtn'\),minimapOverlay=\$\('minimapOverlay'\),minimapCanvas=\$\('minimapCanvas'\),minimapClose=\$\('minimapClose'\),voiceSink=\$\('voiceSink'\);/,
  `const mapBtn=$('mapBtn'),micBtn=$('micBtn'),moreBtn=$('moreBtn'),hudMoreMenu=$('hudMoreMenu'),minimapOverlay=$('minimapOverlay'),minimapCanvas=$('minimapCanvas'),minimapClose=$('minimapClose'),voiceSink=$('voiceSink'),voiceUnlockBtn=$('voiceUnlockBtn'),vitalsOverlay=$('vitalsOverlay'),vitalsGrid=$('vitalsGrid'),vitalsClose=$('vitalsClose');`,
  'global tool references'
);

replaceRegex(
  /const ruleMorphers=\$\('ruleMorphers'\)[^\n]*ruleConfirm=\$\('ruleConfirm'\);/,
  `const ruleNormalImpostors=$('ruleNormalImpostors'),ruleShapeshifters=$('ruleShapeshifters'),rulePhantoms=$('rulePhantoms'),ruleVipers=$('ruleVipers'),ruleEngineers=$('ruleEngineers'),ruleScientists=$('ruleScientists'),ruleTrackers=$('ruleTrackers'),ruleNoisemakers=$('ruleNoisemakers'),ruleDetectives=$('ruleDetectives'),ruleGuardianAngels=$('ruleGuardianAngels'),impRoleSummary=$('impRoleSummary'),crewRoleSummary=$('crewRoleSummary'),roleCountNote=$('roleCountNote'),ruleTasks=$('ruleTasks'),ruleSpeed=$('ruleSpeed'),ruleKill=$('ruleKill'),ruleDiscussion=$('ruleDiscussion'),ruleVoting=$('ruleVoting'),ruleEmergency=$('ruleEmergency'),ruleSabotage=$('ruleSabotage'),ruleConfirm=$('ruleConfirm');`,
  'rule references'
);

replaceAllChecked(
  "role:'',roleLabel:'',alive:true,tasks:[],fakeTasks:[],completed:[],allies:[],killReadyAt:0,abilityReadyAt:0,abilityUntil:0,sabotageReadyAt:0,emergencyUsed:0,inVent:false,ventId:''",
  "role:'',roleLabel:'',ghostRole:'',alive:true,tasks:[],fakeTasks:[],completed:[],allies:[],killReadyAt:0,abilityReadyAt:0,abilityUntil:0,trackedId:'',trackUntil:0,ventReadyAt:0,ventExitAt:0,protectedUntil:0,sabotageReadyAt:0,emergencyUsed:0,inVent:false,ventId:''",
  'extended self state',
  2
);

replaceRegex(
  /let voiceSendPc=null,voiceRecvPc=null,voiceLocalStream=null,voiceSendSession='',voiceRecvSession='',voiceActive=false,voiceStarting=false,voiceSubscribed=new Set\(\),voicePullChain=Promise\.resolve\(\);/,
  `let voiceSendPc=null,voiceRecvPc=null,voiceLocalStream=null,voiceSendSession='',voiceRecvSession='',voiceActive=false,voiceStarting=false,voiceDesired=false,voiceSubscribed=new Map(),voicePendingMids=new Map(),voiceRemoteAudios=new Map(),voicePullChain=Promise.resolve(),voiceRestartTimer=null,voiceDisconnectTimer=null;let vitalsTimer=null,noisemakerPing=null;`,
  'voice state'
);

replaceRegex(
  /function currentRules\(\)\{[^\n]*\}/,
  `function currentRules(){return{normalImpostors:Number(ruleNormalImpostors.value),shapeshifters:Number(ruleShapeshifters.value),phantoms:Number(rulePhantoms.value),vipers:Number(ruleVipers.value),engineers:Number(ruleEngineers.value),scientists:Number(ruleScientists.value),trackers:Number(ruleTrackers.value),noisemakers:Number(ruleNoisemakers.value),detectives:Number(ruleDetectives.value),guardianAngels:Number(ruleGuardianAngels.value),tasksPerCrew:Number(ruleTasks.value),moveSpeed:Number(ruleSpeed.value),killCooldown:Number(ruleKill.value),discussion:Number(ruleDiscussion.value),voting:Number(ruleVoting.value),emergencyMeetings:Number(ruleEmergency.value),sabotageCooldown:Number(ruleSabotage.value),confirmEjects:!!ruleConfirm.checked};}`,
  'current rules'
);

replaceRegex(
  /function syncRulesUI\(\)\{[^\n]*\}/,
  `function syncRulesUI(){const st={...DEFAULT_SETTINGS,...(gameState.settings||{})},fields=[[ruleNormalImpostors,st.normalImpostors],[ruleShapeshifters,st.shapeshifters],[rulePhantoms,st.phantoms],[ruleVipers,st.vipers],[ruleEngineers,st.engineers],[ruleScientists,st.scientists],[ruleTrackers,st.trackers],[ruleNoisemakers,st.noisemakers],[ruleDetectives,st.detectives],[ruleGuardianAngels,st.guardianAngels],[ruleTasks,st.tasksPerCrew],[ruleSpeed,st.moveSpeed],[ruleKill,st.killCooldown],[ruleDiscussion,st.discussion],[ruleVoting,st.voting],[ruleEmergency,st.emergencyMeetings],[ruleSabotage,st.sabotageCooldown]];for(const [el,v] of fields){el.value=String(v??0);el.disabled=!isHost;}ruleConfirm.checked=!!st.confirmEjects;ruleConfirm.disabled=!isHost;const imp=Number(st.normalImpostors||0)+Number(st.shapeshifters||0)+Number(st.phantoms||0)+Number(st.vipers||0),crewSpecial=Number(st.engineers||0)+Number(st.scientists||0)+Number(st.trackers||0)+Number(st.noisemakers||0)+Number(st.detectives||0);impRoleSummary.textContent='总数 '+imp;crewRoleSummary.textContent=crewSpecial?'特殊职业 '+crewSpecial+' · 其余普通船员':'其余为普通船员';}`,
  'sync rule controls'
);

replaceRegex(
  /function renderGameMeta\(\)\{[^\n]*\}/,
  `function renderGameMeta(){const base=({lobby:'大厅',playing:'进行中',meeting:'会议',ended:'已结束'})[gameState.phase]||gameState.phase;phaseLabel.textContent=gameState.phase==='playing'?base+' · '+areaNameAt(myPos.x,myPos.y):base;const meta=ROLE_META[selfState.role]||ROLE_META.crewmate;if(gameState.phase==='lobby')roleLabel.textContent='等待开始';else if(!selfState.alive&&selfState.ghostRole==='guardian')roleLabel.textContent='守护天使 · 幽灵';else roleLabel.textContent=meta.label+(selfState.alive?(selfState.inVent?' · 通风管':''):' · 已死亡');const pct=gameState.taskTotal?clamp(gameState.taskDone/gameState.taskTotal*100,0,100):0;taskProgress.style.width=pct+'%';const sab=gameState.sabotage,doorSec=Math.max(0,Math.ceil((Number(gameState.doorLockUntil||0)-Date.now())/1000));if(sab){const d=SABOTAGE_DEFS[sab.type];let text=d?.label||sab.type;if(sab.endsAt)text+=' · '+Math.max(0,Math.ceil((sab.endsAt-Date.now())/1000))+'s';if(Array.isArray(sab.requiredStations)&&sab.requiredStations.length>1)text+=' · '+(sab.fixedStations?.length||0)+'/'+sab.requiredStations.length;sabotageLine.hidden=false;sabotageLine.textContent=text;}else if(doorSec>0){sabotageLine.hidden=false;sabotageLine.textContent='门禁封锁 · '+doorSec+'s';}else sabotageLine.hidden=true;if(gameState.phase==='lobby')taskText.textContent='等待房主开始游戏';else if(gameState.phase==='ended')taskText.textContent=gameState.reason||'本局结束';else if(isCrewRole(selfState.role)){const remaining=selfState.tasks.filter(id=>!selfState.completed.includes(id));taskText.textContent=remaining.length?'剩余任务 '+remaining.length+' · '+remaining.map(id=>objById(id)?.label).filter(Boolean).slice(0,2).join(' / '):'你的任务已全部完成';}else if(isImpostorRole(selfState.role)){const fake=(selfState.fakeTasks||[]).map(id=>objById(id)?.label).filter(Boolean);taskText.textContent=selfState.alive?(fake.length?'伪装任务 · '+fake.slice(0,2).join(' / '):'隐藏身份并制造混乱'):'等待本局结束';}}`,
  'role meta UI'
);

replaceRegex(
  /function nearestAbilityTarget\(\)\{[^\n]*\}/,
  `function nearestAbilityTarget(){if(gameState.phase!=='playing'||selfState.inVent)return null;const role=selfState.role,guardian=!selfState.alive&&selfState.ghostRole==='guardian';if(!selfState.alive&&!guardian)return null;if(['phantom','scientist'].includes(role))return null;if(!['shapeshifter','tracker','detective'].includes(role)&&!guardian)return null;const maxD=guardian?2.15:1.75;let best=null,bestD=maxD;for(const p of Object.values(players)){if(p.id===myPlayerId||!p.alive||!p.connected||p.inVent)continue;const v=remoteVisuals[p.id],px=v?v.x:p.pos.x,py=v?v.y:p.pos.y,d=Math.hypot(myPos.x-px,myPos.y-py);if(d<bestD){best=p;bestD=d;}}return best;}`,
  'ability target helper'
);

replaceOnce("if(selfState.role!=='crewmate'||selfState.inVent||gameState.phase!=='playing')return null;", "if(!isCrewRole(selfState.role)||selfState.inVent||gameState.phase!=='playing')return null;", 'crew task helper');

replaceRegex(
  /function nearestVent\(\)\{[^\n]*\}/,
  `function nearestVent(){if(!(isImpostorRole(selfState.role)||selfState.role==='engineer')||!selfState.alive||selfState.inVent||gameState.phase!=='playing')return null;let best=null,bestD=1.05;for(const v of VENT_DEFS){const d=dist(myPos,v);if(d<bestD){best=v;bestD=d;}}return best;}`,
  'engineer vent helper'
);

replaceRegex(
  /function renderActions\(\)\{[^\n]*\}/,
  `function renderActions(){const playing=gameState.phase==='playing',body=nearestBody(),target=nearestKillTarget(),abilityTarget=nearestAbilityTarget(),task=nearestAssignedTask(),repair=nearestSabotageStation(),vent=nearestVent(),info=nearbyInfo(),imp=isImpostorRole(selfState.role),engineer=selfState.role==='engineer',now=Date.now();reportBtn.hidden=!body;reportBtn.disabled=!body;reportBtn.textContent='报告尸体';const killCd=Math.max(0,Math.ceil((selfState.killReadyAt-now)/1000));killBtn.hidden=!imp;killBtn.disabled=!target||killCd>0||!playing||selfState.inVent;killBtn.textContent=killCd>0?'击杀 '+killCd+'s':(target?'击杀 '+target.name:'击杀');const abilityRoles=['shapeshifter','phantom','scientist','tracker','detective'],guardian=!selfState.alive&&selfState.ghostRole==='guardian',hasAbility=abilityRoles.includes(selfState.role)||guardian,abilityCd=Math.max(0,Math.ceil((Number(selfState.abilityReadyAt||0)-now)/1000)),meta=guardian?ROLE_META.guardian:ROLE_META[selfState.role],needsTarget=guardian||['shapeshifter','tracker','detective'].includes(selfState.role);abilityBtn.hidden=!hasAbility;abilityBtn.disabled=!playing||selfState.inVent||abilityCd>0||(needsTarget&&!abilityTarget);abilityBtn.textContent=abilityCd>0?(meta?.action||'能力')+' '+abilityCd+'s':needsTarget&&abilityTarget?(meta?.action||'能力')+' '+abilityTarget.name:(meta?.action||'能力');const sabCd=Math.max(0,Math.ceil((selfState.sabotageReadyAt-now)/1000));sabotageBtn.hidden=!imp;sabotageBtn.disabled=!playing||!selfState.alive||selfState.inVent||!!gameState.sabotage||sabCd>0;sabotageBtn.textContent=gameState.sabotage?'破坏进行中':sabCd>0?'破坏 '+sabCd+'s':'破坏';const ventCd=Math.max(0,Math.ceil((Number(selfState.ventReadyAt||0)-now)/1000)),canVentRole=imp||engineer;ventBtn.hidden=!(canVentRole&&playing&&selfState.alive&&(selfState.inVent||vent));ventBtn.disabled=!selfState.inVent&&(!vent||ventCd>0);ventBtn.textContent=selfState.inVent?'通风管':ventCd>0?'通风管 '+ventCd+'s':'进入通风管';infoBtn.hidden=!info;infoBtn.disabled=!info;infoBtn.textContent=info?(info.mode==='cams'?'监控':'Admin'):'设备';const hasInteract=!!(repair||task||canEmergency());interactBtn.hidden=!hasInteract||!playing||selfState.inVent;interactBtn.disabled=!hasInteract;if(repair){interactBtn.textContent='修复 '+(gameState.sabotage?.label||'破坏');interactBtn.title=repair.label;}else if(task){interactBtn.textContent='执行任务';interactBtn.title=task.label;}else if(canEmergency()){interactBtn.textContent='紧急会议';interactBtn.title='呼叫紧急会议';}}`,
  'context action dock'
);

replaceRegex(
  /function showRoleReveal\(\)\{[^\n]*\}/,
  `function showRoleReveal(){const meta=ROLE_META[selfState.role]||ROLE_META.crewmate;roleRevealName.textContent=meta.label;roleRevealName.className=isImpostorRole(selfState.role)?'impostor':'crewmate';roleRevealDesc.textContent=isImpostorRole(selfState.role)?meta.desc+' 你仍可击杀、破坏和使用通风管。':meta.desc;roleReveal.classList.add('show');setTimeout(()=>roleReveal.classList.remove('show'),3200);}`,
  'role reveal'
);

replaceRegex(
  /function openMeeting\(msg\)\{[\s\S]*?(?=function showEnd)/,
  `function syncMeetingComms(){meetingMicBtn.dataset.state=micBtn.dataset.state||'off';meetingMicBtn.textContent=micBtn.textContent;meetingChatBtn.textContent=chatVisible?'关闭聊天':'聊天';}
function openMeeting(msg){gameState.phase='meeting';gameState.meeting=msg.meeting||gameState.meeting||null;closeToolOverlays();renderGameMeta();renderActions();meetingOverlay.classList.add('show');renderMeeting();syncMeetingComms();clearInterval(meetingTickTimer);meetingTickTimer=setInterval(renderMeeting,250);}
function closeMeeting(){meetingOverlay.classList.remove('show');clearInterval(meetingTickTimer);meetingTickTimer=null;lastMeetingSignature='';lastMeetingSecond=-1;meetingResult.classList.remove('show');voteGrid.hidden=false;skipVoteBtn.hidden=false;}
function meetingResultHtml(m){const result=m.result||{},counts=result.counts||{},votes=result.votes||{},entries=Object.entries(counts).filter(([,n])=>Number(n)>0).sort((a,b)=>Number(b[1])-Number(a[1]));const rows=entries.map(([id,n])=>{const label=id==='skip'?'跳过投票':(players[id]?.name||'已离线玩家'),voters=Object.entries(votes).filter(([,target])=>target===id).map(([voter])=>players[voter]?.name||'已离线玩家');return '<div class="meeting-result-row"><div class="meeting-result-name">'+(id==='skip'?'<span class="avatar-placeholder">–</span>':avatarMarkup(players[id]||{id,name:label,color:'#888'}))+'<span>'+escapeHtml(label)+'</span></div><strong class="meeting-result-count">'+Number(n)+' 票</strong><div class="meeting-result-voters">'+(voters.length?'投票：'+voters.map(escapeHtml).join('、'):'')+'</div></div>';}).join('');return '<div class="meeting-result-title">'+escapeHtml(result.text||'投票结束')+'</div>'+rows;}
function renderMeeting(){const m=gameState.meeting;if(!m)return;const now=Date.now(),stage=m.stage||'discussion',deadline=stage==='discussion'?Number(m.discussionEndsAt||0):stage==='voting'?Number(m.votingEndsAt||0):Number(m.resumeAt||0),sec=Math.max(0,Math.ceil((deadline-now)/1000));if(sec!==lastMeetingSecond){lastMeetingSecond=sec;meetingTimer.textContent=sec+'s';}syncMeetingComms();meetingVoteProgress.textContent=stage==='discussion'?'讨论中':stage==='voting'?('已投 '+Number(m.votesCast||0)+' / '+Number(m.eligibleVoters||0)):'结果';meetingTitle.textContent=stage==='discussion'?'讨论阶段':stage==='voting'?'投票阶段':'投票结果';meetingBody.textContent=m.reasonText||'紧急会议';if(stage==='result'){voteGrid.hidden=true;skipVoteBtn.hidden=true;meetingResult.classList.add('show');const sig='result|'+JSON.stringify(m.result||{});if(sig!==lastMeetingSignature){lastMeetingSignature=sig;meetingResult.innerHTML=meetingResultHtml(m);}return;}meetingResult.classList.remove('show');voteGrid.hidden=false;skipVoteBtn.hidden=false;const voted=String(m.myVote||''),aliveIds=[];for(const id in players)if(players[id].alive)aliveIds.push(id);aliveIds.sort();const sig=stage+'|'+voted+'|'+Number(m.votesCast||0)+'|'+aliveIds.join(',');if(sig!==lastMeetingSignature){lastMeetingSignature=sig;const disabled=stage!=='voting'||!selfState.alive||!!voted;voteGrid.innerHTML=aliveIds.map(id=>{const p=players[id];return '<button type="button" class="vote-card '+(voted===p.id?'selected':'')+'" data-vote="'+escapeHtml(p.id)+'" '+(disabled?'disabled':'')+'>'+avatarMarkup(p)+'<span class="color-dot" style="background:'+escapeHtml(p.color)+'"></span><span>'+escapeHtml(p.name)+(p.id===myPlayerId?' · 你':'')+'</span></button>';}).join('');voteGrid.querySelectorAll('[data-vote]').forEach(btn=>btn.onclick=()=>castVote(btn.dataset.vote));skipVoteBtn.disabled=disabled;skipVoteBtn.classList.toggle('selected',voted==='skip');}}
function castVote(target){if(gameState.phase!=='meeting'||gameState.meeting?.stage!=='voting'||gameState.meeting?.myVote)return;if(sendPacket({t:'vote',target}))gameState.meeting.myVote=target;renderMeeting();}
`,
  'meeting stages and results'
);

replaceRegex(
  /function drawMinimap\(\)\{[^\n]*\}/,
  `function drawMinimap(){if(!minimapOverlay.classList.contains('show'))return;const x=minimapCanvas.getContext('2d'),base=ensureMinimapBase(),s=2,now=Date.now();x.clearRect(0,0,300,300);x.drawImage(base,0,0);const ids=isCrewRole(selfState.role)?selfState.tasks:(selfState.fakeTasks||[]);x.fillStyle='#2563eb';for(const id of ids){if(selfState.completed.includes(id))continue;const o=objById(id);if(o)x.fillRect(Math.round(o.x*s)-4,Math.round(o.y*s)-4,8,8);}if(gameState.sabotage){x.fillStyle='#dc2626';for(const id of gameState.sabotage.requiredStations||[]){if(gameState.sabotage.fixedStations?.includes(id))continue;const o=objById(id);if(o)x.fillRect(Math.round(o.x*s)-5,Math.round(o.y*s)-5,10,10);}}if(selfState.role==='tracker'&&selfState.trackedId&&Number(selfState.trackUntil||0)>now){const p=players[selfState.trackedId],v=p&&remoteVisuals[p.id],px=v?v.x:p?.pos?.x,py=v?v.y:p?.pos?.y;if(Number.isFinite(px)&&Number.isFinite(py)){x.strokeStyle='#f59e0b';x.lineWidth=3;x.strokeRect(Math.round(px*s)-6,Math.round(py*s)-6,12,12);}}if(noisemakerPing&&noisemakerPing.until>now){x.strokeStyle='#dc2626';x.lineWidth=3;x.strokeRect(Math.round(noisemakerPing.x*s)-7,Math.round(noisemakerPing.y*s)-7,14,14);}x.fillStyle='#f8fafc';x.fillRect(Math.round(myPos.x*s)-3,Math.round(myPos.y*s)-3,6,6);x.strokeStyle='#111827';x.strokeRect(Math.round(myPos.x*s)-4,Math.round(myPos.y*s)-4,8,8);}`,
  'role-aware minimap'
);

replaceRegex(
  /async function voiceApi\(path,method='POST',payload\)\{[\s\S]*?(?=function handleServerMessage)/,
  `async function voiceApi(path,method='POST',payload){const url=VOICE_API+path+(path.includes('?')?'&':'?')+'room='+encodeURIComponent(currentRoom),headers={'x-dtam-token':resumeToken};let body;if(payload!==undefined){headers['content-type']='application/json';body=JSON.stringify(payload);}const r=await fetch(url,{method,headers,body});let data={};try{data=await r.json();}catch(_){}if(!r.ok||data.errorCode)throw new Error(data.errorDescription||data.error||('语音服务 '+r.status));return data;}
function scheduleVoiceRestart(){if(!voiceDesired||voiceRestartTimer)return;voiceRestartTimer=setTimeout(()=>{voiceRestartTimer=null;if(voiceDesired)rebuildVoiceTransport().catch(e=>showToast('语音重连失败：'+e.message,1800));},1800);}
function watchVoicePc(pc){const check=()=>{const bad=['failed','closed'].includes(pc.connectionState)||pc.iceConnectionState==='failed';if(bad)scheduleVoiceRestart();else if(pc.connectionState==='disconnected'||pc.iceConnectionState==='disconnected'){clearTimeout(voiceDisconnectTimer);voiceDisconnectTimer=setTimeout(()=>{if(pc.connectionState==='disconnected'||pc.iceConnectionState==='disconnected')scheduleVoiceRestart();},3000);}};pc.addEventListener('connectionstatechange',check);pc.addEventListener('iceconnectionstatechange',check);}
function newVoicePc(){const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}],bundlePolicy:'max-bundle'});watchVoicePc(pc);return pc;}
function clearRemoteVoice(){for(const a of voiceRemoteAudios.values()){try{a.srcObject=null;a.remove();}catch(_){}}voiceRemoteAudios.clear();voiceSubscribed.clear();voicePendingMids.clear();voiceSink.innerHTML='';}
function pruneVoiceDirectory(){const active=new Set(voiceDirectory.filter(v=>v.playerId!==myPlayerId&&v.enabled&&v.connected&&v.sessionId&&v.trackName).map(v=>v.sessionId+'|'+v.trackName));for(const [key,a] of voiceRemoteAudios){if(!active.has(key)){try{a.srcObject=null;a.remove();}catch(_){}voiceRemoteAudios.delete(key);voiceSubscribed.delete(key);}}for(const key of [...voiceSubscribed.keys()])if(!active.has(key))voiceSubscribed.delete(key);}
async function unlockVoicePlayback(){let blocked=false;for(const a of voiceRemoteAudios.values()){try{await a.play();}catch(_){blocked=true;}}voiceUnlockBtn.hidden=!blocked;}
async function pullVoiceDirectory(){if(!voiceActive||!voiceRecvPc||!voiceRecvSession)return;pruneVoiceDirectory();const pending=voiceDirectory.filter(v=>v.playerId!==myPlayerId&&v.enabled&&v.connected&&v.sessionId&&v.trackName&&!voiceSubscribed.has(v.sessionId+'|'+v.trackName));if(!pending.length)return;const res=await voiceApi('/sessions/'+encodeURIComponent(voiceRecvSession)+'/tracks/new','POST',{tracks:pending.map(v=>({location:'remote',sessionId:v.sessionId,trackName:v.trackName}))});(res.tracks||[]).forEach((tr,i)=>{if(pending[i])voicePendingMids.set(String(tr.mid),pending[i]);});if(res.requiresImmediateRenegotiation&&res.sessionDescription){await voiceRecvPc.setRemoteDescription(res.sessionDescription);const answer=await voiceRecvPc.createAnswer();await voiceRecvPc.setLocalDescription(answer);await voiceApi('/sessions/'+encodeURIComponent(voiceRecvSession)+'/renegotiate','PUT',{sessionDescription:{sdp:answer.sdp,type:'answer'}});}pending.forEach(v=>voiceSubscribed.set(v.sessionId+'|'+v.trackName,v.playerId));}
function scheduleVoiceDirectory(){voicePullChain=voicePullChain.then(pullVoiceDirectory).catch(e=>{showToast('语音订阅失败：'+e.message,1800);scheduleVoiceRestart();});}
function setMicUi(){const track=voiceLocalStream?.getAudioTracks?.()[0],on=!!track?.enabled,busy=voiceStarting,label=busy?'麦克风…':on?'麦克风开':'麦克风关',shortLabel=busy?'麦…':on?'麦开':'麦关';micBtn.dataset.state=busy?'busy':on?'on':'off';micBtn.textContent=innerWidth<=430?shortLabel:label;if(meetingMicBtn){meetingMicBtn.dataset.state=micBtn.dataset.state;meetingMicBtn.textContent=label;}}
async function rebuildVoiceTransport(){if(!voiceDesired||!voiceLocalStream?.getAudioTracks?.()[0])return;voiceStarting=true;setMicUi();try{try{voiceSendPc?.close()}catch(_){}try{voiceRecvPc?.close()}catch(_){}clearRemoteVoice();voiceSendPc=voiceRecvPc=null;voiceSendSession=voiceRecvSession='';const track=voiceLocalStream.getAudioTracks()[0];voiceSendSession=(await voiceApi('/sessions/new')).sessionId;voiceSendPc=newVoicePc();const tx=voiceSendPc.addTransceiver(track,{direction:'sendonly'}),offer=await voiceSendPc.createOffer();await voiceSendPc.setLocalDescription(offer);const pushed=await voiceApi('/sessions/'+encodeURIComponent(voiceSendSession)+'/tracks/new','POST',{sessionDescription:{sdp:offer.sdp,type:'offer'},tracks:[{location:'local',mid:tx.mid,trackName:track.id}]});if(pushed.sessionDescription)await voiceSendPc.setRemoteDescription(pushed.sessionDescription);voiceRecvSession=(await voiceApi('/sessions/new')).sessionId;voiceRecvPc=newVoicePc();voiceRecvPc.addEventListener('track',e=>{const entry=voicePendingMids.get(String(e.transceiver?.mid||'')),key=entry?(entry.sessionId+'|'+entry.trackName):('track|'+e.track.id);let a=voiceRemoteAudios.get(key);if(!a){a=document.createElement('audio');a.autoplay=true;a.playsInline=true;a.dataset.voiceKey=key;voiceSink.appendChild(a);voiceRemoteAudios.set(key,a);}a.srcObject=new MediaStream([e.track]);a.play().then(()=>{voiceUnlockBtn.hidden=true;}).catch(()=>{voiceUnlockBtn.hidden=false;});e.track.addEventListener('ended',()=>{a.remove();voiceRemoteAudios.delete(key);voiceSubscribed.delete(key);},{once:true});});voiceActive=true;sendPacket({t:'voice_publish',sessionId:voiceSendSession,trackName:track.id,enabled:track.enabled});scheduleVoiceDirectory();}finally{voiceStarting=false;setMicUi();}}
async function startVoice(){if(voiceStarting)return;voiceDesired=true;try{if(!voiceLocalStream||!voiceLocalStream.getAudioTracks()[0]||voiceLocalStream.getAudioTracks()[0].readyState==='ended')voiceLocalStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});voiceLocalStream.getAudioTracks()[0].enabled=true;await rebuildVoiceTransport();showToast('语音已开启');}catch(e){voiceDesired=false;stopVoice();showToast('无法开启麦克风：'+e.message,2400);}setMicUi();}
function toggleVoice(){if(!voiceDesired||!voiceLocalStream||!voiceActive){startVoice();return;}const track=voiceLocalStream.getAudioTracks()[0];if(!track)return;track.enabled=!track.enabled;sendPacket({t:'voice_state',enabled:track.enabled});setMicUi();}
function stopVoice(){voiceDesired=false;voiceActive=false;voiceStarting=false;clearTimeout(voiceRestartTimer);clearTimeout(voiceDisconnectTimer);voiceRestartTimer=voiceDisconnectTimer=null;try{sendPacket({t:'voice_state',enabled:false});}catch(_){}for(const t of voiceLocalStream?.getTracks?.()||[])t.stop();voiceLocalStream=null;try{voiceSendPc?.close()}catch(_){}try{voiceRecvPc?.close()}catch(_){}voiceSendPc=voiceRecvPc=null;voiceSendSession=voiceRecvSession='';clearRemoteVoice();voiceUnlockBtn.hidden=true;setMicUi();}
function openVitals(){if(selfState.role!=='scientist'||Number(selfState.abilityUntil||0)<=Date.now())return;vitalsOverlay.classList.add('show');renderVitals();clearInterval(vitalsTimer);vitalsTimer=setInterval(renderVitals,500);}
function closeVitals(){vitalsOverlay.classList.remove('show');clearInterval(vitalsTimer);vitalsTimer=null;}
function renderVitals(){if(!vitalsOverlay.classList.contains('show'))return;if(Number(selfState.abilityUntil||0)<=Date.now()){closeVitals();return;}vitalsGrid.innerHTML=Object.values(players).filter(p=>p.connected).map(p=>'<div class="vital-row">'+avatarMarkup(p)+'<span>'+escapeHtml(p.name)+'</span><span class="vital-state '+(p.alive?'':'dead')+'">'+(p.alive?'存活':'死亡')+'</span></div>').join('');}
function handleServerMessage`,
  'robust SFU voice and vitals'
);

replaceOnce("if(msg.t==='meeting_result'){showToast(msg.text||'投票结束',2200);return;}", "if(msg.t==='meeting_result'){gameState.phase='meeting';gameState.meeting=msg.meeting||gameState.meeting;openMeeting({meeting:gameState.meeting});return;}", 'meeting result handler');
replaceOnce("if(msg.t==='voice_directory'){voiceDirectory=Array.isArray(msg.voices)?msg.voices:[];scheduleVoiceDirectory();return;}", "if(msg.t==='voice_directory'){voiceDirectory=Array.isArray(msg.voices)?msg.voices:[];pruneVoiceDirectory();scheduleVoiceDirectory();return;}", 'voice directory pruning');
replaceOnce("if(msg.t==='ability_ok'){selfState={...selfState,...(msg.selfState||{})};renderActions();return;}", "if(msg.t==='ability_ok'){selfState={...selfState,...(msg.selfState||{})};renderActions();renderGameMeta();if(selfState.role==='scientist'&&Number(selfState.abilityUntil||0)>Date.now())openVitals();return;}if(msg.t==='detective_result'){showToast((msg.targetName||'目标')+' 在最近案件发生时位于 '+(msg.area||'未知区域'),4200);return;}if(msg.t==='noisemaker'){noisemakerPing={x:Number(msg.x),y:Number(msg.y),until:Number(msg.until||Date.now()+6000)};showToast('噪音警报：有船员被击杀',2400);if(minimapOverlay.classList.contains('show'))drawMinimap();return;}if(msg.t==='protected'){selfState.protectedUntil=Number(msg.until||0);showToast('守护天使正在保护你',1800);return;}if(msg.t==='protected_hit'){showToast('守护保护抵挡了一次击杀',2200);return;}if(msg.t==='kill_blocked'){selfState.killReadyAt=Number(msg.killReadyAt||0);showToast('目标受到守护保护',1800);renderActions();return;}", 'role event handlers');
replaceRegex(/if\(msg\.t==='poisoned'\)\{[^\n]*\}\n/, '', 'remove obsolete poison event');
replaceRegex(/if\(msg\.t==='killed'\)\{[^\n]*\}/, "if(msg.t==='killed'){selfState={...selfState,...(msg.selfState||{}),alive:false};if(players[myPlayerId])players[myPlayerId].alive=false;showToast(selfState.ghostRole==='guardian'?'你被击杀了 · 已成为守护天使':'你被击杀了',2600);renderAllUI();return;}", 'killed state handler');
replaceOnce("const params=new URLSearchParams({room,name:myName,create:create?'1':'0',v:'2.4'});", "const params=new URLSearchParams({room,name:myName,create:create?'1':'0',v:'2.5'});", 'protocol 2.5');

replaceRegex(
  /function drawPlayers\(view,p\)\{[^\n]*\}/,
  `function drawPlayers(view,p){const{left,top,tilePx,cameraX,cameraY}=view,now=Date.now(),lights=gameState.sabotage?.type==='lights'&&isCrewRole(selfState.role)&&selfState.alive,vision=3.1;for(const id in players){const pl=players[id];if(!pl.connected)continue;if(pl.inVent&&pl.id!==myPlayerId)continue;if(!pl.alive&&selfState.alive&&pl.id!==myPlayerId)continue;if(pl.hiddenUntil>now&&pl.id!==myPlayerId)continue;const visual=remoteVisuals[pl.id],px=pl.id===myPlayerId?myPos.x:(visual?visual.x:pl.pos.x),py=pl.id===myPlayerId?myPos.y:(visual?visual.y:pl.pos.y);if(Math.abs(px-cameraX)>11||Math.abs(py-cameraY)>11)continue;if(lights&&pl.id!==myPlayerId&&Math.hypot(px-myPos.x,py-myPos.y)>vision)continue;let shown=pl;if(pl.abilityUntil>now&&pl.disguiseTargetId&&players[pl.disguiseTargetId])shown=players[pl.disguiseTargetId];const x=left+(px-(cameraX-VIEW_TILES/2))*tilePx,y=top+(py-(cameraY-VIEW_TILES/2))*tilePx,r=PLAYER_RADIUS*tilePx;ctx.save();if(!pl.alive)ctx.globalAlpha=.38;drawPixelAnimal(x,y,r,shown.color,shown.animal||'chicken',pl.id===myPlayerId?p.text:'rgba(0,0,0,.45)');ctx.font='600 '+Math.max(11,tilePx*.27)+'px system-ui';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle=p.text;ctx.shadowColor=p.labelShadow;ctx.shadowBlur=3;ctx.fillText(shown.name+(pl.id===myPlayerId?' · 你':''),x,y-r-7);ctx.restore();}}`,
  'lights hide remote players'
);

replaceRegex(
  /function drawLightsMask\(view\)\{[^\n]*\}/,
  `function drawLightsMask(view){if(gameState.sabotage?.type!=='lights'||!isCrewRole(selfState.role)||!selfState.alive)return;const{left,top,side,tilePx,cameraX,cameraY}=view,x=left+(myPos.x-(cameraX-VIEW_TILES/2))*tilePx,y=top+(myPos.y-(cameraY-VIEW_TILES/2))*tilePx,r=tilePx*3.1,outer=r+Math.max(10,tilePx*.45),g=ctx.createRadialGradient(x,y,r,x,y,outer);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,1)');ctx.save();ctx.beginPath();ctx.rect(left,top,side,side);ctx.clip();ctx.fillStyle='#000';ctx.fillRect(left,top,side,side);ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle='#000';ctx.fill();ctx.globalCompositeOperation='source-over';ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,outer,0,Math.PI*2);ctx.fill();ctx.restore();}`,
  'actual lights vision'
);

replaceAllChecked("selfState.role==='crewmate'", "isCrewRole(selfState.role)", 'crew rendering checks', 1);

replaceRegex(/abilityBtn\.onclick=\(\)=>\{[^\n]*\};/, `abilityBtn.onclick=()=>{const t=nearestAbilityTarget();sendPacket({t:'ability',targetId:t?.id||''});};`, 'ability click');

replaceRegex(
  /\[ruleMorphers,ruleCloakers,ruleVipers,ruleTasks,ruleSpeed,ruleKill,ruleDiscussion,ruleVoting,ruleEmergency,ruleSabotage,ruleConfirm\]\.forEach\(el=>el\.addEventListener\('change',[^\n]*\);/,
  `[ruleNormalImpostors,ruleShapeshifters,rulePhantoms,ruleVipers,ruleEngineers,ruleScientists,ruleTrackers,ruleNoisemakers,ruleDetectives,ruleGuardianAngels,ruleTasks,ruleSpeed,ruleKill,ruleDiscussion,ruleVoting,ruleEmergency,ruleSabotage,ruleConfirm].forEach(el=>el.addEventListener('change',()=>{const v=currentRules(),imp=v.normalImpostors+v.shapeshifters+v.phantoms+v.vipers,crew=v.engineers+v.scientists+v.trackers+v.noisemakers+v.detectives;impRoleSummary.textContent='总数 '+imp;crewRoleSummary.textContent=crew?'特殊职业 '+crew+' · 其余普通船员':'其余为普通船员';sendRules();}));`,
  'role rule listeners'
);

replaceOnce("mapBtn.onclick=()=>toggleMinimap();micBtn.onclick=toggleVoice;", "mapBtn.onclick=()=>toggleMinimap();micBtn.onclick=toggleVoice;meetingMicBtn.onclick=toggleVoice;meetingChatBtn.onclick=()=>toggleChat();voiceUnlockBtn.onclick=unlockVoicePlayback;vitalsClose.onclick=closeVitals;moreBtn.onclick=e=>{e.stopPropagation();const show=hudMoreMenu.hidden;hudMoreMenu.hidden=!show;moreBtn.setAttribute('aria-expanded',String(show));};document.addEventListener('click',e=>{if(!hudMoreMenu.hidden&&!e.target.closest('#hudMoreWrap')){hudMoreMenu.hidden=true;moreBtn.setAttribute('aria-expanded','false');}});", 'tool events');
replaceOnce("settingsBtn.onclick=toggleTheme;", "settingsBtn.onclick=()=>{toggleTheme();hudMoreMenu.hidden=true;moreBtn.setAttribute('aria-expanded','false');};", 'more theme action');
replaceOnce("leaveBtn.onclick=()=>{if(confirm('确定要退出房间吗？'))leaveGame(true);};", "leaveBtn.onclick=()=>{hudMoreMenu.hidden=true;if(confirm('确定要退出房间吗？'))leaveGame(true);};", 'more leave action');
replaceOnce("window.addEventListener('resize',()=>{checkOrientation();resizeCanvas();});", "window.addEventListener('resize',()=>{checkOrientation();resizeCanvas();setMicUi();});", 'responsive mic label');

new Function(src);
fs.writeFileSync('game.js', src);
console.log('[dtam] gameplay 2.5 patch applied', hits);
