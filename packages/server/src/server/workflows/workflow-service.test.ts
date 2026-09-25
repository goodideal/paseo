import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { WorkflowDefinition } from "./definition-compiler.js";
import { WorkflowService } from "./workflow-service.js";
import { StepAdapterRegistry } from "./step-adapter-registry.js";
import { WorkflowStore } from "./workflow-store.js";

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
});
