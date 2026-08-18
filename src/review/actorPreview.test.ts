import { describe, expect, it } from "vitest";
import { advanceActorPreview, actorPreviewFrameRect, actorPreviewPath } from "./actorPreview";
import type { CraftpixActorClip } from "../game/craftpixActors";

const clip: CraftpixActorClip = { action: "walk", path: "/actor.png", frameWidth: 32, frameHeight: 32, columns: 3, rows: 4, directions: ["down", "left", "right", "up"], frameRate: 10, durationsMs: [100, 200, 300] };

describe("actor preview", () => {
  it("resolves frame coordinates by direction and frame", () => {
    expect(actorPreviewFrameRect(clip, "right", 2)).toEqual({ sx: 64, sy: 64, width: 32, height: 32 });
  });

  it("advances with per-frame durations and wraps", () => {
    expect(advanceActorPreview({ action: "walk", direction: "down", frame: 0, elapsedMs: 0 }, clip, 110)).toMatchObject({ frame: 1, elapsedMs: 10 });
    expect(advanceActorPreview({ action: "walk", direction: "down", frame: 2, elapsedMs: 290 }, clip, 20)).toMatchObject({ frame: 0, elapsedMs: 10 });
  });

  it("normalizes relative generated paths", () => {
    expect(actorPreviewPath("assets/actors/foo.png")).toBe("/assets/actors/foo.png");
    expect(actorPreviewPath("/assets/actors/foo.png")).toBe("/assets/actors/foo.png");
  });
});
