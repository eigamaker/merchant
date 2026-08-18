import type { MapDocument, MapMarker } from "./mapDocument";

export const HOME_WIDTH = 32;
export const HOME_HEIGHT = 20;
export const HOME_SPAWN = { x: 16, y: 16 } as const;
export const DUNGEON_ENTRANCE = { x: 16, y: 2 } as const;
export const HOME_POI = { storage: {x:7,y:8}, preparation: {x:16,y:8}, visitors: {x:24,y:8} } as const;
export function createHomeMap(): MapDocument {
  const terrain: Array<string | null> = [];
  for (let y=0;y<HOME_HEIGHT;y++) for (let x=0;x<HOME_WIDTH;x++) terrain.push(x===0||y===0||x===HOME_WIDTH-1||y===HOME_HEIGHT-1 ? "home.wall" : "home.floor");
  const markers: MapMarker[] = [
    {id:"home-spawn",kind:"homeSpawn",...HOME_SPAWN},
    {id:"dungeon-entrance",kind:"dungeonEntrance",...DUNGEON_ENTRANCE},
    {id:"home-storage",kind:"homeStorage",...HOME_POI.storage},
    {id:"home-preparation",kind:"homePreparation",...HOME_POI.preparation},
    {id:"home-visitors",kind:"homeVisitors",...HOME_POI.visitors},
  ];
  const now = new Date().toISOString();
  const collision = terrain.map((id) => id === "home.floor");
  const ground = terrain.map((id) => id === "home.floor" ? { assetId: id, frame: 0 } : null);
  const structure = terrain.map((id) => id === "home.wall" ? { assetId: id, frame: 0 } : null);
  return {version:5,id:"home",name:"自宅兼店舗",kind:"home",floor:0,width:HOME_WIDTH,height:HOME_HEIGHT,tileSize:16,terrain,collision,layers:{ground,structure,decoration:Array(terrain.length).fill(null)},markers,createdAt:now,updatedAt:now};
}
