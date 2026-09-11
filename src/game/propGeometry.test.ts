import { expect, it } from 'vitest';
import { createManualMap } from './mapDocument';
import { applyPropCollision, propFrameGeometry } from './propGeometry';
import { shopDisplaySlots } from './shopDisplay';
it('uses the same floor rule for one-row and two-row ground footprints',()=>{
  expect([0,4,8].map(f=>propFrameGeometry('home.merchant-counter',f)!.walkable)).toEqual([true,false,false]);
  expect([0,3,6].map(f=>propFrameGeometry('home.merchant-shelf',f)!.walkable)).toEqual([true,false,false]);
  expect([0,2].map(f=>propFrameGeometry('home.merchant-table',f)!.walkable)).toEqual([true,false]);
});

it('separates the tabletop, floor footprint and shared sort baseline', () => {
  const map = createManualMap('home', {width:8,height:8,tileSize:16});
  map.layers.ground.fill({assetId:'home.merchant-floor',frame:0});
  for(let y=0;y<2;y++)for(let x=0;x<2;x++)map.layers.decoration[(y+2)*8+x+2]={assetId:'home.merchant-table',frame:y*2+x};
  applyPropCollision(map);
  expect(map.collision[18]).toBe(true);
  expect(map.collision[26]).toBe(false);
  const slot=shopDisplaySlots(map)[0];
  expect(slot.y).toBe(43);
  expect(slot.y).toBeLessThan(48);
  expect(2+propFrameGeometry('home.merchant-table',0)!.depthOffset).toBe(3+propFrameGeometry('home.merchant-table',2)!.depthOffset);
  map.layers.structure[18]={assetId:'home.merchant-wall',frame:0};
  applyPropCollision(map);
  expect(map.collision[18]).toBe(false);
});
