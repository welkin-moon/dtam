const ROOM_RE=/^\d{2}$/;
const MAX_BODY=64*1024;
const TTL_MS=4*60*60*1000;
const NEW_SESSION_LIMIT=12;
const NEW_SESSION_WINDOW_MS=60*1000;
const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type,x-dtam-token',
  'Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS',
  'Cache-Control':'no-store',
};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json;charset=utf-8'}});
const bad=(message,status=400,code='bad_request')=>json({ok:false,code,message},status);
const now=()=>Date.now();

function originOk(req){
  const origin=req.headers.get('origin');
  if(!origin)return false;
  try{
    const u=new URL(origin);
    return (u.protocol==='https:'&&(u.hostname==='d1.lunarlab.uk'||u.hostname==='dtam.pages.dev'||u.hostname.endsWith('.dtam.pages.dev')))||u.hostname==='localhost'||u.hostname==='127.0.0.1';
  }catch(_){return false;}
}
async function readBody(req){
  const declared=Number(req.headers.get('content-length')||0);
  if(declared>MAX_BODY)throw new Error('too_big');
  const text=await req.text();
  if(text.length>MAX_BODY)throw new Error('too_big');
  return text?JSON.parse(text):{};
}
async function maybeCleanup(db){
  const sample=new Uint8Array(1);crypto.getRandomValues(sample);
  if((sample[0]&63)!==0)return;
  const t=now();
  try{await db.batch([
    db.prepare('DELETE FROM voice_sessions WHERE expires_at<=?').bind(t),
    db.prepare('DELETE FROM voice_members WHERE expires_at<=?').bind(t),
    db.prepare('DELETE FROM voice_room_state WHERE expires_at<=?').bind(t),
  ]);}catch(_){}
}
async function member(db,room,token){
  return token?db.prepare('SELECT player_id,alive,connected,session_id,track_name,enabled FROM voice_members WHERE room=? AND game_token=? AND expires_at>?').bind(room,token,now()).first():null;
}
async function ownedSession(db,room,token,sessionId){
  return db.prepare('SELECT player_id FROM voice_sessions WHERE room=? AND game_token=? AND session_id=? AND expires_at>?').bind(room,token,sessionId,now()).first();
}
async function enforceNewSessionLimit(db,room,playerId){
  const since=now()-NEW_SESSION_WINDOW_MS;
  const row=await db.prepare('SELECT COUNT(*) AS n FROM voice_sessions WHERE room=? AND player_id=? AND created_at>=?').bind(room,playerId,since).first();
  if(Number(row?.n||0)>=NEW_SESSION_LIMIT)throw Object.assign(new Error('Too many voice sessions; retry shortly'),{status:429,code:'voice_rate_limited'});
}
async function calls(env,path,method,payload){
  if(!env.CALLS_APP_ID||!env.CALLS_APP_SECRET)return bad('voice unavailable',503,'voice_unavailable');
  const headers={Authorization:'Bearer '+env.CALLS_APP_SECRET};
  let body;
  if(payload!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(payload);}
  const upstream=await fetch('https://rtc.live.cloudflare.com/v1/apps/'+env.CALLS_APP_ID+path,{method,headers,body});
  const text=await upstream.text();
  return new Response(text,{status:upstream.status,headers:{...cors,'Content-Type':upstream.headers.get('content-type')||'application/json;charset=utf-8'}});
}
async function syncRoom(req,env){
  const x=await readBody(req),room=String(x.room||''),hostToken=String(x.hostToken||''),phase=['lobby','playing','meeting','ended'].includes(String(x.phase||''))?String(x.phase):'lobby';
  if(!ROOM_RE.test(room)||hostToken.length<32)return bad('invalid sync');
  const valid=await env.VOICE_DB.prepare('SELECT room FROM rooms WHERE room=? AND host_token=? AND expires_at>?').bind(room,hostToken,now()).first();
  if(!valid)return bad('forbidden',403,'forbidden');
  const t=now(),expires=t+TTL_MS,players=Array.isArray(x.players)?x.players.slice(0,15):[],ids=[];
  const statements=[env.VOICE_DB.prepare("INSERT INTO voice_room_state(room,phase,updated_at,expires_at) VALUES(?,?,?,?) ON CONFLICT(room) DO UPDATE SET phase=excluded.phase,updated_at=excluded.updated_at,expires_at=excluded.expires_at").bind(room,phase,t,expires)];
  for(const p of players){
    const playerId=String(p.playerId||'').slice(0,96),gameToken=String(p.gameToken||'').slice(0,128);
    if(!playerId||gameToken.length<16)continue;
    ids.push(playerId);
    statements.push(env.VOICE_DB.prepare("INSERT INTO voice_members(room,player_id,game_token,alive,connected,session_id,track_name,enabled,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(room,player_id) DO UPDATE SET game_token=excluded.game_token,alive=excluded.alive,connected=excluded.connected,session_id=excluded.session_id,track_name=excluded.track_name,enabled=excluded.enabled,updated_at=excluded.updated_at,expires_at=excluded.expires_at").bind(room,playerId,gameToken,p.alive===false?0:1,p.connected===false?0:1,String(p.sessionId||'').slice(0,160),String(p.trackName||'').slice(0,160),p.enabled?1:0,t,expires));
  }
  if(ids.length){const marks=ids.map(()=>'?').join(',');statements.push(env.VOICE_DB.prepare('DELETE FROM voice_members WHERE room=? AND player_id NOT IN ('+marks+')').bind(room,...ids));}
  else statements.push(env.VOICE_DB.prepare('DELETE FROM voice_members WHERE room=?').bind(room));
  await env.VOICE_DB.batch(statements);
  return json({ok:true,members:ids.length,phase});
}
async function authorizeRemoteTracks(env,room,caller,payload){
  const phaseRow=await env.VOICE_DB.prepare('SELECT phase FROM voice_room_state WHERE room=? AND expires_at>?').bind(room,now()).first();
  const phase=String(phaseRow?.phase||'lobby'),callerAlive=Number(caller.alive)!==0;
  for(const track of Array.isArray(payload?.tracks)?payload.tracks:[]){
    if(String(track?.location||'')!=='remote')continue;
    const target=await env.VOICE_DB.prepare('SELECT alive,connected,enabled FROM voice_members WHERE room=? AND session_id=? AND track_name=? AND expires_at>?').bind(room,String(track.sessionId||''),String(track.trackName||''),now()).first();
    if(!target||!Number(target.connected)||!Number(target.enabled))throw Object.assign(new Error('Voice track unavailable'),{status:409,code:'voice_track_pending'});
    if((phase==='playing'||phase==='meeting')&&callerAlive&&!Number(target.alive))throw Object.assign(new Error('Voice track forbidden'),{status:403,code:'voice_track_forbidden'});
  }
}
async function voiceProxy(req,env,url){
  const room=String(url.searchParams.get('room')||''),token=String(req.headers.get('x-dtam-token')||'');
  if(!ROOM_RE.test(room))return bad('bad room',400,'bad_room');
  const caller=await member(env.VOICE_DB,room,token);
  if(!caller||!Number(caller.connected))return bad('voice session invalid',403,'voice_session_invalid');
  const suffix=url.pathname.slice('/voice'.length);
  if(req.method==='POST'&&suffix==='/sessions/new'){
    await enforceNewSessionLimit(env.VOICE_DB,room,String(caller.player_id));
    const upstream=await calls(env,'/sessions/new','POST');
    if(!upstream.ok)return upstream;
    const data=await upstream.clone().json().catch(()=>({})),sessionId=String(data.sessionId||'');
    if(sessionId){const t=now();await env.VOICE_DB.prepare('INSERT INTO voice_sessions(room,session_id,player_id,game_token,created_at,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(room,session_id) DO UPDATE SET player_id=excluded.player_id,game_token=excluded.game_token,expires_at=excluded.expires_at').bind(room,sessionId,String(caller.player_id),token,t,t+TTL_MS).run();}
    return upstream;
  }
  const match=suffix.match(/^\/sessions\/([^/]+)\/(tracks\/new|renegotiate)$/);
  if(!match)return bad('not found',404,'not_found');
  const sessionId=decodeURIComponent(match[1]),action=match[2];
  if(!await ownedSession(env.VOICE_DB,room,token,sessionId))return bad('voice session invalid',403,'voice_session_invalid');
  const payload=await readBody(req);
  if(action==='tracks/new'&&req.method==='POST'){await authorizeRemoteTracks(env,room,caller,payload);return calls(env,'/sessions/'+encodeURIComponent(sessionId)+'/tracks/new','POST',payload);}
  if(action==='renegotiate'&&req.method==='PUT')return calls(env,'/sessions/'+encodeURIComponent(sessionId)+'/renegotiate','PUT',payload);
  return bad('method not allowed',405,'method_not_allowed');
}
export default{async fetch(req,env){
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const url=new URL(req.url);
  if(url.pathname==='/health')return json({ok:true,service:'dtam-voice-edge',version:'1.1',calls:!!env.CALLS_APP_ID&&!!env.CALLS_APP_SECRET});
  if(!originOk(req))return bad('origin not allowed',403,'origin_forbidden');
  if(!env.VOICE_DB)return bad('storage unavailable',503,'storage_unavailable');
  await maybeCleanup(env.VOICE_DB);
  try{
    if(url.pathname==='/v1/sync'&&req.method==='POST')return syncRoom(req,env);
    if(url.pathname.startsWith('/voice/'))return voiceProxy(req,env,url);
    return bad('not found',404,'not_found');
  }catch(e){
    if(e?.message==='too_big')return bad('payload too large',413,'payload_too_large');
    if(e?.status)return bad(String(e.message||'voice error'),Number(e.status),String(e.code||'voice_error'));
    console.error(e);return bad('internal error',500,'internal_error');
  }
}};
