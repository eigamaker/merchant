import fs from 'node:fs';
import {read,write,crop,fit,blit} from './unified-art-lib.mjs';
import {PNG} from 'pngjs';
import {removeBackdrop} from './shop-art-lib.mjs';
const source=read('assets-src/shop/furniture-proportions.png');
const geometry=JSON.parse(fs.readFileSync('assets-src/shop/furniture-geometry.json','utf8'));
for(const [n,name] of ['counter','shelf','chest','barrel'].entries()) {
  const x=Math.round(n%2*source.width/2),y=Math.round(Math.floor(n/2)*source.height/2);
  const cell=crop(source,x,y,Math.round((n%2+1)*source.width/2)-x,Math.round((Math.floor(n/2)+1)*source.height/2)-y);
  const p=geometry[`home.merchant-${name}`];
  // One uniform scale for both axes. Transparent padding absorbs unused space.
  let framed=fit(removeBackdrop(cell),p.columns*16,p.rows*16,1);
  if(name==='counter') {
    const aligned=new PNG({width:framed.width,height:framed.height});
    blit(framed,aligned,0,-12);framed=aligned;
  }
  write(`assets-src/map-tiles/sheets/merchant/${name}.png`,framed);
}
const file='assets-src/map-tiles/palettes.json',palettes=JSON.parse(fs.readFileSync(file,'utf8'));
const page=palettes.pages.find(p=>p.id==='home-furniture'),old=page.cells;
page.cells=[];let top=0;
for(const id of [...new Set(old.map(c=>c.assetId))]) {
  const cells=old.filter(c=>c.assetId===id),p=geometry[id];
  if(p) {
    for(let y=0;y<p.rows;y++)for(let x=0;x<p.columns;x++)page.cells.push({...cells[0],x,y:top+y,frame:y*p.columns+x,walkable:y<p.rows-p.groundRows});
    top+=p.rows+1;
  } else {
    const left=Math.min(...cells.map(c=>c.x)),base=Math.min(...cells.map(c=>c.y));
    page.cells.push(...cells.map(c=>({...c,x:c.x-left,y:c.y-base+top})));
    top+=Math.max(...cells.map(c=>c.y))-base+2;
  }
}
page.height=top;fs.writeFileSync(file,JSON.stringify(palettes,null,2)+'\n');
