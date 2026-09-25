import { describe, expect, test } from "vitest";

import {
  WorkflowApprovalApproveRequestSchema,
  WorkflowArtifactGetResponseSchema,
  WorkflowDefinitionListRequestSchema,
  WorkflowRunCreateRequestSchema,
  WorkflowRunCreateResponseSchema,
} from "./rpc-schemas.js";

describe("workflow RPC schemas", () => {
  const scope = {
    projectId: "project-1",
    workspaceId: "workspace-1",
    runId: "run-1",
    requestId: "request-1",
  };

  test("keeps workflow request scope and correlation fields at the wire top level", () => {
    expect(
      WorkflowRunCreateRequestSchema.parse({
        type: "workflow.run.create.request",
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        requestId: scope.requestId,
        workflowId: "visual-crawler-fix",
        input: { directiveId: "directive-1" },
      }),
    ).toEqual({
      type: "workflow.run.create.request",
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      requestId: scope.requestId,
      workflowId: "visual-crawler-fix",
      input: { directiveId: "directive-1" },
    });

    expect(
      WorkflowApprovalApproveRequestSchema.parse({
        type: "workflow.approval.approve.request",
        ...scope,
        approvalId: "approval-1",
      }),
    ).toEqual({
      type: "workflow.approval.approve.request",
      ...scope,
      approvalId: "approval-1",
    });
  });

  test("uses dotted request and response type names with response payload correlation", () => {
    const run = {
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      runId: scope.runId,
      workflowId: "visual-crawler-fix",
      name: "Visual crawler fix",
      sourcePreset: "visual-crawler",
      definitionRevision: "1",
      definitionHash: "hash-1",
      status: "queued" as const,
      currentStepId: null,
      executionRisk: "workspace_write" as const,
      createdAt: "2026-09-25T00:00:00.000Z",
      updatedAt: "2026-09-25T00:00:00.000Z",
      completedAt: null,
    };

    expect(
      WorkflowRunCreateResponseSchema.parse({
        type: "workflow.run.create.response",
        payload: {
          ...scope,
          run,
          error: null,
        },
      }),
    ).toEqual({
      type: "workflow.run.create.response",
      payload: {
        ...scope,
        run,
        error: null,
      },
    });
  });

  test("allows definition responses to explicitly carry no runId", () => {
    expect(
      WorkflowDefinitionListRequestSchema.parse({
        type: "workflow.definition.list.request",
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        requestId: scope.requestId,
      }),
    ).toMatchObject({ type: "workflow.definition.list.request" });
  });

  test("keeps artifact content structural and nullable on failed reads", () => {
    expect(
      WorkflowArtifactGetResponseSchema.parse({
        type: "workflow.artifact.get.response",
        payload: {
          ...scope,
          artifact: null,
          content: null,
          error: "Artifact not found",
        },
      }),
    ).toMatchObject({
      type: "workflow.artifact.get.response",
      payload: { ...scope, content: null, error: "Artifact not found" },
    });
  });
});
