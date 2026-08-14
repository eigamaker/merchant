import { describe, expect, it } from "vitest";
import {
  createInitialReviewState,
  edgeKey,
  normalizeReviewState,
  REVIEW_ENTRY,
  REVIEW_HEIGHT,
  REVIEW_STAIRS,
  REVIEW_WIDTH,
  tileIndex,
} from "./reviewModel";

describe("dungeon review model", () => {
  it("starts from the same walkability data as the runtime map", () => {
    const state = createInitialReviewState();
    expect(state.width).toBe(38);
    expect(state.height).toBe(28);
    expect(state.collision).toHaveLength(REVIEW_WIDTH * REVIEW_HEIGHT);
    expect(state.collision[tileIndex(REVIEW_ENTRY.x, REVIEW_ENTRY.y)]).toBe(0);
    expect(state.collision[tileIndex(REVIEW_STAIRS.x, REVIEW_STAIRS.y)]).toBe(0);
    expect(state.connectors[tileIndex(REVIEW_ENTRY.x, REVIEW_ENTRY.y)]).toBe("stairs-up");
    expect(state.connectors[tileIndex(REVIEW_STAIRS.x, REVIEW_STAIRS.y)]).toBe("stairs-down");
  });

  it("normalizes an exported review and rejects a different map", () => {
    const state = createInitialReviewState();
    state.edgeBlocks = [edgeKey(10, 10, "east")];
    state.ledgeEdges = [edgeKey(11, 10, "east")];
    expect(normalizeReviewState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(normalizeReviewState({ ...state, mapId: "other-map" })).toBeUndefined();
    expect(normalizeReviewState({ ...state, heights: [0] })).toBeUndefined();
  });

  it("migrates the old fourth height band into the supported 0–2 range", () => {
    const state = createInitialReviewState();
    const legacy = { ...state, version: 1, heights: [...state.heights] };
    legacy.heights[0] = 3;
    const migrated = normalizeReviewState(legacy);
    expect(migrated?.version).toBe(2);
    expect(migrated?.heights[0]).toBe(2);
  });
});
