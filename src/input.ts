export class Input {
  readonly down = new Set<string>();
  readonly pressed = new Set<string>();

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
        e.preventDefault();
      }
      const k = this.norm(e);
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
    });
    window.addEventListener("keyup", (e) => {
      this.down.delete(this.norm(e));
    });
    window.addEventListener("blur", () => {
      this.down.clear();
    });
  }

  private norm(e: KeyboardEvent): string {
    if (e.code.startsWith("Numpad")) return e.code;
    if (e.key === " ") return "Space";
    return e.key.length === 1 ? e.key.toLowerCase() : e.key;
  }

  held(k: string): boolean {
    return this.down.has(k);
  }

  just(k: string): boolean {
    return this.pressed.has(k);
  }

  endFrame(): void {
    this.pressed.clear();
  }

  axis(neg: string, pos: string): number {
    return (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0);
  }
}
