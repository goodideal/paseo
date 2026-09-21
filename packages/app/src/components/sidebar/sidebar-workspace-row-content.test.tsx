/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({
    settings: { workspaceTitleSource: "title" },
  }),
}));

vi.mock("@/workspace-labels", () => ({
  useWorkspaceLabelDefinitions: () => [],
}));

vi.mock("@/components/sidebar/workspace-meta-row", () => ({
  WorkspaceMetaRow: () => null,
}));

vi.mock("@/components/sidebar/project-leading-visual", () => ({
  ProjectStatusIndicator: () => null,
}));

vi.mock("@/components/status-ring", () => ({
  StatusRing: () => null,
}));

vi.mock("@/components/workspace-hover-card", () => ({
  WorkspaceHoverCard: ({ children }: { children: React.ReactNode }) =>
    children as React.ReactElement,
}));

vi.mock("@/components/ui/trailing-action-scrim", () => ({
  TrailingActionScrim: () => null,
}));

import { SidebarWorkspaceRowContent } from "./sidebar-workspace-row-content";

function makeWorkspace(
  kind: "worktree" | "local_checkout" | "directory" = "worktree",
): SidebarWorkspaceEntry {
  return {
    workspaceKey: "host:ws-1",
    serverId: "host",
    workspaceId: "ws-1",
    projectViewKey: "project",
    projectName: "Project",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo/ws-1",
    workspaceDirectoryLabel: "ws-1",
    projectKind: "git",
    workspaceKind: kind,
    name: "feat/my-worktree",
    title: null,
    pinnedAt: null,
    labels: [],
    currentBranch: "feat/my-worktree",
    statusBucket: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
  };
}

describe("SidebarWorkspaceRowContent worktree indicator", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("renders worktree indicator when workspaceKind is worktree", async () => {
    await act(async () => {
      root?.render(
        <SidebarWorkspaceRowContent
          workspace={makeWorkspace("worktree")}
          backdrop="surfaceSidebar"
          isHovered={false}
          isLoading={false}
        />,
      );
    });

    const indicator = container?.querySelector(
      '[data-testid="sidebar-workspace-worktree-indicator"]',
    );
    expect(indicator).not.toBeNull();
    expect(indicator?.getAttribute("aria-label")).toBe("Worktree");
  });

  it("does not render worktree indicator when workspaceKind is local_checkout", async () => {
    await act(async () => {
      root?.render(
        <SidebarWorkspaceRowContent
          workspace={makeWorkspace("local_checkout")}
          backdrop="surfaceSidebar"
          isHovered={false}
          isLoading={false}
        />,
      );
    });

    const indicator = container?.querySelector(
      '[data-testid="sidebar-workspace-worktree-indicator"]',
    );
    expect(indicator).toBeNull();
  });

  it("does not render worktree indicator when workspaceKind is directory", async () => {
    await act(async () => {
      root?.render(
        <SidebarWorkspaceRowContent
          workspace={makeWorkspace("directory")}
          backdrop="surfaceSidebar"
          isHovered={false}
          isLoading={false}
        />,
      );
    });

    const indicator = container?.querySelector(
      '[data-testid="sidebar-workspace-worktree-indicator"]',
    );
    expect(indicator).toBeNull();
  });
});
