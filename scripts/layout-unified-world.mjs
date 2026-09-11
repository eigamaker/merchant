// One-time authoring utility. Not part of the asset build: manual edits stay manual.
import fs from 'node:fs';
import {blobTileTable} from './autotile.mjs';
const file='assets-src/maps/default-map-pack.json',pack=JSON.parse(fs.readFileSync(file,'utf8'));
const home=pack.maps.find(m=>m.kind==='home'),old=structuredClone(home),w=28,h=20;
home.width=w;home.height=h;home.name='商人の店と街';home.updatedAt=new Date().toISOString();
home.terrain=Array(w*h).fill('unified.grass');home.collision=Array(w*h).fill(true);
home.layers={ground:Array.from({length:w*h},()=>({assetId:'unified.grass',frame:0})),structure:Array(w*h).fill(null),decoration:Array(w*h).fill(null)};
for(let y=0;y<10;y++)for(let x=0;x<14;x++) {
  const i=y*w+x,j=y*old.width+x;home.terrain[i]=old.terrain[j];home.collision[i]=old.collision[j];
  for(const layer of ['ground','structure','decoration'])home.layers[layer][i]=old.layers[layer][j];
}
function paint(id,x,y,width,height,walkable,layer='ground',stamp=false){for(let dy=0;dy<height;dy++)for(let dx=0;dx<width;dx++){const i=(y+dy)*w+x+dx;home.layers[layer][i]={assetId:id,frame:stamp?dy*width+dx:0};if(layer==='ground')home.terrain[i]=id;home.collision[i]=walkable;}}
for(const x of [1,10])paint('home.merchant-door',x,8,2,2,true,'decoration',true);
paint('unified.road',1,10,26,3,true);paint('unified.road',14,1,3,18,true);paint('unified.road',1,16,26,3,true);
// Building silhouettes and foundations are solid; door recesses never cross walls.
for(const [x,y,width]of [[18,2,8],[2,13,6]]) {
  paint('unified.roof',x,y,width,3,false,'structure');
  for(let dx=0;dx<width;dx+=2)paint('unified.building-wall',x+dx,y+3,2,2,false,'structure',true);
  paint('unified.window',x+1,y+3,1,1,false,'decoration');
  paint('unified.window',x+width-2,y+3,1,1,false,'decoration');
}
for(const [x,y]of [[21,5],[4,16]]) {
  paint('unified.ruins-floor',x,y,2,2,true);
  paint('unified.door',x,y,2,2,true,'decoration',true);
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)home.layers.structure[(y+dy)*w+x+dx]=null;
}
paint('unified.road',21,7,2,4,true);
paint('unified.water',20,13,4,3,false);
for(const [x,y]of [[1,11],[10,14],[25,12],[25,8]])paint('unified.tree',x,y,2,3,false,'decoration',true);
paint('unified.boulder',17,13,2,2,false,'decoration',true);
// Outer boundary is always closed. Only authored stair/door transitions change maps.
for(let x=0;x<w;x++){home.collision[x]=false;home.collision[(h-1)*w+x]=false;}
for(let y=0;y<h;y++){home.collision[y*w]=false;home.collision[y*w+w-1]=false;}
const entrance=home.markers.find(m=>m.kind==='dungeonEntrance');entrance.x=25;entrance.y=17;
home.layers.decoration[17*w+25]={assetId:'unified.stairs',frame:22};
home.layers.decoration[9*w+2]=old.layers.decoration[9*old.width+2];
for(const dungeon of pack.maps.filter(m=>m.kind==='dungeon')) {
  for(let i=0;i<dungeon.width*dungeon.height;i++) {
    dungeon.layers.ground[i]={assetId:'unified.cave-floor',frame:0};
    dungeon.layers.structure[i]=dungeon.collision[i]?null:{assetId:'unified.cave-wall',frame:0};
    dungeon.layers.decoration[i]=null;dungeon.terrain[i]=dungeon.collision[i]?'unified.cave-floor':'unified.cave-wall';
  }
  for(let i=0;i<dungeon.collision.length;i++)if(!dungeon.collision[i]) {
    let mask=0;const x=i%dungeon.width,y=Math.floor(i/dungeon.width);
    [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]].forEach(([dx,dy],bit)=>{
      const nx=x+dx,ny=y+dy;
      if(nx<0||ny<0||nx>=dungeon.width||ny>=dungeon.height||!dungeon.collision[ny*dungeon.width+nx])mask|=1<<bit;
    });
    dungeon.layers.structure[i].frame=blobTileTable().frameByMask[mask];
  }
  for(const marker of dungeon.markers)if(['stairsUp','stairsDown'].includes(marker.kind))marker.visual={assetId:'unified.stairs',frame:marker.kind==='stairsUp'?14:22};
}
fs.writeFileSync(file,JSON.stringify(pack,null,2)+'\n');
const themeFile='assets-src/dungeon-themes/themes.json',themes=JSON.parse(fs.readFileSync(themeFile,'utf8'));
for(const theme of themes.themes) {
  const floor=theme.id==='cave'?'cave-floor':theme.id==='ruins'?'ruins-floor':'volcanic-floor';
  theme.wall={assetId:`unified.${theme.id==='ruins'?'ruins-wall':'cave-wall'}`};
  theme.floorVariants=theme.floorVariants.map(v=>({...v,assetId:`unified.${floor}`,frame:0}));
  theme.stairsUp={assetId:'unified.stairs',frame:14};theme.stairsDown={assetId:'unified.stairs',frame:22};
  theme.objects={chest:{assetId:'unified.chest',frame:0},corpse:{assetId:'unified.bones',frame:['cave','ruins','lava'].indexOf(theme.id)}};
  for(const rule of theme.decorations) {
    const wall=['wall','wallFace'].includes(rule.placement),id=wall?'torch':rule.id.includes('bones')?'bones':'rubble';
    rule.variants=rule.variants.map(v=>({...v,assetId:`unified.${id}`,frame:0}));
    // Floor scatter is small, traversable rubble. Large solid props stay in manual maps.
    if(wall)rule.placement='wallFace';
  }
}
fs.writeFileSync(themeFile,JSON.stringify(themes,null,2)+'\n');
