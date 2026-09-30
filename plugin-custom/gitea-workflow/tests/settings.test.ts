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

  it("supports host and project-level agent provider and model overrides", async () => {
    const mockPluginSettings = {
      read: vi.fn().mockResolvedValue({
        status: "ready",
        values: {
          enabled: true,
          pollIntervalSeconds: 60,
          maxConcurrentRuns: 3,
          maxAutomaticRepairCycles: 2,
          automationProfile: "claude-code",
          agentProvider: "claude",
          agentModel: "claude-3-7-sonnet",
          workflowPolicy: "full_superpowers",
          projects: {
            "proj-default": { enabled: true, readyLabel: "agent-ready" },
            "proj-custom": {
              enabled: true,
              readyLabel: "agent-ready",
              agentProviderOverride: "codex",
              agentModelOverride: "gemini-flash",
            },
          },
          inProgressLabel: "agent-in-progress",
          reviewedLabel: "agent-reviewed",
          evidenceRetentionDays: 90,
        },
        revision: "rev-1",
      }),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };

    const manager = new SettingsManager(mockPluginSettings as any);
    await manager.initialize();

    // Default project inherits host-level provider and model
    expect(manager.getAgentProvider("proj-default")).toBe("claude");
    expect(manager.getAgentModel("proj-default")).toBe("claude-3-7-sonnet");

    // Project with overrides uses project-level provider and model
    expect(manager.getAgentProvider("proj-custom")).toBe("codex");
    expect(manager.getAgentModel("proj-custom")).toBe("gemini-flash");
  });

  it("supports host and project-level agent permission scope overrides", async () => {
    const mockPluginSettings = {
      read: vi.fn().mockResolvedValue({
        status: "ready",
        values: {
          enabled: true,
          agentPermissionScope: "workspace_controlled",
          projects: {
            "proj-default": { enabled: true },
            "proj-readonly": {
              enabled: true,
              agentPermissionScopeOverride: "read_only",
            },
            "proj-full": {
              enabled: true,
              agentPermissionScopeOverride: "full_delivery",
            },
          },
        },
        revision: "rev-1",
      }),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };

    const manager = new SettingsManager(mockPluginSettings as any);
    await manager.initialize();

    expect(manager.getAgentPermissionScope()).toBe("workspace_controlled");
    expect(manager.getAgentPermissionScope("proj-default")).toBe("workspace_controlled");
    expect(manager.getAgentPermissionScope("proj-readonly")).toBe("read_only");
    expect(manager.getAgentPermissionScope("proj-full")).toBe("full_delivery");
  });
});
