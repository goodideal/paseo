// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { DecisionCard } from "../client/components/decision-card.js";
import { ActionButtons } from "../client/components/action-buttons.js";
import { PipelineView } from "../client/components/pipeline-view.js";
import { TopologyView } from "../client/components/topology-view.js";
import contribute from "../index.client.js";

const mockSubmit = vi.fn().mockResolvedValue({ success: true });
const mockGetSnapshot = vi.fn();
const mockToggleAutoContinue = vi.fn();

vi.mock("../client/hooks/use-decision-rpc.js", () => ({
  useDecisionRpc: () => ({
    submitDecision: mockSubmit,
    isSubmitting: false,
    error: null,
  }),
}));

vi.mock("@getpaseo/plugin/client", async () => {
  return {
    useRpc: (contract: any) => {
      if (contract?.name === "radar.get_snapshot") return mockGetSnapshot;
      if (contract?.name === "radar.toggle_auto_continue") return mockToggleAutoContinue;
      return vi.fn();
    },
    useSettings: vi.fn(),
  };
});

describe("ActionButtons Component", () => {
  const options = [
    { id: "opt1", label: "Retry", description: "", actionType: "retry_with_tip" as const },
    { id: "opt2", label: "Cancel", description: "", actionType: "pause" as const },
  ];

  it("renders primary and secondary options", () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<ActionButtons options={options} onSelect={onSelect} />);

    expect(screen.getByText("Retry")).toBeDefined();
    expect(screen.getByText("Cancel")).toBeDefined();
  });

  it("calls onSelect when pressed", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<ActionButtons options={options} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("Retry"));
    expect(onSelect).toHaveBeenCalledWith("opt1");
  });
});

describe("DecisionCard Component", () => {
  const mockItem = {
    type: "plugin" as const,
    kind: "watchdog-blocker",
    version: 1,
    data: {
      agentId: "agent-123",
      summary: "Agent blocked on test",
      rootCause: "Tests failed 3 times",
      options: [
        {
          id: "opt1",
          label: "Fix it",
          description: "Fix tests",
          actionType: "retry_with_tip" as const,
        },
      ],
      timestamp: new Date().toISOString(),
    },
  };

  const layout = { platform: "web" as const, compact: false };
  const host = { id: "host", label: "Host" };
  const theme: Parameters<typeof DecisionCard>[0]["theme"] = null!;

  it("renders pending state initially", () => {
    render(
      <DecisionCard
        item={mockItem}
        agentId="agent-123"
        timestamp={new Date()}
        layout={layout}
        host={host}
        theme={theme}
      />,
    );

    expect(screen.getByText("待决策")).toBeDefined();
    expect(screen.getByText(/Agent blocked on test/)).toBeDefined();
    expect(screen.getByText("Tests failed 3 times")).toBeDefined();
  });

  it("updates to resolved state after successful action", async () => {
    render(
      <DecisionCard
        item={mockItem}
        agentId="agent-123"
        timestamp={new Date()}
        layout={layout}
        host={host}
        theme={theme}
      />,
    );

    fireEvent.click(screen.getByText("Fix it"));

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith({
        agentId: "agent-123",
        optionId: "opt1",
      });
      expect(screen.getByText("已恢复")).toBeDefined();
      expect(screen.getByText(/已选择执行: Fix it/)).toBeDefined();
    });
  });

  it("renders gentle confirmation copy when blocker is an auto-turn limit pause", () => {
    const turnLimitItem = {
      type: "plugin" as const,
      kind: "watchdog-blocker",
      version: 1,
      data: {
        agentId: "agent-123",
        summary: "Agent execution paused",
        rootCause: "Reached auto-turn limit of 5 turns",
        options: [
          {
            id: "continue",
            label: "继续推进",
            description: "授权继续按原定计划推进",
            actionType: "retry_with_tip" as const,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    };

    render(
      <DecisionCard
        item={turnLimitItem}
        agentId="agent-123"
        timestamp={new Date()}
        layout={layout}
        host={host}
        theme={theme}
      />,
    );

    expect(screen.getByText("⚡ 自动推进 · 阶段性停顿确认")).toBeDefined();
    expect(screen.getByText("ℹ️ 停顿提示")).toBeDefined();
    expect(screen.getByText("💡 请选择后续操作：")).toBeDefined();
    expect(screen.getByText("继续推进")).toBeDefined();
  });
});

describe("RadarPanelHost Component", () => {
  it("renders per-agent auto-continue toggle and triggers toggle RPC on press", async () => {
    const { RadarPanelHost } = await import("../client/components/radar-panel.js");

    mockGetSnapshot.mockResolvedValue({
      mode: "generic",
      topology: {
        rootAgentId: "agent-test-1",
        nodes: {
          "agent-test-1": {
            agentId: "agent-test-1",
            title: "Test Agent",
            status: "running",
            childAgentIds: [],
          },
        },
      },
      watchdog: {
        activeHeartbeat: null,
        activeBlocker: null,
        autoTurnCount: 1,
        maxAutoTurns: 5,
        agentAutoContinueEnabled: true,
      },
    });

    mockToggleAutoContinue.mockResolvedValue({
      agentId: "agent-test-1",
      enabled: false,
    });

    render(
      <RadarPanelHost
        agentId="agent-test-1"
        workspaceId="wks-1"
        layout={{ platform: "web", compact: false }}
        host={{ id: "host", label: "Host" }}
        theme={null!}
        context={{} as any}
      />,
    );

    // Verify initial auto-continue pill renders with enabled text
    await waitFor(() => {
      expect(screen.getByText("⚡ 自动推进：开")).toBeDefined();
    });

    // Click toggle
    fireEvent.click(screen.getByText("⚡ 自动推进：开"));

    await waitFor(() => {
      expect(mockToggleAutoContinue).toHaveBeenCalledWith({ agentId: "agent-test-1" });
      expect(screen.getByText("⏸️ 自动推进：关")).toBeDefined();
    });
  });
});

describe("PipelineView & TopologyView Components", () => {
  it("renders Superpower pipeline when snapshot mode is superpower", () => {
    const mockSuperpower = {
      planSlug: "feature-radar",
      planPath: "docs/superpowers/plans/feature-radar.md",
      tasks: [
        {
          id: "task-1",
          title: "Scaffold radar plugin",
          status: "completed" as const,
          commits: ["abc1234"],
        },
        {
          id: "task-2",
          title: "Build client panel",
          status: "fixing" as const,
          currentRound: 2,
          maxRounds: 5,
        },
      ],
      currentTaskId: "task-2",
    };

    render(
      <PipelineView superpower={mockSuperpower} onSelectTask={() => {}} selectedTaskId="task-2" />,
    );

    expect(screen.getByText("Scaffold radar plugin")).toBeDefined();
    expect(screen.getByText("Build client panel")).toBeDefined();
    expect(screen.getByText(/Fix 2\/5/)).toBeDefined();
  });

  it("renders Topology view when snapshot mode is generic", () => {
    const mockTopology = {
      rootAgentId: "agent-root",
      nodes: {
        "agent-root": {
          agentId: "agent-root",
          title: "Root Controller",
          status: "running" as const,
          childAgentIds: ["agent-sub-1"],
          durationMs: 0,
        },
        "agent-sub-1": {
          agentId: "agent-sub-1",
          parentAgentId: "agent-root",
          title: "Implementer Worker",
          status: "running" as const,
          runningTool: "vitest run",
          durationMs: 16000,
          childAgentIds: [],
        },
      },
    };

    render(
      <TopologyView topology={mockTopology} onSelectNode={() => {}} selectedNodeId="agent-sub-1" />,
    );

    expect(screen.getByText("Root Controller")).toBeDefined();
    expect(screen.getByText("Implementer Worker")).toBeDefined();
    expect(screen.getByText(/vitest run/)).toBeDefined();
  });
});

describe("Agent Radar Client Contribution", () => {
  it("registers valid timeline renderers, workspace panel, settings screen, and command center item", () => {
    const renderers: any[] = [];
    const panels: any[] = [];
    const settingsScreens: any[] = [];
    const commandCenterItems: any[] = [];

    const mockClient: any = {
      addTimelineRenderer: vi.fn((r) => {
        renderers.push(r);
        return () => {};
      }),
      addWorkspacePanel: vi.fn((p) => {
        panels.push(p);
        return () => {};
      }),
      addSettingsScreen: vi.fn((s) => {
        settingsScreens.push(s);
        return () => {};
      }),
      addCommandCenterItem: vi.fn((c) => {
        commandCenterItems.push(c);
        return () => {};
      }),
    };

    const cleanupFn = contribute(mockClient);
    expect(mockClient.addTimelineRenderer).toHaveBeenCalled();
    expect(mockClient.addWorkspacePanel).toHaveBeenCalled();
    expect(mockClient.addSettingsScreen).toHaveBeenCalled();
    expect(mockClient.addCommandCenterItem).toHaveBeenCalled();

    // Verify timeline renderers
    expect(renderers.length).toBe(2);
    expect(renderers.map((r) => r.kind)).toEqual(["watchdog-blocker", "radar-blocker"]);

    // Verify workspace panel ID and PascalCase Lucide icon
    const panel = panels[0];
    expect(panel).toBeDefined();
    expect(panel.id).toBe("agent-radar-panel");
    expect(panel.icon).toBe("Activity");

    // Verify settings screen
    const settingsScreen = settingsScreens[0];
    expect(settingsScreen).toBeDefined();
    expect(settingsScreen.id).toBe("agent-radar-settings");
    expect(settingsScreen.title).toBe("Agent Radar");
    expect(settingsScreen.icon).toBe("Activity");

    // Verify command center item
    const commandItem = commandCenterItems[0];
    expect(commandItem).toBeDefined();
    expect(commandItem.id).toBe("agent-radar-settings-command");
    expect(commandItem.icon).toBe("Activity");

    const mockOpenSettings = vi.fn();
    commandItem.onSelect({ openSettings: mockOpenSettings });
    expect(mockOpenSettings).toHaveBeenCalledWith("agent-radar-settings");

    expect(typeof cleanupFn).toBe("function");
    expect(() => cleanupFn()).not.toThrow();
  });
});

afterEach(cleanup);
