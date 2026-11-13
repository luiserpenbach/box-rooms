import type { Actor, Bullet, Hazard, Pickup, Placeable } from "./entities";
import type { Game } from "./game";
import { THEMES, type Theme } from "./maps/themes";
import { type GameMap, T_BARRICADE, T_CRATE, T_FLOOR, T_TREE, T_WALL } from "./maps/types";
import { clamp, len, shade } from "./math";
import { WEAPON_BY_ID } from "./weapons";
import { ZOMBIES } from "./zombies";

/** World pixels visible on screen ≈ this area (keeps framing consistent across aspect ratios). */
const VIEW_AREA = 1040 * 640;

export function viewScale(w: number, h: number): number {
  return clamp(Math.sqrt((w * h) / VIEW_AREA), 0.45, 3);
}

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

type Drawable = { y: number; draw: () => void };

export class Renderer {
  private fog = document.createElement("canvas");
  private fctx = this.fog.getContext("2d")!;
  private mask = document.createElement("canvas");
  private mctx = this.mask.getContext("2d")!;
  private maskImg: ImageData | null = null;
  private maskFrame = 0;
  private minimapFrame = 0;
  private theme: Theme = THEMES.concrete;
  private game: Game | null = null;
  /** world→screen scale (css px per world px), set every frame */
  S = 1;
  ox = 0;
  oy = 0;

  screenToWorld(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.ox) / this.S, y: (y - this.oy) / this.S };
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return { x: x * this.S + this.ox, y: y * this.S + this.oy };
  }

  private bind(game: Game): void {
    if (this.game === game) return;
    this.game = game;
    this.theme = THEMES[game.map.theme];
    this.mask.width = game.map.cols;
    this.mask.height = game.map.rows;
    this.maskImg = this.mctx.createImageData(game.map.cols, game.map.rows);
  }

  draw(ctx: CanvasRenderingContext2D, game: Game, w: number, h: number, dpr: number, now: number): void {
    this.bind(game);
    const th = this.theme;
    const base = viewScale(w, h);
    game.viewW = w / base;
    game.viewH = h / base;
    const S = base * game.cam.zoom;
    const shx = (Math.random() - 0.5) * game.shake * 2;
    const shy = (Math.random() - 0.5) * game.shake * 2;
    this.S = S;
    this.ox = w / 2 - game.cam.x * S + shx;
    this.oy = h / 2 - game.cam.y * S + shy;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = th.backdrop;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * S, 0, 0, dpr * S, dpr * this.ox, dpr * this.oy);

    const vx0 = game.cam.x - w / 2 / S - 64;
    const vx1 = game.cam.x + w / 2 / S + 64;
    const vy0 = game.cam.y - h / 2 / S - 64;
    const vy1 = game.cam.y + h / 2 / S + 96;
    const inView = (x: number, y: number, m = 0) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;

    this.drawFloor(ctx, game.map, vx0, vy0, vx1, vy1);
    this.drawDoors(ctx, game, now);
    if (game.map.extraction.length) this.drawExtraction(ctx, game, now);
    for (const h of game.hazards) if (inView(h.x, h.y, h.r)) drawHazard(ctx, h, now);
    drawBlood(ctx, game, inView, th);
    for (const c of game.corpses) {
      if (!inView(c.x, c.y)) continue;
      ctx.globalAlpha = Math.min(1, c.life / 4) * 0.9;
      drawCorpse(ctx, c.x, c.y, c.size, c.color, c.rot);
    }
    ctx.globalAlpha = 1;
    drawTelegraphsGround(ctx, game);

    // Y-sorted scene: walls, props, actors.
    const list: Drawable[] = [];
    this.collectTiles(ctx, list, game, vx0, vy0, vx1, vy1, now);
    for (const pl of game.places) if (inView(pl.x, pl.y)) list.push({ y: pl.y, draw: () => drawPlace(ctx, pl) });
    for (const pk of game.pickups) if (inView(pk.x, pk.y)) list.push({ y: pk.y, draw: () => drawPickup(ctx, pk, now, game) });
    for (const e of game.enemies) {
      if (!inView(e.x, e.y) || e.seen <= 0.01) continue;
      list.push({ y: e.y, draw: () => drawZombie(ctx, e, now) });
    }
    for (const p of game.livingPlayers()) list.push({ y: p.y, draw: () => drawPlayer(ctx, p, now) });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();

    for (const b of game.bullets) if (inView(b.x, b.y, 200)) drawBullet(ctx, b);
    for (const p of game.particles) {
      if (!inView(p.x, p.y)) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, (p.life / p.max) * 1.6));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2 - p.z, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const r of game.rings) {
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = Math.max(0, r.life / r.max);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (game.darkness > 0) this.drawFog(ctx, game, w, h, dpr, S);

    ctx.setTransform(dpr * S, 0, 0, dpr * S, dpr * this.ox, dpr * this.oy);
    drawOverlays(ctx, game, now);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawIndicators(ctx, game, w, h, now);
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(160,0,0,${Math.min(0.35, game.flash * 0.3)})`;
      ctx.fillRect(0, 0, w, h);
    }
    const p = game.activePlayers()[0];
    const low = p ? 1 - p.hp / p.maxHp : 0;
    if (low > 0.55) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
      g.addColorStop(0, "rgba(120,0,0,0)");
      g.addColorStop(1, `rgba(120,0,0,${(low - 0.55) * (0.9 + Math.sin(now * 6) * 0.2)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private drawFloor(ctx: CanvasRenderingContext2D, map: GameMap, x0: number, y0: number, x1: number, y1: number): void {
    const t = map.tile;
    const th = this.theme;
    const tx0 = Math.max(0, Math.floor(x0 / t));
    const ty0 = Math.max(0, Math.floor(y0 / t));
    const tx1 = Math.min(map.cols - 1, Math.floor(x1 / t));
    const ty1 = Math.min(map.rows - 1, Math.floor(y1 / t));
    ctx.fillStyle = th.floor;
    ctx.fillRect(tx0 * t, ty0 * t, (tx1 - tx0 + 1) * t, (ty1 - ty0 + 1) * t);
    ctx.fillStyle = th.floorAlt;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        // Deterministic subtle variation.
        const h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
        if (h % 7 === 0) ctx.fillRect(tx * t, ty * t, t, t);
      }
    }
    ctx.strokeStyle = th.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let tx = tx0; tx <= tx1 + 1; tx++) {
      ctx.moveTo(tx * t, ty0 * t);
      ctx.lineTo(tx * t, (ty1 + 1) * t);
    }
    for (let ty = ty0; ty <= ty1 + 1; ty++) {
      ctx.moveTo(tx0 * t, ty * t);
      ctx.lineTo((tx1 + 1) * t, ty * t);
    }
    ctx.stroke();
  }

  private drawDoors(ctx: CanvasRenderingContext2D, game: Game, now: number): void {
    const active =
      (game.mode === "survival" && (game.phase === "prep" || game.spawnQueue.length > 0)) || game.hordeQueue.length > 0;
    for (const s of game.map.spawns) {
      // Dark doorway recess spanning the lifted wall height.
      ctx.fillStyle = "#121418";
      ctx.fillRect(s.x - 16, s.y - 16 - WALL_LIFT, 32, 32 + WALL_LIFT);
      ctx.fillStyle = "#1e2228";
      ctx.fillRect(s.x - 16, s.y + 16 - WALL_LIFT, 32, WALL_LIFT);
      ctx.strokeStyle = "#e2b039";
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(s.x - 14, s.y - 14 - WALL_LIFT / 2, 28, 28 + WALL_LIFT / 2);
      ctx.setLineDash([]);
      if (active) {
        const pulse = 0.5 + Math.sin(now * 8) * 0.25;
        ctx.fillStyle = game.phase === "prep" ? `rgba(226,176,57,${pulse * 0.5})` : `rgba(212,69,58,${pulse * 0.5})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = game.phase === "prep" ? "#e2b039" : "#d4453a";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(s.x - s.inY * 9 + s.inX * 4, s.y + s.inX * 9 + s.inY * 4);
        ctx.lineTo(s.x + s.inX * 16, s.y + s.inY * 16);
        ctx.lineTo(s.x + s.inY * 9 + s.inX * 4, s.y - s.inX * 9 + s.inY * 4);
        ctx.stroke();
      }
    }
  }

  private drawExtraction(ctx: CanvasRenderingContext2D, game: Game, now: number): void {
    const b = game.extractionBounds();
    const on = game.phase === "extract";
    ctx.fillStyle = on ? `rgba(70,200,110,${0.25 + Math.sin(now * 4) * 0.08})` : "rgba(80,90,80,0.22)";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = on ? "#4ecf7a" : "#6a7a6a";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    ctx.lineDashOffset = -now * 20;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    ctx.fillStyle = on ? "#4ecf7a" : "#6a7a6a";
    ctx.font = "700 14px 'Chakra Petch', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(on ? "EXTRACT" : "EXTRACTION", b.x + b.w / 2, b.y + b.h / 2 + 5);
    if (on && game.extractT > 0) {
      const k = game.extractT / game.extractNeed;
      ctx.fillStyle = "#4ecf7a";
      ctx.fillRect(b.x, b.y + b.h + 6, b.w * k, 6);
    }
  }

  private collectTiles(ctx: CanvasRenderingContext2D, list: Drawable[], game: Game, x0: number, y0: number, x1: number, y1: number, now: number): void {
    const map = game.map;
    const t = map.tile;
    const th = this.theme;
    const w = game.world;
    const tx0 = Math.max(0, Math.floor(x0 / t));
    const ty0 = Math.max(0, Math.floor(y0 / t));
    const tx1 = Math.min(map.cols - 1, Math.floor(x1 / t));
    const ty1 = Math.min(map.rows - 1, Math.floor(y1 / t) + 1);
    for (let ty = ty0; ty <= ty1; ty++) {
      let tx = tx0;
      while (tx <= tx1) {
        const code = w.grid[ty * map.cols + tx];
        if (code === T_FLOOR) {
          tx++;
          continue;
        }
        if (code === T_WALL) {
          let ex = tx;
          while (ex + 1 <= tx1 && w.grid[ty * map.cols + ex + 1] === T_WALL) ex++;
          const sx = tx;
          const run = ex - tx + 1;
          const below = ty + 1 < map.rows;
          list.push({
            y: ty * t + t,
            draw: () => drawWallRun(ctx, w.grid, map.cols, sx, ty, run, t, th.wall, below),
          });
          tx = ex + 1;
          continue;
        }
        const cx = tx * t;
        const cy = ty * t;
        if (code === T_CRATE) list.push({ y: cy + t, draw: () => drawCrate(ctx, cx, cy, t, th.crate) });
        else if (code === T_TREE) list.push({ y: cy + t, draw: () => drawTree(ctx, cx, cy, t, th.tree, tx, ty, now) });
        else if (code === T_BARRICADE) {
          const i = ty * map.cols + tx;
          const hp = w.barricadeHp.get(i) ?? 0;
          const max = w.barricadeMax.get(i) ?? 1;
          const vertical = w.solid(tx - 1, ty) && w.solid(tx + 1, ty);
          list.push({ y: cy + t, draw: () => drawBarricade(ctx, cx, cy, t, hp / max, max > 200, vertical) });
        }
        tx++;
      }
    }
    for (const l of map.lamps) {
      if (l.x < x0 || l.x > x1 || l.y < y0 || l.y > y1) continue;
      list.push({ y: l.y, draw: () => drawLamp(ctx, l.x, l.y, now) });
    }
  }

  private drawFog(ctx: CanvasRenderingContext2D, game: Game, w: number, h: number, dpr: number, S: number): void {
    const fog = this.fog;
    if (fog.width !== ctx.canvas.width || fog.height !== ctx.canvas.height) {
      fog.width = ctx.canvas.width;
      fog.height = ctx.canvas.height;
    }
    const f = this.fctx;
    const th = this.theme;
    const dark = game.darkness;
    const exploredA = 0.6 + dark * 0.3;
    const unexploredA = 0.97;
    const maskA = 1 - (1 - unexploredA) / (1 - exploredA);

    // Update explored mask (cheap: cols×rows pixels).
    if (this.maskImg && this.maskFrame++ % 6 === 0) {
      const data = this.maskImg.data;
      const ex = game.world.explored;
      const [r, g, b] = th.fog.split(",").map(Number);
      for (let i = 0; i < ex.length; i++) {
        data[i * 4] = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = ex[i] ? 0 : Math.round(maskA * 255);
      }
      this.mctx.putImageData(this.maskImg, 0, 0);
    }

    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = "source-over";
    f.clearRect(0, 0, fog.width, fog.height);
    f.fillStyle = `rgba(${th.fog},${exploredA})`;
    f.fillRect(0, 0, fog.width, fog.height);
    f.setTransform(dpr * S, 0, 0, dpr * S, dpr * this.ox, dpr * this.oy);
    f.imageSmoothingEnabled = true;
    f.drawImage(this.mask, 0, 0, game.map.width, game.map.height);

    f.globalCompositeOperation = "destination-out";
    const players = game.livingPlayers();
    game.vision.forEach((poly, i) => {
      const p = players[i];
      if (!p) return;
      const g = f.createRadialGradient(p.x, p.y, 40, p.x, p.y, 430);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(0.55, "rgba(0,0,0,0.96)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      f.fillStyle = g;
      fillPoly(f, poly);
      // Small always-visible circle around the player (peripheral awareness).
      const g2 = f.createRadialGradient(p.x, p.y, 10, p.x, p.y, 70);
      g2.addColorStop(0, "rgba(0,0,0,0.9)");
      g2.addColorStop(1, "rgba(0,0,0,0)");
      f.fillStyle = g2;
      f.fillRect(p.x - 70, p.y - 70, 140, 140);
    });
    for (const l of game.lampVision) {
      const g = f.createRadialGradient(l.x, l.y, 10, l.x, l.y, 240);
      g.addColorStop(0, "rgba(0,0,0,0.85)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      f.fillStyle = g;
      fillPoly(f, l.poly);
    }
    for (const l of game.lights) {
      const a = l.life / l.max;
      const g = f.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      g.addColorStop(0, `rgba(0,0,0,${0.9 * a})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      f.fillStyle = g;
      f.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    // Fireballs & acid glow.
    for (const b of game.bullets) {
      if (b.kind !== "fireball" && b.kind !== "acid") continue;
      const g = f.createRadialGradient(b.x, b.y, 0, b.x, b.y, 70);
      g.addColorStop(0, "rgba(0,0,0,0.8)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      f.fillStyle = g;
      f.fillRect(b.x - 70, b.y - 70, 140, 140);
    }
    if (game.phase === "extract") {
      const b = game.extractionBounds();
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const g = f.createRadialGradient(cx, cy, 10, cx, cy, 160);
      g.addColorStop(0, "rgba(0,0,0,0.8)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      f.fillStyle = g;
      f.fillRect(cx - 160, cy - 160, 320, 320);
    }
    f.globalCompositeOperation = "source-over";

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fog, 0, 0);
    // Warm light tint near lights for atmosphere.
    ctx.setTransform(dpr * S, 0, 0, dpr * S, dpr * this.ox, dpr * this.oy);
    ctx.globalCompositeOperation = "lighter";
    for (const l of game.lights) {
      const a = (l.life / l.max) * 0.25;
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 0.6);
      g.addColorStop(0, `rgba(${l.color},${a})`);
      g.addColorStop(1, `rgba(${l.color},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    ctx.globalCompositeOperation = "source-over";
    void w;
    void h;
  }

  private drawIndicators(ctx: CanvasRenderingContext2D, game: Game, w: number, h: number, now: number): void {
    if (game.mode === "survival") return;
    const targets: { x: number; y: number; color: string; label: string }[] = [];
    const ps = game.activePlayers();
    const from = ps[0] ?? game.players[0];
    if (game.phase === "extract") {
      const b = game.extractionBounds();
      targets.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, color: "#4ecf7a", label: "EXTRACT" });
    } else {
      let best: Pickup | null = null;
      let bd = Infinity;
      for (const pk of game.pickups) {
        if (pk.kind !== "objective") continue;
        const d = len(pk.x - from.x, pk.y - from.y);
        if (d < bd) {
          bd = d;
          best = pk;
        }
      }
      if (best) targets.push({ x: best.x, y: best.y, color: "#ffd84a", label: `${Math.round(bd / 32)}m` });
    }
    for (const p of game.players) {
      if (p.alive && p.downed) targets.push({ x: p.x, y: p.y, color: "#ff5a4a", label: "REVIVE" });
    }
    for (const t of targets) {
      const s = this.worldToScreen(t.x, t.y);
      const m = 34;
      if (s.x > m && s.x < w - m && s.y > m + 60 && s.y < h - m - 80) continue;
      const cx = w / 2;
      const cy = h / 2;
      const ang = Math.atan2(s.y - cy, s.x - cx);
      const kx = (w / 2 - m) / Math.abs(Math.cos(ang) || 1e-6);
      const ky = (h / 2 - m - 50) / Math.abs(Math.sin(ang) || 1e-6);
      const k = Math.min(kx, ky);
      const x = cx + Math.cos(ang) * k;
      const y = cy + Math.sin(ang) * k;
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = 0.75 + Math.sin(now * 5) * 0.2;
      ctx.rotate(ang);
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-8, -10);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-8, 10);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-ang);
      ctx.font = "700 11px 'Chakra Petch', sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#000a";
      ctx.fillText(t.label, 1, -15);
      ctx.fillStyle = t.color;
      ctx.fillText(t.label, 0, -16);
      ctx.restore();
    }
  }

  drawMinimap(canvas: HTMLCanvasElement, game: Game, now: number): void {
    if (this.minimapFrame++ % 3 !== 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const map = game.map;
    const maxW = 180;
    const maxH = 130;
    const s = Math.min(maxW / map.cols, maxH / map.rows);
    const W = Math.ceil(map.cols * s);
    const H = Math.ceil(map.rows * s);
    if (canvas.width !== W * 2 || canvas.height !== H * 2) {
      canvas.width = W * 2;
      canvas.height = H * 2;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = "#07090c";
    ctx.fillRect(0, 0, W, H);
    const ex = game.world.explored;
    const lit = game.darkness <= 0;
    for (let ty = 0; ty < map.rows; ty++) {
      for (let tx = 0; tx < map.cols; tx++) {
        const i = ty * map.cols + tx;
        if (!lit && !ex[i]) continue;
        const c = game.world.grid[i];
        ctx.fillStyle = c === T_FLOOR ? "#3a4250" : c === T_BARRICADE ? "#8a5a2a" : c === T_TREE ? "#26402a" : "#141820";
        ctx.fillRect(tx * s, ty * s, s + 0.4, s + 0.4);
      }
    }
    const t = map.tile;
    const blink = Math.sin(now * 6) > 0;
    if (game.map.extraction.length) {
      const b = game.extractionBounds();
      ctx.fillStyle = game.phase === "extract" ? (blink ? "#4ecf7a" : "#2a8a4a") : "#2a5a3a";
      ctx.fillRect((b.x / t) * s, (b.y / t) * s, (b.w / t) * s, (b.h / t) * s);
    }
    for (const pk of game.pickups) {
      if (pk.kind !== "objective") continue;
      ctx.fillStyle = blink ? "#ffd84a" : "#a88a2a";
      ctx.fillRect((pk.x / t) * s - 2, (pk.y / t) * s - 2, 4, 4);
    }
    for (const e of game.enemies) {
      if (!e.visible || e.seen < 0.5) continue;
      ctx.fillStyle = e.ztype === "boss" ? "#ff3a6a" : "#d4453a";
      const r = e.ztype === "boss" ? 3 : 1.5;
      ctx.fillRect((e.x / t) * s - r, (e.y / t) * s - r, r * 2, r * 2);
    }
    for (const p of game.livingPlayers()) {
      ctx.fillStyle = p.downed ? (blink ? "#ff5a4a" : "#fff") : p.color;
      ctx.fillRect((p.x / t) * s - 2.5, (p.y / t) * s - 2.5, 5, 5);
    }
    // View rectangle.
    ctx.strokeStyle = "#ffffff44";
    ctx.lineWidth = 1;
    const vw = game.viewW / game.cam.zoom;
    const vh = game.viewH / game.cam.zoom;
    ctx.strokeRect(((game.cam.x - vw / 2) / t) * s, ((game.cam.y - vh / 2) / t) * s, (vw / t) * s, (vh / t) * s);
  }
}

function fillPoly(f: CanvasRenderingContext2D, poly: Float32Array): void {
  f.beginPath();
  f.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) f.lineTo(poly[i], poly[i + 1]);
  f.closePath();
  f.fill();
}

// ───────────────────────────── tiles ─────────────────────────────

const WALL_LIFT = 16;

function drawWallRun(
  ctx: CanvasRenderingContext2D,
  grid: Uint8Array,
  cols: number,
  tx: number,
  ty: number,
  run: number,
  t: number,
  color: string,
  hasBelow: boolean,
): void {
  const x = tx * t;
  const y = ty * t;
  const w = run * t;
  // Front face only where the tile below is open.
  for (let i = 0; i < run; i++) {
    const open = !hasBelow || grid[(ty + 1) * cols + tx + i] !== T_WALL;
    if (!open) continue;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(x + i * t, y + t, t, 7);
    ctx.fillStyle = shade(color, 0.68);
    ctx.fillRect(x + i * t, y + t - WALL_LIFT, t, WALL_LIFT);
  }
  ctx.fillStyle = color;
  ctx.fillRect(x, y - WALL_LIFT, w, t);
  ctx.strokeStyle = shade(color, 1.14);
  ctx.lineWidth = 1;
  // Edge highlight on exposed edges only.
  ctx.beginPath();
  const top = ty > 0;
  for (let i = 0; i < run; i++) {
    if (!top || grid[(ty - 1) * cols + tx + i] !== T_WALL) {
      ctx.moveTo(x + i * t, y - WALL_LIFT + 0.5);
      ctx.lineTo(x + (i + 1) * t, y - WALL_LIFT + 0.5);
    }
  }
  if (tx === 0 || grid[ty * cols + tx - 1] !== T_WALL) {
    ctx.moveTo(x + 0.5, y - WALL_LIFT);
    ctx.lineTo(x + 0.5, y - WALL_LIFT + t);
  }
  ctx.stroke();
  ctx.strokeStyle = shade(color, 0.8);
  ctx.beginPath();
  if (tx + run >= cols || grid[ty * cols + tx + run] !== T_WALL) {
    ctx.moveTo(x + w - 0.5, y - WALL_LIFT);
    ctx.lineTo(x + w - 0.5, y - WALL_LIFT + t);
  }
  ctx.stroke();
}

function drawCrate(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, color: string): void {
  const lift = 12;
  const m = 2;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x + m + 3, y + m + 4, t - m * 2, t - m * 2);
  ctx.fillStyle = shade(color, 0.65);
  ctx.fillRect(x + m, y + t - m - lift, t - m * 2, lift);
  ctx.fillStyle = color;
  ctx.fillRect(x + m, y + m - lift, t - m * 2, t - m * 2);
  ctx.strokeStyle = shade(color, 0.6);
  ctx.lineWidth = 2;
  ctx.strokeRect(x + m + 1, y + m - lift + 1, t - m * 2 - 2, t - m * 2 - 2);
  ctx.beginPath();
  ctx.moveTo(x + m + 2, y + m - lift + 2);
  ctx.lineTo(x + t - m - 2, y + t - m - lift - 2);
  ctx.stroke();
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, color: string, tx: number, ty: number, now: number): void {
  const h = ((tx * 92837111) ^ (ty * 689287499)) >>> 0;
  const r = 17 + (h % 6);
  const sway = Math.sin(now * 0.8 + tx * 0.7 + ty) * 1.5;
  const cx = x + t / 2;
  const cy = y + t / 2;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(cx + 4, cy + 6, r, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a3624";
  ctx.fillRect(cx - 4, cy - 14, 8, 18);
  ctx.fillStyle = shade(color, 0.75);
  ctx.beginPath();
  ctx.arc(cx + sway, cy - 22, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx + sway - 3, cy - 26, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(color, 1.25);
  ctx.beginPath();
  ctx.arc(cx + sway - 7, cy - 31, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

function drawBarricade(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, hp: number, metal: boolean, vertical: boolean): void {
  const boards = hp > 0.66 ? 3 : hp > 0.33 ? 2 : 1;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x + 3, y + 6, t, t - 4);
  if (metal) {
    const lift = 10;
    ctx.fillStyle = shade("#7a8088", 0.65);
    ctx.fillRect(x + 1, y + t - lift - 2, t - 2, lift);
    ctx.fillStyle = "#7a8088";
    ctx.fillRect(x + 1, y + 1 - lift, t - 2, t - 4);
    ctx.strokeStyle = "#e2b039";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = -1; i < 3; i++) {
      ctx.moveTo(x + 4 + i * 10, y + t - lift - 4);
      ctx.lineTo(x + 12 + i * 10, y + 4 - lift);
    }
    ctx.stroke();
    if (hp < 0.5) {
      ctx.strokeStyle = "#2a2a2a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 8, y - lift + 6);
      ctx.lineTo(x + 16, y - lift + 14);
      ctx.lineTo(x + 12, y - lift + 22);
      ctx.stroke();
    }
    return;
  }
  for (let i = 0; i < boards; i++) {
    ctx.save();
    ctx.translate(x + t / 2, y + t / 2 - 8);
    if (vertical) ctx.rotate(Math.PI / 2);
    ctx.rotate((i - 1) * 0.35);
    ctx.fillStyle = i % 2 ? "#8a5a2a" : "#a0703a";
    ctx.fillRect(-t / 2 - 3, -4 + (i - 1) * 9, t + 6, 8);
    ctx.fillStyle = "#3a2a1a";
    ctx.fillRect(-t / 2 + 1, -1 + (i - 1) * 9, 2, 2);
    ctx.fillRect(t / 2 - 3, -1 + (i - 1) * 9, 2, 2);
    ctx.restore();
  }
}

function drawLamp(ctx: CanvasRenderingContext2D, x: number, y: number, now: number): void {
  const flick = 0.75 + Math.sin(now * 13 + x) * 0.1 + Math.sin(now * 31 + y) * 0.08;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 4, 7, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(x - 2, y - 26, 4, 28);
  ctx.fillStyle = `rgba(255,220,140,${flick})`;
  ctx.fillRect(x - 6, y - 32, 12, 8);
  ctx.fillStyle = `rgba(255,220,140,${0.18 * flick})`;
  ctx.beginPath();
  ctx.arc(x, y - 28, 22, 0, Math.PI * 2);
  ctx.fill();
}

// ───────────────────────────── decals ─────────────────────────────

function drawBlood(ctx: CanvasRenderingContext2D, game: Game, inView: (x: number, y: number) => boolean, th: Theme): void {
  ctx.fillStyle = th.blood;
  for (const b of game.blood) {
    if (!inView(b.x, b.y)) continue;
    ctx.globalAlpha = Math.max(0, b.a);
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.s, b.s * 0.55, b.rot, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawCorpse(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = shade(color, 0.55);
  ctx.fillRect(-size, -size * 0.6, size * 2, size * 1.2);
  ctx.fillStyle = shade(color, 0.75);
  ctx.fillRect(-size + 2, -size * 0.6 + 2, size * 2 - 8, size * 1.2 - 6);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(size * 0.4, -2, 3, 3);
  ctx.restore();
}

function drawHazard(ctx: CanvasRenderingContext2D, h: Hazard, now: number): void {
  const a = Math.min(1, h.life / 0.8);
  if (h.kind === "acid") {
    ctx.fillStyle = `rgba(150,200,40,${0.42 * a})`;
    for (let i = 0; i < 5; i++) {
      const ang = i * 1.3 + h.x;
      ctx.beginPath();
      ctx.arc(h.x + Math.cos(ang) * h.r * 0.35, h.y + Math.sin(ang) * h.r * 0.25, h.r * (0.55 + (i % 2) * 0.15), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = `rgba(220,255,120,${0.5 * a})`;
    for (let i = 0; i < 4; i++) {
      const bx = h.x + Math.sin(now * 3 + i * 2 + h.y) * h.r * 0.5;
      const by = h.y + Math.cos(now * 2.3 + i) * h.r * 0.3;
      ctx.fillRect(bx - 1.5, by - 1.5, 3, 3);
    }
  } else {
    ctx.fillStyle = `rgba(140,170,80,${0.22 * a})`;
    for (let i = 0; i < 4; i++) {
      const bx = h.x + Math.sin(now * 0.8 + i * 1.7) * h.r * 0.3;
      const by = h.y + Math.cos(now * 0.6 + i * 2.1) * h.r * 0.3;
      ctx.beginPath();
      ctx.arc(bx, by, h.r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawTelegraphsGround(ctx: CanvasRenderingContext2D, game: Game): void {
  for (const e of game.enemies) {
    if (e.seen < 0.2) continue;
    const ab = e.ability;
    if (ab.phase !== "prep") continue;
    if (ab.name === "charge") {
      const L = 360;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(Math.atan2(ab.dirY, ab.dirX));
      ctx.fillStyle = "rgba(212,69,58,0.18)";
      ctx.fillRect(0, -e.r - 4, L, (e.r + 4) * 2);
      ctx.strokeStyle = "rgba(212,69,58,0.7)";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.strokeRect(0, -e.r - 4, L, (e.r + 4) * 2);
      ctx.setLineDash([]);
      ctx.restore();
    } else if (ab.name === "slam" || ab.name === "inflate") {
      const R = ab.name === "slam" ? 135 : 100;
      const total = ab.name === "slam" ? 0.85 : 0.75;
      const k = 1 - Math.max(0, ab.t) / total;
      ctx.fillStyle = ab.name === "slam" ? "rgba(212,69,58,0.16)" : "rgba(150,200,60,0.18)";
      ctx.beginPath();
      ctx.arc(e.x, e.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ab.name === "slam" ? "rgba(212,69,58,0.3)" : "rgba(150,200,60,0.32)";
      ctx.beginPath();
      ctx.arc(e.x, e.y, R * k, 0, Math.PI * 2);
      ctx.fill();
    } else if (ab.name === "lunge") {
      ctx.strokeStyle = "rgba(212,69,58,0.6)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + ab.dirX * 110, e.y + ab.dirY * 110);
      ctx.stroke();
    }
  }
}

// ───────────────────────────── actors ─────────────────────────────

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.beginPath();
  ctx.ellipse(x, y + 5, r * 0.95, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, lift: number, color: string): number {
  const topX = x - s;
  const topY = y - s - lift;
  ctx.fillStyle = shade(color, 0.7);
  ctx.fillRect(topX, y - 2, s * 2, Math.max(2, lift - s + 4));
  ctx.fillStyle = shade(color, 0.55);
  ctx.fillRect(x + s - 4, topY + 6, 6, s * 2 + lift - s - 4);
  ctx.fillStyle = color;
  ctx.fillRect(topX, topY, s * 2, s * 2);
  ctx.strokeStyle = shade(color, 1.12);
  ctx.lineWidth = 1;
  ctx.strokeRect(topX + 0.5, topY + 0.5, s * 2 - 1, s * 2 - 1);
  return topY;
}

function drawPlayer(ctx: CanvasRenderingContext2D, a: Actor, now: number): void {
  if (a.downed) {
    shadow(ctx, a.x, a.y, a.r * 1.2);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(0.3);
    ctx.fillStyle = shade(a.color, 0.7);
    ctx.fillRect(-14, -8, 28, 16);
    ctx.fillStyle = a.color;
    ctx.fillRect(-12, -10, 24, 12);
    ctx.restore();
    // Revive / bleed ring
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.arc(a.x, a.y - 4, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#ff5a4a";
    ctx.beginPath();
    ctx.arc(a.x, a.y - 4, 24, -Math.PI / 2, -Math.PI / 2 + (a.bleed / 28) * Math.PI * 2);
    ctx.stroke();
    if (a.revive > 0) {
      ctx.strokeStyle = "#4ecf7a";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(a.x, a.y - 4, 30, -Math.PI / 2, -Math.PI / 2 + (a.revive / 2.6) * Math.PI * 2);
      ctx.stroke();
    }
    return;
  }
  const bob = Math.abs(Math.sin(a.walkT)) * 1.5;
  shadow(ctx, a.x, a.y, a.r);
  const flash = a.hurt > 0.3 && Math.floor(now * 30) % 2 === 0;
  const color = flash ? "#ffffff" : a.color;
  const topY = box(ctx, a.x, a.y - bob, a.size, a.lift, color);
  ctx.fillStyle = shade(color, 1.15);
  ctx.fillRect(a.x - a.size + 3, topY + 3, a.size * 2 - 6, 5);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(a.x + a.dirX * a.size * 0.42 - 3, topY + a.size + a.dirY * a.size * 0.42 - 3, 6, 6);
  drawWeapon(ctx, a, topY);
  if (a.shoveAnim > 0) {
    ctx.strokeStyle = `rgba(255,255,255,${a.shoveAnim * 0.8})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    const ang = Math.atan2(a.dirY, a.dirX);
    ctx.arc(a.x, a.y - 8, 34 + (1 - a.shoveAnim) * 16, ang - 0.9, ang + 0.9);
    ctx.stroke();
  }
}

function drawZombie(ctx: CanvasRenderingContext2D, a: Actor, now: number): void {
  const def = ZOMBIES[a.ztype];
  ctx.globalAlpha = a.seen;
  if (a.state === "dormant") {
    drawCorpse(ctx, a.x, a.y, a.size, a.color, 0.2);
    ctx.globalAlpha = 1;
    return;
  }
  const charging = a.ability.name === "charge";
  const prep = a.ability.phase === "prep";
  let jx = 0;
  if (prep && (a.ability.name === "charge" || a.ability.name === "scream" || a.ability.name === "summon")) jx = Math.sin(now * 70) * 2;
  const x = a.x + jx;
  const bob = Math.abs(Math.sin(a.walkT)) * (a.ztype === "runner" ? 2.5 : 1.2);
  const y = a.y - bob;
  shadow(ctx, a.x, a.y, a.size);
  let color = a.color;
  if (a.hurt > 0) color = "#f4f4f4";
  else if (prep && charging && Math.floor(now * 16) % 2 === 0) color = "#c84a3a";
  else if (a.stun > 0) color = shade(a.color, 0.8);
  const s = a.size;

  let topY: number;
  if (a.ztype === "bloater") {
    // Rounded body
    ctx.fillStyle = shade(color, 0.65);
    ctx.beginPath();
    ctx.ellipse(x, y - 4, s, s * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y - s * 0.6 - def.lift * 0.4, s, 0, Math.PI * 2);
    ctx.fill();
    topY = y - s * 0.6 - def.lift * 0.4 - s;
    ctx.fillStyle = "#9ac04a";
    for (let i = 0; i < 5; i++) {
      const ang = i * 1.4 + 0.3;
      ctx.beginPath();
      ctx.arc(x + Math.cos(ang) * s * 0.6, topY + s + Math.sin(ang) * s * 0.55, 2.5 + (i % 2), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    topY = box(ctx, x, y, s, a.lift, color);
  }

  // Type-specific features.
  if (a.ztype === "brute" || a.ztype === "boss") {
    ctx.fillStyle = shade(color, 0.8);
    ctx.fillRect(x - s - 6, topY + 4, 7, s);
    ctx.fillRect(x + s - 1, topY + 4, 7, s);
    if (a.ztype === "boss") {
      ctx.fillStyle = "#c9b8a0";
      for (let i = 0; i < 5; i++) {
        const sx = x - s + 6 + i * ((s * 2 - 12) / 4);
        ctx.beginPath();
        ctx.moveTo(sx - 4, topY + 2);
        ctx.lineTo(sx, topY - 10);
        ctx.lineTo(sx + 4, topY + 2);
        ctx.fill();
      }
    }
  }
  if (a.ztype === "devil") {
    ctx.fillStyle = shade(color, 0.8);
    ctx.fillRect(x - s - 2, topY - 8, 6, 10);
    ctx.fillRect(x + s - 4, topY - 8, 6, 10);
  }
  if (a.ztype === "spitter") {
    ctx.fillStyle = "#6a8a1a";
    ctx.fillRect(x + a.dirX * s * 0.5 - 4, topY + s + a.dirY * s * 0.5 + 2, 8, 6);
    if (a.ability.name === "spit") {
      ctx.fillStyle = "#c8f04a";
      ctx.beginPath();
      ctx.arc(x + a.dirX * s, topY + s + a.dirY * s, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (a.ztype === "screamer") {
    const open = a.ability.name === "scream" ? 9 : 4;
    ctx.fillStyle = "#1a0a0a";
    ctx.fillRect(x + a.dirX * s * 0.3 - open / 2, topY + s + 2 + a.dirY * s * 0.3, open, open);
    ctx.fillStyle = "#4a3a3a";
    ctx.fillRect(x - s, topY, s * 2, 4);
  }

  // Eyes
  const eyeColor = a.state === "chase" ? (a.enraged > 0 ? "#ff2a2a" : "#e04a2a") : "#1a1a1a";
  const ex = x + a.dirX * s * 0.42;
  const ey = topY + s + a.dirY * s * 0.42 - (a.ztype === "bloater" ? 2 : 0);
  const px = -a.dirY * 3.5;
  const py = a.dirX * 3.5;
  ctx.fillStyle = eyeColor;
  if (a.ztype === "boss") {
    for (const k of [-2, 0, 2]) ctx.fillRect(ex + px * k - 2.5, ey + py * k - 2.5 - 4, 5, 5);
  } else {
    ctx.fillRect(ex + px - 2, ey + py - 2, 4, 4);
    ctx.fillRect(ex - px - 2, ey - py - 2, 4, 4);
  }

  if (a.ztype !== "bloater") drawArms(ctx, a, x, topY);

  if (a.stun > 0) {
    ctx.fillStyle = "#ffd84a";
    for (let i = 0; i < 3; i++) {
      const ang = now * 6 + (i * Math.PI * 2) / 3;
      ctx.fillRect(x + Math.cos(ang) * 12 - 2, topY - 8 + Math.sin(ang) * 4 - 2, 4, 4);
    }
  }
  ctx.globalAlpha = 1;
}

function drawArms(ctx: CanvasRenderingContext2D, a: Actor, x: number, topY: number): void {
  const swing = a.attackAnim;
  const big = a.ztype === "brute" || a.ztype === "boss";
  const reach = (big ? 10 : 7) + Math.max(0, swing) * (big ? 16 : 11);
  const back = Math.min(0, swing) * 8;
  const hand = big ? 11 : 7;
  for (const side of [-1, 1]) {
    const px = -a.dirY * side * (a.size * 0.85);
    const py = a.dirX * side * (a.size * 0.85);
    const fx = x + px + a.dirX * (reach + back);
    const fy = topY + a.size + py + a.dirY * (reach + back);
    ctx.fillStyle = shade(a.color, 0.62);
    ctx.fillRect(fx - hand / 2, fy - hand / 2, hand, hand);
    ctx.strokeStyle = shade(a.color, 0.4);
    ctx.strokeRect(fx - hand / 2, fy - hand / 2, hand, hand);
  }
}

function drawWeapon(ctx: CanvasRenderingContext2D, a: Actor, topY: number): void {
  const id = a.weapon;
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
    ctx.fillStyle = "#7a8088";
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
  if (a.fireAnim > 0.4 && !WEAPON_BY_ID[id].place && id !== "grenade") {
    ctx.fillStyle = "#ffe28a";
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(26 + a.fireAnim * 10, -4);
    ctx.lineTo(30 + a.fireAnim * 12, 0);
    ctx.lineTo(26 + a.fireAnim * 10, 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawBullet(ctx: CanvasRenderingContext2D, b: Bullet): void {
  if (b.kind === "fireball") {
    ctx.strokeStyle = "#c44a12";
    ctx.lineWidth = 6;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(b.px, b.py - 10);
    ctx.lineTo(b.x, b.y - 10);
    ctx.stroke();
    ctx.fillStyle = "#ff7a2a";
    ctx.fillRect(b.x - 6, b.y - 16, 12, 12);
    ctx.fillStyle = "#ffe08a";
    ctx.fillRect(b.x - 2.5, b.y - 12.5, 5, 5);
    return;
  }
  if (b.kind === "acid") {
    const k = 1 - b.life / b.maxLife;
    const arc = Math.sin(k * Math.PI) * 70;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, 6, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9ad02a";
    ctx.beginPath();
    ctx.arc(b.x, b.y - arc - 8, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d8ff7a";
    ctx.fillRect(b.x - 2, b.y - arc - 10, 3, 3);
    // Landing marker
    ctx.strokeStyle = "rgba(154,208,42,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.tx!, b.ty!, 30 * (0.4 + k * 0.6), 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (b.kind === "grenade") {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(b.x - 4, b.y - 1, 8, 4);
    ctx.strokeStyle = "#1d3a1d";
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x - 5, b.y - 10, 10, 10);
    ctx.fillStyle = b.life < 0.35 && Math.floor(b.life * 20) % 2 ? "#ff4a2a" : "#2d4a2d";
    ctx.fillRect(b.x - 4, b.y - 9, 8, 8);
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
    ctx.beginPath();
    ctx.moveTo(b.x + nx * 6, b.y + ny * 6);
    ctx.lineTo(b.x + nx * 12, b.y + ny * 12);
    ctx.stroke();
    ctx.fillStyle = "#ffb347";
    ctx.fillRect(b.x - nx * 18 - 3, b.y - ny * 18 - 3, 6, 6);
    return;
  }
  if (b.kind === "rail") {
    const a = Math.max(0, b.life / b.maxLife);
    ctx.globalAlpha = a;
    ctx.strokeStyle = "#5ab0f0";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(b.px, b.py);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = "#e8f6ff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
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

function drawPlace(ctx: CanvasRenderingContext2D, pl: Placeable): void {
  if (pl.kind === "barrel") {
    drawCube(ctx, pl.x, pl.y, 11, 14, "#8a2a1a");
    ctx.fillStyle = "#e2b039";
    ctx.fillRect(pl.x - 11, pl.y - 20, 22, 3);
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "700 9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("!", pl.x, pl.y - 9);
  } else {
    ctx.save();
    ctx.translate(pl.x, pl.y);
    ctx.rotate(Math.atan2(pl.dirY, pl.dirX));
    ctx.fillStyle = "#4a4a3a";
    ctx.fillRect(-8, -7, 16, 14);
    ctx.fillStyle = pl.armed > 0 ? "#888" : "#d4453a";
    ctx.fillRect(4, -7, 4, 14);
    ctx.fillStyle = "rgba(212,69,58,0.08)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 82, -0.55, 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawCube(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lift: number, color: string): void {
  const s = r * 2;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x - r + 3, y - r + 6, s, s);
  ctx.fillStyle = shade(color, 0.7);
  ctx.fillRect(x - r, y - 2, s, lift - r + 6);
  ctx.fillStyle = color;
  ctx.fillRect(x - r, y - r - lift + 4, s, s);
}

function drawPickup(ctx: CanvasRenderingContext2D, pk: Pickup, now: number, game: Game): void {
  const bob = Math.sin(pk.bob * 4) * 3;
  if (pk.kind === "objective") {
    const g = 0.5 + Math.sin(now * 5) * 0.3;
    ctx.fillStyle = `rgba(255,216,74,${0.18 * g + 0.08})`;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, 30, 0, Math.PI * 2);
    ctx.fill();
    drawCube(ctx, pk.x, pk.y + bob, 10, 16, "#e2b039");
    ctx.fillStyle = "#1a1406";
    ctx.font = "700 10px 'Chakra Petch', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(game.map.objectiveLabel?.[0] ?? "?", pk.x, pk.y - 9 + bob);
    return;
  }
  if (pk.kind === "supply") {
    drawCube(ctx, pk.x, pk.y, 13, 12, "#3a6a9a");
    ctx.fillStyle = "#f4f4f4";
    ctx.fillRect(pk.x - 2, pk.y - 20, 4, 12);
    ctx.fillRect(pk.x - 6, pk.y - 16, 12, 4);
    return;
  }
  if (pk.kind === "medkit") {
    drawCube(ctx, pk.x, pk.y + bob, 8, 8, "#e8e8e8");
    ctx.fillStyle = "#d4453a";
    ctx.fillRect(pk.x - 1.5, pk.y - 13 + bob, 3, 9);
    ctx.fillRect(pk.x - 4.5, pk.y - 10 + bob, 9, 3);
    return;
  }
  if (pk.kind === "ammo") {
    drawCube(ctx, pk.x, pk.y + bob, 8, 8, "#5a6a3a");
    ctx.fillStyle = "#e2b039";
    ctx.fillRect(pk.x - 5, pk.y - 12 + bob, 3, 6);
    ctx.fillRect(pk.x - 1, pk.y - 12 + bob, 3, 6);
    ctx.fillRect(pk.x + 3, pk.y - 12 + bob, 3, 6);
    return;
  }
  const fade = pk.life < 5 && Math.floor(pk.life * 6) % 2 === 0 ? 0.4 : 1;
  ctx.globalAlpha = fade;
  drawCube(ctx, pk.x, pk.y + bob, 11, 10, "#c62828");
  ctx.strokeStyle = "#e2b039";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pk.x - 6, pk.y - 14 + bob);
  ctx.lineTo(pk.x + 6, pk.y - 14 + bob);
  ctx.moveTo(pk.x, pk.y - 20 + bob);
  ctx.lineTo(pk.x, pk.y - 8 + bob);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** World-space overlays drawn above the fog: alert marks, floating text, HP bars. */
function drawOverlays(ctx: CanvasRenderingContext2D, game: Game, now: number): void {
  ctx.textAlign = "center";
  for (const e of game.enemies) {
    if (e.seen < 0.3) continue;
    const top = e.y - e.size * 2 - e.lift - 6;
    if (e.markT > 0 && e.mark) {
      const a = Math.min(1, e.markT * 2);
      ctx.globalAlpha = a * e.seen;
      ctx.font = "700 18px 'Chakra Petch', sans-serif";
      ctx.fillStyle = "#000";
      ctx.fillText(e.mark, e.x + 1, top - 7);
      ctx.fillStyle = e.mark === "!" ? "#ff4a3a" : "#ffd84a";
      ctx.fillText(e.mark, e.x, top - 8);
      ctx.globalAlpha = 1;
    }
    const hpShown = e.ztype !== "walker" && e.ztype !== "crawler" && e.hp < e.maxHp && e.ztype !== "boss";
    if (hpShown) {
      const ratio = clamp(e.hp / e.maxHp, 0, 1);
      const w = Math.max(24, e.size * 2);
      ctx.fillStyle = "#0008";
      ctx.fillRect(e.x - w / 2, top, w, 4);
      ctx.fillStyle = ratio > 0.35 ? "#d4a03a" : "#d4453a";
      ctx.fillRect(e.x - w / 2, top, w * ratio, 4);
    }
  }
  for (const p of game.livingPlayers()) {
    if (p.downed) continue;
    const ratio = clamp(p.hp / p.maxHp, 0, 1);
    if (ratio >= 0.999) continue;
    const top = p.y - p.size * 2 - p.lift - 8;
    ctx.fillStyle = "#0008";
    ctx.fillRect(p.x - 14, top, 28, 4);
    ctx.fillStyle = ratio > 0.35 ? "#3aaa5a" : "#d4453a";
    ctx.fillRect(p.x - 14, top, 28 * ratio, 4);
  }
  // Damaged barricade HP.
  const w = game.world;
  for (const [i, hp] of w.barricadeHp) {
    const max = w.barricadeMax.get(i) ?? 1;
    if (hp >= max) continue;
    const c = w.center(i);
    if (len(c.x - game.cam.x, c.y - game.cam.y) > 900) continue;
    ctx.fillStyle = "#0008";
    ctx.fillRect(c.x - 12, c.y - 34, 24, 3);
    ctx.fillStyle = "#c98a3a";
    ctx.fillRect(c.x - 12, c.y - 34, 24 * (hp / max), 3);
  }
  for (const t of game.texts) {
    ctx.globalAlpha = Math.min(1, t.life * 2.5);
    ctx.font = `700 ${t.size}px 'Chakra Petch', sans-serif`;
    ctx.fillStyle = "#000a";
    ctx.fillText(t.text, t.x + 1, t.y + 1);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  void now;
}

export function drawMapPreview(canvas: HTMLCanvasElement, map: GameMap): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const th = THEMES[map.theme];
  const dpr = 2;
  const W = 320;
  const H = 180;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = Math.min(W / map.width, H / map.height);
  ctx.fillStyle = th.backdrop;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate((W - map.width * s) / 2, (H - map.height * s) / 2);
  ctx.scale(s, s);
  ctx.fillStyle = th.floor;
  ctx.fillRect(0, 0, map.width, map.height);
  const t = map.tile;
  for (let ty = 0; ty < map.rows; ty++) {
    for (let tx = 0; tx < map.cols; tx++) {
      const c = map.grid[ty * map.cols + tx];
      if (c === T_FLOOR) continue;
      ctx.fillStyle = c === T_WALL ? th.wall : c === T_CRATE ? th.crate : c === T_TREE ? th.tree : "#8a5a2a";
      if (c === T_TREE) {
        ctx.beginPath();
        ctx.arc(tx * t + t / 2, ty * t + t / 2, t * 0.6, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(tx * t, ty * t, t, t);
    }
  }
  ctx.fillStyle = "#c0392b";
  for (const sp of map.spawns) ctx.fillRect(sp.x - 20, sp.y - 20, 40, 40);
  ctx.fillStyle = "#e2b039";
  for (const o of map.objectives) {
    ctx.beginPath();
    ctx.arc(o.x, o.y, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#4ecf7a";
  for (const e of map.extraction) ctx.fillRect(e.tx * t, e.ty * t, t, t);
  ctx.fillStyle = "#4aa3d8";
  for (const p of map.starts.slice(0, 1)) ctx.fillRect(p.x - 24, p.y - 24, 48, 48);
  ctx.restore();
  if (map.darkness > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${map.darkness * 0.6})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}
