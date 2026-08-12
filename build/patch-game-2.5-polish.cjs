const fs=require('fs');
let src=fs.readFileSync('game.js','utf8');
const re=/(if\(msg\.t==='vent_state'\)\{[\s\S]*?selfState\.ventId=String\(msg\.ventId\|\|''\);)/;
const count=[...src.matchAll(new RegExp(re.source,'g'))].length;
if(count!==1)throw new Error(`[2.5 polish] vent state expected 1 match, got ${count}`);
src=src.replace(re,`$1selfState.ventReadyAt=Number(msg.ventReadyAt||0);selfState.ventExitAt=Number(msg.ventExitAt||0);`);
new Function(src);
fs.writeFileSync('game.js',src);
console.log('[dtam] gameplay 2.5 polish applied');
