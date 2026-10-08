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

  it("supports host and project-level agent change mode overrides (e.g. Codex full-access)", async () => {
    const mockPluginSettings = {
      read: vi.fn().mockResolvedValue({
        status: "ready",
        values: {
          enabled: true,
          agentProvider: "codex",
          agentChangeMode: "auto",
          projects: {
            "proj-default": { enabled: true },
            "proj-full-access": {
              enabled: true,
              agentChangeModeOverride: "full-access",
            },
          },
        },
        revision: "rev-1",
      }),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };

    const manager = new SettingsManager(mockPluginSettings as any);
    await manager.initialize();

    expect(manager.getAgentChangeMode()).toBe("auto");
    expect(manager.getAgentChangeMode("proj-default")).toBe("auto");
    expect(manager.getAgentChangeMode("proj-full-access")).toBe("full-access");
  });

  it("resolves auto and plan prompts with cascading precedence and fallback", async () => {
    const mockPluginSettings = {
      read: vi.fn().mockResolvedValue({
        status: "ready",
        values: {
          enabled: true,
          agentAutoPrompt: "Host Auto Prompt {{issueNumber}}",
          agentPlanPrompt: "Host Plan Prompt {{issueNumber}}",
          projects: {
            "proj-inherited": { enabled: true },
            "proj-overridden": {
              enabled: true,
              agentAutoPromptOverride: "Project Auto Prompt {{issueTitle}}",
              agentPlanPromptOverride: "Project Plan Prompt {{issueTitle}}",
            },
            "proj-whitespace": {
              enabled: true,
              agentAutoPromptOverride: "   ",
              agentPlanPromptOverride: "",
            },
          },
        },
        revision: "rev-1",
      }),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };

    const manager = new SettingsManager(mockPluginSettings as any);
    await manager.initialize();

    // 1. Project override takes precedence
    expect(manager.getAgentAutoPrompt("proj-overridden")).toBe(
      "Project Auto Prompt {{issueTitle}}",
    );
    expect(manager.getAgentPlanPrompt("proj-overridden")).toBe(
      "Project Plan Prompt {{issueTitle}}",
    );

    // 2. Inherits host configuration when project override is absent or empty
    expect(manager.getAgentAutoPrompt("proj-inherited")).toBe("Host Auto Prompt {{issueNumber}}");
    expect(manager.getAgentPlanPrompt("proj-inherited")).toBe("Host Plan Prompt {{issueNumber}}");
    expect(manager.getAgentAutoPrompt("proj-whitespace")).toBe("Host Auto Prompt {{issueNumber}}");
    expect(manager.getAgentPlanPrompt("proj-whitespace")).toBe("Host Plan Prompt {{issueNumber}}");

    // 3. Falls back to built-in default when host setting is empty
    const emptyHostSettings = {
      read: vi.fn().mockResolvedValue({
        status: "ready",
        values: {
          enabled: true,
          projects: {},
        },
        revision: "rev-1",
      }),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
    const emptyManager = new SettingsManager(emptyHostSettings as any);
    await emptyManager.initialize();

    expect(emptyManager.getAgentAutoPrompt()).toContain(
      "## Workflow Instructions (agent-auto Mode):",
    );
    expect(emptyManager.getAgentPlanPrompt()).toContain(
      "## Workflow Instructions (agent-plan Mode):",
    );
  });
});
