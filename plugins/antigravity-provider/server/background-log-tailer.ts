import { open, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AcpTransformer } from "@getpaseo/plugin/server/acp";
import { z } from "zod";

const DEFAULT_INITIAL_DELAY_MS = 2_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_SILENT_THRESHOLD_MS = 90_000;
const SILENCE_ESCALATION_MS = 120_000;
const DEFAULT_MAX_TAIL_BYTES = 16 * 1024;
const DEFAULT_MAX_TAIL_LINES = 120;
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const runCommandInputSchema = z.object({
  CommandLine: z.string().min(1),
  IsDaemon: z.boolean().optional(),
  toolSummary: z.string().optional(),
});

export interface BackgroundLogTailerOptions {
  /** Override Antigravity brain root (`~/.gemini/antigravity-cli/brain`). */
  brainRootDir?: string;
  /** Delay before starting background log polling. Defaults to 2000ms. */
  initialDelayMs?: number;
  /** Polling interval for `stat` and tail reads. Defaults to 2000ms. */
  pollIntervalMs?: number;
  /** Threshold of zero log growth before flagging silence. Defaults to 90_000ms. */
  silentThresholdMs?: number;
  /** Maximum trailing bytes read per update. Defaults to 16 KB. */
  maxTailBytes?: number;
  /** Maximum trailing lines rendered per update. Defaults to 120 lines. */
  maxTailLines?: number;
  /** Clock provider for deterministic tests. */
  now?: () => number;
}

function resolveDefaultBrainRoot(): string {
  const home = process.env.ANTIGRAVITY_HOME ?? path.join(homedir(), ".gemini", "antigravity-cli");
  return path.join(home, "brain");
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return seconds > 0 ? `${hours}h${minutes}m${seconds}s` : `${hours}h${minutes}m`;
  return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
}

function formatStatusHeader(elapsedMs: number, silentMs: number, isSilent: boolean): string {
  if (isSilent) {
    return `[后台运行中 · 已耗时 ${formatDuration(elapsedMs)} · 静默 ${formatDuration(silentMs)}+]`;
  }
  return `[后台运行中 · 已耗时 ${formatDuration(elapsedMs)} · 最近输出 ${formatDuration(silentMs)}前]`;
}

function formatBackgroundDescription(
  baseLabel: string,
  isSilent: boolean,
  silentMs: number,
  silentThresholdMs: number,
): string {
  if (!isSilent) return `${baseLabel} · 活跃`;
  if (silentMs >= SILENCE_ESCALATION_MS) {
    return `${baseLabel} · 静默 ${Math.floor(silentMs / 60_000)}m+`;
  }
  const thresholdTag =
    silentThresholdMs < 1_000
      ? `${silentThresholdMs}ms+`
      : `${Math.floor(silentThresholdMs / 1_000)}s+`;
  return `${baseLabel} · 静默 ${thresholdTag}`;
}

async function readTrailingText(
  filePath: string,
  maxBytes: number,
  knownSize?: number,
): Promise<{ text: string; truncated: boolean } | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "r");
    const size = knownSize ?? (await handle.stat()).size;
    if (size <= 0) return { text: "", truncated: false };
    const offset = Math.max(0, size - maxBytes);
    const length = size - offset;
    const buffer = Buffer.allocUnsafe(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      const chunk = await handle.read(buffer, bytesRead, length - bytesRead, offset + bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    return { text: buffer.subarray(0, bytesRead).toString("utf8"), truncated: offset > 0 };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function matchesCommandLine(content: string, commandLine: string): 0 | 1 | 2 {
  const marker = "Task Description: ";
  const start = content.indexOf(marker);
  if (start === -1) return 0;
  const afterMarker = content.slice(start + marker.length);
  const endMatch = /\r?\n(?:Task logs are available at:|Log output:)/.exec(afterMarker);
  const description = (endMatch ? afterMarker.slice(0, endMatch.index) : afterMarker).trim();
  const normalizedCommand = commandLine.trim();
  if (!description || !normalizedCommand) return 0;
  if (description === normalizedCommand) return 2;
  const prefix = normalizedCommand.slice(0, 120);
  const onBoundary =
    !/\w/.test(prefix.at(-1) ?? "") || !/\w/.test(description[prefix.length] ?? "");
  if (
    (description.length >= 16 && normalizedCommand.startsWith(description)) ||
    (normalizedCommand.length >= 16 && description.startsWith(prefix) && onBoundary)
  ) {
    return 1;
  }
  return 0;
}

function uriToFilePath(rawUri: string): string {
  try {
    return fileURLToPath(rawUri);
  } catch {
    return rawUri.replace(/^file:\/\//, "");
  }
}

function extractLogCandidate(content: string, tasksDir: string): string | undefined {
  const logLineMatch = /Task logs are available at:\s*(file:\/\/[^\r\n]+)/.exec(content);
  if (logLineMatch?.[1]) {
    return uriToFilePath(logLineMatch[1].trim());
  }
  const taskIdMatch = /task id:\s*[a-zA-Z0-9_-]+\/(task-\d+)\b/.exec(content);
  if (taskIdMatch?.[1]) {
    return path.join(tasksDir, `${taskIdMatch[1]}.log`);
  }
  return undefined;
}

function isContainedLogPath(candidate: string, parentDir: string): boolean {
  const rel = path.relative(parentDir, candidate);
  return (
    rel.length > 0 &&
    rel !== ".." &&
    !rel.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(rel) &&
    candidate.endsWith(".log")
  );
}

async function resolveContainedLogPath(
  candidatePath: string,
  tasksDir: string,
): Promise<string | undefined> {
  const resolvedTasksDir = path.resolve(tasksDir);
  const resolvedCandidate = path.resolve(candidatePath);
  if (!isContainedLogPath(resolvedCandidate, resolvedTasksDir)) return undefined;
  try {
    const [realTasksDir, realCandidate] = await Promise.all([
      realpath(resolvedTasksDir),
      realpath(resolvedCandidate),
    ]);
    return isContainedLogPath(realCandidate, realTasksDir) ? realCandidate : undefined;
  } catch {
    return undefined;
  }
}

async function findBackgroundTaskLog(
  brainRootDir: string,
  nativeSessionId: string,
  commandLine: string,
  minCreatedAtMs: number,
): Promise<string | undefined> {
  const sessionDir = path.resolve(brainRootDir, nativeSessionId);
  const transcriptPath = path.join(sessionDir, ".system_generated", "logs", "transcript.jsonl");
  const tasksDir = path.join(sessionDir, ".system_generated", "tasks");
  const trailing = await readTrailingText(transcriptPath, TRANSCRIPT_TAIL_BYTES);
  if (!trailing || trailing.text.length === 0) return undefined;

  let text = trailing.text;
  if (trailing.truncated) {
    const newline = text.indexOf("\n");
    text = newline === -1 ? "" : text.slice(newline + 1);
  }
  const lines = text.split(/\r?\n/);
  let fallbackPath: string | undefined;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const raw = lines[index]?.trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    if (record.type !== "GENERIC" || typeof record.content !== "string") continue;
    const isRunningTask =
      record.status === "RUNNING" ||
      (record.status === undefined &&
        record.content.includes("Tool is running as a background task"));
    if (!isRunningTask) continue;
    if (typeof record.created_at === "string") {
      const createdAtMs = Date.parse(record.created_at);
      if (Number.isFinite(createdAtMs) && createdAtMs < minCreatedAtMs) continue;
    }
    const score = matchesCommandLine(record.content, commandLine);
    if (score === 0) continue;
    const candidate = extractLogCandidate(record.content, tasksDir);
    if (!candidate) continue;
    const contained = await resolveContainedLogPath(candidate, tasksDir);
    if (!contained) continue;
    if (score === 2) return contained;
    fallbackPath ??= contained;
  }
  return fallbackPath;
}

async function readLogTail(
  filePath: string,
  size: number,
  maxTailBytes: number,
  maxTailLines: number,
): Promise<string | undefined> {
  const trailing = await readTrailingText(filePath, maxTailBytes, size);
  if (!trailing) return undefined;
  let normalized = trailing.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (trailing.truncated) {
    const newline = normalized.indexOf("\n");
    normalized = newline === -1 ? "" : normalized.slice(newline + 1);
  }
  if (!normalized) return "";
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-maxTailLines).join("\n");
}

/**
 * Observe Antigravity backgrounded `run_command` tool calls by tailing their session
 * `.system_generated/tasks/task-<step>.log` file and emitting throttled live updates.
 */
export function createAntigravityToolObserver(
  options: BackgroundLogTailerOptions = {},
): NonNullable<AcpTransformer["observeToolCall"]> {
  const brainRootDir = options.brainRootDir ?? resolveDefaultBrainRoot();
  const initialDelayMs =
    options.initialDelayMs ??
    parsePositiveInt(process.env.PASEO_ANTIGRAVITY_LOG_INITIAL_DELAY_MS) ??
    DEFAULT_INITIAL_DELAY_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const silentThresholdMs = options.silentThresholdMs ?? DEFAULT_SILENT_THRESHOLD_MS;
  const maxTailBytes = options.maxTailBytes ?? DEFAULT_MAX_TAIL_BYTES;
  const maxTailLines = options.maxTailLines ?? DEFAULT_MAX_TAIL_LINES;
  const now = options.now ?? (() => Date.now());

  return (toolCall, context) => {
    if (
      toolCall.name !== "run_command" ||
      (toolCall.status !== "in_progress" && toolCall.status !== "pending")
    ) {
      return;
    }
    const parsed = runCommandInputSchema.safeParse(toolCall.input);
    if (!parsed.success || parsed.data.IsDaemon === true) return;
    if (!SESSION_ID_PATTERN.test(context.nativeSessionId)) return;

    const commandLine = parsed.data.CommandLine;
    const baseLabel = (
      parsed.data.toolSummary?.trim() ||
      toolCall.title.trim() ||
      commandLine
    ).slice(0, 80);
    const startedAt = now();
    const minCreatedAtMs = (startedAt > 1_000_000_000_000 ? startedAt : Date.now()) - 10_000;

    let disposed = false;
    let inFlight = false;
    let logFilePath: string | undefined;
    let sawGrowth = false;
    let lastSize = -1;
    let lastGrowthAt = startedAt;
    let lastEmittedSize = -1;
    let lastEmittedBucket = "";
    let hasEmittedDetail = false;
    let initialTimer: ReturnType<typeof setTimeout> | null = null;
    let intervalTimer: ReturnType<typeof setInterval> | null = null;

    const refreshBinding = async () => {
      if (logFilePath && sawGrowth) return;
      const discovered = await findBackgroundTaskLog(
        brainRootDir,
        context.nativeSessionId,
        commandLine,
        minCreatedAtMs,
      );
      if (discovered && discovered !== logFilePath) {
        logFilePath = discovered;
        lastSize = -1;
        lastEmittedSize = -1;
        hasEmittedDetail = false;
      }
    };

    const refreshStat = async (): Promise<number> => {
      let currentNow = now();
      if (!logFilePath) return currentNow;
      try {
        const fileStat = await stat(logFilePath);
        if (!fileStat.isFile()) throw new Error("Not a regular log file");
        currentNow = now();
        if (lastSize === -1) {
          if (fileStat.size > 0) {
            lastGrowthAt = Math.min(currentNow, Math.max(startedAt, Math.floor(fileStat.mtimeMs)));
          }
          lastSize = fileStat.size;
        } else if (fileStat.size !== lastSize) {
          lastSize = fileStat.size;
          lastGrowthAt = currentNow;
          sawGrowth = true;
        }
      } catch {
        logFilePath = undefined;
        lastSize = -1;
        lastEmittedSize = -1;
      }
      return currentNow;
    };

    const tick = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        await refreshBinding();
        if (disposed) return;

        const currentNow = await refreshStat();
        if (disposed) return;

        const elapsedMs = Math.max(0, currentNow - startedAt);
        const silentMs = Math.max(0, currentNow - lastGrowthAt);
        const isSilent = silentMs >= silentThresholdMs;
        const backgroundDescription = formatBackgroundDescription(
          baseLabel,
          isSilent,
          silentMs,
          silentThresholdMs,
        );
        const header = formatStatusHeader(elapsedMs, silentMs, isSilent);
        const bucketChanged = backgroundDescription !== lastEmittedBucket;

        if (logFilePath && lastSize >= 0) {
          const sizeChanged = lastSize !== lastEmittedSize;
          if (!sizeChanged && !bucketChanged && hasEmittedDetail) return;
          const tail = await readLogTail(logFilePath, lastSize, maxTailBytes, maxTailLines);
          if (disposed || tail === undefined) return;
          const output = tail.length > 0 ? `${header}\n${tail}` : header;
          lastEmittedSize = lastSize;
          lastEmittedBucket = backgroundDescription;
          hasEmittedDetail = true;
          context.updateToolCall(toolCall.id, {
            detail: { type: "shell", command: commandLine, output },
            backgroundDescription,
          });
          return;
        }

        if (bucketChanged) {
          lastEmittedBucket = backgroundDescription;
          if (isSilent) hasEmittedDetail = true;
          context.updateToolCall(
            toolCall.id,
            isSilent
              ? {
                  detail: { type: "shell", command: commandLine, output: header },
                  backgroundDescription,
                }
              : { backgroundDescription },
          );
        }
      } catch {
        // Ignore transient filesystem/update errors in background tailing loop.
      } finally {
        inFlight = false;
      }
    };

    initialTimer = setTimeout(() => {
      initialTimer = null;
      if (disposed) return;
      void tick();
      intervalTimer = setInterval(() => {
        if (!disposed) void tick();
      }, pollIntervalMs);
      intervalTimer.unref?.();
    }, initialDelayMs);
    initialTimer.unref?.();

    return () => {
      disposed = true;
      if (initialTimer) {
        clearTimeout(initialTimer);
        initialTimer = null;
      }
      if (intervalTimer) {
        clearInterval(intervalTimer);
        intervalTimer = null;
      }
    };
  };
}
