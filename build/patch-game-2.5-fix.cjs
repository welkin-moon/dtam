const fs=require('fs');
let src=fs.readFileSync('game.js','utf8');

const lights=/function drawLightsMask\(view\)\{[^\n]*\}/;
const lightMatches=[...src.matchAll(new RegExp(lights.source,'g'))].length;
if(lightMatches!==1)throw new Error(`[2.5 fix] lights mask expected 1 match, got ${lightMatches}`);
src=src.replace(lights,`function drawLightsMask(view){if(gameState.sabotage?.type!=='lights'||!isCrewRole(selfState.role)||!selfState.alive)return;const{left,top,side,tilePx,cameraX,cameraY}=view,x=left+(myPos.x-(cameraX-VIEW_TILES/2))*tilePx,y=top+(myPos.y-(cameraY-VIEW_TILES/2))*tilePx,r=tilePx*3.1,path=new Path2D();path.rect(left,top,side,side);path.arc(x,y,r,0,Math.PI*2);ctx.save();ctx.fillStyle='#000';ctx.fill(path,'evenodd');ctx.restore();}`);

const vent=/(if\(msg\.t==='vent_state'\)\{[\s\S]*?selfState\.ventId=String\(msg\.ventId\|\|''\);)/;
const ventMatches=[...src.matchAll(new RegExp(vent.source,'g'))].length;
if(ventMatches!==1)throw new Error(`[2.5 fix] vent state expected 1 match, got ${ventMatches}`);
src=src.replace(vent,`$1selfState.ventReadyAt=Number(msg.ventReadyAt||0);selfState.ventExitAt=Number(msg.ventExitAt||0);`);

new Function(src);
fs.writeFileSync('game.js',src);
console.log('[dtam] gameplay 2.5 final fixes applied',{lights:lightMatches,vent:ventMatches});
