/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    fontSize: { sm: 12, base: 14 },
    fontWeight: { normal: "400", medium: "500" },
    fontFamily: { ui: "system-ui" },
    borderRadius: { md: 6 },
    colors: {
      foreground: "#foreground",
      foregroundMuted: "#muted",
      accent: "#accent",
      surface1: "#surface1",
      border: "#border",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: (value: typeof theme) => unknown) => factory(theme),
  },
  withUnistyles: (Comp: unknown) => Comp,
}));

vi.mock("react-native", () => ({
  View: ({ children, testID, ...props }: React.PropsWithChildren<{ testID?: string }>) =>
    React.createElement("div", { "data-testid": testID, ...props }, children),
  Text: ({ children, testID, ...props }: React.PropsWithChildren<{ testID?: string }>) =>
    React.createElement("span", { "data-testid": testID, ...props }, children),
  Pressable: ({
    children,
    onPress,
    testID,
    ...props
  }: React.PropsWithChildren<{
    onPress?: () => void;
    testID?: string;
    children?: React.ReactNode | ((state: { hovered?: boolean }) => React.ReactNode);
  }>) =>
    React.createElement(
      "button",
      {
        type: "button",
        "data-testid": testID,
        onClick: onPress,
        ...props,
      },
      typeof children === "function" ? children({ hovered: false }) : children,
    ),
  StyleSheet: {
    create: (styles: unknown) => styles,
  },
  Platform: {
    select: <T,>(obj: Record<string, T>): T => obj.default ?? obj.web ?? Object.values(obj)[0]!,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockClient = {
  synthesizeAgentMessageBrief: vi.fn(),
};

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => mockClient,
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => React.createElement("div", { "data-testid": "loading-spinner" }),
}));

vi.mock("lucide-react-native", () => {
  const createIcon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": name });
  return {
    Volume2: createIcon("Volume2"),
    Square: createIcon("Square"),
    Sparkles: createIcon("Sparkles"),
    X: createIcon("X"),
  };
});

vi.mock("@/audio-brief/platform-player", () => ({
  playPlatformAudio: vi.fn(),
  stopPlatformAudio: vi.fn(),
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { TurnAudioBriefButton, AudioBriefCard } from "./turn-audio-brief-button";
import { useAudioBriefStore } from "@/audio-brief/audio-brief-store";

const testContentGetter = () => "Full message content";

describe("TurnAudioBriefButton & AudioBriefCard", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAudioBriefStore.getState().stopBrief();
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
  });

  it("renders audio brief button and triggers play on click", async () => {
    mockClient.synthesizeAgentMessageBrief.mockResolvedValue({
      requestId: "r1",
      agentId: "agent-1",
      turnId: "turn-1",
      briefText: "Summary of changes",
      error: null,
    });

    await act(async () => {
      root?.render(
        <TurnAudioBriefButton
          agentId="agent-1"
          turnId="turn-1"
          getContent={testContentGetter}
          serverId="server-1"
        />,
      );
    });

    const button = container?.querySelector('[data-testid="turn-audio-brief-turn-1"]');
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockClient.synthesizeAgentMessageBrief).toHaveBeenCalledWith(
      "agent-1",
      "turn-1",
      "Full message content",
      { forceRefresh: undefined },
    );
  });

  it("renders AudioBriefCard when active and has briefText", async () => {
    useAudioBriefStore.setState({
      currentTurnId: "turn-1",
      status: "playing",
      briefText: "Everything is done. Please confirm.",
      error: null,
    });

    await act(async () => {
      root?.render(<AudioBriefCard turnId="turn-1" />);
    });

    const card = container?.querySelector('[data-testid="audio-brief-card-turn-1"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Everything is done. Please confirm.");
  });

  it("does not render AudioBriefCard for another turn", async () => {
    useAudioBriefStore.setState({
      currentTurnId: "turn-2",
      status: "playing",
      briefText: "Other turn summary",
      error: null,
    });

    await act(async () => {
      root?.render(<AudioBriefCard turnId="turn-1" />);
    });

    const card = container?.querySelector('[data-testid="audio-brief-card-turn-1"]');
    expect(card).toBeNull();
  });
});
