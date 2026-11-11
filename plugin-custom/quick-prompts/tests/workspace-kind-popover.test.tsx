/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { WorkspaceKindPopover } from "../client/workspace-kind-popover.js";

describe("WorkspaceKindPopover", () => {
  afterEach(() => {
    cleanup();
  });

  const theme = {
    colors: {
      surface0: "#111",
      surface1: "#222",
      surface2: "#333",
      border: "#444",
      foreground: "#fff",
      foregroundMuted: "#888",
      accent: "#38bdf8",
    },
  } as any;

  it("renders worktree details cleanly", () => {
    const { getByText, getAllByText } = render(
      <WorkspaceKindPopover
        workspaceId="ws-wt-1"
        workspace={{
          id: "ws-wt-1",
          name: "feat/my-branch",
          currentBranch: "feat/my-branch",
          projectDisplayName: "Paseo Project",
          workspaceDirectory: "/Users/jerry/.paseo/worktrees/01v9/my-branch",
          workspaceKind: "worktree",
        }}
        isWorktree={true}
        theme={theme}
        host={{ id: "host-1", label: "Local" }}
        layout={{ compact: false, platform: "web" }}
        close={vi.fn()}
        context="workspace"
      />,
    );

    expect(getByText("Git Worktree")).toBeDefined();
    expect(getAllByText("feat/my-branch").length).toBeGreaterThanOrEqual(1);
    expect(getByText("Paseo Project")).toBeDefined();
    expect(getByText("/Users/jerry/.paseo/worktrees/01v9/my-branch")).toBeDefined();
  });

  it("renders local checkout details cleanly", () => {
    const { getByText, getAllByText } = render(
      <WorkspaceKindPopover
        workspaceId="ws-local-1"
        workspace={{
          id: "ws-local-1",
          name: "main",
          currentBranch: "main",
          projectDisplayName: "Paseo Project",
          workspaceDirectory: "/Users/jerry/projects/paseo",
          workspaceKind: "local_checkout",
        }}
        isWorktree={false}
        theme={theme}
        host={{ id: "host-1", label: "Local" }}
        layout={{ compact: false, platform: "web" }}
        close={vi.fn()}
        context="workspace"
      />,
    );

    expect(getByText("Local Checkout")).toBeDefined();
    expect(getAllByText("main").length).toBeGreaterThanOrEqual(1);
    expect(getByText("Paseo Project")).toBeDefined();
    expect(getByText("/Users/jerry/projects/paseo")).toBeDefined();
  });
});
