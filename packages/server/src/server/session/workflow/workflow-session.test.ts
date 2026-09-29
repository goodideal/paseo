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
  const store = new WorkflowStore({ paseoHome });
  const session = new WorkflowSession({
    host: { emit: (message) => emitted.push(message) },
    workflowService: new WorkflowService({
      store,
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
  return { emitted, presets, session, store };
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

  it("returns content for regular artifacts and null for redacted artifacts in artifact.get", async () => {
    const { emitted, session, store } = createSession();
    // 写入测试文件
    const tmpFileRegular = path.join(temporaryDirectories[0]!, "regular.txt");
    const tmpFileRedacted = path.join(temporaryDirectories[0]!, "redacted.txt");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(tmpFileRegular, "public design doc content", "utf-8");
    writeFileSync(tmpFileRedacted, "sensitive-token-or-secret", "utf-8");

    const validHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const run = store.create({
      id: "run_art_1",
      projectId: "project_1",
      workspaceId: "workspace_1",
      definitionId: "def_1",
      definitionRevision: "1",
      definitionHash: validHash,
      workspaceRoot: "/workspace/project_1",
      principalId: "principal_1",
      status: "running",
      createdAt: 100,
      updatedAt: 100,
      stepAttempts: [],
      approvals: [],
      artifacts: [
        {
          id: "art_regular",
          kind: "design_doc",
          path: tmpFileRegular,
          contentHash: validHash,
          bytes: 25,
          redacted: false,
          createdAt: 100,
        },
        {
          id: "art_redacted",
          kind: "secret_answer",
          path: tmpFileRedacted,
          contentHash: validHash,
          bytes: 24,
          redacted: true,
          createdAt: 100,
        },
      ],
      intents: [],
      receipts: [],
      leases: [],
      unknownOutcomes: [],
      interactions: [],
    });

    await session.handle({
      type: "workflow.artifact.get.request",
      projectId: "project_1",
      workspaceId: "workspace_1",
      runId: run.id,
      requestId: "get_reg",
      artifactId: "art_regular",
    });

    await session.handle({
      type: "workflow.artifact.get.request",
      projectId: "project_1",
      workspaceId: "workspace_1",
      runId: run.id,
      requestId: "get_red",
      artifactId: "art_redacted",
    });

    type ArtifactGetResponse = Extract<
      SessionOutboundMessage,
      { type: "workflow.artifact.get.response" }
    >;

    const regResponse = emitted.find(
      (m): m is ArtifactGetResponse =>
        m.type === "workflow.artifact.get.response" && m.payload.requestId === "get_reg",
    );
    expect(regResponse).toBeDefined();
    expect(regResponse?.payload.content).toBe("public design doc content");
    expect(regResponse?.payload.artifact?.redacted).toBe(false);

    const redResponse = emitted.find(
      (m): m is ArtifactGetResponse =>
        m.type === "workflow.artifact.get.response" && m.payload.requestId === "get_red",
    );
    expect(redResponse).toBeDefined();
    expect(redResponse?.payload.content).toBe(null);
    expect(redResponse?.payload.artifact?.redacted).toBe(true);
  });

  it("handles workflow.interaction.respond.request and emits interaction response", async () => {
    const { emitted, presets, session, store } = createSession();
    const firstPreset = presets.list()[0];
    expect(firstPreset).toBeDefined();
    const workflowId = firstPreset!.workflowId;
    const validHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const run = store.create({
      id: "run_interact_1",
      projectId: "project_1",
      workspaceId: "workspace_1",
      definitionId: workflowId,
      definitionRevision: "1",
      definitionHash: validHash,
      resolvedDefinition: presets.get(workflowId)?.definition,
      workspaceRoot: "/workspace/project_1",
      principalId: "principal_1",
      status: "running",
      createdAt: 100,
      updatedAt: 100,
      stepAttempts: [
        {
          id: "attempt_1",
          stepId: "step_ask",
          adapterType: "interaction.wait",
          adapterVersion: "1.0.0",
          status: "running",
          input: {},
          startedAt: 100,
        },
      ],
      approvals: [],
      artifacts: [
        {
          id: "art_q_1",
          kind: "interaction_prompt",
          path: "/tmp/q.txt",
          contentHash: validHash,
          bytes: 10,
          redacted: false,
          createdAt: 100,
        },
      ],
      intents: [],
      receipts: [],
      leases: [],
      unknownOutcomes: [],
      interactions: [
        {
          id: "interaction_1",
          runId: "run_interact_1",
          stepId: "step_ask",
          status: "pending",
          promptArtifactId: "art_q_1",
          requestedAt: 100,
        },
      ],
    });

    await session.handle({
      type: "workflow.interaction.respond.request",
      projectId: "project_1",
      workspaceId: "workspace_1",
      runId: run.id,
      requestId: "respond_req",
      interactionId: "interaction_1",
      answer: "Proceed with strict gate",
    });

    type InteractionRespondResponse = Extract<
      SessionOutboundMessage,
      { type: "workflow.interaction.respond.response" }
    >;

    const response = emitted.find(
      (m): m is InteractionRespondResponse =>
        m.type === "workflow.interaction.respond.response" && m.payload.requestId === "respond_req",
    );
    expect(response).toBeDefined();
    expect(response?.payload.error).toBe(null);
    expect(response?.payload.interaction?.status).toBe("answered");
    expect(response?.payload.interaction?.responderId).toBe("principal_1");
  });
});
