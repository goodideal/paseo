import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { WorkflowDefinition } from "./definition-compiler.js";
import { WorkflowService } from "./workflow-service.js";
import { StepAdapterRegistry } from "./step-adapter-registry.js";
import { WorkflowStore } from "./workflow-store.js";
import {
  DeliveryApprovalManifestSchema,
  WorkflowInteractionSchema,
  type WorkflowRun,
} from "./workflow-models.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeRegistry(): StepAdapterRegistry {
  const registry = new StepAdapterRegistry();
  registry.registerCore({
    type: "git.create_pr",
    version: "1.0.0",
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ url: z.string() }).strict(),
    executionRisk: "external_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "required",
    cancellation: "best_effort",
    recovery: "inspect_before_retry",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "workspace:{{workspaceId}}:branch:{{branch}}",
  });
  return registry;
}

function makeDefinition(): WorkflowDefinition {
  return {
    id: "repair",
    revision: "revision_1",
    maxConcurrency: 1,
    maxArtifactBytes: 1024,
    steps: [
      {
        id: "ship",
        type: "git.create_pr",
        timeoutMs: 1_000,
        retries: 0,
        concurrency: 1,
        approval: "required",
      },
    ],
  };
}

describe("WorkflowService", () => {
  it("persists a scope-bound approval workflow and exposes lifecycle actions", () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-workflow-service-"));
    temporaryDirectories.push(paseoHome);
    const registry = makeRegistry();
    const service = new WorkflowService({
      store: new WorkflowStore({ paseoHome }),
      registry,
      now: () => 100,
      createId: (kind) => `${kind}_0000000000000001`,
    });
    const scope = { projectId: "prj_1", workspaceId: "wsp_1" };

    const created = service.create({
      ...scope,
      principalId: "principal_1",
      workspaceRoot: "/repo",
      definition: makeDefinition(),
    });
    expect(created.status).toBe("waiting_approval");
    expect(created.approvals).toHaveLength(1);
    expect(service.list(scope)).toEqual([created]);
    expect(service.inspect({ ...scope, runId: created.id })).toEqual(created);

    const approved = service.respondApproval({
      ...scope,
      runId: created.id,
      approvalId: created.approvals[0].id,
      approverId: "principal_2",
      decision: "approved",
    });
    expect(approved.status).toBe("running");
    expect(approved.stepAttempts.at(-1)).toMatchObject({ status: "ready" });

    const cancelled = service.cancel({ ...scope, runId: created.id });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.stepAttempts.at(-1)).toMatchObject({ status: "cancelled" });

    const resumed = service.resume({ ...scope, runId: created.id });
    expect(resumed.status).toBe("running");
    expect(resumed.stepAttempts.at(-1)).toMatchObject({ status: "ready" });

    const retried = service.retry({ ...scope, runId: created.id, stepId: "ship" });
    expect(retried.status).toBe("waiting_approval");
    expect(retried.stepAttempts).toHaveLength(2);
    expect(retried.approvals).toHaveLength(2);
  });

  it("rejects approval decisions outside the run scope and consumes each approval once", () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-workflow-service-"));
    temporaryDirectories.push(paseoHome);
    const service = new WorkflowService({
      store: new WorkflowStore({ paseoHome }),
      registry: makeRegistry(),
      now: () => 100,
      createId: (kind) => `${kind}_0000000000000002`,
    });
    const scope = { projectId: "prj_1", workspaceId: "wsp_1" };
    const created = service.create({
      ...scope,
      principalId: "principal_1",
      workspaceRoot: "/repo",
      definition: makeDefinition(),
    });

    expect(() =>
      service.respondApproval({
        projectId: scope.projectId,
        workspaceId: "wsp_other",
        runId: created.id,
        approvalId: created.approvals[0].id,
        approverId: "principal_2",
        decision: "approved",
      }),
    ).toThrow("not found in scope");

    service.respondApproval({
      ...scope,
      runId: created.id,
      approvalId: created.approvals[0].id,
      approverId: "principal_2",
      decision: "denied",
      denialReason: "Not now",
    });
    expect(() =>
      service.respondApproval({
        ...scope,
        runId: created.id,
        approvalId: created.approvals[0].id,
        approverId: "principal_2",
        decision: "approved",
      }),
    ).toThrow("is not pending");
  });

  it("persists pending interactions, answer artifacts, and delivery approval manifests", () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-workflow-models-"));
    temporaryDirectories.push(paseoHome);
    const store = new WorkflowStore({ paseoHome });

    const validInteraction = {
      id: "interaction_000000000001",
      runId: "run_0000000000000001",
      stepId: "design-input",
      status: "pending" as const,
      promptArtifactId: "artifact_question_01",
      requestedAt: 100,
    };
    expect(WorkflowInteractionSchema.parse(validInteraction)).toMatchObject({ status: "pending" });

    expect(() =>
      WorkflowInteractionSchema.parse({
        id: "interaction_000000000002",
        stepId: "design-input",
        status: "pending",
        promptArtifactId: "artifact_question_02",
        requestedAt: 100,
      }),
    ).toThrow();

    expect(() =>
      WorkflowInteractionSchema.parse({
        id: "interaction_000000000003",
        runId: "run_0000000000000001",
        stepId: "design-input",
        status: "pending",
        requestedAt: 100,
      }),
    ).toThrow();

    const validManifest = {
      sourceBranch: "agent/42",
      targetBranch: "main",
      commitSha: "c0ffee1234567890abcdef1234567890abcdef12",
      pullRequestTitle: "feat: interactive workflow core",
      pullRequestBodyDigest: "a".repeat(64),
      issueReference: "#42",
    };
    expect(DeliveryApprovalManifestSchema.parse(validManifest)).toEqual(validManifest);

    expect(() =>
      DeliveryApprovalManifestSchema.parse({
        sourceBranch: "agent/42",
        targetBranch: "main",
      }),
    ).toThrow();

    const run: WorkflowRun = {
      id: "run_0000000000000001",
      projectId: "prj_1",
      workspaceId: "wsp_1",
      definitionId: "interactive-feature",
      definitionRevision: "rev_1",
      definitionHash: "b".repeat(64),
      workspaceRoot: "/repo",
      principalId: "principal_1",
      status: "waiting_approval",
      createdAt: 100,
      updatedAt: 100,
      stepAttempts: [],
      approvals: [],
      artifacts: [
        {
          id: "artifact_answer_0001",
          kind: "interaction_answer",
          path: "artifacts/answer.txt",
          contentHash: "c".repeat(64),
          bytes: 42,
          redacted: true,
          createdAt: 101,
        },
      ],
      intents: [],
      receipts: [],
      leases: [],
      unknownOutcomes: [],
      interactions: [
        {
          ...validInteraction,
          answerArtifactId: "artifact_answer_0001",
          answeredAt: 105,
          responderId: "principal_user",
        },
      ],
      deliveryApprovalManifest: validManifest,
    };

    store.create(run);
    const reloaded = store.get({
      projectId: run.projectId,
      workspaceId: run.workspaceId,
      runId: run.id,
    });
    expect(reloaded).toEqual(run);
    expect(reloaded?.interactions).toHaveLength(1);
    expect(reloaded?.interactions[0]).toMatchObject({
      id: "interaction_000000000001",
      answerArtifactId: "artifact_answer_0001",
    });
    expect(reloaded?.deliveryApprovalManifest).toEqual(validManifest);
  });

  it("handles interaction lifecycle: creation, redaction, and prevents duplicate response", async () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-workflow-service-interaction-"));
    temporaryDirectories.push(paseoHome);
    const registry = makeRegistry();
    let idCounter = 0;
    const service = new WorkflowService({
      store: new WorkflowStore({ paseoHome }),
      registry,
      now: () => 1000 + idCounter,
      createId: (kind) => `${kind}_${(++idCounter).toString().padStart(16, "0")}`,
    });
    const scope = { projectId: "project_1", workspaceId: "workspace_1" };

    const run = service.create({
      ...scope,
      principalId: "principal_1",
      workspaceRoot: "/repo",
      definition: makeDefinition(),
    });

    const runWithInteraction = await service.createInteraction({
      ...scope,
      runId: run.id,
      stepId: "ship",
      promptArtifactId: "artifact_prompt_0001",
    });
    expect(runWithInteraction.interactions).toHaveLength(1);
    const interactionId = runWithInteraction.interactions[0].id;
    expect(runWithInteraction.interactions[0]).toMatchObject({
      id: interactionId,
      stepId: "ship",
      status: "pending",
      promptArtifactId: "artifact_prompt_0001",
    });

    const sensitiveAnswer =
      "请继续写 spec，密钥是 sk-ant-api03-abcdef12345678901234567890，请注意保管";
    const answeredRun = await service.respondInteraction({
      ...scope,
      runId: run.id,
      interactionId,
      responderId: "principal_1",
      answer: sensitiveAnswer,
    });

    expect(answeredRun.interactions[0]?.status).toBe("answered");
    expect(answeredRun.interactions[0]?.responderId).toBe("principal_1");
    expect(answeredRun.interactions[0]?.answerArtifactId).toBeDefined();

    // Verify artifact was created, redacted, and appended
    const answerArtifact = answeredRun.artifacts.find(
      (art) => art.id === answeredRun.interactions[0].answerArtifactId,
    );
    expect(answerArtifact).toBeDefined();
    expect(answerArtifact?.kind).toBe("interaction_answer");
    expect(answerArtifact?.redacted).toBe(true);
    expect(answeredRun.artifacts).toHaveLength(1);

    // Duplicate response must throw error indicating already answered
    await expect(
      service.respondInteraction({
        ...scope,
        runId: run.id,
        interactionId,
        responderId: "principal_1",
        answer: "第二次回答",
      }),
    ).rejects.toThrow("already answered");

    // Ensure no second artifact was created
    const finalRun = service.inspect({ ...scope, runId: run.id });
    expect(finalRun.artifacts).toHaveLength(1);
  });

  it("rejects interaction response with wrong scope, expired interaction, or cancelled run", async () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-workflow-service-errors-"));
    temporaryDirectories.push(paseoHome);
    const registry = makeRegistry();
    let idCounter = 0;
    const service = new WorkflowService({
      store: new WorkflowStore({ paseoHome }),
      registry,
      now: () => 2000 + idCounter,
      createId: (kind) => `${kind}_${(++idCounter).toString().padStart(16, "0")}`,
    });
    const scope = { projectId: "project_1", workspaceId: "workspace_1" };

    const run = service.create({
      ...scope,
      principalId: "principal_1",
      workspaceRoot: "/repo",
      definition: makeDefinition(),
    });

    const runWithInteraction = await service.createInteraction({
      ...scope,
      runId: run.id,
      stepId: "ship",
      promptArtifactId: "artifact_prompt_0001",
    });
    const interactionId = runWithInteraction.interactions[0].id;

    // Wrong scope throws not found in scope
    await expect(
      service.respondInteraction({
        projectId: "project_1",
        workspaceId: "workspace_other",
        runId: run.id,
        interactionId,
        responderId: "principal_1",
        answer: "回答",
      }),
    ).rejects.toThrow("not found in scope");

    // Expire interaction
    const expiredRun = await service.expireInteraction({
      ...scope,
      runId: run.id,
      interactionId,
    });
    expect(expiredRun.interactions[0]?.status).toBe("expired");

    // Answering expired interaction throws
    await expect(
      service.respondInteraction({
        ...scope,
        runId: run.id,
        interactionId,
        responderId: "principal_1",
        answer: "回答已过期交互",
      }),
    ).rejects.toThrow("is not pending");

    // Create a new run with pending interaction, then cancel the run
    const runForCancel = service.create({
      ...scope,
      principalId: "principal_1",
      workspaceRoot: "/repo",
      definition: makeDefinition(),
    });

    const run2 = await service.createInteraction({
      ...scope,
      runId: runForCancel.id,
      stepId: "ship",
      promptArtifactId: "artifact_prompt_0002",
    });
    const interaction2 = run2.interactions.find(
      (i) => i.promptArtifactId === "artifact_prompt_0002",
    )!;
    expect(interaction2.status).toBe("pending");

    const cancelledRun = service.cancel({ ...scope, runId: runForCancel.id });
    const cancelledInteraction = cancelledRun.interactions.find((i) => i.id === interaction2.id);
    expect(cancelledInteraction?.status).toBe("cancelled");

    await expect(
      service.respondInteraction({
        ...scope,
        runId: runForCancel.id,
        interactionId: interaction2.id,
        responderId: "principal_1",
        answer: "回答已取消的交互",
      }),
    ).rejects.toThrow("is not pending");
  });

  it("approves delivery matching manifest digest and rejects drifted manifest", async () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-workflow-service-delivery-"));
    temporaryDirectories.push(paseoHome);
    const registry = makeRegistry();
    const store = new WorkflowStore({ paseoHome });
    const service = new WorkflowService({
      store,
      registry,
      now: () => 3000,
      createId: (kind) => `${kind}_delivery_0001`,
    });
    const scope = { projectId: "project_1", workspaceId: "workspace_1" };
    const { createHash } = await import("node:crypto");

    const validHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const manifest = {
      sourceBranch: "agent/issue-42-feat",
      targetBranch: "main",
      commitSha: validHash,
      pullRequestTitle: "feat: add feature",
      pullRequestBodyDigest: validHash,
      issueReference: "42",
    };
    const manifestDigest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

    const run = service.create({
      ...scope,
      principalId: "principal_1",
      workspaceRoot: "/repo",
      definition: makeDefinition(),
    });

    // 为 run 设置 deliveryApprovalManifest
    store.update({ ...scope, runId: run.id }, (current) => ({
      ...current,
      deliveryApprovalManifest: manifest,
      status: "waiting_approval",
      approvals: [
        {
          id: "approval_delivery_1",
          stepId: "ship",
          attemptId: "attempt_ship_1",
          status: "pending",
          requesterId: "principal_1",
          requestedAt: 3000,
          expiresAt: 5000,
          reason: "Approval required for external_write",
        },
      ],
      stepAttempts: [
        {
          id: "attempt_ship_1",
          stepId: "ship",
          adapterType: "git.push",
          adapterVersion: "1.0.0",
          status: "waiting_approval",
          input: {},
        },
      ],
    }));

    // 1. 如果传入错误的 manifestDigest，必须被拒绝报错
    expect(() =>
      service.approveDelivery({
        ...scope,
        runId: run.id,
        approvalId: "approval_delivery_1",
        approverId: "approver_1",
        manifestDigest: "bad_digest_000000000000000000000000000000000000000000000000000000000",
      }),
    ).toThrow("drifted or does not match");

    // 2. 传入匹配的 manifestDigest，批准成功
    const approvedRun = service.approveDelivery({
      ...scope,
      runId: run.id,
      approvalId: "approval_delivery_1",
      approverId: "approver_1",
      manifestDigest,
    });
    expect(approvedRun.approvals[0].status).toBe("approved");
    expect(approvedRun.approvals[0].manifestDigest).toBe(manifestDigest);
  });
});
