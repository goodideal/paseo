/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceReaderScreen } from "./workspace-reader-screen";
import type { UseWorkspaceEvolutionResult } from "@/hooks/use-workspace-evolution";

const { evolutionState } = vi.hoisted(() => ({
  evolutionState: {
    current: {
      digest: null,
      isLoading: true,
      isAnalyzing: false,
      error: null,
      refresh: vi.fn(),
    } as UseWorkspaceEvolutionResult,
  },
}));

vi.mock("@/hooks/use-workspace-evolution", () => ({
  useWorkspaceEvolution: () => evolutionState.current,
}));

vi.mock("lucide-react-native", () => ({
  __esModule: true,
  default: new Proxy(
    {},
    { get: (_, prop) => () => React.createElement("span", { "data-icon": String(prop) }) },
  ),
  GitBranch: () => React.createElement("span", { "data-icon": "GitBranch" }),
  RefreshCw: () => React.createElement("span", { "data-icon": "RefreshCw" }),
  BookOpen: () => React.createElement("span", { "data-icon": "BookOpen" }),
  Sparkles: () => React.createElement("span", { "data-icon": "Sparkles" }),
  Layers: () => React.createElement("span", { "data-icon": "Layers" }),
  Activity: () => React.createElement("span", { "data-icon": "Activity" }),
  CheckCircle2: () => React.createElement("span", { "data-icon": "CheckCircle2" }),
  Clock: () => React.createElement("span", { "data-icon": "Clock" }),
  ArrowRight: () => React.createElement("span", { "data-icon": "ArrowRight" }),
  Bot: () => React.createElement("span", { "data-icon": "Bot" }),
  AlertCircle: () => React.createElement("span", { "data-icon": "AlertCircle" }),
  Loader2: () => React.createElement("span", { "data-icon": "Loader2" }),
  FileCode: () => React.createElement("span", { "data-icon": "FileCode" }),
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => React.createElement("span", null, "Loading..."),
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const passthrough = ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("div", props, children);
  return {
    ...actual,
    View: passthrough,
    Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement("span", props, children),
    ScrollView: passthrough,
    Pressable: ({
      children,
      onPress,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      [key: string]: unknown;
    }) => React.createElement("button", { type: "button", onClick: onPress, ...props }, children),
  };
});

describe("WorkspaceReaderScreen", () => {
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

  it("renders loading state when digest is null and isLoading is true", async () => {
    evolutionState.current = {
      digest: null,
      isLoading: true,
      isAnalyzing: false,
      error: null,
      refresh: vi.fn(),
    };

    await act(async () => {
      root.render(<WorkspaceReaderScreen serverId="test-server" workspaceId="wks_1" />);
    });

    expect(container.textContent).toContain("正在分析工作区演进脉络");
  });

  it("renders executive summary and milestones when digest is loaded", async () => {
    evolutionState.current = {
      digest: {
        workspaceId: "wks_1",
        workspaceTitle: "glorious-eagle",
        branch: "feat/cluster",
        executiveSummary: "完成架构调研与核心代码改造",
        currentStage: "质量评审中",
        overallStatus: "ready_for_review",
        updatedAt: new Date().toISOString(),
        milestones: [
          {
            agentId: "agent-1",
            provider: "codex",
            model: "gemini-flash",
            startedAt: "2026-09-27T01:00:00.000Z",
            completedAt: "2026-09-27T01:30:00.000Z",
            durationMs: 1800000,
            status: "completed",
            intentPrompt: "调研 DocDB 集群部署方式",
            executiveSummary: "完成集群方案调研，推荐 Raft + S3",
            keyDecisions: ["使用 S3 共享存储", "对外提供 MongoDB 4.2 wire 协议"],
            modifiedFiles: ["docs/arch/docdb.md"],
            commits: [{ hash: "abc1234", message: "docs: add cluster spec" }],
          },
        ],
      },
      isLoading: false,
      isAnalyzing: false,
      error: null,
      refresh: vi.fn(),
    };

    await act(async () => {
      root.render(<WorkspaceReaderScreen serverId="test-server" workspaceId="wks_1" />);
    });

    expect(container.textContent).toContain("glorious-eagle");
    expect(container.textContent).toContain("feat/cluster");
    expect(container.textContent).toContain("工作区演进综述");
    expect(container.textContent).toContain("完成架构调研与核心代码改造");
    expect(container.textContent).toContain("调研 DocDB 集群部署方式");
    expect(container.textContent).toContain("使用 S3 共享存储");
  });
});
