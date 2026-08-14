import type { DungeonRenderLayer, RenderPlacement } from "./types";
import { CRAFTPIX_ENVIRONMENT_SHEETS } from "./craftpixEnvironment";

/**
 * Curated references into Craftpix's 16px source sheets.  The ids are stable
 * gameplay-independent names used by maps and the review tool.  Keeping this
 * catalog explicit prevents file names or transparent pixels from becoming
 * collision rules.
 */
export interface CraftpixAssetRef {
  textureKey: string;
  frame: number;
  layer: DungeonRenderLayer;
}

const LEGACY_CRAFTPIX_SHEETS = {
  "cracks-wall": { textureKey: "dungeon.craftpix.cracks-wall", path: "assets/dungeons/craftpix/decorative_cracks_walls.png", columns: 8, frames: 256, label: "壁のひび" },
  "cracks-floor": { textureKey: "dungeon.craftpix.cracks", path: "assets/dungeons/craftpix/decorative_cracks_floor.png", columns: 8, frames: 120, label: "床のひび" },
  "walls-floor": { textureKey: "dungeon.craftpix.walls-floor", path: "assets/dungeons/craftpix/walls_floor.png", columns: 17, frames: 493, label: "床・壁" },
  "water-coasts": { textureKey: "dungeon.craftpix.water-coasts", path: "assets/dungeons/craftpix/Water_coasts_animation.png", columns: 29, frames: 928, label: "水面・岸" },
  "water-details": { textureKey: "dungeon.craftpix.water-details", path: "assets/dungeons/craftpix/water_details_animation.png", columns: 37, frames: 2886, label: "水面の詳細" },
  "cracks-coasts": { textureKey: "dungeon.craftpix.cracks-coasts", path: "assets/dungeons/craftpix/decorative_cracks_coasts_animation.png", columns: 19, frames: 475, label: "岸のひび" },
  fire: { textureKey: "dungeon.craftpix.fire", path: "assets/dungeons/craftpix/fire_animation.png", columns: 11, frames: 198, label: "炎" },
  "fire-alt": { textureKey: "dungeon.craftpix.fire-alt", path: "assets/dungeons/craftpix/fire_animation2.png", columns: 6, frames: 72, label: "炎（小）" },
  doors: { textureKey: "dungeon.craftpix.doors", path: "assets/dungeons/craftpix/doors_lever_chest_animation.png", columns: 10, frames: 150, label: "扉・宝箱（新規配置不可）" },
  objects: { textureKey: "dungeon.craftpix.objects", path: "assets/dungeons/craftpix/Objects.png", columns: 24, frames: 216, label: "オブジェクト" },
  traps: { textureKey: "dungeon.craftpix.traps", path: "assets/dungeons/craftpix/trap_animation.png", columns: 13, frames: 403, label: "罠" },
} as const;

export const CRAFTPIX_SHEETS = { ...LEGACY_CRAFTPIX_SHEETS, ...CRAFTPIX_ENVIRONMENT_SHEETS } as const;

export type CraftpixSheetId = keyof typeof CRAFTPIX_SHEETS;

export interface CraftpixTileRef {
  sheet: CraftpixSheetId;
  frame: number;
}

const wallsFloor = (frame: number, layer: DungeonRenderLayer): CraftpixAssetRef => ({
  textureKey: "dungeon.craftpix.walls-floor",
  frame,
  layer,
});

/**
 * Frames are taken from the authored Dungeon1 TMX usage, not inferred from
 * image pixels.  Unsupported wall shapes are intentionally absent.
 */
export const CRAFTPIX_TILE_CATALOG: Record<string, CraftpixAssetRef> = {
  floor: wallsFloor(138, "ground"),
  "floor-alt": wallsFloor(139, "ground"),
  "wall-center": wallsFloor(36, "structure"),
  "wall-north": wallsFloor(19, "structure"),
  "wall-east": wallsFloor(26, "structure"),
  "wall-south": wallsFloor(53, "structure"),
  "wall-west": wallsFloor(70, "structure"),
  "wall-corner": wallsFloor(64, "structure"),
  "wall-inner": wallsFloor(87, "structure"),
  "stairs-up": wallsFloor(324, "structure"),
  "stairs-down": wallsFloor(326, "structure"),
  torch: { textureKey: "dungeon.craftpix.objects", frame: 174, layer: "decoration" },
  tomb: { textureKey: "dungeon.craftpix.objects", frame: 198, layer: "decoration" },
  chest: { textureKey: "dungeon.craftpix.doors", frame: 18, layer: "decoration" },
  crack: { textureKey: "dungeon.craftpix.cracks", frame: 0, layer: "decoration" },
  "overhead-wall": wallsFloor(36, "overhead"),
};

export function craftpixSheet(sheet: CraftpixSheetId): (typeof CRAFTPIX_SHEETS)[CraftpixSheetId] {
  return CRAFTPIX_SHEETS[sheet];
}

export function manualCraftpixAssetId(tile: CraftpixTileRef): string {
  return `manual:${tile.sheet}:${tile.frame}`;
}

function manualCraftpixAsset(assetId: string): CraftpixAssetRef | undefined {
  const match = /^manual:([a-z-]+):(\d+)$/.exec(assetId);
  if (!match) return undefined;
  const sheet = match[1] as CraftpixSheetId;
  const frame = Number.parseInt(match[2] ?? "", 10);
  const source = CRAFTPIX_SHEETS[sheet];
  if (!source || !Number.isInteger(frame) || frame < 0 || frame >= source.frames) return undefined;
  return { textureKey: source.textureKey, frame, layer: "ground" };
}

export function craftpixAsset(assetId: string): CraftpixAssetRef | undefined {
  return CRAFTPIX_TILE_CATALOG[assetId] ?? manualCraftpixAsset(assetId);
}

export function placement(assetId: string, x: number, y: number, layer?: DungeonRenderLayer): RenderPlacement {
  const asset = craftpixAsset(assetId);
  if (!asset) throw new Error(`Unknown Craftpix asset id: ${assetId}`);
  return { assetId, x, y, layer: layer ?? asset.layer };
}
