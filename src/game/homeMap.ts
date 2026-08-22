import { createDefaultMapPack } from "./defaultMapPack";
import type { MapDocument } from "./mapDocument";

export const HOME_WIDTH = 14;
export const HOME_HEIGHT = 10;
export const HOME_SPAWN = { x: 10, y: 4 } as const;
export const DUNGEON_ENTRANCE = { x: 2, y: 9 } as const;
export const HOME_POI = { storage: {x:2,y:2}, preparation: {x:7,y:2}, visitors: {x:10,y:9} } as const;
export function createHomeMap(): MapDocument {
  return createDefaultMapPack().home;
}
