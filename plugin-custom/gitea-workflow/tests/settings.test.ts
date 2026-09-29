import { describe, it, expect, vi } from "vitest";
import { SettingsManager } from "../server/settings-manager.js";

describe("SettingsManager", () => {
  it("initializes with schema defaults and notifies on change", async () => {
    let subscriber: ((state: unknown) => void) | null = null;
    const mockPluginSettings = {
      read: vi.fn().mockResolvedValue({
        status: "ready",
        values: {
          enabled: false,
          pollIntervalSeconds: 60,
          maxConcurrentRuns: 3,
          maxAutomaticRepairCycles: 2,
          automationProfile: "claude-code",
          workflowPolicy: "full_superpowers",
          projects: {},
          inProgressLabel: "agent-in-progress",
          reviewedLabel: "agent-reviewed",
          evidenceRetentionDays: 90,
        },
        revision: "rev-1",
      }),
      subscribe: vi.fn().mockImplementation((cb) => {
        subscriber = cb;
        return () => {};
      }),
    };

    const manager = new SettingsManager(mockPluginSettings as any);
    await manager.initialize();

    expect(manager.current.enabled).toBe(false);
    expect(manager.isProjectAuthorized("proj-1")).toBe(false);

    // 模拟配置变更事件
    subscriber!({
      status: "ready",
      values: {
        enabled: true,
        pollIntervalSeconds: 30,
        maxConcurrentRuns: 5,
        maxAutomaticRepairCycles: 2,
        automationProfile: "claude-code",
        workflowPolicy: "full_superpowers",
        projects: { "proj-1": { enabled: true, readyLabel: "agent-ready" } },
        inProgressLabel: "agent-in-progress",
        reviewedLabel: "agent-reviewed",
        evidenceRetentionDays: 90,
      },
      revision: "rev-2",
    });

    expect(manager.current.enabled).toBe(true);
    expect(manager.current.pollIntervalSeconds).toBe(30);
    expect(manager.isProjectAuthorized("proj-1")).toBe(true);
    expect(manager.getReadyLabel("proj-1")).toBe("agent-ready");
  });
});
