// Review artifacts only; these images are never used as game backgrounds.
import fs from 'node:fs';
import {PNG} from 'pngjs';
import {readTileSheets} from './map-tile-pipeline.mjs';
import {read,crop,blit,write,resize} from './unified-art-lib.mjs';
const assets=new Map(readTileSheets('assets-src/map-tiles/sheets').map(a=>[a.id,a]));
const map=JSON.parse(fs.readFileSync('assets-src/maps/default-map-pack.json')).maps.find(m=>m.kind==='home');
const out=new PNG({width:map.width*16,height:map.height*16});
for(const layer of ['ground','structure','decoration'])for(let i=0;i<map.width*map.height;i++){
  const c=map.layers[layer][i];if(!c)continue;
  const a=assets.get(c.assetId),p=read(a.sourceFile),s=a.tileSize;
  blit(crop(p,(c.frame%a.columns)*(s+a.spacing)+a.margin,Math.floor(c.frame/a.columns)*(s+a.spacing)+a.margin,s,s),out,(i%map.width)*16,Math.floor(i/map.width)*16);
}
write('docs/art-town-preview.png',resize(out,out.width*3,out.height*3));
const actors=new PNG({width:128*5,height:32*4});
actors.data.fill(0);for(let i=0;i<actors.data.length;i+=4)actors.data.set([40,35,42,255],i);
const rows=[['assets-src/actors/imported/citizen2','walk'],['public/assets/actors/unified/swordsman_lvl2','attack'],['public/assets/actors/unified/slime1','walk'],['public/assets/actors/unified/vampire1','cast']];
rows.forEach(([dir,action],y)=>{
  const sheet=read(`${dir}/${action}.png`);
  for(let f=0;f<4;f++)blit(crop(sheet,f*32,0,32,32),actors,f*128+48,y*32);
  blit(crop(read(`${dir}/death.png`),3*32,0,32,32),actors,4*128+48,y*32);
});
write('docs/art-animation-preview.png',resize(actors,1280,256));
console.log('Wrote map and animation review images in docs/.');
