import { type Vec, norm } from "./math";

export type Controls = {
  mx: number;
  my: number;
  /** Explicit aim direction (mouse / right stick); null = shoot where you walk. */
  aim: Vec | null;
  fire: boolean;
  shove: boolean;
  next: boolean;
  prev: boolean;
  select: number;
};

const PREVENT = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Tab"]);

type PadState = { buttons: boolean[]; prev: boolean[]; axes: number[] };

export class Input {
  /** Normalised key names (lowercase letters, "Space", "ArrowUp", ...) and KeyboardEvent.code values. */
  readonly down = new Set<string>();
  readonly pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  mouseRight = false;
  mouseRightPressed = false;
  wheel = 0;
  mouseMovedAt = 0;
  /** Set by main each frame from the camera transform. */
  mouseWorld: Vec = { x: 0, y: 0 };
  pads: PadState[] = [];
  lastDevice: "keyboard" | "pad" | "touch" = "keyboard";

  // Touch
  touchEnabled = false;
  private stickId: number | null = null;
  private stickOrigin: Vec = { x: 0, y: 0 };
  private stick: Vec = { x: 0, y: 0 };
  touchFire = false;
  private touchPressed = new Set<string>();
  private stickEl: HTMLElement | null = null;
  private knobEl: HTMLElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
      if (PREVENT.has(e.key)) e.preventDefault();
      this.lastDevice = "keyboard";
      for (const k of this.names(e)) {
        if (!this.down.has(k)) this.pressed.add(k);
        this.down.add(k);
      }
    });
    window.addEventListener("keyup", (e) => {
      for (const k of this.names(e)) this.down.delete(k);
    });
    window.addEventListener("blur", () => {
      this.down.clear();
      this.mouseDown = false;
      this.mouseRight = false;
      this.touchFire = false;
      this.stickId = null;
      this.stick = { x: 0, y: 0 };
    });
    canvas.addEventListener("mousemove", (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseMovedAt = performance.now();
    });
    canvas.addEventListener("mousedown", (e) => {
      this.lastDevice = "keyboard";
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) {
        this.mouseRight = true;
        this.mouseRightPressed = true;
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.mouseRight = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
  }

  private names(e: KeyboardEvent): string[] {
    const out = [e.code];
    if (e.code.startsWith("Numpad")) return out;
    if (e.key === " ") out.push("Space");
    else out.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    return out;
  }

  held(k: string): boolean {
    return this.down.has(k);
  }

  just(k: string): boolean {
    return this.pressed.has(k);
  }

  axis(neg: string, pos: string): number {
    return (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0);
  }

  pollPads(): void {
    const raw = navigator.getGamepads ? navigator.getGamepads() : [];
    const next: PadState[] = [];
    for (const gp of raw) {
      if (!gp || !gp.connected) continue;
      const prev = this.pads[next.length]?.buttons ?? [];
      const buttons = gp.buttons.map((b) => b.pressed || b.value > 0.35);
      if (buttons.some((b) => b) || gp.axes.some((a) => Math.abs(a) > 0.4)) this.lastDevice = "pad";
      next.push({ buttons, prev, axes: [...gp.axes] });
    }
    this.pads = next;
  }

  private padJust(p: PadState, b: number): boolean {
    return !!p.buttons[b] && !p.prev[b];
  }

  pausePressed(): boolean {
    if (this.just("Escape") || this.just("p")) return true;
    if (this.touchPressed.has("pause")) return true;
    return this.pads.some((p) => this.padJust(p, 9));
  }

  /** Which pad drives which player. */
  private padFor(player: number, coop: boolean): PadState | null {
    if (!coop) return player === 0 ? (this.pads[0] ?? null) : null;
    if (this.pads.length >= 2) return this.pads[player] ?? null;
    return player === 1 ? (this.pads[0] ?? null) : null;
  }

  controls(player: number, coop: boolean, mouseAim: boolean, playerPos: Vec): Controls {
    const c: Controls = { mx: 0, my: 0, aim: null, fire: false, shove: false, next: false, prev: false, select: 0 };
    if (player === 0) {
      c.mx = this.axis("KeyA", "KeyD");
      c.my = this.axis("KeyW", "KeyS");
      if (!coop) {
        c.mx = c.mx || this.axis("ArrowLeft", "ArrowRight");
        c.my = c.my || this.axis("ArrowUp", "ArrowDown");
      }
      c.fire = this.held("Space");
      c.shove = this.just("KeyF") || this.just("ShiftLeft");
      c.prev = this.just("KeyQ");
      c.next = this.just("KeyE");
      for (let n = 1; n <= 9; n++) if (this.just(`Digit${n}`)) c.select = n;
      if (mouseAim) {
        const d = norm(this.mouseWorld.x - playerPos.x, this.mouseWorld.y - playerPos.y);
        if (d.x || d.y) c.aim = d;
        c.fire = c.fire || this.mouseDown;
        c.shove = c.shove || this.mouseRightPressed;
        if (this.wheel > 0) c.next = true;
        if (this.wheel < 0) c.prev = true;
      }
      if (this.touchEnabled) {
        if (Math.abs(this.stick.x) > 0.25 || Math.abs(this.stick.y) > 0.25) {
          c.mx = this.stick.x;
          c.my = this.stick.y;
        }
        c.fire = c.fire || this.touchFire;
        c.shove = c.shove || this.touchPressed.has("shove");
        c.next = c.next || this.touchPressed.has("swap");
      }
    } else {
      c.mx = this.axis("ArrowLeft", "ArrowRight");
      c.my = this.axis("ArrowUp", "ArrowDown");
      c.fire = this.held("Enter") || this.held("ControlRight") || this.held("NumpadEnter") || this.held("Numpad0");
      c.shove = this.just("Slash") || this.just("ShiftRight");
      c.prev = this.just("Comma") || this.just("NumpadSubtract");
      c.next = this.just("Period") || this.just("NumpadAdd");
      for (let n = 1; n <= 9; n++) if (this.just(`Numpad${n}`)) c.select = n;
    }

    const pad = this.padFor(player, coop);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > 0.35) {
        c.mx = ax;
        c.my = ay;
      }
      if (pad.buttons[14]) c.mx = -1;
      if (pad.buttons[15]) c.mx = 1;
      if (pad.buttons[12]) c.my = -1;
      if (pad.buttons[13]) c.my = 1;
      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      if (Math.hypot(rx, ry) > 0.45) {
        c.aim = norm(rx, ry);
      }
      c.fire = c.fire || !!pad.buttons[7] || !!pad.buttons[0] || (c.aim !== null && Math.hypot(rx, ry) > 0.85);
      c.shove = c.shove || this.padJust(pad, 2) || this.padJust(pad, 1) || this.padJust(pad, 6);
      c.prev = c.prev || this.padJust(pad, 4);
      c.next = c.next || this.padJust(pad, 5) || this.padJust(pad, 3);
    }
    return c;
  }

  endFrame(): void {
    this.pressed.clear();
    this.touchPressed.clear();
    this.mouseRightPressed = false;
    this.wheel = 0;
  }

  /** Build the on-screen touch controls. */
  enableTouch(root: HTMLElement): void {
    if (this.touchEnabled) return;
    this.touchEnabled = true;
    root.classList.remove("hidden");
    this.stickEl = root.querySelector<HTMLElement>(".stick");
    this.knobEl = root.querySelector<HTMLElement>(".knob");
    const zone = root.querySelector<HTMLElement>(".stick-zone")!;
    zone.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        this.lastDevice = "touch";
        const t = e.changedTouches[0];
        this.stickId = t.identifier;
        this.stickOrigin = { x: t.clientX, y: t.clientY };
        this.stick = { x: 0, y: 0 };
        if (this.stickEl) {
          this.stickEl.style.left = `${t.clientX}px`;
          this.stickEl.style.top = `${t.clientY}px`;
          this.stickEl.classList.add("on");
        }
      },
      { passive: false },
    );
    const move = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.stickId) continue;
        e.preventDefault();
        const dx = t.clientX - this.stickOrigin.x;
        const dy = t.clientY - this.stickOrigin.y;
        const max = 48;
        const l = Math.hypot(dx, dy);
        const k = l > max ? max / l : 1;
        this.stick = { x: (dx * k) / max, y: (dy * k) / max };
        if (this.knobEl) this.knobEl.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      }
    };
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.stickId) continue;
        this.stickId = null;
        this.stick = { x: 0, y: 0 };
        if (this.knobEl) this.knobEl.style.transform = "";
        this.stickEl?.classList.remove("on");
      }
    };
    zone.addEventListener("touchmove", move, { passive: false });
    zone.addEventListener("touchend", end);
    zone.addEventListener("touchcancel", end);

    for (const btn of Array.from(root.querySelectorAll<HTMLElement>("[data-touch]"))) {
      const name = btn.dataset.touch!;
      btn.addEventListener(
        "touchstart",
        (e) => {
          e.preventDefault();
          this.lastDevice = "touch";
          btn.classList.add("on");
          if (name === "fire") this.touchFire = true;
          else this.touchPressed.add(name);
        },
        { passive: false },
      );
      const up = (e: TouchEvent) => {
        e.preventDefault();
        btn.classList.remove("on");
        if (name === "fire") this.touchFire = false;
      };
      btn.addEventListener("touchend", up, { passive: false });
      btn.addEventListener("touchcancel", up, { passive: false });
    }
  }
}
