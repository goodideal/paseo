import { describe, it, expect, vi } from "vitest";
import {
  BUILTIN_PROVIDER_TIERS,
  ensureProviderModelSelection,
  fetchEffectiveHarnessConfig,
  normalizeWorkflowProvider,
  resolveWorkflowAgentLaunch,
} from "../server/harness-bridge.js";

describe("Harness Bridge", () => {
  describe("normalizeWorkflowProvider & ensureProviderModelSelection", () => {
    it("normalizes supported workflow providers with claude default", () => {
      expect(normalizeWorkflowProvider("codex")).toBe("codex");
      expect(normalizeWorkflowProvider("opencode")).toBe("opencode");
      expect(normalizeWorkflowProvider("antigravity")).toBe("antigravity");
      expect(normalizeWorkflowProvider("pi")).toBe("pi");
      expect(normalizeWorkflowProvider("claude")).toBe("claude");
      expect(normalizeWorkflowProvider("claude-code")).toBe("claude");
      expect(normalizeWorkflowProvider("")).toBe("claude");
      expect(normalizeWorkflowProvider(undefined)).toBe("claude");
    });

    it("always ensures provider/model format without gemini-flash[1M] fallback", () => {
      expect(ensureProviderModelSelection("codex")).toBe("codex/flash");
      expect(ensureProviderModelSelection("claude", "deep")).toBe("claude/pro");
      expect(ensureProviderModelSelection("antigravity", "standard")).toBe(
        "antigravity/gemini-4-argon",
      );
      expect(ensureProviderModelSelection("opencode", "fast")).toBe("opencode/custom/lite");
      expect(ensureProviderModelSelection("pi", "max")).toBe("pi/headroom/plan");
      expect(ensureProviderModelSelection("codex/gpt-5.4")).toBe("codex/gpt-5.4");
      expect(ensureProviderModelSelection("codex/flash", "standard", "codex/gpt-5.4")).toBe(
        "codex/gpt-5.4",
      );
      expect(ensureProviderModelSelection("claude/")).toBe("claude/flash");
      expect(ensureProviderModelSelection("codex/flash", "standard", "codex/")).toBe("codex/flash");
      expect(ensureProviderModelSelection("codex")).not.toContain("gemini-flash[1M]");
    });

    it("matches agent-harness 4-tier builtin model and thinking matrix", () => {
      expect(BUILTIN_PROVIDER_TIERS.claude).toEqual({
        fast: { model: "lite", thinkingOptionId: "low" },
        standard: { model: "flash", thinkingOptionId: "medium" },
        deep: { model: "pro", thinkingOptionId: "high" },
        max: { model: "plan", thinkingOptionId: "high" },
      });
      expect(BUILTIN_PROVIDER_TIERS.codex).toEqual({
        fast: { model: "lite", thinkingOptionId: "low" },
        standard: { model: "flash", thinkingOptionId: "medium" },
        deep: { model: "pro", thinkingOptionId: "high" },
        max: { model: "plan", thinkingOptionId: "xhigh" },
      });
      expect(BUILTIN_PROVIDER_TIERS.antigravity).toEqual({
        fast: { model: "gemini-4-hydrogen", thinkingOptionId: "medium" },
        standard: { model: "gemini-4-argon", thinkingOptionId: "high" },
        deep: { model: "gemini-4-carbon", thinkingOptionId: "high" },
        max: { model: "gemini-4-neon", thinkingOptionId: "xhigh" },
      });
      expect(BUILTIN_PROVIDER_TIERS.opencode).toEqual({
        fast: { model: "custom/lite", thinkingOptionId: "low" },
        standard: { model: "custom/flash", thinkingOptionId: "medium" },
        deep: { model: "custom/pro", thinkingOptionId: "high" },
        max: { model: "custom/plan", thinkingOptionId: "xhigh" },
      });
      expect(BUILTIN_PROVIDER_TIERS.pi).toEqual({
        fast: { model: "headroom/lite", thinkingOptionId: "low" },
        standard: { model: "headroom/flash", thinkingOptionId: "medium" },
        deep: { model: "headroom/pro", thinkingOptionId: "high" },
        max: { model: "headroom/plan", thinkingOptionId: "xhigh" },
      });
    });
  });

  describe("fetchEffectiveHarnessConfig", () => {
    it("returns null when paseo.plugins.invoke is missing or throws or config.enabled is false", async () => {
      expect(await fetchEffectiveHarnessConfig(null)).toBeNull();
      expect(await fetchEffectiveHarnessConfig({})).toBeNull();

      const failingPaseo = {
        plugins: {
          invoke: vi.fn().mockRejectedValue(new Error("plugin not loaded")),
        },
      };
      expect(await fetchEffectiveHarnessConfig(failingPaseo)).toBeNull();

      const disabledPaseo = {
        plugins: {
          invoke: vi.fn().mockResolvedValue({ config: { enabled: false } }),
        },
      };
      expect(await fetchEffectiveHarnessConfig(disabledPaseo)).toBeNull();
    });

    it("invokes agent-harness effective config RPC and returns config when enabled", async () => {
      const mockConfig = {
        enabled: true,
        defaultFallbackRole: "general",
        specialists: {
          backend: { preferredTier: "standard", preferredProvider: "codex" },
        },
      };
      const paseo = {
        plugins: {
          invoke: vi.fn().mockResolvedValue({ config: mockConfig }),
        },
      };

      const res = await fetchEffectiveHarnessConfig(paseo, {
        workspaceId: "ws-1",
        cwd: "/repo",
      });

      expect(paseo.plugins.invoke).toHaveBeenCalledWith(
        "agent-harness",
        "agent_harness.config.effective.request",
        { workspaceId: "ws-1", cwd: "/repo" },
      );
      expect(res).toEqual(mockConfig);
    });
  });

  describe("resolveWorkflowAgentLaunch", () => {
    it("bypasses agent-harness with metadata and static provider when harnessMode is disabled", async () => {
      const mockSettings = {
        getHarnessMode: vi.fn().mockReturnValue("disabled"),
        getAgentProvider: vi.fn().mockReturnValue("codex"),
        getAgentModel: vi.fn().mockReturnValue(""),
        getReviewProviderOverride: vi.fn().mockReturnValue("antigravity"),
      };

      const execLaunch = await resolveWorkflowAgentLaunch({
        settingsManager: mockSettings,
        projectId: "proj-1",
        runId: "run-disabled-1",
        phase: "implement",
        issueTitle: "Fix websocket reconnection",
      });

      expect(execLaunch.provider).toBe("codex");
      expect(execLaunch.model).toBe("flash");
      expect(execLaunch.providerSelection).toBe("codex/flash");
      expect(execLaunch.metadata).toEqual({ agentHarnessBypassed: true });
      expect(execLaunch.labels).toEqual({
        "paseo.workflow": "gitea-workflow",
        "paseo.workflow.phase": "exec",
        "paseo.workflow.unattended": "1",
        "paseo.workflow.run-id": "run-disabled-1",
      });
      expect(execLaunch.harnessInfo.enabled).toBe(false);
      expect(execLaunch.harnessInfo.mode).toBe("disabled");

      const reviewLaunch = await resolveWorkflowAgentLaunch({
        settingsManager: mockSettings,
        projectId: "proj-1",
        phase: "review",
      });
      expect(reviewLaunch.provider).toBe("antigravity");
      expect(reviewLaunch.providerSelection).toBe("antigravity/gemini-4-carbon");
    });

    it("maps workflow phases to design/exec/review roles and tiers in auto mode", async () => {
      const effectiveConfig = {
        enabled: true,
        defaultFallbackRole: "general",
        honorSpecialistPreferredProvider: true,
        agentTeamPreset: "fe-be-team",
        specialists: {
          pm: {
            preferredTier: "deep",
            preferredProvider: "antigravity",
            lazyToolSlice: "/Users/jerry/.config/lazy-tool/profiles/pm.yaml",
          },
          "fe-architect": {
            preferredTier: "deep",
            preferredProvider: "antigravity",
            matchPatterns: ["ui|组件|modal"],
          },
          "be-architect": {
            preferredTier: "deep",
            preferredProvider: "claude",
            matchPatterns: ["database|rpc|schema"],
          },
          "fe-developer": {
            preferredTier: "standard",
            preferredProvider: "antigravity",
            lazyToolSlice: "/Users/jerry/.config/lazy-tool/profiles/ui.yaml",
            matchPatterns: ["ui|组件|modal"],
          },
          "be-developer": {
            preferredTier: "standard",
            preferredProvider: "codex",
            lazyToolSlice: "/Users/jerry/.config/lazy-tool/profiles/backend.yaml",
            matchPatterns: ["database|rpc|schema"],
          },
          review: {
            preferredTier: "deep",
            preferredProvider: "antigravity",
          },
        },
      };

      const mockSettings = {
        getHarnessMode: vi.fn().mockReturnValue("auto"),
        getAgentProvider: vi.fn().mockReturnValue("claude"),
        getAgentModel: vi.fn().mockReturnValue(""),
        getHasExplicitProviderOverride: vi.fn().mockReturnValue(false),
      };

      // 1. brainstorm -> design / pm / deep
      const brainstormRes = await resolveWorkflowAgentLaunch({
        settingsManager: mockSettings,
        phase: "brainstorm",
        issueTitle: "Add modal dialog",
        effectiveConfig,
      });
      expect(brainstormRes.harnessInfo).toMatchObject({
        enabled: true,
        mode: "auto",
        phase: "design",
        role: "pm",
        tier: "deep",
        provider: "antigravity",
        model: "gemini-4-carbon",
        thinkingOptionId: "high",
        lazyToolSlice: "/Users/jerry/.config/lazy-tool/profiles/pm.yaml",
        agentTeamPreset: "fe-be-team",
      });

      // 2. spec with FE issue -> design / fe-architect / deep
      const specRes = await resolveWorkflowAgentLaunch({
        settingsManager: mockSettings,
        phase: "spec",
        issueTitle: "Redesign modal 组件 layout",
        effectiveConfig,
      });
      expect(specRes.harnessInfo).toMatchObject({
        phase: "design",
        role: "fe-architect",
        tier: "deep",
        provider: "antigravity",
        model: "gemini-4-carbon",
      });

      // 3. plan with BE issue -> design / be-architect / deep
      const planRes = await resolveWorkflowAgentLaunch({
        settingsManager: mockSettings,
        phase: "plan",
        issueTitle: "Migrate database rpc schema",
        effectiveConfig,
      });
      expect(planRes.harnessInfo).toMatchObject({
        phase: "design",
        role: "be-architect",
        tier: "deep",
        provider: "claude",
        model: "pro",
      });

      // 4. implement with BE issue -> exec / be-developer / standard
      const implRes = await resolveWorkflowAgentLaunch({
        settingsManager: mockSettings,
        phase: "implement",
        issueTitle: "Implement rpc endpoint for database",
        effectiveConfig,
      });
      expect(implRes.harnessInfo).toMatchObject({
        phase: "exec",
        role: "be-developer",
        tier: "standard",
        provider: "codex",
        model: "flash",
        thinkingOptionId: "medium",
        lazyToolSlice: "/Users/jerry/.config/lazy-tool/profiles/backend.yaml",
      });

      // 5. chore/docs/style title in implement -> fast tier
      const choreRes = await resolveWorkflowAgentLaunch({
        settingsManager: mockSettings,
        phase: "implement",
        issueTitle: "chore: cleanup unused rpc imports",
        effectiveConfig,
      });
      expect(choreRes.harnessInfo.tier).toBe("fast");
      expect(choreRes.labels["paseo.workflow.tier"]).toBe("fast");
      expect(choreRes.providerSelection).toBe("codex/lite");
    });

    it("isolates configuredModel across different providers, guards empty trailing slash, and skips readonly specialists in exec phase", async () => {
      const effectiveConfig = {
        enabled: true,
        honorSpecialistPreferredProvider: true,
        specialists: {
          "fe-qa": {
            readonly: true,
            preferredTier: "standard",
            preferredProvider: "antigravity",
            matchPatterns: ["ui|button|modal"],
          },
          ui: {
            preferredTier: "standard",
            preferredProvider: "claude",
            matchPatterns: ["ui|button|modal"],
          },
        },
      };

      // Global settings has codex + gpt-5.4, but UI specialist prefers claude
      const mockSettings = {
        getHarnessMode: vi.fn().mockReturnValue("auto"),
        getAgentProvider: vi.fn().mockReturnValue("codex"),
        getAgentModel: vi.fn().mockReturnValue("gpt-5.4"),
        getHasExplicitProviderOverride: vi.fn().mockReturnValue(false),
      };

      const uiLaunch = await resolveWorkflowAgentLaunch({
        settingsManager: mockSettings,
        phase: "implement",
        issueTitle: "Fix button ui hover style",
        effectiveConfig,
      });

      // Skips readonly fe-qa and picks ui
      expect(uiLaunch.harnessInfo.role).toBe("ui");
      // Uses claude/flash instead of claude/gpt-5.4
      expect(uiLaunch.provider).toBe("claude");
      expect(uiLaunch.model).toBe("flash");
      expect(uiLaunch.providerSelection).toBe("claude/flash");
      expect(uiLaunch.labels["paseo.workflow.tier"]).toBe("standard");

      // Empty trailing slash in configuredModel ("claude/") falls back to mapped model
      const slashSettings = {
        getHarnessMode: vi.fn().mockReturnValue("disabled"),
        getAgentProvider: vi.fn().mockReturnValue("claude"),
        getAgentModel: vi.fn().mockReturnValue("claude/"),
      };
      const disabledSlash = await resolveWorkflowAgentLaunch({
        settingsManager: slashSettings,
        phase: "implement",
        issueTitle: "Fix bug",
      });
      expect(disabledSlash.providerSelection).toBe("claude/flash");
    });

    it("enforces heterogeneous independent review provider in auto mode even when project overrides agentProvider to codex", async () => {
      const effectiveConfig = {
        enabled: true,
        specialists: {
          backend: { preferredTier: "standard", preferredProvider: "codex" },
          review: { preferredTier: "deep", preferredProvider: "antigravity" },
        },
      };
      const mockSettings = {
        getHarnessMode: vi.fn().mockReturnValue("auto"),
        getAgentProvider: vi.fn().mockReturnValue("codex"),
        getAgentModel: vi.fn().mockReturnValue("gpt-5.4"),
        getHasExplicitProviderOverride: vi.fn().mockReturnValue(true),
        getReviewProviderOverride: vi.fn().mockReturnValue(undefined),
      };

      // Coding stage respects explicit project override (codex/gpt-5.4)
      const codingRes = await resolveWorkflowAgentLaunch({
        settingsManager: mockSettings,
        projectId: "proj-codex",
        phase: "implement",
        issueTitle: "Optimize API query",
        effectiveConfig,
      });
      expect(codingRes.provider).toBe("codex");
      expect(codingRes.model).toBe("gpt-5.4");

      // Review stage enforces cross-provider antigravity review
      const reviewRes = await resolveWorkflowAgentLaunch({
        settingsManager: mockSettings,
        projectId: "proj-codex",
        phase: "review",
        issueTitle: "Optimize API query",
        effectiveConfig,
      });
      expect(reviewRes.provider).toBe("antigravity");
      expect(reviewRes.model).toBe("gemini-4-carbon");
      expect(reviewRes.providerSelection).toBe("antigravity/gemini-4-carbon");
      expect(reviewRes.labels.role).toBe("review");
      expect(reviewRes.labels["paseo.harness-leaf"]).toBe("1");
    });

    it("locks provider in provider_locked mode while keeping role and tier routing", async () => {
      const effectiveConfig = {
        enabled: true,
        specialists: {
          ui: {
            preferredTier: "standard",
            preferredProvider: "antigravity",
            matchPatterns: ["ui|button"],
          },
          review: {
            preferredTier: "deep",
            preferredProvider: "antigravity",
          },
        },
      };
      const mockSettings = {
        getHarnessMode: vi.fn().mockReturnValue("provider_locked"),
        getAgentProvider: vi.fn().mockReturnValue("codex"),
        getAgentModel: vi.fn().mockReturnValue(""),
        getReviewProviderOverride: vi.fn().mockReturnValue(undefined),
      };

      const uiLaunch = await resolveWorkflowAgentLaunch({
        settingsManager: mockSettings,
        phase: "implement",
        issueTitle: "Fix button ui alignment",
        effectiveConfig,
      });
      expect(uiLaunch.harnessInfo.role).toBe("ui");
      expect(uiLaunch.provider).toBe("codex");
      expect(uiLaunch.providerSelection).toBe("codex/flash");

      const reviewLaunch = await resolveWorkflowAgentLaunch({
        settingsManager: mockSettings,
        phase: "review",
        issueTitle: "Fix button ui alignment",
        effectiveConfig,
      });
      expect(reviewLaunch.harnessInfo.role).toBe("review");
      expect(reviewLaunch.provider).toBe("codex");
      expect(reviewLaunch.providerSelection).toBe("codex/pro");
    });
  });
});
