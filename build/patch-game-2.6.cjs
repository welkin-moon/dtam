const fs=require('fs');
const crypto=require('crypto');
const zlib=require('zlib');

const parts=fs.readdirSync('src').filter(name=>/^game-2\.6\.br\.\d+$/.test(name)).sort();
if(!parts.length)throw new Error('[2.6 patch] production bundle parts are missing');
const packed=Buffer.concat(parts.map(name=>fs.readFileSync('src/'+name)));
const src=zlib.brotliDecompressSync(packed).toString('utf8');
new Function(src);
if(!src.includes("const CLIENT_VERSION = '2.6'"))throw new Error('[2.6 patch] bundle version mismatch');
const digest=crypto.createHash('sha256').update(src).digest('hex');
if(digest!=='4f1c28e71a29a9cbf75fc0e0d5db9b8b4d9da960839078b85247b9f98d058959')throw new Error('[2.6 patch] production bundle hash mismatch: '+digest);
fs.writeFileSync('game.js',src);
console.log('[dtam] gameplay 2.6 production bundle restored',{bytes:Buffer.byteLength(src),parts:parts.length,digest});
