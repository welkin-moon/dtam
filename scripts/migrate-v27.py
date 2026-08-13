from pathlib import Path

root=Path('.')
p=root/'game.js'
s=p.read_text()

def rep(old,new,count=1):
    global s
    n=s.count(old)
    if n!=count:
        raise SystemExit(f'replacement count {n} != {count}: {old[:120]!r}')
    s=s.replace(old,new)

rep("const CLIENT_VERSION = '2.6';", "const CLIENT_VERSION = '2.7';")
rep("const ROOM_CODE_RE = /^(?:\\d{2}|\\d{6})$/;", "const ROOM_CODE_RE = /^\\d{2}$/;")
rep("const generateRoomId=()=>{try{const b=new Uint32Array(1);crypto.getRandomValues(b);return String(100000+b[0]%900000);}catch(_){return String(100000+Math.floor(Math.random()*900000));}};",
    "function generateRoomCandidates(){const rooms=Array.from({length:90},(_,i)=>String(i+10));for(let i=rooms.length-1;i>0;i--){let j;try{const b=new Uint32Array(1);crypto.getRandomValues(b);j=b[0]%(i+1);}catch(_){j=Math.floor(Math.random()*(i+1));}[rooms[i],rooms[j]]=[rooms[j],rooms[i]];}return rooms;}")
rep("revealDeaths=!selfState.alive||gameState.phase==='meeting'||gameState.phase==='ended'", "revealDeaths=!selfState.alive||meetingUiActive()||gameState.phase==='ended'")
rep("function updateChatAvailability(){const canChat=gameState.phase!=='playing'||!selfState.alive;chatInput.disabled=!canChat;chatSend.disabled=!canChat;chatInput.placeholder=gameState.phase==='playing'?(selfState.alive?'存活时请在会议中发言':'幽灵频道 · 仅死亡玩家可见'):'消息';}",
    "function meetingUiActive(){const m=gameState.meeting;return meetingOverlay.classList.contains('show')||(!!m&&['discussion','voting','result'].includes(String(m.stage||'')));}\nfunction meetingChatOpen(){return meetingUiActive();}\nfunction updateChatAvailability(){const inMeeting=meetingChatOpen(),canChat=gameState.phase!=='playing'||!selfState.alive||inMeeting;chatInput.disabled=!canChat;chatSend.disabled=!canChat;chatInput.placeholder=gameState.phase==='playing'?(selfState.alive?(inMeeting?'会议频道':'存活时只能在会议中发言'):'幽灵频道 · 仅死亡玩家可见'):'消息';}")
rep("function renderGameMeta(){const base=({lobby:'大厅',playing:'进行中',meeting:'会议',ended:'已结束'})[gameState.phase]||gameState.phase;phaseLabel.textContent=gameState.phase==='playing'?base+' · '+areaNameAt(myPos.x,myPos.y):base;",
    "function renderGameMeta(){const displayPhase=meetingUiActive()?'meeting':gameState.phase,base=({lobby:'大厅',playing:'进行中',meeting:'会议',ended:'已结束'})[displayPhase]||displayPhase;phaseLabel.textContent=displayPhase==='playing'?base+' · '+areaNameAt(myPos.x,myPos.y):base;")
rep("function renderActions(){const playing=gameState.phase==='playing',", "function renderActions(){const playing=gameState.phase==='playing'&&!meetingUiActive(),")
rep("function sendChatMessage(value){const text=sanitizeChatText(value);if(!text)return;if(gameState.phase==='playing'&&selfState.alive){showToast('存活玩家只能在会议中发言');return;}",
    "function sendChatMessage(value){const text=sanitizeChatText(value);if(!text)return;if(gameState.phase==='playing'&&selfState.alive&&!meetingChatOpen()){showToast('存活玩家只能在会议中发言');return;}")
rep("if(Array.isArray(msg.bodies))bodies=normalizeBodies(msg.bodies);refreshVoicePrivacy();renderStateUI();return;",
    "if(Array.isArray(msg.bodies))bodies=normalizeBodies(msg.bodies);if(gameState.meeting&&!meetingOverlay.classList.contains('show'))openMeeting({meeting:gameState.meeting});refreshVoicePrivacy();renderStateUI();return;")
rep("function connectRoom(room,create=false,reconnect=false){room=String(room).replace(/\\D/g,'').slice(0,6);if(!ROOM_CODE_RE.test(room))return Promise.reject(new Error('房间号应为 6 位数字（旧房间可用 2 位）'));",
    "function connectRoom(room,create=false,reconnect=false){room=String(room).replace(/\\D/g,'').slice(0,2);if(!ROOM_CODE_RE.test(room))return Promise.reject(new Error('房间号应为 2 位数字'));")
rep("async function createRoom(){createBtn.disabled=joinBtn.disabled=true;resumeToken='';const tried=new Set();let collisions=0;for(let i=0;i<16;i++){let room=generateRoomId();while(tried.has(room))room=generateRoomId();tried.add(room);try{await connectRoom(room,true,false);createBtn.disabled=joinBtn.disabled=false;return;}catch(err){if(String(err.message).includes('已存在')){collisions++;continue;}setMenuStatus(err.message,'error');break;}}if(collisions>=16)setMenuStatus('暂时无法分配房间号，请稍后重试','error');createBtn.disabled=joinBtn.disabled=false;}",
    "async function createRoom(){createBtn.disabled=joinBtn.disabled=true;resumeToken='';let collisions=0;for(const room of generateRoomCandidates()){try{await connectRoom(room,true,false);createBtn.disabled=joinBtn.disabled=false;return;}catch(err){if(String(err.message).includes('已存在')){collisions++;continue;}setMenuStatus(err.message,'error');break;}}if(collisions>0)setMenuStatus('两位房间号暂时都很拥挤，请稍后重试','error');createBtn.disabled=joinBtn.disabled=false;}")
rep("if(gameState.phase!=='playing'||selfState.inVent||taskModal.classList.contains('show')||sabotageOverlay.classList.contains('show')||infoOverlay.classList.contains('show'))return;",
    "if(gameState.phase!=='playing'||meetingOverlay.classList.contains('show')||selfState.inVent||taskModal.classList.contains('show')||sabotageOverlay.classList.contains('show')||infoOverlay.classList.contains('show'))return;")
old="createBtn.onclick=async()=>{myName=sanitizeName(nameInput.value);nameInput.value=myName;saveName(myName);await createRoom();};showJoinBtn.onclick=()=>{joinVisible=!joinVisible;joinSection.style.display=joinVisible?'block':'none';showJoinBtn.textContent=joinVisible?'取消':'加入房间';if(joinVisible)roomIdInput.focus();};joinBtn.onclick=async()=>{const room=roomIdInput.value.replace(/\\D/g,'').slice(0,6);roomIdInput.value=room;if(!ROOM_CODE_RE.test(room)){setMenuStatus('请输入 6 位数字房间号（旧房间可用 2 位）','error');return;}"
new="createBtn.onclick=async()=>{myName=sanitizeName(nameInput.value);nameInput.value=myName;saveName(myName);await createRoom();};showJoinBtn.onclick=()=>{joinVisible=!joinVisible;joinSection.style.display=joinVisible?'block':'none';showJoinBtn.textContent=joinVisible?'取消':'加入房间';if(joinVisible)roomIdInput.focus();};joinBtn.onclick=async()=>{const room=roomIdInput.value.replace(/\\D/g,'').slice(0,2);roomIdInput.value=room;if(!ROOM_CODE_RE.test(room)){setMenuStatus('请输入 2 位数字房间号','error');return;}"
rep(old,new)
rep("roomIdInput.oninput=()=>{roomIdInput.value=roomIdInput.value.replace(/\\D/g,'').slice(0,6);};", "roomIdInput.oninput=()=>{roomIdInput.value=roomIdInput.value.replace(/\\D/g,'').slice(0,2);};")
rep("console.log('Among Us 东滩版 '+CLIENT_VERSION+' · compact 100 renderer / 150 protocol + reliable actions + private ghost comms');", "console.log('Among Us 东滩版 '+CLIENT_VERSION+' · canonical source + 2-digit rooms + server-enforced ghost privacy');")
p.write_text(s)

# index: one canonical stylesheet + two-digit room code + 2.7 cache bust.
ip=root/'index.html'
h=ip.read_text()
old='    <link rel="stylesheet" href="/styles.css" />\n    <link rel="stylesheet" href="/gameplay.css?v=2.1" />\n    <link rel="stylesheet" href="/gameplay-2.4.css?v=2.4" />\n    <link rel="stylesheet" href="/gameplay-2.5.css?v=2.5" />\n    <link rel="stylesheet" href="/gameplay-2.6.css?v=2.6" />'
assert h.count(old)==1
h=h.replace(old,'    <link rel="stylesheet" href="/styles.css?v=2.7" />')
old='placeholder="6 位数字（兼容旧 2 位）" maxlength="6" inputmode="numeric" pattern="[0-9]{2}|[0-9]{6}"'
assert h.count(old)==1
h=h.replace(old,'placeholder="2 位数字" maxlength="2" inputmode="numeric" pattern="[0-9]{2}"')
assert h.count('<script src="/game.js?v=2.6" defer></script>')==1
h=h.replace('<script src="/game.js?v=2.6" defer></script>','<script src="/game.js?v=2.7" defer></script>')
ip.write_text(h)

# CSS: collapse all historical layers into one canonical stylesheet.
parts=[]
for name,label in [('styles.css','Base UI'),('gameplay.css','Gameplay core'),('gameplay-2.4.css','Gameplay profiles/voice'),('gameplay-2.5.css','Gameplay layout/meeting'),('gameplay-2.6.css','Gameplay touch/privacy')]:
    parts.append(f'/* ===== {label} (consolidated for v2.7) ===== */\n'+(root/name).read_text().rstrip()+"\n")
css='\n'.join(parts)
old='.voice-sink{display:none!important}'
new='.voice-sink{display:block!important;position:fixed!important;left:-8px!important;top:-8px!important;width:1px!important;height:1px!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important}'
assert css.count(old)==1
css=css.replace(old,new,1)
(root/'styles.css').write_text(css)

# Canonical response headers: microphone enabled for self, no legacy CSS entries.
(root/'_headers').write_text('''/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(self), geolocation=()
  Cross-Origin-Opener-Policy: same-origin

/index.html
  Cache-Control: no-cache

/game.js
  Cache-Control: no-cache

/styles.css
  Cache-Control: public, max-age=300, must-revalidate
''')
