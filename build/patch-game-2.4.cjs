const fs = require('fs');

let src = fs.readFileSync('game.js', 'utf8');
const hits = {};
function replaceOnce(before, after, name) {
  const count = src.split(before).length - 1;
  hits[name] = count;
  if (count !== 1) throw new Error(`[2.4 patch] ${name}: expected 1 match, got ${count}`);
  src = src.replace(before, after);
}
function replaceAllChecked(before, after, name, min = 1) {
  const count = src.split(before).length - 1;
  hits[name] = count;
  if (count < min) throw new Error(`[2.4 patch] ${name}: expected at least ${min}, got ${count}`);
  src = src.split(before).join(after);
}
function replaceRegexOnce(re, after, name) {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const count = Array.from(src.matchAll(new RegExp(re.source, flags))).length;
  hits[name] = count;
  if (count !== 1) throw new Error(`[2.4 patch] ${name}: expected 1 regex match, got ${count}`);
  src = src.replace(re, after);
}

replaceOnce(
  "const REALTIME_ORIGIN = 'wss://rt-d1.lunarlab.uk';",
  "const REALTIME_ORIGIN = 'wss://rt-d1.lunarlab.uk';\nconst VOICE_API = 'https://rt-d1.lunarlab.uk/voice';\nconst IMPOSTOR_ROLES = new Set(['morpher','cloaker','viper']);\nconst ROLE_META = {morpher:{label:'变形',action:'变形',desc:'靠近玩家后短暂伪装成对方。'},cloaker:{label:'隐身',action:'隐身',desc:'短时间从其他玩家视野中消失。'},viper:{label:'毒蛇',action:'下毒',desc:'近距离下毒，数秒后目标倒下。'},crewmate:{label:'船员',action:'',desc:'完成任务，找出并投出所有内鬼。'}};\nconst isImpostorRole = role => IMPOSTOR_ROLES.has(role);",
  'role constants'
);
replaceOnce(
  "const DEFAULT_SETTINGS = {impostors:1,tasksPerCrew:4,moveSpeed:4.6,killCooldown:20,discussion:12,voting:30,emergencyMeetings:1,sabotageCooldown:20,confirmEjects:true};",
  "const DEFAULT_SETTINGS = {morphers:1,cloakers:0,vipers:0,impostors:1,tasksPerCrew:4,moveSpeed:4.6,killCooldown:20,discussion:12,voting:30,emergencyMeetings:1,sabotageCooldown:20,confirmEjects:true};",
  'default role settings'
);

replaceRegexOnce(
  /<label>内鬼<select id="ruleImpostors">[\s\S]*?<\/select><\/label>/,
  '<label>变形<select id="ruleMorphers"><option>0</option><option selected>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>\\n      <label>隐身<select id="ruleCloakers"><option selected>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>\\n      <label>毒蛇<select id="ruleVipers"><option selected>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>\\n      <div class="role-count-note" id="roleCountNote">内鬼总数 1</div>',
  'role settings controls'
);
replaceOnce(
  '    <button type="button" id="sabotageBtn" disabled>破坏</button>',
  '    <button type="button" id="abilityBtn" disabled>能力</button>\\n    <button type="button" id="sabotageBtn" disabled>破坏</button>',
  'ability action button'
);
replaceOnce(
  "}\ninjectGameplayUI();",
  "  const mini=document.createElement('div');mini.id='minimapOverlay';mini.innerHTML='<div id=\"minimapCard\"><div id=\"minimapHead\"><span>任务地图</span><button type=\"button\" id=\"minimapClose\" aria-label=\"关闭地图\">×</button></div><canvas id=\"minimapCanvas\" width=\"300\" height=\"300\"></canvas><div id=\"minimapLegend\"><span style=\"color:#2563eb\"><i></i>任务</span><span style=\"color:#dc2626\"><i></i>紧急修复</span><span style=\"color:#f8fafc\"><i></i>你</span></div></div>';game.appendChild(mini);\n  const sink=document.createElement('div');sink.id='voiceSink';sink.className='voice-sink';game.appendChild(sink);\n}\ninjectGameplayUI();",
  'minimap and voice sink'
);

replaceOnce(
  "const lobbyPanel=$('lobbyPanel'),lobbyHint=$('lobbyHint'),startGameBtn=$('startGameBtn'),reportBtn=$('reportBtn'),killBtn=$('killBtn'),sabotageBtn=$('sabotageBtn'),ventBtn=$('ventBtn'),infoBtn=$('infoBtn');",
  "const lobbyPanel=$('lobbyPanel'),lobbyHint=$('lobbyHint'),startGameBtn=$('startGameBtn'),reportBtn=$('reportBtn'),killBtn=$('killBtn'),abilityBtn=$('abilityBtn'),sabotageBtn=$('sabotageBtn'),ventBtn=$('ventBtn'),infoBtn=$('infoBtn');",
  'ability reference'
);
replaceOnce(
  "const infoOverlay=$('infoOverlay'),infoTitle=$('infoTitle'),infoBody=$('infoBody'),infoClose=$('infoClose');\nconst ruleImpostors=$('ruleImpostors'),ruleTasks=$('ruleTasks'),ruleSpeed=$('ruleSpeed'),ruleKill=$('ruleKill'),ruleDiscussion=$('ruleDiscussion'),ruleVoting=$('ruleVoting'),ruleEmergency=$('ruleEmergency'),ruleSabotage=$('ruleSabotage'),ruleConfirm=$('ruleConfirm');",
  "const infoOverlay=$('infoOverlay'),infoTitle=$('infoTitle'),infoBody=$('infoBody'),infoClose=$('infoClose');\nconst mapBtn=$('mapBtn'),micBtn=$('micBtn'),minimapOverlay=$('minimapOverlay'),minimapCanvas=$('minimapCanvas'),minimapClose=$('minimapClose'),voiceSink=$('voiceSink');\nconst avatarInput=$('avatarInput'),avatarChooseBtn=$('avatarChooseBtn'),avatarClearBtn=$('avatarClearBtn'),avatarPreview=$('avatarPreview');\nconst ruleMorphers=$('ruleMorphers'),ruleCloakers=$('ruleCloakers'),ruleVipers=$('ruleVipers'),roleCountNote=$('roleCountNote'),ruleTasks=$('ruleTasks'),ruleSpeed=$('ruleSpeed'),ruleKill=$('ruleKill'),ruleDiscussion=$('ruleDiscussion'),ruleVoting=$('ruleVoting'),ruleEmergency=$('ruleEmergency'),ruleSabotage=$('ruleSabotage'),ruleConfirm=$('ruleConfirm');",
  '2.4 references'
);
replaceOnce(
  "let players={},remoteVisuals={},myPos={x:75.5,y:75.5},messages=[],bodies=[];",
  "let players={},profiles={},remoteVisuals={},myPos={x:75.5,y:75.5},messages=[],bodies=[],voiceDirectory=[];",
  'profile and voice stores'
);
replaceAllChecked(
  "role:'',alive:true,tasks:[],fakeTasks:[],completed:[],killReadyAt:0,sabotageReadyAt:0,emergencyUsed:0,inVent:false,ventId:''",
  "role:'',roleLabel:'',alive:true,tasks:[],fakeTasks:[],completed:[],allies:[],killReadyAt:0,abilityReadyAt:0,abilityUntil:0,sabotageReadyAt:0,emergencyUsed:0,inVent:false,ventId:''",
  'self state fields',
  2
);
replaceOnce(
  "let infoMode='',infoTimer=null;",
  "let infoMode='',infoTimer=null,minimapTimer=null,minimapBase=null;\nlet voiceSendPc=null,voiceRecvPc=null,voiceLocalStream=null,voiceSendSession='',voiceRecvSession='',voiceActive=false,voiceStarting=false,voiceSubscribed=new Set(),voicePullChain=Promise.resolve();",
  'feature state vars'
);

replaceRegexOnce(
  /function sessionKey\(room\)\{[\s\S]*?function clearResumeToken\(room\)\{[^\n]*\}/,
  "function sessionKey(room,name=myName){return 'au-dtam-resume:'+room+':'+encodeURIComponent(sanitizeName(name));}\nfunction loadResumeToken(room){try{return localStorage.getItem(sessionKey(room))||sessionStorage.getItem('au-dtam-session:'+room)||'';}catch(_){return'';}}\nfunction saveResumeToken(room,token){try{localStorage.setItem(sessionKey(room),token);sessionStorage.removeItem('au-dtam-session:'+room);}catch(_){}}\nfunction clearResumeToken(room){try{localStorage.removeItem(sessionKey(room));sessionStorage.removeItem('au-dtam-session:'+room);}catch(_){}}",
  'persistent secure resume token'
);
replaceOnce(
  "currentRoom=room;if(!resumeToken)resumeToken=loadResumeToken(room);intentionalClose=false;",
  "currentRoom=room;if(!resumeToken&&!create)resumeToken=loadResumeToken(room);intentionalClose=false;",
  'do not resume while creating'
);
replaceOnce("v:'2.3'", "v:'2.4'", 'protocol 2.4');

replaceRegexOnce(
  /function normalizePlayers\(raw\)\{[^\n]*\}/,
  "function normalizePlayers(raw){const out={};for(const p of Array.isArray(raw)?raw:Object.values(raw||{})){if(!p?.id)continue;out[String(p.id)]={id:String(p.id),name:sanitizeName(p.name),color:COLORS.includes(p.color)?p.color:COLORS[0],pos:{x:Number(p.pos?.x)||75.5,y:Number(p.pos?.y)||75.5},isHost:!!p.isHost,connected:p.connected!==false,alive:p.alive!==false,inVent:!!p.inVent,animal:String(p.animal||'chicken'),disguiseTargetId:String(p.disguiseTargetId||''),abilityUntil:Number(p.abilityUntil||0),hiddenUntil:Number(p.hiddenUntil||0)};}return out;}\nfunction normalizeProfiles(raw){const out={};for(const p of Array.isArray(raw)?raw:[]){if(!p?.id)continue;out[String(p.id)]={animal:String(p.animal||'chicken'),avatar:String(p.avatar||'')};}return out;}\nfunction profileFor(id){return profiles[id]||{animal:players[id]?.animal||'chicken',avatar:''};}\nfunction avatarMarkup(p){const pr=profileFor(p.id);return pr.avatar?'<img class=\"avatar-mini\" src=\"'+escapeHtml(pr.avatar)+'\" alt=\"\">':'<span class=\"avatar-placeholder\">'+escapeHtml((p.name||'?').slice(0,1))+'</span>';}\nfunction avatarKey(name=myName){return 'au-dtam-avatar:'+encodeURIComponent(sanitizeName(name));}\nfunction loadAvatar(name=myName){try{return localStorage.getItem(avatarKey(name))||'';}catch(_){return'';}}\nfunction saveAvatar(data,name=myName){try{if(data)localStorage.setItem(avatarKey(name),data);else localStorage.removeItem(avatarKey(name));}catch(_){}}\nfunction renderAvatarPreview(){const data=loadAvatar(sanitizeName(nameInput.value));avatarPreview.innerHTML=data?'<img src=\"'+escapeHtml(data)+'\" alt=\"\">':'头像';}\nfunction syncAvatarProfile(){if(socket&&socket.readyState===WebSocket.OPEN)sendPacket({t:'profile',avatar:loadAvatar(myName)});}\nasync function processAvatarFile(file){if(!file||!file.type.startsWith('image/'))throw new Error('请选择图片文件');const url=URL.createObjectURL(file);try{const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=()=>rej(new Error('图片读取失败'));img.src=url;});const side=Math.min(img.naturalWidth,img.naturalHeight),sx=(img.naturalWidth-side)/2,sy=(img.naturalHeight-side)/2;for(const size of [28,24,20,16]){const c=document.createElement('canvas');c.width=c.height=size;const x=c.getContext('2d');x.imageSmoothingEnabled=true;x.drawImage(img,sx,sy,side,side,0,0,size,size);for(const q of [.72,.58,.44]){const data=c.toDataURL('image/webp',q);if(data.length<=5000)return data;}}throw new Error('头像压缩后仍然过大');}finally{URL.revokeObjectURL(url);}}",
  'profiles and avatar helpers'
);

replaceRegexOnce(
  /function renderPlayerPanel\(\)\{[\s\S]*?\}\nfunction togglePlayerPanel/,
  "function renderPlayerPanel(){const list=Object.values(players).sort((a,b)=>(b.isHost?1:0)-(a.isHost?1:0)||a.name.localeCompare(b.name));playerPanelBody.innerHTML=list.map(p=>{const me=p.id===myPlayerId,canKick=isHost&&!me&&gameState.phase==='lobby';return '<div class=\"player-row '+(p.alive?'':'dead-row')+'\">'+avatarMarkup(p)+'<span class=\"color-dot\" style=\"background:'+escapeHtml(p.color)+'\"></span><span class=\"player-name\">'+escapeHtml(p.name)+(me?' · 你':'')+(p.connected?'':' · 离线')+'</span>'+(p.isHost?'<span class=\"host-badge\">房主</span>':'')+(!p.alive?'<span class=\"dead-badge\">死亡</span>':'')+(canKick?'<button type=\"button\" class=\"kick-btn\" data-player-id=\"'+escapeHtml(p.id)+'\">移出</button>':'')+'</div>';}).join('')||'<div class=\"empty-msg\">暂无玩家</div>';playerPanelBody.querySelectorAll('.kick-btn').forEach(btn=>btn.onclick=()=>kickPlayer(btn.dataset.playerId));}\nfunction togglePlayerPanel",
  'avatar player list'
);

replaceRegexOnce(
  /function currentRules\(\)\{[^\n]*\}/,
  "function currentRules(){return{morphers:Number(ruleMorphers.value),cloakers:Number(ruleCloakers.value),vipers:Number(ruleVipers.value),tasksPerCrew:Number(ruleTasks.value),moveSpeed:Number(ruleSpeed.value),killCooldown:Number(ruleKill.value),discussion:Number(ruleDiscussion.value),voting:Number(ruleVoting.value),emergencyMeetings:Number(ruleEmergency.value),sabotageCooldown:Number(ruleSabotage.value),confirmEjects:!!ruleConfirm.checked};}",
  'role current rules'
);
replaceRegexOnce(
  /function syncRulesUI\(\)\{[^\n]*\}/,
  "function syncRulesUI(){const st={...DEFAULT_SETTINGS,...(gameState.settings||{})};const fields=[[ruleMorphers,st.morphers],[ruleCloakers,st.cloakers],[ruleVipers,st.vipers],[ruleTasks,st.tasksPerCrew],[ruleSpeed,st.moveSpeed],[ruleKill,st.killCooldown],[ruleDiscussion,st.discussion],[ruleVoting,st.voting],[ruleEmergency,st.emergencyMeetings],[ruleSabotage,st.sabotageCooldown]];for(const [el,v] of fields){el.value=String(v);el.disabled=!isHost;}ruleConfirm.checked=!!st.confirmEjects;ruleConfirm.disabled=!isHost;roleCountNote.textContent='内鬼总数 '+(Number(st.morphers||0)+Number(st.cloakers||0)+Number(st.vipers||0));}",
  'sync role controls'
);
replaceAllChecked("selfState.role==='impostor'", "isImpostorRole(selfState.role)", 'client impostor positive checks', 4);
replaceAllChecked("selfState.role!=='impostor'", "!isImpostorRole(selfState.role)", 'client impostor negative checks', 2);
replaceOnce(
  "roleLabel.textContent=selfState.alive?(selfState.inVent?'内鬼 · 通风管':'内鬼'):'内鬼 · 已死亡';",
  "roleLabel.textContent=selfState.alive?(selfState.inVent?(selfState.roleLabel||ROLE_META[selfState.role]?.label||'内鬼')+' · 通风管':(selfState.roleLabel||ROLE_META[selfState.role]?.label||'内鬼')):(selfState.roleLabel||ROLE_META[selfState.role]?.label||'内鬼')+' · 已死亡';",
  'role label meta'
);
replaceOnce(
  "if(p.id===myPlayerId||!p.alive||!p.connected||p.inVent)continue;",
  "if(p.id===myPlayerId||!p.alive||!p.connected||p.inVent||(selfState.allies||[]).includes(p.id))continue;",
  'skip impostor allies for kill'
);
replaceOnce(
  "function nearestAssignedTask(){",
  "function nearestAbilityTarget(){if(!isImpostorRole(selfState.role)||!selfState.alive||selfState.inVent||gameState.phase!=='playing'||selfState.role==='cloaker')return null;const maxD=selfState.role==='morpher'?1.75:1.25;let best=null,bestD=maxD;for(const p of Object.values(players)){if(p.id===myPlayerId||!p.alive||!p.connected||p.inVent)continue;if(selfState.role==='viper'&&(selfState.allies||[]).includes(p.id))continue;const v=remoteVisuals[p.id],px=v?v.x:p.pos.x,py=v?v.y:p.pos.y,d=Math.hypot(myPos.x-px,myPos.y-py);if(d<bestD){best=p;bestD=d;}}return best;}\nfunction nearestAssignedTask(){",
  'ability target helper'
);

replaceRegexOnce(
  /function renderActions\(\)\{[\s\S]*?\}\n\nfunction sendPacket/,
  "function renderActions(){const playing=gameState.phase==='playing';const body=nearestBody(),target=nearestKillTarget(),abilityTarget=nearestAbilityTarget(),task=nearestAssignedTask(),repair=nearestSabotageStation(),vent=nearestVent(),info=nearbyInfo();reportBtn.disabled=!body;reportBtn.textContent=body?'报告尸体':'报告';const imp=isImpostorRole(selfState.role),cooldown=Math.max(0,Math.ceil((selfState.killReadyAt-Date.now())/1000));killBtn.style.display=imp?'block':'none';killBtn.disabled=!target||cooldown>0||!playing||selfState.inVent;killBtn.textContent=cooldown>0?'击杀 '+cooldown+'s':(target?'击杀 '+target.name:'击杀');const abilityCd=Math.max(0,Math.ceil((Number(selfState.abilityReadyAt||0)-Date.now())/1000)),meta=ROLE_META[selfState.role];abilityBtn.style.display=imp?'block':'none';if(imp){let can=selfState.role==='cloaker'||!!abilityTarget;abilityBtn.disabled=!playing||!selfState.alive||selfState.inVent||abilityCd>0||!can;abilityBtn.textContent=abilityCd>0?(meta?.action||'能力')+' '+abilityCd+'s':selfState.role==='cloaker'?'隐身':abilityTarget?(meta?.action||'能力')+' '+abilityTarget.name:(meta?.action||'能力');}const sabCd=Math.max(0,Math.ceil((selfState.sabotageReadyAt-Date.now())/1000));sabotageBtn.style.display=imp?'block':'none';sabotageBtn.disabled=!playing||!selfState.alive||selfState.inVent||!!gameState.sabotage||sabCd>0;sabotageBtn.textContent=gameState.sabotage?'破坏进行中':sabCd>0?'破坏 '+sabCd+'s':'破坏';ventBtn.style.display=imp?'block':'none';ventBtn.disabled=!playing||!selfState.alive||(!selfState.inVent&&!vent);ventBtn.textContent=selfState.inVent?'通风管':vent?'进入通风管':'通风管';infoBtn.disabled=!info;infoBtn.textContent=info?(info.mode==='cams'?'监控':'Admin'):'设备';if(!playing||selfState.inVent){interactBtn.disabled=true;interactBtn.textContent=selfState.inVent?'通风管内':'互动';return;}if(repair){interactBtn.disabled=false;interactBtn.textContent='修复 '+(gameState.sabotage.label||'破坏');interactBtn.title=repair.label;}else if(task){interactBtn.disabled=false;interactBtn.textContent='执行任务';interactBtn.title=task.label;}else if(canEmergency()){interactBtn.disabled=false;interactBtn.textContent='紧急会议';interactBtn.title='呼叫紧急会议';}else{interactBtn.disabled=true;interactBtn.textContent=selfState.alive?'互动':'幽灵';interactBtn.title='靠近任务、修复点或中央控制台';}}\n\nfunction sendPacket",
  'role actions rendering'
);
replaceRegexOnce(
  /function showRoleReveal\(\)\{[^\n]*\}/,
  "function showRoleReveal(){const meta=ROLE_META[selfState.role]||ROLE_META.crewmate;roleRevealName.textContent=meta.label;roleRevealName.className=isImpostorRole(selfState.role)?'impostor':'crewmate';roleRevealDesc.textContent=isImpostorRole(selfState.role)?meta.desc+' 你仍可击杀、破坏和使用通风管。':meta.desc;roleReveal.classList.add('show');setTimeout(()=>roleReveal.classList.remove('show'),3200);}",
  'special role reveal'
);

replaceRegexOnce(
  /function drawPlayers\(view,p\)\{[\s\S]*?\}\nfunction drawLightsMask/,
  "function drawPixelAnimal(x,y,r,color,animal,outline){const u=Math.max(1,Math.round(r/5));x=Math.round(x);y=Math.round(y);ctx.fillStyle=outline;ctx.fillRect(x-4*u,y-3*u,8*u,7*u);ctx.fillStyle=color;ctx.fillRect(x-3*u,y-2*u,6*u,5*u);ctx.fillRect(x-2*u,y-4*u,4*u,3*u);ctx.fillStyle='#111827';ctx.fillRect(x+u,y-3*u,u,u);if(animal==='chicken'){ctx.fillStyle='#f59e0b';ctx.fillRect(x+2*u,y-2*u,2*u,u);ctx.fillStyle='#ef4444';ctx.fillRect(x-u,y-5*u,u,u);ctx.fillRect(x,y-5*u,u,u);}else if(animal==='rabbit'){ctx.fillStyle=color;ctx.fillRect(x-2*u,y-7*u,2*u,4*u);ctx.fillRect(x+u,y-7*u,2*u,4*u);ctx.fillStyle='#f9a8d4';ctx.fillRect(x-u,y-6*u,u,2*u);ctx.fillRect(x+u,y-6*u,u,2*u);}else if(animal==='cat'){ctx.fillStyle=color;ctx.fillRect(x-3*u,y-5*u,2*u,2*u);ctx.fillRect(x+u,y-5*u,2*u,2*u);ctx.fillRect(x+3*u,y,u,3*u);}else if(animal==='raccoon'){ctx.fillStyle='#374151';ctx.fillRect(x-2*u,y-3*u,4*u,u);ctx.fillRect(x+3*u,y,u,3*u);ctx.fillStyle='#9ca3af';ctx.fillRect(x+4*u,y+u,2*u,u);}else if(animal==='goat'){ctx.fillStyle='#d1d5db';ctx.fillRect(x-3*u,y-6*u,u,3*u);ctx.fillRect(x+2*u,y-6*u,u,3*u);ctx.fillStyle=color;ctx.fillRect(x+3*u,y+u,2*u,u);}else{ctx.fillStyle=color;ctx.fillRect(x-3*u,y-5*u,2*u,2*u);ctx.fillRect(x+u,y-5*u,2*u,2*u);ctx.fillRect(x+3*u,y,3*u,2*u);ctx.fillStyle='#f8fafc';ctx.fillRect(x+4*u,y+u,2*u,u);}ctx.fillStyle=outline;ctx.fillRect(x-3*u,y+3*u,2*u,u);ctx.fillRect(x+u,y+3*u,2*u,u);}\nfunction drawPlayers(view,p){const{left,top,tilePx,cameraX,cameraY}=view,now=Date.now();for(const id in players){const pl=players[id];if(!pl.connected)continue;if(pl.inVent&&pl.id!==myPlayerId)continue;if(!pl.alive&&selfState.alive&&pl.id!==myPlayerId)continue;if(pl.hiddenUntil>now&&pl.id!==myPlayerId)continue;const visual=remoteVisuals[pl.id],px=pl.id===myPlayerId?myPos.x:(visual?visual.x:pl.pos.x),py=pl.id===myPlayerId?myPos.y:(visual?visual.y:pl.pos.y);if(Math.abs(px-cameraX)>11||Math.abs(py-cameraY)>11)continue;let shown=pl;if(pl.abilityUntil>now&&pl.disguiseTargetId&&players[pl.disguiseTargetId])shown=players[pl.disguiseTargetId];const x=left+(px-(cameraX-VIEW_TILES/2))*tilePx,y=top+(py-(cameraY-VIEW_TILES/2))*tilePx,r=PLAYER_RADIUS*tilePx;ctx.save();if(!pl.alive)ctx.globalAlpha=.38;drawPixelAnimal(x,y,r,shown.color,shown.animal||'chicken',pl.id===myPlayerId?p.text:'rgba(0,0,0,.45)');ctx.font='600 '+Math.max(11,tilePx*.27)+'px system-ui';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle=p.text;ctx.shadowColor=p.labelShadow;ctx.shadowBlur=3;ctx.fillText(shown.name+(pl.id===myPlayerId?' · 你':''),x,y-r-7);ctx.restore();}}\nfunction drawLightsMask",
  'pixel animal rendering'
);

replaceOnce(
  "function closeToolOverlays(){closeSabotage();if(!selfState.inVent)ventOverlay.classList.remove('show');closeInfo();}",
  "function ensureMinimapBase(){if(minimapBase)return minimapBase;const c=document.createElement('canvas');c.width=c.height=300;const x=c.getContext('2d'),s=2;x.fillStyle=document.documentElement.dataset.theme==='dark'?'#11151a':'#f5f6f7';x.fillRect(0,0,300,300);x.fillStyle=document.documentElement.dataset.theme==='dark'?'#3b4551':'#9da7b4';for(let row=0;row<MAP_SIZE;row++)for(let col=0;col<MAP_SIZE;col++)if(isWallCell(col,row))x.fillRect(col*s,row*s,s,s);minimapBase=c;return c;}\nfunction drawMinimap(){if(!minimapOverlay.classList.contains('show'))return;const x=minimapCanvas.getContext('2d'),base=ensureMinimapBase(),s=2;x.clearRect(0,0,300,300);x.drawImage(base,0,0);const ids=selfState.role==='crewmate'?selfState.tasks:(selfState.fakeTasks||[]);x.fillStyle='#2563eb';for(const id of ids){if(selfState.completed.includes(id))continue;const o=objById(id);if(o)x.fillRect(Math.round(o.x*s)-4,Math.round(o.y*s)-4,8,8);}if(gameState.sabotage){x.fillStyle='#dc2626';for(const id of gameState.sabotage.requiredStations||[]){if(gameState.sabotage.fixedStations?.includes(id))continue;const o=objById(id);if(o)x.fillRect(Math.round(o.x*s)-5,Math.round(o.y*s)-5,10,10);}}x.fillStyle='#f8fafc';x.fillRect(Math.round(myPos.x*s)-3,Math.round(myPos.y*s)-3,6,6);x.strokeStyle='#111827';x.strokeRect(Math.round(myPos.x*s)-4,Math.round(myPos.y*s)-4,8,8);}\nfunction toggleMinimap(force){const show=typeof force==='boolean'?force:!minimapOverlay.classList.contains('show');minimapOverlay.classList.toggle('show',show);mapBtn.setAttribute('aria-expanded',String(show));clearInterval(minimapTimer);minimapTimer=null;if(show){drawMinimap();minimapTimer=setInterval(drawMinimap,200);}}\nfunction closeToolOverlays(){closeSabotage();if(!selfState.inVent)ventOverlay.classList.remove('show');closeInfo();toggleMinimap(false);}",
  'cached minimap functions'
);

replaceOnce(
  "function handleServerMessage(data){",
  "async function voiceApi(path,method='POST',payload){const url=VOICE_API+path+(path.includes('?')?'&':'?')+'room='+encodeURIComponent(currentRoom);const headers={'x-dtam-token':resumeToken};let body;if(payload!==undefined){headers['content-type']='application/json';body=JSON.stringify(payload);}const r=await fetch(url,{method,headers,body});let data={};try{data=await r.json();}catch(_){}if(!r.ok||data.errorCode)throw new Error(data.errorDescription||data.error||('语音服务 '+r.status));return data;}\nfunction newVoicePc(){return new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}],bundlePolicy:'max-bundle'});}\nasync function pullVoiceDirectory(){if(!voiceActive||!voiceRecvPc||!voiceRecvSession)return;const pending=voiceDirectory.filter(v=>v.playerId!==myPlayerId&&v.enabled&&v.connected&&v.sessionId&&v.trackName&&!voiceSubscribed.has(v.sessionId+'|'+v.trackName));if(!pending.length)return;const keys=pending.map(v=>v.sessionId+'|'+v.trackName);const res=await voiceApi('/sessions/'+encodeURIComponent(voiceRecvSession)+'/tracks/new','POST',{tracks:pending.map(v=>({location:'remote',sessionId:v.sessionId,trackName:v.trackName}))});if(res.requiresImmediateRenegotiation&&res.sessionDescription){await voiceRecvPc.setRemoteDescription(res.sessionDescription);const answer=await voiceRecvPc.createAnswer();await voiceRecvPc.setLocalDescription(answer);await voiceApi('/sessions/'+encodeURIComponent(voiceRecvSession)+'/renegotiate','PUT',{sessionDescription:{sdp:answer.sdp,type:'answer'}});}keys.forEach(k=>voiceSubscribed.add(k));}\nfunction scheduleVoiceDirectory(){voicePullChain=voicePullChain.then(pullVoiceDirectory).catch(e=>showToast('语音订阅失败：'+e.message,1800));}\nfunction setMicUi(){if(voiceStarting){micBtn.dataset.state='busy';micBtn.textContent='麦克风…';return;}const track=voiceLocalStream?.getAudioTracks?.()[0],on=!!track?.enabled;micBtn.dataset.state=on?'on':'off';micBtn.textContent=on?'麦克风开':'麦克风关';}\nasync function startVoice(){if(voiceStarting||voiceActive)return;voiceStarting=true;setMicUi();try{voiceLocalStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});const track=voiceLocalStream.getAudioTracks()[0];voiceSendSession=(await voiceApi('/sessions/new')).sessionId;voiceSendPc=newVoicePc();const tx=voiceSendPc.addTransceiver(track,{direction:'sendonly'}),offer=await voiceSendPc.createOffer();await voiceSendPc.setLocalDescription(offer);const pushed=await voiceApi('/sessions/'+encodeURIComponent(voiceSendSession)+'/tracks/new','POST',{sessionDescription:{sdp:offer.sdp,type:'offer'},tracks:[{location:'local',mid:tx.mid,trackName:track.id}]});await voiceSendPc.setRemoteDescription(pushed.sessionDescription);voiceRecvSession=(await voiceApi('/sessions/new')).sessionId;voiceRecvPc=newVoicePc();voiceRecvPc.addEventListener('track',e=>{const a=document.createElement('audio');a.autoplay=true;a.playsInline=true;a.srcObject=new MediaStream([e.track]);voiceSink.appendChild(a);a.play().catch(()=>{});e.track.addEventListener('ended',()=>a.remove(),{once:true});});voiceActive=true;sendPacket({t:'voice_publish',sessionId:voiceSendSession,trackName:track.id,enabled:true});scheduleVoiceDirectory();showToast('语音已开启');}catch(e){stopVoice();showToast('无法开启麦克风：'+e.message,2400);}finally{voiceStarting=false;setMicUi();}}\nfunction toggleVoice(){if(!voiceActive){startVoice();return;}const track=voiceLocalStream?.getAudioTracks?.()[0];if(!track)return;track.enabled=!track.enabled;sendPacket({t:'voice_state',enabled:track.enabled});setMicUi();}\nfunction stopVoice(){try{sendPacket({t:'voice_state',enabled:false});}catch(_){}for(const t of voiceLocalStream?.getTracks?.()||[])t.stop();voiceLocalStream=null;try{voiceSendPc?.close()}catch(_){}try{voiceRecvPc?.close()}catch(_){}voiceSendPc=voiceRecvPc=null;voiceSendSession=voiceRecvSession='';voiceActive=voiceStarting=false;voiceSubscribed.clear();voiceSink.innerHTML='';setMicUi();}\nfunction handleServerMessage(data){",
  'SFU voice client'
);

replaceOnce(
  "players=normalizePlayers(msg.players);if(players[myPlayerId]){myPos={...players[myPlayerId].pos};myName=players[myPlayerId].name;}",
  "players=normalizePlayers(msg.players);profiles=normalizeProfiles(msg.profiles);voiceDirectory=Array.isArray(msg.voices)?msg.voices:[];if(players[myPlayerId]){myPos={...players[myPlayerId].pos};myName=players[myPlayerId].name;}",
  'welcome profile voice dirs'
);
replaceOnce(
  "if(connectResolve)connectResolve();clearTimeout(connectTimeout);connectTimeout=null;connectResolve=null;connectReject=null;if(msg.resumed)showToast('连接已恢复');return;",
  "syncAvatarProfile();if(voiceActive&&voiceSendSession&&voiceLocalStream?.getAudioTracks?.()[0])sendPacket({t:'voice_publish',sessionId:voiceSendSession,trackName:voiceLocalStream.getAudioTracks()[0].id,enabled:voiceLocalStream.getAudioTracks()[0].enabled});scheduleVoiceDirectory();if(connectResolve)connectResolve();clearTimeout(connectTimeout);connectTimeout=null;connectResolve=null;connectReject=null;if(msg.resumed)showToast('连接已恢复原玩家编号');return;",
  'welcome sync profile voice'
);
replaceOnce(
  "  if(msg.t==='chat'){addMessage(msg.name,msg.text,msg.at);return;}",
  "  if(msg.t==='profile'){const id=String(msg.id||'');if(id)profiles[id]={animal:String(msg.animal||players[id]?.animal||'chicken'),avatar:String(msg.avatar||'')};if(playerPanelVisible)renderPlayerPanel();return;}\n  if(msg.t==='voice_directory'){voiceDirectory=Array.isArray(msg.voices)?msg.voices:[];scheduleVoiceDirectory();return;}\n  if(msg.t==='ability_ok'){selfState={...selfState,...(msg.selfState||{})};renderActions();return;}\n  if(msg.t==='poisoned'){showToast('你中了毒，尽快召开会议或行动',1800);return;}\n  if(msg.t==='chat'){addMessage(msg.name,msg.text,msg.at);return;}",
  '2.4 message handlers'
);

replaceOnce(
  "killBtn.onclick=()=>{const t=nearestKillTarget();if(t)sendPacket({t:'kill',targetId:t.id});};",
  "killBtn.onclick=()=>{const t=nearestKillTarget();if(t)sendPacket({t:'kill',targetId:t.id});};abilityBtn.onclick=()=>{const t=nearestAbilityTarget();sendPacket({t:'ability',targetId:t?.id||''});};",
  'ability click'
);
replaceOnce(
  "[ruleImpostors,ruleTasks,ruleSpeed,ruleKill,ruleDiscussion,ruleVoting,ruleEmergency,ruleSabotage,ruleConfirm].forEach(el=>el.addEventListener('change',sendRules));",
  "[ruleMorphers,ruleCloakers,ruleVipers,ruleTasks,ruleSpeed,ruleKill,ruleDiscussion,ruleVoting,ruleEmergency,ruleSabotage,ruleConfirm].forEach(el=>el.addEventListener('change',()=>{syncRulesUI();sendRules();}));",
  'role rule listeners'
);
replaceOnce(
  "settingsBtn.onclick=toggleTheme;menuThemeBtn.onclick=toggleTheme;roomIdDisplay.onclick=async()=>{",
  "settingsBtn.onclick=toggleTheme;menuThemeBtn.onclick=toggleTheme;mapBtn.onclick=()=>toggleMinimap();minimapClose.onclick=()=>toggleMinimap(false);micBtn.onclick=toggleVoice;avatarChooseBtn.onclick=()=>avatarInput.click();avatarClearBtn.onclick=()=>{saveAvatar('',sanitizeName(nameInput.value));renderAvatarPreview();if(myPlayerId)syncAvatarProfile();};avatarInput.onchange=async()=>{try{const data=await processAvatarFile(avatarInput.files?.[0]);saveAvatar(data,sanitizeName(nameInput.value));renderAvatarPreview();if(myPlayerId)syncAvatarProfile();}catch(e){setMenuStatus(e.message,'error');}finally{avatarInput.value='';}};nameInput.addEventListener('change',renderAvatarPreview);roomIdDisplay.onclick=async()=>{",
  'map mic avatar events'
);
replaceOnce(
  "function leaveGame(sendLeave=true,menuText='已退出房间'){intentionalClose=true;",
  "function leaveGame(sendLeave=true,menuText='已退出房间'){stopVoice();toggleMinimap(false);intentionalClose=true;",
  'cleanup voice on leave'
);
replaceOnce(
  "const defaultName='玩家'+Math.floor(Math.random()*1000);nameInput.value=defaultName;myName=defaultName;showMenu();",
  "const defaultName='玩家'+Math.floor(Math.random()*1000);nameInput.value=defaultName;myName=defaultName;renderAvatarPreview();setMicUi();showMenu();",
  'initial profile voice UI'
);

new Function(src);
fs.writeFileSync('game.js', src);
console.log('[dtam] gameplay 2.4 patch applied', hits);
