import "./style.css";
import { AudioFx } from "./audio";
import { Game } from "./game";
import { Input } from "./input";
import { MAPS, type GameMap } from "./maps";
import { UPGRADE_COUNT, WEAPONS, upgradeLabel, upgradeScore } from "./weapons";
import { drawGame, drawMapPreview, fitCanvas } from "./render";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const menuEl = document.querySelector<HTMLElement>("#menu")!;
const mapsEl = document.querySelector<HTMLElement>("#maps")!;
const overlayEl = document.querySelector<HTMLElement>("#overlay")!;
const hudEl = document.querySelector<HTMLElement>("#hud")!;
const mapGrid = document.querySelector<HTMLElement>("#map-grid")!;
const mapsTitle = document.querySelector<HTMLElement>("#maps-title")!;
const playersHud = document.querySelector<HTMLElement>("#players-hud")!;
const bannerEl = document.querySelector<HTMLElement>("#banner")!;

const audio = new AudioFx();
const input = new Input();
let game: Game | null = null;
let coop = false;
let hudKey = "";
let last = performance.now();
let ctx = fitCanvas(canvas);

window.addEventListener("resize", () => {
  ctx = fitCanvas(canvas);
});

document.querySelector("#btn-1p")!.addEventListener("click", () => openMaps(false));
document.querySelector("#btn-2p")!.addEventListener("click", () => openMaps(true));
document.querySelector("#btn-back")!.addEventListener("click", () => {
  mapsEl.classList.add("hidden");
  menuEl.classList.remove("hidden");
});
document.querySelector("#btn-retry")!.addEventListener("click", () => {
  if (!game) return;
  startGame(game.map);
});
document.querySelector("#btn-menu")!.addEventListener("click", () => {
  game = null;
  overlayEl.classList.add("hidden");
  hudEl.classList.add("hidden");
  menuEl.classList.remove("hidden");
});

function bestKey(id: string): string {
  return `box-rooms-best-${id}`;
}

function getBest(id: string): number {
  return Number(localStorage.getItem(bestKey(id)) ?? 0);
}

function setBest(id: string, score: number): void {
  const b = getBest(id);
  if (score > b) localStorage.setItem(bestKey(id), String(score));
}

function openMaps(two: boolean): void {
  coop = two;
  mapsTitle.textContent = two ? "2 Players — pick a room" : "1 Player — pick a room";
  menuEl.classList.add("hidden");
  mapsEl.classList.remove("hidden");
  mapGrid.innerHTML = "";
  for (const m of MAPS) {
    const btn = document.createElement("button");
    btn.className = "map-card";
    const c = document.createElement("canvas");
    drawMapPreview(c, m);
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = m.name;
    const best = document.createElement("span");
    best.className = "best";
    best.textContent = `Best ${getBest(m.id).toLocaleString()}`;
    btn.append(c, name, best);
    btn.addEventListener("click", () => startGame(m));
    mapGrid.append(btn);
  }
}

function startGame(map: GameMap): void {
  audio.wave();
  game = new Game(map, coop, audio);
  hudKey = "";
  mapsEl.classList.add("hidden");
  overlayEl.classList.add("hidden");
  menuEl.classList.add("hidden");
  hudEl.classList.remove("hidden");
}

function showOver(): void {
  if (!game) return;
  setBest(game.map.id, game.score);
  document.querySelector("#over-kicker")!.textContent = "GAME OVER";
  document.querySelector("#over-title")!.textContent = `Wave ${game.wave} · ${game.map.name}`;
  document.querySelector("#over-stats")!.textContent =
    `Score ${Math.round(game.score).toLocaleString()}  ·  Best ${getBest(game.map.id).toLocaleString()}`;
  fillUpgradeList();
  overlayEl.classList.remove("hidden");
}

function fillUpgradeList(): void {
  if (!game) return;
  const summary = document.querySelector("#upgrade-summary");
  const list = document.querySelector("#upgrade-list");
  if (!summary || !list) return;
  summary.innerHTML = `
    <span>UNLOCKS <strong>${game.upgradeStep}/${UPGRADE_COUNT}</strong></span>
    <span>DMG <strong>x${game.dmgMul.toFixed(2)}</strong></span>
    <span>ROF <strong>x${game.fireMul.toFixed(2)}</strong></span>
    <span>RNG <strong>x${game.rangeMul.toFixed(2)}</strong></span>
  `;
  const rows: string[] = [
    `<div class="up-item start got"><span class="n">00</span><span class="name">Pistol</span><span class="score">start</span></div>`,
  ];
  game.track.forEach((ev, i) => {
    const step = i + 1;
    const got = step <= game!.upgradeStep;
    const next = step === game!.upgradeStep + 1;
    const cls = got ? "got" : next ? "next" : "lock";
    const need = upgradeScore(step).toLocaleString();
    const extra = ev.type === "stat" ? " +" : "";
    rows.push(
      `<div class="up-item ${cls}"><span class="n">${String(step).padStart(2, "0")}</span><span class="name">${upgradeLabel(ev)}${extra}</span><span class="score">${got ? "owned" : next ? "next · " + need : need}</span></div>`,
    );
  });
  list.innerHTML = rows.join("");
}

function syncHud(): void {
  if (!game) return;
  document.querySelector("#hud-wave")!.textContent = String(game.wave);
  document.querySelector("#hud-score")!.textContent = Math.round(game.displayScore).toLocaleString();
  document.querySelector("#hud-best")!.textContent = getBest(game.map.id).toLocaleString();
  document.querySelector("#combo-mult")!.textContent = `x${game.multiplier.toFixed(1)}`;
  const fill = document.querySelector<HTMLElement>("#combo-fill")!;
  fill.style.width = `${Math.max(0, Math.min(1, game.combo / game.comboMax)) * 100}%`;
  const up = document.querySelector("#upgrade-line");
  if (up) {
    up.textContent = `UP ${game.upgradeStep}/${UPGRADE_COUNT}  ·  DMG ${game.statSteps.damage}  ·  ROF ${game.statSteps.fireRate}  ·  RNG ${game.statSteps.range}`;
  }

  const top = game.banners[game.banners.length - 1];
  if (top) {
    bannerEl.textContent = top.text;
    bannerEl.classList.remove("hidden");
  } else {
    bannerEl.classList.add("hidden");
  }

  const key = game.players
    .map((p) => `${p.hp}|${p.weapon}|${p.alive}|${p.kills}|${JSON.stringify(p.ammo)}`)
    .join(";") + [...game.unlocked].join() + `|${game.upgradeStep}|${game.statSteps.damage}|${game.statSteps.fireRate}|${game.statSteps.range}`;
  if (key === hudKey) return;
  hudKey = key;

  playersHud.innerHTML = "";
  for (const p of game.players) {
    const i = p.playerIndex ?? 0;
    const card = document.createElement("div");
    card.className = `player-card p${i + 1}`;
    const weps = WEAPONS.map((w) => {
      const on = p.weapon === w.id;
      const lock = !game!.unlocked.has(w.id);
      const ammo = w.infinite ? "∞" : String(p.ammo[w.id] ?? 0);
      const cls = lock ? "wep lock" : on ? "wep on" : "wep";
      return `<span class="${cls}">${w.short}${lock ? "" : " " + ammo}</span>`;
    }).join("");
    card.innerHTML = `
      <div class="who">${i === 0 ? "P1" : "P2"} ${p.alive ? "" : "DOWN"} · ${p.kills} kills</div>
      <div class="hp"><div style="width:${Math.max(0, (p.hp / p.maxHp) * 100)}%"></div></div>
      <div class="weapons">${weps}</div>
    `;
    playersHud.append(card);
  }
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (game) {
    if (input.just("Escape") && !game.over) {
      overlayEl.classList.toggle("hidden");
      const paused = !overlayEl.classList.contains("hidden");
      document.querySelector("#over-kicker")!.textContent = paused ? "PAUSED" : "GAME OVER";
      document.querySelector("#over-title")!.textContent = game.map.name;
      document.querySelector("#over-stats")!.textContent = paused
        ? "Esc to resume · Retry room to restart"
        : "";
      if (paused) fillUpgradeList();
    }
    const paused = !overlayEl.classList.contains("hidden") && !game.over;
    const wasOver = game.over;
    if (!paused) game.update(dt, input);
    drawGame(ctx, game, w, h, Math.min(2, window.devicePixelRatio || 1));
    syncHud();
    if (game.over && !wasOver) showOver();
  } else {
    ctx.setTransform(Math.min(2, window.devicePixelRatio || 1), 0, 0, Math.min(2, window.devicePixelRatio || 1), 0, 0);
    ctx.fillStyle = "#0c0e12";
    ctx.fillRect(0, 0, w, h);
  }
  input.endFrame();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
