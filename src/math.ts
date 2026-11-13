export type Vec = { x: number; y: number };

export const TAU = Math.PI * 2;
export const DIR8 = Math.PI / 4;

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

export function len(x: number, y: number): number {
  return Math.hypot(x, y);
}

export function norm(x: number, y: number): Vec {
  const l = Math.hypot(x, y);
  if (l < 1e-6) return { x: 0, y: 0 };
  return { x: x / l, y: y / l };
}

export function snap8(x: number, y: number): Vec {
  if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return { x: 0, y: 0 };
  const a = Math.round(Math.atan2(y, x) / DIR8) * DIR8;
  return { x: Math.cos(a), y: Math.sin(a) };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function pick<T>(arr: T[]): T {
  return arr[(Math.random() * arr.length) | 0];
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) * amt, 0, 255) | 0;
  const g = clamp(((n >> 8) & 255) * amt, 0, 255) | 0;
  const b = clamp((n & 255) * amt, 0, 255) | 0;
  return `rgb(${r},${g},${b})`;
}

export type Rect = { x: number; y: number; w: number; h: number };

export function circleRect(cx: number, cy: number, r: number, b: Rect): boolean {
  const nx = clamp(cx, b.x, b.x + b.w);
  const ny = clamp(cy, b.y, b.y + b.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export function resolveCircleRect(
  cx: number,
  cy: number,
  r: number,
  b: Rect,
): Vec | null {
  const nx = clamp(cx, b.x, b.x + b.w);
  const ny = clamp(cy, b.y, b.y + b.h);
  let dx = cx - nx;
  let dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r || d2 === 0) {
    if (cx > b.x && cx < b.x + b.w && cy > b.y && cy < b.y + b.h) {
      const left = cx - b.x;
      const right = b.x + b.w - cx;
      const top = cy - b.y;
      const bot = b.y + b.h - cy;
      const m = Math.min(left, right, top, bot);
      if (m === left) return { x: b.x - r, y: cy };
      if (m === right) return { x: b.x + b.w + r, y: cy };
      if (m === top) return { x: cx, y: b.y - r };
      return { x: cx, y: b.y + b.h + r };
    }
    return null;
  }
  const d = Math.sqrt(d2);
  const push = (r - d) / d;
  return { x: cx + dx * push, y: cy + dy * push };
}

/** Deterministic PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}
