import { AudioFx } from "./audio";
import { updateEnemies } from "./ai";
import type {
  Actor,
  AIState,
  Banner,
  Blood,
  Bullet,
  BulletKind,
  Corpse,
  FloatText,
  Hazard,
  Light,
  Particle,
  Pickup,
  Placeable,
  Ring,
} from "./entities";
import { type Controls, Input } from "./input";
import { type Vec, clamp, len, lerp, norm, pick, rand, snap8 } from "./math";
import type { GameMap } from "./maps/types";
import { DIFFICULTY, type Settings } from "./settings";
import { SpatialHash } from "./spatial";
import { computeVision } from "./vision";
import {
  type StatId,
  type UpgradeEvent,
  type WeaponId,
  UPGRADE_COUNT,
  WEAPON_BY_ID,
  WEAPONS,
  buildUpgradeTrack,
  upgradeScore,
} from "./weapons";
import { World } from "./world";
import { ZOMBIES, type ZombieKind } from "./zombies";

export type Phase = "prep" | "wave" | "explore" | "extract" | "over" | "won";

export type RunStats = {
  kills: Partial<Record<ZombieKind, number>>;
  shots: number;
  hits: number;
  damageTaken: number;
  objectives: number;
  hordes: number;
  bossKills: number;
};

const PLAYER_SPEED = 205;
const PLAYER_LIGHT = 430;
const REVIVE_TIME = 2.6;
const BLEED_TIME = 28;

export class Game {
  map: GameMap;
  world: World;
  mode: GameMap["mode"];
  coop: boolean;
  settings: Settings;
  diff: (typeof DIFFICULTY)["normal"];
  /** Index of this map in the campaign (0-based) – scales expedition difficulty. */
  level: number;

  players: Actor[] = [];
  enemies: Actor[] = [];
  bullets: Bullet[] = [];
  places: Placeable[] = [];
  pickups: Pickup[] = [];
  hazards: Hazard[] = [];
  corpses: Corpse[] = [];
  blood: Blood[] = [];
  particles: Particle[] = [];
  texts: FloatText[] = [];
  lights: Light[] = [];
  rings: Ring[] = [];
  banners: Banner[] = [];
  vision: Float32Array[] = [];
  lampVision: { x: number; y: number; poly: Float32Array }[] = [];

  score = 0;
  displayScore = 0;
  multiplier = 1;
  combo = 0;
  comboMax = 2.6;
  time = 0;
  wave = 0;
  phase: Phase = "prep";
  phaseT = 0;
  over = false;
  won = false;

  // Survival director
  spawnQueue: ZombieKind[] = [];
  spawnCd = 0;

  // Expedition director
  objectivesTotal = 0;
  objectivesGot = 0;
  hordeT = 0;
  hordeIndex = 0;
  hordeWarned = false;
  hordeQueue: ZombieKind[] = [];
  hordeDoors: number[] = [];
  trickleT = 30;
  extractT = 0;
  extractNeed = 6;
  roamTarget = 0;
  intensity = 0;

  boss: Actor | null = null;
  cam = { x: 0, y: 0, zoom: 1 };
  viewW = 1100;
  viewH = 720;
  shake = 0;
  flash = 0;
  hitStop = 0;
  heartT = 0;

  unlocked = new Set<WeaponId>(["pistol"]);
  upgradeStep = 0;
  rangeMul = 1;
  fireMul = 1;
  dmgMul = 1;
  statSteps: Record<StatId, number> = { range: 0, fireRate: 0, damage: 0 };
  track: UpgradeEvent[] = buildUpgradeTrack();
  stats: RunStats = { kills: {}, shots: 0, hits: 0, damageTaken: 0, objectives: 0, hordes: 0, bossKills: 0 };

  hash = new SpatialHash<Actor>(64);
  flowT = 0;
  private flowVersion = -1;
  private lastFlowTiles = "";
  pathBudget = 0;
  private nextId = 1;
  audio: AudioFx;

  constructor(map: GameMap, coop: boolean, audio: AudioFx, settings: Settings, level = 0) {
    this.map = map;
    this.world = new World(map);
    this.mode = map.mode;
    this.coop = coop;
    this.audio = audio;
    this.settings = settings;
    this.diff = DIFFICULTY[settings.difficulty];
    this.level = level;
    this.spawnPlayers();
    this.cam.x = this.players[0].x;
    this.cam.y = this.players[0].y;
    for (const b of map.barrels) {
      this.places.push({ x: b.x, y: b.y, r: 12, kind: "barrel", hp: 20, dirX: 0, dirY: 1, owner: 0, armed: 0 });
    }
    for (const s of map.supplies) this.pickups.push({ x: s.x, y: s.y, r: 14, kind: "supply", life: Infinity, bob: rand(0, 6) });
    if (map.darkness > 0) {
      for (const l of map.lamps) {
        this.lampVision.push({ x: l.x, y: l.y, poly: computeVision(this.world, l.x, l.y, 240, 180, false) });
      }
    }
    if (this.mode === "survival") {
      this.startPrep();
    } else {
      this.setupExpedition();
    }
  }

  get darkness(): number {
    return this.map.darkness;
  }

  // ───────────────────────────── setup ─────────────────────────────

  private spawnPlayers(): void {
    const colors = ["#4aa3d8", "#4ecf7a"];
    const n = this.coop ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const p = this.map.starts[i] ?? this.map.starts[0];
      const a = this.actor("player", "walker", p.x, p.y, 12, 100, PLAYER_SPEED, colors[i]);
      a.size = 12;
      a.lift = 14;
      a.playerIndex = i;
      a.weapon = "pistol";
      a.ammo = { pistol: 9999 };
      a.dirX = 0;
      a.dirY = -1;
      this.players.push(a);
    }
  }

  actor(kind: Actor["kind"], ztype: ZombieKind, x: number, y: number, r: number, hp: number, speed: number, color: string): Actor {
    return {
      id: this.nextId++,
      kind,
      ztype,
      x,
      y,
      r,
      size: r,
      lift: 11,
      hp,
      maxHp: hp,
      dirX: 0,
      dirY: 1,
      vx: 0,
      vy: 0,
      kx: 0,
      ky: 0,
      speed,
      color,
      hurt: 0,
      alive: true,
      kills: 0,
      fireCd: 0,
      fireAnim: 0,
      walkT: rand(0, 10),
      playerIndex: 0,
      weapon: "pistol",
      ammo: {},
      downed: false,
      bleed: 0,
      revive: 0,
      shoveCd: 0,
      shoveAnim: 0,
      damageTaken: 0,
      everDowned: false,
      state: "idle",
      stateT: rand(1, 4),
      targetId: 0,
      lastSeen: { x, y },
      memoryT: 0,
      path: [],
      pathGoal: null,
      home: { x, y },
      thinkT: rand(0, 0.3),
      mark: "",
      markT: 0,
      attackWind: 0,
      attackWindMax: 1,
      attackSwing: 0,
      attackCd: 0,
      attackAnim: 0,
      barricade: -1,
      ability: { name: "", phase: "", t: 0, dirX: 0, dirY: 0 },
      abilityCd: rand(1, 3),
      altCd: rand(1, 3),
      summonCd: 8,
      stun: 0,
      enraged: 0,
      flank: (Math.random() < 0.5 ? -1 : 1) * rand(0.5, 1),
      stuckT: 0,
      lastX: x,
      lastY: y,
      groanT: rand(2, 8),
      seen: 0,
      visible: true,
      sleeping: false,
      sees: false,
      goal: null,
      smash: -1,
      hitSet: null,
    };
  }

  /** Threat level used to scale zombie stats. */
  threat(): number {
    if (this.mode === "survival") return this.wave;
    return 1 + this.level * 0.8 + this.hordeIndex * 0.9 + this.time / 150;
  }

  spawnZombie(kind: ZombieKind, x: number, y: number, state: AIState, memory = 0): Actor {
    const def = ZOMBIES[kind];
    const th = Math.max(1, this.threat());
    const hpScale = (1 + (th - 1) * 0.045) * this.diff.hp * (this.coop ? 1.15 : 1);
    const hp = kind === "boss" ? def.hp * this.diff.hp * (this.coop ? 1.5 : 1) * (1 + this.level * 0.08) : def.hp * hpScale;
    const z = this.actor("zombie", kind, x, y, def.r, Math.round(hp), def.chaseSpeed, pick(def.colors));
    z.size = def.size;
    z.lift = def.lift;
    z.speed = def.chaseSpeed * Math.min(1.4, 1 + (th - 1) * 0.022) * this.diff.speed * rand(0.92, 1.08);
    z.state = state;
    z.memoryT = memory;
    z.dirX = rand(-1, 1);
    z.dirY = rand(-1, 1);
    const d = norm(z.dirX, z.dirY);
    z.dirX = d.x || 1;
    z.dirY = d.y;
    if (state === "dormant") z.seen = 1;
    this.enemies.push(z);
    if (kind === "boss") this.boss = z;
    return z;
  }

  private setupExpedition(): void {
    const m = this.map;
    this.phase = "explore";
    this.objectivesTotal = m.objectives.length;
    for (const o of m.objectives) this.pickups.push({ x: o.x, y: o.y, r: 14, kind: "objective", life: Infinity, bob: rand(0, 6) });
    this.hordeT = (m.hordeInterval ?? 90) * 1.15;
    this.roamTarget = Math.round(((m.roamers ?? 12) + m.nests.length * 4) * this.diff.count);
    const start = m.starts[0];
    const safe = (p: Vec) => len(p.x - start.x, p.y - start.y) > 360;
    const lv = this.level;
    const nestPool = (): ZombieKind => {
      const r = Math.random();
      if (lv >= 2 && r < 0.08) return "spitter";
      if (lv >= 3 && r < 0.14) return "bloater";
      if (lv >= 1 && r < 0.3) return "runner";
      if (lv >= 4 && r < 0.36) return "brute";
      if (lv >= 4 && r < 0.4) return "screamer";
      return "walker";
    };
    for (const n of m.nests) {
      if (!safe(n)) continue;
      const count = Math.round(rand(3, 6) * this.diff.count);
      for (let i = 0; i < count; i++) {
        const p = this.world.randomOpenNear(n.x, n.y, 2) ?? n;
        const z = this.spawnZombie(i === 0 && lv >= 3 && Math.random() < 0.4 ? pick(["brute", "screamer", "spitter"] as ZombieKind[]) : nestPool(), p.x + rand(-6, 6), p.y + rand(-6, 6), Math.random() < 0.7 ? "idle" : "wander");
        z.home = { x: n.x, y: n.y };
      }
    }
    for (const s of m.singles) {
      if (!safe(s)) continue;
      const r = Math.random();
      if (r < 0.3) this.spawnZombie("crawler", s.x, s.y, "dormant");
      else this.spawnZombie(r < 0.45 && lv >= 1 ? "runner" : "walker", s.x, s.y, Math.random() < 0.5 ? "idle" : "wander");
    }
    for (const b of m.bosses) {
      const z = this.spawnZombie("boss", b.x, b.y, "idle");
      z.home = { x: b.x, y: b.y };
    }
    this.boss = null;
    // Random roamers anywhere far from the start.
    const roam = Math.round((m.roamers ?? 10) * this.diff.count);
    for (let i = 0; i < roam; i++) {
      const p = this.randomFarFloor(start, 520);
      if (!p) continue;
      const r = Math.random();
      const kind: ZombieKind = r < 0.12 && lv >= 1 ? "runner" : r < 0.18 ? "crawler" : r < 0.22 && lv >= 2 ? "spitter" : "walker";
      this.spawnZombie(kind, p.x, p.y, kind === "crawler" ? "dormant" : "wander");
    }
    this.banner(`FIND ${this.objectivesTotal} × ${m.objectiveLabel ?? "ITEM"}`, 3.6, "Then reach the extraction pad", "info");
  }

  randomFarFloor(from: Vec, minDist: number, tries = 40): Vec | null {
    const w = this.world;
    for (let i = 0; i < tries; i++) {
      const tx = Math.floor(rand(1, w.cols - 1));
      const ty = Math.floor(rand(1, w.rows - 1));
      if (w.at(tx, ty) !== 0) continue;
      const c = w.center(ty * w.cols + tx);
      if (len(c.x - from.x, c.y - from.y) < minDist) continue;
      return c;
    }
    return null;
  }

  // ───────────────────────────── helpers ─────────────────────────────

  banner(text: string, life = 2.2, sub?: string, tone: Banner["tone"] = "info"): void {
    this.banners.push({ text, life, sub, tone });
  }

  livingPlayers(): Actor[] {
    return this.players.filter((p) => p.alive);
  }

  /** Players who can act (not downed). */
  activePlayers(): Actor[] {
    return this.players.filter((p) => p.alive && !p.downed);
  }

  playerById(id: number): Actor | undefined {
    return this.players.find((p) => p.id === id);
  }

  /** Volume/pan for a world-space sound relative to the camera. */
  spatial(x: number, y: number): { vol: number; pan: number } {
    const dx = x - this.cam.x;
    const dy = y - this.cam.y;
    const d = Math.hypot(dx, dy);
    return { vol: clamp(1 - d / 900, 0, 1), pan: clamp(dx / 600, -0.8, 0.8) };
  }

  addShake(v: number): void {
    this.shake = Math.max(this.shake, v * this.settings.shake);
  }

  floatText(x: number, y: number, text: string, color = "#fff", size = 14): void {
    if (!this.settings.damageNumbers && color !== "#ffd84a") return;
    this.texts.push({ x, y, text, life: 0.9, color, size });
    if (this.texts.length > 60) this.texts.shift();
  }

  light(x: number, y: number, r: number, life: number, color = "255,200,120"): void {
    this.lights.push({ x, y, r, life, max: life, color });
  }

  ring(x: number, y: number, maxR: number, life: number, color: string): void {
    this.rings.push({ x, y, r: 0, maxR, life, max: life, color });
  }

  /** Gunfire / explosions alert zombies that can hear them. */
  emitNoise(x: number, y: number, radius: number): void {
    const near = this.hash.query(x, y, radius * 1.5);
    for (const z of near) {
      if (!z.alive) continue;
      const def = ZOMBIES[z.ztype];
      const d = len(z.x - x, z.y - y);
      const heard = radius * def.hearing * (this.world.los(x, y, z.x, z.y) ? 1 : 0.6);
      if (d > heard) continue;
      if (z.state === "chase") {
        z.memoryT = Math.max(z.memoryT, def.memory * 0.6);
        continue;
      }
      if (z.state === "dormant" && d > heard * 0.5) continue;
      z.state = "investigate";
      z.stateT = 12;
      z.pathGoal = { x: x + rand(-40, 40), y: y + rand(-40, 40) };
      z.path = [];
      z.thinkT = rand(0.05, 0.4);
      z.mark = "?";
      z.markT = 1.4;
    }
  }

  // ───────────────────────────── main update ─────────────────────────────

  update(dt: number, input: Input): void {
    if (this.over) {
      this.displayScore = lerp(this.displayScore, this.score, 1 - Math.pow(0.001, dt));
      this.updateEffects(dt);
      return;
    }
    dt = clamp(dt, 0, 0.05);
    this.shake = Math.max(0, this.shake - dt * 9);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.displayScore = lerp(this.displayScore, this.score, 1 - Math.pow(0.001, dt));
    for (const b of this.banners) b.life -= dt;
    this.banners = this.banners.filter((b) => b.life > 0);
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }
    this.time += dt;

    this.combo -= dt;
    if (this.combo <= 0) {
      this.multiplier = Math.max(1, this.multiplier - dt * 1.6);
      this.combo = 0;
    }

    this.hash.build(this.enemies);
    this.controlPlayers(dt, input);
    this.updateFlow(dt);
    if (this.mode === "survival") this.surviveDirector(dt);
    else this.expeditionDirector(dt);
    this.pathBudget = 10;
    updateEnemies(this, dt);
    this.hash.build(this.enemies);
    this.updateBullets(dt);
    this.updatePlaces(dt);
    this.updateHazards(dt);
    this.updatePickups(dt);
    this.updateVisibility(dt);
    this.updateEffects(dt);
    this.updateCamera(dt);
    this.updateMusic(dt);

    if (this.activePlayers().length === 0) {
      this.over = true;
      this.phase = "over";
      this.audio.death();
      this.audio.setIntensity(0);
    }
  }

  private updateFlow(dt: number): void {
    this.flowT -= dt;
    const targets = this.livingPlayers();
    if (targets.length === 0) return;
    const key = targets.map((p) => this.world.indexOf(p.x, p.y)).join(",");
    const layoutChanged = this.flowVersion !== this.world.layoutVersion;
    const moved = key !== this.lastFlowTiles;
    // Recompute when the layout changes, or when players change tile (throttled).
    if (!layoutChanged && !(moved && this.flowT <= 0)) return;
    this.flowT = 0.12;
    this.lastFlowTiles = key;
    this.flowVersion = this.world.layoutVersion;
    this.world.computeFlow(targets);
  }

  private updateMusic(dt: number): void {
    let want = 0;
    const chasing = this.enemies.filter((e) => e.state === "chase").length;
    want = clamp(chasing / 14, 0, 1);
    if (this.boss && this.boss.alive && this.boss.state === "chase") want = 1;
    if (this.phase === "extract") want = Math.max(want, 0.7);
    this.intensity = lerp(this.intensity, want, 1 - Math.pow(0.3, dt));
    this.audio.setIntensity(this.intensity);
    this.audio.tick(dt);
    const p = this.activePlayers()[0];
    if (p && p.hp / p.maxHp < 0.3) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.9;
        this.audio.heartbeat();
      }
    }
  }

  // ───────────────────────────── players ─────────────────────────────

  private controlPlayers(dt: number, input: Input): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      p.hurt = Math.max(0, p.hurt - dt);
      p.fireCd = Math.max(0, p.fireCd - dt);
      p.fireAnim = Math.max(0, p.fireAnim - dt * 8);
      p.shoveCd = Math.max(0, p.shoveCd - dt);
      p.shoveAnim = Math.max(0, p.shoveAnim - dt * 5);
      const c = input.controls(p.playerIndex, this.coop, this.settings.aim === "mouse" && p.playerIndex === 0, p);

      if (p.downed) {
        p.bleed -= dt;
        // Teammate revive.
        const helper = this.activePlayers().find((o) => o !== p && len(o.x - p.x, o.y - p.y) < 52);
        if (helper) {
          p.revive += dt;
          if (p.revive >= REVIVE_TIME) {
            p.downed = false;
            p.hp = p.maxHp * 0.45;
            p.revive = 0;
            p.hurt = 1.2;
            this.audio.revive();
            this.banner(`P${p.playerIndex + 1} REVIVED`, 1.5, undefined, "good");
          }
        } else {
          p.revive = Math.max(0, p.revive - dt * 0.5);
        }
        if (p.bleed <= 0 && p.downed) {
          p.alive = false;
          this.splatter(p.x, p.y, 16);
          this.banner(`P${p.playerIndex + 1} BLED OUT`, 2, undefined, "warn");
          this.audio.death();
          continue;
        }
        // Crawl slowly, still able to fire the pistol.
        const d = snap8(c.mx, c.my);
        if (d.x || d.y) this.movePlayer(p, d.x * 34 * dt, d.y * 34 * dt);
        if (c.aim) this.face(p, c.aim.x, c.aim.y);
        else if (d.x || d.y) this.face(p, d.x, d.y);
        if (c.fire) this.tryFire(p, "pistol");
        continue;
      }

      if (p.hurt <= 0.1) p.hp = Math.min(p.maxHp, p.hp + (p.maxHp / 40) * dt);
      const d = snap8(c.mx, c.my);
      p.vx = d.x * p.speed;
      p.vy = d.y * p.speed;
      if (d.x !== 0 || d.y !== 0) {
        this.movePlayer(p, d.x * p.speed * dt, d.y * p.speed * dt);
        p.walkT += dt * 10;
        if (!c.aim) this.face(p, d.x, d.y);
      }
      if (c.aim) this.face(p, c.aim.x, c.aim.y);
      this.handleWeaponSelect(p, c);
      if (c.shove) this.shove(p);
      if (c.fire) this.tryFire(p);
    }
    this.leash();
  }

  private face(p: Actor, x: number, y: number): void {
    const d = norm(x, y);
    if (d.x || d.y) {
      p.dirX = d.x;
      p.dirY = d.y;
    }
  }

  private movePlayer(p: Actor, dx: number, dy: number): void {
    p.x += dx;
    p.y += dy;
    this.world.resolveCircle(p);
  }

  /** Keep co-op players within one screen of each other. */
  private leash(): void {
    const ps = this.livingPlayers();
    if (ps.length < 2) return;
    const [a, b] = ps;
    const maxX = this.viewW / 0.62 - 120;
    const maxY = this.viewH / 0.62 - 120;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ox = Math.abs(dx) - maxX;
    const oy = Math.abs(dy) - maxY;
    if (ox > 0) {
      a.x += (Math.sign(dx) * ox) / 2;
      b.x -= (Math.sign(dx) * ox) / 2;
    }
    if (oy > 0) {
      a.y += (Math.sign(dy) * oy) / 2;
      b.y -= (Math.sign(dy) * oy) / 2;
    }
    if (ox > 0 || oy > 0) {
      this.world.resolveCircle(a);
      this.world.resolveCircle(b);
    }
  }

  private handleWeaponSelect(p: Actor, c: Controls): void {
    const unlocked = WEAPONS.filter((w) => this.unlocked.has(w.id));
    const usable = unlocked.filter((w) => w.infinite || (p.ammo[w.id] ?? 0) > 0);
    const list = usable.length ? usable : unlocked;
    const idx = list.findIndex((w) => w.id === p.weapon);
    const cycle = (dir: number) => {
      const n = list[(Math.max(0, idx) + dir + list.length) % list.length];
      p.weapon = n.id;
    };
    if (c.prev) cycle(-1);
    if (c.next) cycle(1);
    if (c.select) {
      const w = WEAPONS[c.select - 1];
      if (w && this.unlocked.has(w.id)) p.weapon = w.id;
    }
  }

  private shove(p: Actor): void {
    if (p.shoveCd > 0) return;
    p.shoveCd = 0.75;
    p.shoveAnim = 1;
    this.audio.shove();
    const near = this.hash.query(p.x, p.y, 80);
    let hit = 0;
    for (const z of near) {
      const dx = z.x - p.x;
      const dy = z.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 50 + z.r) continue;
      const n = norm(dx, dy);
      if (d > 18 && n.x * p.dirX + n.y * p.dirY < 0.1) continue;
      const def = ZOMBIES[z.ztype];
      const k = def.knock;
      z.kx += n.x * 360 * k;
      z.ky += n.y * 360 * k;
      if (z.ability.name === "charge" && z.ability.phase === "act") continue;
      if (z.ztype === "boss") continue;
      z.stun = Math.max(z.stun, z.ztype === "brute" ? 0.25 : 0.7);
      z.attackWind = 0;
      if (z.ability.phase === "prep" && z.ztype !== "bloater") z.ability = { name: "", phase: "", t: 0, dirX: 0, dirY: 0 };
      this.hurtEnemy(z, 5 * this.dmgMul, p, n.x, n.y, false);
      hit++;
    }
    if (hit) this.addShake(2);
    this.emitNoise(p.x, p.y, 140);
  }

  private tryFire(p: Actor, force?: WeaponId): void {
    let id = force ?? p.weapon;
    let def = WEAPON_BY_ID[id];
    if (p.fireCd > 0) return;
    if (!def.infinite && (p.ammo[id] ?? 0) <= 0) {
      // Auto-fallback to pistol when dry.
      id = "pistol";
      def = WEAPON_BY_ID[id];
      p.weapon = "pistol";
    }
    p.fireCd = 1 / (def.fireRate * this.fireMul);
    p.fireAnim = 1;
    if (!def.infinite) p.ammo[id] = (p.ammo[id] ?? 0) - 1;
    this.stats.shots++;

    const ox = p.x + p.dirX * (p.r + 8);
    const oy = p.y + p.dirY * (p.r + 8);

    if (def.place) {
      this.place(id, ox, oy, p);
      return;
    }

    const ang = Math.atan2(p.dirY, p.dirX);
    if (id === "pistol" || id === "uzi") {
      const spd = id === "uzi" ? 760 : 680;
      const spread = id === "uzi" ? rand(-0.06, 0.06) : rand(-0.015, 0.015);
      this.spawnShot(ox, oy, Math.cos(ang + spread) * spd, Math.sin(ang + spread) * spd, {
        r: 2,
        dmg: (id === "uzi" ? 8 : 14) * this.dmgMul,
        life: (id === "uzi" ? 0.55 : 0.7) * this.rangeMul,
        pierce: 0,
        kind: "bullet",
        owner: p.id,
        streak: id === "uzi" ? 16 : 22,
      });
      this.audio.shoot("light");
      this.muzzle(ox, oy, p.dirX, p.dirY);
      this.emitNoise(p.x, p.y, id === "uzi" ? 420 : 360);
    } else if (id === "shotgun") {
      for (let i = -3; i <= 3; i++) {
        const a = ang + i * 0.085 + rand(-0.02, 0.02);
        const spd = rand(560, 660);
        this.spawnShot(ox, oy, Math.cos(a) * spd, Math.sin(a) * spd, {
          r: 2,
          dmg: 9 * this.dmgMul,
          life: 0.26 * this.rangeMul,
          pierce: 1,
          kind: "pellet",
          owner: p.id,
          streak: 14,
        });
      }
      this.audio.shoot("shotgun");
      this.muzzle(ox, oy, p.dirX, p.dirY);
      this.addShake(2.5);
      this.emitNoise(p.x, p.y, 520);
    } else if (id === "grenade") {
      this.spawnShot(ox, oy, p.dirX * 300, p.dirY * 300, {
        r: 6,
        dmg: 60 * this.dmgMul,
        life: 1.1,
        pierce: 0,
        kind: "grenade",
        owner: p.id,
        streak: 8,
      });
      this.audio.shoot("launcher");
    } else if (id === "rocket") {
      this.spawnShot(ox, oy, p.dirX * 440, p.dirY * 440, {
        r: 4,
        dmg: 80 * this.dmgMul,
        life: 1.3 * this.rangeMul,
        pierce: 0,
        kind: "rocket",
        owner: p.id,
        streak: 28,
      });
      this.audio.shoot("launcher");
      this.emitNoise(p.x, p.y, 400);
    } else if (id === "railgun") {
      this.rail(p, ox, oy);
      this.audio.shoot("rail");
      this.emitNoise(p.x, p.y, 460);
    }
  }

  spawnShot(
    x: number,
    y: number,
    vx: number,
    vy: number,
    extra: { r: number; dmg: number; life: number; pierce: number; kind: BulletKind; owner: number; streak: number },
    friendly = true,
  ): Bullet {
    const b: Bullet = { x, y, vx, vy, px: x, py: y, friendly, maxLife: extra.life, ...extra };
    this.bullets.push(b);
    return b;
  }

  private rail(p: Actor, x: number, y: number): void {
    const steps = Math.round(70 * this.rangeMul);
    let px = x;
    let py = y;
    const hit = new Set<number>();
    for (let i = 0; i < steps; i++) {
      px += p.dirX * 14;
      py += p.dirY * 14;
      const ti = this.world.shotTileAt(px, py);
      if (ti >= 0 || ti === -2) {
        if (ti >= 0) this.world.damageBarricade(ti, 60) && this.onBarricadeBroken(ti);
        break;
      }
      for (const e of this.hash.query(px, py, 30)) {
        if (hit.has(e.id) || !e.alive) continue;
        if (len(e.x - px, e.y - py) < e.r + 7) {
          hit.add(e.id);
          this.stats.hits++;
          this.hurtEnemy(e, 95 * this.dmgMul, p, p.dirX, p.dirY);
        }
      }
    }
    this.spawnShot(px, py, 0, 0, { r: 2, dmg: 0, life: 0.12, pierce: 99, kind: "rail", owner: p.id, streak: 40 }).px = x;
    this.bullets[this.bullets.length - 1].py = y;
    this.light(x, y, 160, 0.12, "160,210,255");
    this.addShake(5);
  }

  private place(id: WeaponId, x: number, y: number, p: Actor): void {
    if (id === "wall") {
      // Build a sturdy barricade on the tile in front of the player.
      const fx = p.x + p.dirX * 30;
      const fy = p.y + p.dirY * 30;
      const i = this.world.indexOf(fx, fy);
      const c = this.world.center(i);
      const blocked =
        this.world.grid[i] !== 0 ||
        [...this.players, ...this.enemies].some((a) => a.alive && Math.abs(a.x - c.x) < 16 + a.r && Math.abs(a.y - c.y) < 16 + a.r);
      if (blocked) {
        p.ammo[id] = (p.ammo[id] ?? 0) + 1;
        return;
      }
      this.world.buildBarricade(i, 240);
      this.audio.barricade(0, false);
      return;
    }
    if (this.world.circleHitsSolid(x, y, 8)) {
      p.ammo[id] = (p.ammo[id] ?? 0) + 1;
      return;
    }
    if (id === "barrel") {
      this.places.push({ x, y, r: 12, kind: "barrel", hp: 20, dirX: p.dirX, dirY: p.dirY, owner: p.id, armed: 0 });
    } else if (id === "claymore") {
      this.places.push({ x, y, r: 10, kind: "claymore", hp: 15, dirX: p.dirX, dirY: p.dirY, owner: p.id, armed: 0.6 });
    }
  }

  // ───────────────────────────── directors ─────────────────────────────

  private startPrep(): void {
    this.wave += 1;
    this.phase = "prep";
    this.phaseT = this.wave === 1 ? 5 : 4.5;
    const boss = this.wave % 5 === 0;
    this.banner(this.wave === 1 ? "HOLD THE ROOM" : `WAVE ${this.wave}`, 2.6, boss ? "Something big is coming…" : "Incoming", boss ? "warn" : "info");
    this.audio.wave();
  }

  private waveComposition(n: number): ZombieKind[] {
    const c = this.diff.count * (this.coop ? 1.35 : 1);
    const out: ZombieKind[] = [];
    const add = (k: ZombieKind, count: number) => {
      for (let i = 0; i < Math.round(count * c); i++) out.push(k);
    };
    add("walker", 6 + n * 3.2);
    if (n >= 2) add("runner", (n - 1) * 1.4);
    if (n >= 3) add("devil", Math.floor((n - 1) / 2));
    if (n >= 4) add("spitter", (n - 2) * 0.5);
    if (n >= 5) add("bloater", (n - 3) * 0.45);
    if (n >= 6) add("brute", Math.floor((n - 3) / 3));
    if (n >= 7) add("screamer", (n - 5) * 0.3);
    if (n >= 3) add("crawler", n * 0.5);
    // Shuffle, keeping some specials late.
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (n % 5 === 0) out.splice(Math.floor(out.length * 0.4), 0, "boss");
    return out;
  }

  private surviveDirector(dt: number): void {
    this.phaseT -= dt;
    if (this.phase === "prep" && this.phaseT <= 0) {
      this.phase = "wave";
      this.spawnQueue = this.waveComposition(this.wave);
      this.spawnCd = 0.2;
    }
    if (this.phase === "wave") {
      this.spawnCd -= dt;
      if (this.spawnCd <= 0 && this.spawnQueue.length) {
        const kind = this.spawnQueue.shift()!;
        const door = pick(this.map.spawns);
        if (door) {
          const j = rand(-14, 14);
          const z = this.spawnZombie(kind, door.x + door.inX * 6 - door.inY * j, door.y + door.inY * 6 + door.inX * j, "chase", Infinity);
          z.dirX = door.inX;
          z.dirY = door.inY;
          z.kx = door.inX * 120;
          z.ky = door.inY * 120;
          if (kind === "boss") {
            this.banner("ABOMINATION", 3, "Watch its telegraphs", "warn");
            this.audio.roar(1);
            this.addShake(8);
          }
        }
        this.spawnCd = Math.max(0.1, 0.45 - this.wave * 0.02);
      }
      if (this.spawnQueue.length === 0 && this.enemies.length === 0) {
        this.score += 250 * this.wave * this.diff.score;
        this.checkUpgrades();
        this.startPrep();
      }
    }
  }

  private farDoors(minDist: number): number[] {
    const ps = this.livingPlayers();
    const doors = this.map.spawns
      .map((s, i) => ({ i, d: Math.min(...ps.map((p) => len(p.x - s.x, p.y - s.y))) }))
      .sort((a, b) => b.d - a.d);
    const far = doors.filter((d) => d.d > minDist).map((d) => d.i);
    return far.length ? far : doors.slice(0, 2).map((d) => d.i);
  }

  private hordeMix(index: number, final: boolean): ZombieKind[] {
    const lv = this.level;
    const base = (6 + index * 2.5 + lv * 1.5) * this.diff.count * (this.coop ? 1.4 : 1);
    const n = Math.round(final ? base * 0.5 : base);
    const out: ZombieKind[] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const t = index + lv;
      if (t >= 3 && r < 0.05) out.push("brute");
      else if (t >= 2 && r < 0.12) out.push("spitter");
      else if (t >= 3 && r < 0.18) out.push("bloater");
      else if (t >= 4 && r < 0.22) out.push("screamer");
      else if (t >= 4 && r < 0.26) out.push("devil");
      else if (r < 0.48) out.push("runner");
      else out.push("walker");
    }
    return out;
  }

  private startHorde(size = 1, warn = true): void {
    this.hordeIndex++;
    if (warn) this.stats.hordes++;
    const q = this.hordeMix(this.hordeIndex, this.phase === "extract");
    this.hordeQueue.push(...q.slice(0, Math.max(3, Math.round(q.length * size))));
    this.hordeDoors = this.farDoors(560).slice(0, 3);
    this.spawnCd = 0.3;
    if (warn) {
      this.banner("THE HORDE IS HERE", 2.4, undefined, "warn");
      this.audio.horde();
      this.addShake(3);
    }
  }

  private expeditionDirector(dt: number): void {
    const interval = (this.map.hordeInterval ?? 90) * (this.phase === "extract" ? 0.35 : 1);
    this.hordeT -= dt;
    if (!this.hordeWarned && this.hordeT < 8 && this.phase !== "extract") {
      this.hordeWarned = true;
      this.banner("HORDE INCOMING", 2.5, "Find a defensible spot", "warn");
      this.audio.scream(0.35);
    }
    if (this.hordeT <= 0) {
      this.hordeT = interval * rand(0.9, 1.1);
      this.hordeWarned = false;
      this.startHorde(1, this.phase !== "extract");
    }

    // Spawn queued horde members a few at a time from far doors.
    this.spawnCd -= dt;
    if (this.hordeQueue.length && this.spawnCd <= 0) {
      this.spawnCd = 0.22;
      const di = pick(this.hordeDoors.length ? this.hordeDoors : [0]);
      const door = this.map.spawns[di] ?? this.map.spawns[0];
      const kind = this.hordeQueue.shift()!;
      const j = rand(-12, 12);
      const z = this.spawnZombie(kind, door.x + door.inX * 6 - door.inY * j, door.y + door.inY * 6 + door.inX * j, "chase", 30);
      z.kx = door.inX * 100;
      z.ky = door.inY * 100;
      const target = pick(this.livingPlayers());
      if (target) {
        z.targetId = target.id;
        z.lastSeen = { x: target.x, y: target.y };
      }
    }

    // Keep the map populated: trickle in wanderers far from the players.
    this.trickleT -= dt;
    if (this.trickleT <= 0) {
      this.trickleT = rand(14, 22);
      if (this.enemies.length < this.roamTarget) {
        const ps = this.livingPlayers();
        for (let i = 0; i < 3; i++) {
          const p = this.randomFarFloor(ps[0] ?? this.map.starts[0], 750, 30);
          if (!p) continue;
          if (ps.some((pl) => this.world.los(pl.x, pl.y, p.x, p.y) && len(pl.x - p.x, pl.y - p.y) < PLAYER_LIGHT)) continue;
          const z = this.spawnZombie(Math.random() < 0.25 ? "runner" : "walker", p.x, p.y, "wander");
          z.home = p;
        }
      }
    }

    // Extraction.
    if (this.phase === "extract") {
      const pad = this.extractionBounds();
      const active = this.activePlayers();
      const inside = active.length > 0 && active.every((p) => p.x > pad.x && p.x < pad.x + pad.w && p.y > pad.y && p.y < pad.y + pad.h);
      if (inside) {
        this.extractT += dt;
        if (Math.floor(this.extractT * 2) !== Math.floor((this.extractT - dt) * 2)) this.audio.wave();
        if (this.extractT >= this.extractNeed) this.win();
      } else {
        this.extractT = Math.max(0, this.extractT - dt * 2);
      }
    }
  }

  extractionBounds(): { x: number; y: number; w: number; h: number } {
    const ts = this.map.extraction;
    const t = this.map.tile;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const e of ts) {
      x0 = Math.min(x0, e.tx * t);
      y0 = Math.min(y0, e.ty * t);
      x1 = Math.max(x1, e.tx * t + t);
      y1 = Math.max(y1, e.ty * t + t);
    }
    const m = 14;
    return { x: x0 - m, y: y0 - m, w: x1 - x0 + m * 2, h: y1 - y0 + m * 2 };
  }

  private win(): void {
    this.won = true;
    this.over = true;
    this.phase = "won";
    const timeBonus = Math.max(0, Math.round(((this.map.parTime ?? 300) - this.time) * 20));
    this.score += (5000 + timeBonus) * this.diff.score;
    this.audio.victory();
    this.audio.setIntensity(0);
  }

  stars(): number {
    if (!this.won) return 0;
    const par = this.map.parTime ?? 300;
    if (this.time <= par * 0.7) return 3;
    if (this.time <= par) return 2;
    return 1;
  }

  // ───────────────────────────── projectiles ─────────────────────────────

  private updateBullets(dt: number): void {
    const near: Actor[] = [];
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.px = b.x;
      b.py = b.y;
      b.life -= dt;
      let dead = b.life <= 0;

      if (b.kind === "rail") {
        if (dead) this.bullets.splice(i, 1);
        continue;
      }

      if (b.kind === "acid") {
        // Lobbed arc – flies over walls and lands on target.
        const k = 1 - b.life / b.maxLife;
        b.x = lerp(b.sx!, b.tx!, k);
        b.y = lerp(b.sy!, b.ty!, k);
        if (dead) {
          this.hazards.push({ x: b.tx!, y: b.ty!, r: b.r * 4.5, kind: "acid", life: 5, max: 5, dps: b.dmg });
          this.spark(b.tx!, b.ty!, "#b8d83a", 8);
          this.audio.sizzle();
          this.bullets.splice(i, 1);
        }
        continue;
      }

      // Sub-step fast bullets so they don't tunnel through walls/zombies.
      const sp = Math.hypot(b.vx, b.vy);
      const steps = Math.max(1, Math.ceil((sp * dt) / 10));
      const sdt = dt / steps;
      for (let s = 0; s < steps && !dead; s++) {
        const nx = b.x + b.vx * sdt;
        const ny = b.y + b.vy * sdt;
        const ti = this.world.shotTileAt(nx, ny);
        if (ti !== -1) {
          if (b.kind === "grenade") {
            if (this.world.shotTileAt(nx, b.y) !== -1) b.vx *= -0.45;
            if (this.world.shotTileAt(b.x, ny) !== -1) b.vy *= -0.45;
            continue;
          }
          if (b.kind === "rocket") {
            this.explode(b.x, b.y, 100, b.dmg, b.owner);
          } else if (ti >= 0 && b.friendly) {
            if (this.world.barricadeHp.has(ti)) {
              const broke = this.world.damageBarricade(ti, b.dmg * 0.4);
              if (broke) this.onBarricadeBroken(ti);
              this.spark(b.x, b.y, "#a07a48", 3);
            } else {
              this.spark(b.x, b.y, "#bbbbbb", 2);
            }
          } else if (b.kind === "fireball") {
            this.spark(b.x, b.y, "#ff7a2a", 6);
          }
          dead = true;
          break;
        }
        b.x = nx;
        b.y = ny;

        if (b.friendly) {
          // vs enemies
          if (b.kind !== "grenade") {
            for (const e of this.hash.query(b.x, b.y, 24, near)) {
              if (!e.alive || (b.hit && b.hit.has(e.id))) continue;
              if (e.state === "dormant" && e.ztype === "crawler" && len(e.x - b.x, e.y - b.y) > e.r) continue;
              if (len(e.x - b.x, e.y - b.y) < e.r + b.r + 2) {
                if (b.kind === "rocket") {
                  this.explode(b.x, b.y, 100, b.dmg, b.owner);
                  dead = true;
                  break;
                }
                this.stats.hits++;
                const owner = this.playerById(b.owner);
                this.hurtEnemy(e, b.dmg, owner, b.vx, b.vy);
                (b.hit ??= new Set()).add(e.id);
                b.pierce--;
                if (b.pierce < 0) {
                  dead = true;
                  break;
                }
              }
            }
          } else {
            for (const e of this.hash.query(b.x, b.y, 24, near)) {
              if (e.alive && len(e.x - b.x, e.y - b.y) < e.r + b.r) {
                this.explode(b.x, b.y, 92, b.dmg, b.owner);
                dead = true;
                break;
              }
            }
          }
          if (dead) break;
          // vs barrels
          for (const pl of this.places) {
            if (pl.kind === "barrel" && pl.hp > 0 && len(pl.x - b.x, pl.y - b.y) < pl.r + b.r) {
              pl.hp = 0;
              this.explode(pl.x, pl.y, 100, 95, b.owner);
              dead = true;
              break;
            }
          }
          // shoot down fireballs
          if (!dead && b.kind !== "grenade") {
            for (const o of this.bullets) {
              if (o.kind !== "fireball" || o.life <= 0) continue;
              if (len(o.x - b.x, o.y - b.y) < o.r + b.r + 4) {
                o.life = 0;
                this.spark(o.x, o.y, "#ffaa55", 8);
                this.floatText(o.x, o.y - 10, "BLOCKED", "#ffb347", 11);
                dead = true;
                break;
              }
            }
          }
        } else if (b.kind === "fireball") {
          for (const p of this.livingPlayers()) {
            if (len(p.x - b.x, p.y - b.y) < p.r + b.r) {
              this.hurtPlayer(p, b.dmg, b.vx, b.vy);
              this.spark(b.x, b.y, "#ff7a2a", 8);
              dead = true;
              break;
            }
          }
        }
      }

      if (b.kind === "grenade" && b.life <= 0) {
        this.explode(b.x, b.y, 92, b.dmg, b.owner);
        dead = true;
      }
      if (b.kind === "grenade") {
        b.vx *= Math.pow(0.35, dt);
        b.vy *= Math.pow(0.35, dt);
      }
      if (b.kind === "rocket" && b.life <= 0 && !dead) {
        this.explode(b.x, b.y, 100, b.dmg, b.owner);
        dead = true;
      }
      if (b.kind === "rocket" && Math.random() < 0.6) {
        this.particles.push({ x: b.x, y: b.y, z: 0, vx: rand(-20, 20), vy: rand(-20, 20), vz: 0, life: 0.5, max: 0.5, size: rand(4, 7), color: "#9a9a9a", gravity: false });
      }
      if (b.kind === "fireball" && Math.random() < 0.5) {
        this.particles.push({ x: b.x, y: b.y, z: 0, vx: rand(-15, 15), vy: rand(-15, 15), vz: 0, life: 0.3, max: 0.3, size: rand(3, 6), color: "#ff9a3a", gravity: false });
      }
      if (dead) this.bullets.splice(i, 1);
    }
  }

  onBarricadeBroken(i: number): void {
    const c = this.world.center(i);
    for (let k = 0; k < 10; k++) {
      this.particles.push({
        x: c.x + rand(-12, 12),
        y: c.y + rand(-12, 12),
        z: rand(4, 14),
        vx: rand(-140, 140),
        vy: rand(-140, 140),
        vz: rand(60, 200),
        life: rand(0.5, 1),
        max: 1,
        size: rand(3, 7),
        color: pick(["#8a5a2a", "#a0703a", "#6a4420"]),
        gravity: true,
      });
    }
    const s = this.spatial(c.x, c.y);
    this.audio.barricade(s.pan, true);
    this.emitNoise(c.x, c.y, 300);
  }

  // ───────────────────────────── placeables & hazards ─────────────────────────────

  private updatePlaces(dt: number): void {
    for (let i = this.places.length - 1; i >= 0; i--) {
      const pl = this.places[i];
      if (pl.kind === "claymore" && pl.hp > 0) {
        pl.armed = Math.max(0, pl.armed - dt);
        if (pl.armed <= 0) {
          for (const e of this.hash.query(pl.x, pl.y, 90)) {
            if (e.state === "dormant") continue;
            const dx = e.x - pl.x;
            const dy = e.y - pl.y;
            const d = len(dx, dy);
            if (d < 82) {
              const nd = norm(dx, dy);
              if (nd.x * pl.dirX + nd.y * pl.dirY > 0.3) {
                pl.hp = 0;
                this.directionalBlast(pl);
                break;
              }
            }
          }
        }
      }
      if (pl.hp <= 0) this.places.splice(i, 1);
    }
  }

  private directionalBlast(pl: Placeable): void {
    this.explode(pl.x, pl.y, 50, 40, pl.owner);
    const owner = this.playerById(pl.owner);
    for (const e of this.hash.query(pl.x, pl.y, 180)) {
      const dx = e.x - pl.x;
      const dy = e.y - pl.y;
      const d = len(dx, dy);
      const nd = norm(dx, dy);
      if (d < 170 && nd.x * pl.dirX + nd.y * pl.dirY > 0.45) this.hurtEnemy(e, 130 * this.dmgMul * (1 - d / 260), owner, dx, dy);
    }
    for (let k = 0; k < 18; k++) {
      const a = Math.atan2(pl.dirY, pl.dirX) + rand(-0.5, 0.5);
      const sp = rand(200, 520);
      this.particles.push({ x: pl.x, y: pl.y, z: 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 0, life: 0.25, max: 0.25, size: 3, color: "#ffd27a", gravity: false });
    }
  }

  private updateHazards(dt: number): void {
    for (const h of this.hazards) {
      h.life -= dt;
      for (const p of this.livingPlayers()) {
        if (len(p.x - h.x, p.y - h.y) < h.r + p.r * 0.4) this.burnPlayer(p, h.dps * dt);
      }
      if (h.kind === "gas" || h.kind === "fire") {
        for (const e of this.hash.query(h.x, h.y, h.r)) {
          if (len(e.x - h.x, e.y - h.y) < h.r) this.hurtEnemy(e, h.dps * 0.6 * dt, undefined, 0, 0, false);
        }
      }
    }
    this.hazards = this.hazards.filter((h) => h.life > 0);
  }

  /** Damage-over-time that bypasses i-frames. */
  private burnPlayer(p: Actor, dmg: number): void {
    if (!p.alive || p.downed) return;
    const d = dmg * this.diff.damage;
    p.hp -= d;
    p.damageTaken += d;
    this.stats.damageTaken += d;
    p.hurt = Math.max(p.hurt, 0.15);
    this.flash = Math.max(this.flash, 0.25);
    this.audio.sizzle();
    if (p.hp <= 0) this.downOrKill(p);
  }

  // ───────────────────────────── pickups ─────────────────────────────

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.life -= dt;
      pk.bob += dt;
      if (pk.life <= 0) {
        this.pickups.splice(i, 1);
        continue;
      }
      for (const p of this.activePlayers()) {
        const d = len(p.x - pk.x, p.y - pk.y);
        // Magnetise small drops.
        if ((pk.kind === "ammo" || pk.kind === "medkit") && d < 70) {
          pk.x += ((p.x - pk.x) / d) * 180 * dt;
          pk.y += ((p.y - pk.y) / d) * 180 * dt;
        }
        if (d < p.r + pk.r) {
          this.collect(p, pk);
          this.pickups.splice(i, 1);
          break;
        }
      }
    }
  }

  private collect(p: Actor, pk: Pickup): void {
    if (pk.kind === "objective") {
      this.objectivesGot++;
      this.stats.objectives++;
      this.score += 1000 * this.diff.score;
      this.checkUpgrades();
      this.audio.objective();
      this.light(pk.x, pk.y, 220, 0.6, "255,230,140");
      this.ring(pk.x, pk.y, 120, 0.6, "#ffd84a");
      this.floatText(pk.x, pk.y - 20, `+${Math.round(1000 * this.diff.score)}`, "#ffd84a", 18);
      const left = this.objectivesTotal - this.objectivesGot;
      if (left > 0) {
        this.banner(`${this.map.objectiveLabel ?? "ITEM"} ${this.objectivesGot}/${this.objectivesTotal}`, 2.2, "The noise drew attention…", "good");
        this.emitNoise(pk.x, pk.y, 520);
        this.startHorde(0.35, false);
      } else {
        this.phase = "extract";
        this.hordeT = 6;
        this.banner("EXTRACTION READY", 3.2, "Get everyone to the pad", "good");
        this.emitNoise(pk.x, pk.y, 900);
      }
      return;
    }
    this.audio.pickup();
    if (pk.kind === "medkit") {
      p.hp = Math.min(p.maxHp, p.hp + 35);
      this.floatText(p.x, p.y - 30, "+35 HP", "#5ad47a", 13);
      return;
    }
    const pool = WEAPONS.filter((w) => this.unlocked.has(w.id) && !w.infinite);
    if (pk.kind === "supply") {
      p.hp = Math.min(p.maxHp, p.hp + 50);
      for (const pl of this.activePlayers()) {
        for (const w of pool) pl.ammo[w.id] = (pl.ammo[w.id] ?? 0) + Math.ceil(w.grant * 0.6);
      }
      this.banner("SUPPLIES", 1.4, pool.length ? "Ammo for everyone · +50 HP" : "+50 HP", "good");
      return;
    }
    if (pool.length === 0) {
      p.hp = Math.min(p.maxHp, p.hp + 25);
      this.floatText(p.x, p.y - 30, "+25 HP", "#5ad47a", 13);
      return;
    }
    const w = pick(pool);
    const amt = pk.kind === "ammo" ? Math.ceil(w.grant / 2) : w.grant;
    p.ammo[w.id] = (p.ammo[w.id] ?? 0) + amt;
    this.floatText(p.x, p.y - 30, `${w.short} +${amt}`, "#ffd84a", 13);
    if (pk.kind === "package") p.hp = Math.min(p.maxHp, p.hp + 20);
  }

  // ───────────────────────────── visibility & effects ─────────────────────────────

  private updateVisibility(dt: number): void {
    const dark = this.darkness > 0;
    const viewers = this.livingPlayers();
    if (dark) {
      this.vision = viewers.map((p) => computeVision(this.world, p.x, p.y, PLAYER_LIGHT, 540));
    } else {
      this.vision = [];
      // Mark everything explored on lit maps.
    }
    const vx0 = this.cam.x - this.viewW / 2 - 100;
    const vx1 = this.cam.x + this.viewW / 2 + 100;
    const vy0 = this.cam.y - this.viewH / 2 - 100;
    const vy1 = this.cam.y + this.viewH / 2 + 100;
    for (const e of this.enemies) {
      if (!dark) {
        e.visible = true;
      } else if (e.x < vx0 || e.x > vx1 || e.y < vy0 || e.y > vy1) {
        e.visible = false;
      } else {
        e.visible = viewers.some((p) => {
          const d = len(p.x - e.x, p.y - e.y);
          return d < 70 || (d < PLAYER_LIGHT && this.world.los(p.x, p.y, e.x, e.y));
        });
        if (!e.visible) {
          for (const l of this.lampVision) {
            if (len(l.x - e.x, l.y - e.y) < 200 && this.world.los(l.x, l.y, e.x, e.y)) {
              e.visible = true;
              break;
            }
          }
        }
      }
      e.seen = clamp(e.seen + (e.visible ? dt * 6 : -dt * 3), 0, 1);
    }
  }

  private updateEffects(dt: number): void {
    for (const b of this.blood) {
      b.a -= dt * 0.02;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= 0.9;
      b.vy *= 0.9;
    }
    this.blood = this.blood.filter((b) => b.a > 0);
    if (this.blood.length > 700) this.blood.splice(0, this.blood.length - 700);
    for (const c of this.corpses) c.life -= dt;
    this.corpses = this.corpses.filter((c) => c.life > 0);
    if (this.corpses.length > 160) this.corpses.splice(0, this.corpses.length - 160);

    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.gravity) {
        p.vz -= 600 * dt;
        p.z += p.vz * dt;
        if (p.z < 0) {
          p.z = 0;
          p.vz *= -0.3;
          p.vx *= 0.6;
          p.vy *= 0.6;
        }
      } else {
        p.vx *= 0.92;
        p.vy *= 0.92;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 34 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const l of this.lights) l.life -= dt;
    this.lights = this.lights.filter((l) => l.life > 0);
    for (const r of this.rings) {
      r.life -= dt;
      r.r = r.maxR * (1 - r.life / r.max);
    }
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  private updateCamera(dt: number): void {
    const living = this.livingPlayers();
    if (living.length === 0) return;
    let x = 0;
    let y = 0;
    let lookX = 0;
    let lookY = 0;
    for (const p of living) {
      x += p.x;
      y += p.y;
      lookX += p.dirX;
      lookY += p.dirY;
    }
    x /= living.length;
    y /= living.length;
    // Look slightly ahead in the facing direction.
    x += (lookX / living.length) * 50;
    y += (lookY / living.length) * 50;

    let zoom = 1;
    if (living.length > 1) {
      const dx = Math.abs(living[0].x - living[1].x) + 220;
      const dy = Math.abs(living[0].y - living[1].y) + 220;
      zoom = clamp(Math.min(this.viewW / dx, this.viewH / dy), 0.62, 1);
    }
    this.cam.zoom = lerp(this.cam.zoom, zoom, 1 - Math.pow(0.05, dt));
    const vw = this.viewW / this.cam.zoom;
    const vh = this.viewH / this.cam.zoom;
    const W = this.map.width;
    const H = this.map.height;
    const tx = vw >= W ? W / 2 : clamp(x, vw / 2 - 40, W - vw / 2 + 40);
    const ty = vh >= H ? H / 2 : clamp(y, vh / 2 - 40, H - vh / 2 + 40);
    this.cam.x = lerp(this.cam.x, tx, 1 - Math.pow(0.002, dt));
    this.cam.y = lerp(this.cam.y, ty, 1 - Math.pow(0.002, dt));
  }

  // ───────────────────────────── damage ─────────────────────────────

  explode(x: number, y: number, radius: number, dmg: number, ownerId = 0, hurtsPlayers = true): void {
    this.addShake(8);
    const s = this.spatial(x, y);
    this.audio.explode(Math.max(0.35, s.vol), s.pan);
    this.spark(x, y, "#ffb347", 20);
    this.spark(x, y, "#ff5a2a", 12);
    this.light(x, y, radius * 2.6, 0.35);
    this.ring(x, y, radius, 0.25, "rgba(255,200,120,0.8)");
    for (let k = 0; k < 8; k++) {
      this.particles.push({ x: x + rand(-10, 10), y: y + rand(-10, 10), z: 0, vx: rand(-60, 60), vy: rand(-60, 60), vz: 0, life: rand(0.6, 1.2), max: 1.2, size: rand(8, 16), color: "#5a5a5a", gravity: false });
    }
    this.blood.push({ x, y, s: radius * 0.4, a: 0.5, rot: rand(0, 6), vx: 0, vy: 0 });
    const owner = this.playerById(ownerId);
    for (const e of this.hash.query(x, y, radius + 30)) {
      const d = len(e.x - x, e.y - y);
      if (d < radius + e.r) {
        const k = 1 - d / (radius + 40);
        const n = norm(e.x - x, e.y - y);
        const def = ZOMBIES[e.ztype];
        e.kx += n.x * 300 * k * def.knock;
        e.ky += n.y * 300 * k * def.knock;
        this.hurtEnemy(e, dmg * k, owner, n.x, n.y);
      }
    }
    if (hurtsPlayers) {
      for (const p of this.livingPlayers()) {
        const d = len(p.x - x, p.y - y);
        if (d < radius * 0.75 + p.r) this.hurtPlayer(p, dmg * 0.3, p.x - x, p.y - y, true);
      }
    }
    // Blow open nearby barricades.
    const t = this.map.tile;
    const r = Math.ceil(radius / t);
    const [cx, cy] = this.world.tileOf(x, y);
    for (let ty = cy - r; ty <= cy + r; ty++) {
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (!this.world.inBounds(tx, ty)) continue;
        const i = ty * this.world.cols + tx;
        if (!this.world.barricadeHp.has(i)) continue;
        const c = this.world.center(i);
        const d = len(c.x - x, c.y - y);
        if (d < radius + 16 && this.world.damageBarricade(i, dmg * 2.2 * (1 - d / (radius + 60)))) this.onBarricadeBroken(i);
      }
    }
    const chained: Placeable[] = [];
    for (const pl of this.places) {
      if (pl.hp <= 0) continue;
      if (len(pl.x - x, pl.y - y) < radius && (Math.abs(pl.x - x) > 1 || Math.abs(pl.y - y) > 1)) {
        pl.hp = 0;
        chained.push(pl);
      }
    }
    this.emitNoise(x, y, 700);
    for (const pl of chained) {
      if (pl.kind === "barrel") this.explode(pl.x, pl.y, 100, 95, ownerId || pl.owner);
      else this.directionalBlast(pl);
    }
  }

  hurtEnemy(e: Actor, dmg: number, owner?: Actor, dirX = 0, dirY = 0, sound = true): void {
    if (!e.alive) return;
    if (e.stun > 0 && e.ztype === "brute") dmg *= 1.6;
    e.hp -= dmg;
    e.hurt = 0.08;
    const def = ZOMBIES[e.ztype];
    const n = norm(dirX, dirY);
    if (n.x || n.y) {
      e.kx += n.x * 70 * def.knock;
      e.ky += n.y * 70 * def.knock;
    }
    if (sound) this.audio.hit();
    if (Math.random() < 0.5) this.splatter(e.x, e.y, 1, n.x, n.y);
    if (this.settings.damageNumbers && dmg >= 1) {
      this.floatText(e.x + rand(-6, 6), e.y - e.size - e.lift - 6, String(Math.round(dmg)), dmg >= 50 ? "#ffb347" : "#ffffff", dmg >= 50 ? 15 : 11);
    }
    // Being shot makes zombies hunt the shooter.
    if (owner && e.state !== "chase") {
      e.state = "chase";
      e.targetId = owner.id;
      e.lastSeen = { x: owner.x, y: owner.y };
      e.memoryT = def.memory;
      e.mark = "!";
      e.markT = 1;
      if (e.ztype === "crawler" && e.ability.name === "") e.abilityCd = 0;
    }
    if (e.hp <= 0) this.killEnemy(e, owner);
  }

  killEnemy(e: Actor, owner?: Actor): void {
    if (!e.alive) return;
    e.alive = false;
    this.enemies = this.enemies.filter((x) => x !== e);
    const def = ZOMBIES[e.ztype];
    const big = e.ztype === "brute" || e.ztype === "boss" || e.ztype === "devil";
    this.splatter(e.x, e.y, big ? 20 : 9);
    this.gibs(e, big ? 12 : 6);
    const s = this.spatial(e.x, e.y);
    this.audio.splat(s.vol, s.pan);
    this.corpses.push({ x: e.x, y: e.y, size: e.size, color: e.color, rot: rand(-0.4, 0.4), life: 40, kind: e.ztype });
    if (owner) owner.kills++;
    this.stats.kills[e.ztype] = (this.stats.kills[e.ztype] ?? 0) + 1;
    this.combo = this.comboMax;
    this.multiplier = Math.min(12, this.multiplier + (big ? 0.6 : e.ztype === "walker" ? 0.2 : 0.35));
    const pts = Math.round(def.score * this.multiplier * this.diff.score);
    this.score += pts;
    if (pts >= 300) this.floatText(e.x, e.y - 30, `+${pts}`, "#ffd84a", big ? 18 : 13);
    this.checkUpgrades();

    if (e.ztype === "bloater") this.bloaterBurst(e, false);
    if (e.ztype === "boss") {
      this.stats.bossKills++;
      this.hitStop = 0.25;
      this.addShake(14);
      this.banner("ABOMINATION SLAIN", 3, undefined, "good");
      for (let k = 0; k < 4; k++) this.pickups.push({ x: e.x + rand(-30, 30), y: e.y + rand(-30, 30), r: 12, kind: "package", life: 60, bob: rand(0, 6) });
      this.boss = null;
    } else if (big) {
      this.hitStop = 0.05;
      this.pickups.push({ x: e.x, y: e.y, r: 12, kind: "package", life: 40, bob: 0 });
    } else if (e.ztype === "screamer" || e.ztype === "spitter") {
      if (Math.random() < 0.5) this.pickups.push({ x: e.x, y: e.y, r: 12, kind: "package", life: 40, bob: 0 });
    } else {
      const r = Math.random();
      if (r < 0.045) this.pickups.push({ x: e.x, y: e.y, r: 9, kind: "ammo", life: 25, bob: 0 });
      else if (r < 0.065) this.pickups.push({ x: e.x, y: e.y, r: 9, kind: "medkit", life: 25, bob: 0 });
    }
  }

  bloaterBurst(e: Actor, intentional: boolean): void {
    const x = e.x;
    const y = e.y;
    this.addShake(7);
    const s = this.spatial(x, y);
    this.audio.explode(Math.max(0.3, s.vol) * 0.8, s.pan);
    this.audio.splat(1, s.pan);
    this.ring(x, y, 100, 0.3, "rgba(170,220,90,0.9)");
    for (let k = 0; k < 26; k++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(80, 320);
      this.particles.push({ x, y, z: 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(50, 200), life: rand(0.4, 0.9), max: 0.9, size: rand(3, 7), color: pick(["#8ab83a", "#6a8a2a", "#7a6a8a"]), gravity: true });
    }
    this.splatter(x, y, 16);
    const radius = intentional ? 100 : 86;
    for (const p of this.livingPlayers()) {
      const d = len(p.x - x, p.y - y);
      if (d < radius + p.r) this.hurtPlayer(p, (intentional ? 38 : 24) * (1 - d / (radius + 60)), p.x - x, p.y - y, true);
    }
    for (const z of this.hash.query(x, y, radius + 20)) {
      if (z === e || !z.alive) continue;
      const d = len(z.x - x, z.y - y);
      if (d < radius + z.r) this.hurtEnemy(z, 70 * (1 - d / (radius + 60)), undefined, z.x - x, z.y - y, false);
    }
    this.hazards.push({ x, y, r: 60, kind: "gas", life: 4, max: 4, dps: 10 });
    this.emitNoise(x, y, 500);
    if (intentional && e.alive) {
      e.alive = false;
      this.enemies = this.enemies.filter((z) => z !== e);
    }
  }

  hurtPlayer(p: Actor, dmg: number, dirX = 0, dirY = 0, ignoreIframes = false): void {
    if (!p.alive || p.downed) return;
    if (p.hurt > 0 && !ignoreIframes) return;
    const d = dmg * this.diff.damage;
    p.hp -= d;
    p.damageTaken += d;
    this.stats.damageTaken += d;
    p.hurt = 0.5;
    this.addShake(4 + d * 0.08);
    this.flash = Math.min(1, this.flash + 0.35 + d / 80);
    this.splatter(p.x, p.y, 4);
    this.audio.hurt();
    const n = norm(dirX, dirY);
    if (n.x || n.y) {
      p.x += n.x * 10;
      p.y += n.y * 10;
      this.world.resolveCircle(p);
    }
    if (p.hp <= 0) this.downOrKill(p);
  }

  private downOrKill(p: Actor): void {
    p.hp = 0;
    const others = this.activePlayers().filter((o) => o !== p);
    if (this.coop && others.length > 0) {
      p.downed = true;
      p.everDowned = true;
      p.bleed = BLEED_TIME;
      p.revive = 0;
      p.hp = 1;
      p.weapon = "pistol";
      this.audio.downed();
      this.banner(`P${p.playerIndex + 1} IS DOWN`, 2.4, `P${others[0].playerIndex + 1}: stand next to them to revive`, "warn");
    } else {
      p.alive = false;
      p.downed = false;
      this.splatter(p.x, p.y, 16);
      // Teammate downed + last player dies → everyone is out.
      for (const o of this.players) {
        if (o.downed) {
          o.alive = false;
          o.downed = false;
        }
      }
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
          this.banner(`${def.name.toUpperCase()} UNLOCKED`, 2.4, `Press ${WEAPONS.indexOf(def) + 1} or cycle weapons`, "good");
          this.audio.unlockSound();
        }
      } else {
        this.statSteps[ev.stat] += 1;
        if (ev.stat === "range") {
          this.rangeMul *= 1.06;
          this.banner("RANGE UP", 1.4, undefined, "good");
        } else if (ev.stat === "fireRate") {
          this.fireMul *= 1.07;
          this.banner("FIRE RATE UP", 1.4, undefined, "good");
        } else {
          this.dmgMul *= 1.07;
          this.banner("DAMAGE UP", 1.4, undefined, "good");
        }
        this.audio.unlockSound();
      }
    }
  }

  // ───────────────────────────── particles ─────────────────────────────

  splatter(x: number, y: number, n: number, dx = 0, dy = 0): void {
    for (let i = 0; i < n; i++) {
      const a = dx || dy ? Math.atan2(dy, dx) + rand(-0.7, 0.7) : rand(0, Math.PI * 2);
      const s = rand(5, 16);
      this.blood.push({
        x: x + Math.cos(a) * rand(0, 14),
        y: y + Math.sin(a) * rand(0, 14),
        s,
        a: rand(0.5, 0.9),
        rot: a,
        vx: Math.cos(a) * rand(10, 90),
        vy: Math.sin(a) * rand(10, 90),
      });
    }
  }

  private gibs(e: Actor, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(60, 240);
      this.particles.push({
        x: e.x,
        y: e.y,
        z: e.lift,
        vx: Math.cos(a) * sp + e.kx * 0.3,
        vy: Math.sin(a) * sp + e.ky * 0.3,
        vz: rand(80, 260),
        life: rand(0.8, 1.6),
        max: 1.6,
        size: rand(3, 6),
        color: i % 3 === 0 ? "#8a1414" : e.color,
        gravity: true,
      });
    }
  }

  spark(x: number, y: number, color: string, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(40, 240);
      this.particles.push({ x, y, z: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 0, life: rand(0.15, 0.45), max: 0.45, size: rand(2, 5), color, gravity: false });
    }
  }

  private muzzle(x: number, y: number, dx: number, dy: number): void {
    this.particles.push({ x: x + dx * 6, y: y + dy * 6, z: 0, vx: dx * 40, vy: dy * 40, vz: 0, life: 0.06, max: 0.06, size: 9, color: "#ffe28a", gravity: false });
    this.light(x, y, 150, 0.07);
  }

  /** Requests an A* path; returns false if the per-frame budget is exhausted. */
  requestPath(z: Actor, goal: Vec): boolean {
    if (this.pathBudget <= 0) return false;
    this.pathBudget--;
    z.path = this.world.findPath(z, goal, 1800) ?? [];
    z.pathGoal = goal;
    return true;
  }
}
