from pathlib import Path

p = Path('game.js')
s = p.read_text(encoding='utf-8')

replacements = [
    (
        "function nearestBody(){if(!selfState.alive||selfState.inVent||gameState.phase!=='playing')return null;let best=null,bestD=1.55*NETWORK_TO_CLIENT;for(const b of bodies){const d=Math.hypot(myPos.x-b.x,myPos.y-b.y);if(d<bestD){best=b;bestD=d;}}return best;}",
        "function nearestBody(){if(!selfState.alive||selfState.inVent||gameState.phase!=='playing')return null;let best=null,bestD=1.55*NETWORK_TO_CLIENT;for(const b of bodies){const d=Math.hypot(myPos.x-b.x,myPos.y-b.y);if(d<bestD&&hasNetworkLineOfSight(myPos,b)){best=b;bestD=d;}}return best;}"
    ),
    (
        "function closeToolOverlays(forceVent=false){closeTask();closeSabotage();if(forceVent||!selfState.inVent)ventOverlay.classList.remove('show');closeInfo();closeVitals();toggleMinimap(false);keys={};resetJoy();}",
        "function closeToolOverlays(forceVent=false){closeTask();closeSabotage();if(forceVent||!selfState.inVent)ventOverlay.classList.remove('show');closeInfo();closeVitals();toggleMinimap(false);toggleChat(false);togglePlayerPanel(false);if(hudMoreMenu){hudMoreMenu.hidden=true;moreBtn?.setAttribute('aria-expanded','false');}keys={};resetJoy();}"
    ),
    (
        "for(const b of bodies){if(Math.abs(b.x-cameraX)>half+1||Math.abs(b.y-cameraY)>half+1)continue;const x=left+(b.x-worldLeft)*tilePx",
        "for(const b of bodies){if(Math.abs(b.x-cameraX)>half+1||Math.abs(b.y-cameraY)>half+1)continue;if(selfState.alive&&!hasNetworkLineOfSight(myPos,b))continue;const x=left+(b.x-worldLeft)*tilePx"
    ),
    (
        "if(Math.abs(px-cameraX)>VIEW_TILES/2+1||Math.abs(py-cameraY)>VIEW_TILES/2+1)continue;if(lights&&pl.id!==myPlayerId&&Math.hypot(px-myPos.x,py-myPos.y)>vision)continue;let shown=pl;",
        "if(Math.abs(px-cameraX)>VIEW_TILES/2+1||Math.abs(py-cameraY)>VIEW_TILES/2+1)continue;if(pl.id!==myPlayerId&&selfState.alive&&!hasNetworkLineOfSight(myPos,{x:px,y:py}))continue;if(lights&&pl.id!==myPlayerId&&Math.hypot(px-myPos.x,py-myPos.y)>vision)continue;let shown=pl;"
    ),
    (
        "function togglePlayerPanel(force){playerPanelVisible=typeof force==='boolean'?force:!playerPanelVisible;playerPanel.classList.toggle('open',playerPanelVisible);playerCountBtn.setAttribute('aria-expanded',String(playerPanelVisible));if(playerPanelVisible)renderPlayerPanel();}",
        "function togglePlayerPanel(force){playerPanelVisible=typeof force==='boolean'?force:!playerPanelVisible;if(playerPanelVisible&&chatVisible)toggleChat(false);playerPanel.classList.toggle('open',playerPanelVisible);playerCountBtn.setAttribute('aria-expanded',String(playerPanelVisible));if(playerPanelVisible)renderPlayerPanel();}"
    ),
    (
        "function toggleChat(force){chatVisible=typeof force==='boolean'?force:!chatVisible;chatPanel.classList.toggle('open',chatVisible);chatPanel.setAttribute('aria-hidden',String(!chatVisible));chatToggle.setAttribute('aria-expanded',String(chatVisible));if(chatVisible)setTimeout(()=>chatInput.focus(),0);}",
        "function toggleChat(force){chatVisible=typeof force==='boolean'?force:!chatVisible;if(chatVisible&&playerPanelVisible)togglePlayerPanel(false);if(chatVisible&&hudMoreMenu){hudMoreMenu.hidden=true;moreBtn?.setAttribute('aria-expanded','false');}chatPanel.classList.toggle('open',chatVisible);chatPanel.setAttribute('aria-hidden',String(!chatVisible));chatToggle.setAttribute('aria-expanded',String(chatVisible));if(chatVisible)setTimeout(()=>chatInput.focus(),0);}"
    ),
]

for old, new in replacements:
    if old not in s:
        raise SystemExit(f'missing game.js anchor: {old[:80]}')
    s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8', newline='\n')

css = Path('player-shell.css')
c = css.read_text(encoding='utf-8')
marker = '/* UX LOS HOTFIX 20260916 */'
if marker in c:
    raise SystemExit('hotfix already present')

c += """

/* UX LOS HOTFIX 20260916 */
/* During meetings, chat is a deliberate drawer above the meeting scrim rather than a hidden/overlapping game panel. */
#game:has(#meetingOverlay.show) #chatPanel.open {
  position: fixed !important;
  z-index: 96 !important;
  top: max(14px, env(safe-area-inset-top)) !important;
  right: max(14px, env(safe-area-inset-right)) !important;
  bottom: max(14px, env(safe-area-inset-bottom)) !important;
  left: auto !important;
  width: min(340px, 32vw) !important;
  max-height: none !important;
}
#game:has(#meetingOverlay.show):has(#chatPanel.open) #meetingOverlay {
  padding-right: calc(min(340px, 32vw) + max(28px, env(safe-area-inset-right))) !important;
}
#game:has(#meetingOverlay.show) #playerPanel.open {
  display: none !important;
}
@media (max-width: 900px), (max-height: 600px) and (orientation: landscape) {
  #game:has(#meetingOverlay.show) #chatPanel.open {
    top: auto !important;
    left: max(8px, env(safe-area-inset-left)) !important;
    right: max(8px, env(safe-area-inset-right)) !important;
    bottom: max(8px, env(safe-area-inset-bottom)) !important;
    width: auto !important;
    max-height: min(38dvh, 260px) !important;
  }
  #game:has(#meetingOverlay.show):has(#chatPanel.open) #meetingOverlay {
    align-items: flex-start !important;
    padding-right: max(8px, env(safe-area-inset-right)) !important;
    padding-bottom: calc(min(38dvh, 260px) + max(18px, env(safe-area-inset-bottom))) !important;
  }
}
"""
css.write_text(c, encoding='utf-8', newline='\n')
