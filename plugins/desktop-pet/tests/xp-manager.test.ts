import { describe, it, expect } from "vitest";
import { XpManager } from "../server/xp-manager.js";

describe("XpManager", () => {
  it("computes levels correctly based on XP curve", () => {
    const xpManager = new XpManager(0);
    expect(xpManager.getLevel()).toBe(1);

    const r1 = xpManager.addXp(200);
    expect(r1.newLevel).toBe(2);
    expect(r1.leveledUp).toBe(true);

    const r2 = xpManager.addXp(400); // total 600
    expect(r2.newLevel).toBe(3);
    expect(r2.leveledUp).toBe(true);
  });

  it("awards correct standard XP amounts", () => {
    const xpManager = new XpManager();
    const taskAward = xpManager.awardTaskCompletion();
    expect(taskAward.newXp).toBe(50);

    const manualAward = xpManager.awardManualPrompt();
    expect(manualAward.newXp).toBe(65); // 50 + 15

    const autoAward = xpManager.awardAutoDecision();
    expect(autoAward.newXp).toBe(70); // 65 + 5
  });
});
