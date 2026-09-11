import fs from 'node:fs';
import { PNG } from 'pngjs';
import {read,write,cell,fit,mirror,tint,blit,resize,pixel,crop,bounds} from './unified-art-lib.mjs';
import {removeBackdrop,registeredFrame} from './shop-art-lib.mjs';

const humans=read('assets-src/unified/humans.png'),monsters=read('assets-src/unified/monsters.png');
export const actions=['idle','walk','run','attack','walkAttack','runAttack','hurt','death','interact','cast'];
const directions=['down','left','right','up'];
const monsterDirections=['down','up','left','right'];
const roster=[['swordsman_lvl1',0,5,0],['swordsman_lvl2',0,6,0],['swordsman_lvl3',0,7,0]];
for(const [family,row] of [['slime',0],['plant',1],['orc',2],['vampire',3]])for(let tier=1;tier<=3;tier++)roster.push([family+tier,1,row,tier-1]);
const imported=[['citizen2',0,0,0,['player']],['citizen1',0,1,0,['npc','townsfolk']],['fighter2',0,2,0,['npc','adventurer']],['scholar',0,3,0,['npc','townsfolk']],['town-mage',0,4,0,['npc','townsfolk']]];
const labels={'citizen2':'商人','citizen1':'宿の女主人','fighter2':'斥候','scholar':'学者','town-mage':'街の魔術師'};
const hero=read('assets-src/shop/merchant-walk-original.png');
const heroRows=[0,313,600,890,1254],heroColumns=[0,365,635,905,1254];
const heroSources=Array.from({length:4},(_,d)=>Array.from({length:4},(_,f)=>removeBackdrop(crop(hero,heroColumns[f],heroRows[d],heroColumns[f+1]-heroColumns[f],heroRows[d+1]-heroRows[d]))));
const heroScale=26/Math.max(...heroSources.flat().map(p=>bounds(p).h));
const heroFrames=heroSources.map(row=>row.map(p=>registeredFrame(p,heroScale,28)));
const normalized=new Map();

function pose(family,row,dir,step,variant) {
  // The generated monster atlas alternates left/right in columns 2..5.
  // Select two LEFT poses and mirror them for RIGHT, never reverse facing mid-walk.
  const col=dir===0?step:dir===3?6+step:(family?2+step*2:2+step);
  const key=`${family}:${row}`;
  if(!normalized.has(key)) {
    const sources=Array.from({length:8},(_,c)=>cell(family?monsters:humans,c,row,8,8));
    const boxes=sources.map(bounds),scale=Math.min(26/Math.max(...boxes.map(b=>b.w)),26/Math.max(...boxes.map(b=>b.h)));
    normalized.set(key,sources.map(p=>registeredFrame(p,scale,28)));
  }
  let png=normalized.get(key)[col];
  if(dir===2)png=mirror(png);
  return tint(png,variant);
}
function passingPose(source) {
  const out=crop(source,0,0,32,32);
  for(let y=23;y<32;y++)for(let x=0;x<32;x++)out.data[(y*32+x)*4+3]=0;
  for(let y=23;y<29;y++)for(let x=0;x<32;x++) {
    const i=(y*32+x)*4;if(!source.data[i+3])continue;
    const nx=Math.round(16+(x-16)*.65);
    source.data.copy(out.data,(y*32+nx)*4,i,i+4);
  }
  return out;
}
function animationFrame(base,other,action,f,dir,walkFrames) {
  const out=new PNG({width:32,height:32});
  let src=base,dx=0,dy=0;
  const forward=dir===1?-1:dir===2?1:0;
  if(['walk','run','walkAttack','runAttack'].includes(action))src=walkFrames?.[f]??[base,passingPose(base),other,passingPose(other)][f];
  if(['attack','walkAttack','runAttack'].includes(action)){dx=forward*[0,-1,1,0][f];dy=dir===0?[0,-1,1,0][f]:dir===3?[0,1,-1,0][f]:0;}
  if(action==='hurt')dx=[0,-1,1,0][f];
  if(action==='death')dy=f>1?1:0;
  blit(src,out,dx,dy);
  // Breathing moves only the chest, keeping head and planted feet registered.
  if(action==='idle'&&f===2)blit(crop(base,8,16,16,5),out,8,15);
  if(action==='hurt'&&f===1)for(let i=0;i<out.data.length;i+=4)if(out.data[i+3]){out.data[i]=242;out.data[i+1]=193;out.data[i+2]=150;}
  if(['attack','walkAttack','runAttack'].includes(action)&&f>0&&f<3) {
    for(let k=0;k<8;k++)pixel(out,dir===1?5-k/2:dir===2?26+k/2:12+k,dir===0?26-k/3:dir===3?5+k/3:11+k,[239,214,157]);
  }
  if(action==='cast')for(let k=0;k<8;k++){const a=(k+f/2)*Math.PI/4;pixel(out,16+Math.cos(a)*(5+f*2),10+Math.sin(a)*(4+f),[103,205,195]);}
  if(action==='interact'&&f>0&&f<3){const x=dir===1?7:dir===2?24:21;pixel(out,x,19-f,[189,137,81]);pixel(out,x+1,19-f,[226,178,112]);}
  if(action==='death')for(let i=3;i<out.data.length;i+=4)out.data[i]=Math.round(out.data[i]*[1,.85,.5,.18][f]);
  return out;
}
function sheets(id,family,row,variant,outDir,rows) {
  const result={};
  for(const action of actions) {
    const png=new PNG({width:128,height:128});
    rows.forEach((name,y)=>{
      const d=directions.indexOf(name),heroActor=id==='citizen2',walk=heroActor?heroFrames[d]:undefined;
      const base=heroActor?walk[1]:pose(family,row,d,0,variant),other=heroActor?walk[3]:pose(family,row,d,1,variant);
      // Human head shape stays fixed across contact/passing poses.
      if(!family&&!heroActor)base.data.copy(other.data,0,0,32*14*4);
      const movement = walk ?? (family && row < 2 ? [base,base,other,other] : undefined);
      for(let f=0;f<4;f++)blit(animationFrame(base,other,action,f,d,movement),png,f*32,y*32);
    });
    write(`${outDir}/${action}.png`,png);
    result[action]={action,path:`imported/${id}/${action}.png`,frameWidth:32,frameHeight:32,columns:4,rows:4,directions:rows,frameRate:action==='run'?12:action==='idle'?4:8,repeat:['idle','walk','run'].includes(action)?-1:0};
  }
  return result;
}
for(const [id,family,row,variant]of roster)sheets(id,family,row,variant,`public/assets/actors/unified/${id}`,family?monsterDirections:directions);
for(const [id,family,row,variant,roles]of imported) {
  const dir=`assets-src/actors/imported/${id}`,clips=sheets(id,family,row,variant,dir,directions);
  fs.writeFileSync(`${dir}/actor.json`,JSON.stringify({version:1,id,label:labels[id],sourcePack:'unified-pixel-2026',roles,scale:1,origin:{x:.5,y:.875},clips},null,2)+'\n');
}
const legacy=[['player',0,0],['npc',0,1],['enemy',1,0],['npc-innkeeper',0,1],['npc-scout',0,2],['npc-scholar',0,3],['npc-mage',0,4],['npc-trader',0,0],['guard-rolf',0,5],['guard-mina',0,6],['enemy-goblin',1,4],['enemy-bat',1,5],['enemy-golem',1,6],['enemy-necromancer',1,3],['enemy-lizard',1,2],['enemy-ghost',1,7]];
for(const [name,family,row]of legacy){const png=new PNG({width:128,height:128});directions.forEach((_,d)=>{for(let f=0;f<4;f++)blit(name==='player'?heroFrames[d][f]:pose(family,row,d,f%2,0),png,f*32,d*32)});write(`public/assets/actors/${name}.png`,png);}
console.log('Built unified actor clips: four directions, ten actions, 4 frames per action.');
