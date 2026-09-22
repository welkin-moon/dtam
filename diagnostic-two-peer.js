(() => {
  const errors=[], guestEvents=[];
  const mark=(kind,value)=>errors.push({kind,value:String(value||'')});
  addEventListener('error',e=>mark('error',e.message||e.error));
  addEventListener('unhandledrejection',e=>mark('rejection',e.reason?.stack||e.reason));
  const el=id=>document.getElementById(id), wait=ms=>new Promise(r=>setTimeout(r,ms));
  const finish=result=>{
    let out=el('dtam-two-peer-probe');
    if(!out){out=document.createElement('pre');out.id='dtam-two-peer-probe';out.style.display='none';document.body.appendChild(out);}
    out.textContent=JSON.stringify(result);document.documentElement.dataset.dtamTwoPeerProbe='done';
  };
  (async()=>{
    for(let i=0;i<50;i++){if(typeof el('createRoomBtn')?.onclick==='function'&&typeof el('joinRoomBtn')?.onclick==='function')break;await wait(200);}
    const input=el('playerNameInput');
    if(input){input.value='HostProbe';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
    el('createRoomBtn')?.click();
    for(let i=0;i<30;i++){await wait(300);if((el('roomIdDisplay')?.textContent||'').match(/^\d{2}$/)&&getComputedStyle(el('game')).display!=='none')break;}
    const room=(el('roomIdDisplay')?.textContent||'').trim();
    if(!/^\d{2}$/.test(room))return finish({ok:false,stage:'host',room,menuStatus:el('menuStatus')?.textContent,errors});
    const client='ProbeGuest_'+Math.random().toString(36).slice(2).padEnd(18,'x').slice(0,18);
    const q=new URLSearchParams({room,name:'GuestProbe',create:'0',v:'3.0.2',map:'dtam-map-150-v1',client});
    const guest=new WebSocket('wss://rt-d1.lunarlab.uk/ws?'+q);
    let welcome=null,guestError=null,guestOpenAt=0,welcomeAt=0;
    const t0=performance.now();
    guest.onopen=()=>{guestOpenAt=performance.now()-t0;guestEvents.push({t:'open',at:guestOpenAt});};
    guest.onmessage=e=>{let m=null;try{m=JSON.parse(String(e.data||''));}catch(_){}guestEvents.push({t:m?.t||'raw',code:m?.code||'',at:performance.now()-t0});if(m?.t==='welcome'){welcome=m;welcomeAt=performance.now()-t0;}if(m?.t==='error')guestError=m;};
    guest.onerror=()=>guestEvents.push({t:'ws-error',at:performance.now()-t0});
    for(let i=0;i<50&&!welcome&&!guestError;i++)await wait(200);
    await wait(700);
    let players=[];
    try{players=welcome?.players||[];}catch(_){}
    const result={
      ok:!!welcome&&!guestError,
      room,
      guestOpenAt:Math.round(guestOpenAt),
      welcomeAt:Math.round(welcomeAt),
      openBeforeWelcome:!!guestOpenAt&&!!welcomeAt&&guestOpenAt<welcomeAt,
      guestError,
      guestSelf:welcome?.self||null,
      guestPlayerCount:Array.isArray(players)?players.length:Object.keys(players||{}).length,
      guestEvents,
      hostConnection:el('connectionStatus')?.textContent||'',
      hostTransport:el('p2pTransportStatus')?.textContent||'',
      errors
    };
    try{guest.close(1000,'probe done');}catch(_){}
    finish(result);
  })().catch(e=>finish({ok:false,fatal:String(e?.stack||e),errors,guestEvents}));
})();
