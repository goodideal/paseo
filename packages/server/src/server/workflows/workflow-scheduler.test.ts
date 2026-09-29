import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { WorkflowDefinition } from "./definition-compiler.js";
import { scheduleWorkflow } from "./workflow-scheduler.js";
import { StepAdapterRegistry } from "./step-adapter-registry.js";
import type { WorkflowRun } from "./workflow-models.js";

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run_1",
    projectId: "prj_1",
    workspaceId: "wsp_1",
    definitionId: "definition",
    definitionRevision: "revision",
    definitionHash: "a".repeat(64),
    workspaceRoot: "/repo",
    principalId: "principal",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    stepAttempts: [],
    approvals: [],
    artifacts: [],
    intents: [],
    receipts: [],
    leases: [],
    unknownOutcomes: [],
    interactions: [],
    ...overrides,
  };
}

function makeRegistry(): StepAdapterRegistry {
  const registry = new StepAdapterRegistry();
  registry.registerCore({
    type: "workspace.branch_write",
    version: "1.0.0",
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({}).strict(),
    executionRisk: "workspace_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "required",
    cancellation: "supported",
    recovery: "resumable",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "workspace:{{workspaceId}}:branch:{{branch}}",
  });
  registry.registerCore({
    type: "workspace.read_only",
    version: "1.0.0",
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ passed: z.boolean() }).strict(),
    executionRisk: "read",
    requiredPermissions: ["workspace.read"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "supported",
    recovery: "resumable",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "workspace:{{workspaceId}}:read:{{stepId}}",
  });
  return registry;
}

function makeDefinition(): WorkflowDefinition {
  return {
    id: "definition",
    revision: "revision",
    maxConcurrency: 2,
    maxArtifactBytes: 1024,
    steps: [
      {
        id: "first",
        type: "workspace.read_only",
        timeoutMs: 1000,
        retries: 0,
        concurrency: 1,
        approval: "automatic",
      },
      {
        id: "second",
        type: "workspace.read_only",
        timeoutMs: 1000,
        retries: 0,
        concurrency: 1,
        approval: "automatic",
      },
      {
        id: "conditional",
        type: "workspace.read_only",
        dependsOn: ["first"],
        when: "steps.first.outputs.passed == true",
        timeoutMs: 1000,
        retries: 0,
        concurrency: 1,
        approval: "automatic",
      },
    ],
  };
}

describe("scheduleWorkflow", () => {
  it("makes independent steps ready and skips a false conditional step with a reason", () => {
    const definition = makeDefinition();
    const initial = scheduleWorkflow(makeRun(), definition, 2).run;
    expect(initial.stepAttempts).toEqual([
      expect.objectContaining({ stepId: "first", status: "ready" }),
      expect.objectContaining({ stepId: "second", status: "ready" }),
    ]);

    const stepAttempts = initial.stepAttempts.map((attempt) => {
      if (attempt.stepId !== "first") return attempt;
      return Object.assign({}, attempt, {
        status: "succeeded" as const,
        declaredOutputs: { passed: false },
      });
    });
    const withFirstOutput: WorkflowRun = Object.assign({}, initial, { stepAttempts });
    const scheduled = scheduleWorkflow(withFirstOutput, definition, 3).run;
    expect(scheduled.stepAttempts).toContainEqual(
      expect.objectContaining({
        stepId: "conditional",
        status: "skipped",
        skipReason: "Condition evaluated to false",
      }),
    );
  });

  it("does not release dependents after a failed dependency or report the run succeeded", () => {
    const definition = makeDefinition();
    const run: WorkflowRun = {
      ...makeRun(),
      stepAttempts: [
        {
          id: "attempt_first_1",
          stepId: "first",
          adapterType: "workspace.read_only",
          adapterVersion: "1",
          status: "failed",
          input: {},
        },
      ],
    };

    const result = scheduleWorkflow(run, definition, 2).run;
    expect(result.status).toBe("failed");
    expect(result.stepAttempts.some((attempt) => attempt.stepId === "conditional")).toBe(false);
  });

  it("serializes steps with the same resourceConflictKey while allowing distinct resources in parallel", () => {
    const registry = makeRegistry();
    const conflictingDefinition: WorkflowDefinition = {
      id: "conflict-def",
      revision: "rev1",
      maxConcurrency: 4,
      maxArtifactBytes: 1024,
      steps: [
        {
          id: "write_1",
          type: "workspace.branch_write",
          timeoutMs: 1000,
          retries: 0,
          concurrency: 1,
          approval: "automatic",
        },
        {
          id: "write_2",
          type: "workspace.branch_write",
          timeoutMs: 1000,
          retries: 0,
          concurrency: 1,
          approval: "automatic",
        },
      ],
    };

    // Both steps have no dependsOn, but share resourceConflictKey workspace:wsp_1:branch:main
    const scheduled = scheduleWorkflow(makeRun(), conflictingDefinition, 10, { registry }).run;
    const readyAttempts = scheduled.stepAttempts.filter((a) => a.status === "ready");
    // Only write_1 is scheduled ready; write_2 is held back because of conflict
    expect(readyAttempts).toHaveLength(1);
    expect(readyAttempts[0].stepId).toBe("write_1");

    // Once write_1 succeeds, write_2 is scheduled
    const afterSuccess: WorkflowRun = {
      ...scheduled,
      stepAttempts: scheduled.stepAttempts.map((a) =>
        a.stepId === "write_1" ? Object.assign({}, a, { status: "succeeded" as const }) : a,
      ),
    };
    const nextScheduled = scheduleWorkflow(afterSuccess, conflictingDefinition, 20, {
      registry,
    }).run;
    expect(
      nextScheduled.stepAttempts.some((a) => a.stepId === "write_2" && a.status === "ready"),
    ).toBe(true);
  });

  it("attaches daemon-owned leases and respects cancelled run status", () => {
    const registry = makeRegistry();
    const definition = makeDefinition();
    const scheduled = scheduleWorkflow(makeRun(), definition, 100, {
      registry,
      leaseHolder: "daemon_instance_1",
      leaseTtlMs: 5000,
    }).run;

    expect(scheduled.leases.length).toBeGreaterThan(0);
    expect(scheduled.leases[0]).toMatchObject({
      holder: "daemon_instance_1",
      expiresAt: 5100,
    });

    // Cancelled run does not schedule any new steps
    const cancelledRun: WorkflowRun = { ...scheduled, status: "cancelled" };
    const afterCancel = scheduleWorkflow(cancelledRun, definition, 200, { registry });
    expect(afterCancel.hasReadyStep).toBe(false);
    expect(afterCancel.run.stepAttempts.length).toBe(scheduled.stepAttempts.length);
  });

  it("holds dependent steps while interaction is pending and readies only the answered continuation", () => {
    const definition: WorkflowDefinition = {
      id: "interactive_def",
      revision: "rev1",
      maxConcurrency: 2,
      maxArtifactBytes: 1024,
      steps: [
        {
          id: "step_input_1",
          type: "interaction.wait",
          timeoutMs: 1000,
          retries: 0,
          concurrency: 1,
          approval: "automatic",
        },
        {
          id: "step_input_2",
          type: "interaction.wait",
          timeoutMs: 1000,
          retries: 0,
          concurrency: 1,
          approval: "automatic",
        },
        {
          id: "continuation_1",
          type: "workspace.read_only",
          dependsOn: ["step_input_1"],
          timeoutMs: 1000,
          retries: 0,
          concurrency: 1,
          approval: "automatic",
        },
        {
          id: "continuation_2",
          type: "workspace.read_only",
          dependsOn: ["step_input_2"],
          timeoutMs: 1000,
          retries: 0,
          concurrency: 1,
          approval: "automatic",
        },
      ],
    };

    const runWithPending = makeRun({
      stepAttempts: [
        {
          id: "attempt_input_1",
          stepId: "step_input_1",
          adapterType: "interaction.wait",
          adapterVersion: "1.0.0",
          status: "running",
          input: {},
        },
        {
          id: "attempt_input_2",
          stepId: "step_input_2",
          adapterType: "interaction.wait",
          adapterVersion: "1.0.0",
          status: "running",
          input: {},
        },
      ],
      interactions: [
        {
          id: "interaction_1",
          runId: "run_1",
          stepId: "step_input_1",
          status: "pending",
          promptArtifactId: "prompt_artifact_1",
          requestedAt: 100,
        },
        {
          id: "interaction_2",
          runId: "run_1",
          stepId: "step_input_2",
          status: "pending",
          promptArtifactId: "prompt_artifact_2",
          requestedAt: 100,
        },
      ],
    });

    const scheduledPending = scheduleWorkflow(runWithPending, definition, 100).run;
    // Neither continuation_1 nor continuation_2 is ready while their interactions are pending
    expect(scheduledPending.stepAttempts.some((a) => a.stepId === "continuation_1")).toBe(false);
    expect(scheduledPending.stepAttempts.some((a) => a.stepId === "continuation_2")).toBe(false);

    // Now answer interaction_1 ONLY
    const runWithFirstAnswered: WorkflowRun = {
      ...runWithPending,
      interactions: [
        {
          ...runWithPending.interactions[0],
          status: "answered",
          answerArtifactId: "answer_artifact_1",
          answeredAt: 200,
          responderId: "user_1",
        },
        runWithPending.interactions[1], // interaction_2 remains pending
      ],
    };

    const scheduledAnswered = scheduleWorkflow(runWithFirstAnswered, definition, 200).run;
    // continuation_1 should now be scheduled and ready!
    expect(
      scheduledAnswered.stepAttempts.some(
        (a) => a.stepId === "continuation_1" && a.status === "ready",
      ),
    ).toBe(true);
    // continuation_2 MUST NOT be ready!
    expect(scheduledAnswered.stepAttempts.some((a) => a.stepId === "continuation_2")).toBe(false);
    // step_input_1 should now be succeeded with declared outputs!
    const attempt1 = scheduledAnswered.stepAttempts.find((a) => a.stepId === "step_input_1");
    expect(attempt1?.status).toBe("succeeded");
    expect(attempt1?.declaredOutputs).toMatchObject({
      answerArtifactId: "answer_artifact_1",
      responderId: "user_1",
    });
  });

  it("marks waiting step as failed when its interaction expires", () => {
    const definition: WorkflowDefinition = {
      id: "interactive_def",
      revision: "rev1",
      maxConcurrency: 1,
      maxArtifactBytes: 1024,
      steps: [
        {
          id: "step_input",
          type: "interaction.wait",
          timeoutMs: 1000,
          retries: 0,
          concurrency: 1,
          approval: "automatic",
        },
      ],
    };

    const runWithExpired = makeRun({
      stepAttempts: [
        {
          id: "attempt_input",
          stepId: "step_input",
          adapterType: "interaction.wait",
          adapterVersion: "1.0.0",
          status: "running",
          input: {},
        },
      ],
      interactions: [
        {
          id: "interaction_1",
          runId: "run_1",
          stepId: "step_input",
          status: "expired",
          promptArtifactId: "prompt_artifact_1",
          requestedAt: 100,
        },
      ],
    });

    const scheduled = scheduleWorkflow(runWithExpired, definition, 200).run;
    expect(scheduled.status).toBe("failed");
    const attempt = scheduled.stepAttempts.find((a) => a.stepId === "step_input");
    expect(attempt?.status).toBe("failed");
    expect(attempt?.failureClassification).toBe("interaction_expired");
  });
});
