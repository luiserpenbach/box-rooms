import type { World } from "./world";

/**
 * Cast `rays` rays from (x,y) through the tile grid and return the visibility
 * polygon as a flat [x0,y0,x1,y1,...] array. Marks traversed tiles as explored.
 */
export function computeVision(world: World, x: number, y: number, radius: number, rays: number, mark = true): Float32Array {
  const out = new Float32Array(rays * 2);
  const t = world.tile;
  const cols = world.cols;
  const explored = world.explored;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let tx = Math.floor(x / t);
    let ty = Math.floor(y / t);
    const sx = dx > 0 ? 1 : -1;
    const sy = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(t / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(t / dy) : Infinity;
    let tmx = dx !== 0 ? (sx > 0 ? (tx + 1) * t - x : x - tx * t) / Math.abs(dx) : Infinity;
    let tmy = dy !== 0 ? (sy > 0 ? (ty + 1) * t - y : y - ty * t) / Math.abs(dy) : Infinity;
    let dist = radius;
    if (mark && world.inBounds(tx, ty)) explored[ty * cols + tx] = 1;
    for (let guard = 0; guard < 128; guard++) {
      let d: number;
      if (tmx < tmy) {
        d = tmx;
        tmx += tdx;
        tx += sx;
      } else {
        d = tmy;
        tmy += tdy;
        ty += sy;
      }
      if (d > radius) break;
      if (!world.inBounds(tx, ty)) {
        dist = d;
        break;
      }
      if (mark) explored[ty * cols + tx] = 1;
      if (world.blocksSight(tx, ty)) {
        // Extend slightly into the wall so its face is lit.
        dist = Math.min(radius, d + t * 0.55);
        break;
      }
    }
    out[i * 2] = x + dx * dist;
    out[i * 2 + 1] = y + dy * dist;
  }
  return out;
}
