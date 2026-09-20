import { i18n as testI18n } from "@/i18n/i18next";
void testI18n;
// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSessionStore } from "@/stores/session-store";
import { QuickPromptsModal } from "./modal";
import { DEFAULT_QUICK_PROMPT_ITEMS } from "@getpaseo/protocol/quick-prompts";

vi.mock("react-native-reanimated", () => ({
  default: {
    View: "div",
  },
  Easing: {
    ease: "ease",
    inOut: (value: unknown) => value,
  },
  interpolateColor: (value: number, _input: number[], output: string[]) =>
    value >= 1 ? output[1] : output[0],
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useDerivedValue: (factory: () => unknown) => ({ value: factory() }),
  withTiming: (value: unknown) => value,
}));

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

describe("QuickPromptsModal", () => {
  let queryClient: QueryClient;
  let mockClient: {
    quickPromptsGlobalGet: ReturnType<typeof vi.fn>;
    quickPromptsGlobalSet: ReturnType<typeof vi.fn>;
    quickPromptsProjectGet: ReturnType<typeof vi.fn>;
    quickPromptsProjectSet: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    queryClient = createTestQueryClient();
    mockClient = {
      quickPromptsGlobalGet: vi.fn().mockResolvedValue({
        items: [...DEFAULT_QUICK_PROMPT_ITEMS],
      }),
      quickPromptsGlobalSet: vi.fn().mockResolvedValue({
        items: [...DEFAULT_QUICK_PROMPT_ITEMS],
        success: true,
      }),
      quickPromptsProjectGet: vi.fn().mockResolvedValue({
        projectId: "prj_test",
        items: [
          {
            id: "prj_cmd_1",
            label: "Test Project Cmd",
            content: "run project tests",
            triggerType: "fixed" as const,
            enabled: true,
            createdAt: 100,
            order: 0,
          },
        ],
        disabledGlobalIds: ["builtin-continue"],
      }),
      quickPromptsProjectSet: vi.fn().mockResolvedValue({
        projectId: "prj_test",
        items: [],
        disabledGlobalIds: [],
        success: true,
      }),
      on: vi.fn().mockReturnValue(() => {}),
    };

    useSessionStore.getState().clearSession("server-1");
    useSessionStore
      .getState()
      .initializeSession(
        "server-1",
        mockClient as unknown as import("@getpaseo/client/internal/daemon-client").DaemonClient,
      );
    useSessionStore.getState().setWorkspaces(
      "server-1",
      new Map([
        [
          "ws_1",
          {
            id: "ws_1",
            projectId: "prj_test",
            projectDisplayName: "My Project",
            name: "main",
            workspaceDirectory: "/repo",
            projectRootPath: "/repo",
            projectKind: "git",
            workspaceKind: "worktree",
            status: "ready",
            statusEnteredAt: new Date(),
            archivingAt: null,
            diffStat: null,
            scripts: [],
          } as unknown as import("@/stores/session-store").WorkspaceDescriptor,
        ],
      ]),
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("renders global list of items and actions when visible without project scope", async () => {
    const { findByTestId, findByText } = render(
      <QueryClientProvider client={queryClient}>
        <QuickPromptsModal visible={true} onClose={vi.fn()} serverId="server-1" />
      </QueryClientProvider>,
    );

    expect(await findByTestId("quick-prompt-create-button")).toBeDefined();
    expect(await findByTestId("quick-prompt-reset-button")).toBeDefined();
    expect(await findByText("Continue")).toBeDefined();
    expect(await findByText("Fix Error")).toBeDefined();
  });

  it("renders project tab with project items and inherited global items when in project workspace", async () => {
    const { findByTestId, findByText } = render(
      <QueryClientProvider client={queryClient}>
        <QuickPromptsModal
          visible={true}
          onClose={vi.fn()}
          serverId="server-1"
          workspaceId="ws_1"
        />
      </QueryClientProvider>,
    );

    // Project item is visible
    expect(await findByText("Test Project Cmd")).toBeDefined();
    // Inherited global item is visible
    expect(await findByText("Continue")).toBeDefined();
    // Jump to global button is present on inherited item
    expect(await findByTestId("quick-prompt-jump-builtin-continue")).toBeDefined();
  });

  it("switches to create form on create button click", async () => {
    const { findByTestId, queryByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <QuickPromptsModal visible={true} onClose={vi.fn()} serverId="server-1" />
      </QueryClientProvider>,
    );

    const createBtn = await findByTestId("quick-prompt-create-button");
    fireEvent.click(createBtn);

    expect(await findByTestId("quick-prompt-form-label")).toBeDefined();
    expect(await findByTestId("quick-prompt-form-content")).toBeDefined();
    expect(queryByTestId("quick-prompt-create-button")).toBeNull();
  });

  it("calls global set when toggling an item in global mode", async () => {
    const { findByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <QuickPromptsModal visible={true} onClose={vi.fn()} serverId="server-1" />
      </QueryClientProvider>,
    );

    const toggle = await findByTestId("quick-prompt-toggle-builtin-continue");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockClient.quickPromptsGlobalSet).toHaveBeenCalled();
    });
  });

  it("calls project set when toggling an inherited global item in project tab", async () => {
    const { findByTestId, findByText } = render(
      <QueryClientProvider client={queryClient}>
        <QuickPromptsModal
          visible={true}
          onClose={vi.fn()}
          serverId="server-1"
          workspaceId="ws_1"
        />
      </QueryClientProvider>,
    );

    // Wait for project query to finish loading
    await findByText("Test Project Cmd");

    const toggle = await findByTestId("quick-prompt-toggle-builtin-continue");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockClient.quickPromptsProjectSet).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "prj_test",
          disabledGlobalIds: [], // toggled from disabled -> enabled
        }),
      );
    });
  });
});
