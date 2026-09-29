import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { IssueRunIndexStore } from "../server/store.js";

describe("IssueRunIndexStore", () => {
  let testFilePath: string;
  let store: IssueRunIndexStore;

  beforeEach(() => {
    testFilePath = join(tmpdir(), `test-issue-index-${Date.now()}-${Math.random()}.json`);
    store = new IssueRunIndexStore(testFilePath);
  });

  afterEach(async () => {
    await rm(testFilePath, { force: true });
  });

  it("records run for issue and detects active run", async () => {
    expect(await store.hasActiveRunForIssue("proj-1", "org", "repo", 42)).toBe(false);

    await store.recordRun({
      projectId: "proj-1",
      repoOwner: "org",
      repoName: "repo",
      issueNumber: 42,
      runId: "run-gitea-42",
    });

    expect(await store.hasActiveRunForIssue("proj-1", "org", "repo", 42)).toBe(true);
    expect(await store.getRunIdForIssue("proj-1", "org", "repo", 42)).toBe("run-gitea-42");
  });

  it("lists entries by project", async () => {
    await store.recordRun({
      projectId: "proj-1",
      repoOwner: "org",
      repoName: "repo",
      issueNumber: 1,
      runId: "run-1",
    });
    await store.recordRun({
      projectId: "proj-2",
      repoOwner: "org",
      repoName: "other",
      issueNumber: 2,
      runId: "run-2",
    });

    const all = await store.listEntries();
    expect(all).toHaveLength(2);

    const proj1 = await store.listEntries("proj-1");
    expect(proj1).toHaveLength(1);
    expect(proj1[0].runId).toBe("run-1");
  });

  it("rebuilds index from workflow runs list", async () => {
    const runs = [
      {
        id: "run-rebuilt-100",
        projectId: "proj-1",
        runInput: {
          repoOwner: "org",
          repoName: "repo",
          issueNumber: 100,
        },
      },
    ];

    await store.rebuildFromRuns(runs);

    expect(await store.hasActiveRunForIssue("proj-1", "org", "repo", 100)).toBe(true);
    expect(await store.getRunIdForIssue("proj-1", "org", "repo", 100)).toBe("run-rebuilt-100");
  });
});
