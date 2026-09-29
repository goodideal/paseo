export type PetMood = "idle" | "running" | "waiting" | "urgent" | "auto_decided" | "level_up";

export class AnimationEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mood: PetMood = "idle";
  private frame = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  public setMood(mood: PetMood) {
    this.mood = mood;
  }

  public render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const bounce = Math.sin(this.frame * 0.2) * 4;

    ctx.save();
    ctx.translate(cx, cy + bounce);

    // Draw retro pixel body
    ctx.fillStyle = this.mood === "urgent" ? "#EF4444" : "#F59E0B";
    ctx.fillRect(-20, -20, 40, 40);

    // Eyes
    ctx.fillStyle = "#111";
    if (this.mood === "idle") {
      // Sleeping lines
      ctx.fillRect(-12, -4, 8, 2);
      ctx.fillRect(4, -4, 8, 2);
    } else {
      // Normal pixel eyes
      ctx.fillRect(-12, -6, 6, 6);
      ctx.fillRect(6, -6, 6, 6);
    }

    // Mood accessories
    if (this.mood === "waiting" || this.mood === "urgent") {
      ctx.fillStyle = "#DC2626";
      ctx.fillRect(-4, -36, 8, 12);
      ctx.fillRect(-4, -20, 8, 4);
    } else if (this.mood === "running") {
      ctx.fillStyle = "#3B82F6";
      ctx.fillRect(-16, 22, 32, 4); // Mini keyboard
    }

    ctx.restore();
    this.frame++;
  }
}
