import type { MapDocument } from './mapDocument';
import geometry from '../../assets-src/shop/furniture-geometry.json';

/** Sprite rows above groundRow are height, not occupied floor. Beds retain
 * their two-row floor footprint; walls without an explicit profile stay solid. */
export const PROP_GEOMETRY: Record<string, {columns: number; rows: number; groundRows: number; groundRow: number}> = Object.fromEntries(Object.entries(geometry).map(([id,p])=>[id,{...p,groundRow:p.rows-p.groundRows}]));
export function propFrameGeometry(assetId: string, frame: number) {
  const p = PROP_GEOMETRY[assetId];
  if (!p || frame < 0 || frame >= p.columns * p.rows) return undefined;
  const row = Math.floor(frame / p.columns);
  return { ...p, row, walkable: row < p.groundRow, depthOffset: p.groundRow - row + .5 };
}
export function applyPropCollision(map: Pick<MapDocument, 'layers' | 'collision'>): void {
  map.layers.decoration.forEach((cell, i) => {
    const p = cell && propFrameGeometry(cell.assetId, cell.frame);
    if (!p) return;
    // An overhead prop never opens a wall beneath it.
    const structure = map.layers.structure[i];
    const floor = map.layers.ground[i];
    const supportingFloor = !!floor && !/wall/.test(floor.assetId);
    map.collision[i] = p.walkable && supportingFloor && (!structure || /rug|floor/.test(structure.assetId));
  });
}
