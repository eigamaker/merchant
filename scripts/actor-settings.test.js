import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeActorSettings, readActorSettings, writeActorSettingsAtomically } from "./actor-settings.mjs";

describe("actor settings", () => {
  it("normalizes roles and enemy stats", () => {
    expect(normalizeActorSettings({ version: 1, actors: { slime: { roles: ["enemy", "enemy"], enemyStats: { baseHp: 3, hpPerFloor: 1, damage: 2 } } } })).toEqual({ version: 1, actors: { slime: { roles: ["enemy"], enemyStats: { baseHp: 3, hpPerFloor: 1, damage: 2 } } } });
  });

  it("writes and reads atomically", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actor-settings-"));
    const file = path.join(directory, "actor-settings.json");
    writeActorSettingsAtomically({ version: 1, actors: { goblin: { label: "Goblin", roles: ["enemy"], enemyStats: { baseHp: 4, hpPerFloor: 1, damage: 2 } } } }, { file });
    expect(readActorSettings(file).actors.goblin.enemyStats.damage).toBe(2);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("rejects invalid stats", () => {
    expect(() => normalizeActorSettings({ version: 1, actors: { bad: { enemyStats: { baseHp: 0, hpPerFloor: 0, damage: 0 } } } })).toThrow(/invalid enemy stats/);
  });
});

describe("actor profile settings", () => {
  it("keeps the archetype and tier instead of dropping them", () => {
    const settings = normalizeActorSettings({ version: 1, actors: { orc1: { archetype: "brute", tier: 3 } } });
    expect(settings.actors.orc1).toEqual({ archetype: "brute", tier: 3 });
  });

  it("rejects an unknown archetype or an out-of-range tier", () => {
    expect(() => normalizeActorSettings({ version: 1, actors: { orc1: { archetype: "wizard" } } })).toThrow(/archetype/);
    expect(() => normalizeActorSettings({ version: 1, actors: { orc1: { tier: 0 } } })).toThrow(/tier/);
    expect(() => normalizeActorSettings({ version: 1, actors: { orc1: { tier: 6 } } })).toThrow(/tier/);
  });
});
