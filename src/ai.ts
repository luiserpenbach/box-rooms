import type { Actor } from "./entities";
import type { Game } from "./game";
import { type Vec, angleDiff, clamp, len, lerp, norm, pick, rand } from "./math";
import { ZOMBIES, type ZombieKind } from "./zombies";

const NO_ABILITY = { name: "", phase: "", t: 0, dirX: 0, dirY: 0 } as const;
const scratch: Actor[] = [];

function resetAbility(z: Actor): void {
  z.ability = { ...NO_ABILITY };
}

function nearest(z: Actor, list: Actor[]): { p: Actor | null; d: number } {
  let p: Actor | null = null;
  let d = Infinity;
  for (const t of list) {
    const dd = len(t.x - z.x, t.y - z.y);
    if (dd < d) {
      d = dd;
      p = t;
    }
  }
  return { p, d };
}

export function updateEnemies(g: Game, dt: number): void {
  const targets = g.livingPlayers();
  for (const z of [...g.enemies]) {
    if (!z.alive) continue;
    updateZombie(g, z, dt, targets);
  }
}

function setMark(z: Actor, m: "!" | "?", t = 1.2): void {
  z.mark = m;
  z.markT = t;
}

/** Turn an unaware zombie into a hunter and let it alert its friends. */
function spot(g: Game, z: Actor, target: Actor): void {
  const def = ZOMBIES[z.ztype];
  const was = z.state;
  z.state = "chase";
  z.targetId = target.id;
  z.lastSeen = { x: target.x, y: target.y };
  z.memoryT = g.mode === "survival" ? Infinity : def.memory;
  z.path = [];
  if (was === "chase") return;
  setMark(z, "!");
  const s = g.spatial(z.x, z.y);
  g.audio.groan(z.ztype, s.vol, s.pan);
  if (was === "dormant" && z.ztype === "crawler") {
    // Ambush leap.
    const d = norm(target.x - z.x, target.y - z.y);
    z.ability = { name: "lunge", phase: "act", t: 0.36, dirX: d.x, dirY: d.y };
    z.abilityCd = 2.5;
    return;
  }
  if (z.ztype === "screamer" && z.altCd <= 0) {
    z.ability = { name: "scream", phase: "prep", t: 0.9, dirX: 0, dirY: 0 };
    return;
  }
  if (z.ztype === "boss") {
    g.boss = z;
    g.banner("ABOMINATION", 3, "Watch its telegraphs", "warn");
    g.audio.roar(1, s.pan);
    g.addShake(8);
  }
  // Groan alerts nearby unaware zombies (cascading hordes).
  for (const o of g.hash.query(z.x, z.y, 220)) {
    if (o === z || o.state === "chase" || o.state === "dormant") continue;
    if (len(o.x - z.x, o.y - z.y) > 220) continue;
    o.state = "investigate";
    o.stateT = 10;
    o.pathGoal = { x: target.x, y: target.y };
    o.path = [];
    o.thinkT = rand(0.1, 0.5);
    setMark(o, "?");
  }
}

function perceive(g: Game, z: Actor, targets: Actor[]): Actor | null {
  const def = ZOMBIES[z.ztype];
  const aware = z.state === "chase" || z.state === "search" || z.state === "investigate";
  const darkPenalty = 1 - g.darkness * 0.35;
  const sight = def.sight * darkPenalty * (aware ? 1.35 : 1) * (z.enraged > 0 ? 1.3 : 1);
  const fov = aware ? Math.PI : def.fov;
  const facing = Math.atan2(z.dirY, z.dirX);
  let best: Actor | null = null;
  let bd = Infinity;
  for (const p of targets) {
    const d = len(p.x - z.x, p.y - z.y);
    if (d >= bd) continue;
    if (z.state === "dormant") {
      if (d < 96 && g.world.los(z.x, z.y, p.x, p.y)) {
        best = p;
        bd = d;
      }
      continue;
    }
    if (d < 54) {
      best = p;
      bd = d;
      continue;
    }
    if (d > sight) continue;
    // Firing players are easier to spot.
    const lit = p.fireAnim > 0 ? 1.4 : 1;
    if (d > sight / 1.35 && lit === 1 && !aware) continue;
    const a = Math.atan2(p.y - z.y, p.x - z.x);
    if (Math.abs(angleDiff(facing, a)) > fov) continue;
    if (!g.world.los(z.x, z.y, p.x, p.y)) continue;
    best = p;
    bd = d;
  }
  return best;
}

function followPath(z: Actor): Vec | null {
  while (z.path.length && len(z.path[0].x - z.x, z.path[0].y - z.y) < 12) z.path.shift();
  if (!z.path.length) return null;
  // Skip ahead when the next-next waypoint is directly visible (smoother paths).
  return norm(z.path[0].x - z.x, z.path[0].y - z.y);
}

function goTo(g: Game, z: Actor, goal: Vec): Vec | null {
  const stale = !z.pathGoal || len(z.pathGoal.x - goal.x, z.pathGoal.y - goal.y) > 48;
  if (stale || (!z.path.length && len(goal.x - z.x, goal.y - z.y) > 24)) {
    if (!g.requestPath(z, goal)) return null;
  }
  return followPath(z);
}

function updateZombie(g: Game, z: Actor, dt: number, targets: Actor[]): void {
  const def = ZOMBIES[z.ztype];
  z.hurt = Math.max(0, z.hurt - dt);
  z.attackCd = Math.max(0, z.attackCd - dt);
  z.attackSwing = Math.max(0, z.attackSwing - dt);
  z.markT = Math.max(0, z.markT - dt);
  z.abilityCd -= dt;
  z.altCd -= dt;
  z.summonCd -= dt;
  z.fireCd -= dt;
  z.enraged = Math.max(0, z.enraged - dt);
  z.thinkT -= dt;
  z.groanT -= dt;

  // Knockback always applies.
  const applyKnock = () => {
    if (Math.abs(z.kx) + Math.abs(z.ky) > 1) {
      z.x += z.kx * dt;
      z.y += z.ky * dt;
      const decay = Math.pow(0.0015, dt);
      z.kx *= decay;
      z.ky *= decay;
      z.barricade = g.world.resolveCircle(z);
    }
  };

  if (z.stun > 0) {
    z.stun -= dt;
    z.vx *= 0.8;
    z.vy *= 0.8;
    z.attackAnim = lerp(z.attackAnim, 0, 0.2);
    applyKnock();
    return;
  }

  const { d: nearestD } = nearest(z, targets);
  // Sleep zombies far from everyone (perf + believable "dead zones").
  z.sleeping = nearestD > 1500 && z.state !== "chase" && z.state !== "investigate";
  if (z.sleeping) {
    applyKnock();
    return;
  }

  // ── Perception ─────────────────────────────────────────────
  let target = z.state === "chase" ? (targets.find((p) => p.id === z.targetId) ?? null) : null;
  let sees = false;
  if (z.thinkT <= 0 && targets.length) {
    z.thinkT = rand(0.12, 0.24);
    const seen = perceive(g, z, targets);
    if (seen) {
      if (z.state !== "chase" || seen.id !== z.targetId) {
        // Switch targets only if the new one is notably closer.
        const cur = targets.find((p) => p.id === z.targetId);
        if (!cur || z.state !== "chase" || len(cur.x - z.x, cur.y - z.y) > len(seen.x - z.x, seen.y - z.y) + 80) spot(g, z, seen);
      }
      target = targets.find((p) => p.id === z.targetId) ?? seen;
      z.lastSeen = { x: target.x, y: target.y };
      z.memoryT = g.mode === "survival" ? Infinity : def.memory;
      sees = true;
      z.sees = true;
    } else {
      z.sees = false;
    }
  } else {
    sees = !!z.sees;
  }
  if (z.state === "chase" && (!target || !target.alive)) {
    const n = nearest(z, targets).p;
    if (n && g.mode === "survival") {
      z.targetId = n.id;
      target = n;
    } else {
      z.state = "search";
      z.stateT = 5;
      target = null;
    }
  }

  // ── Behaviour ──────────────────────────────────────────────
  let dir: Vec | null = null;
  let speedMul = 1;
  let face: Vec | null = null;

  const ab = z.ability;
  if (ab.name) {
    const r = runAbility(g, z, dt, target);
    if (r) {
      applyKnock();
      return;
    }
  }

  switch (z.state) {
    case "dormant":
      applyKnock();
      return;
    case "idle": {
      z.stateT -= dt;
      speedMul = 0;
      if (Math.random() < dt * 0.4) {
        const a = Math.atan2(z.dirY, z.dirX) + rand(-1.2, 1.2);
        face = { x: Math.cos(a), y: Math.sin(a) };
      }
      if (z.stateT <= 0) {
        if (Math.random() < 0.6) {
          const p = g.world.randomOpenNear(z.home.x, z.home.y, 6);
          if (p) {
            z.state = "wander";
            z.pathGoal = null;
            z.path = [];
            z.stateT = 12;
            z.goal = p;
          } else z.stateT = rand(2, 5);
        } else z.stateT = rand(2, 5);
      }
      break;
    }
    case "wander": {
      z.stateT -= dt;
      const goal = z.goal;
      speedMul = def.wanderSpeed / def.chaseSpeed;
      if (goal) dir = goTo(g, z, goal);
      if (!goal || (!dir && z.pathGoal) || z.stateT <= 0) {
        z.state = "idle";
        z.stateT = rand(2, 6);
        z.path = [];
      }
      break;
    }
    case "investigate": {
      z.stateT -= dt;
      speedMul = 0.8;
      if (z.pathGoal) {
        const goal = z.pathGoal;
        if (!z.path.length && len(goal.x - z.x, goal.y - z.y) > 24) g.requestPath(z, goal);
        dir = followPath(z);
        if (!dir && len(goal.x - z.x, goal.y - z.y) < 40) {
          z.state = "search";
          z.stateT = rand(3, 5);
          z.home = { x: z.x, y: z.y };
        }
      }
      if (z.stateT <= 0) {
        z.state = "search";
        z.stateT = 3;
      }
      break;
    }
    case "search": {
      z.stateT -= dt;
      speedMul = 0.55;
      if (z.path.length) dir = followPath(z);
      else if (len(z.lastSeen.x - z.x, z.lastSeen.y - z.y) > 40 && z.thinkT <= 0.05) g.requestPath(z, z.lastSeen);
      else if (Math.random() < dt * 1.5) {
        const a = Math.atan2(z.dirY, z.dirX) + rand(-1.6, 1.6);
        face = { x: Math.cos(a), y: Math.sin(a) };
      }
      if (z.stateT <= 0) {
        z.state = "wander";
        z.home = { x: z.x, y: z.y };
        z.goal = g.world.randomOpenNear(z.x, z.y, 6);
        z.stateT = 10;
        z.path = [];
        z.pathGoal = null;
      }
      break;
    }
    case "chase": {
      if (!target) break;
      const dx = target.x - z.x;
      const dy = target.y - z.y;
      const d = Math.hypot(dx, dy);
      if (!sees) {
        z.memoryT -= dt;
        if (z.memoryT <= 0) {
          z.state = "search";
          z.stateT = rand(4, 7);
          z.path = [];
          z.pathGoal = null;
          setMark(z, "?");
          break;
        }
      }
      if (special(g, z, target, d, sees)) {
        applyKnock();
        return;
      }
      const kite = kiteDir(g, z, target, d, sees);
      if (kite) {
        dir = kite.dir;
        speedMul = kite.speed;
        face = norm(dx, dy);
        break;
      }
      // Direct approach when the path is clear; otherwise descend the flow field.
      const clear = sees && d < 420 && g.world.clearPath(z.x, z.y, target.x, target.y, z.r);
      if (clear) {
        let ax = target.x;
        let ay = target.y;
        // Flank: approach from an angle so the group encircles the player.
        if (d > 60 && def.flank > 0) {
          const off = Math.min(d * 0.45, 90) * def.flank * z.flank;
          ax += (-dy / d) * off;
          ay += (dx / d) * off;
        }
        dir = norm(ax - z.x, ay - z.y);
        z.path = [];
      } else {
        dir = g.world.flowDir(z.x, z.y);
        if (!dir || !isFinite(g.world.flowAt(z.x, z.y))) dir = goTo(g, z, z.lastSeen);
      }
      if (z.enraged > 0) speedMul *= 1.35;
      break;
    }
  }

  if (face) {
    z.dirX = face.x;
    z.dirY = face.y;
  }

  // ── Melee ──────────────────────────────────────────────────
  const meleeTarget = z.state === "chase" ? target : null;
  const attacking = melee(g, z, meleeTarget, dt);
  if (attacking) speedMul *= 0.2;

  // ── Barricade smashing ─────────────────────────────────────
  if (z.barricade >= 0 && (z.state === "chase" || z.state === "investigate") && !attacking && z.attackCd <= 0 && z.attackWind <= 0) {
    const c = g.world.center(z.barricade);
    if (len(c.x - z.x, c.y - z.y) < z.r + 30 && g.world.barricadeHp.has(z.barricade)) {
      z.attackWind = ZOMBIES[z.ztype].windup * 0.8;
      z.attackWindMax = z.attackWind;
      const f = norm(c.x - z.x, c.y - z.y);
      z.dirX = f.x;
      z.dirY = f.y;
      z.smash = z.barricade;
    }
  }

  // ── Steering & movement ───────────────────────────────────
  const speed = z.speed * speedMul;
  let wx = dir ? dir.x * speed : 0;
  let wy = dir ? dir.y * speed : 0;
  // Separation from other zombies.
  let sx = 0;
  let sy = 0;
  for (const o of g.hash.query(z.x, z.y, z.r + 20, scratch)) {
    if (o === z || !o.alive) continue;
    const ox = z.x - o.x;
    const oy = z.y - o.y;
    const od = Math.hypot(ox, oy);
    const min = z.r + o.r + 2;
    if (od > 0.01 && od < min) {
      const k = (min - od) / min;
      sx += (ox / od) * k;
      sy += (oy / od) * k;
    }
  }
  const sepStrength = z.ztype === "boss" || z.ztype === "brute" ? 20 : 90;
  wx += sx * sepStrength;
  wy += sy * sepStrength;
  const accel = z.ztype === "runner" || z.ztype === "crawler" ? 10 : 6;
  z.vx = lerp(z.vx, wx, 1 - Math.exp(-accel * dt));
  z.vy = lerp(z.vy, wy, 1 - Math.exp(-accel * dt));
  z.x += (z.vx + z.kx) * dt;
  z.y += (z.vy + z.ky) * dt;
  const decay = Math.pow(0.0015, dt);
  z.kx *= decay;
  z.ky *= decay;
  z.barricade = g.world.resolveCircle(z);

  // Don't overlap players – shove them a little (swarm pressure).
  for (const p of targets) {
    const ox = z.x - p.x;
    const oy = z.y - p.y;
    const od = Math.hypot(ox, oy);
    const min = z.r + p.r;
    if (od > 0.01 && od < min) {
      const push = min - od;
      z.x += (ox / od) * push * 0.8;
      z.y += (oy / od) * push * 0.8;
      if (!p.downed) {
        p.x -= (ox / od) * push * 0.2;
        p.y -= (oy / od) * push * 0.2;
        g.world.resolveCircle(p);
      }
    }
  }

  const moved = Math.hypot(z.x - z.lastX, z.y - z.lastY);
  z.walkT += moved * 0.12;
  if (moved > 0.2 && !face && z.attackWind <= 0) {
    // Smoothly turn toward the movement direction.
    const want = Math.atan2(z.vy, z.vx);
    const cur = Math.atan2(z.dirY, z.dirX);
    const a = cur + clamp(angleDiff(cur, want), -dt * 8, dt * 8);
    z.dirX = Math.cos(a);
    z.dirY = Math.sin(a);
  }
  // Stuck detection → re-path / jiggle.
  if (dir && speed > 5 && moved < speed * dt * 0.15) {
    z.stuckT += dt;
    if (z.stuckT > 0.8) {
      z.stuckT = 0;
      z.path = [];
      z.pathGoal = null;
      z.kx += -dir.y * 80 * (Math.random() < 0.5 ? -1 : 1);
      z.ky += dir.x * 80 * (Math.random() < 0.5 ? -1 : 1);
    }
  } else {
    z.stuckT = Math.max(0, z.stuckT - dt);
  }
  z.lastX = z.x;
  z.lastY = z.y;

  // Vocalise.
  if (z.groanT <= 0) {
    z.groanT = z.state === "chase" ? rand(2.5, 6) : rand(6, 14);
    const s = g.spatial(z.x, z.y);
    if (s.vol > 0.1) g.audio.groan(z.ztype, s.vol * (z.state === "chase" ? 1 : 0.5), s.pan);
  }

  // Animate arms.
  if (z.attackWind > 0) z.attackAnim = -0.9 * (1 - z.attackWind / z.attackWindMax);
  else if (z.attackSwing > 0) z.attackAnim = lerp(-0.9, 1.15, 1 - z.attackSwing / 0.14);
  else z.attackAnim = lerp(z.attackAnim, 0, 1 - Math.pow(0.0002, dt));
}

/** Basic melee wind-up → swing. Returns true while attacking. */
function melee(g: Game, z: Actor, target: Actor | null, dt: number): boolean {
  const def = ZOMBIES[z.ztype];
  if (def.damage <= 0) return false;
  if (z.attackSwing > 0) return true;
  if (z.attackWind > 0) {
    z.attackWind -= dt;
    if (z.attackWind <= 0) {
      z.attackWind = 0;
      z.attackSwing = 0.14;
      z.attackCd = z.ztype === "runner" ? 0.2 : 0.35;
      const smash = z.smash;
      if (smash >= 0) {
        z.smash = -1;
        const c = g.world.center(smash);
        const s = g.spatial(c.x, c.y);
        g.audio.barricade(s.pan, false);
        g.spark(c.x, c.y, "#a07a48", 4);
        if (g.world.damageBarricade(smash, def.smash)) g.onBarricadeBroken(smash);
        return true;
      }
      if (target) {
        const reach = z.r + target.r + 8 + (z.ztype === "boss" ? 18 : 0);
        if (len(target.x - z.x, target.y - z.y) < reach + 10) {
          g.hurtPlayer(target, def.damage * (z.enraged > 0 ? 1.25 : 1), target.x - z.x, target.y - z.y);
        }
      }
    }
    return true;
  }
  if (!target || z.attackCd > 0) return false;
  const reach = z.r + target.r + 6 + (z.ztype === "boss" ? 18 : 0);
  if (len(target.x - z.x, target.y - z.y) < reach) {
    const f = norm(target.x - z.x, target.y - z.y);
    z.dirX = f.x;
    z.dirY = f.y;
    const th = g.threat();
    const wind = Math.max(0.28, def.windup - (th - 1) * 0.035) * (z.enraged > 0 ? 0.75 : 1);
    z.attackWindMax = wind;
    z.attackWind = wind;
    z.smash = -1;
    return true;
  }
  return false;
}

/** Ranged / cowardly types keep their distance. */
function kiteDir(g: Game, z: Actor, t: Actor, d: number, sees: boolean): { dir: Vec; speed: number } | null {
  if (z.ztype !== "spitter" && z.ztype !== "screamer" && z.ztype !== "devil") return null;
  if (!sees) return null;
  const min = z.ztype === "devil" ? 130 : 150;
  const max = z.ztype === "devil" ? 300 : 320;
  const away = norm(z.x - t.x, z.y - t.y);
  if (d < min) {
    // Back off, sliding along walls.
    const probe = { x: z.x + away.x * 30, y: z.y + away.y * 30 };
    if (!g.world.circleHitsSolid(probe.x, probe.y, z.r)) return { dir: away, speed: 0.85 };
    const side = { x: -away.y * z.flank, y: away.x * z.flank };
    return { dir: side, speed: 0.8 };
  }
  if (d < max) {
    // Strafe.
    return { dir: { x: -away.y * z.flank, y: away.x * z.flank }, speed: 0.35 };
  }
  return null;
}

/** Start type-specific abilities. Returns true when the zombie's turn is consumed. */
function special(g: Game, z: Actor, t: Actor, d: number, sees: boolean): boolean {
  const k = z.ztype;
  const toT = norm(t.x - z.x, t.y - z.y);
  if ((k === "runner" || k === "crawler") && sees && d > 70 && d < 170 && z.abilityCd <= 0 && z.attackWind <= 0) {
    z.ability = { name: "lunge", phase: "prep", t: k === "crawler" ? 0.2 : 0.32, dirX: toT.x, dirY: toT.y };
    z.abilityCd = rand(2.4, 3.4);
    return true;
  }
  if ((k === "brute" || (k === "boss" && z.altCd <= 0)) && sees && d > 130 && d < 400 && z.abilityCd <= 0 && z.attackWind <= 0) {
    if (g.world.clearPath(z.x, z.y, t.x, t.y, z.r)) {
      z.ability = { name: "charge", phase: "prep", t: k === "boss" ? 0.9 : 0.75, dirX: toT.x, dirY: toT.y };
      z.abilityCd = k === "boss" ? 2 : rand(4.5, 6);
      if (k === "boss") z.altCd = bossCd(z, 7);
      const s = g.spatial(z.x, z.y);
      g.audio.roar(0.6 * s.vol, s.pan);
      return true;
    }
  }
  if (k === "spitter" && sees && d < 380 && z.altCd <= 0) {
    z.ability = { name: "spit", phase: "prep", t: 0.45, dirX: toT.x, dirY: toT.y };
    z.altCd = rand(2.2, 3);
    return true;
  }
  if (k === "devil" && sees && d < 520 && z.altCd <= 0 && z.attackWind <= 0) {
    z.altCd = rand(1.5, 2.1);
    const sx = z.x + toT.x * 18;
    const sy = z.y + toT.y * 18;
    g.spawnShot(sx, sy, toT.x * 220, toT.y * 220, { r: 8, dmg: 26, life: 2.6, pierce: 0, kind: "fireball", owner: z.id, streak: 10 }, false);
    const s = g.spatial(z.x, z.y);
    g.audio.fireball(s.pan);
    g.light(sx, sy, 90, 0.2, "255,120,40");
  }
  if (k === "bloater" && d < 56 && z.abilityCd <= 0) {
    z.ability = { name: "inflate", phase: "prep", t: 0.75, dirX: 0, dirY: 0 };
    return true;
  }
  if (k === "screamer" && sees && z.altCd <= 0) {
    z.ability = { name: "scream", phase: "prep", t: 0.9, dirX: 0, dirY: 0 };
    return true;
  }
  if (k === "boss") {
    if (d < 115 && z.abilityCd <= 0) {
      z.ability = { name: "slam", phase: "prep", t: 0.85, dirX: 0, dirY: 0 };
      z.abilityCd = bossCd(z, 3.2);
      return true;
    }
    if (z.summonCd <= 0) {
      z.ability = { name: "summon", phase: "prep", t: 0.8, dirX: 0, dirY: 0 };
      z.summonCd = bossCd(z, 15);
      return true;
    }
    if (sees && d > 170 && z.fireCd <= 0) {
      z.ability = { name: "volley", phase: "prep", t: 0.6, dirX: toT.x, dirY: toT.y };
      z.fireCd = bossCd(z, 6);
      return true;
    }
  }
  return false;
}

function bossCd(z: Actor, base: number): number {
  return base * (z.hp < z.maxHp * 0.5 ? 0.65 : 1);
}

function lob(g: Game, z: Actor, tx: number, ty: number, dmg: number): void {
  const d = len(tx - z.x, ty - z.y);
  const life = clamp(d / 380, 0.45, 1.1);
  const b = g.spawnShot(z.x, z.y, 0, 0, { r: 8, dmg, life, pierce: 0, kind: "acid", owner: z.id, streak: 0 }, false);
  b.sx = z.x;
  b.sy = z.y;
  b.tx = tx;
  b.ty = ty;
}

/** Advance the current ability. Returns true when it consumed the zombie's turn. */
function runAbility(g: Game, z: Actor, dt: number, target: Actor | null): boolean {
  const ab = z.ability;
  ab.t -= dt;
  z.vx *= 0.85;
  z.vy *= 0.85;
  switch (ab.name) {
    case "lunge": {
      if (ab.phase === "prep") {
        z.dirX = ab.dirX;
        z.dirY = ab.dirY;
        z.attackAnim = -0.6;
        if (ab.t <= 0) {
          if (target) {
            const d = norm(target.x - z.x, target.y - z.y);
            ab.dirX = d.x;
            ab.dirY = d.y;
          }
          ab.phase = "act";
          ab.t = 0.32;
        }
        return true;
      }
      const sp = z.ztype === "crawler" ? 330 : 360;
      z.x += ab.dirX * sp * dt;
      z.y += ab.dirY * sp * dt;
      z.attackAnim = 1;
      const before = { x: z.x, y: z.y };
      g.world.resolveCircle(z);
      const blocked = Math.abs(before.x - z.x) + Math.abs(before.y - z.y) > 2;
      for (const p of g.livingPlayers()) {
        if (len(p.x - z.x, p.y - z.y) < z.r + p.r + 4) {
          g.hurtPlayer(p, ZOMBIES[z.ztype].damage, ab.dirX, ab.dirY);
          ab.t = 0;
          break;
        }
      }
      if (ab.t <= 0 || blocked) {
        resetAbility(z);
        z.attackCd = 0.5;
        z.vx = ab.dirX * 60;
        z.vy = ab.dirY * 60;
      }
      return true;
    }
    case "charge": {
      if (ab.phase === "prep") {
        // Track the target while winding up, lock at the end.
        if (target) {
          const d = norm(target.x - z.x, target.y - z.y);
          ab.dirX = d.x;
          ab.dirY = d.y;
        }
        z.dirX = ab.dirX;
        z.dirY = ab.dirY;
        z.attackAnim = -0.9;
        if (ab.t <= 0) {
          ab.phase = "act";
          ab.t = 1.25;
          z.hitSet = new Set();
        }
        return true;
      }
      const sp = z.ztype === "boss" ? 380 : 340;
      z.x += ab.dirX * sp * dt;
      z.y += ab.dirY * sp * dt;
      z.attackAnim = 1.1;
      if (Math.random() < 0.6) g.particles.push({ x: z.x - ab.dirX * 14, y: z.y - ab.dirY * 14, z: 0, vx: rand(-30, 30), vy: rand(-30, 30), vz: 0, life: 0.4, max: 0.4, size: rand(5, 9), color: "#9a8a72", gravity: false });
      // Smash barricades in the way.
      const ahead = g.world.indexOf(z.x + ab.dirX * (z.r + 10), z.y + ab.dirY * (z.r + 10));
      if (g.world.barricadeHp.has(ahead) && g.world.damageBarricade(ahead, 9999)) g.onBarricadeBroken(ahead);
      const before = { x: z.x, y: z.y };
      g.world.resolveCircle(z);
      const hitWall = Math.abs(before.x - z.x) + Math.abs(before.y - z.y) > 3;
      const hit = z.hitSet ?? new Set<number>();
      for (const p of g.livingPlayers()) {
        if (hit.has(p.id)) continue;
        if (len(p.x - z.x, p.y - z.y) < z.r + p.r + 10) {
          hit.add(p.id);
          g.hurtPlayer(p, z.ztype === "boss" ? 45 : 32, ab.dirX, ab.dirY, true);
          p.x += ab.dirX * 40;
          p.y += ab.dirY * 40;
          g.world.resolveCircle(p);
        }
      }
      for (const o of g.hash.query(z.x, z.y, 40)) {
        if (o === z) continue;
        if (len(o.x - z.x, o.y - z.y) < z.r + o.r + 6) {
          const side = norm(-ab.dirY, ab.dirX);
          const s = (o.x - z.x) * side.x + (o.y - z.y) * side.y > 0 ? 1 : -1;
          o.kx += side.x * s * 260 * ZOMBIES[o.ztype].knock;
          o.ky += side.y * s * 260 * ZOMBIES[o.ztype].knock;
        }
      }
      if (hitWall) {
        g.addShake(7);
        const s = g.spatial(z.x, z.y);
        g.audio.explode(0.4 * s.vol, s.pan);
        g.spark(z.x + ab.dirX * z.size, z.y + ab.dirY * z.size, "#c9c0a8", 12);
        z.stun = z.ztype === "boss" ? 1.1 : 1.8;
        g.floatText(z.x, z.y - z.size - 30, "STUNNED", "#ffd84a", 13);
        resetAbility(z);
        return true;
      }
      if (ab.t <= 0) resetAbility(z);
      return true;
    }
    case "spit": {
      z.dirX = ab.dirX;
      z.dirY = ab.dirY;
      z.attackAnim = -0.5;
      if (ab.t <= 0) {
        if (target) {
          // Lead the target by its current velocity.
          const t = clamp(len(target.x - z.x, target.y - z.y) / 380, 0.45, 1.1) * 0.7;
          lob(g, z, target.x + target.vx * t, target.y + target.vy * t, 14);
          const s = g.spatial(z.x, z.y);
          g.audio.spit(s.pan);
        }
        resetAbility(z);
      }
      return true;
    }
    case "inflate": {
      z.attackAnim = Math.sin(ab.t * 40) * 0.3;
      z.size = ZOMBIES.bloater.size * (1 + (0.75 - Math.max(0, ab.t)) * 0.6);
      if (ab.t <= 0) {
        z.alive = true;
        g.bloaterBurst(z, true);
      }
      return true;
    }
    case "scream": {
      z.attackAnim = Math.sin(ab.t * 50) * 0.4;
      if (ab.phase === "prep" && ab.t <= 0) {
        ab.phase = "act";
        ab.t = 0.6;
        const s = g.spatial(z.x, z.y);
        g.audio.scream(Math.max(0.4, s.vol), s.pan);
        g.ring(z.x, z.y, 300, 0.7, "rgba(230,230,255,0.8)");
        g.addShake(3);
        z.altCd = 11;
        const tgt = target ?? g.livingPlayers()[0];
        for (const o of g.hash.query(z.x, z.y, 720)) {
          if (o === z) continue;
          const d = len(o.x - z.x, o.y - z.y);
          if (d > 720) continue;
          if (tgt) {
            o.state = "chase";
            o.targetId = tgt.id;
            o.lastSeen = { x: tgt.x, y: tgt.y };
            o.memoryT = Math.max(o.memoryT, 10);
            setMark(o, "!", 0.8);
          }
          if (d < 320) o.enraged = 7;
        }
        g.emitNoise(z.x, z.y, 400);
      }
      if (ab.phase === "act" && ab.t <= 0) resetAbility(z);
      return true;
    }
    case "slam": {
      z.attackAnim = -1;
      if (ab.t <= 0) {
        g.addShake(12);
        g.ring(z.x, z.y, 135, 0.3, "rgba(255,120,80,0.9)");
        const s = g.spatial(z.x, z.y);
        g.audio.explode(0.8 * s.vol, s.pan);
        for (const p of g.livingPlayers()) {
          const d = len(p.x - z.x, p.y - z.y);
          if (d < 135) {
            const n = norm(p.x - z.x, p.y - z.y);
            g.hurtPlayer(p, 38 * (1 - d / 200), n.x, n.y, true);
            p.x += n.x * 50;
            p.y += n.y * 50;
            g.world.resolveCircle(p);
          }
        }
        for (const o of g.hash.query(z.x, z.y, 140)) {
          if (o === z) continue;
          const n = norm(o.x - z.x, o.y - z.y);
          o.kx += n.x * 300 * ZOMBIES[o.ztype].knock;
          o.ky += n.y * 300 * ZOMBIES[o.ztype].knock;
        }
        g.spark(z.x, z.y, "#c9c0a8", 20);
        z.attackAnim = 1.2;
        resetAbility(z);
      }
      return true;
    }
    case "volley": {
      z.dirX = ab.dirX;
      z.dirY = ab.dirY;
      if (ab.t <= 0) {
        if (target) {
          const n = z.hp < z.maxHp * 0.5 ? 7 : 5;
          for (let i = 0; i < n; i++) {
            lob(g, z, target.x + rand(-90, 90), target.y + rand(-90, 90), 16);
          }
          const s = g.spatial(z.x, z.y);
          g.audio.spit(s.pan);
        }
        resetAbility(z);
      }
      return true;
    }
    case "summon": {
      z.attackAnim = Math.sin(ab.t * 30) * 0.5;
      if (ab.t <= 0) {
        const s = g.spatial(z.x, z.y);
        g.audio.roar(Math.max(0.5, s.vol), s.pan);
        g.addShake(6);
        g.ring(z.x, z.y, 200, 0.6, "rgba(160,60,90,0.8)");
        const n = z.hp < z.maxHp * 0.5 ? 6 : 4;
        for (let i = 0; i < n; i++) {
          const p = g.world.randomOpenNear(z.x, z.y, 3);
          if (!p) continue;
          const kind: ZombieKind = pick(["walker", "walker", "runner", "crawler"]);
          const m = g.spawnZombie(kind, p.x, p.y, "chase", 20);
          if (target) {
            m.targetId = target.id;
            m.lastSeen = { x: target.x, y: target.y };
          }
          g.spark(p.x, p.y, "#6a3a4a", 8);
        }
        resetAbility(z);
      }
      return true;
    }
  }
  resetAbility(z);
  return false;
}
