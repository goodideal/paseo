import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

import { DEFAULT_AUDIO_BRIEF_INSTRUCTIONS, type AudioBriefSettings } from "../shared/settings.js";

export { DEFAULT_AUDIO_BRIEF_INSTRUCTIONS };

export interface AudioBriefResult {
  briefText: string;
  audioBase64?: string;
  mimeType?: string;
  durationMs?: number;
  error?: string | null;
}

export interface AudioBriefServiceOptions {
  cacheDir?: string;
  logger?: {
    debug?: (msg: string, ...args: unknown[]) => void;
    info?: (msg: string, ...args: unknown[]) => void;
    warn?: (msg: string, ...args: unknown[]) => void;
    error?: (msg: string, ...args: unknown[]) => void;
  };
  getSettings?: () => AudioBriefSettings;
  ttsSynthesizer?: ((text: string) => Promise<{ audioBase64: string; mimeType: string }>) | null;
  textGenerator?: (params: { prompt: string; text: string }) => Promise<string>;
}

export interface OpenAiTtsOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  voice?: string;
  timeoutMs?: number;
}

export function createOpenAiTtsSynthesizer(options: OpenAiTtsOptions = {}) {
  const baseUrl = (options.baseUrl || "http://127.0.0.1:8001/v1").replace(/\/+$/, "");
  const apiKey = options.apiKey || "sk-local";
  const model = options.model || "tts-1";
  const voice = options.voice || "alloy";
  const timeoutMs = options.timeoutMs ?? 15000;

  return async (text: string): Promise<{ audioBase64: string; mimeType: string }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: text,
          voice,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`TTS server HTTP ${res.status}: ${res.statusText}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const audioBase64 = Buffer.from(arrayBuffer).toString("base64");
      const mimeType = res.headers.get("content-type") || "audio/wav";
      return { audioBase64, mimeType };
    } finally {
      clearTimeout(timeout);
    }
  };
}

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

  return `${text.slice(0, 150).trim()}...`;
}

const MAX_MEMORY_ENTRIES = 200;
const MAX_DISK_ENTRIES = 200;

export class AudioBriefService {
  private readonly memoryCache = new Map<string, AudioBriefResult>();
  private readonly inflight = new Map<string, Promise<AudioBriefResult>>();
  private readonly cacheDir?: string;
  private readonly options: AudioBriefServiceOptions;

  private ttsSynthesizerPromise?: Promise<
    ((text: string) => Promise<{ audioBase64: string; mimeType: string }>) | null
  >;

  constructor(options: AudioBriefServiceOptions = {}) {
    this.options = options;
    this.cacheDir =
      options.cacheDir ??
      path.join(
        process.env.PASEO_HOME || path.join(os.homedir(), ".paseo"),
        "cache",
        "audio-brief",
      );
  }

  private getTtsSynthesizer():
    | ((text: string) => Promise<{ audioBase64: string; mimeType: string }>)
    | null {
    if (this.options.ttsSynthesizer !== undefined) {
      return this.options.ttsSynthesizer;
    }
    if (process.env.NODE_ENV === "test") {
      return null;
    }

    const s = this.options.getSettings?.();
    if (s && !s.enableBackendTts) {
      return null;
    }

    const baseUrl =
      s?.ttsBaseUrl ||
      process.env.OPENAI_TTS_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      "http://127.0.0.1:8001/v1";
    const apiKey =
      s?.ttsApiKey || process.env.OPENAI_TTS_API_KEY || process.env.OPENAI_API_KEY || "sk-local";
    const model = s?.ttsModel || process.env.TTS_MODEL || "tts-1";
    const voice = s?.ttsVoice || process.env.TTS_VOICE || "alloy";
    const timeoutSeconds = s?.ttsTimeoutSeconds ?? 60;
    const timeoutMs = timeoutSeconds * 1000;

    return createOpenAiTtsSynthesizer({ baseUrl, apiKey, model, voice, timeoutMs });
  }

  private getCacheFilePath(hash: string): string | null {
    if (!this.cacheDir) {
      return null;
    }
    return path.join(this.cacheDir, `${hash}.json`);
  }

  private async readFileCache(hash: string): Promise<AudioBriefResult | null> {
    const filePath = this.getCacheFilePath(hash);
    if (!filePath) {
      return null;
    }

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as AudioBriefResult;
      if (typeof parsed?.briefText === "string") {
        this.memoryCache.set(hash, parsed);
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async writeToCache(hash: string, data: AudioBriefResult): Promise<void> {
    this.memoryCache.set(hash, data);
    this.pruneMemoryCache();

    const filePath = this.getCacheFilePath(hash);
    if (!filePath) {
      return;
    }

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data), "utf-8");
      void this.pruneDiskCacheIfNeeded();
    } catch (err) {
      this.options.logger?.warn?.("Failed to write audio brief cache file", err);
    }
  }

  private pruneMemoryCache(): void {
    if (this.memoryCache.size <= MAX_MEMORY_ENTRIES) {
      return;
    }
    const keys = Array.from(this.memoryCache.keys());
    const removeCount = keys.length - MAX_MEMORY_ENTRIES;
    for (let i = 0; i < removeCount; i++) {
      this.memoryCache.delete(keys[i]);
    }
  }

  private async pruneDiskCacheIfNeeded(): Promise<void> {
    if (!this.cacheDir) {
      return;
    }
    try {
      const files = await fs.readdir(this.cacheDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      if (jsonFiles.length <= MAX_DISK_ENTRIES) {
        return;
      }
      const fileStats = await Promise.all(
        jsonFiles.map(async (file) => {
          const fullPath = path.join(this.cacheDir!, file);
          const stat = await fs.stat(fullPath);
          return { file: fullPath, mtimeMs: stat.mtimeMs };
        }),
      );
      fileStats.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const removeCount = fileStats.length - MAX_DISK_ENTRIES;
      for (let i = 0; i < removeCount; i++) {
        await fs.unlink(fileStats[i].file).catch(() => undefined);
      }
    } catch (err) {
      this.options.logger?.warn?.("Failed to prune audio brief disk cache", err);
    }
  }

  async synthesizeBrief(params: {
    agentId: string;
    turnId: string;
    text: string;
    customPrompt?: string;
    forceRefresh?: boolean;
  }): Promise<AudioBriefResult> {
    const s = this.options.getSettings?.();
    const prompt =
      params.customPrompt?.trim() || s?.instructions?.trim() || DEFAULT_AUDIO_BRIEF_INSTRUCTIONS;
    const promptHash = crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16);
    const synthesizer = this.getTtsSynthesizer();
    const ttsKey = synthesizer ? "custom-tts" : "none";
    const textHash = crypto
      .createHash("sha256")
      .update(`${params.text.trim()}\0${ttsKey}\0${promptHash}`)
      .digest("hex");

    if (!params.forceRefresh) {
      const pending = this.inflight.get(textHash);
      if (pending) {
        return pending;
      }

      const memCached = this.memoryCache.get(textHash);
      if (memCached) {
        this.options.logger?.debug?.("Audio brief memory cache hit", {
          turnId: params.turnId,
          textHash,
        });
        return memCached;
      }
    }

    const task = (async () => {
      if (!params.forceRefresh) {
        const fileCached = await this.readFileCache(textHash);
        if (fileCached) {
          this.options.logger?.debug?.("Audio brief disk cache hit", {
            turnId: params.turnId,
            textHash,
          });
          return fileCached;
        }
      }
      return this.executeSynthesize(params, textHash, prompt);
    })();

    if (!params.forceRefresh) {
      this.inflight.set(textHash, task);
    }

    try {
      return await task;
    } finally {
      if (!params.forceRefresh) {
        this.inflight.delete(textHash);
      }
    }
  }

  private async executeSynthesize(
    params: {
      agentId: string;
      turnId: string;
      text: string;
      customPrompt?: string;
    },
    textHash: string,
    prompt: string,
  ): Promise<AudioBriefResult> {
    const startTime = Date.now();
    let briefText = "";

    // 1. Heuristic or custom LLM generator
    if (this.options.textGenerator) {
      try {
        briefText = (
          await this.options.textGenerator({
            prompt,
            text: params.text,
          })
        ).trim();
      } catch (err) {
        this.options.logger?.warn?.("Audio brief custom generator error, falling back", err);
        briefText = extractFallbackBrief(params.text);
      }
    } else {
      briefText = extractFallbackBrief(params.text);
    }

    // 2. Synthesize audio if TTS provider is configured
    let audioBase64: string | undefined;
    let mimeType: string | undefined;

    const synthesizer = this.getTtsSynthesizer();
    if (synthesizer) {
      try {
        const speech = await synthesizer(briefText);
        audioBase64 = speech.audioBase64;
        mimeType = speech.mimeType;
      } catch (err) {
        this.options.logger?.warn?.("TTS synthesis failed for audio brief", err);
      }
    }

    const result: AudioBriefResult = {
      briefText,
      audioBase64,
      mimeType,
      durationMs: Date.now() - startTime,
      error: null,
    };

    // Only persist to disk cache if audio succeeded or no TTS was configured.
    // If TTS was configured but failed/timed out, do not cache permanently so retry can succeed.
    const shouldCacheOnDisk = !synthesizer || !!audioBase64;
    if (shouldCacheOnDisk) {
      await this.writeToCache(textHash, result);
    } else {
      this.memoryCache.set(textHash, result);
    }
    return result;
  }
}
