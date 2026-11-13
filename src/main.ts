import "./style.css";
import { AudioFx } from "./audio";
import { Game } from "./game";
import { Input } from "./input";
import { ARENA_DEFS, EXPEDITION_DEFS, dailySeed, generateOutbreak, loadMap, type OutbreakSize } from "./maps";
import type { MapDef } from "./maps/types";
import { loadProgress, mapRecord, recordRun, saveProgress, totalStars } from "./progress";
import { Renderer, drawMapPreview, fitCanvas } from "./render";
import { DIFFICULTY, type Settings, loadSettings, saveSettings } from "./settings";
import { UPGRADE_COUNT, WEAPONS, upgradeLabel, upgradeScore } from "./weapons";
import { ZOMBIES, ZOMBIE_LIST } from "./zombies";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const canvas = $<HTMLCanvasElement>("#game");
const minimap = $<HTMLCanvasElement>("#minimap");
const screens = ["#menu", "#select", "#settings", "#help", "#pause", "#results"] as const;
type Screen = (typeof screens)[number] | "game";

const audio = new AudioFx();
const input = new Input(canvas);
const renderer = new Renderer();
let settings: Settings = loadSettings();
let ctx = fitCanvas(canvas);
let game: Game | null = null;
let coop = false;
let current: { def: MapDef; level: number } | null = null;
let screen: Screen = "#menu";
let settingsReturn: Screen = "#menu";
let selectMode: "expedition" | "survival" | "outbreak" = "expedition";
let outbreakSize: OutbreakSize = "medium";
let last = performance.now();
let musicStarted = false;

window.addEventListener("resize", () => {
  ctx = fitCanvas(canvas);
});

// ───────────────────────────── screens ─────────────────────────────

function show(s: Screen): void {
  screen = s;
  for (const id of screens) $(id).classList.toggle("hidden", id !== s);
  const inGame = s === "game" || s === "#pause" || s === "#results";
  $("#hud").classList.toggle("hidden", !inGame || !game);
  $("#touch").classList.toggle("hidden", !(s === "game" && touchOn()));
  canvas.style.cursor = s === "game" && settings.aim === "mouse" ? "crosshair" : "default";
  if (s === "#menu") refreshMenu();
}

function touchOn(): boolean {
  if (settings.touch === "on") return true;
  if (settings.touch === "off") return false;
  return window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
}

function firstGesture(): void {
  audio.resume();
  if (!musicStarted) {
    musicStarted = true;
    audio.startMusic();
  }
}
window.addEventListener("pointerdown", firstGesture);
window.addEventListener("keydown", firstGesture);

function applyAudio(): void {
  audio.setVolumes(settings.master, settings.sfx, settings.music);
}
applyAudio();

// ───────────────────────────── menu ─────────────────────────────

function refreshMenu(): void {
  const p = loadProgress();
  const expIds = EXPEDITION_DEFS.map((d) => d.id);
  const cleared = expIds.filter((id) => (p.maps[id]?.clears ?? 0) > 0).length;
  $("#meta-expedition").textContent = `${cleared}/${expIds.length} cleared · ★ ${totalStars(expIds)}/${expIds.length * 3}`;
  const bestWave = Math.max(0, ...ARENA_DEFS.map((d) => p.maps[d.id]?.bestWave ?? 0));
  $("#meta-survival").textContent = `${ARENA_DEFS.length} rooms · best wave ${bestWave}`;
  const daily = p.maps[`outbreak-${dailySeed()}-medium`];
  $("#meta-outbreak").textContent = daily?.clears ? `Today's outbreak cleared ★ ${daily.stars}` : "Today's outbreak awaits";
  const mins = Math.round(p.totalTime / 60);
  $("#lifetime").textContent = p.totalPlays
    ? `${p.totalKills.toLocaleString()} zombies destroyed · ${p.totalPlays} runs · ${mins} min survived${p.bossKills ? ` · ${p.bossKills} abominations slain` : ""}`
    : "Tip: zombies hear gunfire. Sometimes the best fight is the one you avoid.";
}

for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("#player-toggle button"))) {
  b.addEventListener("click", () => {
    coop = b.dataset.players === "2";
    for (const o of Array.from(document.querySelectorAll("#player-toggle button"))) o.classList.toggle("on", o === b);
  });
}

$("#btn-expedition").addEventListener("click", () => openSelect("expedition"));
$("#btn-survival").addEventListener("click", () => openSelect("survival"));
$("#btn-outbreak").addEventListener("click", () => openSelect("outbreak"));
$("#btn-back").addEventListener("click", () => show("#menu"));
$("#btn-help").addEventListener("click", () => show("#help"));
$("#btn-help-done").addEventListener("click", () => show("#menu"));
$("#btn-settings").addEventListener("click", () => openSettings("#menu"));

// ───────────────────────────── map select ─────────────────────────────

function stars(n: number): string {
  return "★".repeat(n) + "☆".repeat(3 - n);
}

function mapCard(def: MapDef, opts: { num?: string; locked?: boolean; featured?: boolean; extra?: string; onPlay: () => void }): HTMLElement {
  const btn = document.createElement("button");
  btn.className = `map-card${opts.locked ? " locked" : ""}${opts.featured ? " featured" : ""}`;
  const c = document.createElement("canvas");
  drawMapPreview(c, loadMap(def));
  const rec = mapRecord(def.id);
  const info =
    def.mode === "survival"
      ? `<span>Best ${rec.best.toLocaleString()}</span><span>Wave ${rec.bestWave}</span>`
      : `<span>${rec.clears ? `Best ${fmtTime(rec.bestTime)}` : opts.extra ?? "Not cleared"}</span><span class="st">${stars(rec.stars)}</span>`;
  btn.innerHTML = `${opts.num ? `<span class="num">${opts.num}</span>` : ""}`;
  btn.append(c);
  btn.insertAdjacentHTML(
    "beforeend",
    `<span class="name">${def.name}</span><span class="blurb">${def.blurb}</span><span class="rec">${info}</span>`,
  );
  btn.addEventListener("click", () => {
    if (opts.locked) return;
    opts.onPlay();
  });
  return btn;
}

function openSelect(mode: typeof selectMode): void {
  selectMode = mode;
  const grid = $("#map-grid");
  grid.innerHTML = "";
  $("#outbreak-tools").classList.toggle("hidden", mode !== "outbreak");
  $("#select-kicker").textContent = `${mode.toUpperCase()} · ${coop ? "2 PLAYERS" : "1 PLAYER"}`;
  $("#diff-note").textContent = `Difficulty: ${DIFFICULTY[settings.difficulty].label} (change in Settings)`;
  if (mode === "expedition") {
    $("#select-title").textContent = "Choose an expedition";
    const p = loadProgress();
    EXPEDITION_DEFS.forEach((def, i) => {
      const locked = i > 0 && !(p.maps[EXPEDITION_DEFS[i - 1].id]?.clears ?? 0);
      grid.append(mapCard(def, { num: String(i + 1).padStart(2, "0"), locked, onPlay: () => startRun(def, i) }));
    });
  } else if (mode === "survival") {
    $("#select-title").textContent = "Pick a room to hold";
    ARENA_DEFS.forEach((def) => grid.append(mapCard(def, { onPlay: () => startRun(def, 0) })));
  } else {
    $("#select-title").textContent = "Procedural outbreak";
    const daily = dailySeed();
    const dDef = generateOutbreak(daily, outbreakSize);
    dDef.name = `Daily: ${dDef.name}`;
    grid.append(mapCard(dDef, { featured: true, extra: "Today's challenge", onPlay: () => startRun(dDef, 3) }));
    for (let i = 0; i < 5; i++) {
      const seed = Math.floor(Math.random() * 999999) + 1;
      const def = generateOutbreak(seed, outbreakSize);
      grid.append(mapCard(def, { extra: `Seed ${seed}`, onPlay: () => startRun(def, 3) }));
    }
  }
  show("#select");
}

for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("#size-toggle button"))) {
  b.addEventListener("click", () => {
    outbreakSize = b.dataset.size as OutbreakSize;
    for (const o of Array.from(document.querySelectorAll("#size-toggle button"))) o.classList.toggle("on", o === b);
    openSelect("outbreak");
  });
}
$("#btn-reroll").addEventListener("click", () => openSelect("outbreak"));
$("#btn-seed").addEventListener("click", () => {
  const v = Number($<HTMLInputElement>("#seed-input").value.replace(/\D/g, ""));
  if (!v) return;
  startRun(generateOutbreak(v, outbreakSize), 3);
});

// ───────────────────────────── settings ─────────────────────────────

function openSettings(ret: Screen): void {
  settingsReturn = ret;
  $<HTMLSelectElement>("#set-difficulty").value = settings.difficulty;
  $<HTMLSelectElement>("#set-aim").value = settings.aim;
  $<HTMLSelectElement>("#set-touch").value = settings.touch;
  $<HTMLInputElement>("#set-master").value = String(settings.master);
  $<HTMLInputElement>("#set-sfx").value = String(settings.sfx);
  $<HTMLInputElement>("#set-music").value = String(settings.music);
  $<HTMLInputElement>("#set-shake").value = String(settings.shake);
  $<HTMLInputElement>("#set-numbers").checked = settings.damageNumbers;
  $("#diff-desc").textContent = DIFFICULTY[settings.difficulty].desc + (game && !game.over ? " Applies to the next run." : "");
  show("#settings");
}

function readSettings(): void {
  settings = {
    difficulty: $<HTMLSelectElement>("#set-difficulty").value as Settings["difficulty"],
    aim: $<HTMLSelectElement>("#set-aim").value as Settings["aim"],
    touch: $<HTMLSelectElement>("#set-touch").value as Settings["touch"],
    master: Number($<HTMLInputElement>("#set-master").value),
    sfx: Number($<HTMLInputElement>("#set-sfx").value),
    music: Number($<HTMLInputElement>("#set-music").value),
    shake: Number($<HTMLInputElement>("#set-shake").value),
    damageNumbers: $<HTMLInputElement>("#set-numbers").checked,
  };
  saveSettings(settings);
  applyAudio();
  $("#diff-desc").textContent = DIFFICULTY[settings.difficulty].desc;
  if (game) {
    // Live-apply cosmetic settings to the running game.
    game.settings = { ...settings, difficulty: game.settings.difficulty };
  }
  if (touchOn()) enableTouch();
}

for (const id of ["#set-difficulty", "#set-aim", "#set-touch", "#set-master", "#set-sfx", "#set-music", "#set-shake", "#set-numbers"]) {
  $(id).addEventListener("input", readSettings);
  $(id).addEventListener("change", readSettings);
}
$("#btn-settings-done").addEventListener("click", () => show(settingsReturn));
$("#btn-fullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
});
$("#btn-reset").addEventListener("click", () => {
  if (!confirm("Erase all stars, best scores and unlocks?")) return;
  const p = loadProgress();
  p.maps = {};
  p.totalKills = 0;
  p.totalPlays = 0;
  p.totalTime = 0;
  p.bossKills = 0;
  saveProgress();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith("box-rooms-best-")) localStorage.removeItem(k);
  }
});

// ───────────────────────────── bestiary ─────────────────────────────

$("#bestiary").innerHTML = ZOMBIE_LIST.map(
  (z) =>
    `<div class="beast"><div class="sw" style="background:${z.colors[0]}"></div><div><div class="bn">${z.name.toUpperCase()}</div><div class="bd">${z.desc}</div></div></div>`,
).join("");

// ───────────────────────────── runs ─────────────────────────────

function enableTouch(): void {
  document.body.classList.add("touch");
  input.enableTouch($("#touch"));
}
if (touchOn()) enableTouch();

function startRun(def: MapDef, level: number): void {
  firstGesture();
  current = { def, level };
  game = new Game(loadMap(def), coop, audio, settings, level);
  audio.wave();
  hudCache.clear();
  minimap.classList.toggle("hidden", def.mode === "survival");
  show("game");
}

function pause(): void {
  if (!game || game.over || screen !== "game") return;
  $("#pause-title").textContent = game.map.name;
  $("#pause-sub").textContent =
    game.mode === "survival"
      ? `Wave ${game.wave} · ${Math.round(game.score).toLocaleString()} pts`
      : `${game.objectivesGot}/${game.objectivesTotal} ${game.map.objectiveLabel ?? ""} · ${fmtTime(game.time)}`;
  show("#pause");
}

$("#btn-resume").addEventListener("click", () => show("game"));
$("#btn-restart").addEventListener("click", () => current && startRun(current.def, current.level));
$("#btn-pause-settings").addEventListener("click", () => openSettings("#pause"));
$("#btn-quit").addEventListener("click", quitToMenu);
$("#btn-menu").addEventListener("click", quitToMenu);
$("#btn-retry").addEventListener("click", () => current && startRun(current.def, current.level));
$("#btn-next").addEventListener("click", () => {
  if (!current) return;
  const i = current.level + 1;
  if (EXPEDITION_DEFS[i]) startRun(EXPEDITION_DEFS[i], i);
});
$("#btn-pause-touch").addEventListener("click", pause);

function quitToMenu(): void {
  game = null;
  current = null;
  audio.setIntensity(0);
  show("#menu");
}

window.addEventListener("blur", () => pause());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

function showResults(): void {
  if (!game || !current) return;
  const g = game;
  const won = g.won;
  const st = g.stars();
  const kills = Object.values(g.stats.kills).reduce((a, b) => a + (b ?? 0), 0);
  const newBest = recordRun({
    mapId: g.map.id,
    score: g.score,
    wave: g.mode === "survival" ? g.wave : 0,
    kills,
    time: g.time,
    won,
    stars: st,
    bossKills: g.stats.bossKills,
  });
  $("#res-kicker").textContent = won ? "EXTRACTED" : g.mode === "survival" ? "OVERRUN" : "MISSION FAILED";
  $("#res-title").textContent = won ? `${g.map.name} cleared` : g.mode === "survival" ? `Wave ${g.wave} · ${g.map.name}` : g.map.name;
  $("#res-stars").innerHTML =
    g.mode === "survival" ? "" : [0, 1, 2].map((i) => `<span class="${i < st ? "on" : ""}">★</span>`).join("");
  $("#res-best").classList.toggle("hidden", !newBest);
  const acc = g.stats.shots ? Math.round((g.stats.hits / g.stats.shots) * 100) : 0;
  const cells: [string, string][] = [
    ["SCORE", Math.round(g.score).toLocaleString()],
    ["TIME", fmtTime(g.time)],
    ["KILLS", String(kills)],
    g.mode === "survival" ? ["WAVE", String(g.wave)] : ["OBJECTIVES", `${g.objectivesGot}/${g.objectivesTotal}`],
    ["ACCURACY", `${Math.min(100, acc)}%`],
    ["DAMAGE TAKEN", String(Math.round(g.stats.damageTaken))],
  ];
  if (g.mode !== "survival") cells.push(["PAR", fmtTime(g.map.parTime ?? 0)]);
  if (g.mode !== "survival") cells.push(["HORDES", String(g.stats.hordes)]);
  $("#res-stats").innerHTML = cells.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  $("#res-kills").innerHTML = Object.entries(g.stats.kills)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([k, n]) => {
      const z = ZOMBIES[k as keyof typeof ZOMBIES];
      return `<span class="kill-chip"><i style="background:${z.colors[0]}"></i>${z.name} <b>${n}</b></span>`;
    })
    .join("");
  const hasNext = won && g.mode === "expedition" && !!EXPEDITION_DEFS[current.level + 1];
  $("#btn-next").classList.toggle("hidden", !hasNext);
  $("#btn-retry").classList.toggle("primary", !hasNext);
  $("#btn-retry").classList.toggle("ghost", hasNext);
  fillUpgradeList();
  show("#results");
}

function fillUpgradeList(): void {
  if (!game) return;
  const g = game;
  $("#upgrade-summary").innerHTML = `
    <span>UNLOCKS <strong>${g.upgradeStep}/${UPGRADE_COUNT}</strong></span>
    <span>DMG <strong>x${g.dmgMul.toFixed(2)}</strong></span>
    <span>ROF <strong>x${g.fireMul.toFixed(2)}</strong></span>
    <span>RNG <strong>x${g.rangeMul.toFixed(2)}</strong></span>`;
  $("#upgrade-list").innerHTML = g.track
    .map((ev, i) => {
      const step = i + 1;
      const got = step <= g.upgradeStep;
      const next = step === g.upgradeStep + 1;
      const cls = got ? "got" : next ? "next" : "lock";
      return `<div class="up-item ${cls}"><span class="n">${String(step).padStart(2, "0")}</span><span class="name">${upgradeLabel(ev)}${ev.type === "stat" ? " +" : ""}</span><span class="score">${got ? "owned" : upgradeScore(step).toLocaleString()}</span></div>`;
    })
    .join("");
}

// ───────────────────────────── HUD ─────────────────────────────

const hudCache = new Map<string, string>();
function setText(sel: string, v: string): void {
  if (hudCache.get(sel) === v) return;
  hudCache.set(sel, v);
  $(sel).textContent = v;
}
function setHTML(sel: string, v: string): void {
  if (hudCache.get(sel + "#html") === v) return;
  hudCache.set(sel + "#html", v);
  $(sel).innerHTML = v;
}

function syncHud(now: number): void {
  if (!game) return;
  const g = game;
  const rec = mapRecord(g.map.id);
  if (g.mode === "survival") {
    setText("#hud-mode-label", "WAVE");
    setText("#hud-mode-value", String(g.wave));
    const left = g.spawnQueue.length + g.enemies.length;
    setText("#hud-sub", g.phase === "prep" ? `Next wave in ${Math.ceil(Math.max(0, g.phaseT))}` : `${left} remaining`);
    $("#hud-sub").classList.toggle("warn", false);
  } else {
    setText("#hud-mode-label", g.map.objectiveLabel ?? "OBJECTIVE");
    setText("#hud-mode-value", g.phase === "extract" ? "EXTRACT" : `${g.objectivesGot}/${g.objectivesTotal}`);
    const warn = g.hordeT < 10 && g.phase !== "extract";
    const sub =
      g.phase === "extract"
        ? g.extractT > 0
          ? `Extracting… ${Math.ceil(g.extractNeed - g.extractT)}`
          : "Get everyone to the pad"
        : `Horde in ${Math.max(0, Math.ceil(g.hordeT))}s · ${fmtTime(g.time)}`;
    setText("#hud-sub", sub);
    $("#hud-sub").classList.toggle("warn", warn);
    renderer.drawMinimap(minimap, g, now);
  }
  setText("#hud-score", Math.round(g.displayScore).toLocaleString());
  setText("#hud-best", rec.best.toLocaleString());
  setText("#combo-mult", `x${g.multiplier.toFixed(1)}`);
  $("#combo-fill").style.width = `${Math.max(0, Math.min(1, g.combo / g.comboMax)) * 100}%`;

  const boss = g.boss && g.boss.alive && g.boss.state === "chase" ? g.boss : null;
  $("#boss-bar").classList.toggle("hidden", !boss);
  if (boss) $("#boss-fill").style.width = `${Math.max(0, boss.hp / boss.maxHp) * 100}%`;

  const top = g.banners[g.banners.length - 1];
  const bannerEl = $("#banner");
  if (top) {
    const key = top.text + "|" + (top.sub ?? "");
    if (hudCache.get("banner") !== key) {
      hudCache.set("banner", key);
      $("#banner-text").textContent = top.text;
      $("#banner-sub").textContent = top.sub ?? "";
      bannerEl.className = top.tone ?? "info";
      // restart animation
      void bannerEl.offsetWidth;
    }
    bannerEl.classList.remove("hidden");
  } else {
    hudCache.delete("banner");
    bannerEl.classList.add("hidden");
  }

  const html = g.players
    .map((p) => {
      const i = p.playerIndex;
      const weps = WEAPONS.map((w, n) => {
        if (!g.unlocked.has(w.id)) return `<span class="wep lock">${n + 1}</span>`;
        const on = p.weapon === w.id;
        const ammo = w.infinite ? "∞" : String(p.ammo[w.id] ?? 0);
        const empty = !w.infinite && (p.ammo[w.id] ?? 0) <= 0;
        return `<span class="wep${on ? " on" : ""}${empty ? " empty" : ""}">${w.short} ${ammo}</span>`;
      }).join("");
      const status = !p.alive ? "DEAD" : p.downed ? `DOWN · ${Math.ceil(p.bleed)}s` : `${p.kills} kills`;
      const hpPct = Math.max(0, (p.hp / p.maxHp) * 100);
      return `<div class="player-card p${i + 1}${p.downed ? " down" : ""}"><div class="who"><span>P${i + 1}</span><span>${status}</span></div><div class="hp"><div style="width:${hpPct.toFixed(0)}%"></div></div><div class="weapons">${weps}</div></div>`;
    })
    .join("");
  setHTML("#players-hud", html);
}

// ───────────────────────────── loop ─────────────────────────────

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  input.pollPads();
  const t = now / 1000;

  if (input.pausePressed()) {
    if (screen === "game") pause();
    else if (screen === "#pause") show("game");
  }

  if (game) {
    const running = screen === "game";
    const wasOver = game.over;
    input.mouseWorld = renderer.screenToWorld(input.mouseX, input.mouseY);
    if (running) game.update(dt, input);
    renderer.draw(ctx, game, w, h, dpr, t);
    syncHud(t);
    if (game.over && !wasOver) {
      window.setTimeout(showResults, game.won ? 900 : 1400);
    }
  } else {
    drawAttract(t, w, h, dpr);
  }
  input.endFrame();
  requestAnimationFrame(frame);
}

// Animated title background: a lazy horde drifting across a dark floor.
const attract = Array.from({ length: 26 }, () => ({
  x: Math.random(),
  y: Math.random(),
  s: 8 + Math.random() * 10,
  v: 0.006 + Math.random() * 0.01,
  c: ["#5a7a38", "#4e6e30", "#6a843c", "#8f9e6a", "#7a6a8a"][Math.floor(Math.random() * 5)],
}));
function drawAttract(t: number, w: number, h: number, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#101318";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#171b22";
  ctx.lineWidth = 1;
  const off = (t * 8) % 40;
  ctx.beginPath();
  for (let x = -off; x < w; x += 40) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 0; y < h; y += 40) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  for (const z of attract) {
    z.x -= z.v / 60;
    if (z.x < -0.05) {
      z.x = 1.05;
      z.y = Math.random();
    }
    const x = z.x * w;
    const y = z.y * h + Math.sin(t * 2 + z.y * 10) * 3;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(x - z.s + 3, y + 4, z.s * 2, z.s);
    ctx.fillStyle = z.c;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x - z.s, y - z.s * 2, z.s * 2, z.s * 2);
    ctx.fillStyle = "#e04a2a";
    ctx.fillRect(x - z.s * 0.6, y - z.s * 1.2, 3, 3);
    ctx.fillRect(x - z.s * 0.1, y - z.s * 1.2, 3, 3);
    ctx.globalAlpha = 1;
  }
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.75)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

show("#menu");
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  // Debug handle for automated play-testing.
  (window as unknown as { __box: unknown }).__box = {
    get game() {
      return game;
    },
    startRun,
    input,
    EXPEDITION_DEFS,
    ARENA_DEFS,
    generateOutbreak,
  };
}
