import { type Actor, type Game, type Placeable } from "./game";
import { type GameMap } from "./maps";
import { shade } from "./math";

const VIEW_W = 1100;
const VIEW_H = 720;

export function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function drawGame(
  ctx: CanvasRenderingContext2D,
  game: Game,
  w: number,
  h: number,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#8f8f8f";
  ctx.fillRect(0, 0, w, h);
  const scale = Math.max(w / VIEW_W, h / VIEW_H);
  const shx = (Math.random() - 0.5) * game.shake * 2;
  const shy = (Math.random() - 0.5) * game.shake * 2;
  ctx.setTransform(
    dpr * scale,
    0,
    0,
    dpr * scale,
    dpr * (w / 2 - game.cam.x * scale + shx),
    dpr * (h / 2 - game.cam.y * scale + shy),
  );

  drawFloor(ctx, game.map);
  drawBlood(ctx, game);
  drawSpawns(ctx, game);
  drawWalls(ctx, game.map);
  for (const pl of game.places) drawPlace(ctx, pl, game);
  for (const pk of game.pickups) drawPackage(ctx, pk.x, pk.y, performance.now() / 1000);
  const actors = [...game.enemies, ...game.livingPlayers()].sort((a, b) => a.y - b.y);
  for (const a of actors) drawActor(ctx, a);
  for (const b of game.bullets) drawBullet(ctx, b);
  for (const p of game.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.globalAlpha = 1;
  }
}

function drawFloor(ctx: CanvasRenderingContext2D, map: GameMap): void {
  ctx.fillStyle = "#d6d6d6";
  ctx.fillRect(0, 0, map.width, map.height);
  ctx.strokeStyle = "#c4c4c4";
  ctx.lineWidth = 1;
  for (let x = 0; x <= map.width; x += map.tile) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, map.height);
    ctx.stroke();
  }
  for (let y = 0; y <= map.height; y += map.tile) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(map.width, y);
    ctx.stroke();
  }
}

function drawBlood(ctx: CanvasRenderingContext2D, game: Game): void {
  for (const b of game.blood) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);
    ctx.globalAlpha = Math.max(0, b.a);
    ctx.fillStyle = "#9a1818";
    ctx.beginPath();
    ctx.ellipse(0, 0, b.s, b.s * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawSpawns(ctx: CanvasRenderingContext2D, game: Game): void {
  const glow = game.phase === "prep" || game.toSpawnZ > 0 || game.toSpawnD > 0;
  if (!glow) return;
  for (const s of game.map.spawns) {
    ctx.fillStyle = game.phase === "prep" ? "rgba(180,140,40,0.28)" : "rgba(180,40,40,0.22)";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = game.phase === "prep" ? "#e2b039" : "#d4453a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x - s.inY * 10, s.y + s.inX * 10);
    ctx.lineTo(s.x + s.inX * 16, s.y + s.inY * 16);
    ctx.lineTo(s.x + s.inY * 10, s.y - s.inX * 10);
    ctx.stroke();
  }
}

function drawWalls(ctx: CanvasRenderingContext2D, map: GameMap): void {
  for (const w of map.walls) drawBoxRect(ctx, w.x, w.y, w.w, w.h, 16, "#9c9c9c");
}

function drawBoxRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lift: number,
  color: string,
): void {
  ctx.fillStyle = shade(color, 0.45);
  ctx.fillRect(x + 4, y + 4, w, h);
  ctx.fillStyle = shade(color, 0.7);
  ctx.fillRect(x, y + h - lift, w, lift);
  ctx.fillStyle = shade(color, 0.55);
  ctx.fillRect(x + w - 6, y, 6, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y - lift, w, h);
  ctx.strokeStyle = shade(color, 1.15);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y - lift + 0.5, w - 1, h - 1);
}

function drawActor(ctx: CanvasRenderingContext2D, a: Actor): void {
  const lift = a.kind === "devil" ? 16 : a.kind === "player" ? 14 : 11;
  const s = a.r * 2;
  const color = a.hurt > 0 && a.kind !== "player" ? "#f4f4f4" : a.hurt > 0.3 ? shade(a.color, 1.4) : a.color;
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(a.x, a.y + 6, a.r * 0.95, a.r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  const topX = a.x - a.r;
  const topY = a.y - a.r - lift;
  ctx.fillStyle = shade(color, 0.72);
  ctx.fillRect(topX, a.y - 2, s, lift + 2);
  ctx.fillStyle = shade(color, 0.55);
  ctx.fillRect(a.x + a.r - 4, topY + 6, 7, s + lift - 6);
  ctx.fillStyle = color;
  ctx.fillRect(topX, topY, s, s);
  ctx.strokeStyle = shade(color, 1.12);
  ctx.lineWidth = 1;
  ctx.strokeRect(topX + 0.5, topY + 0.5, s - 1, s - 1);

  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(a.x + a.dirX * a.r * 0.42 - 3, topY + a.r + a.dirY * a.r * 0.42 - 3, 6, 6);

  if (a.kind === "devil") {
    ctx.fillStyle = shade(color, 0.8);
    ctx.fillRect(topX - 2, topY - 8, 6, 10);
    ctx.fillRect(topX + s - 4, topY - 8, 6, 10);
  }
  if (a.kind === "player") {
    ctx.fillStyle = shade(color, 1.15);
    ctx.fillRect(topX + 3, topY + 3, s - 6, 5);
    drawWeapon(ctx, a, topY);
  } else {
    drawArms(ctx, a, topY);
  }
  if (a.kind !== "zombie") {
    const ratio = clamp01(a.hp / a.maxHp);
    ctx.fillStyle = "#0006";
    ctx.fillRect(a.x - 14, topY - 8, 28, 4);
    ctx.fillStyle = ratio > 0.35 ? "#3aaa5a" : "#d4453a";
    ctx.fillRect(a.x - 14, topY - 8, 28 * ratio, 4);
  }
}

function drawArms(ctx: CanvasRenderingContext2D, a: Actor, topY: number): void {
  const swing = a.attackAnim;
  const reach = 7 + Math.max(0, swing) * 11;
  const back = Math.min(0, swing) * 8;
  for (const side of [-1, 1]) {
    const px = -a.dirY * side * (a.r * 0.85);
    const py = a.dirX * side * (a.r * 0.85);
    const fx = a.x + px + a.dirX * (reach + back);
    const fy = topY + a.r + py + a.dirY * (reach + back);
    ctx.fillStyle = shade(a.color, 0.62);
    ctx.fillRect(fx - 3.5, fy - 3.5, 7, 7);
    ctx.strokeStyle = shade(a.color, 0.4);
    ctx.strokeRect(fx - 3.5, fy - 3.5, 7, 7);
  }
}

function drawWeapon(ctx: CanvasRenderingContext2D, a: Actor, topY: number): void {
  const id = a.weapon ?? "pistol";
  const kick = a.fireAnim * 7;
  const ox = a.x + a.dirX * (a.r + 10 - kick);
  const oy = topY + a.r + a.dirY * (a.r + 10 - kick);
  const ang = Math.atan2(a.dirY, a.dirX);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(ang);
  ctx.lineCap = "square";
  ctx.strokeStyle = "#222";
  ctx.fillStyle = "#2b2b2b";
  if (id === "pistol") {
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(14, 0);
    ctx.stroke();
    ctx.fillRect(-2, 1, 5, 6);
  } else if (id === "uzi") {
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(18, 0);
    ctx.stroke();
    ctx.fillRect(-4, 1, 8, 7);
    ctx.fillRect(6, -3, 8, 3);
  } else if (id === "shotgun") {
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(22, 0);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, 4);
    ctx.lineTo(18, 4);
    ctx.stroke();
  } else if (id === "grenade") {
    ctx.strokeStyle = "#1d3a1d";
    ctx.lineWidth = 5;
    ctx.strokeRect(-5, -5, 10, 10);
  } else if (id === "barrel") {
    ctx.fillStyle = "#8a2a1a";
    ctx.fillRect(-6, -8, 12, 16);
    ctx.fillStyle = "#c9a227";
    ctx.fillRect(-6, -8, 12, 3);
  } else if (id === "claymore") {
    ctx.fillStyle = "#3a3a32";
    ctx.beginPath();
    ctx.moveTo(-6, -6);
    ctx.lineTo(10, 0);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(6, -5, 3, 10);
  } else if (id === "wall") {
    ctx.fillStyle = "#8a8a8a";
    ctx.fillRect(-4, -10, 8, 20);
  } else if (id === "rocket") {
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(20, 0);
    ctx.stroke();
    ctx.fillStyle = "#b03a2e";
    ctx.fillRect(14, -4, 8, 8);
  } else if (id === "railgun") {
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(26, 0);
    ctx.stroke();
    ctx.strokeStyle = "#1a4a6a";
    ctx.beginPath();
    ctx.moveTo(-6, -4);
    ctx.lineTo(22, -4);
    ctx.stroke();
  }
  if (a.fireAnim > 0.4 && !WEAPON_PLACE.has(id)) {
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(22 + a.fireAnim * 10, 0);
    ctx.stroke();
  }
  ctx.restore();
}

const WEAPON_PLACE = new Set(["barrel", "claymore", "wall", "grenade"]);

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function drawBullet(
  ctx: CanvasRenderingContext2D,
  b: { x: number; y: number; px: number; py: number; vx: number; vy: number; r: number; kind: string; streak: number },
): void {
  if (b.kind === "fireball") {
    ctx.strokeStyle = "#c44a12";
    ctx.lineWidth = 6;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(b.px, b.py);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = "#ff7a2a";
    ctx.fillRect(b.x - 5, b.y - 5, 10, 10);
    ctx.fillStyle = "#ffe08a";
    ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
    return;
  }
  if (b.kind === "grenade") {
    ctx.strokeStyle = "#1d3a1d";
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x - 5, b.y - 5, 10, 10);
    ctx.fillStyle = "#2d4a2d";
    ctx.fillRect(b.x - 4, b.y - 4, 8, 8);
    return;
  }
  if (b.kind === "rocket") {
    const a = Math.atan2(b.vy, b.vx);
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 4;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(b.x - nx * 16, b.y - ny * 16);
    ctx.lineTo(b.x + nx * 10, b.y + ny * 10);
    ctx.stroke();
    ctx.strokeStyle = "#b03a2e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(b.x + nx * 6, b.y + ny * 6);
    ctx.lineTo(b.x + nx * 12, b.y + ny * 12);
    ctx.stroke();
    return;
  }
  if (b.kind === "rail") {
    ctx.strokeStyle = "#1a3a52";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.px, b.py);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = "#d8eefc";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(b.px, b.py);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    return;
  }
  const spd = Math.hypot(b.vx, b.vy) || 1;
  const nx = b.vx / spd;
  const ny = b.vy / spd;
  const L = b.streak || 18;
  ctx.lineCap = "butt";
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = b.kind === "pellet" ? 2 : 3;
  ctx.beginPath();
  ctx.moveTo(b.x - nx * L, b.y - ny * L);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.strokeStyle = "#f2d24a";
  ctx.lineWidth = b.kind === "pellet" ? 1 : 1.5;
  ctx.beginPath();
  ctx.moveTo(b.x - nx * (L * 0.7), b.y - ny * (L * 0.7));
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawPlace(ctx: CanvasRenderingContext2D, pl: Placeable, game: Game): void {
  if (pl.kind === "barrel") {
    drawCube(ctx, pl.x, pl.y, 12, 14, "#8a2a1a");
    ctx.fillStyle = "#e2b039";
    ctx.fillRect(pl.x - 6, pl.y - 22, 12, 3);
  } else if (pl.kind === "claymore") {
    ctx.fillStyle = "#4a4a3a";
    ctx.save();
    ctx.translate(pl.x, pl.y);
    ctx.rotate(Math.atan2(pl.dirY, pl.dirX));
    ctx.fillRect(-8, -6, 16, 12);
    ctx.fillStyle = "#d4453a";
    ctx.fillRect(4, -6, 4, 12);
    ctx.restore();
  } else {
    const r = game.wallRect(pl);
    drawBoxRect(ctx, r.x, r.y, r.w, r.h, 10, "#8e8e8e");
  }
}

function drawCube(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lift: number, color: string): void {
  const s = r * 2;
  ctx.fillStyle = shade(color, 0.5);
  ctx.fillRect(x - r + 3, y - r + 3, s, s);
  ctx.fillStyle = shade(color, 0.7);
  ctx.fillRect(x - r, y - 2, s, lift);
  ctx.fillStyle = color;
  ctx.fillRect(x - r, y - r - lift, s, s);
}

function drawPackage(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const bob = Math.sin(t * 6) * 3;
  drawCube(ctx, x, y + bob, 11, 10, "#c62828");
  ctx.strokeStyle = "#e2b039";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 16 + bob);
  ctx.lineTo(x + 6, y - 16 + bob);
  ctx.moveTo(x, y - 22 + bob);
  ctx.lineTo(x, y - 10 + bob);
  ctx.stroke();
}

export function drawMapPreview(canvas: HTMLCanvasElement, map: GameMap): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = 2;
  canvas.width = 320 * dpr;
  canvas.height = 180 * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sx = 320 / map.width;
  const sy = 180 / map.height;
  const s = Math.min(sx, sy);
  ctx.fillStyle = "#bdbdbd";
  ctx.fillRect(0, 0, 320, 180);
  ctx.save();
  ctx.translate((320 - map.width * s) / 2, (180 - map.height * s) / 2);
  ctx.scale(s, s);
  ctx.fillStyle = "#d6d6d6";
  ctx.fillRect(0, 0, map.width, map.height);
  ctx.fillStyle = "#9c9c9c";
  for (const w of map.walls) ctx.fillRect(w.x, w.y, w.w, w.h);
  ctx.fillStyle = "#c0392b";
  for (const sp of map.spawns) {
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#3d8ec8";
  for (const p of map.starts) ctx.fillRect(p.x - 10, p.y - 10, 20, 20);
  ctx.restore();
}
