const fs=require('fs');
const src=fs.readFileSync('game.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('styles.css','utf8');
const headers=fs.readFileSync('_headers','utf8');
const hybrid=fs.readFileSync('hybrid-transport.js','utf8');
const playerCss=fs.readFileSync('player-shell.css','utf8');
const worker=fs.readFileSync('worker.js','utf8');
const server=fs.existsSync('server/src/main.rs')?fs.readFileSync('server/src/main.rs','utf8'):'';

function assert(condition,message){if(!condition)throw new Error(`[2.8 test] ${message}`);}
function includes(haystack,needle,message){assert(haystack.includes(needle),message);}
function excludes(haystack,needle,message){assert(!haystack.includes(needle),message);}

includes(src,"const HEARTBEAT_INTERVAL = 3000",'RTT sampling interval must be 3 seconds');
includes(src,"const CONNECT_TIMEOUT_MS = 20000",'slow Cloudflare routes must get a 20 second websocket handshake budget');
includes(src,"ws.onclose=e=>{",'websocket close handler must receive the CloseEvent before reading its reason');
includes(src,"String(e?.reason||'').trim()||'无法建立实时连接'",'connection errors must preserve transport-specific close reasons');
excludes(src,"ws.onclose=()=>{if(generation!==socketGeneration)return;stopHeartbeat();if(connectReject)",'close handler must not drop the event argument');
excludes(src,"r(new Error('无法连接到实时服务器'))",'P2P failures must not be mislabeled as realtime server failures');
includes(src,"function renderLatency()",'frontend must display realtime RTT');
includes(src,"function recordLatency(sample)",'frontend must smooth RTT and jitter');
includes(src,"function sendAction(payload,syncPosition=true)",'critical actions must force a fresh position checkpoint');
includes(src,'function applyAuthoritativePlayers(raw,{acceptSelf=false}={})','authoritative player snapshots must have a single reconciliation path');
includes(src,'if(acceptSelf||awaitingAuthoritativeSelfPosition)','spawn and reset snapshots must override local prediction');
includes(src,'seq<=remoteMoveSeq[id]','stale movement packets must be rejected');
includes(src,'map:MAP_PROTOCOL_ID','every room connection must identify the canonical map protocol');
includes(src,'directReady:p.directReady===true','Server direct readiness must be represented per player');
includes(src,'startGameBtn.disabled=count<2||waiting>0','Server matches must wait for every direct transport');
includes(src,"const POS_SEND_INTERVAL_DIRECT = 33",'healthy direct P2P movement must target about 30 Hz');
includes(src,"const POS_SEND_INTERVAL_DIRECT_SLOW = 40",'high-RTT direct P2P movement must target about 25 Hz');
includes(src,"const POS_SEND_INTERVAL_RELAY = 50",'relay movement must stay at 20 Hz to bound relay traffic');
includes(src,"function positionSendInterval()",'movement send cadence must adapt to the selected path');
includes(src,"const REMOTE_PREDICTION_MAX_MS = 65",'remote movement prediction must stay tightly bounded');
includes(src,"const REMOTE_SMOOTHING_DIRECT = 46",'healthy direct P2P must converge remote visuals aggressively');
includes(src,"const REMOTE_SMOOTHING_DIRECT_SLOW = 34",'slow direct P2P must keep bounded smoothing');
includes(src,"const REMOTE_SMOOTHING_RELAY = 26",'relay smoothing must avoid excessive jitter amplification');
includes(src,"function remoteSmoothingRate()",'remote smoothing must adapt to the selected path');
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
includes(hybrid,"createDataChannel('dtam-fast',{ordered:false,maxRetransmits:0,priority:'high'})",'fast P2P channel must be unordered, non-retransmitting and high-priority');
includes(hybrid,'__dtamRecovery','P2P transport must carry recovery snapshots');
includes(hybrid,'sendSnapshotTo','host must be able to push recovery snapshot to a hot standby');
includes(worker,'async startMeeting(player','server worker must handle meetings');
includes(worker,'broadcastVoiceDirectory(){','server worker must maintain the voice directory');
includes(worker,"this.phase==='playing'||this.phase==='meeting'",'meeting phase must remain active-game context for ghost isolation');
includes(server,'room.phase == "playing" || room.phase == "meeting"','native server must treat meetings as active-game context');

console.log('[2.8 test] ok');
