import fs from 'node:fs';
import { PNG } from 'pngjs';
import {read,write,cell,fit,crop,key,resize,blit,pixel,tint} from './unified-art-lib.mjs';
import {blobTileTable,N,NE,E,SE,S,SW,W,NW} from './autotile.mjs';
const terrain=read('assets-src/unified/terrain.png'),props=read('assets-src/unified/props.png');
const dir='assets-src/map-tiles/sheets/unified';
fs.mkdirSync(dir,{recursive:true});
const tile=(n,w=16,h=16)=>{
  const source=cell(terrain,n%4,Math.floor(n/4),4,4,n>=10);
  if(n>=10)return fit(source,w,h,1);
  // Crop texture samples before reduction so a 16px tile retains readable clusters.
  if([0,1,2,3,4,8,9].includes(n)) {
    const size=n===0||n===8?96:160;
    return resize(crop(source,Math.floor((source.width-size)/2),Math.floor((source.height-size)/2),size,size),w,h);
  }
  return resize(source,w,h);
};
const rowEdges=[0,375,655,900,1254];
const prop=(n,w=16,h=16)=>{const r=Math.floor(n/8),x=Math.round(n%8*props.width/8),right=Math.round((n%8+1)*props.width/8);return fit(key(crop(props,x,rowEdges[r],right-x,rowEdges[r+1]-rowEdges[r])),w,h,1);};
const assets=[];
function sheet(id,label,png,layer='ground',walkable=true,autotile) {
  write(`${dir}/${id}.png`,png);
  const config={version:1,id:`unified.${id}`,label,tileSize:16,margin:0,spacing:0,mapKinds:['home','dungeon'],defaultLayer:layer,defaultWalkable:walkable,...(autotile?{autotile}: {})};
  fs.writeFileSync(`${dir}/${id}.tileset.json`,JSON.stringify(config,null,2)+'\n');
  assets.push({...config,width:png.width/16,height:png.height/16});
}
for(const [n,id,label,walkable]of [[0,'grass','街の草地',true],[1,'road','街道',true],[2,'cave-floor','洞窟の床',true],[3,'ruins-floor','遺跡の床',true],[4,'volcanic-floor','冷えた火山岩',true],[8,'roof','赤い屋根',false],[9,'water','深い水',false]])sheet(id,label,tile(n),'ground',walkable);
for(const [n,id,label]of [[5,'cave-wall','洞窟の岩壁'],[6,'ruins-wall','遺跡の石壁'],[7,'town-wall','街の木組み壁']]) {
  const source=tile(n),png=new PNG({width:47*16,height:16});
  blobTileTable().masks.forEach((mask,f)=>{
    const frame=crop(source,0,0,16,16);
    for(let y=0;y<16;y++)for(let x=0;x<16;x++) {
      const edge=(!(mask&N)&&y<2)||(!(mask&S)&&y>13)||(!(mask&W)&&x<2)||(!(mask&E)&&x>13);
      if(edge)pixel(frame,x,y,y<2?[182,148,97]:[48,39,37]);
      const innerCorner=(x>13&&y<2&&(mask&(N|E))===(N|E)&&!(mask&NE))
        ||(x>13&&y>13&&(mask&(S|E))===(S|E)&&!(mask&SE))
        ||(x<2&&y>13&&(mask&(S|W))===(S|W)&&!(mask&SW))
        ||(x<2&&y<2&&(mask&(N|W))===(N|W)&&!(mask&NW));
      if(innerCorner)pixel(frame,x,y,[48,39,37]);
    }
    blit(frame,png,f*16,0);
  });
  sheet(id,label,png,'structure',false,{scheme:'blob47',animationFrames:1});
}
sheet('building-wall','建物の正面壁（2×2）',tile(7,32,32),'structure',false);
sheet('tree','街路樹',tile(12,32,48),'decoration',false);
sheet('boulder','岩',tile(13,32,32),'decoration',false);
sheet('door','開いた建物のドア',tile(14,32,32),'decoration',true);
sheet('window','建物の窓',tile(15),'decoration',false);
const stairs=new PNG({width:128,height:48});
blit(resize(tile(10,32,32),16,32),stairs,96,0);blit(resize(tile(10,32,32),16,32),stairs,112,0);
blit(tile(11),stairs,96,32);blit(tile(11),stairs,112,32);
sheet('stairs','石の階段（上りは2タイル）',stairs,'decoration',true);
const faces=new PNG({width:128,height:32});for(let x=0;x<8;x++){blit(tile(6),faces,x*16,0);blit(tile(6),faces,x*16,16);}sheet('wall-faces','二段の壁面',faces,'structure',false);
for(const [n,id,label,walkable]of [[22,'chest','宝箱',true],[24,'rubble','小さな瓦礫',true],[26,'pot','壺',false],[27,'torch','壁の松明',false],[28,'spikes','棘（通行不可の装飾）',false],[29,'lever','壁のレバー',false],[30,'coins','散らばった硬貨',true],[31,'spell','魔法の光',true]])sheet(id,label,prop(n),'decoration',walkable);
const bones=new PNG({width:48,height:16});
for(let variant=0;variant<3;variant++)blit(tint(prop(25),variant),bones,variant*16,0);
sheet('bones','骨の山（洞窟・遺跡・火山）',bones,'decoration',true);

// Retained fallback IDs are regenerated from the same art, never old packs.
for(const [name,source]of [['home-floor',read('assets-src/map-tiles/sheets/merchant/floor.png')],['dungeon-floor',tile(2)]]) {
  write(`assets-src/map-tiles/sheets/${name}.png`,source);write(`public/assets/map-tiles/${name}.png`,source);
}
for(const [name,source]of [['home-wall',tile(7)],['dungeon-wall',tile(5)]]) {
  const png=new PNG({width:64,height:64});for(let y=0;y<4;y++)for(let x=0;x<4;x++)blit(source,png,x*16,y*16);
  write(`assets-src/map-tiles/sheets/${name}.png`,png);write(`public/assets/map-tiles/${name}.png`,png);
}
write('assets-src/map-tiles/sheets/dungeon-stairs-up.png',tile(10));write('assets-src/map-tiles/sheets/dungeon-stairs-down.png',tile(11));
const objects=new PNG({width:192,height:96});
for(let n=0;n<32;n++)blit(prop([22,24,25,27,24,25,28,29][n%8],24,24),objects,n%8*24,Math.floor(n/8)*24);
blit(tile(11,24,24),objects,24,0);blit(tile(10,24,24),objects,48,0);
write('public/assets/objects/dungeon_objects.png',objects);
const palettes=JSON.parse(fs.readFileSync('assets-src/map-tiles/palettes.json','utf8'));
// Save compatibility for previously authored 32px maps, with their collision unchanged.
for(const [name,source,layer,walkable]of [['floor',tile(2),'ground',true],['wall',tile(5),'structure',false],['prop',prop(24),'decoration',true]]) {
  const id=`unified.compat-${name}32`;
  write(`${dir}/${id}.png`,resize(source,32,32));
  fs.writeFileSync(`${dir}/${id}.tileset.json`,JSON.stringify({version:1,id,label:`旧32pxマップ用・${name}`,tileSize:32,margin:0,spacing:0,mapKinds:['home','dungeon'],defaultLayer:layer,defaultWalkable:walkable},null,2)+'\n');
}
const legacyStairs=new PNG({width:64,height:32});
blit(tile(10,32,32),legacyStairs,0,0);blit(tile(11,32,32),legacyStairs,32,0);
write(`${dir}/compat-stairs32.png`,legacyStairs);
fs.writeFileSync(`${dir}/compat-stairs32.tileset.json`,JSON.stringify({version:1,id:'unified.compat-stairs32',label:'旧32pxマップ用・階段',tileSize:32,margin:0,spacing:0,mapKinds:['home','dungeon'],defaultLayer:'decoration',defaultWalkable:true},null,2)+'\n');
palettes.pages=palettes.pages.filter(p=>!p.id.startsWith('unified-'));
for(const mapKind of ['home','dungeon'])for(const [pageId,label,filter]of [['unified-terrain','統一・街とダンジョン',a=>a.defaultLayer==='ground'||a.defaultLayer==='structure'],['unified-props','統一・建物と装飾',a=>a.defaultLayer==='decoration']]) {
  const page={id:mapKind==='home'?pageId:pageId.replace('unified-','unified-dungeon-'),label,mapKind,tileSize:16,width:52,height:40,cells:[]};let py=0;
  for(const a of assets.filter(filter)){for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)page.cells.push({x,y:py+y,assetId:a.id,frame:y*a.width+x,layer:a.defaultLayer,walkable:a.defaultWalkable,role:a.defaultLayer==='ground'?'floor':a.defaultLayer==='structure'?'wall':'prop',status:'ready',note:a.label});py+=a.height+1;}
  page.height=Math.max(4,py);palettes.pages.push(page);
}
fs.writeFileSync('assets-src/map-tiles/palettes.json',JSON.stringify(palettes,null,2)+'\n');
console.log(`Built ${assets.length} unified map sheets, prop sheets and item icons.`);
