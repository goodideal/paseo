import { mkdirSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQualityGateAdapter, parseReviewVerdict } from "../server/adapters/quality-gate.js";
import {
  createDeliverPrAdapter,
  defaultPushBranch,
  formatPullRequestBody,
} from "../server/adapters/deliver-pr.js";

describe("gitea.quality_gate & parseReviewVerdict", () => {
  it("parses review verdicts accurately from markdown output (case-sensitive, fail-closed, handoff-stripped)", () => {
    expect(parseReviewVerdict("All checks look great.\n\n**PASS**")).toBe("PASS");
    expect(
      parseReviewVerdict("If zero issues, return PASS. Final verdict: **CHANGES_REQUESTED**"),
    ).toBe("CHANGES_REQUESTED");
    expect(
      parseReviewVerdict("Previously CHANGES_REQUESTED, now fixed.\n\nVerdict: **PASS**"),
    ).toBe("PASS");
    expect(parseReviewVerdict("[Critical] SQL injection in query builder")).toBe(
      "CHANGES_REQUESTED",
    );
    expect(parseReviewVerdict("[Warning] Minor naming nitpick\n\n**PASS**")).toBe("PASS");

    // Required hardening test cases:
    expect(
      parseReviewVerdict(
        "[Critical] Broken auth. **CHANGES_REQUESTED** — fix validation so tests pass.",
      ),
    ).toBe("CHANGES_REQUESTED");
    expect(parseReviewVerdict("No CHANGES_REQUESTED. Final Verdict: **PASS**")).toBe("PASS");
    expect(parseReviewVerdict("Verdict: **PASS** (zero `[Critical]` blockers found)")).toBe("PASS");
    expect(parseReviewVerdict("Verdict: **PASS** (0 [Critical] issues)")).toBe("PASS");
    expect(parseReviewVerdict("")).toBe("CHANGES_REQUESTED");
    expect(parseReviewVerdict("   ")).toBe("CHANGES_REQUESTED");
    expect(parseReviewVerdict("Review commentary with no explicit verdict token")).toBe(
      "CHANGES_REQUESTED",
    );
    expect(
      parseReviewVerdict(
        [
          "[Critical] Missing auth guard on admin endpoint.",
          "",
          "**CHANGES_REQUESTED**",
          "",
          "```paseo-workflow-handoff",
          "{",
          '  "version": 1,',
          '  "phase": "independent_review",',
          '  "summary": "Independent review completed. Verdict: PASS."',
          "}",
          "```",
        ].join("\n"),
      ),
    ).toBe("CHANGES_REQUESTED");
  });

  it("passes on 1st cycle with 0 repairs when workspace check and review pass", async () => {
    const runWorkspaceCheck = vi.fn().mockResolvedValue({
      passed: true,
      command: "npm run typecheck",
      report: "0 errors",
    });
    const mockSettings = {
      current: { maxAutomaticRepairCycles: 2 },
      getAgentProvider: vi.fn().mockReturnValue("antigravity"),
      getAgentModel: vi.fn().mockReturnValue("gemini-4-argon"),
      getAgentChangeMode: vi.fn().mockReturnValue("auto"),
      getAgentReviewPrompt: vi.fn().mockReturnValue("Review #{{issueNumber}}"),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 101,
        issueTitle: "Add rate limiter",
        repoOwner: "org",
        repoName: "api",
      }),
    };
    const mockReviewAgent = {
      id: "agent-review-101",
      waitForFinish: vi.fn().mockResolvedValue({
        status: "idle",
        lastMessage: "## Standards\nClean.\n## Spec\nMatches issue.\n\n**PASS**",
      }),
    };
    const mockPaseo = {
      workspaces: { list: vi.fn().mockResolvedValue({ entries: [] }) },
      agents: {
        create: vi.fn().mockResolvedValue(mockReviewAgent),
        ref: vi.fn(),
      },
    };

    const adapter = createQualityGateAdapter(mockSettings as any, mockIndexStore as any, {
      runWorkspaceCheck,
    });
    const res = await adapter.execute({}, {
      paseo: mockPaseo as any,
      run: {
        runId: "run-101",
        projectId: "proj-1",
        workspaceRoot: "/tmp/wt-101",
        stepOutputs: {
          "implement-agent": {
            agentId: "agent-coding-101",
            summary:
              "## Summary\nImplemented token bucket.\n## Evidence\nUnit tests pass.\n## Merge Danger\nLow.",
          },
        },
      },
    } as any);

    expect(res).toMatchObject({
      agentId: "agent-review-101",
      status: "succeeded",
      passed: true,
      verdict: "PASS",
      repairCyclesUsed: 0,
      maxRepairCycles: 2,
      verifyPassed: true,
      verifyCommand: "npm run typecheck",
    });
    expect(mockPaseo.agents.ref).not.toHaveBeenCalled();
  });

  it("triggers same-session auto-repair via paseo.agents.ref(id).run when review requests changes and succeeds on cycle 1", async () => {
    const runWorkspaceCheck = vi
      .fn()
      .mockResolvedValueOnce({
        passed: false,
        command: "npm run typecheck",
        report: "src/limiter.ts(12,5): error TS2322",
      })
      .mockResolvedValueOnce({
        passed: true,
        command: "npm run typecheck",
        report: "0 errors",
      });

    const mockSettings = {
      current: { maxAutomaticRepairCycles: 2 },
      getAgentProvider: vi.fn().mockReturnValue("codex"),
      getAgentModel: vi.fn().mockReturnValue("flash"),
      getAgentChangeMode: vi.fn().mockReturnValue("full-access"),
      getAgentReviewPrompt: vi.fn().mockReturnValue("Review #{{issueNumber}}"),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 102,
        issueTitle: "Fix type mismatch in limiter",
        repoOwner: "org",
        repoName: "api",
      }),
    };

    let reviewCount = 0;
    const mockCodingRef = {
      run: vi.fn().mockResolvedValue({
        status: "idle",
        lastMessage:
          "## Summary\nFixed TS2322 and null check.\n\n## Evidence\ntypecheck + unit test green.\n\n## Merge Danger\nLow.",
      }),
    };
    const mockPaseo = {
      workspaces: { list: vi.fn().mockResolvedValue({ entries: [] }) },
      agents: {
        create: vi.fn().mockImplementation(async () => {
          reviewCount += 1;
          return {
            id: `agent-review-cycle-${reviewCount}`,
            waitForFinish: vi.fn().mockResolvedValue({
              status: "idle",
              lastMessage:
                reviewCount === 1
                  ? "[Critical] Missing null check in limiter.ts.\n\n**CHANGES_REQUESTED**"
                  : "All blockers resolved.\n\n**PASS**",
            }),
          };
        }),
        ref: vi.fn().mockReturnValue(mockCodingRef),
      },
    };

    const adapter = createQualityGateAdapter(mockSettings as any, mockIndexStore as any, {
      runWorkspaceCheck,
    });
    const res = await adapter.execute({}, {
      paseo: mockPaseo as any,
      run: {
        runId: "run-102",
        projectId: "proj-1",
        workspaceRoot: "/tmp/wt-102",
        runInput: { branch: "agent/issue-102-fix-limiter" },
        stepOutputs: {
          "implement-agent": {
            agentId: "agent-coding-102",
            summary: "Initial implementation",
          },
        },
      },
    } as any);

    expect(mockPaseo.agents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          modeId: "auto-review",
        }),
      }),
    );
    expect(mockPaseo.agents.ref).toHaveBeenCalledWith("agent-coding-102");
    expect(mockCodingRef.run).toHaveBeenCalledTimes(1);
    expect(mockCodingRef.run.mock.calls[0][0]).toContain("error TS2322");
    expect(mockCodingRef.run.mock.calls[0][0]).toContain("[Critical] Missing null check");

    expect(res).toMatchObject({
      agentId: "agent-review-cycle-2",
      status: "succeeded",
      passed: true,
      verdict: "PASS",
      repairCyclesUsed: 1,
      maxRepairCycles: 2,
      verifyPassed: true,
      latestImplementationSummary: expect.stringContaining("Fixed TS2322 and null check."),
    });
  });

  it("enforces read-only mode (plan for claude) on reviewer, detaches non-idle existingCodingRef before spawning fallback repair agent, and fails closed on empty review output", async () => {
    const runWorkspaceCheck = vi
      .fn()
      .mockResolvedValueOnce({
        passed: true,
        command: "npm run typecheck",
        report: "0 errors",
      })
      .mockResolvedValueOnce({
        passed: false,
        command: "npm run typecheck",
        report: "src/app.ts: error TS1005",
      });

    const mockSettings = {
      current: { maxAutomaticRepairCycles: 1 },
      getHarnessMode: vi.fn().mockReturnValue("disabled"),
      getAgentProvider: vi.fn().mockReturnValue("claude"),
      getAgentModel: vi.fn().mockReturnValue("sonnet"),
      getAgentChangeMode: vi.fn().mockReturnValue("bypassPermissions"),
      getAgentReviewPrompt: vi.fn().mockReturnValue("Review #{{issueNumber}}"),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 105,
        issueTitle: "Harden review session isolation",
        repoOwner: "org",
        repoName: "api",
      }),
    };

    const mockExistingCodingRef = {
      run: vi.fn().mockResolvedValue({
        status: "error",
        error: "Session disconnected",
      }),
      detach: vi.fn().mockResolvedValue(undefined),
    };

    const createdAgents: Array<{ title: string; config: any }> = [];
    let createCallIndex = 0;
    const mockPaseo = {
      workspaces: { list: vi.fn().mockResolvedValue({ entries: [] }) },
      agents: {
        create: vi.fn().mockImplementation(async (opts: any) => {
          createCallIndex += 1;
          createdAgents.push({ title: opts.title, config: opts.config });
          if (createCallIndex === 1) {
            // Cycle 0 review agent returns empty output -> fail-closed CHANGES_REQUESTED
            return {
              id: "agent-review-empty",
              waitForFinish: vi.fn().mockResolvedValue({
                status: "idle",
                lastMessage: "   ",
              }),
            };
          }
          if (createCallIndex === 2) {
            // Fallback repair agent after existingCodingRef non-idle failure
            return {
              id: "agent-repair-fallback",
              waitForFinish: vi.fn().mockResolvedValue({
                status: "idle",
                lastMessage: "## Summary\nRepaired via fallback coding agent.",
              }),
            };
          }
          // Cycle 1 review agent returns PASS while verifyRes fails
          return {
            id: "agent-review-pass",
            waitForFinish: vi.fn().mockResolvedValue({
              status: "idle",
              lastMessage: "Code looks good.\n\nVerdict: **PASS**",
            }),
          };
        }),
        ref: vi.fn().mockReturnValue(mockExistingCodingRef),
      },
    };

    const adapter = createQualityGateAdapter(mockSettings as any, mockIndexStore as any, {
      runWorkspaceCheck,
    });
    const res = await adapter.execute({}, {
      paseo: mockPaseo as any,
      run: {
        runId: "run-105",
        projectId: "proj-1",
        workspaceRoot: "/tmp/wt-105",
        stepOutputs: {
          "implement-agent": {
            agentId: "agent-coding-105",
            summary: "Initial work",
          },
        },
      },
    } as any);

    // 1. Review agents used read-only "plan" mode even though project changeMode is "bypassPermissions"
    expect(createdAgents[0]?.config.modeId).toBe("plan");
    expect(createdAgents[2]?.config.modeId).toBe("plan");
    // 2. Fallback repair agent used normalized write mode "bypassPermissions"
    expect(createdAgents[1]?.config.modeId).toBe("bypassPermissions");
    // 3. Non-idle existingCodingRef was detached before fallback repair agent was spawned
    expect(mockExistingCodingRef.detach).toHaveBeenCalledTimes(1);
    // 4. Preserves actual lastVerdict ("PASS") even when verifyPassed is false and passed is false
    expect(res).toMatchObject({
      passed: false,
      verdict: "PASS",
      verifyPassed: false,
      repairCyclesUsed: 1,
    });
  });

  it("returns passed: false without throwing when maxAutomaticRepairCycles is exhausted", async () => {
    const runWorkspaceCheck = vi.fn().mockResolvedValue({
      passed: false,
      command: "npx --no-install tsc --noEmit",
      report: "Still failing typecheck",
    });

    const mockSettings = {
      current: { maxAutomaticRepairCycles: 1 },
      getAgentProvider: vi.fn().mockReturnValue("claude"),
      getAgentChangeMode: vi.fn().mockReturnValue("auto"),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 103,
        issueTitle: "Complex migration",
        repoOwner: "org",
        repoName: "api",
      }),
    };
    const mockCodingRef = {
      run: vi.fn().mockResolvedValue({
        status: "idle",
        lastMessage: "Attempted repair",
      }),
    };
    const mockPaseo = {
      workspaces: { list: vi.fn().mockResolvedValue({ entries: [] }) },
      agents: {
        create: vi.fn().mockResolvedValue({
          id: "agent-review-fail",
          waitForFinish: vi.fn().mockResolvedValue({
            status: "idle",
            lastMessage: "[Critical] Unresolved schema migration error.\n\n**CHANGES_REQUESTED**",
          }),
        }),
        ref: vi.fn().mockReturnValue(mockCodingRef),
      },
    };

    const adapter = createQualityGateAdapter(mockSettings as any, mockIndexStore as any, {
      runWorkspaceCheck,
    });
    const res = await adapter.execute({}, {
      paseo: mockPaseo as any,
      run: {
        runId: "run-103",
        projectId: "proj-1",
        workspaceRoot: "/tmp/wt-103",
        stepOutputs: {
          "implement-agent": {
            agentId: "agent-coding-103",
            summary: "Initial attempt",
          },
        },
      },
    } as any);

    expect(mockCodingRef.run).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({
      status: "succeeded",
      passed: false,
      verdict: "CHANGES_REQUESTED",
      repairCyclesUsed: 1,
      maxRepairCycles: 1,
      verifyPassed: false,
    });
  });
});

describe("gitea.deliver_pr & formatPullRequestBody", () => {
  beforeEach(() => {
    mkdirSync("/tmp/wt-88", { recursive: true });
    mkdirSync("/tmp/wt-91", { recursive: true });
  });

  it("formats PR body preserving agent pr skill sections and appending Automated Quality Gate block", () => {
    const body = formatPullRequestBody({
      issueNumber: 55,
      issueTitle: "Support batch webhook dispatch",
      implementationSummary: [
        "## Summary",
        "Added batched webhook dispatcher with retry backoff.",
        "",
        "## Evidence",
        "- `npx vitest run tests/webhook.test.ts` (4 passed)",
        "",
        "## Merge Danger",
        "Low — isolated to webhook dispatcher.",
      ].join("\n"),
      qualityGate: {
        passed: true,
        verdict: "PASS",
        repairCyclesUsed: 0,
        maxRepairCycles: 2,
        verifyPassed: true,
        verifyCommand: "npm run typecheck",
      },
    });

    expect(body).toContain("Closes #55");
    expect(body).toContain("## Summary");
    expect(body).toContain("## Evidence");
    expect(body).toContain("## Merge Danger");
    expect(body).toContain("### Automated Quality Gate");
  });

  it("rewrites Closes/Fixes/Resolves #55 in agent summary to Refs #55 when wip is true", () => {
    const wipBody = formatPullRequestBody({
      issueNumber: 55,
      issueTitle: "WIP feature",
      implementationSummary: [
        "## Summary",
        "Closes #55 and Fixes #56.",
        "",
        "## Evidence",
        "Pending fix.",
        "",
        "## Merge Danger",
        "High.",
      ].join("\n"),
      qualityGate: {
        passed: false,
        verdict: "CHANGES_REQUESTED",
        repairCyclesUsed: 2,
        maxRepairCycles: 2,
        verifyPassed: false,
        verifyCommand: "npm run typecheck",
        verifyReport: "Failed with token=secret12345678",
      },
    });

    expect(wipBody).not.toMatch(/\b(?:Closes|Fixes|Resolves)\s+#55\b/i);
    expect(wipBody).toContain("Refs #55");
    expect(wipBody).toContain("Refs #56");
    expect(wipBody).toContain("token=[redacted]");
  });

  it("pushes branch, creates normal PR via GiteaClient, and marks issue reviewed when quality gate passed", async () => {
    const pushBranch = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      createPullRequest: vi.fn().mockResolvedValue({
        url: "https://gitea.example.com/org/repo/pulls/12",
      }),
      markReviewed: vi.fn().mockResolvedValue(undefined),
      createIssueComment: vi.fn(),
    };
    const mockPool = {
      getClient: vi.fn().mockReturnValue(mockClient),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 88,
        issueTitle: "feat: support token rotation",
        repoOwner: "org",
        repoName: "repo",
        baseUrl: "https://gitea.example.com",
        token: "sec-tok",
      }),
    };
    const mockSettings = {
      current: { inProgressLabel: "agent-in-progress", reviewedLabel: "agent-reviewed" },
      getBaseBranch: vi.fn().mockReturnValue("develop"),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
    };

    const adapter = createDeliverPrAdapter(
      mockPool as any,
      mockIndexStore as any,
      mockSettings as any,
      { pushBranch },
    );

    const res = await adapter.execute({}, {
      paseo: {} as any,
      run: {
        runId: "run-88",
        projectId: "proj-1",
        workspaceRoot: "/tmp/wt-88",
        runInput: { branch: "agent/issue-88-token-rotation" },
        stepOutputs: {
          "worktree-create": {
            worktreePath: "/tmp/wt-88",
            branch: "agent/issue-88-token-rotation",
          },
          "implement-agent": {
            summary: "Implemented token rotation.",
          },
          "independent-review": {
            passed: true,
            verdict: "PASS",
            repairCyclesUsed: 0,
            maxRepairCycles: 2,
            verifyPassed: true,
            verifyCommand: "npm run typecheck",
            latestImplementationSummary:
              "## Summary\nImplemented token rotation.\n\n## Evidence\nAll tests green.\n\n## Merge Danger\nLow.",
          },
        },
      },
    } as any);

    expect(pushBranch).toHaveBeenCalledWith("/tmp/wt-88", "agent/issue-88-token-rotation");
    expect(mockClient.createPullRequest).toHaveBeenCalledWith({
      title: "feat: support token rotation (#88)",
      body: expect.stringContaining("Closes #88"),
      headBranch: "agent/issue-88-token-rotation",
      baseBranch: "develop",
    });
    expect(mockClient.markReviewed).toHaveBeenCalledWith(88, {
      prUrl: "https://gitea.example.com/org/repo/pulls/12",
    });
    expect(res).toEqual({
      url: "https://gitea.example.com/org/repo/pulls/12",
      headBranch: "agent/issue-88-token-rotation",
      baseBranch: "develop",
      title: "feat: support token rotation (#88)",
      wip: false,
      summary: "PR created: https://gitea.example.com/org/repo/pulls/12",
    });
  });

  it("opens [WIP] PR with blocker diagnostics and posts issue comment when quality gate passed is false", async () => {
    const pushBranch = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      createPullRequest: vi.fn().mockResolvedValue({
        url: "https://gitea.example.com/org/repo/pulls/19",
      }),
      markReviewed: vi.fn(),
      createIssueComment: vi.fn().mockResolvedValue({ id: 901 }),
      removeLabelsByName: vi.fn().mockResolvedValue(undefined),
      addLabelsByName: vi.fn().mockResolvedValue(undefined),
    };
    const mockPool = {
      getClient: vi.fn().mockReturnValue(mockClient),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 91,
        issueTitle: "Refactor payment webhook",
        repoOwner: "org",
        repoName: "repo",
        baseUrl: "https://gitea.example.com",
        token: "sec-tok",
      }),
    };

    const adapter = createDeliverPrAdapter(mockPool as any, mockIndexStore as any, undefined, {
      pushBranch,
      getDefaultBaseBranch: async () => "main",
    });

    const res = await adapter.execute({}, {
      paseo: {} as any,
      run: {
        runId: "run-91",
        projectId: "proj-1",
        workspaceRoot: "/tmp/wt-91",
        runInput: { branch: "agent/issue-91-payment" },
        stepOutputs: {
          "independent-review": {
            passed: false,
            verdict: "CHANGES_REQUESTED",
            repairCyclesUsed: 2,
            maxRepairCycles: 2,
            verifyPassed: false,
            verifyCommand: "npm run typecheck",
            verifyReport: "error TS2345 in webhook.ts",
            summary: "[Critical] Missing signature check in webhook handler",
          },
        },
      },
    } as any);

    expect(mockClient.createPullRequest).toHaveBeenCalledWith({
      title: "[WIP] Refactor payment webhook (#91)",
      body: expect.stringContaining("Refs #91"),
      headBranch: "agent/issue-91-payment",
      baseBranch: "main",
    });
    const prBody = mockClient.createPullRequest.mock.calls[0][0].body;
    expect(prBody).toContain("## Merge Danger");
    expect(prBody).toContain("error TS2345 in webhook.ts");
    expect(prBody).toContain("[Critical] Missing signature check in webhook handler");

    expect(mockClient.markReviewed).not.toHaveBeenCalled();
    expect(mockClient.createIssueComment).toHaveBeenCalledWith(
      91,
      expect.stringContaining("[WIP] Pull Request"),
    );
    expect(res.wip).toBe(true);
    expect(res.title).toBe("[WIP] Refactor payment webhook (#91)");
  });

  it("rejects headBranch starting with '-' or equal to baseBranch, never falls back to process.cwd(), and passes '--' to git push", async () => {
    const mockPool = { getClient: vi.fn() };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 95,
        issueTitle: "Security hardening",
        repoOwner: "org",
        repoName: "repo",
        baseUrl: "https://gitea.example.com",
        token: "sec-tok",
      }),
    };

    const adapter = createDeliverPrAdapter(mockPool as any, mockIndexStore as any, undefined, {
      pushBranch: vi.fn(),
      getDefaultBaseBranch: async () => "main",
    });

    // 1. Throws when workspace cwd cannot be resolved (never falls back to process.cwd())
    await expect(
      adapter.execute({}, {
        paseo: {} as any,
        run: {
          runId: "run-95",
          projectId: "proj-1",
          runInput: { branch: "agent/issue-95" },
        },
      } as any),
    ).rejects.toThrow(/Cannot resolve valid working directory/);

    // 2. Rejects headBranch starting with "-"
    await expect(
      adapter.execute({ headBranch: "--mirror" }, {
        paseo: {} as any,
        run: {
          runId: "run-95",
          projectId: "proj-1",
          workspaceRoot: "/tmp/wt-88",
        },
      } as any),
    ).rejects.toThrow(/branch name must not start with "-"/);

    // 3. Rejects headBranch equal to baseBranch
    await expect(
      adapter.execute({ headBranch: "main", baseBranch: "main" }, {
        paseo: {} as any,
        run: {
          runId: "run-95",
          projectId: "proj-1",
          workspaceRoot: "/tmp/wt-88",
        },
      } as any),
    ).rejects.toThrow(/headBranch must not equal baseBranch/);

    // 4. defaultPushBranch uses "--" separator before branch argument
    const mockExec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    await defaultPushBranch("/tmp/wt-88", "agent/issue-95", mockExec);
    expect(mockExec).toHaveBeenCalledWith(
      "git",
      ["push", "-u", "origin", "--", "agent/issue-95"],
      expect.objectContaining({
        cwd: "/tmp/wt-88",
        timeout: 110_000,
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
  });
});
