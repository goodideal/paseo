export class XpManager {
  private xp: number;

  constructor(initialXp = 0) {
    this.xp = Math.max(0, initialXp);
  }

  public getXp(): number {
    return this.xp;
  }

  public getLevel(): number {
    if (this.xp >= 3000) return 5;
    if (this.xp >= 1500) return 4;
    if (this.xp >= 600) return 3;
    if (this.xp >= 200) return 2;
    return 1;
  }

  public addXp(amount: number): { newXp: number; newLevel: number; leveledUp: boolean } {
    const prevLevel = this.getLevel();
    this.xp += Math.max(0, amount);
    const newLevel = this.getLevel();
    return {
      newXp: this.xp,
      newLevel,
      leveledUp: newLevel > prevLevel,
    };
  }

  public awardTaskCompletion() {
    return this.addXp(50);
  }

  public awardFocusTenMinutes() {
    return this.addXp(10);
  }

  public awardManualPrompt() {
    return this.addXp(15);
  }

  public awardAutoDecision() {
    return this.addXp(5);
  }
}
