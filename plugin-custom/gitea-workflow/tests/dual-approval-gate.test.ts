import { describe, it, expect, vi } from "vitest";
import {
  isApprovalComment,
  isOptionSelection,
  createDualApprovalGateAdapter,
} from "../server/adapters/dual-approval-gate.js";

describe("Dual Approval Gate Comment Parsing", () => {
  it("recognizes approval commands in multiple formats", () => {
    expect(isApprovalComment("/approve")).toBe(true);
    expect(isApprovalComment("同意")).toBe(true);
    expect(isApprovalComment("lgtm")).toBe(true);
    expect(isApprovalComment("确认通过")).toBe(true);
    expect(isApprovalComment("方案A")).toBe(true);
    expect(isApprovalComment("A")).toBe(true);
  });

  it("ignores markdown quotes and casual discussion", () => {
    expect(isApprovalComment("> /approve")).toBe(false);
    expect(isApprovalComment("这个方案我觉得不太行")).toBe(false);
  });

  it("extracts option selection correctly", () => {
    expect(isOptionSelection("选方案 B")).toBe("B");
    expect(isOptionSelection("方案 A")).toBe("A");
    expect(isOptionSelection("C")).toBe("C");
    expect(isOptionSelection("随意")).toBeNull();
  });
});

describe("Dual Approval Gate Adapter Execution", () => {
  it("attaches waiting approval label and polls for issue comments", async () => {
    const mockClient = {
      addIssueLabel: vi.fn().mockResolvedValue(undefined),
      removeIssueLabel: vi.fn().mockResolvedValue(undefined),
      createIssueComment: vi.fn().mockResolvedValue({ id: 999 }),
      listIssueComments: vi.fn().mockResolvedValue([
        {
          id: 1001,
          body: "同意",
          created_at: new Date(Date.now() + 1000).toISOString(),
        },
      ]),
    };
    const mockPool = { getClient: vi.fn().mockReturnValue(mockClient) };

    const adapter = createDualApprovalGateAdapter(mockPool as any);
    const mockPaseo = {
      workflows: {
        stepApprove: vi.fn().mockResolvedValue({ success: true }),
      },
    };

    const res = await adapter.execute(
      {
        baseUrl: "https://git.example.com",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
        issueNumber: 42,
        phase: "brainstorm",
        reason: "Brainstorm proposal requires confirmation",
      },
      {
        paseo: mockPaseo as any,
        run: { runId: "r1" },
        step: { stepId: "gate-brainstorm" },
      } as any,
    );

    expect(res.approved).toBe(true);
    expect(mockClient.addIssueLabel).toHaveBeenCalledWith(42, "agent-waiting-approval");
    expect(mockClient.removeIssueLabel).toHaveBeenCalledWith(42, "agent-waiting-approval");
    expect(mockClient.createIssueComment).toHaveBeenCalled();
  });
  it("ignores old approval comments created prior to gate creation and only accepts newer comment IDs", async () => {
    const mockClient = {
      addIssueLabel: vi.fn().mockResolvedValue(undefined),
      removeIssueLabel: vi.fn().mockResolvedValue(undefined),
      createIssueComment: vi.fn().mockResolvedValue({ id: 500 }),
      listIssueComments: vi.fn().mockResolvedValue([
        {
          id: 450, // older than gate comment (id: 500), but within 2s timestamp skew
          body: "/approve",
          created_at: new Date(Date.now() - 500).toISOString(),
        },
      ]),
    };
    const mockPool = { getClient: vi.fn().mockReturnValue(mockClient) };
    const adapter = createDualApprovalGateAdapter(mockPool as any);

    const res = await adapter.execute(
      {
        baseUrl: "https://git.example.com",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
        issueNumber: 42,
        phase: "brainstorm",
        pollIntervalMs: 50,
        maxWaitMs: 50,
      },
      {
        run: { runId: "r1" },
        step: { stepId: "gate-brainstorm" },
      } as any,
    );

    expect(res.approved).toBe(false);
  });
});
