const fs=require('fs');
let src=fs.readFileSync('game.js','utf8');
const before="mapBtn.onclick=()=>toggleMinimap();minimapClose.onclick=()=>toggleMinimap(false);micBtn.onclick=toggleVoice;";
const after="mapBtn.onclick=()=>toggleMinimap();micBtn.onclick=toggleVoice;minimapClose.onclick=()=>toggleMinimap(false);";
const count=src.split(before).length-1;
if(count!==1)throw new Error(`[2.5 events prep] expected 1 match, got ${count}`);
src=src.replace(before,after);
fs.writeFileSync('game.js',src);
console.log('[dtam] gameplay 2.5 event prep applied');
