(() => {
  const errors=[], events=[];
  const el=id=>document.getElementById(id), wait=ms=>new Promise(r=>setTimeout(r,ms));
  addEventListener('error',e=>errors.push('error:'+String(e.message||e.error||'')));
  addEventListener('unhandledrejection',e=>errors.push('rejection:'+String(e.reason?.stack||e.reason||'')));
  const finish=x=>{let p=el('dtam-restart-probe');if(!p){p=document.createElement('pre');p.id='dtam-restart-probe';p.style.display='none';document.body.appendChild(p);}p.textContent=JSON.stringify(x);};
  (async()=>{
    for(let i=0;i<50;i++){if(typeof el('createRoomBtn')?.onclick==='function')break;await wait(200);}
    const name=el('playerNameInput');name.value='RestartHost';name.dispatchEvent(new Event('change',{bubbles:true}));el('createRoomBtn')?.click();
    for(let i=0;i<40;i++){await wait(250);if(/^\d{2}$/.test((el('roomIdDisplay')?.textContent||'').trim())&&getComputedStyle(el('game')).display!=='none')break;}
    const room=(el('roomIdDisplay')?.textContent||'').trim();if(!/^\d{2}$/.test(room))return finish({ok:false,stage:'host',room,errors});
    const q=new URLSearchParams({room,name:'RestartGuest',create:'0',v:'3.0.2',map:'dtam-map-150-v1',client:'RestartGuest_'+Math.random().toString(36).slice(2,18)});
    const guest=new WebSocket('wss://rt-d1.lunarlab.uk/ws?'+q);
    let welcome=false,guestLobbyReset=false,guestError=null;
    guest.onmessage=e=>{let m;try{m=JSON.parse(String(e.data||''));}catch(_){return;}events.push({who:'guest',t:m.t,code:m.code||''});if(m.t==='welcome')welcome=true;if(m.t==='lobby_reset')guestLobbyReset=true;if(m.t==='error')guestError=m;};
    for(let i=0;i<50&&!welcome&&!guestError;i++)await wait(200);
    if(!welcome)return finish({ok:false,stage:'guest',room,guestError,events,errors});
    for(let i=0;i<20;i++){await wait(200);if(!el('startGameBtn')?.disabled)break;}
    el('startGameBtn')?.click();
    for(let i=0;i<30;i++){await wait(200);if((el('phaseLabel')?.textContent||'').includes('进行中'))break;}
    const started=(el('phaseLabel')?.textContent||'').includes('进行中');
    if(!started)return finish({ok:false,stage:'start',room,phase:el('phaseLabel')?.textContent,events,errors});
    guest.send(JSON.stringify({t:'restart_vote'}));
    await wait(500);
    const btn=el('restartVoteBtn');
    const before={text:btn?.textContent,hidden:btn?.hidden,disabled:btn?.disabled};
    btn?.click();
    for(let i=0;i<30;i++){await wait(200);if((el('phaseLabel')?.textContent||'').includes('大厅')||el('lobbyPanel')?.classList.contains('show'))break;}
    const back=el('lobbyPanel')?.classList.contains('show')===true;
    const result={ok:back&&guestLobbyReset&&!guestError,room,started,before,hostPhase:el('phaseLabel')?.textContent,hostLobby:back,guestLobbyReset,guestError,events,errors};
    try{guest.close(1000,'done');}catch(_){}
    finish(result);
  })().catch(e=>finish({ok:false,fatal:String(e?.stack||e),events,errors}));
})();
