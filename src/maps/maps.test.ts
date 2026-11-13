import { describe, expect, it } from "vitest";
import { ARENA_DEFS } from "./arenas";
import { EXPEDITION_DEFS } from "./expeditions";
import { validateMap } from "./parse";

describe("hand-made maps", () => {
  const all = [...ARENA_DEFS, ...EXPEDITION_DEFS];
  it("have unique ids", () => {
    const ids = all.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  for (const def of all) {
    it(`${def.mode}/${def.id} is valid`, () => {
      expect(validateMap(def)).toEqual([]);
    });
  }
});
