import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAudioBriefStore } from "./audio-brief-store";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

vi.mock("./platform-player", () => ({
  playPlatformAudio: vi.fn(),
  stopPlatformAudio: vi.fn(),
}));

describe("useAudioBriefStore", () => {
  beforeEach(() => {
    useAudioBriefStore.getState().stopBrief();
  });

  it("handles playBrief lifecycle and toggle off", async () => {
    const mockClient = {
      synthesizeAgentMessageBrief: vi.fn().mockResolvedValue({
        requestId: "req-1",
        agentId: "agent-1",
        turnId: "turn-1",
        briefText: "Refactored tests. Please confirm merge.",
        audioBase64: "base64audio",
        mimeType: "audio/wav",
        error: null,
      }),
    } as unknown as DaemonClient;

    const promise = useAudioBriefStore.getState().playBrief({
      client: mockClient,
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Original message text",
    });

    expect(useAudioBriefStore.getState().status).toBe("loading");
    expect(useAudioBriefStore.getState().currentTurnId).toBe("turn-1");

    await promise;

    expect(useAudioBriefStore.getState().status).toBe("playing");
    expect(useAudioBriefStore.getState().briefText).toBe("Refactored tests. Please confirm merge.");

    // Toggle off by calling again on the same turn
    await useAudioBriefStore.getState().playBrief({
      client: mockClient,
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Original message text",
    });

    expect(useAudioBriefStore.getState().status).toBe("idle");
    expect(useAudioBriefStore.getState().currentTurnId).toBeNull();
  });

  it("handles errors gracefully", async () => {
    const mockClient = {
      synthesizeAgentMessageBrief: vi.fn().mockRejectedValue(new Error("Network timeout")),
    } as unknown as DaemonClient;

    await useAudioBriefStore.getState().playBrief({
      client: mockClient,
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Original message text",
    });

    expect(useAudioBriefStore.getState().status).toBe("idle");
    expect(useAudioBriefStore.getState().currentTurnId).toBeNull();
    expect(useAudioBriefStore.getState().error).toBe("Network timeout");
  });
});
