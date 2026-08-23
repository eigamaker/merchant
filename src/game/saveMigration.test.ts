import { describe, expect, it } from "vitest";
import { beginExpedition, createNewGame } from "./engine";
import { migrateSaveState, normalizeHomePositionForMap } from "./save";
import { addMarker, createManualMap } from "./mapDocument";
import { HOME_SPAWN } from "./homeMap";
describe("save migration", () => {
  it.each([1,2,3])("migrates v%d town/interior saves to home", (version) => {
    const state:any = createNewGame(); state.version=version; state.location=version===2?"interior":"town"; state.townPos={x:4,y:4}; delete state.homePos; delete state.homeMapRevision;
    const migrated=migrateSaveState(state);
    expect(migrated.version).toBe(7); expect(migrated.location).toBe("home"); expect(migrated.homePos).toEqual({x:HOME_SPAWN.x*16+8,y:HOME_SPAWN.y*16+8});
  });
  it("migrates legacy dungeon connector fields and adds the floor snapshot dictionary", () => {
    const state:any = createNewGame(); beginExpedition(state);
    state.run.map = { ...state.run.map, entrance: { x: 2, y: 2 }, stairs: { x: 3, y: 3 }, returnStairs: { x: 2, y: 2 } }; delete state.run.map.stairsUp; delete state.run.map.stairsDown; delete state.run.floorStates;
    const migrated = migrateSaveState(state);
    expect(migrated.run?.map.stairsUp).toEqual({x:2,y:2});
    expect(migrated.run?.map.stairsDown).toEqual({x:3,y:3});
    expect(migrated.run?.floorStates).toEqual({});
  });
  it("migrates separated guards into the merchant party cell", () => {
    const state:any = createNewGame();
    state.version = 6;
    beginExpedition(state);
    state.run.player = { x: 5, y: 5 };
    state.run.guard = { guardId: "rolf", pos: { x: 9, y: 9 }, hp: 4, maxHp: 8, damage: 2 };
    state.run.floorStates = {
      "1": { floor: 1, map: structuredClone(state.run.map), player: { x: 3, y: 4 }, enemies: [], items: [], chests: [], traps: [], bodies: [], guard: { guardId: "rolf", pos: { x: 2, y: 2 }, hp: 4, maxHp: 8, damage: 2 }, shoveCooldown: 0, turn: 0 },
    };

    const migrated = migrateSaveState(state);

    expect(migrated.run?.guard).toMatchObject({ pos: { x: 5, y: 5 }, mode: "covering", safeTurns: 0 });
    expect(migrated.run?.floorStates["1"]?.guard).toMatchObject({ pos: { x: 3, y: 4 }, mode: "covering", safeTurns: 0 });
  });
  it("adds the expanded ranked adventurer roster to an existing campaign", () => {
    const state: any = createNewGame();
    const legacyIds = new Set(["rolf", "mina", "bastian", "mira", "godwin", "neva", "roden", "rina"]);
    state.npcs = state.npcs.filter((npc: { id: string }) => legacyIds.has(npc.id));
    for (const npc of state.npcs) delete npc.rank;
    state.npcs.find((npc: { id: string }) => npc.id === "rolf").baseFee = 100;

    const migrated = migrateSaveState(state);

    expect(migrated.npcs).toHaveLength(15);
    expect(migrated.npcs.filter((npc) => npc.adventurer)).toHaveLength(10);
    expect(migrated.npcs.find((npc) => npc.id === "rolf")).toMatchObject({ rank: "D", baseFee: 180, maxHp: 16 });
    expect(migrated.npcs.find((npc) => npc.id === "astrid")).toMatchObject({ rank: "A", maxHp: 44, damage: 12 });
  });
  it("normalizes current positions using a custom 32px home grid and marker", () => {
    const map=createManualMap("home",{width:4,height:4,tileSize:32}); map.collision.fill(true); addMarker(map,{id:"spawn",kind:"homeSpawn",x:2,y:2});
    expect(normalizeHomePositionForMap(map,{x:200,y:-1})).toEqual({x:112,y:16});
    map.collision.fill(false);
    expect(normalizeHomePositionForMap(map,{x:16,y:16})).toEqual({x:80,y:80});
  });
});
