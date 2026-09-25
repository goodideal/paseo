import { describe, expect, test } from "vitest";

import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("Workflow Engine protocol compatibility", () => {
  const scope = {
    projectId: "project-1",
    workspaceId: "workspace-1",
    runId: "run-1",
    requestId: "request-1",
  };

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

  test("keeps workflowEngine optional so legacy server_info parses unchanged", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "legacy-daemon",
        features: { providersSnapshot: true },
      }),
    ).toMatchObject({
      status: "server_info",
      serverId: "legacy-daemon",
      features: { providersSnapshot: true },
    });

    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "workflow-daemon",
        features: { workflowEngine: true },
      }).features,
    ).toEqual({ workflowEngine: true });
  });

  test("parses every Workflow request through the inbound union with scope and correlation fields", () => {
    const cases = [
      {
        type: "workflow.definition.list.request",
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        requestId: scope.requestId,
      },
      {
        type: "workflow.definition.inspect.request",
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        requestId: scope.requestId,
        workflowId: "visual-crawler-fix",
      },
      {
        type: "workflow.run.create.request",
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        requestId: scope.requestId,
        workflowId: "visual-crawler-fix",
        input: { directiveId: "directive-1" },
      },
      {
        type: "workflow.run.list.request",
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        requestId: scope.requestId,
      },
      {
        type: "workflow.run.inspect.request",
        ...scope,
      },
      {
        type: "workflow.run.cancel.request",
        ...scope,
        reason: "User cancelled",
      },
      {
        type: "workflow.run.retry.request",
        ...scope,
        stepId: "create-pr",
      },
      { type: "workflow.run.resume.request", ...scope },
      {
        type: "workflow.approval.list.request",
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        requestId: scope.requestId,
        runId: scope.runId,
      },
      {
        type: "workflow.approval.approve.request",
        ...scope,
        approvalId: "approval-1",
      },
      {
        type: "workflow.approval.deny.request",
        ...scope,
        approvalId: "approval-1",
        reason: "Do not ship",
      },
      { type: "workflow.artifact.list.request", ...scope },
      {
        type: "workflow.artifact.get.request",
        ...scope,
        artifactId: "artifact-1",
      },
    ];

    for (const request of cases) {
      expect(SessionInboundMessageSchema.parse(request)).toMatchObject({
        type: request.type,
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        requestId: scope.requestId,
      });
    }
  });

  test("parses every Workflow response through the outbound union with payload correlation", () => {
    const basePayload = {
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      runId: scope.runId,
      requestId: scope.requestId,
      error: null,
    };
    const approval = {
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      approvalId: "approval-1",
      runId: scope.runId,
      stepId: "create-pr",
      status: "pending" as const,
      action: "Create pull request",
      target: "origin/main",
      policyReason: "External write requires approval",
      createdAt: "2026-09-25T00:00:00.000Z",
      decidedAt: null,
      reason: null,
    };
    const artifact = {
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      artifactId: "artifact-1",
      runId: scope.runId,
      stepId: "verify",
      kind: "verification-output",
      name: "vitest.log",
      contentType: "text/plain",
      sizeBytes: 42,
      createdAt: "2026-09-25T00:00:00.000Z",
    };
    const cases = [
      {
        type: "workflow.definition.list.response",
        payload: { ...basePayload, runId: null, definitions: [], error: null },
      },
      {
        type: "workflow.definition.inspect.response",
        payload: { ...basePayload, runId: null, definition: null, error: null },
      },
      { type: "workflow.run.create.response", payload: { ...basePayload, run, error: null } },
      { type: "workflow.run.list.response", payload: { ...basePayload, runs: [run], error: null } },
      {
        type: "workflow.run.inspect.response",
        payload: { ...basePayload, run: { ...run, stepAttempts: [] }, error: null },
      },
      { type: "workflow.run.cancel.response", payload: { ...basePayload, run, error: null } },
      { type: "workflow.run.retry.response", payload: { ...basePayload, run, error: null } },
      { type: "workflow.run.resume.response", payload: { ...basePayload, run, error: null } },
      {
        type: "workflow.approval.list.response",
        payload: { ...basePayload, approvals: [approval], error: null },
      },
      {
        type: "workflow.approval.approve.response",
        payload: { ...basePayload, approval, run, error: null },
      },
      {
        type: "workflow.approval.deny.response",
        payload: { ...basePayload, approval, run, error: null },
      },
      {
        type: "workflow.artifact.list.response",
        payload: { ...basePayload, artifacts: [artifact], error: null },
      },
      {
        type: "workflow.artifact.get.response",
        payload: { ...basePayload, artifact, content: "test output", error: null },
      },
    ];

    for (const response of cases) {
      expect(SessionOutboundMessageSchema.parse(response)).toMatchObject({
        type: response.type,
        payload: {
          projectId: scope.projectId,
          workspaceId: scope.workspaceId,
          requestId: scope.requestId,
        },
      });
    }
  });
});
