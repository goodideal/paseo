/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MilestoneSubagentsSection } from "./milestone-subagents-section";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const mockSubagents = vi.fn();
vi.mock("@/subagents", () => ({
  useArchiveSubagent: () => vi.fn(),
  useArchiveFinishedSubagents: () => ({
    archiveFinished: vi.fn(),
    eligibleCount: 0,
    status: { kind: "idle" },
  }),
}));
vi.mock("@/subagents/select", () => ({
  useSubagentsForParent: () => mockSubagents(),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => null,
}));

vi.mock("@/subagents", () => ({
  useArchiveSubagent: () => vi.fn(),
  useArchiveFinishedSubagents: () => ({
    archiveFinished: vi.fn(),
    eligibleCount: 0,
    status: { kind: "idle" },
  }),
}));

describe("MilestoneSubagentsSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders null when there are no subagents", async () => {
    mockSubagents.mockReturnValue([]);
    await act(async () => {
      root.render(<MilestoneSubagentsSection serverId="srv-1" parentAgentId="parent-1" />);
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders auto-expanded list when subagents contain running task", async () => {
    mockSubagents.mockReturnValue([
      {
        kind: "paseo",
        id: "child-1",
        provider: "claude",
        title: "研究文档",
        description: null,
        subtitle: null,
        status: "running",
        requiresAttention: false,
        createdAt: new Date(),
      },
    ]);

    await act(async () => {
      root.render(<MilestoneSubagentsSection serverId="srv-1" parentAgentId="parent-1" />);
    });

    expect(container.textContent).toContain("子任务流");
    expect(container.textContent).toContain("研究文档");
    expect(container.textContent).toContain("执行中");
  });

  it("renders auto-collapsed list when all subagents are completed", async () => {
    mockSubagents.mockReturnValue([
      {
        kind: "paseo",
        id: "child-2",
        provider: "codex",
        title: "编译代码",
        description: null,
        subtitle: null,
        status: "idle",
        turn: { phase: "idle" },
        requiresAttention: false,
        createdAt: new Date(),
      },
    ]);

    await act(async () => {
      root.render(<MilestoneSubagentsSection serverId="srv-1" parentAgentId="parent-1" />);
    });

    expect(container.textContent).toContain("子任务流 (1) · 1 已完成");
    // Initially collapsed, so task title is not rendered
    expect(container.textContent).not.toContain("编译代码");
  });

  it("calls onNavigateToAgent when clicking a subagent row", async () => {
    const handleNavigate = vi.fn();
    mockSubagents.mockReturnValue([
      {
        kind: "paseo",
        id: "child-jump",
        provider: "claude",
        title: "单元测试",
        description: null,
        subtitle: null,
        status: "running",
        requiresAttention: false,
        createdAt: new Date(),
      },
    ]);

    await act(async () => {
      root.render(
        <MilestoneSubagentsSection
          serverId="srv-1"
          parentAgentId="parent-1"
          onNavigateToAgent={handleNavigate}
        />,
      );
    });

    const button = container.querySelector('[aria-label="子任务: 单元测试"]') as HTMLElement;
    expect(button).not.toBeNull();
    await act(async () => {
      button.click();
    });
    expect(handleNavigate).toHaveBeenCalledWith("child-jump");
  });
});
