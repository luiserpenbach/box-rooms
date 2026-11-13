export type WeaponId =
  | "pistol"
  | "uzi"
  | "shotgun"
  | "grenade"
  | "barrel"
  | "claymore"
  | "wall"
  | "rocket"
  | "railgun";

export type WeaponDef = {
  id: WeaponId;
  name: string;
  short: string;
  unlock: number;
  place: boolean;
  fireRate: number;
  ammo: number;
  grant: number;
  infinite?: boolean;
};

export const WEAPONS: WeaponDef[] = [
  { id: "pistol", name: "Pistol", short: "PST", unlock: 0, place: false, fireRate: 3.2, ammo: 0, grant: 0, infinite: true },
  { id: "uzi", name: "Uzi", short: "UZI", unlock: 600, place: false, fireRate: 12, ammo: 90, grant: 70 },
  { id: "shotgun", name: "Shotgun", short: "SHG", unlock: 1800, place: false, fireRate: 1.15, ammo: 16, grant: 12 },
  { id: "grenade", name: "Grenades", short: "GRN", unlock: 3200, place: false, fireRate: 1.6, ammo: 6, grant: 5 },
  { id: "barrel", name: "Barrels", short: "BRL", unlock: 4800, place: true, fireRate: 2.5, ammo: 4, grant: 3 },
  { id: "claymore", name: "Claymore", short: "CLY", unlock: 6500, place: true, fireRate: 2.2, ammo: 5, grant: 4 },
  { id: "wall", name: "Walls", short: "WAL", unlock: 8500, place: true, fireRate: 2, ammo: 6, grant: 4 },
  { id: "rocket", name: "Rocket", short: "RKT", unlock: 11000, place: false, fireRate: 0.85, ammo: 5, grant: 4 },
  { id: "railgun", name: "Railgun", short: "RAI", unlock: 14500, place: false, fireRate: 0.7, ammo: 8, grant: 6 },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w])) as Record<
  WeaponId,
  WeaponDef
>;

export const UPGRADE_COUNT = 50;
export type StatId = "range" | "fireRate" | "damage";
export type UpgradeEvent =
  | { type: "weapon"; id: WeaponId }
  | { type: "stat"; stat: StatId };

const WEAPON_AT_STEP = new Map<number, WeaponId>([
  [2, "uzi"],
  [5, "shotgun"],
  [9, "grenade"],
  [13, "barrel"],
  [18, "claymore"],
  [24, "wall"],
  [32, "rocket"],
  [40, "railgun"],
]);

export function upgradeScore(step: number): number {
  return Math.round(240 * step + 6 * step * step);
}

export function buildUpgradeTrack(): UpgradeEvent[] {
  const stats: StatId[] = ["range", "fireRate", "damage"];
  const track: UpgradeEvent[] = [];
  for (let i = 1; i <= UPGRADE_COUNT; i++) {
    const id = WEAPON_AT_STEP.get(i);
    if (id) track.push({ type: "weapon", id });
    else track.push({ type: "stat", stat: stats[Math.floor(Math.random() * stats.length)] });
  }
  return track;
}

export function upgradeLabel(ev: UpgradeEvent): string {
  if (ev.type === "weapon") return WEAPON_BY_ID[ev.id].name;
  if (ev.stat === "range") return "Range";
  if (ev.stat === "fireRate") return "Fire rate";
  return "Damage";
}

export function upgradeAt(step: number): UpgradeEvent {
  const id = WEAPON_AT_STEP.get(step);
  if (id) return { type: "weapon", id };
  const stats: StatId[] = ["range", "fireRate", "damage"];
  return { type: "stat", stat: stats[Math.floor(Math.random() * stats.length)] };
}
