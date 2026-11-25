import { describe, expect, it } from "vitest";
import {
  buildSystemPromptBanner,
  findSpecialist,
  inferTierFromModel,
  isFederatedLocalProvider,
  normalizePrimarySkills,
  normalizeTierAlias,
  resolveEffectiveHarnessConfig,
  resolveResumeExecutionMode,
  resolveSessionMcpServers,
  resolveSpecialistEnvironment,
  resolveTargetModelForTier,
  resolveTierTarget,
} from "../shared/config-resolver.js";
import {
  AgentHarnessSettingsSchema,
  DEFAULT_AGENT_HARNESS_SETTINGS,
  agentHarnessSettings,
} from "../shared/settings.js";
import type { RepoHarnessOverride } from "../shared/types.js";
import {
  areManifestsEqual,
  computeMissingRecommendedDeps,
  createManifestFromPreset,
  normalizeEditableManifest,
  toggleCapabilityWithAutoDeps,
  toggleGuardItem,
  toggleMcpWithAutoDeps,
  toggleRoleWithAutoDeps,
  toggleTargetItem,
  type AgentTeamCatalogData,
  type AgentTeamPresetData,
} from "../shared/team-editor-utils.js";

describe("Agent Harness Config Resolver & Settings v2", () => {
  it("DEFAULT_AGENT_HARNESS_SETTINGS has all 9 builtin specialists and 4 tiers", () => {
    expect(DEFAULT_AGENT_HARNESS_SETTINGS.specialists.length).toBe(9);
    expect(DEFAULT_AGENT_HARNESS_SETTINGS.tiers.length).toBe(4);
    expect(DEFAULT_AGENT_HARNESS_SETTINGS.tiers.map((t) => t.id)).toEqual([
      "fast",
      "standard",
      "deep",
      "max",
    ]);
    expect(DEFAULT_AGENT_HARNESS_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_AGENT_HARNESS_SETTINGS.profilesDir).toBe("~/.agents/profiles");
    expect(DEFAULT_AGENT_HARNESS_SETTINGS.autoSyncDiskProfiles).toBe(true);
  });

  it("migrates v1 settings cleanly to latest schema", () => {
    const v1Values = {
      enabled: true,
      overrideIfDefaultOnly: false,
      debugLogs: true,
      llmFallbackEnabled: true,
      llmFallbackEndpoint: "https://api.myllm.com/v1",
      llmFallbackApiKey: "sk-secret-123",
      llmFallbackModel: "lite-custom",
      llmFallbackTimeoutMs: 600,
      phaseLifecycleEnabled: true,
      planTurnSoftLimit: 5,
      autoDowngradePlanOnExec: true,
      enforceNativePlanMode: true,
      emitTimelineTransitions: true,
    };

    const migrate = agentHarnessSettings.migrate!;
    const migrated = migrate(v1Values, 1) as typeof DEFAULT_AGENT_HARNESS_SETTINGS;

    expect(migrated.overrideIfDefaultOnly).toBe(false);
    expect(migrated.debugLogs).toBe(true);
    expect(migrated.llmFallbackEndpoint).toBe("https://api.myllm.com/v1");
    expect(migrated.llmFallbackApiKey).toBe("sk-secret-123");
    expect(migrated.planTurnSoftLimit).toBe(5);
    // Schema defaults populated
    expect(migrated.specialists.length).toBe(9);
    expect(migrated.tiers.length).toBe(4);
    expect(migrated.autoSyncDiskProfiles).toBe(true);
  });

  it("merges repo-level overrides safely", () => {
    const repoOverride: RepoHarnessOverride = {
      defaultFallbackRole: "architect",
      extraDocsFocus: ["docs/special-project-guidelines.md"],
      extraQualityGates: ["strict-audit"],
      specialistOverrides: {
        backend: {
          modelOverride: "custom/fast-backend",
          docsFocus: ["docs/db-schema.md"],
        },
      },
    };

    const effective = resolveEffectiveHarnessConfig(
      DEFAULT_AGENT_HARNESS_SETTINGS,
      repoOverride,
      "/my/repo",
    );

    expect(effective.defaultFallbackRole).toBe("architect");
    expect(effective.repoOverrideLoaded).toBe(true);
    expect(effective.repoRoot).toBe("/my/repo");

    const backend = findSpecialist(effective, "backend");
    expect(backend).toBeDefined();
    expect(backend?.modelOverride).toBe("custom/fast-backend");
    expect(backend?.docsFocus).toContain("docs/db-schema.md");
    expect(backend?.docsFocus).toContain("docs/special-project-guidelines.md");
    expect(backend?.qualityGates).toContain("strict-audit");
    // Security: builtIn cannot be tampered with by repo override
    expect(backend?.builtIn).toBe(true);
  });

  it("findSpecialist matches by ID and aliases", () => {
    const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    expect(findSpecialist(config, "ui")?.id).toBe("ui");
    expect(findSpecialist(config, "frontend")?.id).toBe("ui");
    expect(findSpecialist(config, "ui-specialist")?.id).toBe("ui");
    expect(findSpecialist(config, "lead")?.id).toBe("orchestrator");
    expect(findSpecialist(config, "non_existent")).toBeUndefined();
  });

  it("resolveTargetModelForTier respects provider mappings and modelOverride", () => {
    const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    expect(resolveTargetModelForTier(config, "opencode", "deep")).toBe("custom/pro");
    expect(resolveTargetModelForTier(config, "opencode", "plan")).toBe("custom/pro");
    expect(resolveTargetModelForTier(config, "opencode", "max")).toBe("custom/plan");
    expect(resolveTargetModelForTier(config, "claude", "standard")).toBe("flash");
    expect(resolveTargetModelForTier(config, "claude", "flash")).toBe("flash");
    expect(resolveTargetModelForTier(config, "pi", "review")).toBe("headroom/pro");
    expect(resolveTargetModelForTier(config, "pi", "fast")).toBe("headroom/lite");
  });

  it("normalizes legacy tier aliases and resolves target thinking with omitted-max fallback", () => {
    expect(normalizeTierAlias("lite")).toBe("fast");
    expect(normalizeTierAlias("flash")).toBe("standard");
    expect(normalizeTierAlias("plan")).toBe("deep");
    expect(normalizeTierAlias("review")).toBe("deep");
    expect(normalizeTierAlias("max")).toBe("max");
    expect(normalizeTierAlias("custom-tier")).toBe("custom-tier");

    const effective = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    expect(resolveTierTarget(effective, "antigravity", "fast")).toEqual({
      canonicalTier: "fast",
      model: "gemini-4-hydrogen",
      thinkingOptionId: "medium",
    });
    expect(resolveTierTarget(effective, "antigravity", "standard")).toEqual({
      canonicalTier: "standard",
      model: "gemini-4-argon",
      thinkingOptionId: "high",
    });
    expect(resolveTierTarget(effective, "antigravity", "deep")).toEqual({
      canonicalTier: "deep",
      model: "gemini-4-carbon",
      thinkingOptionId: "high",
    });
    expect(resolveTierTarget(effective, "antigravity", "max")).toEqual({
      canonicalTier: "max",
      model: "gemini-4-neon",
      thinkingOptionId: "xhigh",
    });

    // Custom 3-model provider omitting max falls back to deep model + xhigh thinking
    const customTarget = resolveTierTarget(
      {
        providerMappings: {
          mycustom: { fast: "small", standard: "medium", deep: "large" },
        },
        providerThinkingMappings: {
          mycustom: { fast: "low", standard: "medium", deep: "high" },
        },
      },
      "mycustom",
      "max",
    );
    expect(customTarget).toEqual({
      canonicalTier: "max",
      model: "large",
      thinkingOptionId: "xhigh",
    });
  });

  it("resolveResumeExecutionMode resolves correct modes for claude and opencode", () => {
    const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    expect(resolveResumeExecutionMode(config, "claude", null)).toBe("acceptEdits");
    expect(resolveResumeExecutionMode(config, "opencode", null)).toBe("build");
    expect(resolveResumeExecutionMode(config, "claude", "custom-mode")).toBe("custom-mode");
  });

  it("buildSystemPromptBanner produces comprehensive markdown bullets", () => {
    const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    const specialist = findSpecialist(config, "ui")!;
    const banner = buildSystemPromptBanner({
      config,
      specialist,
      tier: "flash",
      targetModel: "flash",
      roleMatchedRule: "heuristic:ui",
      homeDir: "/tmp/mock-home",
    });

    expect(banner).toContain("[Capability Harness Active Profile]");
    expect(banner).toContain("- Role: ui (rule: heuristic:ui)");
    expect(banner).toContain("- Focus Documents: docs/design.md");
    expect(banner).toContain(
      "- Primary Skills: ui-ux-pro-max, unslop, visual-verdict, diagnosing-bugs, pr",
    );
    expect(banner).toContain("- Workspace Boundary Guardrail (CRITICAL):");
    expect(banner).toContain("Mandatory Skill Activation");
  });

  it("resolveSessionMcpServers filters excluded servers and injects catalog servers", () => {
    const baseSettings = {
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      mcpServerCatalog: {
        "custom-db": {
          type: "stdio" as const,
          command: "custom-db-mcp",
          args: [],
          env: {},
          alwaysLoad: false,
        },
      },
      specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) =>
        s.id === "ui"
          ? {
              ...s,
              excludedMcpServers: ["dbx", "terminal-worker-heavy"],
              injectedMcpServers: ["custom-db"],
            }
          : s,
      ),
    };

    const config = resolveEffectiveHarnessConfig(baseSettings);
    const ui = findSpecialist(config, "ui")!;

    const incomingServers = {
      serena: { type: "stdio" as const, command: "serena" },
      dbx: { type: "stdio" as const, command: "dbx" },
      playwright: { type: "stdio" as const, command: "playwright" },
      paseo: { type: "http" as const, url: "http://127.0.0.1:6767/mcp/agents" },
    };

    const filtered = resolveSessionMcpServers({
      config,
      specialist: ui,
      existingMcpServers: incomingServers,
    });

    // dbx must be excluded
    expect(filtered.dbx).toBeUndefined();
    // serena, playwright, and built-in paseo preserved
    expect(filtered.serena).toBeDefined();
    expect(filtered.playwright).toBeDefined();
    expect(filtered.paseo).toBeDefined();
    // custom-db injected from catalog
    expect(filtered["custom-db"]).toBeDefined();
    expect(filtered["custom-db"].command).toBe("custom-db-mcp");
  });

  it("resolveSpecialistEnvironment populates role, profile, lazy-tool slice and skills root", () => {
    const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    const specialist = findSpecialist(config, "backend")!;

    const env = resolveSpecialistEnvironment({
      config,
      specialist,
      existingEnv: { EXISTING_KEY: "1" },
      homeDir: "/Users/testuser",
    });

    expect(env.EXISTING_KEY).toBe("1");
    expect(env.PASEO_HARNESS_ROLE).toBe("backend");
    expect(env.PASEO_HARNESS_PROFILE).toBe(
      "/Users/testuser/.agents/profiles/backend-specialist.json",
    );
    expect(env.LAZY_TOOL_CONFIG).toBe("/Users/testuser/.config/lazy-tool/profiles/backend.yaml");
    expect(env.PASEO_HARNESS_SKILLS_ROOT).toBe("/Users/jerry/.agents/skills");
  });

  it("migrates v2 settings cleanly to v3 (model-level antigravity bypass and specialist fixes)", () => {
    const v2Values = {
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      bypassProviders: ["antigravity", "custom-bypass"],
      bypassModels: undefined,
      llmFallbackEnabled: true,
      llmFallbackEndpoint: "",
      providerMappings: {
        claude: { plan: "plan", review: "review", flash: "flash" },
      },
      providerModes: {
        claude: { supportsNativePlanMode: true, resumeExecutionModeId: "acceptEdits" },
      },
      specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) => {
        if (s.id === "general") {
          return {
            ...s,
            profileFilename: "architect.json",
            mandatorySkillActivation: true,
            ssotOutputTarget: "openspec/changes/<change-name>/design.md",
          };
        }
        if (s.id === "pm" || s.id === "architect") {
          return { ...s, defaultModeId: "plan" };
        }
        if (s.id === "orchestrator") {
          return {
            ...s,
            rolePromptTemplate:
              "Spawn via paseo run --provider claude --mode bypassPermissions --label role=architect",
          };
        }
        return s;
      }),
    };

    const migrate = agentHarnessSettings.migrate!;
    const migrated = migrate(v2Values, 2) as typeof DEFAULT_AGENT_HARNESS_SETTINGS;

    expect(migrated.bypassProviders).toEqual(["custom-bypass"]);
    expect(migrated.bypassModels).toEqual(["^gemini-pro-orchestrator"]);
    expect(migrated.providerMappings.antigravity).toEqual({
      fast: "gemini-4-hydrogen",
      standard: "gemini-4-argon",
      deep: "gemini-4-carbon",
      max: "gemini-4-neon",
    });
    expect(migrated.providerThinkingMappings.antigravity).toEqual({
      fast: "medium",
      standard: "high",
      deep: "high",
      max: "xhigh",
    });
    expect(migrated.providerModes.antigravity).toEqual({
      supportsNativePlanMode: false,
      resumeExecutionModeId: "full-access",
    });
    expect(migrated.llmFallbackEnabled).toBe(false);

    const general = migrated.specialists.find((s) => s.id === "general")!;
    expect(general.profileFilename).toBe("general.json");
    expect(general.mandatorySkillActivation).toBe(false);
    expect(general.ssotOutputTarget).toBe("");

    const pm = migrated.specialists.find((s) => s.id === "pm")!;
    const architect = migrated.specialists.find((s) => s.id === "architect")!;
    expect(pm.defaultModeId).toBe("");
    expect(architect.defaultModeId).toBe("");

    const orchestrator = migrated.specialists.find((s) => s.id === "orchestrator")!;
    expect(orchestrator.rolePromptTemplate).not.toContain("--provider claude");
    expect(orchestrator.preferredTier).toBe("fast");
  });

  it("migrates v4 settings cleanly to v5 while preserving user-customized mappings and custom tiers", () => {
    const customTier = {
      id: "ultra",
      name: "Ultra Custom",
      icon: "Flame",
      defaultPhase: "exec",
      description: "Custom user tier",
    };
    const v4Values = {
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      defaultFallbackTier: "flash",
      tiers: [
        { id: "plan", name: "Plan", icon: "Compass", defaultPhase: "design", description: "old" },
        { id: "flash", name: "Flash", icon: "Zap", defaultPhase: "exec", description: "old" },
        {
          id: "review",
          name: "Review",
          icon: "ShieldCheck",
          defaultPhase: "review",
          description: "old",
        },
        customTier,
      ],
      providerMappings: {
        // User customized claude.flash; untouched codex should upgrade to v5 defaults
        claude: {
          plan: "claude-opus-custom",
          flash: "claude-sonnet-custom",
          review: "claude-sonnet-custom",
        },
        codex: { plan: "plan", review: "review", flash: "flash" },
      },
      specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) => {
        if (s.id === "orchestrator") return { ...s, preferredTier: "flash" };
        if (s.id === "ui") return { ...s, preferredTier: "flash" };
        if (s.id === "architect") return { ...s, preferredTier: "plan" };
        if (s.id === "review") return { ...s, preferredTier: "review" };
        return s;
      }),
    };

    const migrated = agentHarnessSettings.migrate!(
      v4Values,
      4,
    ) as typeof DEFAULT_AGENT_HARNESS_SETTINGS;

    expect(migrated.tiers.map((t) => t.id)).toEqual(["fast", "standard", "deep", "max", "ultra"]);
    expect(migrated.defaultFallbackTier).toBe("standard");
    expect(migrated.providerMappings.claude.standard).toBe("claude-sonnet-custom");
    expect(migrated.providerMappings.claude.deep).toBe("claude-opus-custom");
    expect(migrated.providerMappings.codex).toEqual({
      fast: "lite",
      standard: "flash",
      deep: "pro",
      max: "plan",
    });
    expect(migrated.providerThinkingMappings.codex).toEqual({
      fast: "low",
      standard: "medium",
      deep: "high",
      max: "xhigh",
    });
    expect(migrated.specialists.find((s) => s.id === "orchestrator")?.preferredTier).toBe("fast");
    expect(migrated.specialists.find((s) => s.id === "ui")?.preferredTier).toBe("standard");
    expect(migrated.specialists.find((s) => s.id === "architect")?.preferredTier).toBe("deep");
    expect(migrated.specialists.find((s) => s.id === "review")?.preferredTier).toBe("deep");
    expect(migrated.providerMappings.claude.max).toBeUndefined();
    expect(
      resolveTierTarget(
        migrated as unknown as ReturnType<typeof resolveEffectiveHarnessConfig>,
        "claude",
        "max",
      ),
    ).toEqual({
      canonicalTier: "max",
      model: "claude-opus-custom",
      thinkingOptionId: "high",
    });
  });

  it("preserves custom antigravity v2 overrides, omitted-max custom providers, and claude-code alias compatibility", () => {
    const migrate = agentHarnessSettings.migrate!;

    // 1. Custom v2 Antigravity overrides must not be shadowed by fromVersion < 3 pre-fill
    const customAgV2 = {
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      providerMappings: {
        antigravity: {
          flash: "custom-ag-standard",
          plan: "custom-ag-deep",
        },
        custom3: {
          fast: "c-fast",
          standard: "c-std",
          deep: "c-deep",
        },
      },
    };
    const migratedAg = migrate(customAgV2, 2) as typeof DEFAULT_AGENT_HARNESS_SETTINGS;
    expect(migratedAg.providerMappings.antigravity).toEqual({
      fast: "gemini-4-hydrogen",
      standard: "custom-ag-standard",
      deep: "custom-ag-deep",
    });
    expect(migratedAg.providerMappings.custom3).toEqual({
      fast: "c-fast",
      standard: "c-std",
      deep: "c-deep",
    });

    const agConfig = resolveEffectiveHarnessConfig(migratedAg);
    expect(resolveTierTarget(agConfig, "antigravity", "max")).toEqual({
      canonicalTier: "max",
      model: "custom-ag-deep",
      thinkingOptionId: "xhigh",
    });
    expect(resolveTierTarget(agConfig, "custom3", "max")).toEqual({
      canonicalTier: "max",
      model: "c-deep",
      thinkingOptionId: "xhigh",
    });

    // 2. Legacy v3 review specialist with preferredProvider: "claude-code" migrates cleanly to antigravity
    const v3ClaudeCode = {
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) =>
        s.id === "review" ? { ...s, preferredProvider: "claude-code" } : s,
      ),
    };
    const migratedV3 = migrate(v3ClaudeCode, 3) as typeof DEFAULT_AGENT_HARNESS_SETTINGS;
    expect(migratedV3.specialists.find((s) => s.id === "review")?.preferredProvider).toBe(
      "antigravity",
    );

    // 3. resolveTierTarget("claude-code", ...) falls back to "claude" and honors explicit "claude-code" overrides
    const defaultCfg = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    expect(resolveTierTarget(defaultCfg, "claude-code", "deep")).toEqual({
      canonicalTier: "deep",
      model: "pro",
      thinkingOptionId: "high",
    });
    const customClaudeCodeCfg = resolveEffectiveHarnessConfig({
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      providerMappings: {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.providerMappings,
        "claude-code": {
          fast: "claude-haiku-custom",
          standard: "claude-sonnet-custom",
          deep: "claude-opus-custom",
        },
      },
    });
    expect(resolveTierTarget(customClaudeCodeCfg, "claude-code", "deep").model).toBe(
      "claude-opus-custom",
    );
  });

  it("clones schema defaults independently and repairs empty/gemini-3 antigravity configs while preserving custom orchestrator prompts", () => {
    const sampleA = agentHarnessSettings.schema.parse({});
    const sampleB = agentHarnessSettings.schema.parse({});
    sampleA.bypassProviders.push("mutated-provider");
    sampleA.providerMappings.antigravity.standard = "mutated-model";
    expect(sampleB.bypassProviders).toEqual([]);
    expect(sampleB.providerMappings.antigravity.standard).toBe("gemini-4-argon");

    const customOrchestratorPrompt = "Custom company orchestrator protocol — keep verbatim.";
    const v2Values = {
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      providerMappings: {
        antigravity: {},
        claude: { plan: "plan", review: "review", flash: "flash" },
      },
      specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) => {
        if (s.id === "ui") {
          return { ...s, modelOverride: "gemini-3.8-flash-old" };
        }
        if (s.id === "orchestrator") {
          return { ...s, rolePromptTemplate: customOrchestratorPrompt };
        }
        return s;
      }),
      phaseRules: {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.phaseRules,
        orchestrator: customOrchestratorPrompt,
      },
    };

    const migrated = agentHarnessSettings.migrate!(
      v2Values,
      2,
    ) as typeof DEFAULT_AGENT_HARNESS_SETTINGS;
    expect(migrated.providerMappings.antigravity).toEqual({
      fast: "gemini-4-hydrogen",
      standard: "gemini-4-argon",
      deep: "gemini-4-carbon",
      max: "gemini-4-neon",
    });

    const ui = migrated.specialists.find((s) => s.id === "ui")!;
    expect(ui.modelOverride).toBe("");

    const orchestrator = migrated.specialists.find((s) => s.id === "orchestrator")!;
    expect(orchestrator.rolePromptTemplate).toBe(customOrchestratorPrompt);
    expect(migrated.phaseRules.orchestrator).toBe(customOrchestratorPrompt);
  });

  it("adapts buildSystemPromptBanner for antigravity using read_file and normalized skills", () => {
    const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    const backend = findSpecialist(config, "backend")!;
    const banner = buildSystemPromptBanner({
      config,
      specialist: backend,
      tier: "flash",
      targetModel: "gemini-4-hydrogen-high",
      roleMatchedRule: "label:role",
      tierMatchedRule: "role_tier:backend",
      homeDir: "/tmp/mock-home",
      provider: "antigravity",
    });

    expect(banner).toContain("read_file");
    expect(banner).not.toContain("invoke the `Skill` tool");
    expect(banner).toContain("codebase-design, tdd, diagnosing-bugs, test-gardener, pr");
    expect(banner).not.toContain("mattpocock-skills:");
  });

  it("normalizes primarySkills across all 5 providers banners (no superpowers:* or mattpocock-skills:)", () => {
    expect(
      normalizePrimarySkills([
        "  paseo  ",
        "superpowers:dispatching-parallel-agents",
        "superpowers:verification-before-completion",
        "superpowers:brainstorming",
        "mattpocock-skills:codebase-design",
        "mattpocock-skills:tdd",
        "custom-skill",
      ]),
    ).toEqual(["paseo", "codebase-design", "tdd", "diagnosing-bugs", "custom-skill"]);

    const effective = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS, {
      specialistOverrides: {
        backend: {
          primarySkills: [
            "superpowers:verification-before-completion",
            "mattpocock-skills:domain-modeling",
            "superpowers:legacy-removed",
          ],
        },
      },
    });
    const backend = findSpecialist(effective, "backend")!;
    expect(backend.primarySkills).toEqual([
      "codebase-design",
      "tdd",
      "diagnosing-bugs",
      "test-gardener",
      "pr",
      "domain-modeling",
    ]);

    for (const provider of ["claude", "codex", "opencode", "pi", "antigravity"]) {
      const banner = buildSystemPromptBanner({
        config: effective,
        specialist: backend,
        tier: "standard",
        targetModel: "flash",
        roleMatchedRule: "label:role",
        homeDir: "/tmp/mock-home",
        provider,
      });
      expect(banner).toContain(
        "- Primary Skills: codebase-design, tdd, diagnosing-bugs, test-gardener, pr, domain-modeling",
      );
      expect(banner).not.toContain("superpowers:");
      expect(banner).not.toContain("mattpocock-skills:");
    }
  });

  it("replaces builtin specialists with workspace agent-team N roles, skips antigravity LAZY_TOOL_CONFIG, and enforces federation/leaf prompts", () => {
    const dynamicSpecialists = [
      {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[1],
        id: "fe-uiux",
        name: "UI/UX Lead",
        shortLabel: "fe-uiux",
        builtIn: false,
        readonly: false,
        preferredProvider: "",
        preferredTier: "flash",
        lazyToolSlice: "ui.yaml",
        rolePromptTemplate: "Own unslop and design tokens.",
      },
      {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[2],
        id: "be-developer",
        name: "Backend Engineer",
        shortLabel: "be-developer",
        builtIn: false,
        readonly: false,
        preferredProvider: "codex",
        preferredTier: "flash",
        lazyToolSlice: "backend.yaml",
        rolePromptTemplate: "Own backend API and TDD.",
      },
      {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[6],
        id: "be-reviewer",
        name: "Backend Reviewer",
        shortLabel: "be-reviewer",
        builtIn: false,
        readonly: true,
        preferredProvider: "claude",
        preferredTier: "review",
        lazyToolSlice: "review.yaml",
        rolePromptTemplate: "Strict read-only review.",
      },
    ];

    const federatedConfig = resolveEffectiveHarnessConfig(
      DEFAULT_AGENT_HARNESS_SETTINGS,
      null,
      "/tmp/demo-repo",
      {
        summary: {
          projectSlug: "demo",
          preset: "fullstack-monorepo",
          manifestPath: "/tmp/demo-repo/.agents/agent-team.json",
          checkoutRoot: "/tmp/demo-repo",
          mainRepoRoot: "/tmp/demo-repo",
          hasLocalAntigravityPlugin: true,
          roles: ["fe-uiux", "be-developer", "be-reviewer"],
        },
        specialists: dynamicSpecialists,
      },
    );

    expect(federatedConfig.specialists.map((s) => s.id)).toEqual([
      "fe-uiux",
      "be-developer",
      "be-reviewer",
    ]);
    expect(federatedConfig.agentTeam?.projectSlug).toBe("demo");

    // Root single-tier Antigravity gets concise 3-line Federation Bridge and no LAZY_TOOL_CONFIG overwrite
    const rootBridge = buildSystemPromptBanner({
      config: federatedConfig,
      specialist: federatedConfig.specialists[0],
      tier: "flash",
      targetModel: "gemini-4-hydrogen-high",
      roleMatchedRule: "default_general",
      homeDir: "/tmp/mock-home",
      provider: "antigravity",
    });
    expect(rootBridge).toContain("[Agent Harness — Federation Bridge]");
    expect(rootBridge).toContain("be-developer (codex·flash)");
    expect(rootBridge).toContain("be-reviewer (claude·review·RO)");
    expect(rootBridge).not.toContain("[Capability Harness Active Profile]");

    const agEnv = resolveSpecialistEnvironment({
      config: federatedConfig,
      specialist: federatedConfig.specialists[0],
      existingEnv: {},
      homeDir: "/tmp/mock-home",
      provider: "antigravity",
    });
    expect(agEnv.LAZY_TOOL_CONFIG).toBeUndefined();
    expect(agEnv.PASEO_HARNESS_LEAF).toBeUndefined();

    // Non-Antigravity provider (codex) keeps LAZY_TOOL_CONFIG, and leaf gets PASEO_HARNESS_LEAF=1
    const codexLeafEnv = resolveSpecialistEnvironment({
      config: federatedConfig,
      specialist: federatedConfig.specialists[1],
      existingEnv: {},
      homeDir: "/tmp/mock-home",
      provider: "codex",
      isLeaf: true,
    });
    expect(codexLeafEnv.LAZY_TOOL_CONFIG).toBe(
      "/tmp/mock-home/.config/lazy-tool/profiles/backend.yaml",
    );
    expect(codexLeafEnv.PASEO_HARNESS_LEAF).toBe("1");

    // Readonly leaf reviewer banner includes role markdown, read-only enforcement, and leaf guardrail
    const reviewerBanner = buildSystemPromptBanner({
      config: federatedConfig,
      specialist: federatedConfig.specialists[2],
      tier: "review",
      targetModel: "review",
      roleMatchedRule: "label:role",
      homeDir: "/tmp/mock-home",
      provider: "claude",
      isLeaf: true,
      isSpawnedSpecialist: true,
    });
    expect(reviewerBanner).toContain("Strict read-only review.");
    expect(reviewerBanner).toContain("Read-Only Specialist Enforcement");
    expect(reviewerBanner).toContain("Leaf Specialist Boundary");
  });

  it("generalizes Federation Bridge & LAZY_TOOL_CONFIG avoidance to claude/opencode/codex when in localFederatedTargets", () => {
    const multiTargetCfg = resolveEffectiveHarnessConfig(
      DEFAULT_AGENT_HARNESS_SETTINGS,
      null,
      "/repo",
      {
        summary: {
          projectSlug: "multi-demo",
          preset: "go-api",
          manifestPath: "/repo/.agents/agent-team.json",
          checkoutRoot: "/repo",
          mainRepoRoot: "/repo",
          hasLocalAntigravityPlugin: false,
          targets: ["claude", "codex"],
          localFederatedTargets: ["claude", "codex"],
          roles: ["be-developer"],
        },
        specialists: [
          {
            id: "be-developer",
            name: "Backend Engineer",
            shortLabel: "be-developer",
            description: "Backend dev",
            icon: "Server",
            enabled: true,
            builtIn: false,
            preferredProvider: "claude",
            preferredTier: "flash",
            modelOverride: "",
            lockTierOnLabel: false,
            handoffEnabled: true,
            handoffPriority: 10,
            handoffTitlePrefix: "[be-developer]",
            handoffDefaultPrompt: "Go backend",
            syncToDaemonProfile: false,
            primarySkills: [],
            mandatorySkillActivation: false,
            docsFocus: [],
            qualityGates: [],
            lazyToolSlice: "backend.yaml",
            allowedMcpServers: [],
            excludedMcpServers: [],
            injectedMcpServers: [],
            aliases: ["backend"],
            matchPatterns: [],
            profileFilename: "be-developer.json",
          },
        ],
      },
    );

    expect(isFederatedLocalProvider(multiTargetCfg, "claude")).toBe(true);
    expect(isFederatedLocalProvider(multiTargetCfg, "claude-code")).toBe(true);
    expect(isFederatedLocalProvider(multiTargetCfg, "codex")).toBe(true);
    expect(isFederatedLocalProvider(multiTargetCfg, "opencode")).toBe(false);
    expect(isFederatedLocalProvider(multiTargetCfg, "antigravity")).toBe(false);

    const claudeEnv = resolveSpecialistEnvironment({
      config: multiTargetCfg,
      specialist: multiTargetCfg.specialists[0],
      existingEnv: {},
      homeDir: "/tmp/mock-home",
      provider: "claude",
    });
    expect(claudeEnv.LAZY_TOOL_CONFIG).toBeUndefined();

    const opencodeEnv = resolveSpecialistEnvironment({
      config: multiTargetCfg,
      specialist: multiTargetCfg.specialists[0],
      existingEnv: {},
      homeDir: "/tmp/mock-home",
      provider: "opencode",
    });
    expect(opencodeEnv.LAZY_TOOL_CONFIG).toBe(
      "/tmp/mock-home/.config/lazy-tool/profiles/backend.yaml",
    );

    const claudeBridge = buildSystemPromptBanner({
      config: multiTargetCfg,
      specialist: multiTargetCfg.specialists[0],
      tier: "flash",
      targetModel: "flash",
      roleMatchedRule: "default_general",
      homeDir: "/tmp/mock-home",
      provider: "claude",
    });
    expect(claudeBridge).toContain("[Agent Harness — Federation Bridge]");
    expect(claudeBridge).toContain("local synthesized claude agents (team-multi-demo)");
  });

  it("infers tiers from runtime model IDs including suffix-stripped variants and shared max fallback", () => {
    const effective = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);

    expect(inferTierFromModel(effective, "antigravity", "gemini-4-hydrogen")).toEqual({
      tier: "fast",
      isKnownTierModel: true,
      isRouterManagedNonMax: true,
      isDedicatedMax: false,
    });
    expect(inferTierFromModel(effective, "antigravity", "gemini-4-hydrogen-high")).toEqual({
      tier: "fast",
      isKnownTierModel: true,
      isRouterManagedNonMax: true,
      isDedicatedMax: false,
    });
    expect(inferTierFromModel(effective, "antigravity", "gemini-4-argon")).toEqual({
      tier: "standard",
      isKnownTierModel: true,
      isRouterManagedNonMax: true,
      isDedicatedMax: false,
    });
    expect(inferTierFromModel(effective, "antigravity", "gemini-4-carbon")).toEqual({
      tier: "deep",
      isKnownTierModel: true,
      isRouterManagedNonMax: true,
      isDedicatedMax: false,
    });
    expect(inferTierFromModel(effective, "antigravity", "gemini-4-neon")).toEqual({
      tier: "max",
      isKnownTierModel: true,
      isRouterManagedNonMax: false,
      isDedicatedMax: true,
    });
    expect(inferTierFromModel(effective, "antigravity", "custom-unknown-model", "flash")).toEqual({
      tier: "standard",
      isKnownTierModel: false,
      isRouterManagedNonMax: false,
      isDedicatedMax: false,
    });
    expect(
      inferTierFromModel(
        {
          providerMappings: {
            mycustom: { fast: "small", standard: "medium", deep: "large", max: "large" },
          },
        },
        "mycustom",
        "large",
      ),
    ).toEqual({
      tier: "deep",
      isKnownTierModel: true,
      isRouterManagedNonMax: true,
      isDedicatedMax: false,
    });
  });

  it("includes Antigravity mcp_paseo_create_agent specialist handoff instructions for non-leaf sessions only", () => {
    const effective = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    const uiSpec = findSpecialist(effective, "ui")!;

    const rootBanner = buildSystemPromptBanner({
      config: effective,
      specialist: uiSpec,
      tier: "standard",
      targetModel: "gemini-4-argon",
      roleMatchedRule: "heuristic:ui",
      homeDir: "/tmp/mock-home",
      provider: "antigravity",
      isLeaf: false,
    });
    expect(rootBanner).toContain("mcp_paseo_create_agent");
    expect(rootBanner).toContain("paseo.harness-leaf");

    const leafBanner = buildSystemPromptBanner({
      config: effective,
      specialist: uiSpec,
      tier: "standard",
      targetModel: "gemini-4-argon",
      roleMatchedRule: "label:role",
      homeDir: "/tmp/mock-home",
      provider: "antigravity",
      isLeaf: true,
    });
    expect(leafBanner).not.toContain("mcp_paseo_create_agent");

    // UI specialist with custom vendor skillsRoot includes fallback defaultSkillsRoot in banner
    const customVendorUi = {
      ...uiSpec,
      skillsRoot: "/Users/jerry/.agents/vendor/ui-ux-pro-max-skill/.claude/skills",
    };
    const customVendorBanner = buildSystemPromptBanner({
      config: effective,
      specialist: customVendorUi,
      tier: "standard",
      targetModel: "gemini-4-argon",
      roleMatchedRule: "heuristic:ui",
      homeDir: "/tmp/mock-home",
      provider: "antigravity",
      isLeaf: false,
    });
    expect(customVendorBanner).toContain("fallback: ~/.agents/skills");
    expect(customVendorBanner).toContain("or fallback `~/.agents/skills`");

    // Backend & UI specialists whose expanded skillsRoot equals defaultSkillsRoot omit fallback
    const backendSpec = findSpecialist(effective, "backend")!;
    const backendBanner = buildSystemPromptBanner({
      config: effective,
      specialist: backendSpec,
      tier: "standard",
      targetModel: "gemini-4-argon",
      roleMatchedRule: "label:role",
      homeDir: "/Users/jerry",
      provider: "antigravity",
      isLeaf: true,
    });
    expect(backendBanner).not.toContain("fallback:");
    expect(backendBanner).toContain("/Users/jerry/.agents/skills/codebase-design/SKILL.md");

    // Antigravity banners use dynamic configured models, mention invoke_subagent + mcp_paseo_create_agent, and never mention harness_handoff
    const customAgEffective = resolveEffectiveHarnessConfig({
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      providerMappings: {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.providerMappings,
        antigravity: {
          fast: "custom-ag-fast",
          standard: "custom-ag-std",
          deep: "custom-ag-deep",
          max: "custom-ag-max",
        },
      },
    });
    const agDesignBanner = buildSystemPromptBanner({
      config: customAgEffective,
      specialist: findSpecialist(customAgEffective, "ui")!,
      tier: "deep",
      targetModel: "custom-ag-deep",
      phase: "design",
      roleMatchedRule: "heuristic:ui",
      homeDir: "/Users/jerry",
      provider: "antigravity",
      isLeaf: false,
    });
    expect(agDesignBanner).toContain("custom-ag-deep");
    expect(agDesignBanner).toContain("custom-ag-std");
    expect(agDesignBanner).not.toContain("gemini-4-hydrogen-high");
    expect(agDesignBanner).not.toContain("gemini-4-argon-high");
    expect(agDesignBanner).not.toContain("gemini-4-carbon");
    expect(agDesignBanner).toContain("invoke_subagent");
    expect(agDesignBanner).toContain("mcp_paseo_create_agent");
    expect(agDesignBanner).not.toContain("harness_handoff");
    expect(agDesignBanner).toContain("exit_plan_mode");
    expect(agDesignBanner).not.toContain("ExitPlanMode");

    const agExecBanner = buildSystemPromptBanner({
      config: customAgEffective,
      specialist: findSpecialist(customAgEffective, "backend")!,
      tier: "standard",
      targetModel: "custom-ag-std",
      phase: "exec",
      roleMatchedRule: "label:role",
      homeDir: "/Users/jerry",
      provider: "antigravity",
      isLeaf: false,
    });
    expect(agExecBanner).toContain("invoke_subagent");
    expect(agExecBanner).toContain("mcp_paseo_create_agent");
    expect(agExecBanner).not.toContain("harness_handoff");
    expect(agExecBanner).not.toContain("paseo-handoff");
    expect(agExecBanner).not.toContain("ExitPlanMode");

    // Expands tilde (~/) skillsRoot when homeDir is passed to buildSystemPromptBanner
    const tildeUiSpec = {
      ...findSpecialist(effective, "ui")!,
      skillsRoot: "~/.agents/skills",
    };
    const expandedSkillsBanner = buildSystemPromptBanner({
      config: effective,
      specialist: tildeUiSpec,
      tier: "standard",
      targetModel: "gemini-4-argon",
      roleMatchedRule: "heuristic:ui",
      homeDir: "/Users/jerry",
      provider: "antigravity",
      isLeaf: true,
    });
    expect(expandedSkillsBanner).toContain("/Users/jerry/.agents/skills/ui-ux-pro-max/SKILL.md");
    expect(expandedSkillsBanner).not.toContain("`~/.agents/skills/ui-ux-pro-max/SKILL.md`");
    expect(expandedSkillsBanner).not.toContain("mcp_paseo_create_agent");
    expect(expandedSkillsBanner).not.toContain("harness_handoff");
  });

  it("injects unattended workflow design phaseRule and suppresses Antigravity handoff prompt when isUnattendedWorkflow=true", () => {
    const effective = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    const architectSpec = findSpecialist(effective, "architect")!;

    const unattendedDesignBanner = buildSystemPromptBanner({
      config: effective,
      specialist: architectSpec,
      tier: "deep",
      targetModel: "gemini-4-carbon",
      phase: "design",
      roleMatchedRule: "label:role",
      homeDir: "/Users/jerry",
      provider: "antigravity",
      isLeaf: false,
      isUnattendedWorkflow: true,
    });

    expect(unattendedDesignBanner).toContain(
      "- [Phase: Unattended Workflow Design & Spec] Rule: You are running in an automated workflow stage (phase=design). Author concise architectural proposals, design specs, or implementation plans as instructed by the workflow prompt (writing spec/plan Markdown files if requested); DO NOT edit business source files in this design stage, DO NOT invoke interactive ExitPlanMode, and DO NOT spawn subagents.",
    );
    expect(unattendedDesignBanner).not.toContain("[Phase: Design & Planning]");
    expect(unattendedDesignBanner).not.toContain("mcp_paseo_create_agent");

    // When specialist has custom rolePromptTemplate, custom prompt wins over unattended design default
    const customTemplateBanner = buildSystemPromptBanner({
      config: effective,
      specialist: {
        ...architectSpec,
        rolePromptTemplate: "- [Custom Architect Template] Follow repo ADR strictly.",
      },
      tier: "deep",
      targetModel: "gemini-4-carbon",
      phase: "design",
      roleMatchedRule: "label:role",
      homeDir: "/Users/jerry",
      provider: "antigravity",
      isUnattendedWorkflow: true,
    });
    expect(customTemplateBanner).toContain(
      "- [Custom Architect Template] Follow repo ADR strictly.",
    );
    expect(customTemplateBanner).not.toContain("[Phase: Unattended Workflow Design & Spec]");

    // Agent-team suffixed roles (fe-architect, be-reviewer) resolve banner phase accurately even when options.phase is omitted
    const feArchitectBanner = buildSystemPromptBanner({
      config: effective,
      specialist: {
        ...architectSpec,
        id: "fe-architect",
        rolePromptTemplate: "",
      },
      tier: "deep",
      targetModel: "gemini-4-carbon",
      roleMatchedRule: "label:role",
      homeDir: "/Users/jerry",
      provider: "antigravity",
      isUnattendedWorkflow: true,
    });
    expect(feArchitectBanner).toContain("[Phase: Unattended Workflow Design & Spec]");

    const beReviewerSpec = {
      ...findSpecialist(effective, "review")!,
      id: "be-reviewer",
      rolePromptTemplate: "",
    };
    const beReviewerBanner = buildSystemPromptBanner({
      config: effective,
      specialist: beReviewerSpec,
      tier: "deep",
      targetModel: "gemini-4-carbon",
      roleMatchedRule: "label:role",
      homeDir: "/Users/jerry",
      provider: "antigravity",
      isUnattendedWorkflow: true,
    });
    expect(beReviewerBanner).toContain("[Phase: Review Gate]");
  });

  it("migrates v5 settings cleanly to v6 while preserving user-customized fields", async () => {
    const presets = await import("../shared/presets.js");
    const v5Untouched = {
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      fullstackUiPattern: presets.LEGACY_V5_FULLSTACK_UI_PATTERN,
      affirmativeConfirmWords: [
        "继续",
        "好",
        "可以",
        "行",
        "没问题",
        "ok",
        "lgtm",
        "go ahead",
        "proceed",
        "yes",
        "sure",
        "start",
        "开始吧",
        "改吧",
        "做吧",
        "搞起",
        "干吧",
      ],
      tierPatterns: {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.tierPatterns,
        execAction: [presets.LEGACY_V5_EXEC_ACTION_PATTERN],
      },
      specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) => {
        if (s.id === "ui") {
          return {
            ...s,
            matchPatterns: [...presets.LEGACY_V5_UI_MATCH_PATTERNS],
            allowedMcpServers: [...presets.LEGACY_V5_UI_ALLOWED_MCP],
          };
        }
        if (s.id === "general") {
          return {
            ...s,
            allowedMcpServers: [...presets.LEGACY_V5_GENERAL_ALLOWED_MCP],
          };
        }
        return s;
      }),
    };

    const migrated = agentHarnessSettings.migrate!(
      v5Untouched,
      5,
    ) as typeof DEFAULT_AGENT_HARNESS_SETTINGS;
    const migratedUi = migrated.specialists.find((s) => s.id === "ui")!;
    const migratedGeneral = migrated.specialists.find((s) => s.id === "general")!;

    expect(migratedUi.matchPatterns[0]).toContain("dark\\s*mode");
    expect(migratedUi.allowedMcpServers).toEqual(["playwright", "serena", "claude-mem"]);
    expect(migratedGeneral.allowedMcpServers).toEqual([
      "serena",
      "claude-mem",
      "hub",
      "sequential-thinking",
    ]);
    expect(migrated.fullstackUiPattern).toContain("dark\\s*mode");
    expect(migrated.tierPatterns.execAction[0]).toContain("服务");
    expect(migrated.affirmativeConfirmWords).toContain("ok, continue");
    expect(migrated.affirmativeConfirmWords).toContain("go");

    // User-customized arrays and patterns must NOT be overwritten
    const v5Customized = {
      ...v5Untouched,
      affirmativeConfirmWords: ["ok", "custom-confirm"],
      specialists: v5Untouched.specialists.map((s) =>
        s.id === "ui" ? { ...s, allowedMcpServers: ["serena", "custom-ui-mcp"] } : s,
      ),
    };
    const migratedCustom = agentHarnessSettings.migrate!(
      v5Customized,
      5,
    ) as typeof DEFAULT_AGENT_HARNESS_SETTINGS;
    expect(migratedCustom.affirmativeConfirmWords).toEqual(["ok", "custom-confirm"]);
    expect(migratedCustom.specialists.find((s) => s.id === "ui")?.allowedMcpServers).toEqual([
      "serena",
      "custom-ui-mcp",
    ]);
  });

  it("migrates v6 settings cleanly to v7 for untouched built-in specialists and user-customized primarySkills", async () => {
    const presets = await import("../shared/presets.js");
    const v6Values = {
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      specialists: [
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) => {
          const legacySkills = presets.LEGACY_V6_SPECIALIST_PRIMARY_SKILLS[s.id];
          if (s.id === "backend") {
            // User customized backend primarySkills with a custom skill + legacy prefixed skills
            return {
              ...s,
              primarySkills: [
                "mattpocock-skills:codebase-design",
                "superpowers:verification-before-completion",
                "superpowers:subagent-driven-development",
                "my-custom-backend-skill",
              ],
            };
          }
          return legacySkills ? { ...s, primarySkills: [...legacySkills] } : s;
        }),
        {
          id: "custom-ops",
          name: "Custom Ops",
          shortLabel: "Ops",
          description: "Custom ops role",
          icon: "Server",
          color: "slate",
          enabled: true,
          builtIn: false,
          preferredProvider: "codex",
          preferredTier: "standard",
          modelOverride: "",
          defaultModeId: "",
          thinkingOptionId: "",
          lockTierOnLabel: false,
          handoffEnabled: true,
          handoffPriority: 90,
          handoffTitlePrefix: "[Ops]",
          handoffDefaultPrompt: "Run ops checks.",
          syncToDaemonProfile: false,
          primarySkills: [
            "superpowers:dispatching-parallel-agents",
            "mattpocock-skills:grilling",
            "k8s-triage",
          ],
          mandatorySkillActivation: true,
          skillsRoot: "~/.agents/skills",
          docsFocus: [],
          qualityGates: [],
          ssotOutputTarget: "",
          rolePromptTemplate: "",
          lazyToolSlice: "backend.yaml",
          allowedMcpServers: [],
          excludedMcpServers: [],
          injectedMcpServers: [],
          extraEnv: {},
          aliases: [],
          matchPatterns: [],
          profileFilename: "custom-ops.json",
        },
      ],
    };

    const migrated = agentHarnessSettings.migrate!(
      v6Values,
      6,
    ) as typeof DEFAULT_AGENT_HARNESS_SETTINGS;

    // Untouched built-in specialists receive full v7 primarySkills (including new skills like diagnosing-bugs, pr, tdd)
    expect(migrated.specialists.find((s) => s.id === "orchestrator")?.primarySkills).toEqual([
      "paseo",
      "codebase-design",
    ]);
    expect(migrated.specialists.find((s) => s.id === "ui")?.primarySkills).toEqual([
      "ui-ux-pro-max",
      "unslop",
      "visual-verdict",
      "diagnosing-bugs",
      "pr",
    ]);
    expect(migrated.specialists.find((s) => s.id === "qa")?.primarySkills).toEqual([
      "test-gardener",
      "tdd",
      "diagnosing-bugs",
      "deliver-edge-cases",
    ]);
    expect(migrated.specialists.find((s) => s.id === "general")?.primarySkills).toEqual([
      "codebase-design",
      "domain-modeling",
      "tdd",
      "diagnosing-bugs",
    ]);
    expect(migrated.specialists.find((s) => s.id === "review")?.primarySkills).toEqual([
      "code-review",
      "open-code-review-delegate",
      "gitea",
    ]);

    // User-customized built-in specialist preserves custom skill while migrating superpowers:* and stripping mattpocock-skills:
    expect(migrated.specialists.find((s) => s.id === "backend")?.primarySkills).toEqual([
      "codebase-design",
      "tdd",
      "diagnosing-bugs",
      "my-custom-backend-skill",
    ]);

    // Custom specialist normalizes primarySkills cleanly
    expect(migrated.specialists.find((s) => s.id === "custom-ops")?.primarySkills).toEqual([
      "codebase-design",
      "grilling",
      "k8s-triage",
    ]);
  });

  it("splits codex.yaml, unifies skillsRoot/pm skills, and migrates v7 -> v8 losslessly while preserving user overrides", async () => {
    const { SETTINGS_SCHEMA_VERSION } = await import("../shared/settings.js");
    expect(SETTINGS_SCHEMA_VERSION).toBe(8);

    // Built-in presets have zero codex.yaml and unified skillsRoot
    for (const s of DEFAULT_AGENT_HARNESS_SETTINGS.specialists) {
      expect(s.lazyToolSlice).not.toBe("codex.yaml");
    }
    expect(
      DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "general")?.lazyToolSlice,
    ).toBe("general.yaml");
    expect(
      DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "architect")?.lazyToolSlice,
    ).toBe("architect.yaml");
    expect(
      DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "qa")?.lazyToolSlice,
    ).toBe("qa.yaml");
    expect(
      DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "scout")?.lazyToolSlice,
    ).toBe("scout.yaml");
    expect(
      DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "scout")?.allowedMcpServers,
    ).toEqual(["claude-mem"]);
    expect(DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "ui")?.skillsRoot).toBe(
      "/Users/jerry/.agents/skills",
    );
    expect(DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "pm")?.skillsRoot).toBe(
      "/Users/jerry/.agents/skills",
    );
    expect(
      DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "pm")?.primarySkills,
    ).toEqual([
      "grilling",
      "deliver-prd",
      "deliver-user-stories",
      "deliver-edge-cases",
      "define-problem-statement",
    ]);

    expect(
      normalizePrimarySkills([
        "pm-prd",
        "pm-user-stories",
        "pm-edge-cases",
        "pm-problem",
        "pm-prd",
        "grilling",
      ]),
    ).toEqual([
      "deliver-prd",
      "deliver-user-stories",
      "deliver-edge-cases",
      "define-problem-statement",
      "grilling",
    ]);

    const v7Values = {
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      debugLogs: true,
      providerMappings: {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.providerMappings,
        claude: { fast: "claude-haiku-custom", standard: "flash", deep: "pro", max: "plan" },
      },
      specialists: [
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) => {
          if (s.id === "general") {
            return { ...s, lazyToolSlice: "codex.yaml", preferredProvider: "codex" };
          }
          if (s.id === "architect") {
            return { ...s, lazyToolSlice: "backend.yaml", modelOverride: "custom-arch-model" };
          }
          if (s.id === "qa") {
            return {
              ...s,
              lazyToolSlice: "ui.yaml",
              primarySkills: ["test-gardener", "pm-edge-cases"],
            };
          }
          if (s.id === "scout") {
            return { ...s, lazyToolSlice: "pm.yaml", allowedMcpServers: [] };
          }
          if (s.id === "ui") {
            return {
              ...s,
              skillsRoot: "/Users/jerry/.agents/vendor/ui-ux-pro-max-skill/.claude/skills",
              matchPatterns: [
                "\\b(?:ui|ux|ui-ux-pro-max|unslop|visual-verdict|unistyles|popover|sheet|pill|hover|tailwind|expo|react\\s*native|playwright|css|scss|sass|dark\\s*mode|light\\s*mode|color[-\\s]*scheme|theming|design[-\\s]*tokens?)\\b",
                "前端|界面|样式|弹窗|组件|面板|视觉|移动端|手机端|响应式|布局|图标|配色|交互体验|暗黑模式|深色模式|浅色模式|亮色模式|主题切换|主题色",
                "my-custom-ui-widget",
              ],
            };
          }
          if (s.id === "pm") {
            return {
              ...s,
              skillsRoot: "/Users/jerry/.agents/vendor/pm-skills/skills",
              primarySkills: [
                "pm-prd",
                "pm-user-stories",
                "pm-edge-cases",
                "pm-problem",
                "grilling",
              ],
            };
          }
          if (s.id === "backend") {
            return {
              ...s,
              matchPatterns: [
                "\\b(?:daemon|websocket|rpc|sqlite|dbx|terminal-worker|worktree|protocol|zod-aot|relay|noise\\s*nk|quota|proxy|gateway|scheduler|provider)\\b",
                "后端|协议兼容|数据库|进程通信|服务端|配额|网关|代理服务|限流|中间件",
                "my-custom-grpc-service",
              ],
            };
          }
          return s;
        }),
        {
          ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[8],
          id: "legacy-custom",
          name: "Legacy Custom",
          shortLabel: "Legacy",
          builtIn: false,
          lazyToolSlice: "codex.yaml",
          primarySkills: ["pm-prd", "custom-skill"],
        },
      ],
    };

    const migrated = agentHarnessSettings.migrate!(
      v7Values,
      7,
    ) as typeof DEFAULT_AGENT_HARNESS_SETTINGS;

    expect(migrated.debugLogs).toBe(true);
    expect(migrated.providerMappings.claude.fast).toBe("claude-haiku-custom");

    const mGeneral = migrated.specialists.find((s) => s.id === "general")!;
    expect(mGeneral.lazyToolSlice).toBe("general.yaml");
    expect(mGeneral.preferredProvider).toBe("codex");

    const mArch = migrated.specialists.find((s) => s.id === "architect")!;
    expect(mArch.lazyToolSlice).toBe("architect.yaml");
    expect(mArch.modelOverride).toBe("custom-arch-model");

    const mQa = migrated.specialists.find((s) => s.id === "qa")!;
    expect(mQa.lazyToolSlice).toBe("qa.yaml");
    expect(mQa.primarySkills).toEqual(["test-gardener", "deliver-edge-cases"]);

    const mScout = migrated.specialists.find((s) => s.id === "scout")!;
    expect(mScout.lazyToolSlice).toBe("scout.yaml");
    expect(mScout.allowedMcpServers).toEqual(["claude-mem"]);

    const mUi = migrated.specialists.find((s) => s.id === "ui")!;
    expect(mUi.skillsRoot).toBe("/Users/jerry/.agents/skills");
    expect(mUi.matchPatterns).toContain("my-custom-ui-widget");
    expect(mUi.matchPatterns.join("\n")).toContain("颜色");
    expect(mUi.matchPatterns.join("\n")).toContain("modal");

    const mPm = migrated.specialists.find((s) => s.id === "pm")!;
    expect(mPm.skillsRoot).toBe("/Users/jerry/.agents/skills");
    expect(mPm.primarySkills).toEqual([
      "grilling",
      "deliver-prd",
      "deliver-user-stories",
      "deliver-edge-cases",
      "define-problem-statement",
    ]);

    const mBackend = migrated.specialists.find((s) => s.id === "backend")!;
    expect(mBackend.matchPatterns).toContain("my-custom-grpc-service");
    expect(new RegExp(mBackend.matchPatterns[0], "i").test("WorkTree 标签")).toBe(false);
    expect(new RegExp(mBackend.matchPatterns[0], "i").test("Provider 名称")).toBe(false);
    expect(new RegExp(mBackend.matchPatterns[0], "i").test("git worktree status")).toBe(true);
    expect(new RegExp(mBackend.matchPatterns[0], "i").test("provider adapter config")).toBe(true);

    const mLegacyCustom = migrated.specialists.find((s) => s.id === "legacy-custom")!;
    expect(mLegacyCustom.lazyToolSlice).toBe("general.yaml");
    expect(mLegacyCustom.primarySkills).toEqual(["deliver-prd", "custom-skill"]);
  });
});

describe("Agent Team Visual Editor Utils", () => {
  const sampleCatalog: AgentTeamCatalogData = {
    roles: [
      {
        id: "fe-uiux",
        team: "fe",
        title: "UI/UX Lead",
        readonly: false,
        recommended_model: "inherit",
        requires_mcp: ["serena"],
        requires_guards: ["guard-serena-nomem"],
      },
      {
        id: "be-reviewer",
        team: "be",
        title: "Backend Reviewer (Read-Only)",
        readonly: true,
        recommended_model: "pro",
        requires_mcp: ["serena", "postgres-ro"],
        requires_guards: ["guard-sql-ro"],
      },
    ],
    capabilities: [
      {
        id: "matt-sdd",
        title: "Spec-Driven Dev",
        description: "OpenSpec + contracts",
        requires_mcp: ["serena"],
        requires_guards: ["guard-git-safety"],
        enables_flow: { openspec: true, contracts: true },
      },
    ],
    mcp_sources: [
      {
        id: "serena",
        description: "Symbol intelligence",
        implies_guards: ["guard-serena-nomem"],
      },
      {
        id: "postgres-ro",
        description: "Read-only Postgres",
        implies_guards: ["guard-sql-ro"],
      },
    ],
    guards: [
      { id: "guard-serena-nomem", description: "Disable Serena memory" },
      { id: "guard-sql-ro", description: "Read-only SQL" },
      { id: "guard-git-safety", description: "No force push" },
    ],
  };

  const samplePreset: AgentTeamPresetData = {
    id: "go-api",
    title: "Go API",
    description: "Go backend",
    roles: ["be-reviewer"],
    capabilities: [],
    mcp_sources: ["serena"],
    guards: ["guard-serena-nomem"],
    flow: { openspec: false, contracts: true, workflows: false, scaffold_docs: true },
  };

  it("normalizes bindings, defaults targets to antigravity, and preserves compatible bindings on preset switch", () => {
    const initialized = createManifestFromPreset("go-api", samplePreset, "My_Demo Repo", {
      targets: ["claude-code", "codex"],
      existingBindings: {
        "be-reviewer": { provider: "claude-code", tier: "review", model: "claude-sonnet-4" },
        "unused-role": { provider: "codex", tier: "flash" },
      },
    });

    expect(initialized.project_slug).toBe("my-demo-repo");
    expect(initialized.targets).toEqual(["claude", "codex"]);
    expect(initialized.bindings["be-reviewer"]).toEqual({
      provider: "claude",
      tier: "review",
      model: "claude-sonnet-4",
    });
    expect(initialized.bindings["unused-role"]).toBeUndefined();

    const emptyTargets = normalizeEditableManifest({
      project_slug: "!!!",
      targets: [],
      roles: ["fe-uiux", "../escape", "bad role"],
      capabilities: ["matt-sdd", "../bad-cap"],
      mcp_sources: ["serena", "/etc/passwd"],
      guards: ["guard-git-safety", "a/b"],
      bindings: {
        "fe-uiux": { provider: "OpenCode", tier: "flash" },
      },
    });
    expect(emptyTargets.targets).toEqual(["antigravity"]);
    expect(emptyTargets.project_slug).toBe("project");
    expect(emptyTargets.roles).toEqual(["fe-uiux"]);
    expect(emptyTargets.capabilities).toEqual(["matt-sdd"]);
    expect(emptyTargets.mcp_sources).toEqual(["serena"]);
    expect(emptyTargets.guards).toEqual(["guard-git-safety"]);
    expect(emptyTargets.bindings["fe-uiux"]?.provider).toBe("opencode");
  });

  it("auto-adds recommended deps on toggle while preserving manual guard uncheck and missing advisory", () => {
    let manifest = createManifestFromPreset("go-api", samplePreset, "demo");

    const roleAdded = toggleRoleWithAutoDeps(manifest, "fe-uiux", sampleCatalog);
    manifest = roleAdded.manifest;
    expect(manifest.roles).toContain("fe-uiux");

    const capAdded = toggleCapabilityWithAutoDeps(manifest, "matt-sdd", sampleCatalog);
    manifest = capAdded.manifest;
    expect(manifest.capabilities).toContain("matt-sdd");
    expect(manifest.flow.openspec).toBe(true);
    expect(manifest.guards).toContain("guard-git-safety");
    expect(capAdded.autoAdded).toContain("Guard: guard-git-safety");

    const mcpAdded = toggleMcpWithAutoDeps(manifest, "postgres-ro", sampleCatalog);
    manifest = mcpAdded.manifest;
    expect(manifest.guards).toContain("guard-sql-ro");

    manifest = toggleGuardItem(manifest, "guard-sql-ro");
    expect(manifest.guards).not.toContain("guard-sql-ro");
    const missing = computeMissingRecommendedDeps(manifest, sampleCatalog);
    expect(missing.missingGuards).toContain("guard-sql-ro");
  });

  it("prevents disabling the last target and detects equality accurately", () => {
    const manifest = createManifestFromPreset("go-api", samplePreset, "demo");
    const blocked = toggleTargetItem(manifest, "antigravity");
    expect(blocked.blockedLastTarget).toBe(true);
    expect(blocked.manifest.targets).toEqual(["antigravity"]);

    const addedCodex = toggleTargetItem(manifest, "codex");
    expect(addedCodex.blockedLastTarget).toBe(false);
    expect(areManifestsEqual(manifest, addedCodex.manifest)).toBe(false);

    const sameCopy = normalizeEditableManifest({
      ...manifest,
      bindings: { "be-reviewer": { provider: "claude" } },
    });
    const modifiedBinding = normalizeEditableManifest({
      ...manifest,
      bindings: { "be-reviewer": { provider: "codex" } },
    });
    expect(areManifestsEqual(sameCopy, modifiedBinding)).toBe(false);
    expect(areManifestsEqual(manifest, { ...manifest })).toBe(true);
  });
});
