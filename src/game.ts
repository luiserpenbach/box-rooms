import { AudioFx } from "./audio";
import { Input } from "./input";
import {
  type Rect,
  clamp,
  circleRect,
  len,
  lerp,
  norm,
  pick,
  rand,
  resolveCircleRect,
  snap8,
} from "./math";
import { type GameMap } from "./maps";
import {
  type StatId,
  type WeaponId,
  UPGRADE_COUNT,
  WEAPON_BY_ID,
  WEAPONS,
  buildUpgradeTrack,
  upgradeScore,
  type UpgradeEvent,
} from "./weapons";

export type ActorKind = "player" | "zombie" | "devil";

export type Actor = {
  id: number;
  kind: ActorKind;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  dirX: number;
  dirY: number;
  speed: number;
  color: string;
  fireCd: number;
  hurt: number;
  playerIndex?: number;
  weapon?: WeaponId;
  ammo: Partial<Record<WeaponId, number>>;
  alive: boolean;
  kills: number;
  attackWind: number;
  attackWindMax: number;
  attackSwing: number;
  attackCd: number;
  attackAnim: number;
  faceLock: number;
  fireAnim: number;
};

export type Bullet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  life: number;
  pierce: number;
  friendly: boolean;
  kind: "bullet" | "pellet" | "grenade" | "rocket" | "fireball" | "rail";
  owner?: number;
  px: number;
  py: number;
  streak: number;
};

export type Placeable = {
  x: number;
  y: number;
  r: number;
  kind: "barrel" | "claymore" | "wall";
  hp: number;
  dirX: number;
  dirY: number;
  w?: number;
  h?: number;
};

export type Pickup = { x: number; y: number; r: number; life: number };

export type Blood = { x: number; y: number; s: number; a: number; rot: number; vx: number; vy: number };

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
};

export type Banner = { text: string; life: number };

export class Game {
  map: GameMap;
  players: Actor[] = [];
  enemies: Actor[] = [];
  bullets: Bullet[] = [];
  places: Placeable[] = [];
  pickups: Pickup[] = [];
  blood: Blood[] = [];
  particles: Particle[] = [];
  score = 0;
  displayScore = 0;
  multiplier = 1;
  combo = 0;
  comboMax = 2.6;
  wave = 0;
  phase: "prep" | "wave" | "over" = "prep";
  phaseT = 0;
  toSpawnZ = 0;
  toSpawnD = 0;
  spawnCd = 0;
  cam = { x: 0, y: 0 };
  shake = 0;
  banners: Banner[] = [];
  unlocked = new Set<WeaponId>(["pistol"]);
  over = false;
  coop: boolean;
  upgradeStep = 0;
  rangeMul = 1;
  fireMul = 1;
  dmgMul = 1;
  statSteps: Record<StatId, number> = { range: 0, fireRate: 0, damage: 0 };
  track: UpgradeEvent[] = buildUpgradeTrack();
  private nextId = 1;
  private audio: AudioFx;

  constructor(map: GameMap, coop: boolean, audio: AudioFx) {
    this.map = map;
    this.coop = coop;
    this.audio = audio;
    this.spawnPlayers();
    this.cam.x = map.width / 2;
    this.cam.y = map.height / 2;
    this.startPrep();
  }

  private spawnPlayers(): void {
    const colors = ["#4aa3d8", "#4ecf7a"];
    const n = this.coop ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const p = this.map.starts[i] ?? this.map.starts[0];
      const a = this.actor("player", p.x, p.y, 12, 100, 210, colors[i]);
      a.playerIndex = i;
      a.weapon = "pistol";
      a.ammo = { pistol: 9999 };
      a.dirX = 0;
      a.dirY = -1;
      this.players.push(a);
    }
  }

  private actor(
    kind: ActorKind,
    x: number,
    y: number,
    r: number,
    hp: number,
    speed: number,
    color: string,
  ): Actor {
    return {
      id: this.nextId++,
      kind,
      x,
      y,
      r,
      hp,
      maxHp: hp,
      dirX: 0,
      dirY: 1,
      speed,
      color,
      fireCd: 0,
      hurt: 0,
      ammo: {},
      alive: true,
      kills: 0,
      attackWind: 0,
      attackWindMax: 1,
      attackSwing: 0,
      attackCd: 0,
      attackAnim: 0,
      faceLock: 0,
      fireAnim: 0,
    };
  }

  zombieSpeed(): number {
    return 36 + (this.wave - 1) * 5.4;
  }

  meleeWindup(): number {
    return Math.max(0.22, 1.05 - (this.wave - 1) * 0.055);
  }

  private banner(text: string, life = 2.2): void {
    this.banners.push({ text, life });
  }

  private startPrep(): void {
    this.wave += 1;
    this.phase = "prep";
    this.phaseT = this.wave === 1 ? 5.5 : 4.2;
    this.banner(this.wave === 1 ? "PREPARE THE DOORS" : `WAVE ${this.wave} INCOMING`);
    this.audio.wave();
  }

  private startWave(): void {
    this.phase = "wave";
    this.toSpawnZ = 6 + this.wave * 4;
    this.toSpawnD = this.wave >= 3 ? Math.floor((this.wave - 1) / 2) : 0;
    if (this.wave >= 8) this.toSpawnZ += this.wave;
    this.spawnCd = 0.15;
    this.banner(`WAVE ${this.wave}`);
  }

  livingPlayers(): Actor[] {
    return this.players.filter((p) => p.alive);
  }

  update(dt: number, input: Input): void {
    if (this.over) return;
    dt = clamp(dt, 0, 0.05);
    this.shake = Math.max(0, this.shake - dt * 8);
    this.displayScore = lerp(this.displayScore, this.score, 1 - Math.pow(0.001, dt));
    for (const b of this.banners) b.life -= dt;
    this.banners = this.banners.filter((b) => b.life > 0);

    this.combo -= dt;
    if (this.combo <= 0) {
      this.multiplier = Math.max(1, this.multiplier - dt * 1.6);
      this.combo = 0;
    }

    this.phaseT -= dt;
    if (this.phase === "prep" && this.phaseT <= 0) this.startWave();

    this.controlPlayers(dt, input);
    if (this.phase === "wave") this.spawnWave(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updatePlaces();
    this.updatePickups();
    this.updateBlood(dt);
    this.updateParticles(dt);
    this.updateCamera(dt);

    if (this.phase === "wave" && this.toSpawnZ <= 0 && this.toSpawnD <= 0 && this.enemies.length === 0) {
      this.startPrep();
    }
    if (this.livingPlayers().length === 0) {
      this.over = true;
      this.phase = "over";
      this.audio.death();
    }
  }

  private controlPlayers(dt: number, input: Input): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      p.hurt = Math.max(0, p.hurt - dt);
      p.fireCd = Math.max(0, p.fireCd - dt);
      p.fireAnim = Math.max(0, p.fireAnim - dt * 8);
      if (p.hurt <= 0) p.hp = Math.min(p.maxHp, p.hp + (p.maxHp / 15) * dt);
      const i = p.playerIndex ?? 0;
      const mx = i === 0 ? input.axis("a", "d") : input.axis("ArrowLeft", "ArrowRight");
      const my = i === 0 ? input.axis("w", "s") : input.axis("ArrowUp", "ArrowDown");
      const d = snap8(mx, my);
      if (d.x !== 0 || d.y !== 0) {
        p.dirX = d.x;
        p.dirY = d.y;
        this.move(p, d.x * p.speed * dt, d.y * p.speed * dt);
      }
      this.handleWeaponSelect(p, i, input);
      const shoot =
        i === 0
          ? input.held("Space") || input.just("Space")
          : input.held("Enter") || input.just("Enter") || input.held("Control");
      if (shoot) this.tryFire(p);
    }
  }

  private handleWeaponSelect(p: Actor, i: number, input: Input): void {
    const unlocked = WEAPONS.filter((w) => this.unlocked.has(w.id));
    const idx = unlocked.findIndex((w) => w.id === p.weapon);
    const cycle = (dir: number) => {
      const n = unlocked[(idx + dir + unlocked.length) % unlocked.length];
      p.weapon = n.id;
    };
    if (i === 0) {
      if (input.just("q") || input.just("Q")) cycle(-1);
      if (input.just("e") || input.just("E")) cycle(1);
      for (let n = 1; n <= 9; n++) {
        if (input.just(String(n))) {
          const w = WEAPONS[n - 1];
          if (w && this.unlocked.has(w.id)) p.weapon = w.id;
        }
      }
    } else {
      if (input.just(",") || input.just("NumpadSubtract")) cycle(-1);
      if (input.just(".") || input.just("NumpadAdd")) cycle(1);
      for (let n = 1; n <= 9; n++) {
        if (input.just(`Numpad${n}`)) {
          const w = WEAPONS[n - 1];
          if (w && this.unlocked.has(w.id)) p.weapon = w.id;
        }
      }
    }
  }

  private tryFire(p: Actor): void {
    const id = p.weapon ?? "pistol";
    const def = WEAPON_BY_ID[id];
    if (p.fireCd > 0) return;
    if (!def.infinite && (p.ammo[id] ?? 0) <= 0) return;
    p.fireCd = 1 / (def.fireRate * this.fireMul);
    p.fireAnim = 1;
    if (!def.infinite) p.ammo[id] = (p.ammo[id] ?? 0) - 1;

    const ox = p.x + p.dirX * (p.r + 8);
    const oy = p.y + p.dirY * (p.r + 8);

    if (def.place) {
      this.place(id, ox, oy, p);
      return;
    }

    if (id === "pistol" || id === "uzi") {
      const spd = id === "uzi" ? 720 : 640;
      this.spawnTracer(ox, oy, p.dirX * spd, p.dirY * spd, {
        r: 2,
        dmg: (id === "uzi" ? 7 : 13) * this.dmgMul,
        life: (id === "uzi" ? 0.55 : 0.7) * this.rangeMul,
        pierce: 0,
        kind: "bullet",
        owner: p.id,
        streak: id === "uzi" ? 16 : 22,
      });
      this.audio.shoot(false);
      this.muzzle(ox, oy, p.dirX, p.dirY, "#222222");
    } else if (id === "shotgun") {
      for (let i = -2; i <= 2; i++) {
        const a = Math.atan2(p.dirY, p.dirX) + i * 0.12;
        this.spawnTracer(ox, oy, Math.cos(a) * 620, Math.sin(a) * 620, {
          r: 2,
          dmg: 9 * this.dmgMul,
          life: 0.22 * this.rangeMul,
          pierce: 0,
          kind: "pellet",
          owner: p.id,
          streak: 14,
        });
      }
      this.audio.shoot(true);
      this.muzzle(ox, oy, p.dirX, p.dirY, "#222222");
    } else if (id === "grenade") {
      this.spawnTracer(ox, oy, p.dirX * 260, p.dirY * 260, {
        r: 7,
        dmg: 55 * this.dmgMul,
        life: 1.15,
        pierce: 0,
        kind: "grenade",
        owner: p.id,
        streak: 8,
      });
      this.audio.shoot(true);
    } else if (id === "rocket") {
      this.spawnTracer(ox, oy, p.dirX * 420, p.dirY * 420, {
        r: 4,
        dmg: 70 * this.dmgMul,
        life: 1.2 * this.rangeMul,
        pierce: 0,
        kind: "rocket",
        owner: p.id,
        streak: 28,
      });
      this.audio.shoot(true);
    } else if (id === "railgun") {
      this.rail(p, ox, oy);
      this.audio.shoot(true);
    }
  }

  private spawnTracer(
    x: number,
    y: number,
    vx: number,
    vy: number,
    extra: Omit<Bullet, "x" | "y" | "vx" | "vy" | "px" | "py" | "friendly">,
  ): void {
    this.bullets.push({
      x,
      y,
      vx,
      vy,
      px: x,
      py: y,
      friendly: true,
      ...extra,
    });
  }

  private rail(p: Actor, x: number, y: number): void {
    const steps = Math.round(70 * this.rangeMul);
    let px = x;
    let py = y;
    const hit = new Set<number>();
    for (let i = 0; i < steps; i++) {
      px += p.dirX * 18;
      py += p.dirY * 18;
      if (this.hitsWall(px, py, 2)) break;
      for (const e of this.enemies) {
        if (hit.has(e.id)) continue;
        if (len(e.x - px, e.y - py) < e.r + 6) {
          hit.add(e.id);
          this.hurtEnemy(e, 85 * this.dmgMul, p, p.dirX, p.dirY);
        }
      }
    }
    this.bullets.push({
      x: px,
      y: py,
      vx: 0,
      vy: 0,
      px: x,
      py: y,
      r: 2,
      dmg: 0,
      life: 0.08,
      pierce: 99,
      friendly: true,
      kind: "rail",
      owner: p.id,
      streak: 40,
    });
    this.shake = Math.max(this.shake, 5);
  }

  private place(id: WeaponId, x: number, y: number, p: Actor): void {
    if (this.hitsWall(x, y, 10)) {
      p.ammo[id] = (p.ammo[id] ?? 0) + 1;
      return;
    }
    if (id === "barrel") {
      this.places.push({ x, y, r: 12, kind: "barrel", hp: 20, dirX: p.dirX, dirY: p.dirY });
    } else if (id === "claymore") {
      this.places.push({ x, y, r: 10, kind: "claymore", hp: 15, dirX: p.dirX, dirY: p.dirY });
    } else if (id === "wall") {
      this.places.push({
        x,
        y,
        r: 16,
        kind: "wall",
        hp: 90,
        dirX: p.dirX,
        dirY: p.dirY,
        w: 46,
        h: 14,
      });
    }
  }

  private spawnWave(dt: number): void {
    this.spawnCd -= dt;
    if (this.spawnCd > 0) return;
    if (this.toSpawnZ <= 0 && this.toSpawnD <= 0) return;
    const door = pick(this.map.spawns);
    if (!door) return;
    const jitter = rand(-18, 18);
    const x = door.x + door.inX * 8 + door.inY * jitter;
    const y = door.y + door.inY * 8 - door.inX * jitter;
    if (this.toSpawnD > 0 && (this.toSpawnZ <= 0 || Math.random() < 0.22)) {
      const d = this.actor("devil", x, y, 16, 170 + this.wave * 12, 50 + (this.wave - 1) * 4, "#b42828");
      d.dirX = door.inX;
      d.dirY = door.inY;
      d.fireCd = rand(0.6, 1.4);
      this.enemies.push(d);
      this.toSpawnD--;
    } else if (this.toSpawnZ > 0) {
      const z = this.actor(
        "zombie",
        x,
        y,
        11,
        22 + this.wave,
        this.zombieSpeed(),
        pick(["#5a7a38", "#4e6e30", "#6a843c"]),
      );
      z.dirX = door.inX;
      z.dirY = door.inY;
      this.enemies.push(z);
      this.toSpawnZ--;
    }
    this.spawnCd = Math.max(0.12, 0.42 - this.wave * 0.02);
  }

  private updateEnemies(dt: number): void {
    const targets = this.livingPlayers();
    if (targets.length === 0) return;
    const wind = this.meleeWindup();
    for (const e of this.enemies) {
      e.hurt = Math.max(0, e.hurt - dt);
      e.fireCd = Math.max(0, e.fireCd - dt);
      e.faceLock = Math.max(0, e.faceLock - dt);
      e.attackCd = Math.max(0, e.attackCd - dt);
      e.attackSwing = Math.max(0, e.attackSwing - dt);

      let nearest = targets[0];
      let best = Infinity;
      for (const t of targets) {
        const d = len(t.x - e.x, t.y - e.y);
        if (d < best) {
          best = d;
          nearest = t;
        }
      }

      const winding = e.attackWind > 0 || e.attackSwing > 0;
      if (e.faceLock <= 0 && !winding) {
        const seek = snap8(nearest.x - e.x, nearest.y - e.y);
        if (seek.x !== 0 || seek.y !== 0) {
          e.dirX = seek.x;
          e.dirY = seek.y;
        }
      }

      let sx = 0;
      let sy = 0;
      for (const o of this.enemies) {
        if (o === e) continue;
        const dx = e.x - o.x;
        const dy = e.y - o.y;
        const d = len(dx, dy);
        if (d > 0 && d < e.r + o.r + 4) {
          sx += dx / d;
          sy += dy / d;
        }
      }
      const sep = snap8(sx, sy);
      const mx = e.dirX * 0.85 + sep.x * 0.15;
      const my = e.dirY * 0.85 + sep.y * 0.15;
      const m = snap8(mx, my);
      const slow = winding ? 0.22 : 1;
      this.move(e, m.x * e.speed * dt * slow, m.y * e.speed * dt * slow);

      if (e.kind === "devil" && e.fireCd <= 0 && best < 520 && !winding) {
        e.fireCd = 1.7;
        const dir = snap8(nearest.x - e.x, nearest.y - e.y);
        this.bullets.push({
          x: e.x + dir.x * 18,
          y: e.y + dir.y * 18,
          vx: dir.x * 210,
          vy: dir.y * 210,
          px: e.x + dir.x * 18,
          py: e.y + dir.y * 18,
          r: 8,
          dmg: 28,
          life: 2.4,
          pierce: 0,
          friendly: false,
          kind: "fireball",
          streak: 10,
        });
        this.audio.fireball();
      }

      this.updateMelee(e, nearest, dt, wind);

      if (e.attackWind > 0) {
        e.attackAnim = -0.9 * (1 - e.attackWind / e.attackWindMax);
      } else if (e.attackSwing > 0) {
        e.attackAnim = lerp(-0.9, 1.15, 1 - e.attackSwing / 0.14);
      } else {
        e.attackAnim = lerp(e.attackAnim, 0, 1 - Math.pow(0.0002, dt));
      }
    }
  }

  private updateMelee(e: Actor, target: Actor, dt: number, wind: number): void {
    const reach = e.r + target.r + 6;
    const inRange = len(target.x - e.x, target.y - e.y) < reach;
    if (e.attackSwing > 0) return;
    if (e.attackWind > 0) {
      e.attackWind -= dt;
      if (e.attackWind <= 0) {
        e.attackWind = 0;
        e.attackSwing = 0.14;
        e.attackCd = 0.28;
        if (len(target.x - e.x, target.y - e.y) < reach + 10) {
          this.hurtPlayer(target, e.kind === "devil" ? 22 : 16);
        }
      }
      return;
    }
    if (inRange && e.attackCd <= 0) {
      const face = snap8(target.x - e.x, target.y - e.y);
      if (face.x !== 0 || face.y !== 0) {
        e.dirX = face.x;
        e.dirY = face.y;
      }
      e.attackWindMax = wind;
      e.attackWind = wind;
      e.faceLock = wind + 0.14;
    }
  }

  private updateBullets(dt: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.px = b.x;
      b.py = b.y;
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.kind === "grenade") {
        b.vx *= 0.995;
        b.vy *= 0.995;
      }
      const wallHit = this.hitsWall(b.x, b.y, b.r);
      let dead = b.life <= 0 || (wallHit && b.kind !== "grenade" && b.kind !== "rail");
      if (wallHit && b.kind === "grenade") {
        if (this.hitsWall(b.x - b.vx * dt, b.y, b.r)) b.vx *= -0.4;
        if (this.hitsWall(b.x, b.y - b.vy * dt, b.r)) b.vy *= -0.4;
      }

      if (b.kind === "grenade" && b.life <= 0) {
        this.explode(b.x, b.y, 88, 55, b.owner);
        dead = true;
      }
      if (b.kind === "rocket" && (dead || this.hitEnemy(b))) {
        this.explode(b.x, b.y, 100, 70, b.owner);
        dead = true;
      } else if (b.kind === "fireball") {
        for (const p of this.livingPlayers()) {
          if (len(p.x - b.x, p.y - b.y) < p.r + b.r) {
            this.hurtPlayer(p, b.dmg);
            this.spark(b.x, b.y, "#ff7a2a", 8);
            dead = true;
          }
        }
        if (this.hitFriendlyBullet(b)) {
          this.spark(b.x, b.y, "#ffaa55", 6);
          dead = true;
        }
      } else if (b.friendly && b.kind !== "rocket" && b.kind !== "grenade" && b.kind !== "rail") {
        if (this.hitEnemy(b) && b.pierce <= 0) dead = true;
        this.hitPlaces(b);
      }

      if (b.kind === "grenade") {
        for (const e of this.enemies) {
          if (len(e.x - b.x, e.y - b.y) < e.r + b.r) {
            this.explode(b.x, b.y, 88, 55, b.owner);
            dead = true;
            break;
          }
        }
      }

      if (dead) this.bullets.splice(i, 1);
    }
  }

  private hitFriendlyBullet(b: Bullet): boolean {
    for (const o of this.bullets) {
      if (!o.friendly || o === b) continue;
      if (len(o.x - b.x, o.y - b.y) < o.r + b.r + 4) {
        o.life = 0;
        return true;
      }
    }
    return false;
  }

  private hitEnemy(b: Bullet): boolean {
    for (const e of this.enemies) {
      if (len(e.x - b.x, e.y - b.y) < e.r + b.r) {
        const owner = this.players.find((p) => p.id === b.owner);
        this.hurtEnemy(e, b.dmg, owner, b.vx, b.vy);
        b.pierce--;
        return true;
      }
    }
    return false;
  }

  private hitPlaces(b: Bullet): void {
    for (const pl of this.places) {
      if (pl.kind === "barrel" && len(pl.x - b.x, pl.y - b.y) < pl.r + b.r) {
        this.explode(pl.x, pl.y, 96, 90, b.owner);
        pl.hp = 0;
        b.life = 0;
      }
    }
  }

  private updatePlaces(): void {
    for (let i = this.places.length - 1; i >= 0; i--) {
      const pl = this.places[i];
      if (pl.kind === "claymore") {
        for (const e of this.enemies) {
          const dx = e.x - pl.x;
          const dy = e.y - pl.y;
          const d = len(dx, dy);
          if (d < 78) {
            const nd = norm(dx, dy);
            const dot = nd.x * pl.dirX + nd.y * pl.dirY;
            if (dot > 0.35) {
              this.explode(pl.x, pl.y, 80, 75);
              pl.hp = 0;
              break;
            }
          }
        }
      }
      if (pl.kind === "wall") {
        const rect = this.wallRect(pl);
        for (const e of this.enemies) {
          if (circleRect(e.x, e.y, e.r, rect)) {
            pl.hp -= 18 * (1 / 60);
            const pushed = resolveCircleRect(e.x, e.y, e.r, rect);
            if (pushed) {
              e.x = pushed.x;
              e.y = pushed.y;
            }
          }
        }
        for (const p of this.livingPlayers()) {
          if (circleRect(p.x, p.y, p.r, rect)) {
            const pushed = resolveCircleRect(p.x, p.y, p.r, rect);
            if (pushed) {
              p.x = pushed.x;
              p.y = pushed.y;
            }
          }
        }
      }
      if (pl.hp <= 0) this.places.splice(i, 1);
    }
  }

  wallRect(pl: Placeable): Rect {
    const w = pl.w ?? 46;
    const h = pl.h ?? 14;
    if (Math.abs(pl.dirX) > Math.abs(pl.dirY)) {
      return { x: pl.x - h / 2, y: pl.y - w / 2, w: h, h: w };
    }
    return { x: pl.x - w / 2, y: pl.y - h / 2, w, h };
  }

  private updatePickups(): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      for (const p of this.livingPlayers()) {
        if (len(p.x - pk.x, p.y - pk.y) < p.r + pk.r) {
          this.giveLoot(p);
          this.audio.pickup();
          this.pickups.splice(i, 1);
          break;
        }
      }
    }
  }

  private giveLoot(p: Actor): void {
    const pool = WEAPONS.filter((w) => this.unlocked.has(w.id) && !w.infinite);
    if (pool.length === 0) {
      p.hp = Math.min(p.maxHp, p.hp + 25);
      return;
    }
    const w = pick(pool);
    p.ammo[w.id] = (p.ammo[w.id] ?? 0) + w.grant;
    this.banner(`${w.name.toUpperCase()} +${w.grant}`, 1.4);
  }

  private updateBlood(dt: number): void {
    for (const b of this.blood) {
      b.a -= dt * 0.035;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= 0.9;
      b.vy *= 0.9;
    }
    this.blood = this.blood.filter((b) => b.a > 0);
    if (this.blood.length > 520) this.blood.splice(0, this.blood.length - 520);
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private updateCamera(dt: number): void {
    const living = this.livingPlayers();
    if (living.length === 0) return;
    let x = 0;
    let y = 0;
    for (const p of living) {
      x += p.x;
      y += p.y;
    }
    x /= living.length;
    y /= living.length;
    this.cam.x = lerp(this.cam.x, x, 1 - Math.pow(0.0008, dt));
    this.cam.y = lerp(this.cam.y, y, 1 - Math.pow(0.0008, dt));
  }

  private move(a: Actor, dx: number, dy: number): void {
    a.x += dx;
    this.separateWalls(a);
    a.y += dy;
    this.separateWalls(a);
    a.x = clamp(a.x, a.r, this.map.width - a.r);
    a.y = clamp(a.y, a.r, this.map.height - a.r);
  }

  private separateWalls(a: Actor): void {
    for (const w of this.map.walls) {
      const p = resolveCircleRect(a.x, a.y, a.r, w);
      if (p) {
        a.x = p.x;
        a.y = p.y;
      }
    }
    for (const pl of this.places) {
      if (pl.kind !== "wall") continue;
      const p = resolveCircleRect(a.x, a.y, a.r, this.wallRect(pl));
      if (p) {
        a.x = p.x;
        a.y = p.y;
      }
    }
  }

  hitsWall(x: number, y: number, r: number): boolean {
    for (const w of this.map.walls) {
      if (circleRect(x, y, r, w)) return true;
    }
    for (const pl of this.places) {
      if (pl.kind === "wall" && circleRect(x, y, r, this.wallRect(pl))) return true;
    }
    return false;
  }

  private explode(x: number, y: number, radius: number, dmg: number, ownerId?: number): void {
    this.shake = Math.max(this.shake, 7);
    this.audio.explode();
    this.spark(x, y, "#ffb347", 18);
    this.spark(x, y, "#ff5a2a", 10);
    const owner = this.players.find((p) => p.id === ownerId);
    for (const e of [...this.enemies]) {
      const d = len(e.x - x, e.y - y);
      if (d < radius + e.r) {
        this.hurtEnemy(e, dmg * (1 - d / (radius + 40)), owner, e.x - x, e.y - y);
      }
    }
    for (const p of this.livingPlayers()) {
      const d = len(p.x - x, p.y - y);
      if (d < radius * 0.7 + p.r) this.hurtPlayer(p, dmg * 0.35);
    }
    const chained: Placeable[] = [];
    for (const pl of this.places) {
      if (pl.kind !== "barrel" || pl.hp <= 0) continue;
      if (len(pl.x - x, pl.y - y) < radius && (Math.abs(pl.x - x) > 1 || Math.abs(pl.y - y) > 1)) {
        pl.hp = 0;
        chained.push(pl);
      }
    }
    for (const pl of chained) this.explode(pl.x, pl.y, 96, 90, ownerId);
  }

  private hurtEnemy(e: Actor, dmg: number, owner?: Actor, dirX = 0, dirY = 0): void {
    e.hp -= dmg;
    e.hurt = 0.08;
    const turn = snap8(dirX, dirY);
    if (turn.x !== 0 || turn.y !== 0) {
      e.dirX = turn.x;
      e.dirY = turn.y;
      e.faceLock = 0.22;
      this.move(e, turn.x * 8, turn.y * 8);
    }
    this.audio.hit();
    if (e.hp <= 0) {
      this.killEnemy(e, owner);
    }
  }

  private killEnemy(e: Actor, owner?: Actor): void {
    e.alive = false;
    this.enemies = this.enemies.filter((x) => x !== e);
    this.splatter(e.x, e.y, e.kind === "devil" ? 18 : 10);
    if (owner) owner.kills++;
    this.combo = this.comboMax;
    this.multiplier = Math.min(12, this.multiplier + (e.kind === "devil" ? 0.6 : 0.25));
    const base = e.kind === "devil" ? 500 : 100;
    this.score += Math.round(base * this.multiplier);
    this.checkUpgrades();
    if (e.kind === "devil") {
      this.pickups.push({ x: e.x, y: e.y, r: 12, life: 40 });
    }
  }

  private checkUpgrades(): void {
    while (this.upgradeStep < UPGRADE_COUNT && this.score >= upgradeScore(this.upgradeStep + 1)) {
      this.upgradeStep += 1;
      const ev = this.track[this.upgradeStep - 1];
      if (!ev) break;
      if (ev.type === "weapon") {
        if (!this.unlocked.has(ev.id)) {
          this.unlocked.add(ev.id);
          const def = WEAPON_BY_ID[ev.id];
          for (const p of this.players) p.ammo[ev.id] = (p.ammo[ev.id] ?? 0) + def.ammo;
          this.banner(`${def.name.toUpperCase()} UNLOCKED`);
          this.audio.unlock();
        }
      } else {
        this.statSteps[ev.stat] += 1;
        if (ev.stat === "range") {
          this.rangeMul *= 1.06;
          this.banner("RANGE UP");
        } else if (ev.stat === "fireRate") {
          this.fireMul *= 1.07;
          this.banner("FIRE RATE UP");
        } else {
          this.dmgMul *= 1.07;
          this.banner("DAMAGE UP");
        }
        this.audio.unlock();
      }
    }
  }

  private hurtPlayer(p: Actor, dmg: number): void {
    if (p.hurt > 0) return;
    p.hp -= dmg;
    p.hurt = 0.45;
    this.shake = Math.max(this.shake, 4);
    this.splatter(p.x, p.y, 4);
    if (p.hp <= 0) {
      p.alive = false;
      p.hp = 0;
      this.splatter(p.x, p.y, 16);
    }
  }

  private splatter(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(6, 18);
      this.blood.push({
        x: x + Math.cos(a) * rand(0, 16),
        y: y + Math.sin(a) * rand(0, 16),
        s,
        a: rand(0.55, 0.95),
        rot: a,
        vx: Math.cos(a) * rand(10, 70),
        vy: Math.sin(a) * rand(10, 70),
      });
    }
  }

  private spark(x: number, y: number, color: string, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(40, 220);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.15, 0.45),
        max: 0.45,
        size: rand(2, 5),
        color,
      });
    }
  }

  private muzzle(x: number, y: number, dx: number, dy: number, color: string): void {
    this.particles.push({
      x: x + dx * 6,
      y: y + dy * 6,
      vx: dx * 40,
      vy: dy * 40,
      life: 0.06,
      max: 0.06,
      size: 8,
      color,
    });
  }
}
