export class SoundSynthesizer {
  private muted: boolean;
  private volume: number;
  private ctx: any = null;

  constructor(opts?: { muted?: boolean; volume?: number }) {
    this.muted = opts?.muted ?? false;
    this.volume = opts?.volume ?? 0.7;
  }

  private getAudioContext(): any {
    if (typeof window === "undefined") return null;
    if (!this.ctx && (window.AudioContext || (window as any).webkitAudioContext)) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  public playTone(
    freq: number,
    durationSec: number,
    type: "square" | "sine" | "triangle" = "square",
  ) {
    if (this.muted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(this.volume * 0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + durationSec);
    } catch {
      // Gracefully ignore audio failures (e.g. strict autoplay policy)
    }
  }

  public playDecisionRequired() {
    this.playTone(440, 0.15, "square");
    setTimeout(() => this.playTone(880, 0.2, "square"), 150);
  }

  public playUrgent() {
    this.playTone(1200, 0.1, "square");
  }

  public playApproved() {
    this.playTone(523.25, 0.15, "sine"); // C5
    setTimeout(() => this.playTone(659.25, 0.25, "sine"), 120); // E5
  }

  public playLevelUp() {
    const notes = [261.63, 329.63, 392.0, 523.25]; // C4, E4, G4, C5
    notes.forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 0.18, "triangle"), idx * 100);
    });
  }
}
