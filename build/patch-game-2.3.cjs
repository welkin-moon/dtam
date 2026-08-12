const fs = require('fs');

let src = fs.readFileSync('game.js', 'utf8');
const bs = '\\';
const hits = {};

function replaceOnce(before, after, name) {
  const count = src.split(before).length - 1;
  hits[name] = count;
  if (count !== 1) throw new Error(`[2.3 patch] ${name}: expected 1 match, got ${count}`);
  src = src.replace(before, after);
}

replaceOnce(
  "const generateRoomId=()=>String(Math.floor(100000+Math.random()*900000));",
  "const generateRoomId=()=>String(Math.floor(Math.random()*100)).padStart(2,'0');",
  'room generator'
);
replaceOnce(
  ".slice(0,6);if(!/^" + bs + "d{6}$/.test(room))",
  ".slice(0,2);if(!/^" + bs + "d{2}$/.test(room))",
  'room validation'
);
replaceOnce("v:'2.2'", "v:'2.3'", 'protocol version');
replaceOnce(
  "function scheduleReconnect(){clearTimeout(reconnectTimer);reconnectAttempts++;",
  "function scheduleReconnect(){if(intentionalClose||!currentRoom||reconnectTimer)return;reconnectAttempts++;",
  'single-flight reconnect guard'
);
replaceOnce(
  "reconnectTimer=setTimeout(async()=>{if(intentionalClose||!currentRoom)return;",
  "reconnectTimer=setTimeout(async()=>{reconnectTimer=null;if(intentionalClose||!currentRoom)return;",
  'single-flight reconnect timer'
);
replaceOnce(
  "async function createRoom(){createBtn.disabled=joinBtn.disabled=true;resumeToken='';for(let i=0;i<5;i++){const room=generateRoomId();try{await connectRoom(room,true,false);createBtn.disabled=joinBtn.disabled=false;return;}catch(err){if(!String(err.message).includes('已存在')){setMenuStatus(err.message,'error');break;}}}createBtn.disabled=joinBtn.disabled=false;}",
  "async function createRoom(){createBtn.disabled=joinBtn.disabled=true;resumeToken='';const rooms=Array.from({length:100},(_,i)=>String(i).padStart(2,'0'));for(let i=rooms.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[rooms[i],rooms[j]]=[rooms[j],rooms[i]];}let collisions=0;for(const room of rooms.slice(0,30)){try{await connectRoom(room,true,false);createBtn.disabled=joinBtn.disabled=false;return;}catch(err){if(String(err.message).includes('已存在')){collisions++;continue;}setMenuStatus(err.message,'error');break;}}if(collisions>=30)setMenuStatus('2 位房间号暂时已满，请稍后重试','error');createBtn.disabled=joinBtn.disabled=false;}",
  'room allocation retry'
);
replaceOnce(
  "if(!/^" + bs + "d{6}$/.test(room)){setMenuStatus('请输入 6 位数字房间号','error');return;}",
  "if(!/^" + bs + "d{2}$/.test(room)){setMenuStatus('请输入 2 位数字房间号','error');return;}",
  'join validation'
);
replaceOnce(
  "if(msg.t==='error'){const code=String(msg.code||''),text=String(msg.message||'连接失败');",
  "if(msg.t==='error'){const code=String(msg.code||''),text=String(msg.message||'连接失败'),silentCollision=code==='room_exists'&&menu.style.display!=='none';",
  'connection error header'
);
replaceOnce(
  "setMenuStatus(text,'error');setConnectionState('error','连接失败');showToast(text,2200);if(code==='room_not_found'||code==='room_closed')setTimeout(()=>leaveGame(false,text),600);return;}",
  "if(silentCollision){intentionalClose=true;}else{setMenuStatus(text,'error');setConnectionState('error','连接失败');showToast(text,2200);}if(code==='room_not_found'||code==='room_closed'){intentionalClose=true;clearTimeout(reconnectTimer);reconnectTimer=null;setTimeout(()=>leaveGame(false,text),600);}return;}",
  'terminal connection errors'
);
replaceOnce(
  "function renderPlayerCount(){playerCountNum.textContent=String(Object.keys(players).length||1);if(playerPanelVisible)renderPlayerPanel();}",
  "function renderPlayerCount(){playerCountNum.textContent=String(Object.values(players).filter(p=>p.connected).length||1);if(playerPanelVisible)renderPlayerPanel();}",
  'online player count'
);

// Parse without executing the IIFE. This turns source drift into a build failure.
new Function(src);
fs.writeFileSync('game.js', src);
console.log('[dtam] gameplay 2.3 patch applied', hits);
