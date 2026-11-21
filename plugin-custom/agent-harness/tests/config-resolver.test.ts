import { describe, expect, it } from "vitest";
import {
  buildSystemPromptBanner,
  findSpecialist,
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
});
