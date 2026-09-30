// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@getpaseo/plugin/client/ui", () => ({
  SettingsSection: ({ title, children }: any) => (
    <div data-testid="settings-section">
      <h3>{title}</h3>
      {children}
    </div>
  ),
  SettingsCard: ({ children }: any) => <div data-testid="settings-card">{children}</div>,
  SettingsRow: ({ label, hint, children }: any) => (
    <div data-testid="settings-row">
      <span>{label}</span>
      {hint && <small>{hint}</small>}
      {children}
    </div>
  ),
  SettingsSwitch: ({ label, value, onValueChange, disabled }: any) => (
    <label>
      {label}
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onValueChange(Boolean((e.target as { checked?: boolean }).checked))}
      />
    </label>
  ),
  SettingsSelect: ({ label, value, options, onValueChange, disabled }: any) => (
    <label>
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange(String((e.target as { value?: string }).value))}
      >
        {options.map((opt: any) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  ),
  SettingsInput: ({ label, initialValue, onChangeText, disabled }: any) => (
    <label>
      {label}
      <input
        type="text"
        defaultValue={initialValue}
        disabled={disabled}
        onChange={(e) => onChangeText(String((e.target as { value?: string }).value))}
      />
    </label>
  ),
  SettingsAction: ({ label, actionLabel, onPress, disabled }: any) => (
    <div>
      {label && <span>{label}</span>}
      <button type="button" disabled={disabled} onClick={onPress}>
        {actionLabel}
      </button>
    </div>
  ),
}));

import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
import { HostSettingsScreen } from "../client/host-settings.js";
import { ProjectDetailSettings } from "../client/project-detail-settings.js";

describe("HostSettingsScreen", () => {
  it("renders settings controls and allows toggling global automation", async () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const mockSettings = {
      status: "ready" as const,
      values: {
        enabled: false,
        pollIntervalSeconds: 60,
        maxConcurrentRuns: 3,
        maxAutomaticRepairCycles: 2,
        automationProfile: "claude-code",
        workflowPolicy: "full_superpowers" as const,
        projects: {},
        inProgressLabel: "agent-in-progress",
        reviewedLabel: "agent-reviewed",
        evidenceRetentionDays: 90,
      },
      revision: "rev-1",
      saving: false,
      saveError: null,
      save: mockSave,
      reload: vi.fn(),
      reset: vi.fn(),
    };

    render(
      <HostSettingsScreen
        theme={{ colors: { foreground: "#000", surface0: "#fff" } } as any}
        host={{ id: "h1", label: "Local" }}
        layout={{ compact: false, platform: "web" }}
        settingsOverride={mockSettings as any}
        diagnosticsOverride={[]}
      />,
    );

    (globalThis as unknown as { confirm: (msg: string) => boolean }).confirm = vi
      .fn()
      .mockReturnValue(true);
    expect(screen.getByText("自动处理 Issue")).toBeDefined();
    const switchControl = screen.getByTestId("global-enabled-switch");
    fireEvent.click(switchControl);

    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }), "rev-1");
  });

  it("renders discovered projects when diagnostics are returned via RPC", async () => {
    const mockSettings = {
      status: "ready" as const,
      values: {
        enabled: true,
        pollIntervalSeconds: 60,
        maxConcurrentRuns: 3,
        maxAutomaticRepairCycles: 2,
        automationProfile: "claude-code",
        workflowPolicy: "full_superpowers" as const,
        projects: {},
        inProgressLabel: "agent-in-progress",
        reviewedLabel: "agent-reviewed",
        evidenceRetentionDays: 90,
      },
      revision: "rev-1",
      saving: false,
      saveError: null,
      save: vi.fn(),
      reload: vi.fn(),
      reset: vi.fn(),
    };

    const mockRpc = vi.fn().mockResolvedValue({
      diagnostics: [
        {
          projectId: "prj_ecommerce",
          projectName: "ecommerce-store",
          host: "gitea.local",
          baseUrl: "http://gitea.local",
          repoOwner: "shop",
          repoName: "store",
          connectionStatus: "connected",
          authSource: "tea",
          authorized: false,
          readyLabel: "agent-ready",
          pendingIssueCount: 3,
        },
        {
          projectId: "prj_github_app",
          projectName: "external-app",
          host: "",
          baseUrl: "",
          repoOwner: "",
          repoName: "",
          connectionStatus: "not_gitea",
          authSource: "none",
          authorized: false,
          readyLabel: "agent-ready",
        },
      ],
    });

    const mockUseRpc = vi.fn().mockReturnValue(mockRpc);

    render(
      <HostSettingsScreen
        theme={{ colors: { foreground: "#000", surface0: "#fff" } } as any}
        host={{ id: "h1", label: "Local" }}
        layout={{ compact: false, platform: "web" }}
        settingsOverride={mockSettings as any}
        useRpcHook={mockUseRpc as any}
      />,
    );

    expect(await screen.findByText("ecommerce-store")).toBeDefined();
    expect(screen.getByText("已连接 (tea) · 3 个待办")).toBeDefined();
    expect(screen.getByText("external-app")).toBeDefined();
    expect(screen.getByText("非 Gitea 远端")).toBeDefined();
    expect(screen.getByText("Agent Auto (全自动模式)")).toBeDefined();
    expect(screen.getByText("Agent Plan (规划审查模式)")).toBeDefined();
  });

  it("renders permission scope selector in HostSettingsScreen and allows changing it", () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const mockSettings = {
      status: "ready" as const,
      values: {
        enabled: true,
        pollIntervalSeconds: 60,
        maxConcurrentRuns: 3,
        maxAutomaticRepairCycles: 2,
        automationProfile: "claude-code",
        agentProvider: "claude",
        agentModel: "",
        agentPermissionScope: "workspace_controlled",
        workflowPolicy: "full_superpowers" as const,
        projects: {},
        inProgressLabel: "agent-in-progress",
        reviewedLabel: "agent-reviewed",
        evidenceRetentionDays: 90,
      },
      revision: "rev-1",
      saving: false,
      saveError: null,
      save: mockSave,
      reload: vi.fn(),
      reset: vi.fn(),
    };

    render(
      <HostSettingsScreen
        theme={{ colors: { foreground: "#000", surface0: "#fff" } } as any}
        host={{ id: "h1", label: "Local" }}
        layout={{ compact: false, platform: "web" }}
        settingsOverride={mockSettings as any}
        diagnosticsOverride={[]}
      />,
    );

    expect(screen.getByText("全局授权范围")).toBeDefined();
    const select = screen.getByDisplayValue("受控执行 (修改代码与测试，推送需审批) [推荐]");
    fireEvent.change(select, { target: { value: "read_only" } });

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ agentPermissionScope: "read_only" }),
      "rev-1",
    );
  });

  describe("ProjectDetailSettings", () => {
    it("renders trigger tag descriptions and removes readyLabel input", () => {
      const mockSettings = {
        values: {
          projects: {
            "proj-1": { enabled: true, readyLabel: "agent-ready" },
          },
        },
        revision: "rev-1",
        saving: false,
        save: vi.fn(),
      };

      render(
        <ProjectDetailSettings
          projectId="proj-1"
          settings={mockSettings}
          theme={
            {
              colors: {
                foreground: "#000",
                foregroundMuted: "#888",
                statusSuccess: "green",
                statusDanger: "red",
              },
            } as any
          }
          onBack={vi.fn()}
        />,
      );

      // Verify trigger tag instructions exist
      expect(screen.getByText("Agent Auto (全自动模式)")).toBeDefined();
      expect(screen.getByText("Agent Plan (规划审查模式)")).toBeDefined();

      // Verify "启动标签" or "agent-ready" input is NOT rendered
      expect(screen.queryByText("启动标签")).toBeNull();
      expect(screen.queryByDisplayValue("agent-ready")).toBeNull();
    });

    it("renders permission scope override selector in ProjectDetailSettings and allows changing it", () => {
      const mockSave = vi.fn().mockResolvedValue(true);
      const mockSettings = {
        values: {
          projects: {
            "proj-1": { enabled: true, readyLabel: "agent-ready" },
          },
        },
        revision: "rev-1",
        saving: false,
        save: mockSave,
      };

      render(
        <ProjectDetailSettings
          projectId="proj-1"
          settings={mockSettings}
          theme={
            {
              colors: {
                foreground: "#000",
                foregroundMuted: "#888",
                statusSuccess: "green",
                statusDanger: "red",
              },
            } as any
          }
          onBack={vi.fn()}
        />,
      );

      expect(screen.getByText("项目授权范围覆盖 (可选)")).toBeDefined();
      const elem = screen.getByText("项目授权范围覆盖 (可选)") as any;
      const select = elem.parentElement?.querySelector("select");
      expect(select).not.toBeNull();
      fireEvent.change(select!, { target: { value: "read_only" } });

      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: expect.objectContaining({
            "proj-1": expect.objectContaining({
              agentPermissionScopeOverride: "read_only",
            }),
          }),
        }),
        "rev-1",
      );
    });
  });
});
