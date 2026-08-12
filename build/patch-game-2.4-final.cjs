const fs=require('fs');
let src=fs.readFileSync('game.js','utf8');
const hits={};
function rep(a,b,n){const c=src.split(a).length-1;hits[n]=c;if(c!==1)throw new Error(`[2.4 final] ${n}: expected 1, got ${c}`);src=src.replace(a,b);}
rep("[ruleMorphers,ruleCloakers,ruleVipers,ruleTasks,ruleSpeed,ruleKill,ruleDiscussion,ruleVoting,ruleEmergency,ruleSabotage,ruleConfirm].forEach(el=>el.addEventListener('change',()=>{syncRulesUI();sendRules();}));","[ruleMorphers,ruleCloakers,ruleVipers,ruleTasks,ruleSpeed,ruleKill,ruleDiscussion,ruleVoting,ruleEmergency,ruleSabotage,ruleConfirm].forEach(el=>el.addEventListener('change',()=>{roleCountNote.textContent='内鬼总数 '+(Number(ruleMorphers.value)+Number(ruleCloakers.value)+Number(ruleVipers.value));sendRules();}));",'rule change preserves selection');
rep("function renderLobby(){const visible=gameState.phase==='lobby';lobbyPanel.classList.toggle('show',visible);if(!visible)return;const count=Object.keys(players).length;","function renderLobby(){const visible=gameState.phase==='lobby';lobbyPanel.classList.toggle('show',visible);if(!visible)return;const count=Object.values(players).filter(p=>p.connected).length;",'online lobby count');
rep("paletteTheme='';paletteCache=null;if(persist)","paletteTheme='';paletteCache=null;minimapBase=null;if(persist)",'minimap theme cache');
rep('<span class="color-dot" style="background:${escapeHtml(p.color)}"></span><span>${escapeHtml(p.name)}','${avatarMarkup(p)}<span class="color-dot" style="background:${escapeHtml(p.color)}"></span><span>${escapeHtml(p.name)}','meeting avatar');
new Function(src);
fs.writeFileSync('game.js',src);
console.log('[dtam] gameplay 2.4 final patch applied',hits);
