import {crop,bounds,resize,blit} from './unified-art-lib.mjs';
import {PNG} from 'pngjs';

// Shared warm ramps: brown outlines, cream light, muted cloth/leaf/gem colors.
// No dithering: each pixel remains one flat palette color.
export const SHOP_ITEM_PALETTE = ['29251f','494235','716856','a49b80','e4d4aa','65422c','986139','bd884c','d4ad61','563c38','914637','bb6450','394a2a','60753b','95a856','294744','426b65','6a9990','a6c3b3','354452','506d87','83a0b1','443950','6a5279','987b9c'].map(hex=>[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)));
export function shopPalette(png) {
  for(let i=0;i<png.data.length;i+=4) if(png.data[i+3]) {
    const rgb=[png.data[i],png.data[i+1],png.data[i+2]];
    const nearest=SHOP_ITEM_PALETTE.reduce((best,c)=>{
      const distance=c.reduce((s,v,j)=>s+(v-rgb[j])**2,0);
      return distance<best.distance?{color:c,distance}:best;
    },{color:SHOP_ITEM_PALETTE[0],distance:Infinity}).color;
    png.data.set([...nearest,255],i);
  }
  return png;
}

/** Remove only neutral backdrop pixels connected to the outside or a reviewed
 * enclosed hole. White item highlights stay inside their dark outlines. */
export function removeBackdrop(png,seeds=[]) {
  const w=png.width,h=png.height,seen=new Uint8Array(w*h),queue=[];
  const add=(x,y)=>{if(x<0||y<0||x>=w||y>=h)return;const n=y*w+x,i=n*4;if(seen[n])return;seen[n]=1;
    const [r,g,b,a]=png.data.subarray(i,i+4);
    if(a===0||(Math.min(r,g,b)>=224&&Math.max(r,g,b)-Math.min(r,g,b)<=12)){png.data[i+3]=0;queue.push(n);}
  };
  for(let x=0;x<w;x++){add(x,0);add(x,h-1);}for(let y=0;y<h;y++){add(0,y);add(w-1,y);}
  for(const [x,y]of seeds)add(x,y);
  for(let p=0;p<queue.length;p++){const n=queue[p],x=n%w,y=Math.floor(n/w);add(x-1,y);add(x+1,y);add(x,y-1);add(x,y+1);}
  return png;
}

export function registeredFrame(source,scale,baseline=29) {
  const box=bounds(source),out=new PNG({width:32,height:32});if(!box)return out;
  const sprite=resize(crop(source,box.x,box.y,box.w,box.h),Math.max(1,Math.round(box.w*scale)),Math.max(1,Math.round(box.h*scale)));
  blit(sprite,out,Math.round(16-sprite.width/2),baseline-sprite.height);return out;
}
