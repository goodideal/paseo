/* eslint-disable react-perf/jsx-no-new-object-as-prop */
/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubagentItemRow } from "./subagent-item-row";
import { MilestoneSubagentsSection } from "./milestone-subagents-section";

const mockCancel = vi.fn();
const mockSendMessage = vi.fn();
const mockArchiveSubagent = vi.fn();
const mockArchiveFinished = vi.fn();
const mockSubagents = vi.fn();

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({
    cancelAgent: mockCancel,
    sendMessage: mockSendMessage,
  }),
}));

vi.mock("@/subagents", () => ({
  useArchiveSubagent: () => mockArchiveSubagent,
  useArchiveFinishedSubagents: () => ({
    archiveFinished: mockArchiveFinished,
    eligibleCount: 2,
    status: { kind: "idle" },
  }),
}));

vi.mock("@/subagents/select", () => ({
  useSubagentsForParent: () => mockSubagents(),
}));

describe("Subagent actions and 1+3 retry flow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("triggers cancelAgent when clicking interrupt button on running subagent", async () => {
    const runningRow: Parameters<typeof SubagentItemRow>[0]["row"] = {
      kind: "paseo",
      id: "child-run",
      provider: "claude",
      title: "执行测试",
      description: null,
      subtitle: null,
      status: "running",
      turn: { phase: "open", turnId: null, startedAt: null, cancellationRequestId: null },
      requiresAttention: false,
      createdAt: new Date(),
    };
    await act(async () => {
      root.render(<SubagentItemRow serverId="srv-1" row={runningRow} />);
    });

    const stopBtn = container.querySelector('[aria-label="中断"]') as HTMLButtonElement;
    expect(stopBtn).not.toBeNull();
    await act(async () => {
      stopBtn.click();
    });
    expect(mockCancel).toHaveBeenCalledWith("child-run");
  });

  it("opens inline retry input bar when clicking retry on failed subagent and sends message", async () => {
    const errorRow: Parameters<typeof SubagentItemRow>[0]["row"] = {
      kind: "paseo",
      id: "child-err",
      provider: "codex",
      title: "代码编译",
      description: null,
      subtitle: null,
      status: "error",
      turn: { phase: "idle", cancellationRequestId: null },
      requiresAttention: false,
      createdAt: new Date(),
    };
    await act(async () => {
      root.render(<SubagentItemRow serverId="srv-1" row={errorRow} />);
    });

    const retryBtn = container.querySelector('[aria-label="重试"]') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    await act(async () => {
      retryBtn.click();
    });

    // Verify inline retry bar is visible
    expect(container.textContent).toContain("调整方案并重新尝试");

    // Click confirm send
    const sendBtn = container.querySelector('[aria-label="确认重试"]') as HTMLButtonElement;
    expect(sendBtn).not.toBeNull();
    await act(async () => {
      sendBtn.click();
    });
    expect(mockSendMessage).toHaveBeenCalledWith(
      "child-err",
      expect.stringContaining("调整方案并重新尝试"),
    );
  });

  it("triggers archiveSubagent when clicking archive button on non-running subagent", async () => {
    const doneRow: Parameters<typeof SubagentItemRow>[0]["row"] = {
      kind: "paseo",
      id: "child-done",
      provider: "claude",
      title: "已完成的任务",
      description: null,
      subtitle: null,
      status: "idle",
      turn: { phase: "idle", cancellationRequestId: null },
      requiresAttention: false,
      createdAt: new Date(),
    };
    await act(async () => {
      root.render(<SubagentItemRow serverId="srv-1" row={doneRow} />);
    });

    const archiveBtn = container.querySelector('[aria-label="归档"]') as HTMLButtonElement;
    expect(archiveBtn).not.toBeNull();
    await act(async () => {
      archiveBtn.click();
    });
    expect(mockArchiveSubagent).toHaveBeenCalledWith("child-done");
  });

  it("closes inline retry bar when clicking cancel", async () => {
    const errorRow: Parameters<typeof SubagentItemRow>[0]["row"] = {
      kind: "paseo",
      id: "child-err",
      provider: "codex",
      title: "代码编译",
      description: null,
      subtitle: null,
      status: "error",
      turn: { phase: "idle", cancellationRequestId: null },
      requiresAttention: false,
      createdAt: new Date(),
    };
    await act(async () => {
      root.render(<SubagentItemRow serverId="srv-1" row={errorRow} />);
    });

    const retryBtn = container.querySelector('[aria-label="重试"]') as HTMLButtonElement;
    await act(async () => {
      retryBtn.click();
    });
    expect(container.textContent).toContain("调整方案并重新尝试");

    const cancelBtn = container.querySelector('[aria-label="取消"]') as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();
    await act(async () => {
      cancelBtn.click();
    });
    expect(container.textContent).not.toContain("调整方案并重新尝试");
  });

  it("renders bulk archive button when completedCount > 1 and calls archiveFinished", async () => {
    mockSubagents.mockReturnValue([
      {
        kind: "paseo",
        id: "c-1",
        provider: "claude",
        title: "任务 1",
        description: null,
        subtitle: null,
        status: "idle",
        turn: { phase: "idle", cancellationRequestId: null },
        requiresAttention: false,
        createdAt: new Date(),
      },
      {
        kind: "paseo",
        id: "c-2",
        provider: "codex",
        title: "任务 2",
        description: null,
        subtitle: null,
        status: "idle",
        turn: { phase: "idle", cancellationRequestId: null },
        requiresAttention: false,
        createdAt: new Date(),
      },
    ]);

    await act(async () => {
      root.render(<MilestoneSubagentsSection serverId="srv-1" parentAgentId="p-1" />);
    });

    const bulkBtn = container.querySelector('[aria-label="一键清理已完成"]') as HTMLButtonElement;
    expect(bulkBtn).not.toBeNull();
    await act(async () => {
      bulkBtn.click();
    });
    expect(mockArchiveFinished).toHaveBeenCalled();
  });
});
