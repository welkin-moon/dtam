const fs=require('fs');
const vm=require('vm');

const src=fs.readFileSync('game.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('gameplay-2.6.css','utf8');
const headers=fs.readFileSync('_headers','utf8');

function assert(condition,message){if(!condition)throw new Error(`[2.6 test] ${message}`);}
function includes(text,needle,message){assert(text.includes(needle),message||`missing ${needle}`);}
function excludes(text,needle,message){assert(!text.includes(needle),message||`unexpected ${needle}`);}

new Function(src);
includes(src,"const CLIENT_VERSION = '2.6'",'client version must be 2.6');
includes(src,'const MAP_SIZE = 100','compact map must be enabled');
includes(src,'const VIEW_TILES = 26','camera view must be widened');
includes(src,'interactBtn.onclick=activateInteract','interaction button must be wired');
includes(src,'ventBtn.onclick=activateVent','vent button must be wired');
includes(src,'infoBtn.onclick=activateInfo','information console button must be wired');
includes(src,'sabotageBtn.onclick=openSabotage','sabotage button must be wired');
includes(src,"skipVoteBtn.onclick=()=>castVote('skip')",'skip vote must be wired');
includes(src,"backLobbyBtn.onclick=()=>sendPacket({t:'reset'})",'return-to-lobby must be wired');
includes(src,'reportBlockedUntil=Date.now()+REPORT_GUARD_MS','post-kill report guard must exist');
includes(src,"if(dead&&selfState.alive)return",'living clients must reject ghost chat defensively');
includes(src,"selfState.alive?'存活时请在会议中发言':'幽灵频道 · 仅死亡玩家可见'",'chat availability must distinguish living and ghosts');
includes(src,"ROOM_CODE_RE = /^(?:\\d{2}|\\d{6})$/",'room codes must accept new 6-digit and legacy 2-digit formats');
includes(src,"v:CLIENT_VERSION",'realtime handshake must advertise current client version');
includes(src,"GLOBAL_AVATAR_KEY='au-dtam-avatar'",'avatar must persist independently of random nickname');
includes(src,"image\\/(?:webp|jpeg|png)",'avatar encoder must accept browser fallbacks');
includes(src,"voiceErrorMessage",'voice permission errors must be classified');
includes(src,"navigator.mediaDevices?.getUserMedia",'microphone feature detection must exist');
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
vm.runInNewContext(prelude+`\nglobalThis.__map={MAP_SIZE,MAP_DATA,OBJECT_DEFS,VENT_DEFS,DOOR_CELLS};`,context,{timeout:2000});
const {MAP_SIZE,MAP_DATA,OBJECT_DEFS,VENT_DEFS,DOOR_CELLS}=context.__map;
assert(MAP_SIZE===100,'evaluated map size mismatch');
const idx=(x,y)=>y*MAP_SIZE+x;
const wall=(x,y)=>x<0||y<0||x>=MAP_SIZE||y>=MAP_SIZE||MAP_DATA[idx(x,y)]===1;
for(const item of [...OBJECT_DEFS,...VENT_DEFS]){
  const x=Math.floor(item.x),y=Math.floor(item.y);
  assert(!wall(x,y),`${item.id} must be on a walkable cell`);
  assert(item.x>0&&item.y>0&&item.x<MAP_SIZE&&item.y<MAP_SIZE,`${item.id} must be in bounds`);
}
for(const [x,y] of DOOR_CELLS)assert(!wall(x,y),`door cell ${x},${y} must be an open corridor before sabotage`);
const start=[50,50],seen=new Uint8Array(MAP_SIZE*MAP_SIZE),queue=[start];seen[idx(...start)]=1;
for(let head=0;head<queue.length;head++){
  const [x,y]=queue[head];
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const nx=x+dx,ny=y+dy,k=idx(nx,ny);
    if(!wall(nx,ny)&&!seen[k]){seen[k]=1;queue.push([nx,ny]);}
  }
}
for(const item of [...OBJECT_DEFS,...VENT_DEFS])assert(seen[idx(Math.floor(item.x),Math.floor(item.y))],`${item.id} must be reachable from spawn`);
assert(queue.length>MAP_SIZE*MAP_SIZE*.55,'walkable map area is unexpectedly fragmented');

console.log('[dtam] gameplay 2.6 tests passed',{walkableReachable:queue.length,objects:OBJECT_DEFS.length,vents:VENT_DEFS.length});
