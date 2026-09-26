import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const DEFAULT_AUDIO_BRIEF_INSTRUCTIONS = [
  "You are an executive technical briefer converting coding assistant messages into spoken audio for the developer.",
  "",
  "Analyze the assistant's message and adapt the briefing strategy based on content type:",
  "",
  "1. ARCHITECTURAL / PROPOSAL / COMPARISON (Multiple options, trade-offs, design choices):",
  "   - First, state the problem or goal in one clear spoken sentence.",
  "   - Then, explain each option's core approach and key trade-off in plain conversational speech. Do not skip options.",
  "   - Mention the recommended option and why.",
  "   - End with the specific choice or decision needed from the developer.",
  "   - Target length: Thorough but spoken-friendly (typically 80-200 words, ~30-60 seconds when read aloud).",
  "",
  "2. ACTION / EXECUTION / CONFIRMATION (Task updates, bug fixes, test runs, approval requests):",
  "   - In 1 to 2 concise spoken sentences: state the key outcome (what was done or fixed), status of checks/tests, and what decision or next step is needed.",
  "   - Target length: Brief and punchy (under 60 words, ~10-15 seconds).",
  "",
  "Spoken Speech Rules:",
  "- NEVER read code syntax, backticks, raw file paths, diff markers, or URLs aloud.",
  '- Use natural spoken language (e.g. say "in the user settings component" instead of "src slash components slash user dash settings dot tsx").',
  "- Match the language of the source text (Chinese if source is Chinese, English if English).",
].join("\n");

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
  ttsSynthesizer?: (text: string) => Promise<{ audioBase64: string; mimeType: string }>;
  textGenerator?: (params: { prompt: string; text: string }) => Promise<string>;
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

export class AudioBriefService {
  private readonly memoryCache = new Map<string, AudioBriefResult>();
  private readonly inflight = new Map<string, Promise<AudioBriefResult>>();
  private readonly cacheDir?: string;
  private readonly options: AudioBriefServiceOptions;

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

    const filePath = this.getCacheFilePath(hash);
    if (!filePath) {
      return;
    }

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data), "utf-8");
    } catch (err) {
      this.options.logger?.warn?.("Failed to write audio brief cache file", err);
    }
  }

  async synthesizeBrief(params: {
    agentId: string;
    turnId: string;
    text: string;
    customPrompt?: string;
    forceRefresh?: boolean;
  }): Promise<AudioBriefResult> {
    const prompt = params.customPrompt?.trim() || DEFAULT_AUDIO_BRIEF_INSTRUCTIONS;
    const promptHash = crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16);
    const ttsKey = this.options.ttsSynthesizer ? "custom-tts" : "none";
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

    if (this.options.ttsSynthesizer) {
      try {
        const speech = await this.options.ttsSynthesizer(briefText);
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

    await this.writeToCache(textHash, result);
    return result;
  }
}
