import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
export const read = file => PNG.sync.read(fs.readFileSync(file));
export function write(file,png) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const data=PNG.sync.write(png);
  if(fs.existsSync(file)&&fs.readFileSync(file).equals(data))return;
  for(let attempt=0;;attempt++) {
    try {fs.writeFileSync(file,data);return;}
    catch(error) {
      if(attempt>=5||!['EBUSY','EPERM','UNKNOWN'].includes(error.code))throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100*(attempt+1));
    }
  }
}
export function crop(png,x,y,w,h) { const out=new PNG({width:w,height:h}); PNG.bitblt(png,out,x,y,w,h,0,0); return out; }
export function key(png) {
  for(let i=0;i<png.data.length;i+=4) {
    const [r,g,b]=png.data.subarray(i,i+3);
    if(r>130 && b>65 && r>g*1.5 && b>g*1.4) png.data[i+3]=0;
  }
  return png;
}
export function cell(png,col,row,cols,rows,transparent=true) {
  const x=Math.round(col*png.width/cols),y=Math.round(row*png.height/rows);
  const out=crop(png,x,y,Math.round((col+1)*png.width/cols)-x,Math.round((row+1)*png.height/rows)-y);
  return transparent?key(out):out;
}
export function resize(png,w,h) {
  const out=new PNG({width:w,height:h});
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const i=(Math.min(png.height-1,Math.floor((y+.5)*png.height/h))*png.width+Math.min(png.width-1,Math.floor((x+.5)*png.width/w)))*4;
    png.data.copy(out.data,(y*w+x)*4,i,i+4);
  }
  return out;
}
export function bounds(png) {
  let l=png.width,t=png.height,r=0,b=0;
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++)if(png.data[(y*png.width+x)*4+3]>128){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
  return r>=l&&b>=t?{x:l,y:t,w:r-l+1,h:b-t+1}:null;
}
export function fit(png,w,h,pad=2) {
  const box=bounds(png),out=new PNG({width:w,height:h}); if(!box)return out;
  const s=Math.min((w-pad*2)/box.w,(h-pad*2)/box.h),pw=Math.max(1,Math.round(box.w*s)),ph=Math.max(1,Math.round(box.h*s));
  const small=resize(crop(png,box.x,box.y,box.w,box.h),pw,ph);
  blit(small,out,Math.floor((w-pw)/2),h-pad-ph);return out;
}
export function blit(src,out,ox,oy) {
  for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){
    const dx=x+ox,dy=y+oy;if(dx<0||dy<0||dx>=out.width||dy>=out.height)continue;
    const i=(y*src.width+x)*4;if(src.data[i+3])src.data.copy(out.data,(dy*out.width+dx)*4,i,i+4);
  }
}
export function mirror(src) { const out=new PNG({width:src.width,height:src.height});for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){const i=(y*src.width+x)*4;src.data.copy(out.data,(y*src.width+src.width-1-x)*4,i,i+4);}return out; }
export function tint(src,variant=0) {
  const out=crop(src,0,0,src.width,src.height); if(!variant)return out;
  for(let i=0;i<out.data.length;i+=4)if(out.data[i+3]){
    const [r,g,b]=out.data.subarray(i,i+3);
    // A restrained variant ramp, preserving dark outlines and cream highlights.
    if(Math.max(r,g,b)-Math.min(r,g,b)>25 && Math.max(r,g,b)<220){out.data[i]=Math.min(255,r+(variant===1?22:0));out.data[i+1]=Math.max(0,g-(variant===1?8:16));out.data[i+2]=Math.min(255,b+(variant===2?28:0));}
  }return out;
}
export function pixel(out,x,y,color) {x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=out.width||y>=out.height)return;out.data.set([...color,255],(y*out.width+x)*4);}
