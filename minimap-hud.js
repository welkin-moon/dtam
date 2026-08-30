const BaseWebSocket = window.WebSocket;
const MAP_SIZE = 150;
const OBJECTS = [
  { id:'power-nw', x:7.5, y:7.5 },
  { id:'relay-n', x:42.5, y:7.5 },
  { id:'sensor-ne', x:92.5, y:7.5 },
  { id:'gate-e', x:142.5, y:32.5 },
  { id:'pump-w', x:7.5, y:57.5 },
  { id:'console-c1', x:67.5, y:57.5 },
  { id:'console-c2', x:82.5, y:92.5 },
  { id:'radio-e', x:142.5, y:82.5 },
  { id:'beacon-sw', x:17.5, y:117.5 },
  { id:'panel-s', x:67.5, y:142.5 },
  { id:'relay-se', x:117.5, y:142.5 },
  { id:'gate-s', x:142.5, y:117.5 },
];
const VENTS = [
  {x:30.5,y:30.5},{x:69.5,y:31.5},{x:112.5,y:32.5},
  {x:20.5,y:92.5},{x:75.5,y:112.5},{x:130.5,y:92.5},
];
const SABOTAGE_STATIONS = {
  lights:['power-nw'], reactor:['relay-n','relay-se'], o2:['sensor-ne','pump-w']
};
const OBJECT_BY_ID = new Map(OBJECTS.map(x => [x.id, x]));

const state = window.__DTAM_MINIMAP__ = window.__DTAM_MINIMAP__ || {
  phase:'lobby', selfId:'', selfPos:{x:75.5,y:75.5}, players:{},
  tasks:[], completed:[], sabotage:null, trackedId:'', trackUntil:0,
  noisemaker:null, packets:0, lastPacketAt:0,
};

function parse(value) { try { return JSON.parse(String(value)); } catch (_) { return null; } }
function clamp(v,a,b) { return Math.max(a, Math.min(b, v)); }
function validPoint(x,y) { return Number.isFinite(Number(x)) && Number.isFinite(Number(y)); }

function applyPlayers(raw) {
  const next = {};
  const list = Array.isArray(raw) ? raw : Object.values(raw || {});
  for (const p of list) {
    if (!p?.id) continue;
    const x = Number(p.pos?.x), y = Number(p.pos?.y);
    next[String(p.id)] = {
      id:String(p.id), x:Number.isFinite(x)?x:75.5, y:Number.isFinite(y)?y:75.5,
      connected:p.connected !== false, alive:p.alive !== false,
    };
  }
  state.players = next;
  const me = next[state.selfId];
  if (me) state.selfPos = { x:me.x, y:me.y };
}

function applySelf(raw) {
  if (!raw) return;
  if (Array.isArray(raw.tasks)) state.tasks = raw.tasks.map(String);
  if (Array.isArray(raw.completed)) state.completed = raw.completed.map(String);
  state.trackedId = String(raw.trackedId || state.trackedId || '');
  state.trackUntil = Number(raw.trackUntil || state.trackUntil || 0);
}

function applyGame(raw) {
  if (!raw) return;
  if (raw.phase) state.phase = String(raw.phase);
  if ('sabotage' in raw) state.sabotage = raw.sabotage || null;
}

function consumeMessage(data) {
  if (typeof data !== 'string') return;
  const m = parse(data);
  if (!m || typeof m.t !== 'string') return;
  state.packets++;
  state.lastPacketAt = Date.now();
  switch (m.t) {
    case 'welcome':
      state.selfId = String(m.self?.id || '');
      applyPlayers(m.players);
      applyGame(m.game);
      applySelf(m.selfState);
      break;
    case 'state':
      if (m.players) applyPlayers(m.players);
      applyGame(m.game);
      applySelf(m.selfState);
      break;
    case 'game_start':
      state.phase = 'playing';
      state.sabotage = null;
      applyGame(m.game);
      applySelf(m.selfState);
      break;
    case 'resume_play':
      state.phase = 'playing';
      state.sabotage = null;
      if (m.players) applyPlayers(m.players);
      applySelf(m.selfState);
      break;
    case 'meeting':
    case 'meeting_result':
      state.phase = 'meeting';
      break;
    case 'game_over':
      state.phase = 'ended';
      state.sabotage = null;
      break;
    case 'lobby_reset':
      state.phase = 'lobby';
      state.sabotage = null;
      state.tasks = [];
      state.completed = [];
      state.trackedId = '';
      state.trackUntil = 0;
      state.noisemaker = null;
      if (m.players) applyPlayers(m.players);
      break;
    case 'pos': {
      const id = String(m.id || '');
      const x = Number(m.x), y = Number(m.y);
      if (id && validPoint(x,y)) {
        state.players[id] = { ...(state.players[id] || {id}), x, y, connected:true, alive:m.alive !== false };
        if (id === state.selfId) state.selfPos = {x,y};
      }
      break;
    }
    case 'correct': {
      const x = Number(m.x), y = Number(m.y);
      if (validPoint(x,y)) state.selfPos = {x,y};
      break;
    }
    case 'vent_state': {
      const id = String(m.id || ''), x = Number(m.x), y = Number(m.y);
      if (id && validPoint(x,y)) {
        state.players[id] = { ...(state.players[id] || {id}), x, y, connected:true };
        if (id === state.selfId) state.selfPos = {x,y};
      }
      break;
    }
    case 'task_done':
      if (Array.isArray(m.completed)) state.completed = m.completed.map(String);
      break;
    case 'sabotage':
      state.sabotage = m.sabotage || null;
      break;
    case 'ability_ok':
      applySelf(m.selfState);
      break;
    case 'noisemaker':
      state.noisemaker = { x:Number(m.x), y:Number(m.y), until:Number(m.until || Date.now()+6000) };
      break;
  }
}

function consumeOutgoing(data) {
  const m = parse(data);
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'pos' && validPoint(m.x,m.y)) state.selfPos = { x:Number(m.x), y:Number(m.y) };
  else if (m.t === 'leave') state.phase = 'lobby';
}

function patchSocket(sock) {
  if (!sock || typeof sock !== 'object' || sock.__dtamMinimapTap) return sock;
  Object.defineProperty(sock, '__dtamMinimapTap', { value:true, configurable:false });
  if (typeof sock.addEventListener === 'function') sock.addEventListener('message', e => consumeMessage(e.data));
  if (typeof sock.send === 'function') {
    const originalSend = sock.send.bind(sock);
    sock.send = function minimapSend(data) {
      consumeOutgoing(data);
      return originalSend(data);
    };
  }
  return sock;
}

if (typeof BaseWebSocket === 'function' && !window.__DTAM_MINIMAP_WS_INSTALLED__) {
  window.__DTAM_MINIMAP_WS_INSTALLED__ = true;
  const WrappedWebSocket = new Proxy(BaseWebSocket, {
    construct(Target, args) { return patchSocket(Reflect.construct(Target, args, Target)); }
  });
  for (const key of ['CONNECTING','OPEN','CLOSING','CLOSED']) {
    try { Object.defineProperty(WrappedWebSocket, key, { value:BaseWebSocket[key] }); } catch (_) {}
  }
  window.WebSocket = WrappedWebSocket;
}

function buildMask() {
  const map = new Uint8Array(MAP_SIZE * MAP_SIZE);
  const set = (x,y,v=1) => { if (x>=0&&x<MAP_SIZE&&y>=0&&y<MAP_SIZE) map[y*MAP_SIZE+x]=v; };
  for (let i=0;i<MAP_SIZE;i++) { set(i,0); set(i,MAP_SIZE-1); set(0,i); set(MAP_SIZE-1,i); }
  const lines=[25,50,75,100,125];
  lines.forEach((x,li)=>{for(let y=1;y<MAP_SIZE-1;y++){const sector=Math.floor(y/25),local=y%25,ds=((sector+li)%2===0)?6:16;if(local<ds||local>ds+2)set(x,y);}});
  lines.forEach((y,li)=>{for(let x=1;x<MAP_SIZE-1;x++){const sector=Math.floor(x/25),local=x%25,ds=((sector+li+1)%2===0)?6:16;if(local<ds||local>ds+2)set(x,y);}});
  for(let sy=0;sy<6;sy++)for(let sx=0;sx<6;sx++){
    if(sx===3&&sy===3)continue;if((sx+sy)%2!==0)continue;
    const cx=sx*25+13,cy=sy*25+13,h=((sx*3+sy)%2)===0,w=h?5:2,hh=h?2:5;
    for(let oy=-Math.floor(hh/2);oy<=Math.floor(hh/2);oy++)for(let ox=-Math.floor(w/2);ox<=Math.floor(w/2);ox++)set(cx+ox,cy+oy);
  }
  for(let y=70;y<=80;y++)for(let x=70;x<=80;x++)set(x,y,0);
  for(const o of [...OBJECTS,...VENTS]){const cx=Math.floor(o.x),cy=Math.floor(o.y);for(let y=cy-1;y<=cy+1;y++)for(let x=cx-1;x<=cx+1;x++)set(x,y,0);}
  return map;
}
const MAP_MASK = buildMask();

function installHud() {
  if (document.getElementById('dtamMiniHud')) return;
  const game = document.getElementById('game');
  const mapBtn = document.getElementById('mapBtn');
  const full = document.getElementById('minimapOverlay');
  if (!game || !mapBtn || !full) return;

  const style = document.createElement('style');
  style.textContent = `
#dtamMiniHud{position:fixed;right:max(12px,env(safe-area-inset-right));top:58px;z-index:25;width:154px;padding:8px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:18px;background:color-mix(in srgb,Canvas 90%,transparent);box-shadow:0 8px 28px rgba(15,23,42,.16);backdrop-filter:blur(12px);cursor:pointer;user-select:none;transition:opacity .16s ease,transform .16s ease}
#dtamMiniHud:hover{transform:translateY(-1px)}
#dtamMiniHud[hidden]{display:none!important}
#dtamMiniHud canvas{display:block;width:100%;aspect-ratio:1;border-radius:12px;background:#11151a}
#dtamMiniHud .mini-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 2px 6px;font:700 12px/1.2 system-ui}
#dtamMiniHud .mini-head span:last-child{font-weight:500;opacity:.62;font-size:10px}
@media(max-width:720px){#dtamMiniHud{width:112px;right:max(8px,env(safe-area-inset-right));top:54px;padding:6px;border-radius:14px}#dtamMiniHud .mini-head{font-size:10px;margin-bottom:4px}#dtamMiniHud .mini-head span:last-child{display:none}}
`;
  document.head.appendChild(style);

  const hud = document.createElement('button');
  hud.type = 'button';
  hud.id = 'dtamMiniHud';
  hud.setAttribute('aria-label','小地图，点击展开完整任务地图');
  hud.innerHTML = '<div class="mini-head"><span>小地图</span><span>点击展开</span></div><canvas width="180" height="180"></canvas>';
  game.appendChild(hud);
  const canvas = hud.querySelector('canvas');
  const ctx = canvas.getContext('2d');

  hud.addEventListener('click', () => { if (!mapBtn.disabled) mapBtn.click(); });
  const observer = new MutationObserver(() => updateVisibility());
  observer.observe(full, { attributes:true, attributeFilter:['class'] });
  observer.observe(game, { attributes:true, attributeFilter:['style','class'] });

  function updateVisibility() {
    const gameVisible = getComputedStyle(game).display !== 'none';
    const meeting = document.getElementById('meetingOverlay')?.classList.contains('show');
    const expanded = full.classList.contains('show');
    hud.hidden = !gameVisible || state.phase !== 'playing' || meeting || expanded;
  }

  function palette() {
    const dark = document.documentElement.dataset.theme === 'dark';
    return dark
      ? { floor:'#11151a', wall:'#3b4551', border:'#64748b', task:'#60a5fa', danger:'#ef4444', me:'#f8fafc', track:'#f59e0b' }
      : { floor:'#f8fafc', wall:'#a8b1bd', border:'#667085', task:'#2563eb', danger:'#dc2626', me:'#ffffff', track:'#d97706' };
  }

  function drawDot(x,y,color,r=4,stroke='') {
    const sx=clamp(Number(x),0,MAP_SIZE)/MAP_SIZE*canvas.width, sy=clamp(Number(y),0,MAP_SIZE)/MAP_SIZE*canvas.height;
    ctx.beginPath();ctx.arc(sx,sy,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}
  }

  function draw() {
    updateVisibility();
    if (hud.hidden) return;
    const p = palette(), w=canvas.width, h=canvas.height, sx=w/MAP_SIZE, sy=h/MAP_SIZE;
    ctx.clearRect(0,0,w,h);ctx.fillStyle=p.floor;ctx.fillRect(0,0,w,h);
    ctx.fillStyle=p.wall;
    for(let y=0;y<MAP_SIZE;y++)for(let x=0;x<MAP_SIZE;x++)if(MAP_MASK[y*MAP_SIZE+x])ctx.fillRect(x*sx,y*sy,Math.ceil(sx),Math.ceil(sy));

    const completed = new Set(state.completed || []);
    for (const id of state.tasks || []) {
      if (completed.has(id)) continue;
      const o=OBJECT_BY_ID.get(String(id)); if(!o)continue;
      ctx.fillStyle=p.task;ctx.fillRect(o.x*sx-3,o.y*sy-3,6,6);
    }

    const sab=state.sabotage;
    if(sab){const required=Array.isArray(sab.requiredStations)?sab.requiredStations:(SABOTAGE_STATIONS[String(sab.type||'')]||[]),fixed=new Set(sab.fixedStations||[]);for(const id of required){if(fixed.has(id))continue;const o=OBJECT_BY_ID.get(String(id));if(!o)continue;ctx.fillStyle=p.danger;ctx.fillRect(o.x*sx-4,o.y*sy-4,8,8);}}

    const now=Date.now();
    if(state.trackedId&&Number(state.trackUntil||0)>now){const t=state.players?.[state.trackedId];if(t&&t.connected!==false)drawDot(t.x,t.y,p.track,5,p.floor);}
    if(state.noisemaker&&Number(state.noisemaker.until||0)>now&&validPoint(state.noisemaker.x,state.noisemaker.y)){
      const x=state.noisemaker.x/MAP_SIZE*w,y=state.noisemaker.y/MAP_SIZE*h;ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.strokeStyle=p.danger;ctx.lineWidth=3;ctx.stroke();
    }
    drawDot(state.selfPos?.x??75.5,state.selfPos?.y??75.5,p.me,5,p.border);
  }

  setInterval(draw, 250);
  document.addEventListener('visibilitychange', draw);
  window.addEventListener('resize', draw);
  draw();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installHud, { once:true });
else installHud();

console.log('DTAM persistent minimap HUD ready');
