import { describe, expect, it, vi } from "vitest";
import { registerBuiltInWorkflowStepManifests } from "./core-step-manifests.js";
import { StepAdapterRegistry } from "./step-adapter-registry.js";
import { StepExecutor, type StepExecutorHost } from "./step-executors.js";
import { VerificationProfileRegistry } from "./verification-profiles.js";
import type { WorkflowRun, WorkflowStepAttempt } from "./workflow-models.js";

function makeRun(
  stepId: string,
  adapterType: string,
  overrides: Partial<WorkflowRun> = {},
): WorkflowRun {
  const attempt: WorkflowStepAttempt = {
    id: "attempt_1",
    stepId,
    adapterType,
    adapterVersion: "1",
    status: "ready",
    input: {},
  };
  return {
    id: "run_test_1",
    projectId: "prj_test",
    workspaceId: "wsp_test",
    definitionId: "def_test",
    definitionRevision: "1",
    definitionHash: "a".repeat(64),
    workspaceRoot: "/workspace/repo",
    principalId: "principal_user",
    status: "running",
    createdAt: 1000,
    updatedAt: 1000,
    stepAttempts: [attempt],
    approvals: [],
    artifacts: [],
    intents: [],
    receipts: [],
    leases: [],
    unknownOutcomes: [],
    ...overrides,
  };
}

function setup() {
  const registry = new StepAdapterRegistry();
  registerBuiltInWorkflowStepManifests(registry);
  const profileRegistry = new VerificationProfileRegistry([
    {
      name: "typecheck",
      command: "npm",
      args: ["run", "typecheck"],
      timeoutMs: 30_000,
      allowedCwdScope: "workspace",
    },
  ]);
  const host: StepExecutorHost = {
    createWorktree: vi.fn().mockResolvedValue({ worktreePath: "/worktrees/wsp_test/feat" }),
    checkWorktreeExists: vi.fn().mockResolvedValue(false),
    dispatchAgent: vi
      .fn()
      .mockResolvedValue({ agentId: "agent_1", sessionId: "sess_1", resumable: false }),
    runVerification: vi.fn().mockResolvedValue({ passed: true, report: "all clean" }),
    gitPush: vi.fn().mockResolvedValue({ success: true, commitSha: "abcdef123456" }),
    createPullRequest: vi.fn().mockResolvedValue({ prUrl: "https://forge/pr/42", prNumber: 42 }),
    findPullRequest: vi.fn().mockResolvedValue(null),
  };
  const executor = new StepExecutor(registry, profileRegistry, host);
  return { registry, profileRegistry, host, executor };
}

describe("Workflow Core Step Adapters and Execution Lifecycle", () => {
  it("denies worktree creation when principal lacks workspace.manage permission (3.3)", async () => {
    const { executor } = setup();
    const run = makeRun("worktree_step", "worktree.create");

    // Viewer permissions without workspace.manage
    const viewerPermissions = new Set(["workspace.read" as const]);
    const result = await executor.execute({
      run,
      stepId: "worktree_step",
      attemptId: "attempt_1",
      input: { branch: "feat" },
      principalPermissions: viewerPermissions,
      now: 1050,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Principal lacks required permission");
    expect(result.run.stepAttempts[0].failureClassification).toBe("permission_denied");
  });

  it("creates approval request and elevates P0 findings for external writes (3.3)", async () => {
    const { executor } = setup();
    const run = makeRun("ship_step", "git.create_pr");

    const permissions = new Set(["workspace.write" as const, "workspace.read" as const]);
    const result = await executor.execute({
      run,
      stepId: "ship_step",
      attemptId: "attempt_1",
      input: { title: "Fix issue", branch: "fix-p0" },
      principalPermissions: permissions,
      now: 2000,
      findingSeverity: "P0",
    });

    expect(result.status).toBe("waiting_approval");
    expect(result.run.approvals).toHaveLength(1);
    expect(result.run.approvals[0].reason).toContain("[P0 High Priority]");
    expect(result.run.approvals[0].status).toBe("pending");
  });

  it("records intent before external call and writes receipt on success (3.2 & 3.5)", async () => {
    const { executor, host } = setup();
    const run = makeRun("push_step", "git.push");

    // Pre-approve the attempt
    run.approvals.push({
      id: "appr_1",
      stepId: "push_step",
      attemptId: "attempt_1",
      status: "approved",
      requesterId: "principal_user",
      requestedAt: 2000,
      decidedAt: 2100,
      consumedAt: 2100,
      expiresAt: 5000,
      reason: "approved",
    });

    const permissions = new Set(["workspace.write" as const, "workspace.read" as const]);
    const result = await executor.execute({
      run,
      stepId: "push_step",
      attemptId: "attempt_1",
      input: { remote: "origin", branch: "feat" },
      principalPermissions: permissions,
      now: 2200,
    });

    expect(result.status).toBe("succeeded");
    expect(host.gitPush).toHaveBeenCalledWith({
      cwd: "/workspace/repo",
      remote: "origin",
      branch: "feat",
    });
    expect(result.run.intents).toHaveLength(1);
    expect(result.run.receipts).toHaveLength(1);
    expect(result.run.receipts[0].intentId).toBe(result.run.intents[0].id);
  });

  it("converges to unknown outcome on external call ambiguity to prevent blind duplicate writes (3.2)", async () => {
    const { executor, host } = setup();
    vi.mocked(host.createPullRequest!).mockRejectedValueOnce(
      new Error("Network timeout after sending"),
    );

    const run = makeRun("pr_step", "git.create_pr");
    run.approvals.push({
      id: "appr_1",
      stepId: "pr_step",
      attemptId: "attempt_1",
      status: "approved",
      requesterId: "principal_user",
      requestedAt: 2000,
      decidedAt: 2100,
      consumedAt: 2100,
      expiresAt: 5000,
      reason: "approved",
    });

    const permissions = new Set(["workspace.write" as const, "workspace.read" as const]);
    const result = await executor.execute({
      run,
      stepId: "pr_step",
      attemptId: "attempt_1",
      input: { title: "Fix bug", branch: "bugfix-1" },
      principalPermissions: permissions,
      now: 2500,
    });

    expect(result.status).toBe("unknown");
    expect(result.run.unknownOutcomes).toHaveLength(1);
    expect(result.run.unknownOutcomes[0].reason).toContain("External execution failed ambiguously");
    // Receipt should NOT be written for an unknown failure
    expect(result.run.receipts).toHaveLength(0);
  });

  it("recovers idempotently by inspecting existing PR on retry/resume without duplicate PR creation (3.2)", async () => {
    const { executor, host } = setup();
    // Simulate PR was created before crash, and findPullRequest discovers it
    vi.mocked(host.findPullRequest!).mockResolvedValueOnce({
      prUrl: "https://forge/pr/99",
      prNumber: 99,
    });

    const run = makeRun("pr_step", "git.create_pr");
    run.approvals.push({
      id: "appr_1",
      stepId: "pr_step",
      attemptId: "attempt_1",
      status: "approved",
      requesterId: "principal_user",
      requestedAt: 2000,
      decidedAt: 2100,
      consumedAt: 2100,
      expiresAt: 5000,
      reason: "approved",
    });

    const permissions = new Set(["workspace.write" as const, "workspace.read" as const]);
    const result = await executor.execute({
      run,
      stepId: "pr_step",
      attemptId: "attempt_1",
      input: { title: "Fix bug", branch: "bugfix-1" },
      principalPermissions: permissions,
      now: 3000,
    });

    expect(result.status).toBe("succeeded");
    expect(host.findPullRequest).toHaveBeenCalledWith({
      cwd: "/workspace/repo",
      branch: "bugfix-1",
    });
    // createPullRequest was NOT called because existing PR was found!
    expect(host.createPullRequest).not.toHaveBeenCalled();
    expect(result.declaredOutputs).toEqual({ url: "https://forge/pr/99", prNumber: 99 });
    expect(result.run.receipts).toHaveLength(1);
  });

  it("rejects unregistered verification profiles and raw shell commands (3.4 & 3.5)", async () => {
    const { executor } = setup();
    const run = makeRun("verify_step", "verify.command");
    const permissions = new Set(["workspace.read" as const]);

    const result = await executor.execute({
      run,
      stepId: "verify_step",
      attemptId: "attempt_1",
      input: { verificationProfile: "malicious-raw-shell" },
      principalPermissions: permissions,
      now: 1000,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Unregistered verification profile: malicious-raw-shell");
  });

  it("executes valid verification profile and captures output report (3.4 & 3.5)", async () => {
    const { executor, host } = setup();
    const run = makeRun("verify_step", "verify.command");
    const permissions = new Set(["workspace.read" as const]);

    const result = await executor.execute({
      run,
      stepId: "verify_step",
      attemptId: "attempt_1",
      input: { verificationProfile: "typecheck" },
      principalPermissions: permissions,
      now: 1000,
    });

    expect(result.status).toBe("succeeded");
    expect(host.runVerification).toHaveBeenCalledWith({
      profile: expect.objectContaining({ name: "typecheck" }),
      cwd: "/workspace/repo",
    });
    expect(result.declaredOutputs).toEqual({ passed: true, report: "all clean" });
  });

  it("records non-resumable provider sessions faithfully without fake resumption (3.4 & 3.5)", async () => {
    const { executor, host } = setup();
    const run = makeRun("agent_step", "agent.dispatch");
    const permissions = new Set(["workspace.write" as const]);

    const result = await executor.execute({
      run,
      stepId: "agent_step",
      attemptId: "attempt_1",
      input: { promptId: "fix-bug" },
      principalPermissions: permissions,
      now: 1000,
    });

    expect(result.status).toBe("succeeded");
    expect(host.dispatchAgent).toHaveBeenCalledWith({
      cwd: "/workspace/repo",
      promptId: "fix-bug",
      provider: undefined,
    });
    expect(result.declaredOutputs).toMatchObject({
      agentId: "agent_1",
      sessionId: "sess_1",
      resumable: false,
    });
  });
});
