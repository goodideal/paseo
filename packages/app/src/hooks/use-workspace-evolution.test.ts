// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWorkspaceEvolution } from "./use-workspace-evolution";
import type { WorkspaceEvolutionDigest } from "@getpaseo/protocol/evolution";

describe("useWorkspaceEvolution", () => {
  it("fetches digest on mount and sets data", async () => {
    const mockDigest: WorkspaceEvolutionDigest = {
      workspaceId: "wks_1",
      workspaceTitle: "glorious-eagle",
      branch: "feat/cluster",
      executiveSummary: "已完成架构调研",
      currentStage: "已完成",
      overallStatus: "completed",
      updatedAt: new Date().toISOString(),
      milestones: [],
    };

    const mockClient = {
      getWorkspaceEvolutionDigest: vi.fn().mockResolvedValue({
        requestId: "req_1",
        workspaceId: "wks_1",
        digest: mockDigest,
        isAnalyzing: false,
      }),
      on: vi.fn().mockReturnValue(() => {}),
    };

    const clientParam = mockClient as unknown as Parameters<
      typeof useWorkspaceEvolution
    >[0]["clientOverride"];

    const { result } = renderHook(() =>
      useWorkspaceEvolution({ workspaceId: "wks_1", clientOverride: clientParam }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockClient.getWorkspaceEvolutionDigest).toHaveBeenCalledWith("wks_1", {
      forceRefresh: false,
    });
    expect(result.current.digest?.executiveSummary).toBe("已完成架构调研");
  });
});
