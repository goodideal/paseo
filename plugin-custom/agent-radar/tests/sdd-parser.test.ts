import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { parseSuperpowerStatus } from "../server/sdd-parser.js";

describe("sdd-parser", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sdd-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no plans or sdd directory exists", async () => {
    const status = await parseSuperpowerStatus(tmpDir);
    expect(status).toBeNull();
  });

  it("parses tasks from a plan markdown file", async () => {
    const planDir = path.join(tmpDir, "docs", "superpowers", "plans");
    await fs.mkdir(planDir, { recursive: true });

    const planContent = `# Feature Foo Implementation Plan

### Task 1: Setup scaffolding
- [x] Step 1
- [x] Step 2

### Task 2: Implement core logic
- [x] Step 1
- [ ] Step 2

### Task 3: Add test coverage
- [ ] Step 1
`;
    await fs.writeFile(path.join(planDir, "2026-09-26-feature-foo.md"), planContent, "utf-8");

    const status = await parseSuperpowerStatus(tmpDir);
    expect(status).not.toBeNull();
    expect(status?.planSlug).toBe("2026-09-26-feature-foo");
    expect(status?.tasks).toHaveLength(3);
    expect(status?.tasks[0].title).toBe("Setup scaffolding");
    expect(status?.tasks[0].status).toBe("completed");
    expect(status?.tasks[1].title).toBe("Implement core logic");
    expect(status?.tasks[1].status).toBe("running");
    expect(status?.tasks[2].title).toBe("Add test coverage");
    expect(status?.tasks[2].status).toBe("pending");
    expect(status?.currentTaskId).toBe("task-2");
  });

  it("enhances task status with ledger.md (rounds, commits, rulings)", async () => {
    const planDir = path.join(tmpDir, "docs", "superpowers", "plans");
    await fs.mkdir(planDir, { recursive: true });
    await fs.writeFile(
      path.join(planDir, "sdd-flow.md"),
      `### Task 1: Auth Module\n- [ ] Step 1\n\n### Task 2: Profile Sync\n- [ ] Step 1`,
      "utf-8",
    );

    const sddDir = path.join(tmpDir, ".superpowers", "sdd", "sdd-flow");
    await fs.mkdir(sddDir, { recursive: true });

    const ledgerContent = `
Task 1: complete (commits abc1234..def5678, review clean)
Ruling: Use JWT over session cookies — stateless requirement — rework auth if wrong
Task 2: fix round 3/5 (1 addressed, 1 open; commits def5678..aaa9999)
`;
    await fs.writeFile(path.join(sddDir, "ledger.md"), ledgerContent, "utf-8");

    const status = await parseSuperpowerStatus(tmpDir);
    expect(status).not.toBeNull();
    expect(status?.tasks[0].status).toBe("completed");
    expect(status?.tasks[0].commits).toContain("abc1234");
    expect(status?.tasks[0].rulings?.[0]).toContain("Ruling: Use JWT");

    expect(status?.tasks[1].status).toBe("fixing");
    expect(status?.tasks[1].currentRound).toBe(3);
    expect(status?.tasks[1].maxRounds).toBe(5);
    expect(status?.currentTaskId).toBe("task-2");
  });
});
