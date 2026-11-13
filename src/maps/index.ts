import { ARENA_DEFS } from "./arenas";
import { EXPEDITION_DEFS } from "./expeditions";
import { parseMap } from "./parse";
import type { GameMap, MapDef } from "./types";

export { ARENA_DEFS, EXPEDITION_DEFS };
export { THEMES } from "./themes";
export { generateOutbreak, dailySeed, type OutbreakSize } from "./generator";

/** Parse a fresh copy (the grid is mutated at runtime when barricades break). */
export function loadMap(def: MapDef): GameMap {
  return parseMap(def);
}

export function expeditionIndex(id: string): number {
  return EXPEDITION_DEFS.findIndex((d) => d.id === id);
}
