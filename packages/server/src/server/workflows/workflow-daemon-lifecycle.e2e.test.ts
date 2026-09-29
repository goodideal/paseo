import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

function createGitRepo(): string {
  const repoDir = makeTempDir("workflow-repo-");
  execFileSync("git", ["init", "-b", "main", repoDir], { stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@getpaseo.local"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "Paseo Tester"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["commit", "--allow-empty", "-m", "initial commit"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  return repoDir;
}

describe("Workflow Engine daemon bootstrap and restart lifecycle", () => {
  test("creates a run with stable runId, survives daemon restart, and reads persisted state", async () => {
    const paseoHomeRoot = makeTempDir("workflow-daemon-home-");
    const cwd = createGitRepo();

    // 1. Boot first daemon instance
    const daemon1 = await createTestPaseoDaemon({
      paseoHomeRoot,
      cleanup: false,
    });
    const client1 = new DaemonClient({
      url: `ws://127.0.0.1:${daemon1.port}/ws`,
      appVersion: "0.9.1",
    });
    await client1.connect();
    await client1.fetchAgents({ subscribe: {} });

    expect(client1.getLastServerInfoMessage()?.features?.workflowEngine).toBe(true);

    const agent = await client1.createAgent({
      provider: "codex",
      cwd,
      title: "Workflow Agent",
    });
    const workspaceId = agent.workspaceId;
    expect(workspaceId).toBeTruthy();

    const agentsDirectory = await client1.fetchAgents();
    const entry = agentsDirectory.entries.find((item) => item.agent.id === agent.id);
    expect(entry).toBeDefined();
    const projectId = entry!.project.projectKey;
    expect(projectId).toBeTruthy();

    const createResult = await client1.workflowRunCreate({
      projectId,
      workspaceId: workspaceId!,
      workflowId: "core.workflow-mvp",
    });

    expect(createResult.error).toBeNull();
    expect(createResult.runId).toBeTruthy();
    expect(createResult.run?.runId).toBe(createResult.runId);
    expect(createResult.run?.status).toBe("waiting_approval");

    const createdRunId = createResult.runId!;

    await client1.close();
    await daemon1.close();

    // 2. Boot second daemon instance reusing the same paseoHomeRoot
    const daemon2 = await createTestPaseoDaemon({
      paseoHomeRoot,
      cleanup: false,
    });
    const client2 = new DaemonClient({
      url: `ws://127.0.0.1:${daemon2.port}/ws`,
      appVersion: "0.9.1",
    });
    await client2.connect();
    await client2.fetchAgents({ subscribe: {} });

    const inspectResult = await client2.workflowRunInspect({
      projectId,
      workspaceId: workspaceId!,
      runId: createdRunId,
    });

    expect(inspectResult.error).toBeNull();
    expect(inspectResult.run?.runId).toBe(createdRunId);
    expect(inspectResult.run?.status).toBe("waiting_approval");

    const listResult = await client2.workflowRunList({
      projectId,
      workspaceId: workspaceId!,
    });
    expect(listResult.error).toBeNull();
    expect(listResult.runs.some((run) => run.runId === createdRunId)).toBe(true);

    await client2.close();
    await daemon2.close();
  }, 30_000);

  test("runs interactive workflow with question interaction, response continuation and recovery", async () => {
    const paseoHomeRoot = makeTempDir("workflow-interactive-home-");
    const cwd = createGitRepo();

    const daemon = await createTestPaseoDaemon({ paseoHomeRoot, cleanup: true });
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.9.1",
    });
    try {
      await client.connect();
      await client.fetchAgents({ subscribe: {} });
      expect(client.getLastServerInfoMessage()?.features?.workflowInteractions).toBe(true);

      const agent = await client.createAgent({
        provider: "codex",
        cwd,
        title: "Interactive Agent",
      });
      const workspaceId = agent.workspaceId!;
      const agentsDirectory = await client.fetchAgents();
      const entry = agentsDirectory.entries.find((item) => item.agent.id === agent.id);
      const projectId = entry!.project.projectKey;

      const createResult = await client.workflowRunCreate({
        projectId,
        workspaceId,
        workflowId: "core.workflow-interactive",
      });

      expect(createResult.error).toBeNull();
      const runId = createResult.runId!;
      expect(runId).toBeTruthy();

      // Poll until background driveRun creates the pending interaction
      let interactionId: string | undefined;
      for (let i = 0; i < 30; i++) {
        const inspect = await client.workflowRunInspect({
          projectId,
          workspaceId,
          runId,
        });
        if (inspect.run?.pendingInteraction) {
          interactionId = inspect.run.pendingInteraction.id;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(interactionId).toBeDefined();

      // Respond to interaction
      const respondResult = await client.workflowInteractionRespond({
        projectId,
        workspaceId,
        runId,
        interactionId: interactionId!,
        answer: "继续生成计划",
      });
      expect(respondResult.error).toBeNull();
      expect(respondResult.interaction?.status).toBe("answered");

      // Verify that after answering, the step advances to confirm (waiting_approval)
      let currentStepId: string | null = null;
      let runStatus: string | null = null;
      for (let i = 0; i < 30; i++) {
        const inspect = await client.workflowRunInspect({
          projectId,
          workspaceId,
          runId,
        });
        if (inspect.run?.status === "waiting_approval") {
          currentStepId = inspect.run.currentStepId;
          runStatus = inspect.run.status;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(runStatus).toBe("waiting_approval");
      expect(currentStepId).toBe("confirm");
    } finally {
      await client.close();
      await daemon.close();
    }
  }, 30_000);
});
