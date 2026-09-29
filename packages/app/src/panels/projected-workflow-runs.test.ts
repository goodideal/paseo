// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  buildProjectedWorkflowRuns,
  isProjectedRunId,
  isProjectedStepAttempt,
  resolveManagedSubagentStatus,
  resolveRunStatus,
  useProjectedWorkflowRuns,
  type ProjectedAgent,
  type ProjectedSubagent,
} from "./projected-workflow-runs";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useProviderSubagentStore } from "@/subagents/provider-store";

describe("isProjectedRunId", () => {
  it("correctly identifies virtual projected session run IDs", () => {
    expect(isProjectedRunId("virtual:session:agent-1")).toBe(true);
    expect(isProjectedRunId("virtual:session:abc-xyz")).toBe(true);
    expect(isProjectedRunId("run-123")).toBe(false);
    expect(isProjectedRunId("")).toBe(false);
  });
});

describe("isProjectedStepAttempt", () => {
  it("discriminates projected step attempts with kind: 'projected'", () => {
    const projectedStep = {
      kind: "projected" as const,
      stepId: "Session: test",
      attempt: 1,
      status: "running" as const,
      startedAt: "2026-09-26T12:00:00.000Z",
      completedAt: null,
      skipReason: null,
      failureReason: null,
      agentId: "agent-1",
    };
    expect(isProjectedStepAttempt(projectedStep)).toBe(true);

    const normalStep = {
      stepId: "step-1",
      attempt: 1,
      status: "succeeded" as const,
      startedAt: "2026-09-26T12:00:00.000Z",
      completedAt: "2026-09-26T12:01:00.000Z",
      skipReason: null,
      failureReason: null,
    };
    expect(isProjectedStepAttempt(normalStep)).toBe(false);
    expect(isProjectedStepAttempt(null)).toBe(false);
    expect(isProjectedStepAttempt(undefined)).toBe(false);
    expect(isProjectedStepAttempt({ kind: "other" })).toBe(false);
  });
});

describe("resolveRunStatus", () => {
  it("resolves to running if lead agent is running or initializing", () => {
    expect(resolveRunStatus("running", [])).toBe("running");
    expect(resolveRunStatus("initializing", [])).toBe("running");
  });

  it("resolves to running if any subagent is running", () => {
    const runningSub: ProjectedSubagent = {
      id: "sub-1",
      parentAgentId: "agent-1",
      title: "Sub",
      description: null,
      status: "running",
      createdAt: "2026-09-26T12:00:00.000Z",
    };
    expect(resolveRunStatus("idle", [runningSub])).toBe("running");
    expect(resolveRunStatus("closed", [runningSub])).toBe("running");
    // Running takes precedence over lead error
    expect(resolveRunStatus("error", [runningSub])).toBe("running");
  });

  it("resolves to failed if lead agent is error or any subagent is failed", () => {
    expect(resolveRunStatus("error", [])).toBe("failed");
    const failedSub: ProjectedSubagent = {
      id: "sub-2",
      parentAgentId: "agent-1",
      title: "Sub Failed",
      description: null,
      status: "failed",
      createdAt: "2026-09-26T12:00:00.000Z",
    };
    expect(resolveRunStatus("idle", [failedSub])).toBe("failed");
    expect(resolveRunStatus("closed", [failedSub])).toBe("failed");
  });

  it("resolves to succeeded when lead is idle/closed and no subagents are running/failed", () => {
    const completedSub: ProjectedSubagent = {
      id: "sub-3",
      parentAgentId: "agent-1",
      title: "Sub Done",
      description: null,
      status: "completed",
      createdAt: "2026-09-26T12:00:00.000Z",
    };
    expect(resolveRunStatus("idle", [])).toBe("succeeded");
    expect(resolveRunStatus("closed", [])).toBe("succeeded");
    expect(resolveRunStatus("idle", [completedSub])).toBe("succeeded");
    expect(resolveRunStatus("closed", [completedSub])).toBe("succeeded");
  });
});

describe("resolveManagedSubagentStatus", () => {
  it("maps initializing and running to running", () => {
    expect(resolveManagedSubagentStatus("running")).toBe("running");
    expect(resolveManagedSubagentStatus("initializing")).toBe("running");
  });

  it("maps error to failed", () => {
    expect(resolveManagedSubagentStatus("error")).toBe("failed");
  });

  it("maps idle and closed to completed", () => {
    expect(resolveManagedSubagentStatus("idle")).toBe("completed");
    expect(resolveManagedSubagentStatus("closed")).toBe("completed");
  });
});

describe("buildProjectedWorkflowRuns", () => {
  it("projects top-level agent with subagents into a workflow run with DAG steps adhering to terminology rules", () => {
    const agent: ProjectedAgent = {
      id: "agent-1",
      title: "Fix Issue #123 Channel Cooldown Bug",
      provider: "codex",
      status: "running",
      workspaceId: "ws-1",
      parentAgentId: null,
      createdAt: new Date("2026-09-26T12:00:00Z"),
      updatedAt: new Date("2026-09-26T12:05:00Z"),
    };

    const subagents: ProjectedSubagent[] = [
      {
        id: "sub-1",
        parentAgentId: "agent-1",
        title: "Code Reviewer",
        description: "Review security and token expiration",
        status: "completed",
        createdAt: "2026-09-26T12:01:00.000Z",
        updatedAt: "2026-09-26T12:03:00.000Z",
      },
      {
        id: "sub-2",
        parentAgentId: "agent-1",
        title: "Test Runner",
        description: "Run vitest suite on changed files",
        status: "running",
        createdAt: "2026-09-26T12:03:30.000Z",
      },
    ];

    const subagentsMap = new Map([["agent-1", subagents]]);

    const { summaries, getDetail } = buildProjectedWorkflowRuns({
      projectId: "p1",
      workspaceId: "ws-1",
      agents: [agent],
      subagentsByParentId: subagentsMap,
    });

    expect(summaries).toHaveLength(1);
    const summary = summaries[0];
    expect(summary.runId).toBe("virtual:session:agent-1");
    expect(summary.name).toBe("Fix Issue #123 Channel Cooldown Bug");
    expect(summary.status).toBe("running");
    expect(summary.workflowId).toBe("agent-session");
    expect(summary.sourcePreset).toBe("agent-session");
    expect(summary.completedAt).toBeNull();

    const detail = getDetail("virtual:session:agent-1");
    expect(detail).toBeDefined();
    expect(detail?.kind).toBe("projected");
    expect(detail?.stepAttempts).toHaveLength(3);

    // Step 0: Lead Agent Session
    expect(detail?.stepAttempts[0].kind).toBe("projected");
    expect(detail?.stepAttempts[0].stepId).toBe("Session: Fix Issue #123 Channel Cooldown Bug");
    expect(detail?.stepAttempts[0].status).toBe("running");
    expect(detail?.stepAttempts[0].agentId).toBe("agent-1");
    expect(detail?.stepAttempts[0].subagentId).toBeUndefined();

    // Step 1: Subagent 1
    expect(detail?.stepAttempts[1].kind).toBe("projected");
    expect(detail?.stepAttempts[1].stepId).toBe("Code Reviewer");
    expect(detail?.stepAttempts[1].status).toBe("succeeded");
    expect(detail?.stepAttempts[1].subagentId).toBe("sub-1");

    // Step 2: Subagent 2
    expect(detail?.stepAttempts[2].kind).toBe("projected");
    expect(detail?.stepAttempts[2].stepId).toBe("Test Runner");
    expect(detail?.stepAttempts[2].status).toBe("running");
    expect(detail?.stepAttempts[2].subagentId).toBe("sub-2");
  });

  it("uses default name Agent Session (provider) and Session: provider when title is absent", () => {
    const agent: ProjectedAgent = {
      id: "agent-no-title",
      title: null,
      provider: "claude",
      status: "running",
      workspaceId: "ws-1",
      parentAgentId: null,
      createdAt: new Date("2026-09-26T12:00:00Z"),
      updatedAt: new Date("2026-09-26T12:00:00Z"),
    };

    const { summaries, getDetail } = buildProjectedWorkflowRuns({
      projectId: "p1",
      workspaceId: "ws-1",
      agents: [agent],
      subagentsByParentId: new Map(),
    });

    expect(summaries[0].name).toBe("Agent Session (claude)");
    const detail = getDetail("virtual:session:agent-no-title");
    expect(detail?.stepAttempts[0].stepId).toBe("Session: claude");
  });

  it("marks overall run status as failed if any subagent failed", () => {
    const agent: ProjectedAgent = {
      id: "agent-2",
      title: "Refactor Database Schema",
      provider: "claude",
      status: "idle",
      workspaceId: "ws-1",
      parentAgentId: null,
      createdAt: new Date("2026-09-26T10:00:00Z"),
      updatedAt: new Date("2026-09-26T10:05:00Z"),
    };

    const subagents: ProjectedSubagent[] = [
      {
        id: "sub-failed",
        parentAgentId: "agent-2",
        title: "Migration Script",
        description: "Execute schema migration",
        status: "failed",
        createdAt: "2026-09-26T10:01:00.000Z",
      },
    ];

    const { summaries, getDetail } = buildProjectedWorkflowRuns({
      projectId: "p1",
      workspaceId: "ws-1",
      agents: [agent],
      subagentsByParentId: new Map([["agent-2", subagents]]),
    });

    expect(summaries[0].status).toBe("failed");
    expect(summaries[0].completedAt).toBe("2026-09-26T10:05:00.000Z");
    const detail = getDetail("virtual:session:agent-2");
    expect(detail?.stepAttempts[1].status).toBe("failed");
    expect(detail?.pendingInteraction).toBeNull();
    expect(detail?.interactions).toEqual([]);
    expect(detail?.deliveryApprovalManifest).toBeNull();
  });

  it("ignores archived agents or child agents as roots", () => {
    const parentAgent: ProjectedAgent = {
      id: "parent",
      title: "Parent",
      provider: "codex",
      status: "idle",
      workspaceId: "ws-1",
      parentAgentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const childAgent: ProjectedAgent = {
      id: "child",
      title: "Child",
      provider: "codex",
      status: "running",
      workspaceId: "ws-1",
      parentAgentId: "parent",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const archivedAgent: ProjectedAgent = {
      id: "archived",
      title: "Archived",
      provider: "codex",
      status: "running",
      workspaceId: "ws-1",
      parentAgentId: null,
      archivedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { summaries } = buildProjectedWorkflowRuns({
      projectId: "p1",
      workspaceId: "ws-1",
      agents: [parentAgent, childAgent, archivedAgent],
      subagentsByParentId: new Map(),
    });

    // Parent is idle with 0 subagents, child has parentAgentId, archived has archivedAt
    expect(summaries).toHaveLength(0);
  });
});

describe("useProjectedWorkflowRuns hook", () => {
  const serverId = "server-1";
  const workspaceId = "ws-1";

  function createMockAgent(overrides: Partial<Agent> & { id: string }): Agent {
    return {
      serverId,
      provider: "codex",
      status: "running",
      turn: { phase: "idle", cancellationRequestId: null },
      createdAt: new Date("2026-09-26T10:00:00.000Z"),
      updatedAt: new Date("2026-09-26T10:05:00.000Z"),
      lastUserMessageAt: null,
      lastActivityAt: new Date("2026-09-26T10:05:00.000Z"),
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: false,
        supportsMcpServers: false,
        supportsReasoningStream: false,
        supportsToolInvocations: false,
      },
      currentModeId: "code",
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: "Test Agent",
      cwd: "/repo/workspace-1",
      workspaceId,
      model: null,
      parentAgentId: null,
      labels: {},
      ...overrides,
    };
  }

  it("returns empty projectedRuns when projectId is null, empty or default", () => {
    const { result: resNull } = renderHook(() =>
      useProjectedWorkflowRuns({
        serverId,
        workspaceId,
        projectId: null,
      }),
    );
    expect(resNull.current.projectedRuns).toEqual([]);
    expect(resNull.current.getProjectedDetail("any")).toBeNull();

    const { result: resDefault } = renderHook(() =>
      useProjectedWorkflowRuns({
        serverId,
        workspaceId,
        projectId: "default",
      }),
    );
    expect(resDefault.current.projectedRuns).toEqual([]);

    const { result: resEmpty } = renderHook(() =>
      useProjectedWorkflowRuns({
        serverId,
        workspaceId,
        projectId: "   ",
      }),
    );
    expect(resEmpty.current.projectedRuns).toEqual([]);
  });

  it("strictly filters agents by workspaceId without cwd fallback", () => {
    const agentInWorkspace = createMockAgent({
      id: "agent-in-ws",
      workspaceId,
      status: "running",
    });
    const agentInOtherWorkspaceWithSameCwd = createMockAgent({
      id: "agent-other-ws",
      workspaceId: "ws-other",
      cwd: "/repo/workspace-1",
      status: "running",
    });

    useSessionStore.setState({
      sessions: {
        [serverId]: {
          serverId,
          agents: new Map([
            [agentInWorkspace.id, agentInWorkspace],
            [agentInOtherWorkspaceWithSameCwd.id, agentInOtherWorkspaceWithSameCwd],
          ]),
          serverInfo: {
            features: { providerSubagents: true },
          } as unknown as Agent["runtimeInfo"],
        } as unknown as ReturnType<typeof useSessionStore.getState>["sessions"][string],
      },
    });

    const { result } = renderHook(() =>
      useProjectedWorkflowRuns({
        serverId,
        workspaceId,
        projectId: "proj-1",
      }),
    );

    expect(result.current.projectedRuns).toHaveLength(1);
    expect(result.current.projectedRuns[0].runId).toBe("virtual:session:agent-in-ws");
  });

  it("ignores provider subagent descriptors when providerSubagents feature is false", () => {
    const parentAgent = createMockAgent({
      id: "parent-agent",
      workspaceId,
      status: "idle",
    });

    useSessionStore.setState({
      sessions: {
        [serverId]: {
          serverId,
          agents: new Map([[parentAgent.id, parentAgent]]),
          serverInfo: {
            features: { providerSubagents: false },
          } as unknown as Agent["runtimeInfo"],
        } as unknown as ReturnType<typeof useSessionStore.getState>["sessions"][string],
      },
    });

    useProviderSubagentStore.setState({
      descriptors: new Map([
        [
          `${serverId}\0parent-agent\0desc-1`,
          {
            id: "desc-1",
            parentAgentId: "parent-agent",
            provider: "codex",
            title: "Descriptor 1",
            description: "Sub task",
            status: "running",
            createdAt: "2026-09-26T10:00:00.000Z",
            updatedAt: "2026-09-26T10:05:00.000Z",
            toolCallId: null,
          },
        ],
      ]),
      hiddenFromTrack: new Set(),
    });

    const { result } = renderHook(() =>
      useProjectedWorkflowRuns({
        serverId,
        workspaceId,
        projectId: "proj-1",
      }),
    );

    // Parent is idle and descriptors are ignored due to feature gate -> 0 projected runs
    expect(result.current.projectedRuns).toHaveLength(0);
  });

  it("filters out hidden provider subagents recorded in hiddenFromTrack", () => {
    const parentAgent = createMockAgent({
      id: "parent-agent-2",
      workspaceId,
      status: "idle",
    });

    useSessionStore.setState({
      sessions: {
        [serverId]: {
          serverId,
          agents: new Map([[parentAgent.id, parentAgent]]),
          serverInfo: {
            features: { providerSubagents: true },
          } as unknown as Agent["runtimeInfo"],
        } as unknown as ReturnType<typeof useSessionStore.getState>["sessions"][string],
      },
    });

    const descKey = `${serverId}\0parent-agent-2\0desc-hidden`;
    useProviderSubagentStore.setState({
      descriptors: new Map([
        [
          descKey,
          {
            id: "desc-hidden",
            parentAgentId: "parent-agent-2",
            provider: "codex",
            title: "Hidden Task",
            description: "Completed sub task",
            status: "completed",
            createdAt: "2026-09-26T10:00:00.000Z",
            updatedAt: "2026-09-26T10:05:00.000Z",
            toolCallId: null,
          },
        ],
      ]),
      hiddenFromTrack: new Set([descKey]),
    });

    const { result } = renderHook(() =>
      useProjectedWorkflowRuns({
        serverId,
        workspaceId,
        projectId: "proj-1",
      }),
    );

    // Because descriptor is hidden and parent is idle, 0 runs
    expect(result.current.projectedRuns).toHaveLength(0);
  });

  it("correctly collects managed child agents in the workspace", () => {
    const parent = createMockAgent({
      id: "parent-managed",
      workspaceId,
      status: "idle",
    });
    const child = createMockAgent({
      id: "child-managed",
      parentAgentId: "parent-managed",
      workspaceId,
      status: "running",
      title: "Managed Child Agent",
    });

    useSessionStore.setState({
      sessions: {
        [serverId]: {
          serverId,
          agents: new Map([
            [parent.id, parent],
            [child.id, child],
          ]),
          serverInfo: {
            features: { providerSubagents: true },
          } as unknown as Agent["runtimeInfo"],
        } as unknown as ReturnType<typeof useSessionStore.getState>["sessions"][string],
      },
    });

    const { result } = renderHook(() =>
      useProjectedWorkflowRuns({
        serverId,
        workspaceId,
        projectId: "proj-1",
      }),
    );

    expect(result.current.projectedRuns).toHaveLength(1);
    const detail = result.current.getProjectedDetail("virtual:session:parent-managed");
    expect(detail?.stepAttempts).toHaveLength(2);
    expect(detail?.stepAttempts[1].subagentId).toBe("child-managed");
    expect(detail?.stepAttempts[1].status).toBe("running");
  });
});
