/** Persistent player progress (localStorage). */
export type MapRecord = {
  best: number;
  bestWave: number;
  stars: number;
  bestTime: number;
  plays: number;
  clears: number;
};

export type Progress = {
  maps: Record<string, MapRecord>;
  totalKills: number;
  totalPlays: number;
  totalTime: number;
  bossKills: number;
};

const KEY = "box-rooms-progress-v2";

function empty(): Progress {
  return { maps: {}, totalKills: 0, totalPlays: 0, totalTime: 0, bossKills: 0 };
}

let cache: Progress | null = null;

export function loadProgress(): Progress {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...empty(), ...(JSON.parse(raw) as Progress) } : empty();
    // Migrate v1 best scores.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("box-rooms-best-")) continue;
      const id = k.slice("box-rooms-best-".length);
      const v = Number(localStorage.getItem(k) ?? 0);
      const rec = record(cache, id);
      rec.best = Math.max(rec.best, v);
    }
  } catch {
    cache = empty();
  }
  return cache;
}

function record(p: Progress, id: string): MapRecord {
  if (!p.maps[id]) p.maps[id] = { best: 0, bestWave: 0, stars: 0, bestTime: 0, plays: 0, clears: 0 };
  return p.maps[id];
}

export function mapRecord(id: string): MapRecord {
  return record(loadProgress(), id);
}

export function saveProgress(): void {
  if (!cache) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

export type RunResult = {
  mapId: string;
  score: number;
  wave: number;
  kills: number;
  time: number;
  won: boolean;
  stars: number;
  bossKills: number;
};

/** Returns true when this run set a new best score for the map. */
export function recordRun(r: RunResult): boolean {
  const p = loadProgress();
  const rec = record(p, r.mapId);
  const newBest = r.score > rec.best;
  rec.best = Math.max(rec.best, Math.round(r.score));
  rec.bestWave = Math.max(rec.bestWave, r.wave);
  rec.plays += 1;
  if (r.won) {
    rec.clears += 1;
    rec.stars = Math.max(rec.stars, r.stars);
    rec.bestTime = rec.bestTime ? Math.min(rec.bestTime, r.time) : r.time;
  }
  p.totalKills += r.kills;
  p.totalPlays += 1;
  p.totalTime += r.time;
  p.bossKills += r.bossKills;
  saveProgress();
  return newBest;
}

export function totalStars(ids: string[]): number {
  return ids.reduce((n, id) => n + (loadProgress().maps[id]?.stars ?? 0), 0);
}
