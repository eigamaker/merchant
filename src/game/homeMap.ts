import { createDefaultMapPack } from "./defaultMapPack";
import type { MapDocument } from "./mapDocument";

export const HOME_WIDTH = 28;
export const HOME_HEIGHT = 20;
export const HOME_SPAWN = { x: 10, y: 4 } as const;
export const DUNGEON_ENTRANCE = { x: 25, y: 17 } as const;
export const HOME_POI = { preparation: {x:6,y:3}, visitors: {x:10,y:9} } as const;
export function createHomeMap(): MapDocument {
  return createDefaultMapPack().home;
}
