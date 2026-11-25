import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type {
  DailyUsagePoint,
  MemberModelUsage,
  MemberUsageSummary,
  RecentTurnRecord,
  TeamCollabUsageExportInput,
  TeamCollabUsageExportOutput,
  TeamCollabUsageQueryInput,
  TeamCollabUsageQueryOutput,
  TeamMemberProfile,
  UsageTotals,
  WorkspaceOwnerMetadata,
} from "../shared/contracts.js";
import { ensurePrivateDir, resolveTeamCollabDataDir } from "./secret-store.js";

const execFileAsync = promisify(execFile);
const MAX_SETTLED_TURN_KEYS = 2_000;

export interface RawUsageSnapshot {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
}

export interface ComputedUsageDelta {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function toNonNegInt(val: unknown): number {
  if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) {
    return 0;
  }
  return Math.round(val);
}

function toNonNegFloat(val: unknown): number {
  if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) {
    return 0;
  }
  return val;
}

function roundUsd(val: number): number {
  if (!Number.isFinite(val) || val <= 0) {
    return 0;
  }
  return Number(val.toFixed(8));
}

export function formatLocalDate(dateOrMs: Date | number): string {
  const d = dateOrMs instanceof Date ? dateOrMs : new Date(dateOrMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computeCutoffDateLocal(referenceMs: number, retentionDays: number): string {
  const safeDays = Math.max(7, Math.min(3650, Math.trunc(retentionDays)));
  const d = new Date(referenceMs);
  d.setDate(d.getDate() - safeDays);
  return formatLocalDate(d);
}

export function computeUsageDelta(
  before: RawUsageSnapshot | null | undefined,
  after: RawUsageSnapshot | null | undefined,
): ComputedUsageDelta {
  if (!after) {
    return {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }

  const afterInput = toNonNegInt(after.inputTokens);
  const afterCached = toNonNegInt(after.cachedInputTokens);
  const afterOutput = toNonNegInt(after.outputTokens);
  const afterCost = roundUsd(toNonNegFloat(after.totalCostUsd));

  if (!before) {
    return {
      inputTokens: afterInput,
      cachedInputTokens: afterCached,
      outputTokens: afterOutput,
      costUsd: afterCost,
    };
  }

  const beforeInput = toNonNegInt(before.inputTokens);
  const beforeCached = toNonNegInt(before.cachedInputTokens);
  const beforeOutput = toNonNegInt(before.outputTokens);
  const beforeCost = roundUsd(toNonNegFloat(before.totalCostUsd));

  // If any primary session counter drops below the prior snapshot, the provider reports per-turn counters
  const isPerTurnReset =
    afterInput < beforeInput ||
    afterOutput < beforeOutput ||
    (beforeCost > 0 && afterCost + 1e-9 < beforeCost);

  if (isPerTurnReset) {
    return {
      inputTokens: afterInput,
      cachedInputTokens: afterCached,
      outputTokens: afterOutput,
      costUsd: afterCost,
    };
  }

  return {
    inputTokens: Math.max(0, afterInput - beforeInput),
    cachedInputTokens: Math.max(0, afterCached - beforeCached),
    outputTokens: Math.max(0, afterOutput - beforeOutput),
    costUsd: roundUsd(Math.max(0, afterCost - beforeCost)),
  };
}

export function sanitizePromptPreview(
  rawText: string | null | undefined,
  maxCodePoints = 100,
): string | null {
  if (typeof rawText !== "string") {
    return null;
  }
  const normalized = rawText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  const chars = Array.from(normalized);
  if (chars.length <= maxCodePoints) {
    return normalized;
  }
  return chars.slice(0, maxCodePoints).join("");
}

export function extractTurnPromptPreview(
  rawTimeline: unknown,
  turnId: string | null,
): string | null {
  if (!rawTimeline || typeof rawTimeline !== "object") {
    return null;
  }

  let candidateEntries: unknown[] = [];
  if (Array.isArray(rawTimeline)) {
    candidateEntries = rawTimeline;
  } else if (
    "entries" in rawTimeline &&
    Array.isArray((rawTimeline as { entries: unknown }).entries)
  ) {
    candidateEntries = (rawTimeline as { entries: unknown[] }).entries;
  } else if ("items" in rawTimeline && Array.isArray((rawTimeline as { items: unknown }).items)) {
    candidateEntries = (rawTimeline as { items: unknown[] }).items;
  }

  const userTexts: string[] = [];
  for (const rawEntry of candidateEntries) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entryObj = rawEntry as Record<string, unknown>;
    if (
      turnId &&
      typeof entryObj.turnId === "string" &&
      entryObj.turnId.length > 0 &&
      entryObj.turnId !== turnId
    ) {
      continue;
    }
    const item =
      entryObj.item && typeof entryObj.item === "object"
        ? (entryObj.item as Record<string, unknown>)
        : entryObj;
    if (item.type === "user_message") {
      if (typeof item.text === "string" && item.text.trim()) {
        userTexts.push(item.text);
      } else if (Array.isArray(item.content)) {
        const textBlocks = item.content
          .filter((b): b is { type: string; text: string } =>
            Boolean(
              b &&
              typeof b === "object" &&
              (b as { type?: unknown }).type === "text" &&
              typeof (b as { text?: unknown }).text === "string",
            ),
          )
          .map((b) => b.text);
        if (textBlocks.length > 0) {
          userTexts.push(textBlocks.join(" "));
        }
      }
    }
  }

  if (userTexts.length === 0) {
    return null;
  }
  return sanitizePromptPreview(userTexts[userTexts.length - 1], 100);
}

export function escapeCsvCell(val: string | number | null | undefined): string {
  if (val === null || val === undefined) {
    return "";
  }
  if (typeof val === "number") {
    return Number.isFinite(val) ? String(val) : "0";
  }
  let str = String(val);
  // Neutralize spreadsheet formula injection triggers
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

interface TurnStartState {
  turnId: string | null;
  startedAtMs: number;
  baselineUsage?: RawUsageSnapshot;
}

export interface RecordTurnStartInput {
  agentId: string;
  turnId: string | null;
  startedAtMs?: number;
  baselineUsage?: RawUsageSnapshot | null;
}

export interface RecordTurnEndInput {
  agentId: string;
  turnId: string | null;
  finishedAt?: Date | string;
  startedAtMs?: number;
  owner: WorkspaceOwnerMetadata | null;
  workspaceId?: string | null;
  branch?: string | null;
  provider: string;
  model?: string | null;
  currentUsage?: RawUsageSnapshot | null;
  outcome: string;
  promptPreview?: string | null;
  retentionDays?: number;
  referenceNowMs?: number;
}

interface RollupRow {
  date: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  owner_kind: string;
  provider: string;
  model: string;
  turns: number;
  completed_turns: number;
  failed_turns: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
}

interface TurnEventRow {
  turn_id: string | null;
  timestamp: string;
  owner_id: string;
  owner_name: string;
  workspace_id: string | null;
  branch: string | null;
  agent_id: string;
  provider: string;
  model: string | null;
  duration_ms: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  outcome: string;
  prompt_preview: string | null;
}

export interface UsageLedgerOptions {
  dataDir?: string;
  getRetentionDays?: () => number;
  getRosterMembers?: () => readonly TeamMemberProfile[];
}

export class UsageLedger {
  readonly dataDir: string;
  readonly dbPath: string;
  private readonly db: DatabaseSync;
  private readonly getRetentionDays: () => number;
  private readonly getRosterMembers?: () => readonly TeamMemberProfile[];
  private readonly turnStarts = new Map<string, TurnStartState>();
  private readonly settledTurnKeys = new Set<string>();
  private readonly lastSeenUsageByAgent = new Map<string, RawUsageSnapshot>();
  private readonly knownRepoDirs = new Set<string>();
  private readonly commitCache = new Map<
    string,
    { expiresAt: number; entries: Array<{ email: string; date: string }> }
  >();
  private anonTurnSeq = 0;

  constructor(options?: UsageLedgerOptions) {
    this.dataDir = resolveTeamCollabDataDir(options?.dataDir);
    ensurePrivateDir(this.dataDir);
    this.dbPath = path.join(this.dataDir, "usage.sqlite");
    this.getRetentionDays = options?.getRetentionDays ?? (() => 90);
    this.getRosterMembers = options?.getRosterMembers;

    this.db = new DatabaseSync(this.dbPath);
    try {
      fs.chmodSync(this.dbPath, 0o600);
    } catch {
      // Ignore chmod error on non-POSIX systems
    }
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS turn_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        turn_key TEXT UNIQUE,
        turn_id TEXT,
        timestamp TEXT NOT NULL,
        date TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        owner_kind TEXT NOT NULL,
        workspace_id TEXT,
        branch TEXT,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        outcome TEXT NOT NULL,
        prompt_preview TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_turn_events_date_owner ON turn_events(date, owner_id);
      CREATE INDEX IF NOT EXISTS idx_turn_events_timestamp ON turn_events(timestamp DESC);

      CREATE TABLE IF NOT EXISTS daily_rollups (
        date TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        owner_kind TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        turns INTEGER NOT NULL DEFAULT 0,
        completed_turns INTEGER NOT NULL DEFAULT 0,
        failed_turns INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, owner_id, provider, model)
      );
    `);
  }

  private rememberSettledTurnKey(turnKey: string): void {
    if (this.settledTurnKeys.has(turnKey)) {
      return;
    }
    if (this.settledTurnKeys.size >= MAX_SETTLED_TURN_KEYS) {
      const oldest = this.settledTurnKeys.values().next().value;
      if (oldest !== undefined) {
        this.settledTurnKeys.delete(oldest);
      }
    }
    this.settledTurnKeys.add(turnKey);
  }

  registerRepoDirectory(cwd: string): void {
    if (!cwd) return;
    try {
      this.knownRepoDirs.add(fs.realpathSync(cwd));
    } catch {
      this.knownRepoDirs.add(path.resolve(cwd));
    }
  }

  recordTurnStart(input: RecordTurnStartInput): void {
    if (input.turnId) {
      const turnKey = `${input.agentId}:${input.turnId}`;
      // Ignore late-arriving turn.before events for turns already settled by turn.after
      if (this.settledTurnKeys.has(turnKey)) {
        return;
      }
    }

    const startedAtMs = input.startedAtMs ?? Date.now();
    const baseline = input.baselineUsage
      ? { ...input.baselineUsage }
      : this.lastSeenUsageByAgent.get(input.agentId);
    const state: TurnStartState = {
      turnId: input.turnId ?? null,
      startedAtMs,
      baselineUsage: baseline,
    };
    const key = `${input.agentId}:${input.turnId ?? "__active__"}`;
    this.turnStarts.set(key, state);
    this.turnStarts.set(`${input.agentId}:__active__`, state);
  }

  recordTurnEnd(input: RecordTurnEndInput): void {
    const finishedDate =
      input.finishedAt instanceof Date
        ? input.finishedAt
        : typeof input.finishedAt === "string"
          ? new Date(input.finishedAt)
          : new Date();
    const finishedMs = Number.isNaN(finishedDate.getTime()) ? Date.now() : finishedDate.getTime();
    const timestampIso = new Date(finishedMs).toISOString();
    const dateStr = formatLocalDate(finishedMs);

    const turnKey = input.turnId
      ? `${input.agentId}:${input.turnId}`
      : `${input.agentId}:anon:${timestampIso}:${++this.anonTurnSeq}`;
    if (input.turnId) {
      this.rememberSettledTurnKey(turnKey);
    }

    const exactStartKey = `${input.agentId}:${input.turnId ?? "__active__"}`;
    const fallbackStartKey = `${input.agentId}:__active__`;
    const exactEntry = this.turnStarts.get(exactStartKey);
    const fallbackEntry = this.turnStarts.get(fallbackStartKey);
    const startEntry =
      exactEntry ??
      (fallbackEntry &&
      (!input.turnId || !fallbackEntry.turnId || fallbackEntry.turnId === input.turnId)
        ? fallbackEntry
        : undefined);
    this.turnStarts.delete(exactStartKey);
    if (!fallbackEntry || !input.turnId || fallbackEntry.turnId === input.turnId) {
      this.turnStarts.delete(fallbackStartKey);
    }

    const startMs = input.startedAtMs ?? startEntry?.startedAtMs ?? finishedMs;
    const durationMs = Math.max(0, Math.round(finishedMs - startMs));

    const baselineUsage = startEntry?.baselineUsage ?? this.lastSeenUsageByAgent.get(input.agentId);
    const delta = computeUsageDelta(baselineUsage, input.currentUsage);

    if (input.currentUsage) {
      this.lastSeenUsageByAgent.set(input.agentId, { ...input.currentUsage });
    }

    const ownerId = input.owner?.id || "unclaimed";
    const ownerName = input.owner?.name || "Unclaimed";
    const ownerEmail = input.owner?.email || "";
    const ownerKind = input.owner?.kind || "unclaimed";

    const provider = input.provider?.trim() || "unknown";
    const modelForRollup = input.model?.trim() || "unknown";
    const modelNullable = input.model?.trim() || null;
    const outcome = input.outcome?.trim() || "completed";
    const promptPreview = sanitizePromptPreview(input.promptPreview, 100);

    const retentionDays = input.retentionDays ?? this.getRetentionDays();
    const refMs = input.referenceNowMs ?? Math.max(Date.now(), finishedMs);
    const cutoffDate = computeCutoffDateLocal(refMs, retentionDays);

    const isCompleted = outcome === "completed" ? 1 : 0;
    const isFailed = outcome === "failed" ? 1 : 0;

    const insertTurnStmt = this.db.prepare(`
      INSERT OR IGNORE INTO turn_events (
        turn_key, turn_id, timestamp, date,
        owner_id, owner_name, owner_email, owner_kind,
        workspace_id, branch, agent_id, provider, model,
        duration_ms, input_tokens, cached_input_tokens, output_tokens, cost_usd,
        outcome, prompt_preview
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `);

    const upsertRollupStmt = this.db.prepare(`
      INSERT INTO daily_rollups (
        date, owner_id, owner_name, owner_email, owner_kind,
        provider, model,
        turns, completed_turns, failed_turns,
        input_tokens, cached_input_tokens, output_tokens, cost_usd, duration_ms
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?,
        1, ?, ?,
        ?, ?, ?, ?, ?
      )
      ON CONFLICT(date, owner_id, provider, model) DO UPDATE SET
        owner_name = excluded.owner_name,
        owner_email = CASE WHEN excluded.owner_email != '' THEN excluded.owner_email ELSE daily_rollups.owner_email END,
        owner_kind = excluded.owner_kind,
        turns = daily_rollups.turns + 1,
        completed_turns = daily_rollups.completed_turns + excluded.completed_turns,
        failed_turns = daily_rollups.failed_turns + excluded.failed_turns,
        input_tokens = daily_rollups.input_tokens + excluded.input_tokens,
        cached_input_tokens = daily_rollups.cached_input_tokens + excluded.cached_input_tokens,
        output_tokens = daily_rollups.output_tokens + excluded.output_tokens,
        cost_usd = ROUND(daily_rollups.cost_usd + excluded.cost_usd, 8),
        duration_ms = daily_rollups.duration_ms + excluded.duration_ms
    `);

    const pruneTurnsStmt = this.db.prepare(`
      DELETE FROM turn_events WHERE date < ?
    `);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const res = insertTurnStmt.run(
        turnKey,
        input.turnId ?? null,
        timestampIso,
        dateStr,
        ownerId,
        ownerName,
        ownerEmail,
        ownerKind,
        input.workspaceId ?? null,
        input.branch ?? null,
        input.agentId,
        provider,
        modelNullable,
        durationMs,
        delta.inputTokens,
        delta.cachedInputTokens,
        delta.outputTokens,
        delta.costUsd,
        outcome,
        promptPreview,
      );

      if (Number(res.changes) > 0) {
        upsertRollupStmt.run(
          dateStr,
          ownerId,
          ownerName,
          ownerEmail,
          ownerKind,
          provider,
          modelForRollup,
          isCompleted,
          isFailed,
          delta.inputTokens,
          delta.cachedInputTokens,
          delta.outputTokens,
          delta.costUsd,
          durationMs,
        );
      }

      pruneTurnsStmt.run(cutoffDate);
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Ignore rollback failure
      }
      throw err;
    }
  }

  private queryRollupRows(filter: {
    fromDate?: string;
    toDate?: string;
    memberId?: string;
  }): RollupRow[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filter.fromDate) {
      clauses.push("date >= ?");
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      clauses.push("date <= ?");
      params.push(filter.toDate);
    }
    if (filter.memberId) {
      clauses.push("owner_id = ?");
      params.push(filter.memberId);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const stmt = this.db.prepare(`
      SELECT
        date, owner_id, owner_name, owner_email, owner_kind,
        provider, model,
        turns, completed_turns, failed_turns,
        input_tokens, cached_input_tokens, output_tokens, cost_usd, duration_ms
      FROM daily_rollups
      ${whereSql}
      ORDER BY date ASC, owner_id ASC, provider ASC, model ASC
    `);
    return stmt.all(...params) as unknown as RollupRow[];
  }

  private queryRecentTurnRows(filter: {
    fromDate?: string;
    toDate?: string;
    memberId?: string;
    limitTurns: number;
  }): TurnEventRow[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filter.fromDate) {
      clauses.push("date >= ?");
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      clauses.push("date <= ?");
      params.push(filter.toDate);
    }
    if (filter.memberId) {
      clauses.push("owner_id = ?");
      params.push(filter.memberId);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(Math.max(1, Math.min(500, filter.limitTurns)));

    const stmt = this.db.prepare(`
      SELECT
        turn_id, timestamp, owner_id, owner_name,
        workspace_id, branch, agent_id, provider, model,
        duration_ms, input_tokens, cached_input_tokens, output_tokens, cost_usd,
        outcome, prompt_preview
      FROM turn_events
      ${whereSql}
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `);
    return stmt.all(...params) as unknown as TurnEventRow[];
  }

  private async countCommitsByEmail(filter: {
    fromDate?: string;
    toDate?: string;
  }): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (this.knownRepoDirs.size === 0) {
      return counts;
    }

    const seenCommonDirs = new Set<string>();
    const now = Date.now();

    for (const dir of this.knownRepoDirs) {
      try {
        if (!fs.existsSync(dir)) continue;
        const commonOut = await execFileAsync("git", ["rev-parse", "--git-common-dir"], {
          cwd: dir,
          timeout: 1_500,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
        const rawCommon = commonOut.stdout.trim();
        if (!rawCommon) continue;
        let resolvedCommon: string;
        try {
          resolvedCommon = fs.realpathSync(path.resolve(dir, rawCommon));
        } catch {
          resolvedCommon = path.resolve(dir, rawCommon);
        }
        if (seenCommonDirs.has(resolvedCommon)) {
          continue;
        }
        seenCommonDirs.add(resolvedCommon);

        const cacheKey = `${resolvedCommon}::${filter.fromDate ?? ""}::${filter.toDate ?? ""}`;
        let entries: Array<{ email: string; date: string }>;
        const cached = this.commitCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
          entries = cached.entries;
        } else {
          const gitArgs = ["log", "--all", "--format=%ae%x09%as"];
          if (filter.fromDate) {
            gitArgs.push(`--since=${filter.fromDate} 00:00:00`);
          }
          if (filter.toDate) {
            gitArgs.push(`--until=${filter.toDate} 23:59:59`);
          }
          const logOut = await execFileAsync("git", gitArgs, {
            cwd: dir,
            timeout: 2_000,
            maxBuffer: 8 * 1024 * 1024,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          });
          entries = [];
          for (const line of logOut.stdout.split(/\r?\n/)) {
            if (!line) continue;
            const tab = line.indexOf("\t");
            if (tab <= 0) continue;
            entries.push({
              email: line.slice(0, tab).trim().toLowerCase(),
              date: line.slice(tab + 1).trim(),
            });
          }
          this.commitCache.set(cacheKey, {
            expiresAt: now + 3_000,
            entries,
          });
        }

        for (const item of entries) {
          if (filter.fromDate && item.date < filter.fromDate) continue;
          if (filter.toDate && item.date > filter.toDate) continue;
          counts.set(item.email, (counts.get(item.email) ?? 0) + 1);
        }
      } catch {
        // Silently degrade to 0 on git error or timeout
      }
    }

    return counts;
  }

  async queryUsage(
    input: TeamCollabUsageQueryInput,
    options?: { rosterMembers?: readonly TeamMemberProfile[] },
  ): Promise<TeamCollabUsageQueryOutput> {
    const rollupRows = this.queryRollupRows(input);
    const turnRows = this.queryRecentTurnRows({
      fromDate: input.fromDate,
      toDate: input.toDate,
      memberId: input.memberId,
      limitTurns: input.limitTurns ?? 50,
    });
    const commitCountsByEmail = await this.countCommitsByEmail({
      fromDate: input.fromDate,
      toDate: input.toDate,
    });

    const totals: UsageTotals = {
      turns: 0,
      completedTurns: 0,
      failedTurns: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalCostUsd: 0,
      durationMs: 0,
      commitCount: 0,
    };

    const memberMap = new Map<
      string,
      MemberUsageSummary & { modelMap: Map<string, MemberModelUsage> }
    >();
    const dailyMap = new Map<string, DailyUsagePoint>();

    for (const row of rollupRows) {
      const turns = Number(row.turns) || 0;
      const completedTurns = Number(row.completed_turns) || 0;
      const failedTurns = Number(row.failed_turns) || 0;
      const inputTokens = Number(row.input_tokens) || 0;
      const cachedInputTokens = Number(row.cached_input_tokens) || 0;
      const outputTokens = Number(row.output_tokens) || 0;
      const costUsd = roundUsd(Number(row.cost_usd) || 0);
      const durationMs = Number(row.duration_ms) || 0;

      totals.turns += turns;
      totals.completedTurns += completedTurns;
      totals.failedTurns += failedTurns;
      totals.inputTokens += inputTokens;
      totals.cachedInputTokens += cachedInputTokens;
      totals.outputTokens += outputTokens;
      totals.totalCostUsd = roundUsd(totals.totalCostUsd + costUsd);
      totals.durationMs += durationMs;

      let memberEntry = memberMap.get(row.owner_id);
      if (!memberEntry) {
        const emailLower = (row.owner_email || "").trim().toLowerCase();
        const memberCommits = emailLower ? (commitCountsByEmail.get(emailLower) ?? 0) : 0;
        memberEntry = {
          ownerId: row.owner_id,
          ownerName: row.owner_name,
          ownerEmail: row.owner_email,
          kind: row.owner_kind,
          turns: 0,
          completedTurns: 0,
          failedTurns: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalCostUsd: 0,
          durationMs: 0,
          commitCount: memberCommits,
          models: [],
          modelMap: new Map(),
        };
        memberMap.set(row.owner_id, memberEntry);
      } else {
        memberEntry.ownerName = row.owner_name || memberEntry.ownerName;
        if (row.owner_email && !memberEntry.ownerEmail) {
          memberEntry.ownerEmail = row.owner_email;
          const emailLower = row.owner_email.trim().toLowerCase();
          memberEntry.commitCount = emailLower ? (commitCountsByEmail.get(emailLower) ?? 0) : 0;
        }
      }

      memberEntry.turns += turns;
      memberEntry.completedTurns += completedTurns;
      memberEntry.failedTurns += failedTurns;
      memberEntry.inputTokens += inputTokens;
      memberEntry.cachedInputTokens += cachedInputTokens;
      memberEntry.outputTokens += outputTokens;
      memberEntry.totalCostUsd = roundUsd(memberEntry.totalCostUsd + costUsd);
      memberEntry.durationMs += durationMs;

      const modelKey = `${row.provider}::${row.model}`;
      let modelEntry = memberEntry.modelMap.get(modelKey);
      if (!modelEntry) {
        modelEntry = {
          provider: row.provider,
          model: row.model,
          turns: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalCostUsd: 0,
        };
        memberEntry.modelMap.set(modelKey, modelEntry);
      }
      modelEntry.turns += turns;
      modelEntry.inputTokens += inputTokens;
      modelEntry.cachedInputTokens += cachedInputTokens;
      modelEntry.outputTokens += outputTokens;
      modelEntry.totalCostUsd = roundUsd(modelEntry.totalCostUsd + costUsd);

      const dailyKey = `${row.date}::${row.owner_id}`;
      let dailyEntry = dailyMap.get(dailyKey);
      if (!dailyEntry) {
        dailyEntry = {
          date: row.date,
          ownerId: row.owner_id,
          ownerName: row.owner_name,
          kind: row.owner_kind,
          turns: 0,
          completedTurns: 0,
          failedTurns: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalCostUsd: 0,
          durationMs: 0,
        };
        dailyMap.set(dailyKey, dailyEntry);
      }
      dailyEntry.turns += turns;
      dailyEntry.completedTurns += completedTurns;
      dailyEntry.failedTurns += failedTurns;
      dailyEntry.inputTokens += inputTokens;
      dailyEntry.cachedInputTokens += cachedInputTokens;
      dailyEntry.outputTokens += outputTokens;
      dailyEntry.totalCostUsd = roundUsd(dailyEntry.totalCostUsd + costUsd);
      dailyEntry.durationMs += durationMs;
    }

    // Backfill roster members who authored Git commits in the window even with 0 AI turns
    const roster = options?.rosterMembers ?? this.getRosterMembers?.() ?? [];
    for (const member of roster) {
      if (input.memberId && member.id !== input.memberId) {
        continue;
      }
      const emailLower = member.email.trim().toLowerCase();
      if (!emailLower) continue;
      const memberCommits = commitCountsByEmail.get(emailLower) ?? 0;

      const existing = memberMap.get(member.id);
      if (existing) {
        if (!existing.ownerEmail) {
          existing.ownerEmail = member.email;
          existing.commitCount = memberCommits;
        }
      } else if (memberCommits > 0) {
        memberMap.set(member.id, {
          ownerId: member.id,
          ownerName: member.name,
          ownerEmail: member.email,
          kind: "member",
          turns: 0,
          completedTurns: 0,
          failedTurns: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalCostUsd: 0,
          durationMs: 0,
          commitCount: memberCommits,
          models: [],
          modelMap: new Map(),
        });
      }
    }

    const byMember: MemberUsageSummary[] = Array.from(memberMap.values())
      .map(({ modelMap, ...summary }) => ({
        ...summary,
        models: Array.from(modelMap.values()).sort(
          (a, b) => b.totalCostUsd - a.totalCostUsd || b.turns - a.turns,
        ),
      }))
      .sort(
        (a, b) =>
          b.totalCostUsd - a.totalCostUsd ||
          b.turns - a.turns ||
          b.commitCount - a.commitCount ||
          a.ownerId.localeCompare(b.ownerId),
      );

    totals.commitCount = byMember.reduce((sum, m) => sum + m.commitCount, 0);

    const dailySeries = Array.from(dailyMap.values()).sort((a, b) =>
      a.date !== b.date ? a.date.localeCompare(b.date) : a.ownerId.localeCompare(b.ownerId),
    );

    const recentTurns: RecentTurnRecord[] = turnRows.map((t) => ({
      turnId: t.turn_id ?? null,
      timestamp: t.timestamp,
      ownerId: t.owner_id,
      ownerName: t.owner_name,
      workspaceId: t.workspace_id ?? null,
      branch: t.branch ?? null,
      agentId: t.agent_id,
      provider: t.provider,
      model: t.model ?? null,
      durationMs: Number(t.duration_ms) || 0,
      inputTokens: Number(t.input_tokens) || 0,
      cachedInputTokens: Number(t.cached_input_tokens) || 0,
      outputTokens: Number(t.output_tokens) || 0,
      costUsd: roundUsd(Number(t.cost_usd) || 0),
      outcome: t.outcome,
      promptPreview: t.prompt_preview ?? null,
    }));

    return {
      totals,
      byMember,
      dailySeries,
      recentTurns,
    };
  }

  async exportUsage(input: TeamCollabUsageExportInput): Promise<TeamCollabUsageExportOutput> {
    const format = input.format ?? "csv";
    const rollupRows = this.queryRollupRows({
      fromDate: input.fromDate,
      toDate: input.toDate,
      memberId: input.memberId,
    });
    const stamp = formatLocalDate(new Date());

    if (format === "json") {
      const summary = await this.queryUsage({
        fromDate: input.fromDate,
        toDate: input.toDate,
        memberId: input.memberId,
        limitTurns: 500,
      });
      const payload = {
        generatedAt: new Date().toISOString(),
        filter: {
          fromDate: input.fromDate ?? null,
          toDate: input.toDate ?? null,
          memberId: input.memberId ?? null,
        },
        totals: summary.totals,
        byMember: summary.byMember,
        dailyRollups: rollupRows.map((r) => ({
          date: r.date,
          ownerId: r.owner_id,
          ownerName: r.owner_name,
          ownerEmail: r.owner_email,
          kind: r.owner_kind,
          provider: r.provider,
          model: r.model,
          turns: Number(r.turns) || 0,
          completedTurns: Number(r.completed_turns) || 0,
          failedTurns: Number(r.failed_turns) || 0,
          inputTokens: Number(r.input_tokens) || 0,
          cachedInputTokens: Number(r.cached_input_tokens) || 0,
          outputTokens: Number(r.output_tokens) || 0,
          costUsd: roundUsd(Number(r.cost_usd) || 0),
          durationMs: Number(r.duration_ms) || 0,
        })),
        recentTurns: summary.recentTurns,
      };
      return {
        format: "json",
        filename: `team-collab-usage-${stamp}.json`,
        content: `${JSON.stringify(payload, null, 2)}\n`,
        rowCount: rollupRows.length,
      };
    }

    const headers = [
      "date",
      "owner_id",
      "owner_name",
      "owner_email",
      "owner_kind",
      "provider",
      "model",
      "turns",
      "completed_turns",
      "failed_turns",
      "input_tokens",
      "cached_input_tokens",
      "output_tokens",
      "cost_usd",
      "duration_ms",
    ];
    const lines = [headers.join(",")];
    for (const r of rollupRows) {
      lines.push(
        [
          escapeCsvCell(r.date),
          escapeCsvCell(r.owner_id),
          escapeCsvCell(r.owner_name),
          escapeCsvCell(r.owner_email),
          escapeCsvCell(r.owner_kind),
          escapeCsvCell(r.provider),
          escapeCsvCell(r.model),
          escapeCsvCell(Number(r.turns) || 0),
          escapeCsvCell(Number(r.completed_turns) || 0),
          escapeCsvCell(Number(r.failed_turns) || 0),
          escapeCsvCell(Number(r.input_tokens) || 0),
          escapeCsvCell(Number(r.cached_input_tokens) || 0),
          escapeCsvCell(Number(r.output_tokens) || 0),
          escapeCsvCell(roundUsd(Number(r.cost_usd) || 0)),
          escapeCsvCell(Number(r.duration_ms) || 0),
        ].join(","),
      );
    }

    return {
      format: "csv",
      filename: `team-collab-usage-${stamp}.csv`,
      content: `${lines.join("\n")}\n`,
      rowCount: rollupRows.length,
    };
  }

  forgetAgent(agentId: string): void {
    this.lastSeenUsageByAgent.delete(agentId);
    for (const key of this.turnStarts.keys()) {
      if (key.startsWith(`${agentId}:`)) {
        this.turnStarts.delete(key);
      }
    }
  }

  close(): void {
    if (this.db.isOpen) {
      this.db.close();
    }
  }
}
