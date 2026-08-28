import { describe, expect, it } from "vitest";
import { GIVEN_NAMES, NAME_COMBINATIONS, SURNAMES, generateNpcName } from "./npcNames";

describe("npc names", () => {
  it("gives the same campaign and serial the same name every time", () => {
    expect(generateNpcName("campaign-a", 7)).toBe(generateNpcName("campaign-a", 7));
    expect(generateNpcName("campaign-a", 7)).not.toBe(generateNpcName("campaign-b", 7));
  });

  it("never runs out for a roster-sized cast", () => {
    const taken = new Set<string>();
    for (let serial = 0; serial < 200; serial += 1) taken.add(generateNpcName("campaign", serial, taken));
    expect(taken.size).toBe(200);
  });

  it("never appends a serial to break a tie", () => {
    const taken = new Set<string>();
    for (let serial = 0; serial < 120; serial += 1) {
      const name = generateNpcName("campaign", serial, taken);
      // 「デイン・クロウ 267」のような名前は二度と作らない。
      expect(name).not.toMatch(/\d/);
      expect(name.split("・")).toHaveLength(2);
      taken.add(name);
    }
  });

  it("keeps the original twelve names reachable as parts", () => {
    for (const part of ["アロン", "デイン", "イリス", "ノラ"]) expect(GIVEN_NAMES).toContain(part);
    for (const part of ["ヴェイル", "クロウ", "フリント"]) expect(SURNAMES).toContain(part);
    expect(NAME_COMBINATIONS).toBe(GIVEN_NAMES.length * SURNAMES.length);
    expect(NAME_COMBINATIONS).toBeGreaterThan(400);
  });

  it("walks the combination space so a collision changes the given name first", () => {
    const first = generateNpcName("campaign", 3);
    const second = generateNpcName("campaign", 3, new Set([first]));
    expect(second).not.toBe(first);
    expect(second.split("・")[1]).toBe(first.split("・")[1]);
  });
});
