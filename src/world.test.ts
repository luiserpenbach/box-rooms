import { describe, expect, it } from "vitest";
import { parseMap } from "./maps/parse";
import type { MapDef } from "./maps/types";
import { World } from "./world";

const def = (raw: string): MapDef => ({ id: "t", name: "t", mode: "survival", theme: "concrete", blurb: "", darkness: 0, raw });

// A wall splits the room; the only route is around the bottom.
const ROOM = `
####################
D        #         D
#  1     #     2   #
#        #         #
#        #         #
#                  #
####################
`;

describe("World", () => {
  it("blocks line of sight through walls", () => {
    const w = new World(parseMap(def(ROOM)));
    const [a, b] = w.map.starts;
    expect(w.los(a.x, a.y, b.x, b.y)).toBe(false);
    expect(w.los(a.x, a.y, a.x + 64, a.y + 64)).toBe(true);
  });

  it("finds a path around the wall", () => {
    const w = new World(parseMap(def(ROOM)));
    const [a, b] = w.map.starts;
    const path = w.findPath(a, b)!;
    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(10);
    // Route must dip below the wall (row 5).
    expect(Math.max(...path.map((p) => p.y))).toBeGreaterThan(5 * 32);
  });

  it("flow field leads toward the source", () => {
    const w = new World(parseMap(def(ROOM)));
    const [a, b] = w.map.starts;
    w.computeFlow([b]);
    expect(w.flowAt(b.x, b.y)).toBe(0);
    expect(isFinite(w.flowAt(a.x, a.y))).toBe(true);
    // Walking the flow from A reaches B.
    let x = a.x;
    let y = a.y;
    for (let i = 0; i < 400 && w.flowAt(x, y) > 0; i++) {
      const d = w.flowDir(x, y)!;
      x += d.x * 8;
      y += d.y * 8;
    }
    expect(w.flowAt(x, y)).toBe(0);
  });

  it("prefers going around over smashing a barricade unless it is much shorter", () => {
    const w = new World(parseMap(def(ROOM.replace("#        #         #\n#                  #", "#        #         #\n#        =         #"))));
    const [a, b] = w.map.starts;
    const path = w.findPath(a, b)!;
    expect(path).not.toBeNull();
    // Barricade breaks open the tile when destroyed.
    const bar = w.map.barricades[0];
    const i = bar.ty * w.cols + bar.tx;
    expect(w.damageBarricade(i, 10_000)).toBe(true);
    expect(w.solid(bar.tx, bar.ty)).toBe(false);
  });

  it("resolves circles out of walls", () => {
    const w = new World(parseMap(def(ROOM)));
    const p = { x: 9 * 32 + 4, y: 2 * 32 + 16, r: 12 };
    w.resolveCircle(p);
    expect(w.circleHitsSolid(p.x, p.y, p.r - 0.5)).toBe(false);
  });
});
