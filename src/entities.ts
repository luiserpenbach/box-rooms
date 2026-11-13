import type { Vec } from "./math";
import type { WeaponId } from "./weapons";
import type { ZombieKind } from "./zombies";

export type AIState = "idle" | "wander" | "investigate" | "chase" | "search" | "dormant";

/** Multi-phase special ability (lunge, charge, scream, slam...). */
export type Ability = {
  name: "" | "lunge" | "charge" | "scream" | "inflate" | "slam" | "spit" | "volley" | "summon";
  phase: "" | "prep" | "act";
  t: number;
  dirX: number;
  dirY: number;
};

export type Actor = {
  id: number;
  kind: "player" | "zombie";
  ztype: ZombieKind;
  x: number;
  y: number;
  r: number;
  size: number;
  lift: number;
  hp: number;
  maxHp: number;
  /** Facing (unit vector). */
  dirX: number;
  dirY: number;
  /** Smoothed velocity for zombies. */
  vx: number;
  vy: number;
  /** Knockback impulse. */
  kx: number;
  ky: number;
  speed: number;
  color: string;
  hurt: number;
  alive: boolean;
  kills: number;
  fireCd: number;
  fireAnim: number;
  walkT: number;

  // Player
  playerIndex: number;
  weapon: WeaponId;
  ammo: Partial<Record<WeaponId, number>>;
  downed: boolean;
  bleed: number;
  revive: number;
  shoveCd: number;
  shoveAnim: number;
  damageTaken: number;
  everDowned: boolean;

  // Zombie AI
  state: AIState;
  stateT: number;
  targetId: number;
  lastSeen: Vec;
  memoryT: number;
  path: Vec[];
  pathGoal: Vec | null;
  home: Vec;
  thinkT: number;
  mark: "" | "!" | "?";
  markT: number;
  attackWind: number;
  attackWindMax: number;
  attackSwing: number;
  attackCd: number;
  attackAnim: number;
  barricade: number;
  ability: Ability;
  abilityCd: number;
  altCd: number;
  summonCd: number;
  stun: number;
  enraged: number;
  flank: number;
  stuckT: number;
  lastX: number;
  lastY: number;
  groanT: number;
  /** Render-side visibility fade (0..1) for fog of war. */
  seen: number;
  visible: boolean;
  /** Sleep far-away zombies to save CPU. */
  sleeping: boolean;
  /** Result of the last perception check. */
  sees: boolean;
  /** Wander destination. */
  goal: Vec | null;
  /** Barricade tile index being smashed by the current swing (-1 = none). */
  smash: number;
  /** Players already hit by the current charge. */
  hitSet: Set<number> | null;
};

export type BulletKind = "bullet" | "pellet" | "grenade" | "rocket" | "fireball" | "rail" | "acid";

export type Bullet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  life: number;
  maxLife: number;
  pierce: number;
  friendly: boolean;
  kind: BulletKind;
  owner: number;
  px: number;
  py: number;
  streak: number;
  /** Acid lob target / arc. */
  tx?: number;
  ty?: number;
  sx?: number;
  sy?: number;
  hit?: Set<number>;
};

export type Placeable = {
  x: number;
  y: number;
  r: number;
  kind: "barrel" | "claymore";
  hp: number;
  dirX: number;
  dirY: number;
  owner: number;
  armed: number;
};

export type Hazard = {
  x: number;
  y: number;
  r: number;
  kind: "acid" | "gas" | "fire";
  life: number;
  max: number;
  dps: number;
};

export type Pickup = {
  x: number;
  y: number;
  r: number;
  kind: "package" | "ammo" | "medkit" | "supply" | "objective";
  life: number;
  bob: number;
};

export type Corpse = { x: number; y: number; size: number; color: string; rot: number; life: number; kind: ZombieKind };

export type Blood = { x: number; y: number; s: number; a: number; rot: number; vx: number; vy: number };

export type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: boolean;
};

export type FloatText = { x: number; y: number; text: string; life: number; color: string; size: number };

export type Light = { x: number; y: number; r: number; life: number; max: number; color: string };

export type Ring = { x: number; y: number; r: number; maxR: number; life: number; max: number; color: string };

export type Banner = { text: string; life: number; sub?: string; tone?: "info" | "warn" | "good" };
