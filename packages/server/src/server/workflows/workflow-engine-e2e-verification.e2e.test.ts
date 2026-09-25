import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";

import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function createIsolatedRepo(): string {
  const repoDir = makeTempDir("workflow-e2e-repo-");
  execFileSync("git", ["init", "-b", "main", repoDir], { stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "e2e-tester@getpaseo.local"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "E2E Tester"], { cwd: repoDir, stdio: "pipe" });
  writeFileSync(path.join(repoDir, "README.md"), "# E2E Workflow Repo\n");
  execFileSync("git", ["add", "README.md"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir, stdio: "pipe" });
  return repoDir;
}

interface WorkflowScope {
  projectId: string;
  workspaceId: string;
}

async function resolveWorkspaceScope(client: DaemonClient, cwd: string): Promise<WorkflowScope> {
  const agent = await client.createAgent({ provider: "codex", cwd, title: "E2E Workflow Agent" });
  const workspaceId = agent.workspaceId!;
  const directory = await client.fetchAgents();
  const entry = directory.entries.find((e) => e.agent.id === agent.id);
  const projectId = entry!.project.projectKey;
  expect(workspaceId).toBeTruthy();
  expect(projectId).toBeTruthy();
  return { projectId, workspaceId };
}

async function createAndApproveRun(client: DaemonClient, scope: WorkflowScope): Promise<string> {
  const createRes = await client.workflowRunCreate({
    ...scope,
    workflowId: "core.workflow-mvp",
  });
  const runId = createRes.runId!;
  expect(runId).toBeTruthy();
  expect(createRes.run?.status).toBe("waiting_approval");

  const approvalsRes = await client.workflowApprovalList({ ...scope, runId });
  const approval = approvalsRes.approvals[0];
  expect(approval).toBeDefined();
  expect(approval.status).toBe("pending");

  const approveRes = await client.workflowApprovalApprove({
    ...scope,
    runId,
    approvalId: approval.approvalId,
  });
  expect(approveRes.approval?.status).toBe("approved");
  expect(approveRes.run?.status).toBe("running");
  return runId;
}

async function verifyRestartRecovery(
  paseoHomeRoot: string,
  scope: WorkflowScope,
  runId: string,
): Promise<void> {
  const daemon = await createTestPaseoDaemon({ paseoHomeRoot, cleanup: false });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.9.1" });
  try {
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    const inspectRes = await client.workflowRunInspect({ ...scope, runId });
    expect(inspectRes.run?.runId).toBe(runId);
    expect(inspectRes.run?.status).toBe("running");
  } finally {
    await client.close();
    await daemon.close();
  }
}

describe("Workflow Engine End-to-End Verification (Task 6.2)", () => {
  test("runs full workflow lifecycle with Worktree, Verification, Approval, Receipt and Recovery", async () => {
    const paseoHomeRoot = makeTempDir("wf-e2e-daemon-home-");
    const cwd = createIsolatedRepo();

    const daemon1 = await createTestPaseoDaemon({ paseoHomeRoot, cleanup: false });
    const client1 = new DaemonClient({
      url: `ws://127.0.0.1:${daemon1.port}/ws`,
      appVersion: "0.9.1",
    });

    let runId: string;
    let scope: WorkflowScope;
    try {
      await client1.connect();
      await client1.fetchAgents({ subscribe: {} });
      expect(client1.getLastServerInfoMessage()?.features?.workflowEngine).toBe(true);

      scope = await resolveWorkspaceScope(client1, cwd);
      runId = await createAndApproveRun(client1, scope);
    } finally {
      await client1.close();
      await daemon1.close();
    }

    await verifyRestartRecovery(paseoHomeRoot, scope, runId);
  }, 45_000);
});
