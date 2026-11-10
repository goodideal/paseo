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

vi.mock("@/screens/workspace/scripts", () => ({
  WorkspaceScriptsButton: () => null,
}));

vi.mock("@/components/headers/menu-header", () => ({
  SidebarMenuToggle: () => null,
}));

import { WorkspaceHeaderTitleBar } from "./workspace-header-title-bar";

function renderTitleBar(
  root: Root,
  props?: Partial<React.ComponentProps<typeof WorkspaceHeaderTitleBar>>,
) {
  const noop = vi.fn();
  return root.render(
    <WorkspaceHeaderTitleBar
      isLoading={false}
      title="feat/worktree-branch"
      subtitle="Main Project"
      isSubtitleDistinct={true}
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
      onCreateTerminalWithProfile={noop}
      onCreateBrowser={noop}
      onOpenImportSheet={noop}
      onCopyWorkspacePath={noop}
      onCopyBranchName={noop}
      onOpenSetupTab={noop}
      onScriptTerminalStarted={noop}
      onViewScriptTerminal={noop}
      onOpenUrlInBrowserTab={noop}
      {...props}
    />,
  );
}

describe("WorkspaceHeaderTitleBar", () => {
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

  it("renders title and subtitle correctly", async () => {
    await act(async () => {
      renderTitleBar(root!);
    });

    const title = container?.querySelector('[data-testid="workspace-header-title"]');
    const subtitle = container?.querySelector('[data-testid="workspace-header-subtitle"]');
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe("feat/worktree-branch");
    expect(subtitle).not.toBeNull();
    expect(subtitle?.textContent).toBe("Main Project");
  });

  it("does not render subtitle when isSubtitleDistinct is false", async () => {
    await act(async () => {
      renderTitleBar(root!, { isSubtitleDistinct: false });
    });

    const title = container?.querySelector('[data-testid="workspace-header-title"]');
    const subtitle = container?.querySelector('[data-testid="workspace-header-subtitle"]');
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe("feat/worktree-branch");
    expect(subtitle).toBeNull();
  });

  it("does not render worktree indicator", async () => {
    await act(async () => {
      renderTitleBar(root!);
    });

    const indicator = container?.querySelector(
      '[data-testid="workspace-header-worktree-indicator"]',
    );
    expect(indicator).toBeNull();
  });
});
