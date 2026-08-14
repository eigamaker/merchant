import { describe, expect, it } from "vitest";
import { cloneTemplateLibrary, validateTemplateLibrary } from "./dungeonTemplates";

describe("Craftpix room template library", () => {
  it("ships a valid, independently editable library", () => {
    const library = cloneTemplateLibrary();
    expect(library).toHaveLength(12);
    expect(validateTemplateLibrary(library)).toEqual([]);
    library[0]!.name = "Changed only in the copy";
    expect(cloneTemplateLibrary()[0]!.name).not.toBe(library[0]!.name);
  });

  it("rejects a library that can no longer build the mandatory route", () => {
    const library = cloneTemplateLibrary().filter((template) => !template.tags.includes("exit"));
    expect(validateTemplateLibrary(library)).toContain("Missing required template tag: exit");
  });
});
