import fs from "node:fs";
import { PNG } from "pngjs";

const outputDir = "assets-src/map-tiles/sheets/merchant";
fs.mkdirSync(outputDir, { recursive: true });
const atlas = PNG.sync.read(fs.readFileSync("assets-src/home-interior/merchant-furniture-original.png"));
const room = PNG.sync.read(fs.readFileSync("assets-src/home-interior/merchant-room-original.png"));
const definitions = [
  ["shelf", "商品棚", [48,82,294,310], 3,2, 0,0],
  ["bed", "ベッド", [426,58,194,336], 2,3, 4,0],
  ["chest", "宝箱", [718,160,169,161], 2,1, 7,0],
  ["table", "テーブル", [982,115,221,226], 2,2, 10,0],
  ["rug", "カーペット", [48,510,289,225], 4,3, 0,4],
  ["counter", "店のカウンター", [375,538,415,187], 4,2, 5,4],
  ["barrel", "樽", [834,514,136,200], 1,2, 10,4],
  ["crate", "木箱", [1030,530,162,198], 1,1, 12,4],
  ["door", "開いたドア", [60,843,265,244], 2,2, 0,8],
  ["stool", "スツール", [429,921,92,116], 1,1, 3,8],
  ["desk", "探索準備の机", [635,865,280,214], 2,1, 5,8],
  ["lantern", "壁のランタン", [1054,870,104,196], 1,1, 8,8],
];

// Remove the generated opaque checker preview only where neutral light pixels
// connect to the crop border. Enclosed highlights remain part of the furniture.
function cutout(rect) {
  const [left, top, width, height] = rect;
  const png = new PNG({ width, height });
  PNG.bitblt(atlas, png, left, top, width, height, 0, 0);
  const seen = new Uint8Array(width * height), queue = [];
  const visit = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (seen[i]) return;
    seen[i] = 1;
    const [r,g,b] = png.data.subarray(i * 4, i * 4 + 3);
    if (Math.min(r,g,b) < 205 || Math.max(r,g,b) - Math.min(r,g,b) > 18) return;
    png.data[i * 4 + 3] = 0;
    queue.push([x,y]);
  };
  for (let x=0;x<width;x++) { visit(x,0); visit(x,height-1); }
  for (let y=0;y<height;y++) { visit(0,y); visit(width-1,y); }
  for (let i=0;i<queue.length;i++) {
    const [x,y] = queue[i];
    visit(x-1,y); visit(x+1,y); visit(x,y-1); visit(x,y+1);
  }
  // Checker islands between chair legs / door posts are enclosed by the object.
  // Their neutral light palette is distinct from the warm cream highlights.
  for (let i=0;i<width*height;i++) {
    const [r,g,b] = png.data.subarray(i*4,i*4+3);
    if (Math.min(r,g,b)>=185 && Math.max(r,g,b)-Math.min(r,g,b)<=26) png.data[i*4+3]=0;
  }
  return png;
}
function resize(source, width, height) {
  const target = new PNG({ width, height });
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const from = (Math.floor((y+.5)*source.height/height)*source.width+Math.floor((x+.5)*source.width/width))*4;
    source.data.copy(target.data,(y*width+x)*4,from,from+4);
  }
  return target;
}
function writeAsset(name, label, png, layer, walkable) {
  const id = `home.merchant-${name}`;
  fs.writeFileSync(`${outputDir}/${name}.png`, PNG.sync.write(png));
  fs.writeFileSync(`${outputDir}/${name}.tileset.json`, JSON.stringify({version:1,id,label,tileSize:16,margin:0,spacing:0,mapKinds:["home"],defaultLayer:layer,defaultWalkable:walkable},null,2)+"\n");
  return id;
}
const furniture = { id:"home-furniture", label:"家・家具（範囲選択で一括配置）", mapKind:"home", tileSize:16, width:16, height:11, cells:[] };
for (const [name,label,rect,w,h,px,py] of definitions) {
  const walkable = ["rug","door"].includes(name);
  const layer = name === "rug" ? "structure" : "decoration";
  const id = writeAsset(name,label,resize(cutout(rect),w*16,h*16),layer,walkable);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) furniture.cells.push({x:px+x,y:py+y,assetId:id,frame:y*w+x,layer,walkable,role:"prop",status:"ready",note:`${label} ${w}×${h}タイル`});
}
// Independent clean architecture samples, without baked furniture.
function sample(rect) {
  const [x,y,w,h] = rect, png = new PNG({width:w,height:h});
  PNG.bitblt(room,png,x,y,w,h,0,0);
  return resize(png,16,16);
}
writeAsset("floor","木の床",sample([448,352,92,66]),"ground",true);
const wall = new PNG({width:64,height:16});
for (const [i,rect] of [[190,128,140,70],[440,30,80,35],[32,336,75,85],[461,920,88,87]].entries()) PNG.bitblt(sample(rect),wall,0,0,16,16,i*16,0);
writeAsset("wall","木梁と漆喰の壁",wall,"structure",false);
const palettePath = "assets-src/map-tiles/palettes.json";
const palettes = JSON.parse(fs.readFileSync(palettePath,"utf8"));
const architecture = palettes.pages.find(p=>p.id === "home-default");
architecture.width=6; architecture.height=2;
architecture.cells=[{x:0,y:0,assetId:"home.merchant-floor",frame:0,layer:"ground",walkable:true,role:"floor",status:"ready"}, ...[0,1,2,3].map(frame=>({x:frame+1,y:0,assetId:"home.merchant-wall",frame,layer:"structure",walkable:false,role:"wall",status:"ready"}))];
palettes.pages = palettes.pages.filter(p=>p.id!==furniture.id);
palettes.pages.push(furniture);
fs.writeFileSync(palettePath,JSON.stringify(palettes,null,2)+"\n");
console.log(`Built ${definitions.length} independent furniture sheets and reusable floor/wall tiles.`);
