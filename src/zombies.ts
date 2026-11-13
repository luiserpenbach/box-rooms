export type ZombieKind =
  | "walker"
  | "runner"
  | "crawler"
  | "brute"
  | "spitter"
  | "bloater"
  | "screamer"
  | "devil"
  | "boss";

export type ZombieDef = {
  kind: ZombieKind;
  name: string;
  /** Short description for the bestiary / how-to-play. */
  desc: string;
  hp: number;
  /** Collision radius (≤ 15 so everything fits through 1-tile gaps). */
  r: number;
  /** Visual half-size of the box body. */
  size: number;
  lift: number;
  wanderSpeed: number;
  chaseSpeed: number;
  damage: number;
  /** Base melee wind-up in seconds (shortens with waves). */
  windup: number;
  /** Damage dealt to barricades per hit. */
  smash: number;
  sight: number;
  /** Half-angle of the view cone while unaware (radians). */
  fov: number;
  hearing: number;
  /** Seconds a chasing zombie keeps tracking without line of sight. */
  memory: number;
  score: number;
  colors: string[];
  /** Strength of flanking/encircling offset when closing in. */
  flank: number;
  /** Knockback multiplier (0 = immovable). */
  knock: number;
};

export const ZOMBIES: Record<ZombieKind, ZombieDef> = {
  walker: {
    kind: "walker",
    name: "Walker",
    desc: "Slow, relentless and never alone. Groans alert the others.",
    hp: 24,
    r: 11,
    size: 11,
    lift: 11,
    wanderSpeed: 22,
    chaseSpeed: 40,
    damage: 15,
    windup: 0.95,
    smash: 18,
    sight: 300,
    fov: 1.1,
    hearing: 1,
    memory: 5,
    score: 100,
    colors: ["#5a7a38", "#4e6e30", "#6a843c", "#62763a"],
    flank: 0.35,
    knock: 1,
  },
  runner: {
    kind: "runner",
    name: "Runner",
    desc: "Fast and flanking. Crouches, then lunges — sidestep it.",
    hp: 18,
    r: 10,
    size: 10,
    lift: 12,
    wanderSpeed: 30,
    chaseSpeed: 108,
    damage: 12,
    windup: 0.55,
    smash: 10,
    sight: 360,
    fov: 1.3,
    hearing: 1.2,
    memory: 7,
    score: 150,
    colors: ["#8f9e6a", "#9aa874", "#86965e"],
    flank: 0.85,
    knock: 1.2,
  },
  crawler: {
    kind: "crawler",
    name: "Crawler",
    desc: "Plays dead among the corpses. Springs when you get close.",
    hp: 14,
    r: 9,
    size: 9,
    lift: 5,
    wanderSpeed: 18,
    chaseSpeed: 84,
    damage: 10,
    windup: 0.45,
    smash: 6,
    sight: 160,
    fov: 1.6,
    hearing: 0.8,
    memory: 6,
    score: 150,
    colors: ["#6f6a4a", "#7a7452"],
    flank: 0.6,
    knock: 1.3,
  },
  brute: {
    kind: "brute",
    name: "Brute",
    desc: "A wall of meat. Telegraphs a charge — dodge and it stuns itself on the wall.",
    hp: 260,
    r: 15,
    size: 19,
    lift: 18,
    wanderSpeed: 20,
    chaseSpeed: 38,
    damage: 30,
    windup: 1.0,
    smash: 90,
    sight: 320,
    fov: 1.1,
    hearing: 0.9,
    memory: 8,
    score: 600,
    colors: ["#4a5a3a", "#526242"],
    flank: 0.1,
    knock: 0.15,
  },
  spitter: {
    kind: "spitter",
    name: "Spitter",
    desc: "Keeps its distance and lobs acid that pools on the floor.",
    hp: 40,
    r: 11,
    size: 11,
    lift: 13,
    wanderSpeed: 22,
    chaseSpeed: 58,
    damage: 10,
    windup: 0.8,
    smash: 10,
    sight: 380,
    fov: 1.2,
    hearing: 1,
    memory: 6,
    score: 300,
    colors: ["#a8a63a", "#9a9a34"],
    flank: 0.5,
    knock: 1,
  },
  bloater: {
    kind: "bloater",
    name: "Bloater",
    desc: "Swells up and bursts. Pop it at range — the blast hurts zombies too.",
    hp: 70,
    r: 14,
    size: 16,
    lift: 14,
    wanderSpeed: 16,
    chaseSpeed: 30,
    damage: 0,
    windup: 0.7,
    smash: 30,
    sight: 260,
    fov: 1.2,
    hearing: 1,
    memory: 6,
    score: 350,
    colors: ["#7a6a8a", "#6e6080"],
    flank: 0,
    knock: 0.5,
  },
  screamer: {
    kind: "screamer",
    name: "Screamer",
    desc: "Shrieks to summon and enrage every zombie nearby. Kill it first.",
    hp: 35,
    r: 10,
    size: 10,
    lift: 16,
    wanderSpeed: 24,
    chaseSpeed: 70,
    damage: 8,
    windup: 0.7,
    smash: 8,
    sight: 420,
    fov: 1.5,
    hearing: 1.4,
    memory: 9,
    score: 400,
    colors: ["#c9c2b0", "#d4cdb8"],
    flank: 0.4,
    knock: 1,
  },
  devil: {
    kind: "devil",
    name: "Devil",
    desc: "Hurls fireballs from range. Shoot the fireballs down.",
    hp: 170,
    r: 14,
    size: 16,
    lift: 16,
    wanderSpeed: 26,
    chaseSpeed: 54,
    damage: 22,
    windup: 0.9,
    smash: 40,
    sight: 420,
    fov: 1.4,
    hearing: 1,
    memory: 10,
    score: 500,
    colors: ["#b42828"],
    flank: 0.3,
    knock: 0.6,
  },
  boss: {
    kind: "boss",
    name: "Abomination",
    desc: "Slams, charges, spews acid and calls the horde. Watch the telegraphs.",
    hp: 2000,
    r: 15,
    size: 30,
    lift: 26,
    wanderSpeed: 20,
    chaseSpeed: 44,
    damage: 40,
    windup: 0.9,
    smash: 400,
    sight: 520,
    fov: 2.2,
    hearing: 1.5,
    memory: 30,
    score: 5000,
    colors: ["#5a3a4a"],
    flank: 0,
    knock: 0,
  },
};

export const ZOMBIE_LIST = Object.values(ZOMBIES);
