import type { Vec } from "../math";
import {
  type GameMap,
  type MapDef,
  type Spawn,
  type TilePos,
  T_BARRICADE,
  T_CRATE,
  T_FLOOR,
  T_TREE,
  T_WALL,
} from "./types";

export const TILE = 32;

const KNOWN = new Set("#ct=. 12DXOZzA+bL".split(""));

function tileCode(c: string): number {
  if (c === "#") return T_WALL;
  if (c === "c") return T_CRATE;
  if (c === "t") return T_TREE;
  if (c === "=") return T_BARRICADE;
  return T_FLOOR;
}

export function splitRows(raw: string): string[] {
  const rows = raw
    .replace(/^\n+/, "")
    .replace(/\s+$/, "")
    .split("\n")
    .map((l) => l.trimEnd());
  const cols = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(cols, " "));
}

export function parseMap(def: MapDef, seed?: number): GameMap {
  const cells = splitRows(def.raw);
  const rows = cells.length;
  const cols = cells[0].length;
  const grid = new Uint8Array(cols * rows);
  const spawns: Spawn[] = [];
  const starts: Vec[] = [];
  const startsByIndex: (Vec | undefined)[] = [];
  const extraction: TilePos[] = [];
  const objectives: Vec[] = [];
  const nests: Vec[] = [];
  const singles: Vec[] = [];
  const bosses: Vec[] = [];
  const supplies: Vec[] = [];
  const barrels: Vec[] = [];
  const lamps: Vec[] = [];
  const barricades: TilePos[] = [];

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      grid[ty * cols + tx] = tileCode(cells[ty][tx]);
    }
  }

  const center = (tx: number, ty: number): Vec => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const c = cells[ty][tx];
      const p = center(tx, ty);
      switch (c) {
        case "1":
          startsByIndex[0] = p;
          break;
        case "2":
          startsByIndex[1] = p;
          break;
        case "D": {
          // Inward direction = average direction toward neighbouring open floor
          // that is further from the map edge.
          let ix = 0;
          let iy = 0;
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
              ix -= dx;
              iy -= dy;
              continue;
            }
            if (grid[ny * cols + nx] !== T_FLOOR) continue;
            if (cells[ny][nx] === "D") continue;
            ix += dx;
            iy += dy;
          }
          const l = Math.hypot(ix, iy) || 1;
          spawns.push({ x: p.x, y: p.y, inX: ix / l, inY: iy / l });
          break;
        }
        case "X":
          extraction.push({ tx, ty });
          break;
        case "O":
          objectives.push(p);
          break;
        case "Z":
          nests.push(p);
          break;
        case "z":
          singles.push(p);
          break;
        case "A":
          bosses.push(p);
          break;
        case "+":
          supplies.push(p);
          break;
        case "b":
          barrels.push(p);
          break;
        case "L":
          lamps.push(p);
          break;
        case "=":
          barricades.push({ tx, ty });
          break;
      }
    }
  }

  if (startsByIndex[0]) starts.push(startsByIndex[0]);
  if (startsByIndex[1]) starts.push(startsByIndex[1]);
  if (starts.length === 0) starts.push(center(cols >> 1, rows >> 1));
  if (starts.length === 1) starts.push({ x: starts[0].x + 28, y: starts[0].y });

  const { raw: _raw, ...meta } = def;
  void _raw;
  return {
    ...meta,
    tile: TILE,
    cols,
    rows,
    width: cols * TILE,
    height: rows * TILE,
    grid,
    spawns,
    starts,
    extraction,
    objectives,
    nests,
    singles,
    bosses,
    supplies,
    barrels,
    lamps,
    barricades,
    cells,
    seed,
  };
}

/** BFS over the tile grid. `passBarricades` lets the search walk through '=' tiles. */
export function reachable(map: GameMap, from: Vec, passBarricades: boolean): Uint8Array {
  const seen = new Uint8Array(map.cols * map.rows);
  const sx = Math.floor(from.x / TILE);
  const sy = Math.floor(from.y / TILE);
  const q: number[] = [sy * map.cols + sx];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % map.cols;
    const y = (i / map.cols) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.cols || ny >= map.rows) continue;
      const j = ny * map.cols + nx;
      if (seen[j]) continue;
      const t = map.grid[j];
      if (t === T_FLOOR || (passBarricades && t === T_BARRICADE)) {
        seen[j] = 1;
        q.push(j);
      }
    }
  }
  return seen;
}

/** Returns a list of human-readable problems. Empty list = valid map. */
export function validateMap(def: MapDef): string[] {
  const errs: string[] = [];
  const cells = splitRows(def.raw);
  const rows = cells.length;
  const cols = cells[0]?.length ?? 0;
  if (rows < 8 || cols < 16) errs.push(`too small (${cols}x${rows})`);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cells[y][x];
      if (!KNOWN.has(c)) errs.push(`unknown char '${c}' at ${x},${y}`);
      const edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      if (edge && c !== "#" && c !== "D" && c !== "t") {
        errs.push(`border must be '#', 't' or 'D' — found '${c}' at ${x},${y}`);
      }
    }
  }
  if (errs.length) return errs;

  const map = parseMap(def);
  const count = (ch: string) => cells.reduce((n, r) => n + r.split(ch).length - 1, 0);
  if (count("1") !== 1) errs.push(`needs exactly one '1' (found ${count("1")})`);
  if (count("2") > 1) errs.push(`at most one '2'`);
  if (map.spawns.length < 2) errs.push(`needs at least 2 'D' horde doors`);

  const start = map.starts[0];
  const open = reachable(map, start, false);
  const withBarricades = reachable(map, start, true);
  const at = (p: Vec) => Math.floor(p.y / TILE) * map.cols + Math.floor(p.x / TILE);

  if (map.starts[1] && count("2") === 1 && !open[at(map.starts[1])]) errs.push(`P2 start not reachable from P1`);
  for (const s of map.spawns) {
    if (!withBarricades[at(s)]) errs.push(`door at ${Math.floor(s.x / TILE)},${Math.floor(s.y / TILE)} cannot reach the players`);
  }
  if (def.mode !== "survival") {
    if (map.objectives.length < 2) errs.push(`expedition needs at least 2 'O' objectives`);
    if (map.extraction.length < 2) errs.push(`expedition needs an extraction pad of 'X' tiles`);
    for (const o of map.objectives) {
      if (!open[at(o)]) errs.push(`objective at ${Math.floor(o.x / TILE)},${Math.floor(o.y / TILE)} unreachable without breaking barricades`);
    }
    for (const e of map.extraction) {
      if (!open[e.ty * map.cols + e.tx]) errs.push(`extraction tile ${e.tx},${e.ty} unreachable without breaking barricades`);
    }
    if (!def.objectiveLabel) errs.push(`expedition needs objectiveLabel`);
    if (!def.parTime) errs.push(`expedition needs parTime`);
  }
  for (const list of [map.nests, map.singles, map.supplies, map.bosses]) {
    for (const p of list) {
      if (!withBarricades[at(p)]) errs.push(`entity at ${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)} is sealed off`);
    }
  }
  return errs;
}
