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
  SettingsInput: ({ label, initialValue, onChangeText, disabled, multiline }: any) => (
    <label>
      {label}
      {multiline ? (
        <textarea
          aria-label={label}
          defaultValue={initialValue}
          disabled={disabled}
          onChange={(e) => onChangeText(String((e.target as { value?: string }).value))}
        />
      ) : (
        <input
          aria-label={label}
          type="text"
          defaultValue={initialValue}
          disabled={disabled}
          onChange={(e) => onChangeText(String((e.target as { value?: string }).value))}
        />
      )}
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
import { DEFAULT_AGENT_AUTO_PROMPT, DEFAULT_AGENT_PLAN_PROMPT } from "../shared/prompts.js";

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
        workflowPolicy: "direct_pr" as const,
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
        workflowPolicy: "direct_pr" as const,
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

  it("renders agent change mode selector in HostSettingsScreen and allows selecting Codex full-access", () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const mockSettings = {
      status: "ready" as const,
      values: {
        enabled: true,
        pollIntervalSeconds: 60,
        maxConcurrentRuns: 3,
        maxAutomaticRepairCycles: 2,
        automationProfile: "claude-code",
        agentProvider: "codex",
        agentModel: "",
        agentChangeMode: "auto",
        workflowPolicy: "direct_pr" as const,
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

    expect(screen.getByText("Agent 运行模式 (Change Mode)")).toBeDefined();
    const select = screen
      .getAllByRole("combobox")
      .find((element: any) =>
        Array.from(element.options as any[]).some((option: any) => option.value === "full-access"),
      ) as any;
    expect(select).not.toBeNull();
    fireEvent.change(select!, { target: { value: "full-access" } });

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ agentChangeMode: "full-access" }),
      "rev-1",
    );
  });

  it("renders custom prompts section and allows modifying agentAutoPrompt and agentPlanPrompt", async () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const mockSettings = {
      status: "ready" as const,
      values: {
        enabled: true,
        pollIntervalSeconds: 60,
        maxConcurrentRuns: 3,
        maxAutomaticRepairCycles: 2,
        automationProfile: "claude-code",
        workflowPolicy: "direct_pr" as const,
        agentAutoPrompt: "Initial custom auto",
        agentPlanPrompt: "Initial custom plan",
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

    expect(screen.getByText("提示词自定义 (Custom Prompts)")).toBeDefined();
    expect(screen.getByText(/\{\{issueNumber\}\}/)).toBeDefined();

    const autoInput = screen.getByLabelText("Agent Auto 提示词模板");
    fireEvent.change(autoInput, { target: { value: "New Global Auto Prompt" } });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ agentAutoPrompt: "New Global Auto Prompt" }),
      "rev-1",
    );

    const planInput = screen.getByLabelText("Agent Plan 提示词模板");
    fireEvent.change(planInput, { target: { value: "New Global Plan Prompt" } });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ agentPlanPrompt: "New Global Plan Prompt" }),
      "rev-1",
    );
  });

  it("allows resetting agentAutoPrompt and agentPlanPrompt to built-in defaults in HostSettingsScreen", async () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const mockSettings = {
      status: "ready" as const,
      values: {
        enabled: true,
        pollIntervalSeconds: 60,
        maxConcurrentRuns: 3,
        maxAutomaticRepairCycles: 2,
        automationProfile: "claude-code",
        workflowPolicy: "direct_pr" as const,
        agentAutoPrompt: "Modified custom auto",
        agentPlanPrompt: "Modified custom plan",
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

    const resetAutoBtn = screen.getByRole("button", { name: "恢复内置 Auto 模板" });
    fireEvent.click(resetAutoBtn);
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ agentAutoPrompt: DEFAULT_AGENT_AUTO_PROMPT }),
      "rev-1",
    );

    const resetPlanBtn = screen.getByRole("button", { name: "恢复内置 Plan 模板" });
    fireEvent.click(resetPlanBtn);
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ agentPlanPrompt: DEFAULT_AGENT_PLAN_PROMPT }),
      "rev-1",
    );
  });

  it("renders harnessMode selector, harnessStatus row, Pi provider, and agentTeam suffix in HostSettingsScreen", async () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const mockSettings = {
      status: "ready" as const,
      values: {
        enabled: true,
        pollIntervalSeconds: 60,
        maxConcurrentRuns: 3,
        maxAutomaticRepairCycles: 2,
        automationProfile: "claude-code",
        harnessMode: "auto" as const,
        agentProvider: "claude",
        agentModel: "",
        agentChangeMode: "auto",
        workflowPolicy: "direct_pr" as const,
        projects: {},
        inProgressLabel: "agent-in-progress",
        reviewedLabel: "agent-reviewed",
        evidenceRetentionDays: 90,
      },
      revision: "rev-1",
      saving: false,
      save: mockSave,
      reload: vi.fn(),
      reset: vi.fn(),
    };

    const mockRpc = vi.fn().mockResolvedValue({
      diagnostics: [
        {
          projectId: "prj_team",
          projectName: "team-service",
          host: "gitea.local",
          baseUrl: "http://gitea.local",
          repoOwner: "corp",
          repoName: "team-service",
          connectionStatus: "connected",
          authSource: "tea",
          authorized: true,
          readyLabel: "agent-ready",
          pendingIssueCount: 2,
          agentTeam: {
            projectSlug: "corp-team-service",
            preset: "fullstack",
            rolesCount: 5,
          },
        },
      ],
      harnessStatus: {
        available: true,
        enabled: true,
        specialistsCount: 8,
      },
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

    expect(await screen.findByText("team-service")).toBeDefined();
    expect(screen.getByText("已连接 (tea) · 2 个待办 · Team: fullstack (5)")).toBeDefined();
    expect(screen.getByText("Agent Harness 状态")).toBeDefined();
    expect(screen.getByText("已连接 · 8 个专家角色就绪")).toBeDefined();

    const harnessSelect = screen.getByLabelText("Agent Harness 编排模式");
    fireEvent.change(harnessSelect, { target: { value: "provider_locked" } });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ harnessMode: "provider_locked" }),
      "rev-1",
    );

    const providerSelect = screen.getByLabelText("Agent 引擎");
    fireEvent.change(providerSelect, { target: { value: "pi" } });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ agentProvider: "pi" }),
      "rev-1",
    );
  });

  it("allows selecting grill_plan in workflowPolicy and updating maxAutomaticRepairCycles", () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const mockSettings = {
      status: "ready" as const,
      values: {
        enabled: true,
        pollIntervalSeconds: 60,
        maxConcurrentRuns: 3,
        maxAutomaticRepairCycles: 2,
        automationProfile: "claude-code",
        workflowPolicy: "direct_pr" as const,
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

    const policySelect = screen.getByLabelText("默认工作流策略");
    fireEvent.change(policySelect, { target: { value: "grill_plan" } });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ workflowPolicy: "grill_plan" }),
      "rev-1",
    );

    const repairSelect = screen.getByLabelText("自动返修轮数上限");
    fireEvent.change(repairSelect, { target: { value: "3" } });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ maxAutomaticRepairCycles: 3 }),
      "rev-1",
    );
  });

  it("renders legacy workflowPolicy full_superpowers gracefully and allows switching to direct_pr", () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const mockSettings = {
      status: "ready" as const,
      values: {
        enabled: true,
        pollIntervalSeconds: 60,
        maxConcurrentRuns: 3,
        maxAutomaticRepairCycles: 2,
        automationProfile: "claude-code",
        workflowPolicy: "full_superpowers" as any,
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

    expect(screen.getByText("旧版兼容策略 (full_superpowers)")).toBeDefined();
    const policySelect = screen.getByLabelText("默认工作流策略") as HTMLSelectElement;
    expect(policySelect.value).toBe("full_superpowers");

    fireEvent.change(policySelect, { target: { value: "direct_pr" } });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ workflowPolicy: "direct_pr" }),
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

      // Verify Base Branch input exists
      expect(screen.getByText("默认基准分支 (Base Branch)")).toBeDefined();

      // Verify "启动标签" or "agent-ready" input is NOT rendered
      expect(screen.queryByText("启动标签")).toBeNull();
      expect(screen.queryByDisplayValue("agent-ready")).toBeNull();
    });

    it("renders and updates baseBranch in ProjectDetailSettings", () => {
      const mockSave = vi.fn().mockResolvedValue(true);
      const mockSettings = {
        values: {
          projects: {
            "proj-1": { enabled: true, baseBranch: "main" },
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

      const baseBranchInput = screen.getByLabelText("默认基准分支 (Base Branch)");
      fireEvent.change(baseBranchInput, { target: { value: "develop" } });

      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: expect.objectContaining({
            "proj-1": expect.objectContaining({
              baseBranch: "develop",
            }),
          }),
        }),
        "rev-1",
      );
    });

    it("renders change mode override selector in ProjectDetailSettings and allows choosing full-access", () => {
      const mockSave = vi.fn().mockResolvedValue(true);
      const mockSettings = {
        values: {
          agentProvider: "codex",
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

      expect(screen.getByText("模式覆盖 (Change Mode)")).toBeDefined();
      const select = screen
        .getAllByRole("combobox")
        .find((element: any) =>
          Array.from(element.options as any[]).some(
            (option: any) => option.value === "full-access",
          ),
        ) as any;
      expect(select).not.toBeNull();
      fireEvent.change(select!, { target: { value: "full-access" } });

      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: expect.objectContaining({
            "proj-1": expect.objectContaining({
              agentChangeModeOverride: "full-access",
            }),
          }),
        }),
        "rev-1",
      );
    });

    it("renders prompt overrides section and allows customizing project-level prompts", () => {
      const mockSave = vi.fn().mockResolvedValue(true);
      const mockSettings = {
        values: {
          projects: {
            "proj-1": {
              enabled: true,
              agentAutoPromptOverride: "Project override auto",
              agentPlanPromptOverride: "Project override plan",
            },
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
          theme={{ colors: { foreground: "#000", foregroundMuted: "#888" } } as any}
          onBack={vi.fn()}
        />,
      );

      expect(screen.getByText("提示词覆盖 (Prompt Overrides)")).toBeDefined();

      const autoInput = screen.getByLabelText("Agent Auto 提示词覆盖 (可选)");
      fireEvent.change(autoInput, { target: { value: "Updated Project Auto" } });
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: expect.objectContaining({
            "proj-1": expect.objectContaining({
              agentAutoPromptOverride: "Updated Project Auto",
            }),
          }),
        }),
        "rev-1",
      );

      const planInput = screen.getByLabelText("Agent Plan 提示词覆盖 (可选)");
      fireEvent.change(planInput, { target: { value: "Updated Project Plan" } });
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: expect.objectContaining({
            "proj-1": expect.objectContaining({
              agentPlanPromptOverride: "Updated Project Plan",
            }),
          }),
        }),
        "rev-1",
      );
    });

    it("supports filling default templates and clearing overrides to restore inheritance", () => {
      const mockSave = vi.fn().mockResolvedValue(true);
      const mockSettings = {
        values: {
          projects: {
            "proj-1": {
              enabled: true,
              agentAutoPromptOverride: "Custom override auto",
              agentPlanPromptOverride: "Custom override plan",
            },
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
          theme={{ colors: { foreground: "#000", foregroundMuted: "#888" } } as any}
          onBack={vi.fn()}
        />,
      );

      const fillAutoBtn = screen.getByRole("button", { name: "填充默认 Auto 模板" });
      fireEvent.click(fillAutoBtn);
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: expect.objectContaining({
            "proj-1": expect.objectContaining({
              agentAutoPromptOverride: DEFAULT_AGENT_AUTO_PROMPT,
            }),
          }),
        }),
        "rev-1",
      );

      const fillPlanBtn = screen.getByRole("button", { name: "填充默认 Plan 模板" });
      fireEvent.click(fillPlanBtn);
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: expect.objectContaining({
            "proj-1": expect.objectContaining({
              agentPlanPromptOverride: DEFAULT_AGENT_PLAN_PROMPT,
            }),
          }),
        }),
        "rev-1",
      );

      const clearBtn = screen.getByRole("button", { name: "清除覆盖（恢复继承）" });
      fireEvent.click(clearBtn);
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: expect.objectContaining({
            "proj-1": expect.objectContaining({
              agentAutoPromptOverride: undefined,
              agentPlanPromptOverride: undefined,
              agentReviewPromptOverride: undefined,
            }),
          }),
        }),
        "rev-1",
      );
    });

    it("renders workflowPolicyOverride selector in ProjectDetailSettings and saves grill_plan", () => {
      const mockSave = vi.fn().mockResolvedValue(true);
      const mockSettings = {
        values: {
          projects: {
            "proj-1": {
              enabled: true,
              readyLabel: "agent-ready",
            },
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

      const policyOverrideSelect = screen.getByLabelText("工作流策略覆盖 (可选)");
      fireEvent.change(policyOverrideSelect, { target: { value: "grill_plan" } });
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: expect.objectContaining({
            "proj-1": expect.objectContaining({
              workflowPolicyOverride: "grill_plan",
            }),
          }),
        }),
        "rev-1",
      );
    });

    it("renders harnessModeOverride, reviewProviderOverride, and agentTeam diagnostic row in ProjectDetailSettings", () => {
      const mockSave = vi.fn().mockResolvedValue(true);
      const mockSettings = {
        values: {
          projects: {
            "proj-1": {
              enabled: true,
              readyLabel: "agent-ready",
            },
          },
        },
        revision: "rev-1",
        saving: false,
        save: mockSave,
      };

      render(
        <ProjectDetailSettings
          projectId="proj-1"
          diagnostic={{
            projectId: "proj-1",
            projectName: "My Project",
            host: "gitea.local",
            baseUrl: "http://gitea.local",
            repoOwner: "org",
            repoName: "my-project",
            connectionStatus: "connected",
            authSource: "tea",
            authorized: true,
            readyLabel: "agent-ready",
            agentTeam: {
              projectSlug: "org-my-project",
              preset: "backend-heavy",
              rolesCount: 4,
            },
          }}
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

      expect(screen.getByText("工作区 Agent Team")).toBeDefined();
      expect(screen.getByText("org-my-project · backend-heavy (4 角色)")).toBeDefined();

      const harnessOverrideSelect = screen.getByLabelText("Harness 模式覆盖 (可选)");
      fireEvent.change(harnessOverrideSelect, { target: { value: "disabled" } });
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: expect.objectContaining({
            "proj-1": expect.objectContaining({
              harnessModeOverride: "disabled",
            }),
          }),
        }),
        "rev-1",
      );

      const reviewProviderSelect = screen.getByLabelText("独立审查引擎覆盖 (可选)");
      fireEvent.change(reviewProviderSelect, { target: { value: "antigravity" } });
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: expect.objectContaining({
            "proj-1": expect.objectContaining({
              reviewProviderOverride: "antigravity",
            }),
          }),
        }),
        "rev-1",
      );
    });
  });
});
