// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

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
import { render, screen, fireEvent } from "@testing-library/react";
import { HostSettingsScreen } from "../client/host-settings.js";

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
});
