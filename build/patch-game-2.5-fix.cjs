const fs=require('fs');
let src=fs.readFileSync('game.js','utf8');
const re=/function drawLightsMask\(view\)\{[^\n]*\}/;
const matches=[...src.matchAll(new RegExp(re.source,'g'))].length;
if(matches!==1)throw new Error(`[2.5 fix] lights mask expected 1 match, got ${matches}`);
src=src.replace(re,`function drawLightsMask(view){if(gameState.sabotage?.type!=='lights'||!isCrewRole(selfState.role)||!selfState.alive)return;const{left,top,side,tilePx,cameraX,cameraY}=view,x=left+(myPos.x-(cameraX-VIEW_TILES/2))*tilePx,y=top+(myPos.y-(cameraY-VIEW_TILES/2))*tilePx,r=tilePx*3.1,path=new Path2D();path.rect(left,top,side,side);path.arc(x,y,r,0,Math.PI*2);ctx.save();ctx.fillStyle='#000';ctx.fill(path,'evenodd');ctx.restore();}`);
new Function(src);
fs.writeFileSync('game.js',src);
console.log('[dtam] gameplay 2.5 lights fix applied');
