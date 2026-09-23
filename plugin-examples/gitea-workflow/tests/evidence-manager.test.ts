import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceManager } from "../server/evidence-manager.js";

describe("EvidenceManager", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-evidence-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("ensures .evidence/ is added to .gitignore", async () => {
    await EvidenceManager.ensureGitIgnored(tempDir);
    const gitignore = readFileSync(join(tempDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".evidence/");

    // calling again should not duplicate
    await EvidenceManager.ensureGitIgnored(tempDir);
    const count = gitignore.split(".evidence/").length - 1;
    expect(count).toBe(1);
  });

  it("creates namespaced run directory and saves test matrix atomically", async () => {
    const runDir = EvidenceManager.getRunDir(tempDir, 42, "run-101");
    expect(existsSync(runDir)).toBe(true);

    const matrix = {
      command: "npm test",
      exitCode: 0,
      totalPassed: 1,
      totalFailed: 0,
      durationMs: 120,
      cases: [
        {
          name: "adds numbers",
          input: "1 + 2",
          expected: "3",
          actual: "3",
          status: "PASS" as const,
        },
      ],
    };

    const savedPath = await EvidenceManager.saveTestMatrix(runDir, 42, matrix);
    expect(existsSync(savedPath)).toBe(true);
    expect(existsSync(join(runDir, "..", "latest", "test-matrix.json"))).toBe(true);

    const savedJson = JSON.parse(readFileSync(savedPath, "utf-8"));
    expect(savedJson.totalPassed).toBe(1);
    expect(savedJson.cases[0].name).toBe("adds numbers");
  });

  it("detects UI vs logic tasks based on files and package.json", () => {
    expect(EvidenceManager.detectTaskKind(tempDir, ["src/app.tsx"])).toBe("ui");
    expect(EvidenceManager.detectTaskKind(tempDir, ["src/styles.css"])).toBe("ui");
    expect(EvidenceManager.detectTaskKind(tempDir, ["src/utils/math.ts"])).toBe("logic");
  });
});
