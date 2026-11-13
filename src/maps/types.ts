import type { Vec } from "../math";

/**
 * Map legend (one character per 32px tile):
 *
 *   #   solid wall (blocks movement, bullets and sight)
 *   c   crate (solid, blocks movement / bullets / sight, drawn as a wooden crate)
 *   t   tree (solid, outdoor maps)
 *   =   barricade (wooden boards; blocks movement and bullets until broken —
 *       zombies smash through them, explosives destroy them)
 *   .   floor (space also works)
 *   1 2 player starts (P1 / P2)
 *   D   horde door — zombies pour in from here (place on the outer wall or a wall gap)
 *   X   extraction zone tile (expedition) — group several X tiles into a pad
 *   O   objective item (expedition) — fuel can / keycard / sample etc.
 *   Z   zombie nest — 3–6 dormant zombies seeded around it
 *   z   single dormant zombie
 *   A   abomination (boss) lair
 *   +   supply crate (ammo + health, opened by touching)
 *   b   explosive barrel prop
 *   L   lamp — static light in dark maps
 */
export type ThemeId =
  | "concrete"
  | "warehouse"
  | "hospital"
  | "forest"
  | "sewer"
  | "lab"
  | "suburb"
  | "military";

export type MapMode = "survival" | "expedition" | "outbreak";

export interface MapDef {
  id: string;
  name: string;
  mode: MapMode;
  theme: ThemeId;
  /** One-line flavour shown on the map card. */
  blurb: string;
  /** 0 = fully lit, 1 = pitch black outside the players' light. */
  darkness: number;
  /** Label for the objective pickup, e.g. "FUEL CAN" (expedition only). */
  objectiveLabel?: string;
  /** Seconds to extract for the 2nd star (expedition only). */
  parTime?: number;
  /** Seconds between hordes (expedition only). */
  hordeInterval?: number;
  /** Extra dormant zombies scattered randomly on top of nests (expedition only). */
  roamers?: number;
  raw: string;
}

export const T_FLOOR = 0;
export const T_WALL = 1;
export const T_CRATE = 2;
export const T_TREE = 3;
export const T_BARRICADE = 4;

export type Spawn = { x: number; y: number; inX: number; inY: number };
export type TilePos = { tx: number; ty: number };

export interface GameMap extends Omit<MapDef, "raw"> {
  tile: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  /** Tile codes (T_*), row-major. Mutable at runtime (barricades break). */
  grid: Uint8Array;
  spawns: Spawn[];
  starts: Vec[];
  extraction: TilePos[];
  objectives: Vec[];
  nests: Vec[];
  singles: Vec[];
  bosses: Vec[];
  supplies: Vec[];
  barrels: Vec[];
  lamps: Vec[];
  barricades: TilePos[];
  cells: string[];
  seed?: number;
}
