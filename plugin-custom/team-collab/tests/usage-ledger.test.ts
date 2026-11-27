import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server.js";
import {
  computeUsageDelta,
  extractTurnPromptPreview,
  sanitizePromptPreview,
  UsageLedger,
} from "../server/usage-ledger.js";
import {
  DEFAULT_TEAM_COLLAB_SETTINGS,
  TEAM_COLLAB_OWNER_META_KEY,
  teamCollabMemberUpsertRpc,
  teamCollabRosterStatusRpc,
  teamCollabUsageExportRpc,
  teamCollabUsageQueryRpc,
  teamCollabWorkspaceAssignRpc,
} from "../shared/contracts.js";

function git(cwd: string, args: string[], envOverrides?: Record<string, string>): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      ...envOverrides,
    },
  }).trim();
}

describe("UsageLedger (node:sqlite) & full plugin integration", () => {
  let tempRoot: string;
  let dataDir: string;
  let prevPaseoHome: string | undefined;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "team-collab-ledger-"));
    dataDir = path.join(tempRoot, "plugin-data", "team-collab");
    prevPaseoHome = process.env.PASEO_HOME;
    process.env.PASEO_HOME = tempRoot;
  });

  afterEach(() => {
    if (prevPaseoHome === undefined) {
      delete process.env.PASEO_HOME;
    } else {
      process.env.PASEO_HOME = prevPaseoHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("computes usage deltas across first turn, cumulative monotonic increase, and per-turn reset providers", () => {
    // 1. First turn (no baseline)
    expect(
      computeUsageDelta(undefined, {
        inputTokens: 1000,
        cachedInputTokens: 200,
        outputTokens: 300,
        totalCostUsd: 0.05,
      }),
    ).toEqual({
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 300,
      costUsd: 0.05,
    });

    // 2. Cumulative monotonic increase (Turn 2 >= Turn 1)
    expect(
      computeUsageDelta(
        {
          inputTokens: 1000,
          cachedInputTokens: 200,
          outputTokens: 300,
          totalCostUsd: 0.05,
        },
        {
          inputTokens: 2500,
          cachedInputTokens: 800,
          outputTokens: 550,
          totalCostUsd: 0.12,
        },
      ),
    ).toEqual({
      inputTokens: 1500,
      cachedInputTokens: 600,
      outputTokens: 250,
      costUsd: 0.07,
    });

    // 3. Per-turn reset provider (Turn 2 < Turn 1)
    expect(
      computeUsageDelta(
        {
          inputTokens: 2500,
          cachedInputTokens: 800,
          outputTokens: 550,
          totalCostUsd: 0.12,
        },
        {
          inputTokens: 400,
          cachedInputTokens: 50,
          outputTokens: 120,
          totalCostUsd: 0.02,
        },
      ),
    ).toEqual({
      inputTokens: 400,
      cachedInputTokens: 50,
      outputTokens: 120,
      costUsd: 0.02,
    });

    // 4. Unchanged snapshot -> 0 delta
    expect(
      computeUsageDelta(
        { inputTokens: 1000, cachedInputTokens: 200, outputTokens: 300, totalCostUsd: 0.05 },
        { inputTokens: 1000, cachedInputTokens: 200, outputTokens: 300, totalCostUsd: 0.05 },
      ),
    ).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
  });

  it("normalizes whitespace and truncates prompt previews to 100 characters without binary leakage", () => {
    const longPrompt = `   请帮我重构   auth 模块并补充单元测试：${"A".repeat(120)}   `;
    const preview = sanitizePromptPreview(longPrompt);
    expect(preview).not.toBeNull();
    expect(Array.from(preview!).length).toBe(100);
    expect(preview!.startsWith("请帮我重构 auth 模块并补充单元测试：AAAA")).toBe(true);

    const timeline = {
      entries: [
        {
          turnId: "turn_old",
          item: { type: "user_message", text: "Old turn prompt" },
        },
        {
          turnId: "turn_current",
          item: {
            type: "user_message",
            text: `Line 1\n\n  Line 2 ${"x".repeat(110)}`,
            attachments: [{ data: "BASE64_BINARY_BLOB_SHOULD_NOT_APPEAR" }],
          },
        },
      ],
    };
    const extracted = extractTurnPromptPreview(timeline, "turn_current");
    expect(extracted).not.toBeNull();
    expect(Array.from(extracted!).length).toBe(100);
    expect(extracted).not.toContain("BASE64_BINARY_BLOB_SHOULD_NOT_APPEAR");
    expect(extracted!.startsWith("Line 1 Line 2 xxxx")).toBe(true);
  });

  it("prunes turn_events older than 90 days while permanently retaining daily_rollups and exporting valid CSV/JSON", async () => {
    const repoDir = path.join(tempRoot, "repo");
    fs.mkdirSync(repoDir, { recursive: true });
    git(repoDir, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(repoDir, "a.txt"), "hello\n");
    git(repoDir, ["add", "a.txt"]);
    git(repoDir, ["commit", "-m", "feat: alice commit"], {
      GIT_AUTHOR_NAME: "Alice",
      GIT_AUTHOR_EMAIL: "alice@team.local",
      GIT_COMMITTER_NAME: "Alice",
      GIT_COMMITTER_EMAIL: "alice@team.local",
    });

    const ledger = new UsageLedger({ dataDir, getRetentionDays: () => 90 });
    ledger.registerRepoDirectory(repoDir);

    const aliceOwner = {
      id: "alice",
      name: "Alice",
      email: "alice@team.local",
      kind: "member" as const,
      assignedAt: "2026-01-01T00:00:00.000Z",
    };

    // 1. Historical turn 120 days before 2026-11-24 -> 2026-07-27 (should be pruned from turn_events, kept in daily_rollups!)
    ledger.recordTurnEnd({
      agentId: "ag_hist",
      turnId: "t_old_1",
      finishedAt: "2026-07-27T10:00:00.000Z",
      startedAtMs: Date.parse("2026-07-27T09:59:50.000Z"),
      owner: aliceOwner,
      workspaceId: "wks_1",
      branch: "main",
      provider: "claude",
      model: "claude-sonnet-4-5",
      currentUsage: {
        inputTokens: 2000,
        cachedInputTokens: 500,
        outputTokens: 600,
        totalCostUsd: 0.08,
      },
      outcome: "completed",
      promptPreview: "Historical prompt that should expire from turn_events",
      referenceNowMs: Date.parse("2026-11-24T12:00:00.000Z"),
    });

    // 2. Recent turn on 2026-11-24 -> retained in BOTH turn_events and daily_rollups
    ledger.recordTurnEnd({
      agentId: "ag_recent",
      turnId: "t_new_1",
      finishedAt: "2026-11-24T11:00:00.000Z",
      startedAtMs: Date.parse("2026-11-24T10:59:45.000Z"),
      owner: aliceOwner,
      workspaceId: "wks_1",
      branch: "feat/ledger",
      provider: "claude",
      model: "claude-sonnet-4-5",
      currentUsage: {
        inputTokens: 1200,
        cachedInputTokens: 300,
        outputTokens: 400,
        totalCostUsd: 0.04,
      },
      outcome: "completed",
      promptPreview: 'Recent prompt, with comma "and quotes"',
      referenceNowMs: Date.parse("2026-11-24T12:00:00.000Z"),
    });

    const queryResult = await ledger.queryUsage({ limitTurns: 50 });

    // Totals & dailySeries preserve BOTH historical (2026-07-27) and recent (2026-11-24) rollups!
    expect(queryResult.totals).toMatchObject({
      turns: 2,
      completedTurns: 2,
      failedTurns: 0,
      inputTokens: 3200,
      cachedInputTokens: 800,
      outputTokens: 1000,
      totalCostUsd: 0.12,
      durationMs: 25_000,
      commitCount: 1,
    });
    expect(queryResult.dailySeries).toHaveLength(2);
    expect(queryResult.dailySeries.map((d) => d.date)).toEqual(["2026-07-27", "2026-11-24"]);

    // Expired turn_events row from 2026-07-27 was pruned, only recent 2026-11-24 remains
    expect(queryResult.recentTurns).toHaveLength(1);
    expect(queryResult.recentTurns[0].turnId).toBe("t_new_1");

    // Verify CSV & JSON exports
    const csvExport = await ledger.exportUsage({ format: "csv" });
    expect(csvExport.format).toBe("csv");
    expect(csvExport.rowCount).toBe(2);
    expect(csvExport.filename).toMatch(/^team-collab-usage-.*\.csv$/);
    const csvLines = csvExport.content.trim().split("\n");
    expect(csvLines).toHaveLength(3); // 1 header + 2 daily rollup rows
    expect(csvLines[0]).toContain("date,owner_id,owner_name,owner_email");

    const jsonExport = await ledger.exportUsage({ format: "json" });
    expect(jsonExport.format).toBe("json");
    expect(jsonExport.rowCount).toBe(2);
    const parsedJson = JSON.parse(jsonExport.content) as {
      totals: { turns: number; totalCostUsd: number };
      dailyRollups: unknown[];
    };
    expect(parsedJson.totals.turns).toBe(2);
    expect(parsedJson.dailyRollups).toHaveLength(2);

    ledger.close();
  });

  it("segments per-turn billing accurately across members when workspace ownership is reassigned mid-session via RPC", async () => {
    const mainRepo = path.join(tempRoot, "main-repo");
    const wtDir = path.join(tempRoot, "wt-shared");
    fs.mkdirSync(mainRepo, { recursive: true });
    git(mainRepo, ["init", "-b", "main"]);
    git(mainRepo, ["config", "user.name", "Init"]);
    git(mainRepo, ["config", "user.email", "init@local"]);
    fs.writeFileSync(path.join(mainRepo, "file.txt"), "v1\n");
    git(mainRepo, ["add", "file.txt"]);
    git(mainRepo, ["commit", "-m", "init"]);
    git(mainRepo, ["worktree", "add", "-b", "feat/handoff", wtDir]);

    const rpcHandlers = new Map<string, (input: unknown, ctx: { paseo: unknown }) => unknown>();
    const hookHandlers = new Map<
      string,
      (payload: unknown, ctx: { paseo: unknown; signal: AbortSignal }) => unknown
    >();

    const fakeServer: PluginServerContext = {
      registerSettings(def) {
        return {
          read: async () => ({
            status: "ready" as const,
            revision: "rev_1",
            values: def.schema.parse({}),
          }),
          subscribe: () => () => {},
        };
      },
      handle(contract: { name: string }, handler: (...args: never[]) => unknown) {
        rpcHandlers.set(
          contract.name,
          handler as unknown as (input: unknown, ctx: { paseo: unknown }) => unknown,
        );
      },
      addHook(name: string, handler: (...args: never[]) => unknown) {
        hookHandlers.set(
          name,
          handler as unknown as (
            payload: unknown,
            ctx: { paseo: unknown; signal: AbortSignal },
          ) => unknown,
        );
        return () => {
          hookHandlers.delete(name);
        };
      },
      on: () => () => {},
      before: () => () => {},
      registerProvider: () => {},
      registerUsageSource: () => {},
      registerWorktreeManager: () => () => {},
      notifications: {
        send: async () => ({ status: "sent", notificationId: "n_test" }),
      },
    };

    const wsMetadata: Record<string, unknown> = {};
    const agMetadata: Record<string, unknown> = {};
    let currentAgentUsage = {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalCostUsd: 0,
    };
    let latestTurnText = "";
    let latestTurnId = "";

    let currentAgentStatus: "idle" | "running" = "idle";
    let reloadCalls = 0;

    const fakePaseo = {
      workspaces: {
        list: async () => ({
          requestId: "r1",
          entries: [
            {
              id: "wks_handoff",
              projectId: "proj_1",
              projectRootPath: mainRepo,
              workspaceDirectory: wtDir,
              metadata: wsMetadata,
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        }),
        ref: () => ({
          id: "wks_handoff",
          current: () => ({
            id: "wks_handoff",
            projectId: "proj_1",
            projectRootPath: mainRepo,
            workspaceDirectory: wtDir,
            metadata: wsMetadata,
          }),
          refresh: async () => ({
            id: "wks_handoff",
            projectId: "proj_1",
            projectRootPath: mainRepo,
            workspaceDirectory: wtDir,
            metadata: wsMetadata,
          }),
          setMetadata: async (patch: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(patch)) {
              if (v === null) delete wsMetadata[k];
              else wsMetadata[k] = v;
            }
          },
        }),
      },
      agents: {
        list: async () => ({
          requestId: "r2",
          entries: [
            {
              agent: {
                id: "ag_1",
                workspaceId: "wks_handoff",
                cwd: wtDir,
                status: currentAgentStatus,
                metadata: agMetadata,
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        }),
        ref: () => ({
          id: "ag_1",
          current: () => ({
            id: "ag_1",
            workspaceId: "wks_handoff",
            cwd: wtDir,
            status: currentAgentStatus,
            provider: "codex",
            model: "gpt-5.3-codex",
            lastUsage: { ...currentAgentUsage },
            metadata: agMetadata,
          }),
          refresh: async () => ({
            agent: {
              id: "ag_1",
              workspaceId: "wks_handoff",
              cwd: wtDir,
              status: currentAgentStatus,
              provider: "codex",
              model: "gpt-5.3-codex",
              lastUsage: { ...currentAgentUsage },
              metadata: agMetadata,
            },
            project: null,
          }),
          reload: async () => {
            reloadCalls += 1;
            return null;
          },
          setMetadata: async (patch: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(patch)) {
              if (v === null) delete agMetadata[k];
              else agMetadata[k] = v;
            }
          },
          timeline: {
            refetch: async () => ({
              entries: [
                {
                  turnId: latestTurnId,
                  item: { type: "user_message", text: latestTurnText },
                },
              ],
            }),
          },
        }),
      },
    };

    const cleanup = contribute(fakeServer);
    const signal = new AbortController().signal;

    const callRpc = async <TOut>(
      contract: {
        name: string;
        input: { parse: (v: unknown) => unknown };
        output: { parse: (v: unknown) => TOut };
      },
      rawInput: unknown,
    ): Promise<TOut> => {
      const handler = rpcHandlers.get(contract.name);
      expect(handler).toBeTypeOf("function");
      const parsedIn = contract.input.parse(rawInput);
      const rawOut = await handler!(parsedIn, { paseo: fakePaseo });
      return contract.output.parse(rawOut);
    };

    // Upsert Alice & Bob via RPC
    await callRpc(teamCollabMemberUpsertRpc, {
      member: { id: "alice", name: "Alice", email: "alice@team.local", enabled: true },
      credentials: { giteaToken: "gta_alice_token_1111", giteaUrl: "https://git.team.local" },
    });
    await callRpc(teamCollabMemberUpsertRpc, {
      member: { id: "bob", name: "Bob", email: "bob@team.local", enabled: true },
      credentials: { githubToken: "ghp_bob_token_2222" },
    });

    const rosterStatus = await callRpc(teamCollabRosterStatusRpc, undefined);
    expect(rosterStatus.members).toHaveLength(2);

    // Bind workspace to Alice -> runs Turn 1 (1000 in, 300 out, $0.05)
    await callRpc(teamCollabWorkspaceAssignRpc, {
      workspaceId: "wks_handoff",
      memberId: "alice",
    });
    expect(wsMetadata[TEAM_COLLAB_OWNER_META_KEY]).toMatchObject({ id: "alice" });

    latestTurnId = "turn_1";
    latestTurnText = "Implement initial API handler";
    await hookHandlers.get("agent.turn.before")!(
      {
        agent: {
          id: "ag_1",
          workspaceId: "wks_handoff",
          cwd: wtDir,
          provider: "codex",
          metadata: agMetadata,
        },
        turnId: "turn_1",
      },
      { paseo: fakePaseo, signal },
    );
    currentAgentUsage = {
      inputTokens: 1000,
      cachedInputTokens: 100,
      outputTokens: 300,
      totalCostUsd: 0.05,
    };
    await hookHandlers.get("agent.turn.after")!(
      {
        agent: {
          id: "ag_1",
          workspaceId: "wks_handoff",
          cwd: wtDir,
          provider: "codex",
          metadata: agMetadata,
        },
        turnId: "turn_1",
        outcome: { kind: "completed" },
      },
      { paseo: fakePaseo, signal },
    );

    // Mid-session handoff while ag_1 is running Turn 2: reload is deferred until turn_2 completes!
    currentAgentStatus = "running";
    const reloadsBeforeReassign = reloadCalls;
    await callRpc(teamCollabWorkspaceAssignRpc, {
      workspaceId: "wks_handoff",
      memberId: "bob",
    });
    expect(wsMetadata[TEAM_COLLAB_OWNER_META_KEY]).toMatchObject({ id: "bob" });
    expect(reloadCalls).toBe(reloadsBeforeReassign);

    latestTurnId = "turn_2";
    latestTurnText = "Add edge-case validation and tests";
    await hookHandlers.get("agent.turn.before")!(
      {
        agent: {
          id: "ag_1",
          workspaceId: "wks_handoff",
          cwd: wtDir,
          provider: "codex",
          metadata: agMetadata,
        },
        turnId: "turn_2",
      },
      { paseo: fakePaseo, signal },
    );
    currentAgentUsage = {
      inputTokens: 2800,
      cachedInputTokens: 500,
      outputTokens: 700,
      totalCostUsd: 0.14,
    };
    currentAgentStatus = "idle";
    await hookHandlers.get("agent.turn.after")!(
      {
        agent: {
          id: "ag_1",
          workspaceId: "wks_handoff",
          cwd: wtDir,
          provider: "codex",
          metadata: agMetadata,
        },
        turnId: "turn_2",
        outcome: { kind: "completed" },
      },
      { paseo: fakePaseo, signal },
    );
    expect(reloadCalls).toBe(reloadsBeforeReassign + 1);
    expect(hookHandlers.has("workspace.archive.after")).toBe(true);

    const summary = await callRpc(teamCollabUsageQueryRpc, {});
    expect(summary.totals).toMatchObject({
      turns: 2,
      inputTokens: 2800,
      cachedInputTokens: 500,
      outputTokens: 700,
      totalCostUsd: 0.14,
    });

    const aliceSummary = summary.byMember.find((m) => m.ownerId === "alice");
    const bobSummary = summary.byMember.find((m) => m.ownerId === "bob");
    expect(aliceSummary).toMatchObject({
      turns: 1,
      inputTokens: 1000,
      cachedInputTokens: 100,
      outputTokens: 300,
      totalCostUsd: 0.05,
    });
    expect(bobSummary).toMatchObject({
      turns: 1,
      inputTokens: 1800,
      cachedInputTokens: 400,
      outputTokens: 400,
      totalCostUsd: 0.09,
    });

    const exportedCsv = await callRpc(teamCollabUsageExportRpc, { format: "csv" });
    expect(exportedCsv.rowCount).toBe(2);

    if (typeof cleanup === "function") {
      await cleanup();
    }
  });

  it("aligns rollup dates to local timezone, includes 0-turn committers, ignores late turn.before races, and neutralizes CSV formula injection ([MEDIUM-08])", async () => {
    const repoDir = path.join(tempRoot, "repo-m08");
    fs.mkdirSync(repoDir, { recursive: true });
    git(repoDir, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(repoDir, "c.txt"), "commit-only member\n");
    git(repoDir, ["add", "c.txt"]);
    git(repoDir, ["commit", "-m", "feat: dave manual commit"], {
      GIT_AUTHOR_NAME: "Dave",
      GIT_AUTHOR_EMAIL: "dave@team.local",
      GIT_AUTHOR_DATE: "2026-11-24T12:00:00",
      GIT_COMMITTER_NAME: "Dave",
      GIT_COMMITTER_EMAIL: "dave@team.local",
      GIT_COMMITTER_DATE: "2026-11-24T12:00:00",
    });

    const ledger = new UsageLedger({
      dataDir: path.join(tempRoot, "ledger-m08"),
      getRetentionDays: () => 90,
      getRosterMembers: () => [
        {
          id: "dave",
          name: "Dave Committer",
          email: "dave@team.local",
          enabled: true,
        },
      ],
    });
    ledger.registerRepoDirectory(repoDir);

    // 1. Local 00:30 AM on 2026-11-24 -> must record date "2026-11-24" in local timezone
    const localEarlyMorning = new Date(2026, 10, 24, 0, 30, 0);
    const formulaOwner = {
      id: "alice",
      name: "=CMD|' /C calc'!A0",
      email: "alice@team.local",
      kind: "member" as const,
      assignedAt: "2026-11-24T00:00:00.000Z",
    };

    // 2. Out-of-order race: turn_race_1 settles in recordTurnEnd BEFORE delayed recordTurnStart arrives
    ledger.recordTurnEnd({
      agentId: "ag_race",
      turnId: "turn_race_1",
      finishedAt: localEarlyMorning,
      owner: formulaOwner,
      provider: "codex",
      model: "+gpt-formula,v1",
      currentUsage: {
        inputTokens: 1000,
        cachedInputTokens: 0,
        outputTokens: 200,
        totalCostUsd: 0.05,
      },
      outcome: "completed",
    });

    // Delayed turn.before for already-settled turn_race_1 with stale 0 usage must be ignored!
    ledger.recordTurnStart({
      agentId: "ag_race",
      turnId: "turn_race_1",
      baselineUsage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalCostUsd: 0,
      },
    });

    // Turn 2 finishes with cumulative 1500 input / 350 output / $0.08 -> delta must be 500 / 150 / $0.03
    ledger.recordTurnEnd({
      agentId: "ag_race",
      turnId: "turn_race_2",
      finishedAt: new Date(2026, 10, 24, 0, 35, 0),
      owner: formulaOwner,
      provider: "codex",
      model: "+gpt-formula,v1",
      currentUsage: {
        inputTokens: 1500,
        cachedInputTokens: 0,
        outputTokens: 350,
        totalCostUsd: 0.08,
      },
      outcome: "completed",
    });

    const queried = await ledger.queryUsage({
      fromDate: "2026-11-24",
      toDate: "2026-11-24",
      limitTurns: 50,
    });

    expect(queried.dailySeries).toHaveLength(1);
    expect(queried.dailySeries[0].date).toBe("2026-11-24");
    expect(queried.totals).toMatchObject({
      turns: 2,
      inputTokens: 1500,
      outputTokens: 350,
      totalCostUsd: 0.08,
      commitCount: 1,
    });

    // Dave has 0 AI turns but 1 Git commit in the window -> present in byMember!
    const daveRow = queried.byMember.find((m) => m.ownerId === "dave");
    expect(daveRow).toMatchObject({
      ownerId: "dave",
      ownerName: "Dave Committer",
      turns: 0,
      commitCount: 1,
    });

    // Outside the commit date window -> 0 commits
    const emptyWindow = await ledger.queryUsage({
      fromDate: "2025-01-01",
      toDate: "2025-01-02",
      limitTurns: 50,
    });
    expect(emptyWindow.totals.commitCount).toBe(0);
    expect(emptyWindow.byMember).toHaveLength(0);

    // 3. CSV export prefixes formula-triggering characters with single quote '
    const csv = await ledger.exportUsage({ format: "csv" });
    expect(csv.content).toContain("'=CMD|' /C calc'!A0");
    expect(csv.content).toContain("\"'+" + 'gpt-formula,v1"');

    ledger.close();
  });
});
