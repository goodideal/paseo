import { describe, expect, it } from "vitest";
import {
  AgentMilestoneRecordSchema,
  WorkspaceEvolutionDigestSchema,
  WorkspaceEvolutionGetDigestRequestSchema,
  WorkspaceEvolutionGetDigestResponseSchema,
  WorkspaceEvolutionUpdatedMessageSchema,
} from "./evolution.js";

describe("Evolution schemas", () => {
  it("validates a valid AgentMilestoneRecord", () => {
    const record = {
      agentId: "agent-123",
      provider: "codex",
      model: "gemini-flash",
      startedAt: "2026-09-27T01:00:00.000Z",
      completedAt: "2026-09-27T01:30:00.000Z",
      durationMs: 1800000,
      status: "completed",
      intentPrompt: "调研 DocDB 集群部署方式",
      executiveSummary: "完成集群方案调研，推荐 Raft + S3",
      keyDecisions: ["使用 S3 共享存储", "对外提供 MongoDB 4.2 wire 协议"],
      modifiedFiles: ["docs/arch/docdb.md"],
      commits: [{ hash: "abc1234", message: "docs: add cluster spec" }],
    };
    expect(AgentMilestoneRecordSchema.parse(record)).toEqual(record);
  });

  it("validates WorkspaceEvolutionDigest", () => {
    const digest = {
      workspaceId: "wks_test_1",
      workspaceTitle: "glorious-eagle",
      branch: "feat/cluster",
      executiveSummary: "完成架构调研与核心代码改造",
      currentStage: "质量评审中",
      overallStatus: "in_progress",
      updatedAt: "2026-09-27T02:00:00.000Z",
      milestones: [],
    };
    expect(WorkspaceEvolutionDigestSchema.parse(digest)).toEqual(digest);
  });

  it("validates RPC request and response payloads", () => {
    const req = {
      type: "workspace.evolution.get_digest.request",
      requestId: "req_1",
      workspaceId: "wks_test_1",
      forceRefresh: false,
    };
    expect(WorkspaceEvolutionGetDigestRequestSchema.parse(req)).toEqual(req);

    const res = {
      type: "workspace.evolution.get_digest.response",
      payload: {
        requestId: "req_1",
        workspaceId: "wks_test_1",
        digest: null,
        isAnalyzing: false,
      },
    };
    expect(WorkspaceEvolutionGetDigestResponseSchema.parse(res)).toEqual(res);

    const update = {
      type: "workspace.evolution.updated",
      payload: {
        workspaceId: "wks_test_1",
        digest: {
          workspaceId: "wks_test_1",
          workspaceTitle: "glorious-eagle",
          branch: "feat/cluster",
          executiveSummary: "完成架构调研与核心代码改造",
          currentStage: "质量评审中",
          overallStatus: "in_progress",
          updatedAt: "2026-09-27T02:00:00.000Z",
          milestones: [],
        },
      },
    };
    expect(WorkspaceEvolutionUpdatedMessageSchema.parse(update)).toEqual(update);
  });
});
