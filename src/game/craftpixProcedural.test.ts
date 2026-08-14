import { describe, expect, it } from "vitest";
import { createCraftpixProceduralDungeon, createCraftpixProceduralDungeonWithBlueprint } from "./craftpixProcedural";
import { canTraverse, reachableCells } from "./dungeonRules";

describe("Craftpix port-based procedural dungeon", () => {
  it("is deterministic, flat, and keeps mandatory destinations reachable", () => {
    for (let seed = 1; seed <= 80; seed += 1) {
      const floor = (seed % 8) + 1;
      const requiresTomb = seed % 3 === 0;
      const map = createCraftpixProceduralDungeon(seed, floor, requiresTomb);
      const duplicate = createCraftpixProceduralDungeon(seed, floor, requiresTomb);
      const reached = reachableCells(map, map.entrance);
      expect(map.width).toBe(48);
      expect(map.height).toBe(36);
      expect(map.tileSize).toBe(16);
      expect(map.visualTheme).toBe("craftpix-procedural");
      expect(map.generation?.algorithm).toBe("craftpix-ports-v2");
      expect(map.tiles.flat().filter((cell) => cell === 0).length).toBeGreaterThan(360);
      expect(reached.has(`${map.stairs.x},${map.stairs.y}`)).toBe(true);
      expect(map.traversalLinks).toEqual([]);
      expect(map.ledgeEdges).toEqual([]);
      expect(map.heights?.flat().every((height) => height === 0)).toBe(true);
      if (map.specialRoom) expect(reached.has(`${map.specialRoom.x},${map.specialRoom.y}`)).toBe(true);
      expect(map).toEqual(duplicate);
    }
  }, 20000);

  it("uses every room port exactly once and exposes an inspectable blueprint", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const result = createCraftpixProceduralDungeonWithBlueprint(seed, 2, seed % 2 === 0);
      expect(result.blueprint.rooms).toHaveLength(8);
      expect(result.blueprint.connections).toHaveLength(7);
      expect(result.blueprint.rooms.every((room) => room.degree >= 1 && room.degree <= 4)).toBe(true);
      expect(result.blueprint.connections.every((connection) => connection.path.length > 0)).toBe(true);
      for (const connection of result.blueprint.connections) {
        const from = result.blueprint.rooms.find((room) => room.id === connection.fromRoomId);
        const to = result.blueprint.rooms.find((room) => room.id === connection.toRoomId);
        expect(from).toBeDefined();
        expect(to).toBeDefined();
        expect(connection.fromPortId).toBeTruthy();
        expect(connection.toPortId).toBeTruthy();
      }
      expect(canTraverse(result.map, result.map.entrance, { x: result.map.entrance.x + 1, y: result.map.entrance.y })
        || canTraverse(result.map, result.map.entrance, { x: result.map.entrance.x - 1, y: result.map.entrance.y })
        || canTraverse(result.map, result.map.entrance, { x: result.map.entrance.x, y: result.map.entrance.y + 1 })
        || canTraverse(result.map, result.map.entrance, { x: result.map.entrance.x, y: result.map.entrance.y - 1 })).toBe(true);
    }
  }, 20000);
});
