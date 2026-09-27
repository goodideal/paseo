import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  extractFallbackBrief,
  AudioBriefService,
  DEFAULT_AUDIO_BRIEF_INSTRUCTIONS,
} from "../server/audio-brief-service.js";
import contribute from "../index.server.js";
import { audioBriefSynthesizeRpc } from "../shared/contracts.js";
import type { PluginServerContext } from "@getpaseo/plugin";

describe("extractFallbackBrief", () => {
  it("returns fallback message for empty or whitespace-only text", () => {
    expect(extractFallbackBrief("")).toBe("No content to summarize.");
    expect(extractFallbackBrief("   \n\t  ")).toBe("No content to summarize.");
  });

  it("strips code fences, html, links, and markdown syntax", () => {
    const markdown = [
      "# Header Title",
      "Here is a summary of the change:",
      "```typescript",
      "const foo = 'bar';",
      "console.log(foo);",
      "```",
      "Check out <span style='color:red;'>this link</span> [Paseo Docs](https://paseo.sh) and image ![alt](https://example.com/logo.png).",
      "- Point 1: **bold** and *italic* details.",
      "- Point 2: `inline code` completed.",
      "",
      "> A quote block saying everything is ready.",
    ].join("\n");

    const result = extractFallbackBrief(markdown);
    expect(result).not.toContain("```");
    expect(result).not.toContain("const foo = 'bar';");
    expect(result).not.toContain("<span");
    expect(result).not.toContain("https://");
    expect(result).not.toContain("**");
    expect(result).not.toContain("`inline code`");
    expect(result).toContain("Header Title");
  });

  it("returns concise text directly when length is <= 160 characters", () => {
    const shortText = "All 42 tests passed. Build completed with no errors.";
    expect(extractFallbackBrief(shortText)).toBe(shortText);
  });

  it("handles long text with multiple sentences by combining first and last sentence", () => {
    const longText = [
      "The server implementation is fully functional.",
      "We refactored the caching mechanism and improved inflight deduplication.",
      "The tests cover all edge cases across multiple modules.",
      "Please proceed with reviewing the changes.",
    ].join(" ");

    const result = extractFallbackBrief(longText);
    expect(result).toContain("The server implementation is fully functional.");
    expect(result).toContain("Please proceed with reviewing the changes.");
  });

  it("handles long text without punctuation marks by truncating with ellipsis", () => {
    const unpunctuatedLongText = "A".repeat(200);
    const result = extractFallbackBrief(unpunctuatedLongText);
    expect(result.endsWith("...")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(160);
  });
});

describe("AudioBriefService", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "audio-brief-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("exports DEFAULT_AUDIO_BRIEF_INSTRUCTIONS", () => {
    expect(DEFAULT_AUDIO_BRIEF_INSTRUCTIONS).toContain("You are an executive technical briefer");
  });

  it("synthesizes brief using fallback when no external generator provided", async () => {
    const service = new AudioBriefService({ cacheDir: tmpDir });
    const result = await service.synthesizeBrief({
      agentId: "agent-1",
      turnId: "turn-1",
      text: "The implementation has been verified and all tests pass.",
    });

    expect(result.briefText).toBe("The implementation has been verified and all tests pass.");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeNull();
  });

  it("reuses cached brief on repeated calls", async () => {
    let generatorCalls = 0;
    const service = new AudioBriefService({
      cacheDir: tmpDir,
      textGenerator: async () => {
        generatorCalls++;
        return "Generated executive brief summary.";
      },
    });

    const params = {
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Task details with some complex descriptions.",
    };

    const res1 = await service.synthesizeBrief(params);
    expect(generatorCalls).toBe(1);
    expect(res1.briefText).toBe("Generated executive brief summary.");

    const res2 = await service.synthesizeBrief(params);
    expect(generatorCalls).toBe(1);
    expect(res2.briefText).toBe("Generated executive brief summary.");
  });

  it("bypasses cache when forceRefresh is true", async () => {
    let generatorCalls = 0;
    const service = new AudioBriefService({
      cacheDir: tmpDir,
      textGenerator: async () => {
        generatorCalls++;
        return `Generated summary version ${generatorCalls}`;
      },
    });

    const params = {
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Task details for refresh testing.",
    };

    const res1 = await service.synthesizeBrief(params);
    expect(res1.briefText).toBe("Generated summary version 1");
    expect(generatorCalls).toBe(1);

    const res2 = await service.synthesizeBrief({
      ...params,
      forceRefresh: true,
    });
    expect(res2.briefText).toBe("Generated summary version 2");
    expect(generatorCalls).toBe(2);
  });

  it("deduplicates concurrent in-flight requests", async () => {
    let generatorCalls = 0;
    const service = new AudioBriefService({
      cacheDir: tmpDir,
      textGenerator: async () => {
        generatorCalls++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "Concurrently generated summary.";
      },
    });

    const params = {
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Concurrent task details.",
    };

    const [res1, res2] = await Promise.all([
      service.synthesizeBrief(params),
      service.synthesizeBrief(params),
    ]);

    expect(generatorCalls).toBe(1);
    expect(res1.briefText).toBe("Concurrently generated summary.");
    expect(res2.briefText).toBe("Concurrently generated summary.");
  });

  it("uses different cache keys when customPrompt varies", async () => {
    let generatorCalls = 0;
    const service = new AudioBriefService({
      cacheDir: tmpDir,
      textGenerator: async (p) => {
        generatorCalls++;
        return `Custom brief with prompt: ${p.prompt}`;
      },
    });

    const res1 = await service.synthesizeBrief({
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Same content text.",
      customPrompt: "Prompt Option Alpha",
    });

    const res2 = await service.synthesizeBrief({
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Same content text.",
      customPrompt: "Prompt Option Beta",
    });

    expect(generatorCalls).toBe(2);
    expect(res1.briefText).not.toBe(res2.briefText);
  });

  it("integrates with ttsSynthesizer slot when provided", async () => {
    const service = new AudioBriefService({
      cacheDir: tmpDir,
      ttsSynthesizer: async (text) => {
        return {
          audioBase64: Buffer.from(`audio:${text}`).toString("base64"),
          mimeType: "audio/wav",
        };
      },
    });

    const result = await service.synthesizeBrief({
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Audio synthesized content.",
    });

    expect(result.audioBase64).toBeDefined();
    expect(result.mimeType).toBe("audio/wav");
  });
});

describe("contribute (plugin server entry)", () => {
  it("registers audioBriefSynthesizeRpc handler and returns cleanup", async () => {
    let registeredContract: unknown = null;
    let registeredHandler: ((input: unknown) => Promise<unknown>) | null = null;

    const mockServer = {
      handle: vi.fn((contract, handler) => {
        registeredContract = contract;
        registeredHandler = handler;
      }),
    } as unknown as PluginServerContext;

    const cleanup = contribute(mockServer);
    expect(typeof cleanup).toBe("function");
    expect(mockServer.handle).toHaveBeenCalledTimes(1);
    expect(registeredContract).toBe(audioBriefSynthesizeRpc);

    if (registeredHandler) {
      const response = await (registeredHandler as Function)({
        agentId: "agent-1",
        turnId: "turn-1",
        text: "Clean plugin server RPC test message.",
      });
      expect(response.briefText).toBe("Clean plugin server RPC test message.");
      expect(response.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
