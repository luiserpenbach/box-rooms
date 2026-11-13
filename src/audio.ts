export class AudioFx {
  private ctx: AudioContext | null = null;
  muted = false;

  private ac(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain = 0.08,
    slide = 0,
  ): void {
    if (this.muted) return;
    const c = this.ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), c.currentTime + dur);
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur);
  }

  private noise(dur: number, gain = 0.12, freq = 800): void {
    if (this.muted) return;
    const c = this.ac();
    const n = c.createBuffer(1, (c.sampleRate * dur) | 0, c.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = n;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  }

  shoot(heavy = false): void {
    this.noise(heavy ? 0.08 : 0.04, heavy ? 0.14 : 0.07, heavy ? 400 : 1800);
    this.tone(heavy ? 140 : 420, 0.05, "square", 0.04, -200);
  }

  explode(): void {
    this.noise(0.35, 0.22, 300);
    this.tone(90, 0.3, "sawtooth", 0.1, -50);
  }

  hit(): void {
    this.tone(180, 0.08, "square", 0.06, -80);
  }

  pickup(): void {
    this.tone(520, 0.08, "square", 0.06, 200);
    this.tone(780, 0.12, "square", 0.05, 120);
  }

  wave(): void {
    this.tone(220, 0.2, "sawtooth", 0.07, 80);
    this.tone(330, 0.25, "square", 0.05, 40);
  }

  unlock(): void {
    this.tone(400, 0.1, "square", 0.06, 0);
    this.tone(600, 0.14, "square", 0.06, 0);
    this.tone(800, 0.18, "square", 0.05, 0);
  }

  death(): void {
    this.tone(300, 0.4, "sawtooth", 0.08, -250);
  }

  fireball(): void {
    this.noise(0.12, 0.1, 600);
    this.tone(160, 0.12, "sawtooth", 0.05, -40);
  }
}
