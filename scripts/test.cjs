const fs=require('fs');
const vm=require('vm');

const src=fs.readFileSync('game.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('styles.css','utf8');
const playerCss=fs.readFileSync('player-shell.css','utf8');
const headers=fs.readFileSync('_headers','utf8');
const worker=fs.readFileSync('worker.js','utf8');
const hybrid=fs.readFileSync('hybrid-transport.js','utf8');
const v3=fs.readFileSync('v3-resilience.js','utf8');
const edge=fs.readFileSync('edge/src/main.rs','utf8');
const server=fs.readFileSync('server/src/main.rs','utf8');

function assert(condition,message){if(!condition)throw new Error(`[2.8 test] ${message}`);}
function includes(text,needle,message){assert(text.includes(needle),message||`missing ${needle}`);}
function excludes(text,needle,message){assert(!text.includes(needle),message||`unexpected ${needle}`);}
function approx(a,b,epsilon=1e-8){return Math.abs(a-b)<=epsilon;}

new Function(src);
includes(src,"const CLIENT_VERSION = '2.8.3'",'client version must be 2.8.3');
includes(src,"const MAP_PROTOCOL_ID = 'dtam-map-150-v1'",'client map protocol identity must be explicit');
includes(src,"const ROOM_CODE_RE = /^\\d{2}$/",'client room codes must be exactly two digits');
includes(src,"Array.from({length:90},(_,i)=>String(i+10))",'room candidate pool must be 10-99');
includes(src,"room=String(room).replace(/\\D/g,'').slice(0,2)",'room normalization must stop at two digits');
includes(src,'const MAP_SIZE = 100','compact map must be enabled');
includes(src,'const NETWORK_MAP_SIZE = 150','Worker protocol map must remain 150 tiles');
includes(src,'const NETWORK_TO_CLIENT = MAP_SIZE / NETWORK_MAP_SIZE','coordinate scaling must exist');
includes(src,'const VIEW_TILES = 26','camera view must remain widened');
includes(src,"x:+toNetworkCoord(myPos.x).toFixed(3)",'outgoing positions must use Worker coordinates');
includes(src,'const x=toClientCoord(msg.x),y=toClientCoord(msg.y)','incoming positions must use client coordinates');
includes(src,'bodies=normalizeBodies(msg.bodies)','body coordinates must be transformed');
includes(src,'interactBtn.onclick=activateInteract','interaction button must be wired');
includes(src,'ventBtn.onclick=activateVent','vent button must be wired');
includes(src,'infoBtn.onclick=activateInfo','information console button must be wired');
includes(src,'sabotageBtn.onclick=openSabotage','sabotage button must be wired');
includes(src,"skipVoteBtn.onclick=()=>castVote('skip')",'skip vote must be wired');
includes(src,"backLobbyBtn.onclick=()=>{if(isHost)sendPacket({t:'reset'});else showToast('等待房主返回大厅');}",'only host may reset lobby');
includes(src,'reportBlockedUntil=Date.now()+REPORT_GUARD_MS','post-kill report guard must exist');
includes(src,'function meetingUiActive()','meeting state must have one canonical UI guard');
includes(src,"const playing=gameState.phase==='playing'&&!meetingUiActive()&&!networkPaused",'scene actions must freeze during meetings and direct recovery');
includes(src,"meetingOverlay.classList.contains('show')||selfState.inVent",'movement must freeze while meeting overlay is shown');
includes(src,"if(gameState.meeting&&!meetingOverlay.classList.contains('show'))openMeeting",'state messages must restore a missing meeting overlay');
includes(src,"if(dead&&selfState.alive)return",'client must defensively reject ghost text');
includes(src,'return selfState.alive?p.alive:true','client must defensively reject dead-player voice');
includes(src,'if(entry&&!voicePeerAllowed(entry))','late WebRTC tracks must respect privacy');
includes(src,"GLOBAL_AVATAR_KEY='au-dtam-avatar'",'avatar must persist globally');
includes(src,'const MAX_AVATAR_CHARS = 4800','avatar must fit Worker limit');
includes(src,"toDataURL('image/webp'",'avatar encoder must use WebP');
includes(src,'Number(st.guardianAngels||0)','guardian angels must count as special crew');
includes(src,'voiceErrorMessage','voice errors must be classified');
includes(src,"const HEARTBEAT_INTERVAL = 3000",'RTT sampling interval must be 3 seconds');
includes(src,"const CONNECT_TIMEOUT_MS = 20000",'slow Cloudflare routes must get a 20 second websocket handshake budget');
includes(src,"function renderLatency()",'frontend must display realtime RTT');
includes(src,"function recordLatency(sample)",'frontend must smooth RTT and jitter');
includes(src,"function sendAction(payload,syncPosition=true)",'critical actions must force a fresh position checkpoint');
includes(src,'function applyAuthoritativePlayers(raw,{acceptSelf=false}={})','authoritative player snapshots must have a single reconciliation path');
includes(src,'if(acceptSelf||awaitingAuthoritativeSelfPosition)','spawn and reset snapshots must override local prediction');
includes(src,'seq<=remoteMoveSeq[id]','stale movement packets must be rejected');
includes(src,'map:MAP_PROTOCOL_ID','every room connection must identify the canonical map protocol');
includes(src,'directReady:p.directReady===true','Server direct readiness must be represented per player');
includes(src,'startGameBtn.disabled=count<2||waiting>0','Server matches must wait for every direct transport');
includes(src,"const REMOTE_PREDICTION_MAX_MS = 80",'remote movement prediction must be bounded');
excludes(headers,'microphone=()','Pages headers must not disable microphone');
includes(headers,'microphone=(self)','same-origin microphone permission must be allowed');
includes(html,'/styles.css?v=20260824-direct-m3e1','current cache-busted stylesheet must be loaded');
includes(html,'/hybrid-transport.js?v=20260824-direct-m3e1','current transport entry must be loaded');
excludes(headers,'immutable','runtime assets must never pin mixed protocol versions');
includes(headers,'Cache-Control: no-cache, max-age=0, must-revalidate','runtime assets must revalidate');
includes(html,'maxlength="2"','room input must be two digits');
includes(html,'pattern="[0-9]{2}"','room input must validate two digits');
excludes(html,'gameplay-2.','legacy versioned CSS must not be loaded');
excludes(css,'.voice-sink{display:none!important}','remote audio must never be removed from the render tree');
includes(css,'#actionStack #killBtn { order: 5;','kill button position must be stable');
includes(css,'#actionStack #reportBtn { order: 6;','report must not replace kill under the finger');
excludes(playerCss,'#latencyStatus { display: none','latency must stay visible on compact devices');

includes(hybrid,"const FAST_OUT=new Set(['pos','ping'])",'P2P position and RTT probes must use the fast channel');
includes(hybrid,"FAST_IN=new Set(['pos','pong'])",'P2P position and RTT replies must use the fast channel');
includes(hybrid,"await import('./v3-bootstrap.js?v=20260824-direct-m3e1')",'Server mode must load the v3 direct transport');
includes(v3,'No Tunnel fallback is permitted after gameplay begins','Server gameplay must not silently fall back to Tunnel');
includes(v3,"type === 'leave' && signalAvailable(this)",'only explicit leave may use signaling during a match');
includes(v3,"throw new DOMException('Server direct transport required'",'loss of direct gameplay transport must fail closed');
includes(edge,'fn is_reserved_transport_message','Edge must reserve direct readiness reports');
includes(edge,'if direct_required && !tunnel_server_message_allowed(&text)','Edge must discard server gameplay fallback traffic');
includes(edge,'game_active.load(Ordering::Acquire)','Edge must discard client Tunnel traffic during gameplay');
includes(server,'"directReady":p.direct_ready','Core state must expose verified direct readiness');
includes(server,'if t == "transport_ready"','Core must ingest Edge transport state');
includes(server,'"code":"direct_not_ready"','Core must refuse to start before all players are direct');
includes(server,'let direct_required = matches!(rt.room.phase.as_str(), "playing" | "meeting")','Core must reject gameplay while a player is not direct');

includes(worker,"version:'2.7'",'legacy rollback Worker must remain v2.7-compatible');
includes(worker,"if(!/^\\d{2}$/.test(room))",'Worker must enforce strict two-digit room codes');
excludes(worker,"(?:\\d{2}|\\d{6})",'Worker must not retain six-digit room compatibility');
includes(worker,'voiceDirectory(viewer=null)','voice directory must be recipient-aware');
includes(worker,"allowedVoice:this.voiceDirectory(p).map",'voice auth must return allowed remote tracks');
includes(worker,'Voice track forbidden','voice proxy must enforce allowed remote tracks');
includes(worker,"channel:ghost?'ghost'",'Worker must classify ghost chat');
includes(worker,"if(peer&&peer.alive===false)jsonSend(peerWs,payload)",'ghost text must only be sent to dead peers');
includes(worker,"meetingActive=this.phase==='playing'",'Worker must permit meeting chat while a game is active');

const marker='const $=id=>document.getElementById(id);';
const cut=src.indexOf(marker);
assert(cut>0,'map prelude marker missing');
const context={Uint8Array,Math,Set,Map,console};
const prelude=src.slice(0,cut).replace(/^\(\(\) => \{\r?\n'use strict';\r?\n+/,'');
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

console.log('[dtam] gameplay 2.8.3 direct-sync tests passed',{
  clientWalkableReachable:clientFlood.queue.length,
  networkWalkableReachable:networkFlood.queue.length,
  objects:m.OBJECT_DEFS.length,
  vents:m.VENT_DEFS.length
});
