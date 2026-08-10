(() => {
'use strict';

const MAX_PLAYERS = 15;
const MAP_SIZE = 150;
const VIEW_TILES = 20;
const PLAYER_RADIUS = 0.32;
const MOVE_SPEED = 4.6;
const POS_SEND_INTERVAL = 50;
const HEARTBEAT_INTERVAL = 15000;
const STALE_SOCKET_MS = 45000;
const REALTIME_ORIGIN = 'wss://rt-d1.lunarlab.uk';

const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#f43f5e', '#ec4899'
];
const COLOR_NAMES = [
  '红色', '橙色', '黄色', '亮绿', '绿色', '青绿', '青色', '天蓝',
  '蓝色', '靛蓝', '紫色', '粉紫', '洋红', '玫红', '粉红'
];

const OBJECT_DEFS = [
  { id: 'power-nw', x: 7.5, y: 7.5, label: '西北配电箱' },
  { id: 'relay-n', x: 42.5, y: 7.5, label: '北区中继器' },
  { id: 'sensor-ne', x: 92.5, y: 7.5, label: '东北传感器' },
  { id: 'gate-e', x: 142.5, y: 32.5, label: '东侧门禁' },
  { id: 'pump-w', x: 7.5, y: 57.5, label: '西区水泵' },
  { id: 'console-c1', x: 67.5, y: 57.5, label: '中央控制台 A' },
  { id: 'console-c2', x: 82.5, y: 92.5, label: '中央控制台 B' },
  { id: 'radio-e', x: 142.5, y: 82.5, label: '东区无线电' },
  { id: 'beacon-sw', x: 17.5, y: 117.5, label: '西南信标' },
  { id: 'panel-s', x: 67.5, y: 142.5, label: '南区面板' },
  { id: 'relay-se', x: 117.5, y: 142.5, label: '东南中继器' },
  { id: 'gate-s', x: 142.5, y: 117.5, label: '南侧门禁' }
];

function buildMap() {
  const map = new Uint8Array(MAP_SIZE * MAP_SIZE);
  const setWall = (x, y, value = 1) => {
    if (x >= 0 && x < MAP_SIZE && y >= 0 && y < MAP_SIZE) map[y * MAP_SIZE + x] = value;
  };
  for (let i = 0; i < MAP_SIZE; i++) {
    setWall(i, 0); setWall(i, MAP_SIZE - 1); setWall(0, i); setWall(MAP_SIZE - 1, i);
  }
  const lines = [25, 50, 75, 100, 125];
  lines.forEach((x, li) => {
    for (let y = 1; y < MAP_SIZE - 1; y++) {
      const sector = Math.floor(y / 25);
      const local = y % 25;
      const doorStart = ((sector + li) % 2 === 0) ? 6 : 16;
      if (local >= doorStart && local <= doorStart + 2) continue;
      setWall(x, y);
    }
  });
  lines.forEach((y, li) => {
    for (let x = 1; x < MAP_SIZE - 1; x++) {
      const sector = Math.floor(x / 25);
      const local = x % 25;
      const doorStart = ((sector + li + 1) % 2 === 0) ? 6 : 16;
      if (local >= doorStart && local <= doorStart + 2) continue;
      setWall(x, y);
    }
  });
  for (let sy = 0; sy < 6; sy++) {
    for (let sx = 0; sx < 6; sx++) {
      if (sx === 3 && sy === 3) continue;
      if ((sx + sy) % 2 !== 0) continue;
      const cx = sx * 25 + 13;
      const cy = sy * 25 + 13;
      const horizontal = ((sx * 3 + sy) % 2) === 0;
      const w = horizontal ? 5 : 2;
      const h = horizontal ? 2 : 5;
      for (let oy = -Math.floor(h / 2); oy <= Math.floor(h / 2); oy++) {
        for (let ox = -Math.floor(w / 2); ox <= Math.floor(w / 2); ox++) setWall(cx + ox, cy + oy);
      }
    }
  }
  for (let y = 70; y <= 80; y++) for (let x = 70; x <= 80; x++) setWall(x, y, 0);
  for (const obj of OBJECT_DEFS) {
    const cx = Math.floor(obj.x), cy = Math.floor(obj.y);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) setWall(x, y, 0);
  }
  return map;
}
const MAP_DATA = buildMap();

const $ = (id) => document.getElementById(id);
const menu = $('menu');
const game = $('game');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const nameInput = $('playerNameInput');
const createBtn = $('createRoomBtn');
const showJoinBtn = $('showJoinBtn');
const joinSection = $('joinSection');
const roomIdInput = $('roomIdInput');
const joinBtn = $('joinRoomBtn');
const menuStatus = $('menuStatus');
const roomIdDisplay = $('roomIdDisplay');
const playerCountNum = $('playerCountNum');
const hudMyName = $('hudMyName');
const leaveBtn = $('leaveBtn');
const gameToast = $('gameToast');
const leaveNotice = $('leaveNotice');
const joystick = $('joystick');
const joystickKnob = $('joystickKnob');
const chatToggle = $('chatToggle');
const chatPanel = $('chatPanel');
const chatPanelMessages = $('chatPanelMessages');
const chatStream = $('chatStream');
const chatInput = $('chatInput');
const chatSend = $('chatSend');
const chatPanelClose = $('chatPanelClose');
const rotateOverlay = $('rotateOverlay');
const playerPanel = $('playerPanel');
const playerPanelBody = $('playerPanelBody');
const playerPanelClose = $('playerPanelClose');
const playerCountBtn = $('playerCountBtn');
const settingsBtn = $('settingsBtn');
const menuThemeBtn = $('menuThemeBtn');
const interactBtn = $('interactBtn');
const connectionStatus = $('connectionStatus');

let socket = null;
let socketGeneration = 0;
let intentionalClose = false;
let currentRoom = '';
let resumeToken = '';
let myPlayerId = '';
let myName = '玩家';
let isHost = false;
let players = {};
let myPos = { x: 75.5, y: 75.5 };
let objectState = Object.fromEntries(OBJECT_DEFS.map(o => [o.id, { active: false, by: '' }]));
let messages = [];
let chatVisible = false;
let playerPanelVisible = false;
let keys = {};
let joyActive = false;
let joyDX = 0;
let joyDY = 0;
let mouseDown = false;
let lastFrameTime = performance.now();
let lastPosSendTime = 0;
let posDirty = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let heartbeatTimer = null;
let lastPongAt = Date.now();
let connectResolve = null;
let connectReject = null;
let connectTimeout = null;
let toastTimer = null;
let leaveNoticeTimer = null;
let joinVisible = false;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function sanitizeName(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (text || '玩家').slice(0, 12);
}
function sanitizeChatText(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 100);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}
function generateRoomId() { return String(Math.floor(100000 + Math.random() * 900000)); }
function isWallCell(col, row) {
  if (col < 0 || row < 0 || col >= MAP_SIZE || row >= MAP_SIZE) return true;
  return MAP_DATA[row * MAP_SIZE + col] === 1;
}
function circleHitsWall(x, y, radius = PLAYER_RADIUS) {
  const minX = Math.floor(x - radius), maxX = Math.floor(x + radius);
  const minY = Math.floor(y - radius), maxY = Math.floor(y + radius);
  for (let row = minY; row <= maxY; row++) {
    for (let col = minX; col <= maxX; col++) {
      if (!isWallCell(col, row)) continue;
      const nearestX = clamp(x, col, col + 1);
      const nearestY = clamp(y, row, row + 1);
      const dx = x - nearestX, dy = y - nearestY;
      if (dx * dx + dy * dy < radius * radius) return true;
    }
  }
  return false;
}
function nearestInteractable() {
  let best = null, bestDist = 1.45;
  for (const obj of OBJECT_DEFS) {
    const d = Math.hypot(myPos.x - obj.x, myPos.y - obj.y);
    if (d < bestDist) { best = obj; bestDist = d; }
  }
  return best;
}

function getInitialTheme() {
  try {
    const saved = localStorage.getItem('au-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (_) {}
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function applyTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (persist) { try { localStorage.setItem('au-theme', theme); } catch (_) {} }
  const label = theme === 'dark' ? '浅色' : '深色';
  menuThemeBtn.textContent = label;
  settingsBtn.textContent = label;
  menuThemeBtn.setAttribute('aria-label', `切换到${label}主题`);
  settingsBtn.setAttribute('aria-label', `切换到${label}主题`);
}
function toggleTheme() { applyTheme((document.documentElement.dataset.theme || getInitialTheme()) === 'dark' ? 'light' : 'dark'); }
applyTheme(getInitialTheme(), false);

function setConnectionState(state, text) {
  connectionStatus.dataset.state = state;
  connectionStatus.textContent = text;
}
function setMenuStatus(text, type = '') {
  menuStatus.textContent = text;
  menuStatus.className = type;
}
function showToast(text, duration = 1600) {
  clearTimeout(toastTimer);
  gameToast.textContent = text;
  gameToast.classList.add('show');
  toastTimer = setTimeout(() => gameToast.classList.remove('show'), duration);
}
function showLeaveNotice(text) {
  clearTimeout(leaveNoticeTimer);
  leaveNotice.textContent = text;
  leaveNotice.style.opacity = '1';
  leaveNoticeTimer = setTimeout(() => { leaveNotice.style.opacity = '0'; }, 1800);
}
function checkOrientation() {
  rotateOverlay.classList.toggle('show', innerWidth < 720 && innerHeight > innerWidth);
}
function showMenu() {
  menu.style.display = 'flex';
  game.style.display = 'none';
  window._gameLoopRunning = false;
}
function showGame() {
  menu.style.display = 'none';
  game.style.display = 'block';
  checkOrientation();
  resizeCanvas();
}
function enterGame() {
  showGame();
  hudMyName.textContent = myName;
  roomIdDisplay.textContent = currentRoom;
  renderPlayerCount();
  renderPlayerPanel();
  renderChatMessages();
  lastFrameTime = performance.now();
  if (!window._gameLoopRunning) {
    window._gameLoopRunning = true;
    requestAnimationFrame(gameLoop);
  }
}

function renderPlayerCount() {
  playerCountNum.textContent = String(Object.keys(players).length || 1);
  if (playerPanelVisible) renderPlayerPanel();
}
function renderPlayerPanel() {
  const list = Object.values(players).sort((a,b) => (b.isHost ? 1 : 0) - (a.isHost ? 1 : 0) || a.name.localeCompare(b.name));
  playerPanelBody.innerHTML = list.map(p => {
    const me = p.id === myPlayerId;
    const canKick = isHost && !me;
    return `<div class="player-row">
      <span class="color-dot" style="background:${escapeHtml(p.color)}"></span>
      <span class="player-name">${escapeHtml(p.name)}${me ? ' · 你' : ''}</span>
      ${p.isHost ? '<span class="host-badge">房主</span>' : ''}
      ${canKick ? `<button type="button" class="kick-btn" data-player-id="${escapeHtml(p.id)}">移出</button>` : ''}
    </div>`;
  }).join('') || '<div class="empty-msg">暂无玩家</div>';
  playerPanelBody.querySelectorAll('.kick-btn').forEach(btn => {
    btn.addEventListener('click', () => kickPlayer(btn.dataset.playerId));
  });
}
function togglePlayerPanel(force) {
  playerPanelVisible = typeof force === 'boolean' ? force : !playerPanelVisible;
  playerPanel.classList.toggle('open', playerPanelVisible);
  playerCountBtn.setAttribute('aria-expanded', String(playerPanelVisible));
  if (playerPanelVisible) renderPlayerPanel();
}
function addMessage(name, text, time = Date.now()) {
  const cleanText = sanitizeChatText(text); if (!cleanText) return;
  messages.push({ name: sanitizeName(name), text: cleanText, time });
  if (messages.length > 60) messages.splice(0, messages.length - 60);
  renderChatMessages();
}
function renderChatMessages() {
  const rows = messages.map(m => `<div class="msg-item"><span class="msg-name">${escapeHtml(m.name)}</span><span class="msg-text">${escapeHtml(m.text)}</span></div>`).join('');
  const html = rows || '<div class="empty-msg">暂无消息</div>';
  chatPanelMessages.innerHTML = html;
  chatStream.innerHTML = messages.slice(-3).map(m => `<div class="msg-item"><span class="msg-name">${escapeHtml(m.name)}</span><span class="msg-text">${escapeHtml(m.text)}</span></div>`).join('') || '<div class="empty-msg">暂无消息</div>';
  chatPanelMessages.scrollTop = chatPanelMessages.scrollHeight;
}
function toggleChat(force) {
  chatVisible = typeof force === 'boolean' ? force : !chatVisible;
  chatPanel.classList.toggle('open', chatVisible);
  chatPanel.setAttribute('aria-hidden', String(!chatVisible));
  chatToggle.setAttribute('aria-expanded', String(chatVisible));
  if (chatVisible) setTimeout(() => chatInput.focus(), 0);
}
function sendPacket(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}
function sendChatMessage(value) {
  const text = sanitizeChatText(value); if (!text) return;
  if (!sendPacket({ t: 'chat', text })) { showToast('正在重连，消息未发送'); return; }
  chatInput.value = '';
}
function kickPlayer(id) {
  if (!isHost || !players[id]) return;
  if (confirm(`确定移出 ${players[id].name} 吗？`)) sendPacket({ t: 'kick', id });
}

function sessionKey(room) { return `au-dtam-session:${room}`; }
function loadResumeToken(room) {
  try { return sessionStorage.getItem(sessionKey(room)) || ''; } catch (_) { return ''; }
}
function saveResumeToken(room, token) {
  try { sessionStorage.setItem(sessionKey(room), token); } catch (_) {}
}
function clearResumeToken(room) {
  try { sessionStorage.removeItem(sessionKey(room)); } catch (_) {}
}
function startHeartbeat() {
  clearInterval(heartbeatTimer);
  lastPongAt = Date.now();
  heartbeatTimer = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (document.visibilityState === 'visible' && Date.now() - lastPongAt > STALE_SOCKET_MS) {
      try { socket.close(4001, 'stale'); } catch (_) {}
      return;
    }
    sendPacket({ t: 'ping', at: Date.now() });
  }, HEARTBEAT_INTERVAL);
}
function stopHeartbeat() { clearInterval(heartbeatTimer); heartbeatTimer = null; }

function normalizePlayers(raw) {
  const out = {};
  for (const p of Array.isArray(raw) ? raw : Object.values(raw || {})) {
    if (!p || !p.id) continue;
    out[p.id] = {
      id: String(p.id), name: sanitizeName(p.name), color: COLORS.includes(p.color) ? p.color : COLORS[0],
      pos: { x: Number(p.pos?.x) || 75.5, y: Number(p.pos?.y) || 75.5 },
      isHost: !!p.isHost, connected: p.connected !== false
    };
  }
  return out;
}
function handleServerMessage(data) {
  let msg; try { msg = JSON.parse(data); } catch (_) { return; }
  if (!msg || typeof msg.t !== 'string') return;
  if (msg.t === 'welcome') {
    currentRoom = String(msg.room || currentRoom);
    myPlayerId = String(msg.self?.id || '');
    resumeToken = String(msg.self?.token || '');
    saveResumeToken(currentRoom, resumeToken);
    players = normalizePlayers(msg.players);
    if (players[myPlayerId]) {
      myPos = { ...players[myPlayerId].pos };
      myName = players[myPlayerId].name;
    }
    isHost = String(msg.hostId || '') === myPlayerId;
    for (const p of Object.values(players)) p.isHost = p.id === String(msg.hostId || '');
    objectState = { ...objectState, ...(msg.objects || {}) };
    reconnectAttempts = 0;
    lastPongAt = Date.now();
    setConnectionState('online', '已连接');
    enterGame();
    if (connectResolve) connectResolve();
    clearTimeout(connectTimeout); connectTimeout = null; connectResolve = null; connectReject = null;
    if (msg.resumed) showToast('连接已恢复');
    return;
  }
  if (msg.t === 'state') {
    const next = normalizePlayers(msg.players);
    if (next[myPlayerId]) {
      const serverPos = next[myPlayerId].pos;
      if (Math.hypot(serverPos.x - myPos.x, serverPos.y - myPos.y) > 1.2) myPos = { ...serverPos };
      next[myPlayerId].pos = { ...myPos };
    }
    players = next;
    isHost = !!players[myPlayerId]?.isHost;
    renderPlayerCount();
    return;
  }
  if (msg.t === 'chat') { addMessage(msg.name, msg.text, msg.at); return; }
  if (msg.t === 'notice') { showLeaveNotice(String(msg.text || '')); return; }
  if (msg.t === 'objects') { objectState = { ...objectState, ...(msg.objects || {}) }; return; }
  if (msg.t === 'pong') { lastPongAt = Date.now(); return; }
  if (msg.t === 'kicked') {
    intentionalClose = true;
    showToast('你已被房主移出房间', 2200);
    setTimeout(() => leaveGame(false, '你已被房主移出房间'), 500);
    return;
  }
  if (msg.t === 'error') {
    const code = String(msg.code || '');
    const text = String(msg.message || '连接失败');
    if (code === 'resume_invalid' && currentRoom) {
      clearResumeToken(currentRoom); resumeToken = '';
      if (socket) { intentionalClose = true; try { socket.close(); } catch (_) {} }
      setTimeout(() => connectRoom(currentRoom, false, true).catch(() => {}), 100);
      return;
    }
    if (connectReject) { connectReject(new Error(text)); clearTimeout(connectTimeout); connectResolve = null; connectReject = null; }
    setMenuStatus(text, 'error');
    setConnectionState('error', '连接失败');
    if (code === 'room_not_found' || code === 'room_closed') {
      clearResumeToken(currentRoom);
      if (game.style.display !== 'none') setTimeout(() => leaveGame(false, text), 600);
    }
  }
}

function connectRoom(room, create = false, reconnect = false) {
  room = String(room).replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(room)) return Promise.reject(new Error('房间号格式错误'));
  currentRoom = room;
  if (!resumeToken) resumeToken = loadResumeToken(room);
  intentionalClose = false;
  const generation = ++socketGeneration;
  if (socket) { try { socket.onclose = null; socket.close(); } catch (_) {} }
  setConnectionState('connecting', reconnect ? '重连中' : '连接中');
  if (!reconnect) setMenuStatus(create ? '正在创建房间…' : '正在加入房间…');
  const params = new URLSearchParams({ room, name: myName, create: create ? '1' : '0', v: '1.3' });
  if (resumeToken) params.set('token', resumeToken);
  const ws = new WebSocket(`${REALTIME_ORIGIN}/ws?${params}`);
  socket = ws;
  return new Promise((resolve, reject) => {
    connectResolve = resolve; connectReject = reject;
    connectTimeout = setTimeout(() => {
      if (generation !== socketGeneration) return;
      try { ws.close(); } catch (_) {}
      reject(new Error('连接超时，请稍后重试'));
      connectResolve = null; connectReject = null;
    }, 10000);
    ws.onopen = () => {
      if (generation !== socketGeneration) return;
      lastPongAt = Date.now(); startHeartbeat();
    };
    ws.onmessage = (event) => { if (generation === socketGeneration) handleServerMessage(event.data); };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (generation !== socketGeneration) return;
      stopHeartbeat();
      if (connectReject) {
        const r = connectReject; clearTimeout(connectTimeout); connectResolve = null; connectReject = null;
        r(new Error('无法连接到实时服务器'));
      }
      if (!intentionalClose && currentRoom && game.style.display !== 'none') scheduleReconnect();
      else if (!intentionalClose && menu.style.display !== 'none') setConnectionState('error', '连接失败');
    };
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectAttempts++;
  const delay = Math.min(8000, 500 * Math.pow(2, Math.min(reconnectAttempts - 1, 4)));
  setConnectionState('connecting', `重连中 ${reconnectAttempts}`);
  showToast('连接中断，正在自动恢复…', 1400);
  reconnectTimer = setTimeout(async () => {
    if (intentionalClose || !currentRoom) return;
    try { await connectRoom(currentRoom, false, true); }
    catch (_) { if (!intentionalClose) scheduleReconnect(); }
  }, delay);
}

async function createRoom() {
  createBtn.disabled = joinBtn.disabled = true;
  resumeToken = '';
  for (let i = 0; i < 5; i++) {
    const room = generateRoomId();
    try { await connectRoom(room, true, false); createBtn.disabled = joinBtn.disabled = false; return; }
    catch (err) {
      if (!String(err.message).includes('已存在')) { setMenuStatus(err.message, 'error'); break; }
    }
  }
  createBtn.disabled = joinBtn.disabled = false;
}
async function joinRoom(room) {
  createBtn.disabled = joinBtn.disabled = true;
  resumeToken = loadResumeToken(room);
  try { await connectRoom(room, false, false); }
  catch (err) { setMenuStatus(err.message, 'error'); }
  createBtn.disabled = joinBtn.disabled = false;
}
function leaveGame(sendLeave = true, menuText = '已退出房间') {
  intentionalClose = true;
  clearTimeout(reconnectTimer); reconnectTimer = null;
  stopHeartbeat();
  if (sendLeave) sendPacket({ t: 'leave' });
  if (socket) { try { socket.close(1000, 'leave'); } catch (_) {} }
  socket = null;
  if (currentRoom) clearResumeToken(currentRoom);
  currentRoom = ''; resumeToken = ''; myPlayerId = ''; players = {}; isHost = false;
  keys = {}; resetJoy(); messages = [];
  toggleChat(false); togglePlayerPanel(false);
  showMenu(); setConnectionState('offline', '离线'); setMenuStatus(menuText);
}

function update(dt) {
  dt = clamp(dt, 0, 0.05);
  if (!socket || socket.readyState !== WebSocket.OPEN || !myPlayerId) return;
  let dx = 0, dy = 0;
  if (keys.ArrowUp || keys.w || keys.W) dy -= 1;
  if (keys.ArrowDown || keys.s || keys.S) dy += 1;
  if (keys.ArrowLeft || keys.a || keys.A) dx -= 1;
  if (keys.ArrowRight || keys.d || keys.D) dx += 1;
  if (joyActive) { dx += joyDX; dy += joyDY; }
  const mag = Math.hypot(dx, dy);
  if (mag > 1) { dx /= mag; dy /= mag; }
  if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
    const step = MOVE_SPEED * dt;
    const nx = clamp(myPos.x + dx * step, PLAYER_RADIUS, MAP_SIZE - PLAYER_RADIUS);
    if (!circleHitsWall(nx, myPos.y)) myPos.x = nx;
    const ny = clamp(myPos.y + dy * step, PLAYER_RADIUS, MAP_SIZE - PLAYER_RADIUS);
    if (!circleHitsWall(myPos.x, ny)) myPos.y = ny;
    if (players[myPlayerId]) players[myPlayerId].pos = { ...myPos };
    posDirty = true;
  }
  if (posDirty && performance.now() - lastPosSendTime >= POS_SEND_INTERVAL) {
    sendPacket({ t: 'pos', x: +myPos.x.toFixed(3), y: +myPos.y.toFixed(3) });
    lastPosSendTime = performance.now(); posDirty = false;
  }
  const near = nearestInteractable();
  interactBtn.disabled = !near;
  interactBtn.textContent = near ? (objectState[near.id]?.active ? '已修复' : '互动') : '互动';
  interactBtn.title = near ? near.label : '靠近设施后可互动';
}

function getCanvasPalette() {
  const dark = (document.documentElement.dataset.theme || 'dark') === 'dark';
  return dark ? {
    bg:'#0b0d10', floor:'#11151a', grid:'#171c22', wall:'#2b323b', wallEdge:'#3b4551', text:'#f3f4f6', muted:'#9ca3af',
    object:'#d1d5db', objectActive:'#22c55e', labelShadow:'rgba(0,0,0,.75)', wait:'rgba(255,255,255,.42)', outside:'#07090b'
  } : {
    bg:'#e8ebef', floor:'#f5f6f7', grid:'#e6e9ed', wall:'#b8c0ca', wallEdge:'#9da7b4', text:'#111827', muted:'#667085',
    object:'#475467', objectActive:'#15803d', labelShadow:'rgba(255,255,255,.9)', wait:'rgba(17,24,39,.42)', outside:'#dfe3e8'
  };
}
function resizeCanvas() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas._cssWidth = w; canvas._cssHeight = h;
}
function drawMap(view, palette) {
  const { left, top, side, tilePx, cameraX, cameraY } = view;
  ctx.fillStyle = palette.outside; ctx.fillRect(0,0,canvas._cssWidth,canvas._cssHeight);
  ctx.fillStyle = palette.floor; ctx.fillRect(left, top, side, side);
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, side, side); ctx.clip();
  const minCol = Math.max(0, Math.floor(cameraX - VIEW_TILES / 2) - 1);
  const maxCol = Math.min(MAP_SIZE - 1, Math.ceil(cameraX + VIEW_TILES / 2) + 1);
  const minRow = Math.max(0, Math.floor(cameraY - VIEW_TILES / 2) - 1);
  const maxRow = Math.min(MAP_SIZE - 1, Math.ceil(cameraY + VIEW_TILES / 2) + 1);
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const sx = left + (col - (cameraX - VIEW_TILES/2)) * tilePx;
      const sy = top + (row - (cameraY - VIEW_TILES/2)) * tilePx;
      if (isWallCell(col,row)) {
        ctx.fillStyle = palette.wall; ctx.fillRect(sx, sy, tilePx + .5, tilePx + .5);
        ctx.strokeStyle = palette.wallEdge; ctx.lineWidth = 1; ctx.strokeRect(sx+.5, sy+.5, tilePx-1, tilePx-1);
      } else if (tilePx >= 20) {
        ctx.strokeStyle = palette.grid; ctx.lineWidth = 1; ctx.strokeRect(sx, sy, tilePx, tilePx);
      }
    }
  }
  for (const obj of OBJECT_DEFS) {
    if (Math.abs(obj.x-cameraX) > 11 || Math.abs(obj.y-cameraY) > 11) continue;
    const sx = left + (obj.x - (cameraX - VIEW_TILES/2)) * tilePx;
    const sy = top + (obj.y - (cameraY - VIEW_TILES/2)) * tilePx;
    const active = !!objectState[obj.id]?.active;
    ctx.fillStyle = active ? palette.objectActive : palette.object;
    ctx.fillRect(sx - tilePx*.24, sy - tilePx*.24, tilePx*.48, tilePx*.48);
    ctx.strokeStyle = palette.floor; ctx.lineWidth = Math.max(1, tilePx*.06); ctx.strokeRect(sx - tilePx*.24, sy - tilePx*.24, tilePx*.48, tilePx*.48);
    if (Math.hypot(myPos.x-obj.x,myPos.y-obj.y) < 1.45) {
      ctx.strokeStyle = palette.text; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx,sy,tilePx*.42,0,Math.PI*2); ctx.stroke();
      ctx.font = `500 ${Math.max(11,tilePx*.28)}px Inter, system-ui, sans-serif`;
      ctx.textAlign='center'; ctx.textBaseline='bottom'; ctx.fillStyle=palette.text;
      ctx.fillText(obj.label, sx, sy - tilePx*.48);
    }
  }
  ctx.restore();
}
function drawPlayers(view, palette) {
  const { left, top, tilePx, cameraX, cameraY } = view;
  for (const p of Object.values(players)) {
    const pos = p.id === myPlayerId ? myPos : p.pos;
    if (!pos || Math.abs(pos.x-cameraX)>11 || Math.abs(pos.y-cameraY)>11) continue;
    const x = left + (pos.x - (cameraX - VIEW_TILES/2)) * tilePx;
    const y = top + (pos.y - (cameraY - VIEW_TILES/2)) * tilePx;
    const r = PLAYER_RADIUS * tilePx;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fillStyle=p.color; ctx.fill();
    ctx.lineWidth=Math.max(1.5,tilePx*.07); ctx.strokeStyle=p.id===myPlayerId?palette.text:'rgba(0,0,0,.28)'; ctx.stroke();
    ctx.font=`600 ${Math.max(11,tilePx*.27)}px Inter, system-ui, sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='bottom'; ctx.fillStyle=palette.text;
    ctx.shadowColor=palette.labelShadow; ctx.shadowBlur=3;
    ctx.fillText(`${p.name}${p.id===myPlayerId?' · 你':''}`,x,y-r-5); ctx.shadowBlur=0;
    if (p.isHost) {
      ctx.font=`500 ${Math.max(9,tilePx*.21)}px Inter, system-ui, sans-serif`; ctx.fillStyle=palette.muted;
      ctx.fillText('房主',x,y-r-Math.max(20,tilePx*.33));
    }
  }
}
function draw() {
  const W = canvas._cssWidth || innerWidth, H = canvas._cssHeight || innerHeight;
  const side = Math.min(W,H), left=(W-side)/2, top=(H-side)/2, tilePx=side/VIEW_TILES;
  const cameraX=clamp(myPos.x,VIEW_TILES/2,MAP_SIZE-VIEW_TILES/2);
  const cameraY=clamp(myPos.y,VIEW_TILES/2,MAP_SIZE-VIEW_TILES/2);
  const view={left,top,side,tilePx,cameraX,cameraY};
  const palette=getCanvasPalette();
  ctx.clearRect(0,0,W,H); drawMap(view,palette); drawPlayers(view,palette);
  if (Object.keys(players).length <= 1) {
    ctx.font='500 14px Inter, system-ui, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle=palette.wait;
    ctx.fillText('等待其他玩家加入…',W/2,H/2+Math.min(side*.16,90));
  }
}
function gameLoop(now=performance.now()) {
  if (!window._gameLoopRunning) return;
  const dt=(now-lastFrameTime)/1000; lastFrameTime=now; update(dt); draw(); requestAnimationFrame(gameLoop);
}

const joystickRect = () => joystick.getBoundingClientRect();
function handleJoyTouch(clientX, clientY) {
  const rect=joystickRect(), cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
  const dx=clientX-cx, dy=clientY-cy, maxR=Math.max(1,rect.width/2-20), dist=Math.hypot(dx,dy);
  const scale=Math.min(1,dist/maxR), angle=Math.atan2(dy,dx), kx=Math.cos(angle)*maxR*scale, ky=Math.sin(angle)*maxR*scale;
  joystickKnob.style.transform=`translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  joyDX=Math.cos(angle)*scale; joyDY=Math.sin(angle)*scale; joyActive=dist>2;
}
function resetJoy() { joyActive=false; joyDX=0; joyDY=0; joystickKnob.style.transform='translate(-50%, -50%)'; }

window.addEventListener('keydown', e => { if (document.activeElement!==chatInput) keys[e.key]=true; });
window.addEventListener('keyup', e => { keys[e.key]=false; });
window.addEventListener('blur', () => { keys={}; resetJoy(); });
window.addEventListener('resize', () => { checkOrientation(); resizeCanvas(); });
window.addEventListener('orientationchange', () => setTimeout(() => { checkOrientation(); resizeCanvas(); }, 150));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState==='visible' && currentRoom && (!socket || socket.readyState!==WebSocket.OPEN) && !intentionalClose) scheduleReconnect();
});
joystick.addEventListener('touchstart', e => { e.preventDefault(); if(e.touches[0]) handleJoyTouch(e.touches[0].clientX,e.touches[0].clientY); }, {passive:false});
joystick.addEventListener('touchmove', e => { e.preventDefault(); if(e.touches[0]) handleJoyTouch(e.touches[0].clientX,e.touches[0].clientY); }, {passive:false});
joystick.addEventListener('touchend', e => { e.preventDefault(); resetJoy(); }, {passive:false});
joystick.addEventListener('touchcancel', resetJoy);
joystick.addEventListener('mousedown', e => { mouseDown=true; handleJoyTouch(e.clientX,e.clientY); });
window.addEventListener('mousemove', e => { if(mouseDown) handleJoyTouch(e.clientX,e.clientY); });
window.addEventListener('mouseup', () => { if(mouseDown){mouseDown=false;resetJoy();} });

createBtn.addEventListener('click', async () => { myName=sanitizeName(nameInput.value); nameInput.value=myName; await createRoom(); });
showJoinBtn.addEventListener('click', () => {
  joinVisible=!joinVisible; joinSection.style.display=joinVisible?'block':'none'; showJoinBtn.textContent=joinVisible?'取消':'加入房间';
  if(joinVisible) roomIdInput.focus();
});
joinBtn.addEventListener('click', async () => {
  const room=roomIdInput.value.trim(); if(!/^\d{6}$/.test(room)){setMenuStatus('请输入 6 位数字房间号','error');return;}
  myName=sanitizeName(nameInput.value); nameInput.value=myName; await joinRoom(room);
});
roomIdInput.addEventListener('keydown',e=>{if(e.key==='Enter')joinBtn.click();});
nameInput.addEventListener('keydown',e=>{if(e.key==='Enter')createBtn.click();});
leaveBtn.addEventListener('click',()=>{if(confirm('确定要退出房间吗？'))leaveGame(true);});
chatToggle.addEventListener('click',()=>toggleChat()); chatPanelClose.addEventListener('click',()=>toggleChat(false));
chatSend.addEventListener('click',()=>sendChatMessage(chatInput.value)); chatInput.addEventListener('keydown',e=>{if(e.key==='Enter')sendChatMessage(chatInput.value);});
chatInput.addEventListener('focus',()=>{keys={};});
playerCountBtn.addEventListener('click',()=>togglePlayerPanel()); playerPanelClose.addEventListener('click',()=>togglePlayerPanel(false));
settingsBtn.addEventListener('click',toggleTheme); menuThemeBtn.addEventListener('click',toggleTheme);
roomIdDisplay.addEventListener('click', async () => { try { await navigator.clipboard.writeText(currentRoom); showToast('房间号已复制'); } catch (_) { showToast(`房间号 ${currentRoom}`); } });
interactBtn.addEventListener('click', () => {
  const obj=nearestInteractable(); if(!obj){showToast('靠近设施后才能互动');return;}
  if(objectState[obj.id]?.active){showToast(`${obj.label} 已修复`);return;}
  if(!sendPacket({t:'interact',id:obj.id})) showToast('正在重连，请稍后再试');
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(chatVisible)toggleChat(false);if(playerPanelVisible)togglePlayerPanel(false);}});
document.addEventListener('click',e=>{
  if(chatVisible&&!chatPanel.contains(e.target)&&e.target!==chatToggle)toggleChat(false);
  if(joinVisible&&!e.target.closest('.card')){joinVisible=false;joinSection.style.display='none';showJoinBtn.textContent='加入房间';}
});

const defaultName='玩家'+Math.floor(Math.random()*1000); nameInput.value=defaultName; myName=defaultName;
showMenu(); setMenuStatus('输入昵称，然后创建或加入房间'); setConnectionState('offline','离线'); resizeCanvas(); checkOrientation();
interactBtn.disabled=true;
console.log('Among Us 东滩版 1.3 · Cloudflare Pages + Workers + Durable Objects');
})();
