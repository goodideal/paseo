/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hosts/use-host-badges", () => ({
  useHostBadges: () => new Map(),
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({ config: null }),
}));

vi.mock("@/screens/workspace/workspace-header-menu", () => ({
  WorkspaceHeaderMenuDesktop: () => null,
  WorkspaceHeaderMenuMobile: () => null,
}));

vi.mock("@/screens/workspace/workspace-scripts-button", () => ({
  WorkspaceScriptsButton: () => null,
}));

vi.mock("@/components/headers/menu-header", () => ({
  SidebarMenuToggle: () => null,
}));

import { WorkspaceHeaderTitleBar } from "./workspace-header-title-bar";

function renderTitleBar(isWorktree: boolean, root: Root) {
  const noop = vi.fn();
  return root.render(
    <WorkspaceHeaderTitleBar
      isLoading={false}
      title="feat/worktree-branch"
      subtitle="Main Project"
      isSubtitleDistinct={true}
      isWorktree={isWorktree}
      currentBranchName="feat/worktree-branch"
      normalizedServerId="host"
      normalizedWorkspaceId="ws-1"
      workspaceScripts={[]}
      liveTerminalIds={[]}
      showWorkspaceSetup={false}
      showCreateBrowserTab={false}
      isMobile={false}
      createTerminalDisabled={false}
      importAgentDisabled={false}
      copyPathDisabled={false}
      onCreateDraftTab={noop}
      onCreateTerminal={noop}
      onCreateTerminalWithProfile={noop}
      onCreateBrowser={noop}
      onOpenImportSheet={noop}
      onCopyWorkspacePath={noop}
      onCopyBranchName={noop}
      onOpenSetupTab={noop}
      onScriptTerminalStarted={noop}
      onViewScriptTerminal={noop}
      onOpenUrlInBrowserTab={noop}
    />,
  );
}

describe("WorkspaceHeaderTitleBar worktree indicator", () => {
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

  it("renders worktree indicator when isWorktree is true", async () => {
    await act(async () => {
      renderTitleBar(true, root!);
    });

    const indicator = container?.querySelector(
      '[data-testid="workspace-header-worktree-indicator"]',
    );
    const title = container?.querySelector('[data-testid="workspace-header-title"]');
    expect(indicator).not.toBeNull();
    expect(indicator?.getAttribute("aria-label")).toBe("Worktree");
    expect(title).not.toBeNull();
    expect(indicator?.compareDocumentPosition(title!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("does not render worktree indicator when isWorktree is false", async () => {
    await act(async () => {
      renderTitleBar(false, root!);
    });

    const indicator = container?.querySelector(
      '[data-testid="workspace-header-worktree-indicator"]',
    );
    expect(indicator).toBeNull();
  });
});
