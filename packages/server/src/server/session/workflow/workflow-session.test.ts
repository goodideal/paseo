import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionOutboundMessage } from "../../messages.js";
import { createWorkflowPresetRegistry } from "../../workflows/workflow-preset-registry.js";
import { registerBuiltInWorkflowStepManifests } from "../../workflows/core-step-manifests.js";
import { StepAdapterRegistry } from "../../workflows/step-adapter-registry.js";
import { WorkflowService } from "../../workflows/workflow-service.js";
import { WorkflowStore } from "../../workflows/workflow-store.js";
import { WorkflowSession } from "./workflow-session.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createSession() {
  const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-workflow-session-"));
  temporaryDirectories.push(paseoHome);
  const registry = new StepAdapterRegistry();
  registerBuiltInWorkflowStepManifests(registry);
  const presets = createWorkflowPresetRegistry(registry);
  const emitted: SessionOutboundMessage[] = [];
  const session = new WorkflowSession({
    host: { emit: (message) => emitted.push(message) },
    workflowService: new WorkflowService({
      store: new WorkflowStore({ paseoHome }),
      registry,
      now: () => 100,
      createId: (kind) => `${kind}_0000000000000001`,
    }),
    presets,
    principalId: "principal_1",
    resolveWorkspace: async ({ projectId, workspaceId }) => {
      if (projectId !== "project_1" || workspaceId !== "workspace_1") return null;
      return { cwd: "/workspace/project_1" };
    },
    logger: pino({ level: "silent" }),
  });
  return { emitted, presets, session };
}

describe("WorkflowSession", () => {
  it("lists registered definitions, creates only a known preset, and keeps the run scope-bound", async () => {
    const { emitted, presets, session } = createSession();
    const workflowId = presets.list()[0]?.workflowId;
    expect(workflowId).toBeDefined();

    await session.handle({
      type: "workflow.definition.list.request",
      projectId: "project_1",
      workspaceId: "workspace_1",
      requestId: "definitions",
    });
    await session.handle({
      type: "workflow.run.create.request",
      projectId: "project_1",
      workspaceId: "workspace_1",
      requestId: "unknown",
      workflowId: "unknown-workflow",
    });
    await session.handle({
      type: "workflow.run.create.request",
      projectId: "project_1",
      workspaceId: "workspace_1",
      requestId: "create",
      workflowId: workflowId!,
    });

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "workflow.definition.list.response",
        payload: expect.objectContaining({ requestId: "definitions", error: null }),
      }),
    );
    expect(emitted).toContainEqual({
      type: "workflow.run.create.response",
      payload: {
        projectId: "project_1",
        workspaceId: "workspace_1",
        requestId: "unknown",
        runId: null,
        run: null,
        error: "Unknown workflow preset: unknown-workflow",
      },
    });
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "workflow.run.create.response",
        payload: expect.objectContaining({
          requestId: "create",
          runId: expect.any(String),
          error: null,
        }),
      }),
    );
  });
});
