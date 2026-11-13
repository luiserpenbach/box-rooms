/** Uniform-grid spatial hash for fast neighbour queries. */
export class SpatialHash<T extends { x: number; y: number }> {
  private cells = new Map<number, T[]>();
  constructor(private cell = 64) {}

  private key(cx: number, cy: number): number {
    return (cx + 1024) * 4096 + (cy + 1024);
  }

  build(items: readonly T[]): void {
    this.cells.clear();
    for (const it of items) {
      const k = this.key(Math.floor(it.x / this.cell), Math.floor(it.y / this.cell));
      let arr = this.cells.get(k);
      if (!arr) {
        arr = [];
        this.cells.set(k, arr);
      }
      arr.push(it);
    }
  }

  query(x: number, y: number, r: number, out: T[] = []): T[] {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c);
    const y1 = Math.floor((y + r) / c);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.cells.get(this.key(cx, cy));
        if (arr) for (const it of arr) out.push(it);
      }
    }
    return out;
  }
}
