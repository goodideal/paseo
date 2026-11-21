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
} from "../server/profile-sync.js";
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
});
