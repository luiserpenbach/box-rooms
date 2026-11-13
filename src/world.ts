import { type Vec, clamp } from "./math";
import { type GameMap, T_BARRICADE, T_CRATE, T_FLOOR, T_TREE, T_WALL } from "./maps/types";

const SQRT2 = Math.SQRT2;
const NEIGH: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];
/** Extra path cost for walking "through" a barricade (zombies must smash it). */
const BARRICADE_COST = 7;

class MinHeap {
  private idx: number[] = [];
  private pri: number[] = [];
  get size(): number {
    return this.idx.length;
  }
  push(i: number, p: number): void {
    const a = this.idx;
    const b = this.pri;
    a.push(i);
    b.push(p);
    let n = a.length - 1;
    while (n > 0) {
      const parent = (n - 1) >> 1;
      if (b[parent] <= b[n]) break;
      [a[parent], a[n]] = [a[n], a[parent]];
      [b[parent], b[n]] = [b[n], b[parent]];
      n = parent;
    }
  }
  pop(): number {
    const a = this.idx;
    const b = this.pri;
    const top = a[0];
    const li = a.pop()!;
    const lp = b.pop()!;
    if (a.length) {
      a[0] = li;
      b[0] = lp;
      let n = 0;
      for (;;) {
        const l = n * 2 + 1;
        const r = l + 1;
        let m = n;
        if (l < a.length && b[l] < b[m]) m = l;
        if (r < a.length && b[r] < b[m]) m = r;
        if (m === n) break;
        [a[m], a[n]] = [a[n], a[m]];
        [b[m], b[n]] = [b[n], b[m]];
        n = m;
      }
    }
    return top;
  }
}

export class World {
  readonly map: GameMap;
  readonly cols: number;
  readonly rows: number;
  readonly tile: number;
  readonly grid: Uint8Array;
  /** Barricade hit points keyed by tile index. */
  readonly barricadeHp = new Map<number, number>();
  /** Max hp for barricade (player-built ones are sturdier). */
  readonly barricadeMax = new Map<number, number>();
  /** Flow field toward the nearest living player (in tiles, weighted). */
  flow: Float32Array;
  /** Bumped whenever the walkable layout changes (barricade broken / built). */
  layoutVersion = 0;
  /** Tiles explored by players (for fog + minimap). */
  explored: Uint8Array;

  constructor(map: GameMap) {
    this.map = map;
    this.cols = map.cols;
    this.rows = map.rows;
    this.tile = map.tile;
    this.grid = map.grid;
    this.flow = new Float32Array(this.cols * this.rows).fill(Infinity);
    this.explored = new Uint8Array(this.cols * this.rows);
    for (const b of map.barricades) {
      const i = b.ty * this.cols + b.tx;
      this.barricadeHp.set(i, 160);
      this.barricadeMax.set(i, 160);
    }
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
  }

  at(tx: number, ty: number): number {
    if (!this.inBounds(tx, ty)) return T_WALL;
    return this.grid[ty * this.cols + tx];
  }

  tileOf(x: number, y: number): [number, number] {
    return [Math.floor(x / this.tile), Math.floor(y / this.tile)];
  }

  indexOf(x: number, y: number): number {
    const tx = clamp(Math.floor(x / this.tile), 0, this.cols - 1);
    const ty = clamp(Math.floor(y / this.tile), 0, this.rows - 1);
    return ty * this.cols + tx;
  }

  center(i: number): Vec {
    const tx = i % this.cols;
    const ty = (i / this.cols) | 0;
    return { x: tx * this.tile + this.tile / 2, y: ty * this.tile + this.tile / 2 };
  }

  solid(tx: number, ty: number): boolean {
    return this.at(tx, ty) !== T_FLOOR;
  }

  /** Bullets are stopped by everything solid. */
  blocksShot(tx: number, ty: number): boolean {
    return this.at(tx, ty) !== T_FLOOR;
  }

  /** Sight passes over crates and between barricade boards. */
  blocksSight(tx: number, ty: number): boolean {
    const t = this.at(tx, ty);
    return t === T_WALL || t === T_TREE;
  }

  walkableForPath(t: number): boolean {
    return t === T_FLOOR || t === T_BARRICADE;
  }

  /** Circle vs solid tiles. */
  circleHitsSolid(x: number, y: number, r: number): boolean {
    const t = this.tile;
    const x0 = Math.floor((x - r) / t);
    const x1 = Math.floor((x + r) / t);
    const y0 = Math.floor((y - r) / t);
    const y1 = Math.floor((y + r) / t);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.solid(tx, ty)) continue;
        const nx = clamp(x, tx * t, tx * t + t);
        const ny = clamp(y, ty * t, ty * t + t);
        const dx = x - nx;
        const dy = y - ny;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }

  /** Point vs shot-blocking tile, returns tile index or -1. */
  shotTileAt(x: number, y: number): number {
    const [tx, ty] = this.tileOf(x, y);
    if (!this.inBounds(tx, ty)) return -2;
    return this.blocksShot(tx, ty) ? ty * this.cols + tx : -1;
  }

  /**
   * Push a circle out of solid tiles. Returns the index of a barricade that was
   * touched (or -1) so callers can let zombies attack it.
   */
  resolveCircle(p: { x: number; y: number; r: number }): number {
    const t = this.tile;
    let touchedBarricade = -1;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const x0 = Math.floor((p.x - p.r) / t);
      const x1 = Math.floor((p.x + p.r) / t);
      const y0 = Math.floor((p.y - p.r) / t);
      const y1 = Math.floor((p.y + p.r) / t);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const code = this.at(tx, ty);
          if (code === T_FLOOR) continue;
          const bx = tx * t;
          const by = ty * t;
          const nx = clamp(p.x, bx, bx + t);
          const ny = clamp(p.y, by, by + t);
          let dx = p.x - nx;
          let dy = p.y - ny;
          const d2 = dx * dx + dy * dy;
          if (d2 >= p.r * p.r) continue;
          if (code === T_BARRICADE && this.inBounds(tx, ty)) touchedBarricade = ty * this.cols + tx;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = (p.r - d) / d;
            p.x += dx * push;
            p.y += dy * push;
          } else {
            // Centre inside the tile: push out along the shallowest axis.
            const left = p.x - bx;
            const right = bx + t - p.x;
            const top = p.y - by;
            const bot = by + t - p.y;
            const m = Math.min(left, right, top, bot);
            if (m === left) p.x = bx - p.r;
            else if (m === right) p.x = bx + t + p.r;
            else if (m === top) p.y = by - p.r;
            else p.y = by + t + p.r;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    p.x = clamp(p.x, p.r, this.map.width - p.r);
    p.y = clamp(p.y, p.r, this.map.height - p.r);
    return touchedBarricade;
  }

  /** Grid ray-march (Amanatides–Woo). */
  private march(x0: number, y0: number, x1: number, y1: number, blocks: (tx: number, ty: number) => boolean): boolean {
    const t = this.tile;
    let tx = Math.floor(x0 / t);
    let ty = Math.floor(y0 / t);
    const ex = Math.floor(x1 / t);
    const ey = Math.floor(y1 / t);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const sx = dx > 0 ? 1 : -1;
    const sy = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(t / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(t / dy) : Infinity;
    let tmx = dx !== 0 ? ((sx > 0 ? (tx + 1) * t - x0 : x0 - tx * t) / Math.abs(dx)) : Infinity;
    let tmy = dy !== 0 ? ((sy > 0 ? (ty + 1) * t - y0 : y0 - ty * t) / Math.abs(dy)) : Infinity;
    let guard = 0;
    while ((tx !== ex || ty !== ey) && guard++ < 512) {
      if (tmx < tmy) {
        tmx += tdx;
        tx += sx;
      } else {
        tmy += tdy;
        ty += sy;
      }
      if ((tx !== ex || ty !== ey) && blocks(tx, ty)) return false;
    }
    return true;
  }

  los(x0: number, y0: number, x1: number, y1: number): boolean {
    return this.march(x0, y0, x1, y1, (tx, ty) => this.blocksSight(tx, ty));
  }

  /** Can a circle of radius r travel in a straight line between the points? */
  clearPath(x0: number, y0: number, x1: number, y1: number, r: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    const steps = Math.ceil(d / 10);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      if (this.circleHitsSolid(x0 + dx * k, y0 + dy * k, r * 0.9)) return false;
    }
    return true;
  }

  private canStep(x: number, y: number, dx: number, dy: number, allowBarricade: boolean): boolean {
    const nx = x + dx;
    const ny = y + dy;
    if (!this.inBounds(nx, ny)) return false;
    const t = this.grid[ny * this.cols + nx];
    if (!(t === T_FLOOR || (allowBarricade && t === T_BARRICADE))) return false;
    if (dx !== 0 && dy !== 0) {
      // No corner cutting.
      if (this.solid(x + dx, y) || this.solid(x, y + dy)) return false;
    }
    return true;
  }

  /** Multi-source Dijkstra from the given points. */
  computeFlow(sources: Vec[]): void {
    const dist = this.flow;
    dist.fill(Infinity);
    const heap = new MinHeap();
    for (const s of sources) {
      const i = this.indexOf(s.x, s.y);
      dist[i] = 0;
      heap.push(i, 0);
    }
    const cols = this.cols;
    while (heap.size) {
      const i = heap.pop();
      const d = dist[i];
      const x = i % cols;
      const y = (i / cols) | 0;
      for (const [dx, dy, c] of NEIGH) {
        if (!this.canStep(x, y, dx, dy, true)) continue;
        const j = (y + dy) * cols + x + dx;
        // Leaving a barricade tile toward the target is the expensive part.
        const extra = this.grid[i] === T_BARRICADE ? BARRICADE_COST : 0;
        const nd = d + c + extra;
        if (nd < dist[j]) {
          dist[j] = nd;
          heap.push(j, nd);
        }
      }
    }
  }

  /**
   * Direction to descend the flow field from a world position.
   * Returns null when no better neighbour exists (at target / unreachable).
   */
  flowDir(x: number, y: number): Vec | null {
    const cols = this.cols;
    const i = this.indexOf(x, y);
    const tx = i % cols;
    const ty = (i / cols) | 0;
    let best = this.flow[i];
    let bi = -1;
    for (const [dx, dy] of NEIGH) {
      if (!this.canStep(tx, ty, dx, dy, true)) continue;
      const j = (ty + dy) * cols + tx + dx;
      if (this.flow[j] < best) {
        best = this.flow[j];
        bi = j;
      }
    }
    if (bi < 0) return null;
    const c = this.center(bi);
    const vx = c.x - x;
    const vy = c.y - y;
    const l = Math.hypot(vx, vy) || 1;
    return { x: vx / l, y: vy / l };
  }

  flowAt(x: number, y: number): number {
    return this.flow[this.indexOf(x, y)];
  }

  /** A* on the tile grid. Returns waypoint centres (excluding the start tile). */
  findPath(from: Vec, to: Vec, maxExpand = 2500): Vec[] | null {
    const cols = this.cols;
    const start = this.indexOf(from.x, from.y);
    let goal = this.indexOf(to.x, to.y);
    if (!this.walkableForPath(this.grid[goal])) {
      goal = this.nearestOpen(goal);
      if (goal < 0) return null;
    }
    if (start === goal) return [];
    const gx = goal % cols;
    const gy = (goal / cols) | 0;
    const h = (i: number) => {
      const dx = Math.abs((i % cols) - gx);
      const dy = Math.abs(((i / cols) | 0) - gy);
      return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
    };
    const g = new Map<number, number>([[start, 0]]);
    const came = new Map<number, number>();
    const heap = new MinHeap();
    heap.push(start, h(start));
    let expanded = 0;
    while (heap.size) {
      const i = heap.pop();
      if (i === goal) break;
      if (++expanded > maxExpand) return null;
      const x = i % cols;
      const y = (i / cols) | 0;
      const gi = g.get(i)!;
      for (const [dx, dy, c] of NEIGH) {
        if (!this.canStep(x, y, dx, dy, true)) continue;
        const j = (y + dy) * cols + x + dx;
        const extra = this.grid[j] === T_BARRICADE ? BARRICADE_COST : 0;
        const ng = gi + c + extra;
        if (ng < (g.get(j) ?? Infinity)) {
          g.set(j, ng);
          came.set(j, i);
          heap.push(j, ng + h(j));
        }
      }
    }
    if (!came.has(goal)) return null;
    const out: Vec[] = [];
    let cur = goal;
    while (cur !== start) {
      out.push(this.center(cur));
      cur = came.get(cur)!;
    }
    out.reverse();
    return out;
  }

  nearestOpen(i: number, maxR = 6): number {
    const cols = this.cols;
    const x = i % cols;
    const y = (i / cols) | 0;
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.at(x + dx, y + dy) === T_FLOOR) return (y + dy) * cols + x + dx;
        }
      }
    }
    return -1;
  }

  randomOpenNear(x: number, y: number, radiusTiles: number, rnd = Math.random): Vec | null {
    const [cx, cy] = this.tileOf(x, y);
    for (let tries = 0; tries < 16; tries++) {
      const tx = cx + Math.round((rnd() * 2 - 1) * radiusTiles);
      const ty = cy + Math.round((rnd() * 2 - 1) * radiusTiles);
      if (this.at(tx, ty) === T_FLOOR) return this.center(ty * this.cols + tx);
    }
    return null;
  }

  damageBarricade(i: number, dmg: number): boolean {
    const hp = this.barricadeHp.get(i);
    if (hp === undefined) return false;
    const n = hp - dmg;
    if (n <= 0) {
      this.barricadeHp.delete(i);
      this.barricadeMax.delete(i);
      this.grid[i] = T_FLOOR;
      this.layoutVersion++;
      return true;
    }
    this.barricadeHp.set(i, n);
    return false;
  }

  buildBarricade(i: number, hp: number): void {
    this.grid[i] = T_BARRICADE;
    this.barricadeHp.set(i, hp);
    this.barricadeMax.set(i, hp);
    this.layoutVersion++;
  }

  isCrate(tx: number, ty: number): boolean {
    return this.at(tx, ty) === T_CRATE;
  }
}
