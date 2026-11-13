export type Difficulty = "easy" | "normal" | "hard" | "nightmare";

export type Settings = {
  master: number;
  sfx: number;
  music: number;
  shake: number;
  aim: "classic" | "mouse";
  difficulty: Difficulty;
  damageNumbers: boolean;
  touch: "auto" | "on" | "off";
};

const KEY = "box-rooms-settings-v2";

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  sfx: 0.9,
  music: 0.5,
  shake: 1,
  aim: "classic",
  difficulty: "normal",
  damageNumbers: true,
  touch: "auto",
};

export const DIFFICULTY: Record<
  Difficulty,
  { label: string; count: number; damage: number; speed: number; hp: number; score: number; desc: string }
> = {
  easy: { label: "Easy", count: 0.7, damage: 0.6, speed: 0.92, hp: 0.85, score: 0.6, desc: "Fewer, weaker zombies." },
  normal: { label: "Normal", count: 1, damage: 1, speed: 1, hp: 1, score: 1, desc: "The intended experience." },
  hard: { label: "Hard", count: 1.3, damage: 1.35, speed: 1.06, hp: 1.15, score: 1.5, desc: "Bigger hordes that hit harder." },
  nightmare: {
    label: "Nightmare",
    count: 1.6,
    damage: 1.8,
    speed: 1.12,
    hp: 1.3,
    score: 2.2,
    desc: "You will not survive. Probably.",
  },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage may be unavailable (private mode) */
  }
}
