import { describe, expect, it } from "vitest";
import { beginExpedition, createNewGame, descend } from "./engine";
import { isSupportedSaveVersion, migrateSaveState, normalizeHomePositionForMap } from "./save";
import { addMarker, createManualMap } from "./mapDocument";
import { HOME_SPAWN } from "./homeMap";
describe("save migration", () => {
  it("accepts legacy v8 saves and the new v9 format at the repository boundary", () => {
    expect(isSupportedSaveVersion(4)).toBe(false);
    expect(isSupportedSaveVersion(5)).toBe(true);
    expect(isSupportedSaveVersion(8)).toBe(true);
    expect(isSupportedSaveVersion(9)).toBe(true);
    expect(isSupportedSaveVersion(10)).toBe(true);
    expect(isSupportedSaveVersion(11)).toBe(true);
    expect(isSupportedSaveVersion(12)).toBe(true);
    expect(isSupportedSaveVersion(13)).toBe(false);
  });
  it.each([1,2,3])("migrates v%d town/interior saves to home", (version) => {
    const state:any = createNewGame(); state.version=version; state.location=version===2?"interior":"town"; state.townPos={x:4,y:4}; delete state.homePos; delete state.homeMapRevision;
    const migrated=migrateSaveState(state);
    expect(migrated.version).toBe(12); expect(migrated.location).toBe("home"); expect(migrated.homePos).toEqual({x:HOME_SPAWN.x*16+8,y:HOME_SPAWN.y*16+8});
  });
  it("migrates legacy dungeon connector fields and adds the floor snapshot dictionary", () => {
    const state:any = createNewGame(); beginExpedition(state);
    state.run.map = { ...state.run.map, entrance: { x: 2, y: 2 }, stairs: { x: 3, y: 3 }, returnStairs: { x: 2, y: 2 } }; delete state.run.map.stairsUp; delete state.run.map.stairsDown; delete state.run.floorStates;
    const migrated = migrateSaveState(state);
    expect(migrated.run?.map.stairsUp).toEqual({x:2,y:2});
    expect(migrated.run?.map.stairsDown).toEqual({x:3,y:3});
    expect(migrated.run?.floorStates).toEqual({});
  });
  it("re-reads the v9 status vocabulary and defaults the new campaign fields", () => {
    const state: any = createNewGame();
    state.version = 9;
    delete state.dungeonCorpses;
    delete state.lastSimulatedDay;
    // v9 の語彙をそのまま置く。escort は雇用中、もう一人は単独潜行。
    const [escort, solo, other] = state.npcs.filter((npc: any) => npc.adventurer);
    state.hiredGuardId = escort.id;
    escort.status = "dungeon";
    solo.status = "dungeon";
    other.status = "departed";

    const migrated: any = migrateSaveState(state);

    expect(migrated.version).toBe(12);
    expect(migrated.npcs.find((npc: any) => npc.id === escort.id).status).toBe("escorting");
    const migratedSolo = migrated.npcs.find((npc: any) => npc.id === solo.id);
    expect(migratedSolo.status).toBe("delving");
    expect(migratedSolo.delve).toEqual({ floor: 1, departedDay: migrated.day });
    expect(migrated.npcs.find((npc: any) => npc.id === other.id).status).toBe("inTown");
    expect(migrated.dungeonCorpses).toEqual([]);
    // 読み込んだ瞬間に1日回さない。
    expect(migrated.lastSimulatedDay).toBe(migrated.day);
    expect(migrated.npcs.every((npc: any) => npc.status !== "departed" && npc.status !== "dungeon")).toBe(true);
  });

  it("adds daily expedition state and deterministic guard profiles to v8 saves", () => {
    const home: any = createNewGame(); home.version = 8; delete home.lastExpeditionDay; for (const npc of home.npcs) delete npc.guardProfile;
    const migratedHome = migrateSaveState(home);
    expect(migratedHome.lastExpeditionDay).toBe(0);
    expect(migratedHome.npcs.filter((npc) => npc.adventurer).every((npc) => npc.guardProfile)).toBe(true);

    const active: any = createNewGame(); beginExpedition(active); active.version = 8; delete active.lastExpeditionDay; delete active.run.startedDay;
    const migratedActive = migrateSaveState(active);
    expect(migratedActive.lastExpeditionDay).toBe(migratedActive.day);
    expect(migratedActive.run?.startedDay).toBe(migratedActive.day);
  });
  it("migrates a v11 expedition to cave without regenerating current or snapshotted floors", () => {
    const state: any = createNewGame();
    beginExpedition(state);
    state.run.map.explored = "1".repeat(state.run.map.width * state.run.map.height);
    descend(state);
    state.version = 11;
    delete state.run.themeScheduleVersion;
    delete state.run.themePoolIds;
    delete state.run.map.procedural;
    for (const snapshot of Object.values(state.run.floorStates) as any[]) delete snapshot.map.procedural;
    const currentTiles = structuredClone(state.run.map.tiles);
    const currentEnemies = structuredClone(state.run.enemies);
    const firstFloorTiles = structuredClone(state.run.floorStates["1"].map.tiles);

    const migrated = migrateSaveState(state);

    expect(migrated.run?.themePoolIds).toEqual(["cave"]);
    expect(migrated.run?.map.procedural?.themeId).toBe("cave");
    expect(migrated.run?.floorStates["1"]?.map.procedural?.themeId).toBe("cave");
    expect(migrated.run?.map.tiles).toEqual(currentTiles);
    expect(migrated.run?.enemies).toEqual(currentEnemies);
    expect(migrated.run?.floorStates["1"]?.map.tiles).toEqual(firstFloorTiles);
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
    // 台本の能力値を貼り直すのは v11 より前のセーブだけ。v11 以降は育った値を守る。
    state.version = 10;
    const legacyIds = new Set(["rolf", "mina", "bastian", "mira", "godwin", "neva", "roden", "rina"]);
    state.npcs = state.npcs.filter((npc: { id: string }) => legacyIds.has(npc.id));
    for (const npc of state.npcs) delete npc.rank;
    state.npcs.find((npc: { id: string }) => npc.id === "rolf").baseFee = 100;

    const migrated = migrateSaveState(state);

    // 旧セーブは自分の campaignId から目標人数まで育つ。台本の15人は必ず戻る。
    expect(migrated.npcs.filter((npc) => npc.adventurer)).toHaveLength(30);
    expect(migrated.npcs).toHaveLength(35);
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
