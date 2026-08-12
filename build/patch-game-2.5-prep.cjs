const fs=require('fs');
let src=fs.readFileSync('game.js','utf8');
let count=0;
src=src.replace(/const IMPOSTOR_ROLES = new Set\(\[[\s\S]*?const isImpostorRole = role => IMPOSTOR_ROLES\.has\(role\);/,m=>{count++;return m.replace(/\n/g,' ');});
if(count!==1)throw new Error(`[2.5 prep] expected role block once, got ${count}`);
fs.writeFileSync('game.js',src);
console.log('[dtam] gameplay 2.5 prep applied');
