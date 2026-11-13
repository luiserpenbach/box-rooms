import { describe, expect, it } from "vitest";
import { generateOutbreak } from "./generator";
import { parseMap, validateMap } from "./parse";

describe("outbreak generator", () => {
  it("is deterministic", () => {
    expect(generateOutbreak(1234).raw).toBe(generateOutbreak(1234).raw);
  });
  for (const size of ["small", "medium", "large"] as const) {
    it(`produces valid ${size} maps for many seeds`, () => {
      for (let s = 1; s <= 40; s++) {
        const def = generateOutbreak(s * 97, size);
        expect(validateMap(def)).toEqual([]);
        const m = parseMap(def);
        expect(m.objectives.length).toBeGreaterThanOrEqual(3);
        expect(m.spawns.length).toBeGreaterThanOrEqual(2);
      }
    });
  }
});
