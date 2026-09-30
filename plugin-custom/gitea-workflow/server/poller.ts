import type { ProjectGiteaResolver } from "./resolver.js";
import type { GiteaClientPool } from "./client-pool.js";
import type { SettingsManager } from "./settings-manager.js";
import type { IssueRunIndexStore } from "./store.js";
import type { PaseoWorkflowActions, PaseoWorkspaceActions } from "@getpaseo/client";
import { resolveIssueWorkflowPreset } from "./preset-resolver.js";
import { isApprovalComment } from "./adapters/dual-approval-gate.js";
import { LIFECYCLE_LABELS } from "../shared/types.js";

export interface PaseoProjectItem {
  projectId: string;
  projectRootPath: string;
  projectDisplayName?: string;
  projectKind?: string;
}

export interface MultiProjectPollerOptions {
  settings: SettingsManager;
  resolver: ProjectGiteaResolver;
  clientPool: GiteaClientPool;
  indexStore: IssueRunIndexStore;
  getWorkflows: () => PaseoWorkflowActions | undefined;
  getProjects: () => Promise<PaseoProjectItem[]>;
  getWorkspaces?: () => PaseoWorkspaceActions | undefined;
  resolveWorkspace?: (project: PaseoProjectItem) => Promise<string | null>;
  intervalMs?: number;
}

export const GATE_PHASE_LABELS: Record<string, string> = {
  "gate-brainstorm": "💡 方案设计与选型确认 (Brainstorm)",
  "gate-spec": "📝 架构规范确认 (Spec)",
  "gate-plan": "📋 实施计划与测试方案确认 (Plan)",
  "gate-delivery": "🚀 最终代码交付与 PR 确认 (Delivery)",
  "design-approval": "💡 架构提案确认 (Design)",
  "spec-approval": "📝 详细规范确认 (Spec)",
  "plan-approval": "📋 实施计划确认 (Plan)",
};

export function deriveBranchSlug(issueNumber: number, title?: string): string {
  if (!title) return `agent/issue-${issueNumber}`;
  const clean = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30)
    .replace(/^-|-$/g, "");
  return `agent/issue-${issueNumber}${clean ? `-${clean}` : ""}`;
}

export class MultiProjectPoller {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(private readonly options: MultiProjectPollerOptions) {}

  start(): void {
    if (this.timer) return;
    const interval = Math.max(
      10_000,
      (this.options.settings.current.pollIntervalSeconds ?? 60) * 1000,
    );
    this.timer = setInterval(() => void this.poll(), interval);
    void this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async resolveWorkspaceId(project: PaseoProjectItem): Promise<string | null> {
    if (this.options.resolveWorkspace) {
      return this.options.resolveWorkspace(project);
    }

    const workspaces = this.options.getWorkspaces?.();
    if (!workspaces) return null;

    try {
      const list = await workspaces.list({ filter: { projectId: project.projectId } });
      const entries = list?.entries ?? [];
      const preferred =
        entries.find(
          (e) =>
            !e.archivingAt &&
            (e.workspaceKind === "local_checkout" || e.workspaceKind === "checkout"),
        ) ||
        entries.find((e) => !e.archivingAt) ||
        entries[0];

      if (preferred?.id) {
        return preferred.id;
      }
    } catch (err) {
      console.warn(
        `[MultiProjectPoller] Failed to list workspaces for project ${project.projectId}:`,
        err,
      );
    }

    if (project.projectRootPath) {
      try {
        const handle = await workspaces.open({ cwd: project.projectRootPath });
        if (handle?.id) {
          return handle.id;
        }
      } catch (err) {
        console.error(
          `[MultiProjectPoller] Failed to open workspace for project ${project.projectId}:`,
          err,
        );
      }
    }

    return null;
  }

  async poll(): Promise<void> {
    if (this.isRunning) return;
    if (!this.options.settings.current.enabled) return;

    const workflows = this.options.getWorkflows();
    if (!workflows) return;

    this.isRunning = true;
    try {
      const allProjects = await this.options.getProjects();
      const authorizedProjects = allProjects.filter(
        (p) => p.projectKind === "git" && this.options.settings.isProjectAuthorized(p.projectId),
      );

      for (const project of authorizedProjects) {
        try {
          const resolved = await this.options.resolver.resolveProject(project);
          if (!resolved || !resolved.token || resolved.authSource === "anonymous") {
            continue;
          }

          const workspaceId = await this.resolveWorkspaceId(project);
          if (!workspaceId) {
            console.warn(
              `[MultiProjectPoller] No active workspace found or opened for project ${project.projectId} (${project.projectDisplayName ?? project.projectRootPath}), skipping`,
            );
            continue;
          }

          const readyLabel = this.options.settings.getReadyLabel(project.projectId);
          const policy = this.options.settings.getWorkflowPolicy(project.projectId);

          const client = this.options.clientPool.getClient({
            giteaUrl: resolved.baseUrl,
            giteaToken: resolved.token,
            repoOwner: resolved.repoOwner,
            repoName: resolved.repoName,
            listenLabel: readyLabel,
          });

          // 1. Process active/waiting runs from indexStore
          const trackedEntries =
            (await this.options.indexStore.listEntries?.(project.projectId)) ?? [];
          for (const entry of trackedEntries) {
            try {
              const inspected = await workflows.runInspect?.({
                projectId: project.projectId,
                workspaceId,
                runId: entry.runId,
              });

              if (inspected?.run?.status === "waiting_approval") {
                const approvalsRes = await workflows
                  .approvalList?.({
                    projectId: project.projectId,
                    workspaceId,
                    runId: entry.runId,
                  })
                  .catch(() => null);
                const pending = approvalsRes?.approvals?.find((a: any) => a.status === "pending");
                if (pending) {
                  await client
                    .addIssueLabel(entry.issueNumber, LIFECYCLE_LABELS.WAITING_APPROVAL)
                    .catch(() => {});

                  const comments = await client
                    .listIssueComments(entry.issueNumber)
                    .catch(() => []);
                  const friendlyPhase =
                    GATE_PHASE_LABELS[pending.stepId] || `阶段确认（${pending.stepId}）`;
                  const stepPromptTitle = `### 🛑 Paseo 门禁：等待 ${friendlyPhase}`;
                  let promptComment = comments.find(
                    (c) => c.body.includes(stepPromptTitle) || c.body.includes(pending.stepId),
                  );

                  if (!promptComment) {
                    const stepAttempts = (inspected?.run as any)?.stepAttempts ?? [];
                    let proposalSummary = "";
                    for (let i = stepAttempts.length - 1; i >= 0; i--) {
                      const outputs = stepAttempts[i]?.declaredOutputs;
                      if (
                        outputs &&
                        typeof outputs.summary === "string" &&
                        outputs.summary.trim()
                      ) {
                        proposalSummary = outputs.summary.trim();
                        break;
                      } else if (
                        outputs &&
                        typeof outputs.outcome === "string" &&
                        outputs.outcome.trim() &&
                        outputs.outcome !== "completed"
                      ) {
                        proposalSummary = outputs.outcome.trim();
                        break;
                      }
                    }

                    const promptBody = [
                      stepPromptTitle,
                      "",
                      proposalSummary ||
                        pending.policyReason ||
                        "当前阶段需要人工确认后方可继续执行。",
                      "",
                      "您可以通过以下方式推进或调整：",
                      "1. **直接回复批准**：回复 `/approve`、`同意` 或选项编号（如 `A` / `方案A`）；",
                      "2. **在 Paseo 中确认**：在移动端或 Web 控制台点击通过；",
                      "3. **提出调整意见**：直接在评论中写下反馈。",
                    ].join("\n");
                    await client.createIssueComment(entry.issueNumber, promptBody).catch(() => {});
                  }

                  const baselineId = promptComment ? promptComment.id : 0;

                  // Check for approval comment strictly newer than the gate prompt comment ID
                  const approvalComment = comments.find((c) => {
                    const isNewer =
                      baselineId > 0
                        ? c.id > baselineId
                        : new Date(c.created_at).getTime() >= new Date(pending.createdAt).getTime();
                    return isNewer && isApprovalComment(c.body);
                  });

                  if (approvalComment) {
                    await workflows.approvalApprove?.({
                      projectId: project.projectId,
                      workspaceId,
                      runId: entry.runId,
                      approvalId: pending.approvalId,
                    });
                    await client
                      .removeIssueLabel(entry.issueNumber, LIFECYCLE_LABELS.WAITING_APPROVAL)
                      .catch(() => {});
                    await client
                      .createIssueComment(
                        entry.issueNumber,
                        "✅ **Paseo Agent** 已捕获来自 Issue 评论的确认指令，门禁通过，工作流继续进入下一阶段。",
                      )
                      .catch(() => {});
                  }
                }
              } else if (
                inspected?.run?.status === "succeeded" ||
                inspected?.run?.status === "failed" ||
                inspected?.run?.status === "cancelled"
              ) {
                await this.options.indexStore.removeRun(
                  project.projectId,
                  resolved.repoOwner,
                  resolved.repoName,
                  entry.issueNumber,
                );
                if (
                  inspected.run.status === "succeeded" ||
                  (inspected.run.status as string) === "completed"
                ) {
                  await client
                    .removeIssueLabel(entry.issueNumber, LIFECYCLE_LABELS.IN_PROGRESS)
                    .catch(() => {});
                  await client
                    .removeIssueLabel(entry.issueNumber, LIFECYCLE_LABELS.WAITING_APPROVAL)
                    .catch(() => {});
                  await client
                    .addIssueLabel(entry.issueNumber, LIFECYCLE_LABELS.DELIVERED)
                    .catch(() => {});
                } else if (inspected.run.status === "failed") {
                  await client
                    .removeIssueLabel(entry.issueNumber, LIFECYCLE_LABELS.IN_PROGRESS)
                    .catch(() => {});
                  await client
                    .removeIssueLabel(entry.issueNumber, LIFECYCLE_LABELS.WAITING_APPROVAL)
                    .catch(() => {});
                  await client
                    .addIssueLabel(entry.issueNumber, LIFECYCLE_LABELS.FAILED)
                    .catch(() => {});
                }
              }
            } catch {
              // ignore inspection error
            }
          }

          // 2. Discover and dispatch newly triggered ready issues
          const readyIssues = await client.fetchReadyIssues();
          for (const issue of readyIssues) {
            const target = resolveIssueWorkflowPreset(issue.labels ?? []);
            const presetId = target
              ? target.presetId
              : policy === "issue_preapproved"
                ? "gitea.issue-to-pr.preapproved"
                : policy === "unattended"
                  ? "gitea.issue-to-pr.unattended"
                  : "gitea.issue-to-pr";
            const mode = target?.mode ?? (policy === "unattended" ? "auto" : "plan");
            const conflictWarning = target?.conflictWarning ?? false;

            const existingRunId = await this.options.indexStore.getRunIdForIssue(
              project.projectId,
              resolved.repoOwner,
              resolved.repoName,
              issue.number,
            );
            if (existingRunId) {
              try {
                const inspected = await workflows.runInspect?.({
                  projectId: project.projectId,
                  workspaceId,
                  runId: existingRunId,
                });

                const isSameWorkflow =
                  !inspected?.run?.workflowId || inspected.run.workflowId === presetId;
                const isActivelyRunning =
                  inspected?.run?.status === "running" ||
                  inspected?.run?.status === "waiting_approval";
                const isRecentlyStarted =
                  !inspected?.run?.createdAt ||
                  Date.now() - new Date(inspected.run.createdAt).getTime() < 60_000;

                if (isSameWorkflow && isActivelyRunning && isRecentlyStarted) {
                  continue;
                }

                // If user explicitly re-tagged while old run is running/waiting, cancel old run
                if (
                  inspected?.run &&
                  (inspected.run.status === "running" ||
                    inspected.run.status === "waiting_approval")
                ) {
                  try {
                    await workflows.runCancel?.({
                      projectId: project.projectId,
                      workspaceId,
                      runId: existingRunId,
                      reason: `Superseded by new workflow run (${presetId})`,
                    });
                  } catch {
                    // cancel attempt ignored
                  }
                }
              } catch {
                // inspect failed, proceed to clean and retry
              }
              await this.options.indexStore.removeRun(
                project.projectId,
                resolved.repoOwner,
                resolved.repoName,
                issue.number,
              );
            }

            const createRes = await workflows.runCreate({
              projectId: project.projectId,
              workspaceId,
              workflowId: presetId,
              input: {
                baseUrl: resolved.baseUrl,
                token: resolved.token,
                repoOwner: resolved.repoOwner,
                repoName: resolved.repoName,
                issueNumber: issue.number,
                issueTitle: issue.title,
                issueBody: issue.body,
                branch: deriveBranchSlug(issue.number, issue.title),
                listenLabel: readyLabel,
                policy,
                mode,
                conflictWarning,
              },
            });

            if (createRes.runId) {
              await this.options.indexStore.recordRun({
                projectId: project.projectId,
                repoOwner: resolved.repoOwner,
                repoName: resolved.repoName,
                issueNumber: issue.number,
                runId: createRes.runId,
                baseUrl: resolved.baseUrl,
                token: resolved.token,
              });
            } else if (createRes.error) {
              console.error(
                `[MultiProjectPoller] Workflow run creation failed for ${resolved.repoOwner}/${resolved.repoName}#${issue.number}: ${createRes.error}`,
              );
            }
          }
        } catch (err) {
          console.error(`[MultiProjectPoller] Error polling project ${project.projectId}:`, err);
        }
      }
    } catch (fatalErr) {
      console.error("[MultiProjectPoller Fatal Error]", fatalErr);
    } finally {
      this.isRunning = false;
    }
  }
}
