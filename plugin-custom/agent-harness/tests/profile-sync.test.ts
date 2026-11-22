import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  exportSpecialistsToDisk,
  importSpecialistsFromDisk,
  loadRepoHarnessOverride,
  scanDiskProfiles,
  syncDaemonAgentProfiles,
  toKebabCaseIcon,
} from "../server/profile-sync.js";
import { resolveEffectiveHarnessConfig } from "../shared/config-resolver.js";
import { DEFAULT_AGENT_HARNESS_SETTINGS } from "../shared/settings.js";

describe("Agent Harness Profile Sync & Repo Override", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-sync-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("exports specialists to disk as JSON profiles", () => {
    const specialists = DEFAULT_AGENT_HARNESS_SETTINGS.specialists.slice(0, 3);
    const { exported, errors } = exportSpecialistsToDisk(specialists, tmpDir);

    expect(errors.length).toBe(0);
    expect(exported).toBe(3);

    const files = fs.readdirSync(tmpDir);
    expect(files.length).toBe(3);

    const uiFile = path.join(tmpDir, "ui-specialist.json");
    expect(fs.existsSync(uiFile)).toBe(true);

    const content = JSON.parse(fs.readFileSync(uiFile, "utf8"));
    expect(content.name).toBe("ui");
    expect(content.primary_skills).toContain("ui-ux-pro-max");
    expect(content.docs_focus).toContain("docs/design.md");
  });

  it("imports specialists from disk and merges with existing", () => {
    const customProfile = {
      name: "custom-tester",
      description: "Custom test specialist from disk",
      preferred_provider: "codex",
      default_model: "flash",
      primary_skills: ["test-gardener"],
      mcp_servers: ["serena"],
      docs_focus: ["docs/qa.md"],
    };

    fs.writeFileSync(
      path.join(tmpDir, "custom-tester.json"),
      JSON.stringify(customProfile, null, 2),
      "utf8",
    );

    const scanned = scanDiskProfiles(tmpDir);
    expect(scanned.length).toBe(1);
    expect(scanned[0].role).toBe("custom-tester");

    const { specialists, importedCount } = importSpecialistsFromDisk(
      DEFAULT_AGENT_HARNESS_SETTINGS.specialists,
      tmpDir,
    );

    expect(importedCount).toBe(1);
    const imported = specialists.find((s) => s.id === "custom-tester");
    expect(imported).toBeDefined();
    expect(imported?.preferredProvider).toBe("codex");
    expect(imported?.primarySkills).toContain("test-gardener");
  });

  it("loads repo harness override from .paseo/agent-harness.json", () => {
    const paseoDir = path.join(tmpDir, ".paseo");
    fs.mkdirSync(paseoDir, { recursive: true });

    const overrideContent = {
      enabled: true,
      defaultFallbackRole: "backend",
      extraDocsFocus: ["docs/repo-rules.md"],
    };

    fs.writeFileSync(
      path.join(paseoDir, "agent-harness.json"),
      JSON.stringify(overrideContent),
      "utf8",
    );

    const override = loadRepoHarnessOverride(tmpDir);
    expect(override).toBeDefined();
    expect(override?.defaultFallbackRole).toBe("backend");
    expect(override?.extraDocsFocus).toContain("docs/repo-rules.md");
  });

  it("syncs daemon agent profiles preserving user-defined profiles", async () => {
    const existingAgentProfiles = [
      {
        id: "user-profile-1",
        name: "My Custom Claude",
        provider: "claude",
        model: "sonnet",
      },
      {
        id: "harness-old-role",
        name: "Old Role",
        provider: "claude",
        model: "flash",
      },
    ];

    let patchedConfig: any = null;

    const mockPaseo: any = {
      config: {
        get: async () => ({
          requestId: "req-1",
          config: { agentProfiles: existingAgentProfiles },
        }),
        patch: async (patch: any) => {
          patchedConfig = patch;
          return { requestId: "req-2", config: patch };
        },
      },
    };

    const specialistsToSync = [
      DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "ui")!,
      DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "backend")!,
    ];

    const { syncedCount, errors } = await syncDaemonAgentProfiles(mockPaseo, specialistsToSync);

    expect(errors.length).toBe(0);
    expect(syncedCount).toBe(2);
    expect(patchedConfig).toBeDefined();

    const resultProfiles = patchedConfig.agentProfiles;
    // Must preserve user-profile-1
    expect(resultProfiles.some((p: any) => p.id === "user-profile-1")).toBe(true);
    // Must purge harness-old-role that is no longer in specialistsToSync
    expect(resultProfiles.some((p: any) => p.id === "harness-old-role")).toBe(false);
    // Must contain new harness profiles
    expect(resultProfiles.some((p: any) => p.id === "harness-ui")).toBe(true);
    expect(resultProfiles.some((p: any) => p.id === "harness-backend")).toBe(true);
  });

  it("resolves canonical model IDs via providerMappings, normalizes kebab icons, and merges existing role profiles", async () => {
    const existingAgentProfiles = [
      {
        id: "profile_ui_specialist",
        name: "UI Specialist",
        icon: "pencil",
        provider: "claude",
        modeId: "acceptEdits",
        thinkingOptionId: "high",
        model: "flash",
        notes: "role: ui | existing user profile",
      },
      {
        id: "pm",
        name: "PM Specialist",
        icon: "file-text",
        provider: "claude",
        modeId: "plan",
        thinkingOptionId: "max",
        model: "plan",
        harnessManaged: true,
        notes: "role: pm | managed by agent-harness",
      },
      {
        id: "agent_profile_custom_user",
        name: "My Custom Profile",
        provider: "claude",
        model: "sonnet",
        notes: "Standalone profile without role tag",
      },
    ];

    let patchedConfig: any = null;
    const mockPaseo: any = {
      config: {
        get: async () => ({
          requestId: "req-1",
          config: { agentProfiles: existingAgentProfiles },
        }),
        patch: async (patch: any) => {
          patchedConfig = patch;
          return { requestId: "req-2", config: patch };
        },
      },
    };

    const effective = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    const uiSpec = {
      ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "ui")!,
      preferredProvider: "antigravity",
      preferredTier: "flash",
    };
    const pmSpec = DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "pm")!;
    const scoutSpec = DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "scout")!;
    const qaSpec = DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "qa")!;

    const { syncedCount, errors } = await syncDaemonAgentProfiles(
      mockPaseo,
      [uiSpec, pmSpec, scoutSpec, qaSpec],
      effective,
    );

    expect(errors).toEqual([]);
    expect(syncedCount).toBe(4);

    const profiles = patchedConfig.agentProfiles as Array<Record<string, any>>;
    // Should preserve standalone custom profile
    expect(profiles.some((p) => p.id === "agent_profile_custom_user")).toBe(true);

    // Should merge into existing profile_ui_specialist in-place without inheriting stale claude modeId/thinkingOptionId
    const mergedUi = profiles.filter((p) => p.id === "profile_ui_specialist");
    expect(mergedUi).toHaveLength(1);
    expect(mergedUi[0]?.provider).toBe("antigravity");
    expect(mergedUi[0]?.model).toBe("gemini-4-hydrogen-high");
    expect(mergedUi[0]?.modeId).toBeUndefined();
    expect(mergedUi[0]?.thinkingOptionId).toBeUndefined();
    expect(profiles.some((p) => p.id === "harness-ui")).toBe(false);

    // Should not resurrect stale harness-managed modeId="plan" when pm defaultModeId is ""
    const syncedPm = profiles.find((p) => p.id === "pm");
    expect(syncedPm?.modeId).toBeUndefined();
    expect(syncedPm?.thinkingOptionId).toBeUndefined();

    // Pi scout must carry headroom/ prefix
    const scout = profiles.find((p) => p.id === "harness-scout");
    expect(scout?.provider).toBe("pi");
    expect(scout?.model).toBe("headroom/flash");

    // QA icon CheckCircle must be normalized to check-circle
    const qa = profiles.find((p) => p.id === "harness-qa");
    expect(qa?.icon).toBe("check-circle");
    expect(toKebabCaseIcon("ShieldCheck")).toBe("shield-check");
  });
});
