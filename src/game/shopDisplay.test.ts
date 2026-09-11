import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { createHomeMap } from './homeMap';
import { createItem, createNewGame } from './engine';
import { ITEM_ART } from './itemArtCatalog.generated';
import { MERCHANT_ITEM_DEFINITIONS } from './merchantContent';
import { migrateSaveState } from './save';
import { shopDisplaySlots, reconcileShopDisplay, moveShopDisplayItem, displayItemTransform } from './shopDisplay';

describe('independent shop display', () => {
  it('offers eight complete furniture positions and rejects broken furniture', () => {
    const map = createHomeMap();
    expect(shopDisplaySlots(map)).toHaveLength(8);
    const cells = map.layers.decoration;
    const i = cells.findIndex(c => c?.assetId === 'home.merchant-counter' && c.frame === 0);
    cells[i + 1] = null;
    expect(shopDisplaySlots(map)).toHaveLength(6);
  });
  it('keeps unsold items in place, swaps positions and survives a save round trip', () => {
    const state = createNewGame(), slots = shopDisplaySlots(createHomeMap());
    const a = createItem(state, 'herb'), b = createItem(state, 'iron-helmet');
    state.store = [a, b]; state.display = [a.uuid, b.uuid];
    reconcileShopDisplay(state, slots);
    expect(moveShopDisplayItem(state, slots, a.uuid, slots[1].id)).toBe(true);
    expect(state.displayPlacements?.[b.uuid]).toBe(slots[0].id);
    state.display = [b.uuid]; state.store = [b];
    const restored = migrateSaveState(JSON.parse(JSON.stringify(state)));
    expect(reconcileShopDisplay(restored, slots)).toEqual({ [b.uuid]: slots[0].id });
    expect(moveShopDisplayItem(restored, slots, b.uuid, 'missing')).toBe(false);
  });
  it('anchors the visible item centre and bottom to the surface', () => {
    const slot = shopDisplaySlots(createHomeMap())[0];
    const box = {x: 3, y: 7, width: 18, height: 22};
    const p = displayItemTransform(box, slot);
    expect(p.x + (box.x + box.width / 2 - p.originX * 32) * p.scale).toBe(slot.x);
    expect(p.y + (box.y + box.height - p.originY * 32) * p.scale).toBe(slot.y);
    expect(box.height * p.scale).toBeLessThanOrEqual(slot.height);
  });
  it('has a distinct transparent 32px image for every item definition', () => {
    expect(Object.keys(ITEM_ART).sort()).toEqual(Object.keys(MERCHANT_ITEM_DEFINITIONS).sort());
    const hashes = new Set<string>();
    for (const id of Object.keys(ITEM_ART)) {
      const png = PNG.sync.read(fs.readFileSync(`public/assets/items/${id}.png`));
      expect([png.width, png.height]).toEqual([32, 32]);
      expect(Math.max(ITEM_ART[id].bounds.width, ITEM_ART[id].bounds.height)).toBeLessThanOrEqual(18);
      expect(png.data[3]).toBe(0);
      hashes.add(createHash('sha256').update(png.data).digest('hex'));
    }
    expect(hashes.size).toBe(30);
    const herb = PNG.sync.read(fs.readFileSync('public/assets/items/herb.png'));
    let green = 0;
    for (let i = 0; i < herb.data.length; i += 4) if (herb.data[i + 3] && herb.data[i + 1] > herb.data[i] * 1.2) green++;
    expect(green).toBeGreaterThan(20);
  });
});
