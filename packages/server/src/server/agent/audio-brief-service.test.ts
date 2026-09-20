import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { AudioBriefService, extractFallbackBrief } from "./audio-brief-service.js";
import { StructuredAgentFallbackError } from "./agent-response-loop.js";
import type { StructuredTextGeneration } from "../session/checkout/git-metadata-generator.js";
import type { TextToSpeechProvider, SpeechStreamResult } from "../speech/speech-provider.js";

describe("AudioBriefService", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-audio-brief-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("extractFallbackBrief", () => {
    it("strips code fences and technical formatting", () => {
      const markdown = `
# Refactoring Complete

I have refactored the auth module:
\`\`\`typescript
export function verifyToken(token: string) {
  return jwt.verify(token, secret);
}
\`\`\`

All 5 tests passed successfully. Would you like me to create a pull request now?
`;
      const brief = extractFallbackBrief(markdown);
      expect(brief).not.toContain("```");
      expect(brief).not.toContain("jwt.verify");
      expect(brief).toContain("Refactoring Complete");
      expect(brief).toContain("Would you like me to create a pull request now?");
    });

    it("handles short simple text directly", () => {
      const text = "Fixed the typo in README.md.";
      expect(extractFallbackBrief(text)).toBe("Fixed the typo in README.md.");
    });

    it("handles empty or whitespace text gracefully", () => {
      expect(extractFallbackBrief("   ")).toBe("No content to summarize.");
    });
  });

  describe("synthesizeBrief", () => {
    it("uses structured text generation and caches the result", async () => {
      let generationCalled = 0;
      const fakeGeneration: StructuredTextGeneration = {
        generate: async () => {
          generationCalled++;
          return { briefText: "Authentication refactored and tested. Ready to deploy?" };
        },
      };

      const fakeTts: TextToSpeechProvider = {
        synthesizeSpeech: async (): Promise<SpeechStreamResult> => {
          const stream = Readable.from([Buffer.from("FAKE_PCM_AUDIO_PAYLOAD")]);
          return { stream, format: "pcm" };
        },
      };

      const service = new AudioBriefService({
        paseoHome: tmpDir,
        generation: fakeGeneration,
        tts: () => fakeTts,
      });

      const res1 = await service.synthesizeBrief({
        agentId: "agent-1",
        turnId: "turn-1",
        text: "Long markdown message with code ```console.log(1)```",
        cwd: "/tmp/cwd",
      });

      expect(generationCalled).toBe(1);
      expect(res1.briefText).toBe("Authentication refactored and tested. Ready to deploy?");
      expect(res1.audioBase64).toBeDefined();
      expect(res1.mimeType).toBe("audio/wav");

      // Verify the WAV header
      const buffer = Buffer.from(res1.audioBase64!, "base64");
      expect(buffer.toString("ascii", 0, 4)).toBe("RIFF");
      expect(buffer.toString("ascii", 8, 12)).toBe("WAVE");

      // Second call should hit cache without calling generation again
      const res2 = await service.synthesizeBrief({
        agentId: "agent-1",
        turnId: "turn-1",
        text: "Long markdown message with code ```console.log(1)```",
        cwd: "/tmp/cwd",
      });

      expect(generationCalled).toBe(1);
      expect(res2.briefText).toBe(res1.briefText);
      expect(res2.audioBase64).toBe(res1.audioBase64);

      // With forceRefresh, generation is called again
      await service.synthesizeBrief({
        agentId: "agent-1",
        turnId: "turn-1",
        text: "Long markdown message with code ```console.log(1)```",
        cwd: "/tmp/cwd",
        forceRefresh: true,
      });

      expect(generationCalled).toBe(2);
    });

    it("falls back to heuristic summarizer when generation fails", async () => {
      const failingGeneration: StructuredTextGeneration = {
        generate: async () => {
          throw new StructuredAgentFallbackError([]);
        },
      };

      const service = new AudioBriefService({
        paseoHome: tmpDir,
        generation: failingGeneration,
      });

      const res = await service.synthesizeBrief({
        agentId: "agent-1",
        turnId: "turn-1",
        text: "Migration completed without error. Should we proceed to testing?",
        cwd: "/tmp/cwd",
      });

      expect(res.briefText).toContain("Migration completed without error.");
      expect(res.error).toBeNull();
    });
  });
});
