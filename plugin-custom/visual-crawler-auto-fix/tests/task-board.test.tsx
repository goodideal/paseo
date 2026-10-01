// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TaskBoard } from "../client/components/task-board.js";
import type { CrawlerTaskItem } from "../shared/types.js";

describe("TaskBoard", () => {
  const sampleTasks: CrawlerTaskItem[] = [
    {
      id: "task-1",
      clusterKey: "k1",
      title: "Crash on /checkout",
      severity: "P0",
      category: "runtime_error",
      status: "todo",
      occurrenceCount: 3,
      affectedUrls: ["https://example.com/checkout"],
      firstSeenAt: 1000,
      lastSeenAt: 2000,
      reproductionBreadcrumbs: [
        { hopNumber: 1, url: "https://example.com", action: "navigate" },
        { hopNumber: 2, url: "https://example.com/checkout", action: "click:button.pay" },
      ],
      evidence: { consoleMessage: "Uncaught ReferenceError" },
    },
    {
      id: "task-2",
      clusterKey: "k2",
      title: "Header overflow",
      severity: "P2",
      category: "visual_defect",
      status: "todo",
      occurrenceCount: 1,
      affectedUrls: ["https://example.com/settings"],
      firstSeenAt: 1000,
      lastSeenAt: 1000,
      reproductionBreadcrumbs: [],
      evidence: { domSelector: "div.header" },
    },
  ];

  it("renders tasks and allows status transitions", () => {
    const onUpdateStatus = vi.fn();
    const { getByText, getAllByText } = render(
      <TaskBoard tasks={sampleTasks} onUpdateStatus={onUpdateStatus} />,
    );

    expect(getByText("Crash on /checkout")).toBeTruthy();
    expect(getByText("Header overflow")).toBeTruthy();

    const [resolveBtn] = getAllByText("Mark Done");
    fireEvent.click(resolveBtn);
    expect(onUpdateStatus).toHaveBeenCalledWith("task-1", "resolved");

    const [ignoreBtn] = getAllByText("Ignore");
    fireEvent.click(ignoreBtn);
    expect(onUpdateStatus).toHaveBeenCalledWith("task-1", "ignored");
  });
});
