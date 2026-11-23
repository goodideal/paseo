import { describe, expect, it } from "vitest";
import {
  buildSystemPromptBanner,
  findSpecialist,
  isFederatedLocalProvider,
  resolveEffectiveHarnessConfig,
  resolveResumeExecutionMode,
  resolveSessionMcpServers,
  resolveSpecialistEnvironment,
  resolveTargetModelForTier,
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
  it("DEFAULT_AGENT_HARNESS_SETTINGS has all 9 builtin specialists and 3 tiers", () => {
    expect(DEFAULT_AGENT_HARNESS_SETTINGS.specialists.length).toBe(9);
    expect(DEFAULT_AGENT_HARNESS_SETTINGS.tiers.length).toBe(3);
    expect(DEFAULT_AGENT_HARNESS_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_AGENT_HARNESS_SETTINGS.profilesDir).toBe("~/.agents/profiles");
    expect(DEFAULT_AGENT_HARNESS_SETTINGS.autoSyncDiskProfiles).toBe(true);
  });

  it("migrates v1 settings cleanly to v2", () => {
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
    // V2 defaults populated
    expect(migrated.specialists.length).toBe(9);
    expect(migrated.tiers.length).toBe(3);
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
    expect(resolveTargetModelForTier(config, "opencode", "plan")).toBe("custom/plan");
    expect(resolveTargetModelForTier(config, "claude", "flash")).toBe("flash");
    expect(resolveTargetModelForTier(config, "pi", "review")).toBe("headroom/review");
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
    expect(banner).toContain("- Primary Skills: ui-ux-pro-max, unslop, visual-verdict");
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
    };

    const filtered = resolveSessionMcpServers({
      config,
      specialist: ui,
      existingMcpServers: incomingServers,
    });

    // dbx must be excluded
    expect(filtered.dbx).toBeUndefined();
    // serena and playwright preserved
    expect(filtered.serena).toBeDefined();
    expect(filtered.playwright).toBeDefined();
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
      plan: "gemini-4-carbon-high",
      review: "gemini-4-argon-high",
      flash: "gemini-4-hydrogen-high",
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
  });

  it("clones schema defaults independently and repairs empty/gemini-3 antigravity configs while preserving custom orchestrator prompts", () => {
    const sampleA = agentHarnessSettings.schema.parse({});
    const sampleB = agentHarnessSettings.schema.parse({});
    sampleA.bypassProviders.push("mutated-provider");
    sampleA.providerMappings.antigravity.flash = "mutated-model";
    expect(sampleB.bypassProviders).toEqual([]);
    expect(sampleB.providerMappings.antigravity.flash).toBe("gemini-4-hydrogen-high");

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
      plan: "gemini-4-carbon-high",
      review: "gemini-4-argon-high",
      flash: "gemini-4-hydrogen-high",
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
    expect(banner).toContain("codebase-design, tdd, test-gardener");
    expect(banner).not.toContain("mattpocock-skills:");
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
