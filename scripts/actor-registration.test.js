import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import { ACTOR_SHEET_ROWS, HUMAN_DIRECTION_ROWS, MONSTER_DIRECTION_ROWS, guessSheetGeometry, registeredActorIds, registerActorClip, removeRegisteredActor } from "./actor-registration.mjs";

const temporaryDirectories = [];
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function workspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actor-registration-"));
  temporaryDirectories.push(directory);
  return directory;
}

function sheet(directory, name, width, height) {
  const image = new PNG({ width, height, colorType: 6 });
  image.data.fill(180);
  const file = path.join(directory, `${name}.png`);
  fs.writeFileSync(file, PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 }));
  return file;
}

describe("registering a sheet as a character", () => {
  it("reads the frame grid from a four-row sheet", () => {
    // One row per facing, square frames: 384x128 is twelve 32px frames.
    expect(guessSheetGeometry(384, 128)).toEqual({ frameWidth: 32, frameHeight: 32, columns: 12, rows: ACTOR_SHEET_ROWS });
    expect(guessSheetGeometry(192, 128)).toEqual({ frameWidth: 32, frameHeight: 32, columns: 6, rows: ACTOR_SHEET_ROWS });
    // Sheets that do not divide cleanly get no guess, and the author types it.
    expect(guessSheetGeometry(448, 208)).toBeUndefined();
    expect(guessSheetGeometry(100, 130)).toBeUndefined();
  });

  it("builds one character out of several sheets, one action at a time", () => {
    const source = workspace(), manualDir = workspace();
    const common = { id: "citizen1", label: "町人1", roles: ["npc", "townsfolk"] };
    registerActorClip({ ...common, action: "idle", sourceFile: sheet(source, "idle", 384, 128) }, { manualDir });
    const definition = registerActorClip({ ...common, action: "walk", sourceFile: sheet(source, "walk", 192, 128) }, { manualDir });

    expect(Object.keys(definition.clips).sort()).toEqual(["idle", "walk"]);
    expect(definition.roles).toEqual(["npc", "townsfolk"]);
    expect(definition.clips.idle).toMatchObject({ columns: 12, frameWidth: 32, frameHeight: 32, rows: ACTOR_SHEET_ROWS });
    expect(definition.clips.walk).toMatchObject({ columns: 6, frameWidth: 32, frameHeight: 32 });
    expect(definition.clips.idle.directions).toEqual(["down", "up", "left", "right"]);
    expect(fs.readdirSync(path.join(manualDir, "citizen1")).sort()).toEqual(["actor.json", "idle.png", "walk.png"]);
    expect(registeredActorIds({ manualDir })).toEqual(["citizen1"]);
  });

  it("refuses a sheet whose grid it cannot work out, and says so", () => {
    const source = workspace(), manualDir = workspace();
    expect(() => registerActorClip({ id: "mage1", label: "魔術師", action: "idle", sourceFile: sheet(source, "mage", 448, 208) }, { manualDir }))
      .toThrow(/コマ割りを推定できません/);
    // With the numbers supplied it goes through, so an odd sheet is not a dead end.
    const definition = registerActorClip({ id: "mage1", label: "魔術師", action: "idle", sourceFile: sheet(source, "mage", 448, 208), frameWidth: 56, frameHeight: 52, columns: 8 }, { manualDir });
    expect(definition.clips.idle).toMatchObject({ frameWidth: 56, frameHeight: 52, columns: 8 });
    // Numbers that do not cover the image are rejected rather than silently cropped.
    expect(() => registerActorClip({ id: "mage1", label: "魔術師", action: "idle", sourceFile: sheet(source, "mage", 448, 208), frameWidth: 56, frameHeight: 52, columns: 7 }, { manualDir }))
      .toThrow(/列数×コマ幅が画像の幅と一致しません/);
  });

  it("checks the identity fields before touching the disk", () => {
    const source = workspace(), manualDir = workspace();
    const file = sheet(source, "idle", 384, 128);
    expect(() => registerActorClip({ id: "Citizen1", label: "町人", action: "idle", sourceFile: file }, { manualDir })).toThrow(/ID/);
    expect(() => registerActorClip({ id: "citizen1", label: "  ", action: "idle", sourceFile: file }, { manualDir })).toThrow(/表示名/);
    expect(() => registerActorClip({ id: "citizen1", label: "町人", action: "dance", sourceFile: file }, { manualDir })).toThrow(/動作が不正/);
    expect(() => registerActorClip({ id: "citizen1", label: "町人", roles: ["boss"], action: "idle", sourceFile: file }, { manualDir })).toThrow(/役割が不正/);
    expect(fs.existsSync(path.join(manualDir, "citizen1"))).toBe(false);
  });

  it("records the row order the author picked", () => {
    const source = workspace(), manualDir = workspace();
    const file = sheet(source, "idle", 384, 128);
    // Human sheets put the sides in the middle; monster sheets put the back there.
    const human = registerActorClip({ id: "citizen1", label: "町人1", action: "idle", sourceFile: file, directions: HUMAN_DIRECTION_ROWS }, { manualDir });
    expect(human.clips.idle.directions).toEqual([...HUMAN_DIRECTION_ROWS]);
    const monster = registerActorClip({ id: "goblin", label: "ゴブリン", action: "idle", sourceFile: file }, { manualDir });
    expect(monster.clips.idle.directions).toEqual([...MONSTER_DIRECTION_ROWS]);
    // A row order has to name each facing exactly once.
    expect(() => registerActorClip({ id: "citizen1", label: "町人1", action: "idle", sourceFile: file, directions: ["down", "down", "left", "right"] }, { manualDir })).toThrow(/行の並びが不正/);
    expect(() => registerActorClip({ id: "citizen1", label: "町人1", action: "idle", sourceFile: file, directions: ["down", "left", "right"] }, { manualDir })).toThrow(/行の並びが不正/);
  });

  it("removes only what it registered", () => {
    const source = workspace(), manualDir = workspace();
    registerActorClip({ id: "citizen1", label: "町人1", action: "idle", sourceFile: sheet(source, "idle", 384, 128) }, { manualDir });
    expect(removeRegisteredActor("citizen1", { manualDir })).toBe("citizen1");
    expect(registeredActorIds({ manualDir })).toEqual([]);
    expect(() => removeRegisteredActor("citizen1", { manualDir })).toThrow(/登録されていません/);
    expect(() => removeRegisteredActor("../escape", { manualDir })).toThrow(/IDが不正/);
  });
});
