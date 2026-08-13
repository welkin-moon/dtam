const fs=require('fs');
const vm=require('vm');

const src=fs.readFileSync('game.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('gameplay-2.6.css','utf8');
const headers=fs.readFileSync('_headers','utf8');

function assert(condition,message){if(!condition)throw new Error(`[2.6 test] ${message}`);}
function includes(text,needle,message){assert(text.includes(needle),message||`missing ${needle}`);}
function excludes(text,needle,message){assert(!text.includes(needle),message||`unexpected ${needle}`);}
function approx(a,b,epsilon=1e-8){return Math.abs(a-b)<=epsilon;}

new Function(src);
includes(src,"const CLIENT_VERSION = '2.6'",'client version must be 2.6');
includes(src,'const MAP_SIZE = 100','compact map must be enabled');
includes(src,'const NETWORK_MAP_SIZE = 150','current Worker protocol map must remain 150 tiles');
includes(src,'const NETWORK_TO_CLIENT = MAP_SIZE / NETWORK_MAP_SIZE','network/client coordinate scaling must exist');
includes(src,'const VIEW_TILES = 26','camera view must be widened');
includes(src,"x:+toNetworkCoord(myPos.x).toFixed(3)",'outgoing positions must use Worker coordinates');
includes(src,'const x=toClientCoord(msg.x),y=toClientCoord(msg.y)','incoming positions must use client coordinates');
includes(src,'bodies=normalizeBodies(msg.bodies)','body coordinates must be transformed');
includes(src,'interactBtn.onclick=activateInteract','interaction button must be wired');
includes(src,'ventBtn.onclick=activateVent','vent button must be wired');
includes(src,'infoBtn.onclick=activateInfo','information console button must be wired');
includes(src,'sabotageBtn.onclick=openSabotage','sabotage button must be wired');
includes(src,"skipVoteBtn.onclick=()=>castVote('skip')",'skip vote must be wired');
includes(src,"backLobbyBtn.onclick=()=>{if(isHost)sendPacket({t:'reset'});else showToast('等待房主返回大厅');}",'only the host may return the room to lobby');
includes(src,'reportBlockedUntil=Date.now()+REPORT_GUARD_MS','post-kill report guard must exist');
includes(src,"senderId=String(msg.playerId||msg.senderId||msg.fromId||msg.id||'')",'ghost chat must prefer a stable sender id');
includes(src,"inferredDead=senderPlayer?!senderPlayer.alive:matches.length>0&&matches.every(p=>!p.alive)",'legacy Worker ghost chat must fall back to player state');
includes(src,'if(dead&&selfState.alive)return','living clients must reject ghost chat defensively');
includes(src,'return selfState.alive?p.alive:true','living clients must not subscribe to dead-player voice');
includes(src,'if(entry&&!voicePeerAllowed(entry))','late WebRTC tracks must respect ghost privacy');
includes(src,"selfState.alive?'存活时请在会议中发言':'幽灵频道 · 仅死亡玩家可见'",'chat availability must distinguish living and ghosts');
includes(src,"ROOM_CODE_RE = /^(?:\\d{2}|\\d{6})$/",'room codes must accept restored 6-digit and legacy 2-digit formats');
includes(src,'return String(100000+b[0]%900000)','new rooms must never use a leading-zero code');
includes(src,'v:CLIENT_VERSION','realtime handshake must advertise current client version');
includes(src,"GLOBAL_AVATAR_KEY='au-dtam-avatar'",'avatar must persist independently of random nickname');
includes(src,'const MAX_AVATAR_CHARS = 4800','avatar must respect the deployed Worker limit');
includes(src,"toDataURL('image/webp'",'avatar encoder must use the Worker-supported WebP format');
includes(src,'serverCompatibleAvatar','stored avatars must be validated before upload');
includes(src,'Number(st.guardianAngels||0)','guardian angels must count toward special crew totals');
includes(src,'selfState.emergencyUsed<Number(gameState.settings?.emergencyMeetings??1)','emergency console availability must follow the configured meeting count');
includes(src,'voiceErrorMessage','voice permission errors must be classified');
includes(src,"return '语音需要 HTTPS 安全连接'",'insecure-context microphone failures must remain distinguishable');
includes(src,'navigator.mediaDevices?.getUserMedia','microphone feature detection must exist');
excludes(headers,'microphone=()','site headers must not disable microphones');
includes(headers,'microphone=(self)','microphone permission must be allowed for same-origin content');
includes(html,'/gameplay-2.6.css?v=2.6','2.6 CSS must be loaded');
includes(html,'/game.js?v=2.6','2.6 JavaScript must be loaded');
includes(html,'maxlength="6"','room input must accept six digits');
includes(css,'.voice-sink{display:block!important','remote audio must remain in render tree');
includes(css,'#actionStack #killBtn{order:5}','kill button position must be stable');
includes(css,'#actionStack #reportBtn{order:6}','report button must not replace kill under the finger');

const marker='const $=id=>document.getElementById(id);';
const cut=src.indexOf(marker);
assert(cut>0,'map prelude marker missing');
const context={Uint8Array,Math,Set,Map,console};
const prelude=src.slice(0,cut).replace(/^\(\(\) => \{\n'use strict';\n+/,'');
vm.runInNewContext(prelude+`\nglobalThis.__map={MAP_SIZE,NETWORK_MAP_SIZE,NETWORK_TO_CLIENT,CLIENT_TO_NETWORK,MAP_DATA,NETWORK_MAP_DATA,OBJECT_DEFS,NETWORK_OBJECT_DEFS,VENT_DEFS,NETWORK_VENT_DEFS,DOOR_CELLS,NETWORK_DOOR_CELLS,toClientCoord,toNetworkCoord};`,context,{timeout:2000});
const m=context.__map;
assert(m.MAP_SIZE===100,'evaluated client map size mismatch');
assert(m.NETWORK_MAP_SIZE===150,'evaluated Worker map size mismatch');
assert(approx(m.NETWORK_TO_CLIENT,2/3),'network-to-client scale mismatch');
assert(approx(m.CLIENT_TO_NETWORK,1.5),'client-to-network scale mismatch');
for(const value of [0,.32,7.5,75.5,149.5])assert(approx(m.toNetworkCoord(m.toClientCoord(value)),value),`coordinate round-trip failed at ${value}`);

const idx=(x,y,size)=>y*size+x;
const wall=(data,size,x,y)=>x<0||y<0||x>=size||y>=size||data[idx(x,y,size)]===1;
for(let i=0;i<m.NETWORK_OBJECT_DEFS.length;i++){
  const net=m.NETWORK_OBJECT_DEFS[i],client=m.OBJECT_DEFS[i];
  assert(net.id===client.id,`object identity mismatch at ${i}`);
  assert(approx(client.x,m.toClientCoord(net.x))&&approx(client.y,m.toClientCoord(net.y)),`${net.id} coordinate scale mismatch`);
}
for(let i=0;i<m.NETWORK_VENT_DEFS.length;i++){
  const net=m.NETWORK_VENT_DEFS[i],client=m.VENT_DEFS[i];
  assert(net.id===client.id,`vent identity mismatch at ${i}`);
  assert(approx(client.x,m.toClientCoord(net.x))&&approx(client.y,m.toClientCoord(net.y)),`${net.id} coordinate scale mismatch`);
}
for(const item of [...m.OBJECT_DEFS,...m.VENT_DEFS]){
  const x=Math.floor(item.x),y=Math.floor(item.y);
  assert(!wall(m.MAP_DATA,m.MAP_SIZE,x,y),`${item.id} must be on a client-visible walkable cell`);
  assert(item.x>0&&item.y>0&&item.x<m.MAP_SIZE&&item.y<m.MAP_SIZE,`${item.id} must be in client bounds`);
}
for(const item of [...m.NETWORK_OBJECT_DEFS,...m.NETWORK_VENT_DEFS]){
  const x=Math.floor(item.x),y=Math.floor(item.y);
  assert(!wall(m.NETWORK_MAP_DATA,m.NETWORK_MAP_SIZE,x,y),`${item.id} must be on a Worker walkable cell`);
}
for(const [x,y] of m.DOOR_CELLS)assert(!wall(m.MAP_DATA,m.MAP_SIZE,x,y),`client door cell ${x},${y} must be open before sabotage`);
for(const [x,y] of m.NETWORK_DOOR_CELLS)assert(!wall(m.NETWORK_MAP_DATA,m.NETWORK_MAP_SIZE,x,y),`Worker door cell ${x},${y} must be open before sabotage`);

function flood(data,size,start){
  const seen=new Uint8Array(size*size),queue=[start];
  assert(!wall(data,size,start[0],start[1]),`flood start ${start} must be open`);
  seen[idx(start[0],start[1],size)]=1;
  for(let head=0;head<queue.length;head++){
    const [x,y]=queue[head];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,ny=y+dy;
      if(wall(data,size,nx,ny))continue;
      const k=idx(nx,ny,size);
      if(!seen[k]){seen[k]=1;queue.push([nx,ny]);}
    }
  }
  return {seen,queue};
}
const clientFlood=flood(m.MAP_DATA,m.MAP_SIZE,[Math.floor(m.toClientCoord(75.5)),Math.floor(m.toClientCoord(75.5))]);
const networkFlood=flood(m.NETWORK_MAP_DATA,m.NETWORK_MAP_SIZE,[75,75]);
for(const item of [...m.OBJECT_DEFS,...m.VENT_DEFS])assert(clientFlood.seen[idx(Math.floor(item.x),Math.floor(item.y),m.MAP_SIZE)],`${item.id} must be reachable in client rendering`);
for(const item of [...m.NETWORK_OBJECT_DEFS,...m.NETWORK_VENT_DEFS])assert(networkFlood.seen[idx(Math.floor(item.x),Math.floor(item.y),m.NETWORK_MAP_SIZE)],`${item.id} must be reachable under Worker collision`);
assert(clientFlood.queue.length>m.MAP_SIZE*m.MAP_SIZE*.5,'client-visible map is unexpectedly fragmented');
assert(networkFlood.queue.length>m.NETWORK_MAP_SIZE*m.NETWORK_MAP_SIZE*.55,'Worker map is unexpectedly fragmented');

console.log('[dtam] gameplay 2.6 tests passed',{
  clientWalkableReachable:clientFlood.queue.length,
  networkWalkableReachable:networkFlood.queue.length,
  objects:m.OBJECT_DEFS.length,
  vents:m.VENT_DEFS.length
});
