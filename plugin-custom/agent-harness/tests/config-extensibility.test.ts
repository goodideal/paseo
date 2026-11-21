import { describe, expect, it } from "vitest";
import { BUILTIN_SPECIALISTS, BUILTIN_TIERS } from "../shared/presets.js";
import {
  resolveEffectiveHarnessConfig,
  findSpecialist,
  resolveTargetModelForTier,
} from "../shared/config-resolver.js";
import { importSpecialistsFromDisk, exportSpecialistsToDisk } from "../server/profile-sync.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("Agent Harness v2 Config & Extensibility", () => {
  it("supports adding and routing custom user-defined specialist roles", () => {
    const customSpecialist = {
      id: "rust-kernel",
      name: "Rust Kernel Expert",
      shortLabel: "Rust",
      description: "Low-level systems and memory safety expert",
      icon: "Cpu",
      color: "red",
      enabled: true,
      builtIn: false,
      preferredProvider: "codex",
      preferredTier: "plan",
      modelOverride: "codex-deep-reasoning",
      defaultModeId: "bypassPermissions",
      lockTierOnLabel: true,
      handoffEnabled: true,
      handoffPriority: 15,
      handoffTitlePrefix: "[Rust]",
      handoffDefaultPrompt: "Optimize unsafe blocks and memory layout.",
      syncToDaemonProfile: true,
      primarySkills: ["mattpocock-skills:codebase-design"],
      mandatorySkillActivation: true,
      docsFocus: ["docs/architecture.md"],
      qualityGates: ["memory-safety"],
      allowedMcpServers: ["serena"],
      excludedMcpServers: [],
      injectedMcpServers: [],
      aliases: ["rust", "kernel"],
      matchPatterns: ["\\b(?:unsafe|lifetime|borrow|tokio)\\b", "内存安全|底层驱动"],
      profileFilename: "rust-kernel.json",
    };

    const baseSettings = {
      ...DEFAULT_SETTINGS_FOR_TEST(),
      specialists: [...BUILTIN_SPECIALISTS, customSpecialist],
    };

    const effective = resolveEffectiveHarnessConfig(baseSettings as any);
    const resolved = findSpecialist(effective, "rust-kernel");
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe("rust-kernel");
    expect(findSpecialist(effective, "rust")?.id).toBe("rust-kernel");

    const targetModel = resolveTargetModelForTier(effective, "codex", "plan");
    expect(targetModel).toBe("plan");
  });

  it("supports dynamic custom model tiers", () => {
    const customTiers = [
      ...BUILTIN_TIERS,
      {
        id: "pro",
        name: "Pro Reasoning",
        icon: "Brain",
        defaultPhase: "design",
        description: "Maximum reasoning effort model tier",
      },
    ];

    const baseSettings = {
      ...DEFAULT_SETTINGS_FOR_TEST(),
      tiers: customTiers,
      providerMappings: {
        claude: {
          plan: "claude-3-7-sonnet",
          pro: "claude-3-7-sonnet-reasoning",
          flash: "claude-3-5-haiku",
          review: "claude-3-7-sonnet",
        },
      },
    };

    const effective = resolveEffectiveHarnessConfig(baseSettings as any);
    expect(effective.tiers.length).toBe(4);
    expect(effective.tiers.find((t) => t.id === "pro")).toBeDefined();

    const target = resolveTargetModelForTier(effective, "claude", "pro");
    expect(target).toBe("claude-3-7-sonnet-reasoning");
  });
});

function DEFAULT_SETTINGS_FOR_TEST() {
  return {
    enabled: true,
    overrideIfDefaultOnly: true,
    debugLogs: false,
    phaseLifecycleEnabled: true,
    planTurnSoftLimit: 3,
    autoDowngradePlanOnExec: true,
    enforceNativePlanMode: true,
    emitTimelineTransitions: true,
    docWhitelistPattern: "\\.(?:md|mdx|txt)$|^openspec\\/",
    affirmativeConfirmWords: ["ok", "继续"],
    profilesDir: "~/.agents/profiles",
    lazyToolProfilesDir: "~/.config/lazy-tool/profiles",
    defaultSkillsRoot: "~/.agents/skills",
    autoSyncDiskProfiles: false,
    autoSyncDaemonAgentProfiles: false,
    enforceSessionMcpFiltering: true,
    mcpServerCatalog: {},
    tiers: BUILTIN_TIERS,
    providerMappings: {
      claude: { plan: "plan", review: "review", flash: "flash" },
    },
    providerModes: {},
    bypassProviders: ["antigravity"],
    honorSpecialistPreferredProvider: true,
    specialists: BUILTIN_SPECIALISTS,
    defaultFallbackRole: "general",
    defaultFallbackTier: "flash",
    enableFullstackOrchestratorCollision: true,
    fullstackUiPattern: "ui",
    fullstackBackendPattern: "db",
    tierPatterns: { plan: [], review: [], execAction: [], conventionalExecPrefix: "" },
    llmFallbackEnabled: false,
    llmFallbackEndpoint: "",
    llmFallbackApiKey: "",
    llmFallbackModel: "lite",
    llmFallbackTimeoutMs: 450,
    llmFallbackApplyRole: true,
    injectSystemPromptBanner: true,
    enforceWorkspaceBoundaryGuardrail: true,
    workspaceBoundaryNotice: "boundary notice",
    phaseRules: {},
    enableRepoConfigOverride: true,
    repoConfigRelativePath: ".paseo/agent-harness.json",
  };
}
