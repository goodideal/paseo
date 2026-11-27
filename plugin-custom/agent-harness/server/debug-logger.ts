import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HarnessDebugLogEntrySchema,
  type HarnessDebugClearOutput,
  type HarnessDebugLogEntry,
  type HarnessDebugLogLevel,
  type HarnessDebugStatusOutput,
} from "../shared/contracts.js";

export const DEBUG_LOG_MAX_BYTES = 5 * 1024 * 1024;
const LARGE_LOG_THRESHOLD_BYTES = 64 * 1024;
const TAIL_BYTES_PER_LINE = 2048;
const DEFAULT_STATUS_LIMIT = 50;
const MAX_STATUS_LIMIT = 1000;
const MAX_PREVIEW_CHARS = 512;
const MAX_SANITIZE_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;

const SENSITIVE_KEY_WORDS = new Set([
  "token",
  "tokens",
  "secret",
  "secrets",
  "password",
  "passwd",
  "apikey",
  "credential",
  "credentials",
  "cookie",
  "cookies",
  "authorization",
  "privatekey",
  "clientkey",
  "signingkey",
  "sessionkey",
  "jwt",
  "bearer",
]);

const COMPOUND_SENSITIVE_KEY_PATTERN =
  /(?:^|[^a-z0-9])(?:api[-_]?key|x[-_]?api[-_]?key|set[-_]?cookie|private[-_]?key|client[-_]?key|signing[-_]?key|session[-_]?key|bearer)(?:$|[^a-z0-9])/i;

export function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  if (COMPOUND_SENSITIVE_KEY_PATTERN.test(normalized)) {
    return true;
  }
  const parts = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (SENSITIVE_KEY_WORDS.has(part)) {
      return true;
    }
    if (i + 1 < parts.length && SENSITIVE_KEY_WORDS.has(`${part}${parts[i + 1]!}`)) {
      return true;
    }
  }
  return false;
}

const KEY_ASSIGN_NAME =
  "(?:[A-Za-z0-9_]*?(?:token|secret|password|passwd|api[-_]?key|apikey|authorization|credential|private[-_]?key|client[-_]?key|signing[-_]?key|session[-_]?key|jwt|cookie)|x[-_]api[-_]key|set[-_]cookie)";

const INLINE_SECRET_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, replacement: "$1 [REDACTED]" },
  {
    pattern: /\bAuthorization\s*:\s*Token\s+[A-Za-z0-9._~+/=-]+/gi,
    replacement: "Authorization: Token [REDACTED]",
  },
  { pattern: /\bsk-[A-Za-z0-9_-]{4,}\b/g, replacement: "sk-[REDACTED]" },
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{10,}\b/g, replacement: "[REDACTED]" },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{10,}\b/g, replacement: "[REDACTED]" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g, replacement: "[REDACTED]" },
  { pattern: /\bAIza[0-9A-Za-z_-]{16,}\b/g, replacement: "[REDACTED]" },
  {
    pattern: new RegExp(`(["']?${KEY_ASSIGN_NAME}["']?\\s*[:=]\\s*)"[^"\\r\\n]*"`, "gi"),
    replacement: '$1"[REDACTED]"',
  },
  {
    pattern: new RegExp(`(["']?${KEY_ASSIGN_NAME}["']?\\s*[:=]\\s*)'[^'\\r\\n]*'`, "gi"),
    replacement: "$1'[REDACTED]'",
  },
  {
    pattern: new RegExp(
      `\\b(${KEY_ASSIGN_NAME}\\s*[:=]\\s*)(?!\\[REDACTED\\]|Bearer\\b|Basic\\b|Token\\b)([^\\s,&;"'\\r\\n]+)`,
      "gi",
    ),
    replacement: "$1[REDACTED]",
  },
];

export function resolveAgentHarnessDataDir(customDataDir?: string): string {
  if (customDataDir && customDataDir.trim()) {
    return path.resolve(customDataDir.trim());
  }
  const paseoHome = process.env.PASEO_HOME?.trim() || path.join(os.homedir(), ".paseo");
  return path.join(paseoHome, "plugin-data", "agent-harness");
}

function ensurePrivateDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // Ignore chmod error on platforms without POSIX permission bits
  }
}

function chmodFileSecure(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore chmod error on platforms without POSIX permission bits
  }
}

function sanitizeString(value: string): string {
  let sanitized = value;
  for (const { pattern, replacement } of INLINE_SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  if (sanitized.length > MAX_PREVIEW_CHARS) {
    const omitted = sanitized.length - MAX_PREVIEW_CHARS;
    return `${sanitized.slice(0, MAX_PREVIEW_CHARS)}... [truncated ${omitted} chars]`;
  }
  return sanitized;
}

export function sanitizeDebugValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
    };
  }
  if (typeof value !== "object") {
    return sanitizeString(String(value));
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  if (depth >= MAX_SANITIZE_DEPTH) {
    return "[MaxDepth]";
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const sliced = value.slice(0, MAX_ARRAY_ITEMS);
      const out = sliced.map((item) => sanitizeDebugValue(item, depth + 1, seen));
      if (value.length > MAX_ARRAY_ITEMS) {
        out.push(`... [${value.length - MAX_ARRAY_ITEMS} more items]`);
      }
      return out;
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined) {
        continue;
      }
      if (isSensitiveKey(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = sanitizeDebugValue(val, depth + 1, seen);
      }
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

export interface HarnessDebugLoggerOptions {
  dataDir?: string;
  enabled?: boolean;
  maxFileBytes?: number;
}

export type HarnessDebugLogInput = Omit<HarnessDebugLogEntry, "ts" | "level"> & {
  ts?: string;
  level?: HarnessDebugLogLevel;
};

function countNewlineDelimitedEntries(fd: number, fileSize: number): number {
  if (fileSize <= 0) {
    return 0;
  }
  const chunkSize = Math.min(LARGE_LOG_THRESHOLD_BYTES, fileSize);
  const buf = Buffer.allocUnsafe(chunkSize);
  let totalLines = 0;
  let lineHasContent = false;
  let offset = 0;

  while (offset < fileSize) {
    const bytesRead = fs.readSync(fd, buf, 0, chunkSize, offset);
    if (bytesRead <= 0) {
      break;
    }
    for (let i = 0; i < bytesRead; i += 1) {
      const b = buf[i]!;
      if (b === 0x0a) {
        if (lineHasContent) {
          totalLines += 1;
          lineHasContent = false;
        }
      } else if (b !== 0x0d && b !== 0x20 && b !== 0x09) {
        lineHasContent = true;
      }
    }
    offset += bytesRead;
  }

  if (lineHasContent) {
    totalLines += 1;
  }
  return totalLines;
}

function readTailDebugEntries(
  fd: number,
  fileSize: number,
  effectiveLimit: number,
): HarnessDebugLogEntry[] {
  if (effectiveLimit <= 0 || fileSize <= 0) {
    return [];
  }

  let windowBytes = Math.min(
    fileSize,
    Math.max(LARGE_LOG_THRESHOLD_BYTES, effectiveLimit * TAIL_BYTES_PER_LINE),
  );

  while (true) {
    const startOffset = Math.max(0, fileSize - windowBytes);
    const readLen = fileSize - startOffset;
    const buf = Buffer.allocUnsafe(readLen);
    let totalRead = 0;
    while (totalRead < readLen) {
      const n = fs.readSync(fd, buf, totalRead, readLen - totalRead, startOffset + totalRead);
      if (n <= 0) {
        break;
      }
      totalRead += n;
    }

    let textStart = 0;
    if (startOffset > 0) {
      const firstNewline = buf.subarray(0, totalRead).indexOf(0x0a);
      if (firstNewline === -1) {
        if (windowBytes >= fileSize) {
          return [];
        }
        windowBytes = Math.min(fileSize, windowBytes * 2);
        continue;
      }
      textStart = firstNewline + 1;
    }

    const tailText = buf.subarray(textStart, totalRead).toString("utf8");
    const lines = tailText.split(/\r?\n/);
    const entries: HarnessDebugLogEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && entries.length < effectiveLimit; i -= 1) {
      const line = lines[i]?.trim();
      if (!line) {
        continue;
      }
      try {
        const obj = JSON.parse(line) as unknown;
        const checked = HarnessDebugLogEntrySchema.safeParse(obj);
        if (checked.success) {
          entries.push(checked.data);
        }
      } catch {
        // Skip corrupted JSONL line
      }
    }

    if (entries.length >= effectiveLimit || startOffset === 0) {
      return entries;
    }
    windowBytes = Math.min(fileSize, windowBytes * 2);
  }
}

/**
 * Persistent JSONL debug trace logger with zero-I/O fast path when disabled,
 * recursive secret redaction, 0700/0600 permissions, and 5 MiB single-backup rotation.
 */
export class HarnessDebugLogger {
  readonly dataDir: string;
  readonly logFilePath: string;
  readonly rotatedFilePath: string;
  private readonly maxFileBytes: number;
  private enabled: boolean;
  private dirEnsured = false;

  constructor(options?: HarnessDebugLoggerOptions) {
    this.dataDir = resolveAgentHarnessDataDir(options?.dataDir);
    this.logFilePath = path.join(this.dataDir, "debug-trace.jsonl");
    this.rotatedFilePath = path.join(this.dataDir, "debug-trace.1.jsonl");
    this.enabled = Boolean(options?.enabled);
    this.maxFileBytes =
      typeof options?.maxFileBytes === "number" && options.maxFileBytes > 0
        ? options.maxFileBytes
        : DEBUG_LOG_MAX_BYTES;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = Boolean(enabled);
  }

  record(entry: HarnessDebugLogInput, options?: { force?: boolean }): void {
    if (!this.enabled && !options?.force) {
      return;
    }

    try {
      const normalizedDetail =
        entry.detail && typeof entry.detail === "object"
          ? (sanitizeDebugValue(entry.detail) as Record<string, unknown>)
          : undefined;

      const recordEntry: HarnessDebugLogEntry = {
        ts: entry.ts?.trim() || new Date().toISOString(),
        event: sanitizeString(entry.event),
        level: entry.level ?? "info",
        ...(entry.agentId ? { agentId: sanitizeString(entry.agentId) } : {}),
        ...(entry.role ? { role: sanitizeString(entry.role) } : {}),
        ...(entry.phase ? { phase: sanitizeString(entry.phase) } : {}),
        ...(entry.provider ? { provider: sanitizeString(entry.provider) } : {}),
        ...(entry.model ? { model: sanitizeString(entry.model) } : {}),
        ...(normalizedDetail && Object.keys(normalizedDetail).length > 0
          ? { detail: normalizedDetail }
          : {}),
      };

      const line = `${JSON.stringify(recordEntry)}\n`;
      const lineBytes = Buffer.byteLength(line, "utf8");

      if (!this.dirEnsured) {
        ensurePrivateDir(this.dataDir);
        this.dirEnsured = true;
      }

      const writeRecord = () => {
        let needsChmod = false;
        if (fs.existsSync(this.logFilePath)) {
          const stat = fs.statSync(this.logFilePath);
          if (
            stat.size >= this.maxFileBytes ||
            (stat.size > 0 && stat.size + lineBytes > this.maxFileBytes)
          ) {
            fs.renameSync(this.logFilePath, this.rotatedFilePath);
            chmodFileSecure(this.rotatedFilePath);
            needsChmod = true;
          }
        } else {
          needsChmod = true;
        }

        fs.appendFileSync(this.logFilePath, line, { encoding: "utf8", mode: 0o600 });
        if (needsChmod) {
          chmodFileSecure(this.logFilePath);
        }
      };

      try {
        writeRecord();
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
          this.dirEnsured = false;
          ensurePrivateDir(this.dataDir);
          this.dirEnsured = true;
          writeRecord();
        } else {
          throw error;
        }
      }
    } catch {
      // Never allow debug logging failures to disrupt agent execution
    }
  }

  getStatus(limit = DEFAULT_STATUS_LIMIT): HarnessDebugStatusOutput {
    const effectiveLimit =
      typeof limit === "number" && Number.isFinite(limit)
        ? Math.min(Math.max(0, Math.floor(limit)), MAX_STATUS_LIMIT)
        : DEFAULT_STATUS_LIMIT;

    const rotatedExists = fs.existsSync(this.rotatedFilePath);

    if (!fs.existsSync(this.logFilePath)) {
      return {
        enabled: this.enabled,
        logFilePath: this.logFilePath,
        totalLines: 0,
        fileSizeBytes: 0,
        rotatedExists,
        entries: [],
      };
    }

    try {
      const stat = fs.statSync(this.logFilePath);
      if (stat.size > LARGE_LOG_THRESHOLD_BYTES) {
        const fd = fs.openSync(this.logFilePath, "r");
        try {
          const totalLines = countNewlineDelimitedEntries(fd, stat.size);
          const entries = readTailDebugEntries(fd, stat.size, effectiveLimit);
          return {
            enabled: this.enabled,
            logFilePath: this.logFilePath,
            totalLines,
            fileSizeBytes: stat.size,
            rotatedExists,
            entries,
          };
        } finally {
          fs.closeSync(fd);
        }
      }

      const raw = fs.readFileSync(this.logFilePath, "utf8");
      const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
      const parsedEntries: HarnessDebugLogEntry[] = [];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as unknown;
          const checked = HarnessDebugLogEntrySchema.safeParse(obj);
          if (checked.success) {
            parsedEntries.push(checked.data);
          }
        } catch {
          // Skip corrupted JSONL line
        }
      }

      const recentReversed =
        effectiveLimit > 0 ? parsedEntries.slice(-effectiveLimit).toReversed() : [];

      return {
        enabled: this.enabled,
        logFilePath: this.logFilePath,
        totalLines: lines.length,
        fileSizeBytes: stat.size,
        rotatedExists,
        entries: recentReversed,
      };
    } catch {
      return {
        enabled: this.enabled,
        logFilePath: this.logFilePath,
        totalLines: 0,
        fileSizeBytes: 0,
        rotatedExists,
        entries: [],
      };
    }
  }

  clear(): HarnessDebugClearOutput {
    let removedBytes = 0;
    let cleared = true;

    for (const target of [this.logFilePath, this.rotatedFilePath]) {
      try {
        if (fs.existsSync(target)) {
          const stat = fs.statSync(target);
          removedBytes += stat.size;
          fs.unlinkSync(target);
        }
      } catch {
        cleared = false;
      }
    }

    this.dirEnsured = false;

    return {
      cleared,
      removedBytes,
    };
  }
}
