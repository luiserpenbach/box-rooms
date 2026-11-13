import type { ZombieKind } from "./zombies";

/** Procedural Web Audio sound effects + ambient score. No asset files needed. */
export class AudioFx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private drone: { oscs: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  private pulse: { gain: GainNode } | null = null;
  private intensity = 0;
  private beatT = 0;
  private recent = new Map<string, number>();
  masterVol = 0.8;
  sfxVol = 0.9;
  musicVol = 0.5;

  /** Must be called from a user gesture at least once. */
  resume(): void {
    this.ac();
  }

  private ac(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      const len = this.ctx.sampleRate * 1.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setVolumes(master: number, sfx: number, music: number): void {
    this.masterVol = master;
    this.sfxVol = sfx;
    this.musicVol = music;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.master || !this.sfx || !this.music) return;
    this.master.gain.value = this.masterVol;
    this.sfx.gain.value = this.sfxVol;
    this.music.gain.value = this.musicVol * 0.6;
  }

  /** Rate-limit identical sounds so hordes don't clip. */
  private gate(key: string, gap: number): boolean {
    if (!this.ctx) return true;
    const now = this.ctx.currentTime;
    const last = this.recent.get(key) ?? -1;
    if (now - last < gap) return false;
    this.recent.set(key, now);
    return true;
  }

  private out(pan: number): AudioNode {
    const c = this.ac();
    if (pan !== 0 && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(this.sfx!);
      return p;
    }
    return this.sfx!;
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain = 0.08, slide = 0, pan = 0, delay = 0): void {
    const c = this.ac();
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.out(pan));
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain = 0.12, freq = 800, type: BiquadFilterType = "lowpass", pan = 0, q = 0.7, delay = 0): void {
    const c = this.ac();
    const t0 = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.out(pan));
    src.start(t0, Math.random() * 0.5, dur + 0.05);
  }

  shoot(kind: "light" | "heavy" | "shotgun" | "rail" | "launcher" = "light"): void {
    if (!this.gate("shoot-" + kind, 0.03)) return;
    if (kind === "light") {
      this.noise(0.05, 0.09, 2400, "bandpass", 0, 0.9);
      this.tone(380, 0.05, "square", 0.035, -220);
    } else if (kind === "shotgun") {
      this.noise(0.16, 0.2, 900);
      this.tone(110, 0.12, "square", 0.05, -60);
    } else if (kind === "rail") {
      this.tone(1600, 0.25, "sawtooth", 0.05, -1400);
      this.noise(0.1, 0.1, 5000, "highpass");
    } else if (kind === "launcher") {
      this.noise(0.22, 0.12, 500);
      this.tone(90, 0.2, "triangle", 0.08, 60);
    } else {
      this.noise(0.08, 0.14, 400);
      this.tone(140, 0.05, "square", 0.04, -200);
    }
  }

  explode(vol = 1, pan = 0): void {
    if (!this.gate("explode", 0.04)) return;
    this.noise(0.6, 0.3 * vol, 260, "lowpass", pan);
    this.noise(0.15, 0.15 * vol, 1500, "lowpass", pan);
    this.tone(70, 0.45, "sine", 0.22 * vol, -40, pan);
  }

  hit(): void {
    if (!this.gate("hit", 0.035)) return;
    this.noise(0.05, 0.08, 700, "bandpass", 0, 1.4);
    this.tone(160 + Math.random() * 40, 0.06, "square", 0.03, -80);
  }

  splat(vol = 1, pan = 0): void {
    if (!this.gate("splat", 0.05)) return;
    this.noise(0.18, 0.12 * vol, 500, "lowpass", pan, 2);
    this.tone(90, 0.12, "sine", 0.06 * vol, -40, pan);
  }

  hurt(): void {
    if (!this.gate("hurt", 0.12)) return;
    this.tone(220, 0.18, "sawtooth", 0.07, -120);
    this.noise(0.12, 0.08, 900);
  }

  shove(): void {
    this.noise(0.1, 0.1, 400, "bandpass", 0, 1);
    this.tone(120, 0.08, "triangle", 0.06, -40);
  }

  pickup(): void {
    this.tone(520, 0.08, "square", 0.05, 200);
    this.tone(780, 0.12, "square", 0.04, 120, 0, 0.06);
  }

  objective(): void {
    this.tone(523, 0.14, "triangle", 0.08);
    this.tone(659, 0.14, "triangle", 0.08, 0, 0, 0.1);
    this.tone(784, 0.3, "triangle", 0.08, 0, 0, 0.2);
  }

  wave(): void {
    this.tone(220, 0.25, "sawtooth", 0.06, 80);
    this.tone(330, 0.3, "square", 0.04, 40, 0, 0.08);
  }

  horde(): void {
    // Distant chorus of groans + low horn.
    for (let i = 0; i < 6; i++) {
      this.tone(70 + Math.random() * 60, 1.4, "sawtooth", 0.035, -20, Math.random() * 2 - 1, i * 0.12);
    }
    this.tone(55, 1.6, "triangle", 0.12, 10);
    this.noise(1.4, 0.06, 300, "lowpass", 0, 1, 0.1);
  }

  unlockSound(): void {
    this.tone(400, 0.1, "square", 0.05);
    this.tone(600, 0.14, "square", 0.05, 0, 0, 0.08);
    this.tone(800, 0.2, "square", 0.045, 0, 0, 0.16);
  }

  death(): void {
    this.tone(300, 0.6, "sawtooth", 0.08, -250);
    this.tone(150, 0.9, "triangle", 0.08, -100, 0, 0.1);
  }

  downed(): void {
    this.tone(260, 0.5, "sawtooth", 0.07, -180);
  }

  revive(): void {
    this.tone(330, 0.12, "triangle", 0.07, 0);
    this.tone(494, 0.2, "triangle", 0.07, 0, 0, 0.1);
  }

  victory(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.4, "triangle", 0.08, 0, 0, i * 0.13));
  }

  fireball(pan = 0): void {
    this.noise(0.14, 0.08, 600, "lowpass", pan);
    this.tone(160, 0.12, "sawtooth", 0.04, -40, pan);
  }

  spit(pan = 0): void {
    if (!this.gate("spit", 0.08)) return;
    this.noise(0.12, 0.08, 1400, "bandpass", pan, 3);
    this.tone(300, 0.1, "sine", 0.04, 200, pan);
  }

  sizzle(): void {
    if (!this.gate("sizzle", 0.25)) return;
    this.noise(0.25, 0.05, 3000, "highpass");
  }

  barricade(pan = 0, broke = false): void {
    if (!this.gate("barricade", 0.08)) return;
    this.noise(broke ? 0.35 : 0.1, broke ? 0.2 : 0.1, broke ? 600 : 1200, "bandpass", pan, 1.2);
    this.tone(broke ? 80 : 140, 0.1, "square", 0.04, -40, pan);
  }

  /** Zombie vocalisation, volume/pan already attenuated by distance. */
  groan(kind: ZombieKind, vol: number, pan: number): void {
    if (vol < 0.04 || !this.gate("groan", 0.18)) return;
    const c = this.ac();
    const t0 = c.currentTime;
    const base =
      kind === "brute" || kind === "boss" ? 55 : kind === "runner" || kind === "crawler" ? 140 : kind === "screamer" ? 220 : 90;
    const dur = kind === "runner" ? 0.35 : 0.7 + Math.random() * 0.5;
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.25), t0);
    o.frequency.linearRampToValueAtTime(base * (0.7 + Math.random() * 0.2), t0 + dur);
    const lfo = c.createOscillator();
    lfo.frequency.value = 5 + Math.random() * 6;
    const lg = c.createGain();
    lg.gain.value = base * 0.06;
    lfo.connect(lg).connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = base * 5;
    f.Q.value = 2.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.09 * vol, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(f).connect(g).connect(this.out(pan));
    o.start(t0);
    lfo.start(t0);
    o.stop(t0 + dur + 0.05);
    lfo.stop(t0 + dur + 0.05);
  }

  scream(vol = 1, pan = 0): void {
    const c = this.ac();
    const t0 = c.currentTime;
    for (const mul of [1, 1.5, 2.02]) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(600 * mul, t0);
      o.frequency.linearRampToValueAtTime(900 * mul, t0 + 0.3);
      o.frequency.linearRampToValueAtTime(500 * mul, t0 + 1.1);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.05 * vol, t0 + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
      o.connect(g).connect(this.out(pan));
      o.start(t0);
      o.stop(t0 + 1.25);
    }
    this.noise(1.1, 0.08 * vol, 3000, "bandpass", pan, 2);
  }

  roar(vol = 1, pan = 0): void {
    this.tone(60, 0.9, "sawtooth", 0.14 * vol, -20, pan);
    this.tone(90, 0.8, "square", 0.06 * vol, -30, pan);
    this.noise(0.9, 0.12 * vol, 400, "lowpass", pan);
  }

  heartbeat(): void {
    this.tone(55, 0.12, "sine", 0.2);
    this.tone(50, 0.14, "sine", 0.16, 0, 0, 0.18);
  }

  /** Start the ambient drone (call after the first user gesture). */
  startMusic(): void {
    const c = this.ac();
    if (this.drone) return;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380;
    filter.Q.value = 3;
    const gain = c.createGain();
    gain.gain.value = 0.0001;
    gain.gain.linearRampToValueAtTime(0.18, c.currentTime + 3);
    const oscs: OscillatorNode[] = [];
    for (const [f, type] of [
      [55, "sawtooth"],
      [55.4, "sawtooth"],
      [82.4, "triangle"],
      [110.3, "sine"],
    ] as [number, OscillatorType][]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      oscs.push(o);
    }
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = c.createGain();
    lg.gain.value = 180;
    lfo.connect(lg).connect(filter.frequency);
    lfo.start();
    filter.connect(gain).connect(this.music!);
    this.drone = { oscs, filter, gain, lfo };

    const pg = c.createGain();
    pg.gain.value = 0;
    pg.connect(this.music!);
    this.pulse = { gain: pg };
  }

  /** 0 = calm, 1 = horde / boss. Drives the pulse layer. */
  setIntensity(v: number): void {
    this.intensity = v;
    if (this.drone && this.ctx) {
      this.drone.filter.frequency.setTargetAtTime(380 + v * 500, this.ctx.currentTime, 0.8);
    }
  }

  /** Called every frame for the rhythmic pulse layer. */
  tick(dt: number): void {
    if (!this.ctx || !this.pulse || this.intensity < 0.15) return;
    this.beatT -= dt;
    if (this.beatT > 0) return;
    const bpm = 90 + this.intensity * 50;
    this.beatT = 60 / bpm;
    const c = this.ctx;
    const t0 = c.currentTime;
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(70, t0);
    o.frequency.exponentialRampToValueAtTime(40, t0 + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.25 * this.intensity, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    o.connect(g).connect(this.music!);
    o.start(t0);
    o.stop(t0 + 0.25);
  }
}
