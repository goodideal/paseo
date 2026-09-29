import { describe, it, expect } from "vitest";
import { SoundSynthesizer } from "../companion-desktop/src/sound-synthesizer.js";

describe("SoundSynthesizer", () => {
  it("generates tone frequencies without throwing in Node/mock environment", () => {
    const synth = new SoundSynthesizer({ muted: false, volume: 0.5 });
    expect(synth.isMuted()).toBe(false);

    synth.toggleMute();
    expect(synth.isMuted()).toBe(true);

    // When muted, playing sounds does not fail
    expect(() => synth.playApproved()).not.toThrow();
  });
});
