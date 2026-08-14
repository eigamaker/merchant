import layout from "./craftpixDungeonLayout.json";
import type { DungeonMap } from "./types";

export const CRAFTPIX_DUNGEON_TILE = layout.tile;
export const CRAFTPIX_DUNGEON_WIDTH = layout.width;
export const CRAFTPIX_DUNGEON_HEIGHT = layout.height;
export const CRAFTPIX_DUNGEON_ENTRY = { ...layout.entry };
export const CRAFTPIX_DUNGEON_STAIRS = { ...layout.stairs };

/**
 * The first Craftpix integration is deliberately a fixed showcase map. The
 * collision mask is authored separately from the art so props and water can
 * never accidentally become walkable just because a pixel is transparent.
 */
export function createCraftpixDungeonMap(requiresTomb = false): DungeonMap {
  const tiles = layout.collision.map((row) => Array.from(row, (cell) => cell === "." ? 0 : 1));
  return {
    width: CRAFTPIX_DUNGEON_WIDTH,
    height: CRAFTPIX_DUNGEON_HEIGHT,
    tileSize: CRAFTPIX_DUNGEON_TILE,
    visualTheme: "craftpix-showcase",
    tiles,
    entrance: { ...CRAFTPIX_DUNGEON_ENTRY },
    stairs: { ...CRAFTPIX_DUNGEON_STAIRS },
    returnStairs: { ...CRAFTPIX_DUNGEON_ENTRY },
    specialRoom: requiresTomb ? { x: 25, y: 4 } : undefined,
  };
}

if (layout.collision.length !== CRAFTPIX_DUNGEON_HEIGHT
  || layout.collision.some((row) => row.length !== CRAFTPIX_DUNGEON_WIDTH)) {
  throw new Error("Craftpix dungeon collision dimensions are inconsistent");
}

if (layout.collision[CRAFTPIX_DUNGEON_ENTRY.y]?.[CRAFTPIX_DUNGEON_ENTRY.x] !== "."
  || layout.collision[CRAFTPIX_DUNGEON_STAIRS.y]?.[CRAFTPIX_DUNGEON_STAIRS.x] !== ".") {
  throw new Error("Craftpix dungeon entry and stairs must be walkable");
}
