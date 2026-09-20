import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Readable } from "node:stream";
import { z } from "zod";
import type pino from "pino";
import type { TextToSpeechProvider } from "../speech/speech-provider.js";
import type { StructuredTextGeneration } from "../session/checkout/git-metadata-generator.js";
import {
  StructuredAgentFallbackError,
  StructuredAgentResponseError,
} from "./agent-response-loop.js";

export interface AudioBriefResult {
  briefText: string;
  audioBase64?: string;
  mimeType?: string;
  durationMs?: number;
  error?: string | null;
}

export interface AudioBriefServiceOptions {
  paseoHome: string;
  generation?: StructuredTextGeneration;
  tts?: () => TextToSpeechProvider | null;
  logger?: pino.Logger;
}

const BRIEF_SCHEMA = z.object({
  briefText: z
    .string()
    .min(1)
    .max(300)
    .describe(
      "A spoken, executive summary of what was done and what decision/next action is required. Maximum 60 words, plain conversational speech.",
    ),
});

const MAX_CACHE_ENTRIES = 200;

export function extractFallbackBrief(markdown: string): string {
  if (!markdown || !markdown.trim()) {
    return "No content to summarize.";
  }

  // 1. Remove code fences (including unclosed)
  let text = markdown.replace(/```[\s\S]*?(```|$)/g, " ");

  // 2. Remove inline html tags
  text = text.replace(/<[^>]+>/g, " ");

  // 3. Remove images and links
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // 4. Remove bold, italics, inline code markers
  text = text.replace(/[*_~`]/g, " ");

  // 5. Remove header markers, blockquote markers, list markers
  text = text.replace(/^[ \t]*[#>-]+[ \t]+/gm, " ");
  text = text.replace(/^[ \t]*\d+\.[ \t]+/gm, " ");

  // 6. Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();

  if (!text) {
    return "Task updated. Please review the results.";
  }

  // If already concise, return
  if (text.length <= 160) {
    return text;
  }

  // Extract sentences
  const sentenceRegex = /[^.!?。！？]+[.!?。！？]+/g;
  const matches = text.match(sentenceRegex);

  if (matches && matches.length > 0) {
    const firstSentence = matches[0].trim();
    if (matches.length === 1) {
      return firstSentence.slice(0, 160);
    }

    const lastSentence = matches[matches.length - 1].trim();
    const combined = `${firstSentence} ${lastSentence}`;
    if (combined.length <= 180) {
      return combined;
    }

    return firstSentence.slice(0, 160);
  }

  return text.slice(0, 150).trim() + "...";
}

function addWavHeader(
  pcmBuffer: Buffer,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16,
): Buffer {
  const headerSize = 44;
  const wavBuffer = Buffer.alloc(headerSize + pcmBuffer.length);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;

  wavBuffer.write("RIFF", 0);
  wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavBuffer.write("WAVE", 8);
  wavBuffer.write("fmt ", 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20); // PCM
  wavBuffer.writeUInt16LE(channels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitsPerSample, 34);
  wavBuffer.write("data", 36);
  wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
  pcmBuffer.copy(wavBuffer, 44);

  return wavBuffer;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function getTtsKey(tts: TextToSpeechProvider | null | undefined): string {
  if (!tts) return "none";
  if ("getConfig" in tts && typeof (tts as { getConfig: () => unknown }).getConfig === "function") {
    try {
      return JSON.stringify((tts as { getConfig: () => unknown }).getConfig());
    } catch {
      return tts.constructor.name;
    }
  }
  return tts.constructor.name;
}

export class AudioBriefService {
  private readonly paseoHome: string;
  private readonly generation?: StructuredTextGeneration;
  private readonly ttsResolver?: () => TextToSpeechProvider | null;
  private readonly logger?: pino.Logger;
  private readonly cacheDir: string;
  private readonly inflight = new Map<string, Promise<AudioBriefResult>>();

  constructor(options: AudioBriefServiceOptions) {
    this.paseoHome = options.paseoHome;
    this.generation = options.generation;
    this.ttsResolver = options.tts;
    this.logger = options.logger?.child({ module: "audio-brief-service" });
    this.cacheDir = path.join(this.paseoHome, "cache", "audio-briefs");
  }

  private getCacheFilePath(hash: string): string {
    return path.join(this.cacheDir, `${hash}.json`);
  }

  private async readFromCache(hash: string): Promise<AudioBriefResult | null> {
    try {
      const filePath = this.getCacheFilePath(hash);
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as AudioBriefResult;
      if (typeof parsed?.briefText === "string") {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async writeToCache(hash: string, data: AudioBriefResult): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const filePath = this.getCacheFilePath(hash);
      await fs.writeFile(filePath, JSON.stringify(data), "utf-8");
      void this.pruneCacheIfNeeded();
    } catch (err) {
      this.logger?.warn({ err, hash }, "Failed to write audio brief cache");
    }
  }

  private async pruneCacheIfNeeded(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      if (jsonFiles.length <= MAX_CACHE_ENTRIES) {
        return;
      }
      const fileStats = await Promise.all(
        jsonFiles.map(async (file) => {
          const fullPath = path.join(this.cacheDir, file);
          const stat = await fs.stat(fullPath);
          return { file: fullPath, mtimeMs: stat.mtimeMs };
        }),
      );
      fileStats.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const removeCount = fileStats.length - MAX_CACHE_ENTRIES;
      for (let i = 0; i < removeCount; i++) {
        await fs.unlink(fileStats[i].file).catch(() => undefined);
      }
    } catch (err) {
      this.logger?.warn({ err }, "Failed to prune audio brief cache");
    }
  }

  async synthesizeBrief(params: {
    agentId: string;
    turnId: string;
    text: string;
    cwd?: string;
    forceRefresh?: boolean;
  }): Promise<AudioBriefResult> {
    const tts = this.ttsResolver?.() ?? null;
    const ttsKey = getTtsKey(tts);
    const textHash = crypto
      .createHash("sha256")
      .update(`${params.text.trim()}\0${ttsKey}`)
      .digest("hex");

    if (!params.forceRefresh) {
      const pending = this.inflight.get(textHash);
      if (pending) {
        return pending;
      }

      const cached = await this.readFromCache(textHash);
      if (cached) {
        this.logger?.debug({ turnId: params.turnId, textHash }, "Audio brief cache hit");
        return cached;
      }
    }

    const task = this.executeSynthesize(params, textHash, tts);
    this.inflight.set(textHash, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(textHash);
    }
  }

  private async executeSynthesize(
    params: {
      agentId: string;
      turnId: string;
      text: string;
      cwd?: string;
    },
    textHash: string,
    tts: TextToSpeechProvider | null,
  ): Promise<AudioBriefResult> {
    const startTime = Date.now();
    let briefText = "";

    // 1. Generate intelligent brief
    if (this.generation && params.cwd) {
      try {
        const prompt = [
          "You are an executive technical briefer.",
          "Convert the following coding assistant message into a spoken, decision-oriented brief for the developer.",
          "Rules:",
          "- NEVER read code, syntax, diffs, backticks, or raw file paths.",
          "- In 1 to 2 spoken sentences: state the key outcome (what was done or fixed), test/check status, and what decision/next action is required from the developer.",
          "- Under 60 words total.",
          "- Match the language of the source text (Chinese if Chinese, English if English).",
          "",
          "Assistant Message:",
          params.text,
        ].join("\n");

        const result = await this.generation.generate({
          cwd: params.cwd,
          prompt,
          schema: BRIEF_SCHEMA,
          schemaName: "AudioBrief",
          agentTitle: "Audio briefer",
        });

        briefText = result.briefText.trim();
      } catch (error) {
        if (
          error instanceof StructuredAgentFallbackError ||
          error instanceof StructuredAgentResponseError
        ) {
          this.logger?.info(
            { err: error },
            "Structured brief generation fell back to heuristic summarizer",
          );
        } else {
          this.logger?.warn({ err: error }, "Structured brief generation error, falling back");
        }
        briefText = extractFallbackBrief(params.text);
      }
    } else {
      briefText = extractFallbackBrief(params.text);
    }

    // 2. Synthesize audio if TTS is available
    let audioBase64: string | undefined;
    let mimeType: string | undefined;

    if (tts) {
      try {
        const speech = await tts.synthesizeSpeech(briefText);
        const rawBuffer = await streamToBuffer(speech.stream);

        if (speech.format === "pcm") {
          const wavBuffer = addWavHeader(rawBuffer);
          audioBase64 = wavBuffer.toString("base64");
          mimeType = "audio/wav";
        } else {
          audioBase64 = rawBuffer.toString("base64");
          mimeType = speech.format.startsWith("audio/") ? speech.format : `audio/${speech.format}`;
        }
      } catch (err) {
        this.logger?.warn({ err }, "TTS synthesis failed for audio brief");
      }
    }

    const result: AudioBriefResult = {
      briefText,
      audioBase64,
      mimeType,
      durationMs: Date.now() - startTime,
      error: null,
    };

    // Cache the outcome
    await this.writeToCache(textHash, result);

    return result;
  }
}
