import type { MapDocument } from "./mapDocument";
import type { GameState } from "./types";
import { PROP_GEOMETRY } from './propGeometry';

/** Coordinates are furniture-local pixels on the 16px logical map grid.
 * Each asset declares its usable surface; it is never inferred from tile centre. */
export const SHOP_SURFACES: Record<string, { label: string; slots: readonly { x: number; y: number; width: number; height: number }[] }> = {
  "home.merchant-counter": { label: "カウンター", slots: [{ x: 16, y: 16, width: 22, height: 20 }, { x: 48, y: 16, width: 22, height: 20 }] },
  "home.merchant-shelf": { label: "商品棚", slots: [{ x: 12, y: 42, width: 18, height: 14 }, { x: 36, y: 42, width: 18, height: 14 }] },
  "home.merchant-table": { label: "展示テーブル", slots: [{ x: 16, y: 11, width: 20, height: 20 }] },
  "home.merchant-desk": { label: "展示机", slots: [{ x: 16, y: 6, width: 18, height: 18 }] },
};

export interface ShopDisplaySlot { id: string; label: string; x: number; y: number; width: number; height: number; depth: number; }

export function shopDisplaySlots(map: MapDocument): ShopDisplaySlot[] {
  const scale = map.tileSize / 16;
  const result: ShopDisplaySlot[] = [];
  for (const [layer, cells] of Object.entries(map.layers)) cells.forEach((cell, index) => {
    const surface = cell && cell.frame === 0 ? SHOP_SURFACES[cell.assetId] : undefined;
    if (!surface || !cell) return;
    const x = index % map.width, y = Math.floor(index / map.width);
    const {columns, rows, groundRow} = PROP_GEOMETRY[cell.assetId];
    for (let dy = 0; dy < rows; dy++) for (let dx = 0; dx < columns; dx++) {
      const part = cells[(y + dy) * map.width + x + dx];
      if (x + dx >= map.width || y + dy >= map.height || part?.assetId !== cell.assetId || part.frame !== dy * columns + dx) return;
    }
    surface.slots.forEach((slot, n) => result.push({
      id: `${layer}:${x}:${y}:${cell.assetId}:${n}`,
      label: `${surface.label}・${n + 1}`,
      x: x * map.tileSize + slot.x * scale, y: y * map.tileSize + slot.y * scale,
      width: slot.width * scale, height: slot.height * scale,
      depth: (y + groundRow + .5) * map.tileSize,
    }));
  });
  return result;
}

/** Sales leave an empty position; remaining products do not slide along the shelf. */
export function reconcileShopDisplay(state: Pick<GameState, "display" | "store" | "displayPlacements">, slots: readonly ShopDisplaySlot[]): Record<string, string> {
  const validItems = new Set(state.store.map(item => item.uuid));
  const available = new Set(slots.map(slot => slot.id));
  const assigned: Record<string, string> = {};
  for (const id of state.display) {
    const slot = state.displayPlacements?.[id];
    if (validItems.has(id) && slot && available.delete(slot)) assigned[id] = slot;
  }
  for (const id of state.display) {
    if (!validItems.has(id) || assigned[id]) continue;
    const slot = slots.find(candidate => available.has(candidate.id));
    if (slot) { assigned[id] = slot.id; available.delete(slot.id); }
  }
  state.displayPlacements = assigned;
  return assigned;
}

/** Moving onto an occupied position swaps the two products without changing stock. */
export function moveShopDisplayItem(state: Pick<GameState, "display" | "store" | "displayPlacements">, slots: readonly ShopDisplaySlot[], itemId: string, slotId: string): boolean {
  const placements = reconcileShopDisplay(state, slots);
  const old = placements[itemId];
  if (!old || !slots.some(slot => slot.id === slotId)) return false;
  const occupant = Object.keys(placements).find(id => placements[id] === slotId);
  if (occupant) placements[occupant] = old;
  placements[itemId] = slotId;
  return true;
}

export interface ItemArtBounds { x: number; y: number; width: number; height: number; }
export function displayItemTransform(bounds: ItemArtBounds, slot: ShopDisplaySlot) {
  // Quantized scale preserves the 32px sprite's pixel clusters on the enlarged map.
  // Do not enlarge smaller art back to fill the surface. A 16px map uses half
  // scale, so the 2x home camera presents each source pixel at one screen pixel.
  const fit = Math.min(slot.width / bounds.width, slot.height / bounds.height, .5);
  const scale = fit >= 1 ? 1 : fit >= .5 ? .5 : .25;
  return { x: Math.round(slot.x), y: Math.round(slot.y), scale,
    originX: (bounds.x + bounds.width / 2) / 32, originY: (bounds.y + bounds.height) / 32,
    shadowWidth: Math.max(3, Math.round(bounds.width * scale * .6)), shadowHeight: 2 };
}
