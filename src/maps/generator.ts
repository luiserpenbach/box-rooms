import { hashString, mulberry32 } from "../math";
import { validateMap } from "./parse";
import type { MapDef, ThemeId } from "./types";

type Rng = () => number;
type Room = { x: number; y: number; w: number; h: number; id: number };

export type OutbreakSize = "small" | "medium" | "large";

const SIZES: Record<OutbreakSize, { w: number; h: number; obj: number }> = {
  small: { w: 56, h: 38, obj: 3 },
  medium: { w: 72, h: 48, obj: 4 },
  large: { w: 92, h: 60, obj: 5 },
};

const INDOOR: ThemeId[] = ["warehouse", "hospital", "lab", "sewer", "military", "concrete"];
const OUTDOOR: ThemeId[] = ["forest", "suburb"];

const ADJ = ["Silent", "Rotting", "Hollow", "Ashen", "Forsaken", "Crimson", "Drowned", "Burnt", "Quarantine", "Lost", "Black", "Last"];
const NOUN: Record<ThemeId, string[]> = {
  concrete: ["Block", "Complex", "Station", "Yard"],
  warehouse: ["Depot", "Docks", "Storage", "Freight"],
  hospital: ["Ward", "Clinic", "Infirmary", "Wing"],
  forest: ["Woods", "Hollow", "Pines", "Trail"],
  sewer: ["Tunnels", "Drains", "Cistern", "Outflow"],
  lab: ["Facility", "Labs", "Vault", "Annex"],
  suburb: ["Heights", "Estates", "Lane", "Crescent"],
  military: ["Outpost", "Bunker", "Garrison", "Checkpoint"],
};
const OBJ: Record<ThemeId, string> = {
  concrete: "FUEL CAN",
  warehouse: "FUEL CAN",
  hospital: "SAMPLE",
  forest: "RADIO PART",
  sewer: "VALVE",
  lab: "KEYCARD",
  suburb: "BATTERY",
  military: "INTEL",
};

const ri = (r: Rng, a: number, b: number) => a + Math.floor(r() * (b - a + 1));
const pickR = <T>(r: Rng, arr: T[]): T => arr[Math.floor(r() * arr.length)];

class Canvas {
  g: string[][];
  constructor(
    public w: number,
    public h: number,
    fill: string,
  ) {
    this.g = Array.from({ length: h }, () => Array.from({ length: w }, () => fill));
  }
  get(x: number, y: number): string {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return "#";
    return this.g[y][x];
  }
  set(x: number, y: number, c: string): void {
    if (x <= 0 || y <= 0 || x >= this.w - 1 || y >= this.h - 1) return;
    this.g[y][x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }
  open(x: number, y: number): boolean {
    const c = this.get(x, y);
    return c === " ";
  }
  toString(): string {
    return "\n" + this.g.map((r) => r.join("")).join("\n") + "\n";
  }
}

function carveCorridor(cv: Canvas, r: Rng, ax: number, ay: number, bx: number, by: number, width: number): void {
  const horizFirst = r() < 0.5;
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    let x = x0;
    let y = y0;
    for (let guard = 0; guard < 400; guard++) {
      for (let k = 0; k < width; k++) {
        if (dx !== 0) cv.set(x, y + k, cv.get(x, y + k) === "#" ? " " : cv.get(x, y + k));
        else cv.set(x + k, y, cv.get(x + k, y) === "#" ? " " : cv.get(x + k, y));
      }
      if (x === x1 && y === y1) break;
      x += dx;
      y += dy;
    }
  };
  if (horizFirst) {
    line(ax, ay, bx, ay);
    line(bx, ay, bx, by);
    cv.rect(bx, ay, width, width, " ");
  } else {
    line(ax, ay, ax, by);
    line(ax, by, bx, by);
    cv.rect(ax, by, width, width, " ");
  }
}

function bsp(r: Rng, x: number, y: number, w: number, h: number, depth: number, out: Room[]): void {
  const canSplitH = w >= 22;
  const canSplitV = h >= 18;
  if (depth <= 0 || (!canSplitH && !canSplitV) || (depth < 3 && r() < 0.15)) {
    const rw = ri(r, Math.max(6, Math.floor(w * 0.55)), w - 3);
    const rh = ri(r, Math.max(5, Math.floor(h * 0.55)), h - 3);
    const rx = x + ri(r, 1, w - rw - 2);
    const ry = y + ri(r, 1, h - rh - 2);
    out.push({ x: rx, y: ry, w: rw, h: rh, id: out.length });
    return;
  }
  const splitH = canSplitH && (!canSplitV || w / h > 1.15 || (w / h > 0.85 && r() < 0.5));
  if (splitH) {
    const s = ri(r, Math.floor(w * 0.38), Math.ceil(w * 0.62));
    bsp(r, x, y, s, h, depth - 1, out);
    bsp(r, x + s, y, w - s, h, depth - 1, out);
  } else {
    const s = ri(r, Math.floor(h * 0.38), Math.ceil(h * 0.62));
    bsp(r, x, y, w, s, depth - 1, out);
    bsp(r, x, y + s, w, h - s, depth - 1, out);
  }
}

const cx = (rm: Room) => rm.x + Math.floor(rm.w / 2);
const cy = (rm: Room) => rm.y + Math.floor(rm.h / 2);

function indoorLayout(r: Rng, W: number, H: number): { cv: Canvas; rooms: Room[] } {
  const cv = new Canvas(W, H, "#");
  const rooms: Room[] = [];
  bsp(r, 1, 1, W - 2, H - 2, 5, rooms);
  for (const rm of rooms) cv.rect(rm.x, rm.y, rm.w, rm.h, " ");
  // Connect every room to its nearest unconnected neighbour (MST-ish), then add loops.
  const connected = new Set<number>([0]);
  const edges: [Room, Room][] = [];
  while (connected.size < rooms.length) {
    let best: [Room, Room] | null = null;
    let bd = Infinity;
    for (const a of rooms) {
      if (!connected.has(a.id)) continue;
      for (const b of rooms) {
        if (connected.has(b.id)) continue;
        const d = Math.abs(cx(a) - cx(b)) + Math.abs(cy(a) - cy(b));
        if (d < bd) {
          bd = d;
          best = [a, b];
        }
      }
    }
    if (!best) break;
    connected.add(best[1].id);
    edges.push(best);
  }
  const loops = Math.max(2, Math.floor(rooms.length * 0.35));
  for (let i = 0; i < loops; i++) {
    const a = pickR(r, rooms);
    const near = rooms
      .filter((b) => b !== a)
      .sort((p, q) => Math.abs(cx(a) - cx(p)) + Math.abs(cy(a) - cy(p)) - (Math.abs(cx(a) - cx(q)) + Math.abs(cy(a) - cy(q))));
    const b = near[ri(r, 0, Math.min(2, near.length - 1))];
    if (b) edges.push([a, b]);
  }
  for (const [a, b] of edges) carveCorridor(cv, r, cx(a), cy(a), cx(b), cy(b), r() < 0.6 ? 2 : 3);
  return { cv, rooms };
}

function outdoorLayout(r: Rng, W: number, H: number): { cv: Canvas; rooms: Room[] } {
  const cv = new Canvas(W, H, " ");
  for (let x = 0; x < W; x++) {
    cv.g[0][x] = "t";
    cv.g[H - 1][x] = "t";
  }
  for (let y = 0; y < H; y++) {
    cv.g[y][0] = "t";
    cv.g[y][W - 1] = "t";
  }
  // Buildings (rooms with walls + door gaps) on a loose grid.
  const rooms: Room[] = [];
  const cellW = 18;
  const cellH = 15;
  for (let gy = 0; gy + cellH <= H - 2; gy += cellH) {
    for (let gx = 0; gx + cellW <= W - 2; gx += cellW) {
      const bx = 1 + gx + ri(r, 2, 4);
      const by = 1 + gy + ri(r, 2, 4);
      const bw = ri(r, 8, cellW - 6);
      const bh = ri(r, 6, cellH - 6);
      if (r() < 0.72) {
        cv.rect(bx, by, bw, bh, "#");
        cv.rect(bx + 1, by + 1, bw - 2, bh - 2, " ");
        // 2–3 door gaps
        const gaps = ri(r, 2, 3);
        for (let k = 0; k < gaps; k++) {
          const side = ri(r, 0, 3);
          const len = ri(r, 2, 3);
          if (side === 0) cv.rect(bx + ri(r, 1, bw - len - 1), by, len, 1, " ");
          if (side === 1) cv.rect(bx + ri(r, 1, bw - len - 1), by + bh - 1, len, 1, " ");
          if (side === 2) cv.rect(bx, by + ri(r, 1, bh - len - 1), 1, len, " ");
          if (side === 3) cv.rect(bx + bw - 1, by + ri(r, 1, bh - len - 1), 1, len, " ");
        }
        rooms.push({ x: bx + 1, y: by + 1, w: bw - 2, h: bh - 2, id: rooms.length });
      } else {
        rooms.push({ x: bx, y: by, w: bw, h: bh, id: rooms.length });
      }
    }
  }
  // Tree clumps in the open.
  const clumps = Math.floor((W * H) / 140);
  for (let i = 0; i < clumps; i++) {
    const x = ri(r, 2, W - 3);
    const y = ri(r, 2, H - 3);
    const n = ri(r, 1, 5);
    for (let k = 0; k < n; k++) {
      const tx = x + ri(r, -2, 2);
      const ty = y + ri(r, -2, 2);
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (cv.get(tx + dx, ty + dy) === "#") ok = false;
      if (ok) cv.set(tx, ty, "t");
    }
  }
  return { cv, rooms };
}

/** Flood fill from (sx,sy); returns distance grid (−1 = unreachable). */
function flood(cv: Canvas, sx: number, sy: number, passable: (c: string) => boolean): Int32Array {
  const d = new Int32Array(cv.w * cv.h).fill(-1);
  const q = [sy * cv.w + sx];
  d[q[0]] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    const x = i % cv.w;
    const y = (i / cv.w) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cv.w || ny >= cv.h) continue;
      const j = ny * cv.w + nx;
      if (d[j] >= 0 || !passable(cv.g[ny][nx])) continue;
      d[j] = d[i] + 1;
      q.push(j);
    }
  }
  return d;
}

const isOpenChar = (c: string) => c !== "#" && c !== "t" && c !== "c" && c !== "=";

function freeTileIn(cv: Canvas, r: Rng, rm: Room, reach: Int32Array, margin = 1): [number, number] | null {
  for (let tries = 0; tries < 40; tries++) {
    const x = ri(r, rm.x + margin, rm.x + rm.w - 1 - margin);
    const y = ri(r, rm.y + margin, rm.y + rm.h - 1 - margin);
    if (cv.get(x, y) === " " && reach[y * cv.w + x] >= 0) return [x, y];
  }
  return null;
}

export function generateOutbreak(seed: number, size: OutbreakSize = "medium"): MapDef {
  for (let attempt = 0; attempt < 25; attempt++) {
    const def = tryGenerate(seed + attempt * 7919, size, seed);
    if (def && validateMap(def).length === 0) return def;
  }
  throw new Error("generator failed");
}

function tryGenerate(seed: number, size: OutbreakSize, displaySeed: number): MapDef | null {
  const r = mulberry32(seed);
  const { w: W, h: H, obj } = SIZES[size];
  const outdoor = r() < 0.3;
  const theme = outdoor ? pickR(r, OUTDOOR) : pickR(r, INDOOR);
  const { cv, rooms } = outdoor ? outdoorLayout(r, W, H) : indoorLayout(r, W, H);
  if (rooms.length < obj + 3) return null;

  // Start room: the room closest to a random edge corner.
  const corner = [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
  ][ri(r, 0, 3)];
  const byCorner = [...rooms].sort(
    (a, b) => Math.hypot(cx(a) - corner[0], cy(a) - corner[1]) - Math.hypot(cx(b) - corner[0], cy(b) - corner[1]),
  );
  const startRoom = byCorner[0];
  const sx = cx(startRoom);
  const sy = cy(startRoom);
  if (!cv.open(sx, sy) || !cv.open(sx + 1, sy)) return null;

  let reach = flood(cv, sx, sy, isOpenChar);
  const roomDist = (rm: Room) => {
    let best = -1;
    for (let y = rm.y; y < rm.y + rm.h; y++)
      for (let x = rm.x; x < rm.x + rm.w; x++) best = Math.max(best, reach[y * W + x]);
    return best;
  };
  const reachable = rooms.filter((rm) => rm !== startRoom && roomDist(rm) > 0);
  if (reachable.length < obj + 2) return null;

  // Extraction: farthest room (by walking distance).
  const byDist = [...reachable].sort((a, b) => roomDist(b) - roomDist(a));
  const exitRoom = byDist[0];

  // Objectives: farthest-point sampling across remaining rooms.
  const chosen: Room[] = [];
  const pool = reachable.filter((rm) => rm !== exitRoom);
  while (chosen.length < obj && pool.length) {
    let best = pool[0];
    let bd = -1;
    for (const rm of pool) {
      const others = [startRoom, exitRoom, ...chosen];
      const d = Math.min(...others.map((o) => Math.hypot(cx(o) - cx(rm), cy(o) - cy(rm))));
      if (d > bd) {
        bd = d;
        best = rm;
      }
    }
    chosen.push(best);
    pool.splice(pool.indexOf(best), 1);
  }

  // Crates as cover (keep 1-tile clearance so nothing gets sealed).
  for (const rm of rooms) {
    if (rm === startRoom || rm.w < 7 || rm.h < 6) continue;
    const n = ri(r, 0, 3);
    for (let i = 0; i < n; i++) {
      const x = ri(r, rm.x + 2, rm.x + rm.w - 3);
      const y = ri(r, rm.y + 2, rm.y + rm.h - 3);
      const len = ri(r, 1, 2);
      const horiz = r() < 0.5;
      for (let k = 0; k < len; k++) {
        const px = x + (horiz ? k : 0);
        const py = y + (horiz ? 0 : k);
        if (cv.get(px, py) === " ") cv.set(px, py, "c");
      }
    }
  }

  // Place markers.
  cv.set(sx, sy, "1");
  cv.set(sx + 1, sy, "2");
  const ex = cx(exitRoom) - 1;
  const ey = cy(exitRoom) - 1;
  cv.rect(ex, ey, 3, 2, "X");
  for (const rm of chosen) {
    const p = freeTileIn(cv, r, rm, reach);
    if (!p) return null;
    cv.set(p[0], p[1], "O");
  }

  // Nests & singles, away from the start.
  const far = reachable.filter((rm) => Math.hypot(cx(rm) - sx, cy(rm) - sy) > 14);
  const nests = Math.min(far.length, 3 + Math.floor(rooms.length / 3));
  for (let i = 0; i < nests; i++) {
    const p = freeTileIn(cv, r, pickR(r, far), reach);
    if (p) cv.set(p[0], p[1], "Z");
  }
  for (let i = 0; i < 6 + Math.floor(rooms.length / 2); i++) {
    const p = freeTileIn(cv, r, pickR(r, far), reach, 0);
    if (p) cv.set(p[0], p[1], "z");
  }
  if (size !== "small" && r() < 0.6) {
    const big = [...far].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    const p = big && freeTileIn(cv, r, big, reach, 2);
    if (p) cv.set(p[0], p[1], "A");
  }
  // Supplies, lamps, barrels.
  for (let i = 0; i < 3 + Math.floor(rooms.length / 3); i++) {
    const p = freeTileIn(cv, r, pickR(r, reachable), reach);
    if (p) cv.set(p[0], p[1], "+");
  }
  for (const rm of rooms) {
    if (r() < 0.55) {
      const p = freeTileIn(cv, r, rm, reach);
      if (p) cv.set(p[0], p[1], "L");
    }
  }
  for (let i = 0; i < 4 + Math.floor(rooms.length / 3); i++) {
    const p = freeTileIn(cv, r, pickR(r, reachable), reach);
    if (p) cv.set(p[0], p[1], "b");
  }

  // Horde doors: tunnel from rooms straight to the nearest border.
  const doors = ri(r, 5, 8);
  const doorRooms = [...reachable].sort(() => r() - 0.5);
  let placed = 0;
  for (const rm of doorRooms) {
    if (placed >= doors) break;
    if (rm === startRoom || Math.hypot(cx(rm) - sx, cy(rm) - sy) < 16) continue;
    const opts = [
      { d: rm.x, dx: -1, dy: 0 },
      { d: W - 1 - (rm.x + rm.w - 1), dx: 1, dy: 0 },
      { d: rm.y, dx: 0, dy: -1 },
      { d: H - 1 - (rm.y + rm.h - 1), dx: 0, dy: 1 },
    ].sort((a, b) => a.d - b.d);
    const o = opts[0];
    if (o.d > 12) continue;
    let x = o.dx ? (o.dx < 0 ? rm.x : rm.x + rm.w - 1) : ri(r, rm.x + 1, rm.x + rm.w - 2);
    let y = o.dy ? (o.dy < 0 ? rm.y : rm.y + rm.h - 1) : ri(r, rm.y + 1, rm.y + rm.h - 2);
    for (let guard = 0; guard < 40; guard++) {
      x += o.dx;
      y += o.dy;
      if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) {
        cv.g[y][x] = "D";
        placed++;
        break;
      }
      const c = cv.get(x, y);
      if (c === "#" || c === "t" || c === "c") cv.set(x, y, " ");
    }
  }
  if (placed < 2) return null;

  // Barricades on narrow chokepoints, only where they don't cut anything off.
  reach = flood(cv, sx, sy, isOpenChar);
  const want = ri(r, 3, 7);
  let made = 0;
  for (let tries = 0; tries < 400 && made < want; tries++) {
    const x = ri(r, 2, W - 3);
    const y = ri(r, 2, H - 3);
    if (cv.get(x, y) !== " ") continue;
    const horizGap = cv.get(x - 1, y) === "#" && cv.get(x + 1, y) === "#" && cv.open(x, y - 1) && cv.open(x, y + 1);
    const vertGap = cv.get(x, y - 1) === "#" && cv.get(x, y + 1) === "#" && cv.open(x - 1, y) && cv.open(x + 1, y);
    if (!horizGap && !vertGap) continue;
    cv.set(x, y, "=");
    const check = flood(cv, sx, sy, isOpenChar);
    let ok = true;
    for (let j = 0; j < H && ok; j++)
      for (let i = 0; i < W; i++) {
        const c = cv.g[j][i];
        if ((c === "O" || c === "X") && check[j * W + i] < 0) {
          ok = false;
          break;
        }
      }
    if (ok) made++;
    else cv.set(x, y, " ");
  }

  const name = `${pickR(r, ADJ)} ${pickR(r, NOUN[theme])}`;
  const area = W * H;
  return {
    id: `outbreak-${displaySeed}-${size}`,
    name,
    mode: "outbreak",
    theme,
    blurb: `Procedural ${theme} · seed ${displaySeed}`,
    darkness: outdoor ? 0.6 : 0.78,
    objectiveLabel: OBJ[theme],
    parTime: Math.round(area / 12 + obj * 25),
    hordeInterval: size === "small" ? 80 : 70,
    roamers: Math.round(area / 110),
    raw: cv.toString(),
  };
}

export function dailySeed(date = new Date()): number {
  const key = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
  return hashString(key) % 1000000;
}
