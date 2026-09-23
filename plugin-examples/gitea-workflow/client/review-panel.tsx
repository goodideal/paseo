import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { approveTaskRpc, listTasksRpc, rejectTaskRpc } from "../shared/contracts.js";
import type { GiteaWorkflowTask, TestMatrixEvidence, ReviewSignOff } from "../shared/types.js";
import { ScreenshotGallery } from "./screenshot-gallery";
import { FeedbackDialog } from "./feedback-dialog";

interface TaskTabItemProps {
  task: GiteaWorkflowTask;
  isSelected: boolean;
  onSelect: (taskId: string) => void;
}

const TaskTabItem = React.memo(function TaskTabItem({
  task,
  isSelected,
  onSelect,
}: TaskTabItemProps) {
  const handlePress = useCallback(() => {
    onSelect(task.id);
  }, [onSelect, task.id]);

  let dotStyle = styles.statusDotDefault;
  if (task.state === "pending_human_review") dotStyle = styles.statusDotPending;
  else if (task.state === "done") dotStyle = styles.statusDotDone;
  else if (task.state === "failed") dotStyle = styles.statusDotFailed;
  else if (
    task.state === "coding" ||
    task.state === "static_reviewing" ||
    task.state === "sandbox_provisioning" ||
    task.state === "dynamic_reviewing" ||
    task.state === "shipping"
  )
    dotStyle = styles.statusDotWorking;

  return (
    <Pressable style={isSelected ? styles.taskTabActive : styles.taskTab} onPress={handlePress}>
      <View style={dotStyle} />
      <Text style={isSelected ? styles.taskTabTextActive : styles.taskTabText} numberOfLines={1}>
        #{task.issueNumber} {task.issueTitle}
      </Text>
    </Pressable>
  );
});

interface ProjectFilterPillProps {
  id: string;
  name: string;
  count: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const ProjectFilterPill = React.memo(function ProjectFilterPill({
  id,
  name,
  count,
  isSelected,
  onSelect,
}: ProjectFilterPillProps) {
  const handlePress = useCallback(() => {
    onSelect(id);
  }, [onSelect, id]);

  return (
    <Pressable
      style={isSelected ? styles.projectPillActive : styles.projectPill}
      onPress={handlePress}
    >
      <Text style={isSelected ? styles.projectPillTextActive : styles.projectPillText}>
        {name} ({count})
      </Text>
    </Pressable>
  );
});

function PreviewUrlBar({ url }: { url: string }) {
  const handleOpen = useCallback(() => {
    Linking.openURL(url).catch((err) => {
      console.warn("Failed to open preview URL:", err);
    });
  }, [url]);

  return (
    <View style={styles.previewBar}>
      <View style={styles.previewLeft}>
        <View style={styles.livePulseDot} />
        <View style={styles.previewInfo}>
          <Text style={styles.previewLabel}>LIVE SANDBOX APP</Text>
          <Text style={styles.previewUrlText} numberOfLines={1}>
            {url}
          </Text>
        </View>
      </View>
      <Pressable style={styles.previewOpenBtn} onPress={handleOpen}>
        <Text style={styles.previewOpenBtnText}>Open App ↗</Text>
      </Pressable>
    </View>
  );
}

function DualReviewBadgeRow({ signOff }: { signOff?: ReviewSignOff | null }) {
  if (!signOff?.staticReview && !signOff?.dynamicReview) return null;

  return (
    <View style={styles.dualReviewRow}>
      {signOff.staticReview && (
        <View style={styles.reviewPill}>
          <Text style={styles.reviewPillIcon}>{signOff.staticReview.passed ? "🟢" : "🔴"}</Text>
          <View style={styles.reviewPillContent}>
            <Text style={styles.reviewPillTitle}>Stage 1: Static Code Review</Text>
            <Text style={styles.reviewPillSub} numberOfLines={1}>
              {signOff.staticReview.model || "codex/gpt-5.4"} ·{" "}
              {signOff.staticReview.summary || "Audited"}
            </Text>
          </View>
        </View>
      )}

      {signOff.dynamicReview && (
        <View style={styles.reviewPill}>
          <Text style={styles.reviewPillIcon}>{signOff.dynamicReview.passed ? "🟢" : "🔴"}</Text>
          <View style={styles.reviewPillContent}>
            <Text style={styles.reviewPillTitle}>Stage 2: Sandbox Dynamic Review</Text>
            <Text style={styles.reviewPillSub} numberOfLines={1}>
              {signOff.dynamicReview.screenshotsCount
                ? `${signOff.dynamicReview.screenshotsCount} Viewports Verified`
                : "Runtime Test Matrix Passed"}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

function TestMatrixView({ matrix }: { matrix: TestMatrixEvidence }) {
  return (
    <View style={styles.matrixContainer}>
      <View style={styles.matrixHeader}>
        <Text style={styles.matrixTitle}>Logic Verification Matrix</Text>
        <Text style={styles.matrixCommand} numberOfLines={1}>
          {matrix.command}
        </Text>
      </View>
      <View style={styles.matrixStatsRow}>
        <Text style={styles.matrixStatPass}>✓ {matrix.totalPassed} Passed</Text>
        {matrix.totalFailed > 0 && (
          <Text style={styles.matrixStatFail}>✕ {matrix.totalFailed} Failed</Text>
        )}
        <Text style={styles.matrixStatDuration}>{matrix.durationMs}ms</Text>
      </View>
      <View style={styles.matrixTable}>
        {matrix.cases.map((c) => (
          <View key={`${c.name}-${c.status}`} style={styles.matrixRow}>
            <View style={styles.matrixRowHeader}>
              <Text style={c.status === "PASS" ? styles.casePassBadge : styles.caseFailBadge}>
                {c.status}
              </Text>
              <Text style={styles.caseName}>{c.name}</Text>
            </View>
            <View style={styles.caseIoGrid}>
              <View style={styles.caseIoCol}>
                <Text style={styles.caseIoLabel}>Input</Text>
                <Text style={styles.caseIoVal}>{c.input}</Text>
              </View>
              <View style={styles.caseIoCol}>
                <Text style={styles.caseIoLabel}>Expected</Text>
                <Text style={styles.caseIoVal}>{c.expected}</Text>
              </View>
              <View style={styles.caseIoCol}>
                <Text style={styles.caseIoLabel}>Actual</Text>
                <Text style={styles.caseIoVal}>{c.actual}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

interface TaskCardProps {
  task: GiteaWorkflowTask;
  isSubmitting: boolean;
  statusMsg: string | null;
  onApprove: () => void;
  onOpenFeedback: () => void;
}

function TaskCard({ task, isSubmitting, statusMsg, onApprove, onOpenFeedback }: TaskCardProps) {
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const toggleDesc = useCallback(() => setIsDescExpanded((p) => !p), []);

  let badgeStyle = styles.badgeQueued;
  if (task.state === "pending_human_review") badgeStyle = styles.badgeReview;
  else if (task.state === "done") badgeStyle = styles.badgeDone;
  else if (task.state === "failed") badgeStyle = styles.badgeFailed;

  const approveBtnStyle = isSubmitting ? styles.btnDisabled : styles.btnApprove;
  const rejectBtnStyle = isSubmitting ? styles.btnDisabled : styles.btnReject;

  return (
    <View style={styles.taskCard}>
      <View style={styles.metaRow}>
        <View style={badgeStyle}>
          <Text style={styles.badgeText}>{task.state.replace(/_/g, " ")}</Text>
        </View>
        <View style={styles.repoPill}>
          <Text style={styles.repoLabel}>
            {task.repoOwner}/{task.repoName}
          </Text>
        </View>
        {task.prUrl ? (
          <View style={styles.prBadge}>
            <Text style={styles.prBadgeText}>PR OPENED</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.issueTitle}>
        #{task.issueNumber} {task.issueTitle}
      </Text>
      <View style={styles.branchRow}>
        <Text style={styles.branchIcon}>⌥</Text>
        <Text style={styles.branchLabel}>{task.branchName}</Text>
      </View>

      {task.previewUrl && <PreviewUrlBar url={task.previewUrl} />}

      <DualReviewBadgeRow signOff={task.reviewSignOff} />

      {task.issueBody ? (
        <View style={styles.issueBodyContainer}>
          <Text style={styles.issueBodyText} numberOfLines={isDescExpanded ? undefined : 2}>
            {task.issueBody}
          </Text>
          <Pressable onPress={toggleDesc} style={styles.expandToggle}>
            <Text style={styles.expandToggleText}>
              {isDescExpanded ? "▴ Collapse Details" : "▾ View Full Issue"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {task.screenshots && task.screenshots.length > 0 && (
        <ScreenshotGallery screenshots={task.screenshots} />
      )}

      {task.testMatrix && <TestMatrixView matrix={task.testMatrix} />}

      {task.diffSummary && (
        <View style={styles.diffCard}>
          <Text style={styles.diffTitle}>Verified Code Changes</Text>
          <View style={styles.diffMetrics}>
            <Text style={styles.diffAdditions}>+{task.diffSummary.additions}</Text>
            <Text style={styles.diffDeletions}>-{task.diffSummary.deletions}</Text>
            <Text style={styles.diffFiles}>{task.diffSummary.filesChanged} files touched</Text>
          </View>
        </View>
      )}

      {statusMsg ? (
        <View style={styles.bannerContainer}>
          <Text style={styles.statusBanner}>{statusMsg}</Text>
        </View>
      ) : null}

      <View style={styles.actionBar}>
        <Pressable style={approveBtnStyle} onPress={onApprove} disabled={isSubmitting}>
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.btnText}>✓ Approve & Create PR</Text>
          )}
        </Pressable>

        <Pressable style={rejectBtnStyle} onPress={onOpenFeedback} disabled={isSubmitting}>
          <Text style={styles.btnText}>✕ Request Changes</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ReviewPanel({ workspaceId }: PluginWorkspacePanelProps) {
  const [tasks, setTasks] = useState<GiteaWorkflowTask[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("ALL");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const listTasks = useRpc(listTasksRpc);
  const approveTask = useRpc(approveTaskRpc);
  const rejectTask = useRpc(rejectTaskRpc);

  const refreshTasks = useCallback(async () => {
    try {
      const res = await listTasks({ workspaceId });
      const nextTasks = res?.tasks ?? [];
      setTasks(nextTasks);
      if (nextTasks.length > 0 && !activeTaskId) {
        setActiveTaskId(nextTasks[0].id);
      }
    } catch (err) {
      console.warn("Failed fetching gitea tasks:", err);
    }
  }, [listTasks, workspaceId, activeTaskId]);

  useEffect(() => {
    refreshTasks();
    const interval = setInterval(refreshTasks, 5000);
    return () => clearInterval(interval);
  }, [refreshTasks]);

  const projectList = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const t of tasks) {
      const existing = map.get(t.projectId);
      if (existing) {
        existing.count++;
      } else {
        map.set(t.projectId, {
          id: t.projectId,
          name: `${t.repoOwner}/${t.repoName}`,
          count: 1,
        });
      }
    }
    return Array.from(map.values());
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (selectedProjectId === "ALL") return tasks;
    return tasks.filter((t) => t.projectId === selectedProjectId);
  }, [tasks, selectedProjectId]);

  const activeTask = useMemo(() => {
    if (filteredTasks.length === 0) return null;
    return filteredTasks.find((t) => t.id === activeTaskId) ?? filteredTasks[0];
  }, [filteredTasks, activeTaskId]);

  const handleApprove = useCallback(async () => {
    if (!activeTask || isSubmitting) return;
    setIsSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await approveTask({ taskId: activeTask.id });
      if (res?.ok) {
        setStatusMsg("✓ Task approved! Gitea Issue updated & PR finalized.");
        await refreshTasks();
      } else {
        setStatusMsg(`Failed approving task: ${res?.error ?? "Unknown error"}`);
      }
    } catch (err) {
      setStatusMsg(`Error: ${(err as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [activeTask, isSubmitting, approveTask, refreshTasks]);

  const handleReject = useCallback(
    async (feedback: string) => {
      if (!activeTask || isSubmitting) return;
      setIsSubmitting(true);
      setShowFeedback(false);
      setStatusMsg(null);
      try {
        const res = await rejectTask({ taskId: activeTask.id, feedback });
        if (res?.ok) {
          setStatusMsg("Task returned to agent with your review feedback.");
          await refreshTasks();
        } else {
          setStatusMsg(`Failed rejecting task: ${res?.error ?? "Unknown error"}`);
        }
      } catch (err) {
        setStatusMsg(`Error: ${(err as Error).message}`);
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeTask, isSubmitting, refreshTasks, rejectTask],
  );

  const openFeedback = useCallback(() => setShowFeedback(true), []);
  const closeFeedback = useCallback(() => setShowFeedback(false), []);

  if (tasks.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyIcon}>☕</Text>
        <Text style={styles.emptyTitle}>No Gitea Tasks Active</Text>
        <Text style={styles.emptySubtitle}>
          Tasks with label &quot;agent-ready&quot; in registered repositories will appear here
          automatically.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {projectList.length > 1 && (
        <View style={styles.projectFilterBar}>
          <ProjectFilterPill
            id="ALL"
            name="All"
            count={tasks.length}
            isSelected={selectedProjectId === "ALL"}
            onSelect={setSelectedProjectId}
          />
          {projectList.map((p) => (
            <ProjectFilterPill
              key={p.id}
              id={p.id}
              name={p.name}
              count={p.count}
              isSelected={selectedProjectId === p.id}
              onSelect={setSelectedProjectId}
            />
          ))}
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.taskTabScroll}>
        {filteredTasks.map((t) => (
          <TaskTabItem
            key={t.id}
            task={t}
            isSelected={t.id === activeTask?.id}
            onSelect={setActiveTaskId}
          />
        ))}
      </ScrollView>

      {activeTask && (
        <TaskCard
          task={activeTask}
          isSubmitting={isSubmitting}
          statusMsg={statusMsg}
          onApprove={handleApprove}
          onOpenFeedback={openFeedback}
        />
      )}

      {showFeedback && <FeedbackDialog onSubmit={handleReject} onCancel={closeFeedback} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d0f14",
  },
  contentContainer: {
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#0d0f14",
  },
  emptyIcon: {
    fontSize: 34,
    marginBottom: 8,
  },
  emptyTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  emptySubtitle: {
    color: "#64748b",
    fontSize: 13,
    textAlign: "center",
  },
  projectFilterBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  projectPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#161922",
    borderWidth: 1,
    borderColor: "#222634",
  },
  projectPillActive: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#2e3856",
    borderWidth: 1,
    borderColor: "#6366f1",
  },
  projectPillText: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "500",
  },
  projectPillTextActive: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
  },
  taskTabScroll: {
    flexDirection: "row",
    marginBottom: 14,
  },
  taskTab: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 7,
    backgroundColor: "#161922",
    borderWidth: 1,
    borderColor: "#222634",
    marginRight: 8,
  },
  taskTabActive: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 7,
    backgroundColor: "#262d42",
    borderWidth: 1,
    borderColor: "#6366f1",
    marginRight: 8,
  },
  statusDotDefault: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#64748b",
    marginRight: 8,
  },
  statusDotPending: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#f59e0b",
    marginRight: 8,
  },
  statusDotDone: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#10b981",
    marginRight: 8,
  },
  statusDotFailed: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#ef4444",
    marginRight: 8,
  },
  statusDotWorking: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#3b82f6",
    marginRight: 8,
  },
  taskTabText: {
    color: "#94a3b8",
    fontSize: 12,
  },
  taskTabTextActive: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  taskCard: {
    backgroundColor: "#161922",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#222634",
    padding: 16,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  badgeQueued: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeReview: {
    backgroundColor: "#451a03",
    borderColor: "#b45309",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeDone: {
    backgroundColor: "#064e3b",
    borderColor: "#059669",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeFailed: {
    backgroundColor: "#4c0519",
    borderColor: "#e11d48",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeText: {
    color: "#f8fafc",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  repoPill: {
    backgroundColor: "#202534",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  repoLabel: {
    color: "#94a3b8",
    fontSize: 11,
    fontFamily: "monospace",
  },
  prBadge: {
    backgroundColor: "#312e81",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#4338ca",
    marginLeft: "auto",
  },
  prBadgeText: {
    color: "#818cf8",
    fontSize: 10,
    fontWeight: "700",
  },
  issueTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
    marginBottom: 4,
  },
  branchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  branchIcon: {
    color: "#6366f1",
    fontSize: 12,
  },
  branchLabel: {
    color: "#818cf8",
    fontSize: 12,
    fontFamily: "monospace",
  },
  previewBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#06281e",
    borderWidth: 1,
    borderColor: "#059669",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  previewLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 8,
    gap: 8,
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10b981",
  },
  previewInfo: {
    flex: 1,
  },
  previewLabel: {
    color: "#34d399",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  previewUrlText: {
    color: "#a7f3d0",
    fontSize: 11,
    fontFamily: "monospace",
  },
  previewOpenBtn: {
    backgroundColor: "#059669",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  previewOpenBtnText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
  },
  dualReviewRow: {
    flexDirection: "column",
    gap: 6,
    marginBottom: 12,
  },
  reviewPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1b202e",
    borderWidth: 1,
    borderColor: "#283046",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
  },
  reviewPillIcon: {
    fontSize: 11,
  },
  reviewPillContent: {
    flex: 1,
  },
  reviewPillTitle: {
    color: "#e2e8f0",
    fontSize: 11,
    fontWeight: "600",
  },
  reviewPillSub: {
    color: "#94a3b8",
    fontSize: 10,
    marginTop: 1,
  },
  matrixContainer: {
    backgroundColor: "#11141c",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#222634",
    padding: 12,
    marginBottom: 12,
  },
  matrixHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  matrixTitle: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "700",
  },
  matrixCommand: {
    color: "#64748b",
    fontSize: 10,
    fontFamily: "monospace",
  },
  matrixStatsRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    marginBottom: 8,
  },
  matrixStatPass: {
    color: "#34d399",
    fontSize: 11,
    fontWeight: "700",
  },
  matrixStatFail: {
    color: "#f87171",
    fontSize: 11,
    fontWeight: "700",
  },
  matrixStatDuration: {
    color: "#94a3b8",
    fontSize: 10,
  },
  matrixTable: {
    gap: 6,
  },
  matrixRow: {
    backgroundColor: "#161922",
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: "#1e2230",
  },
  matrixRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  casePassBadge: {
    backgroundColor: "#064e3b",
    color: "#34d399",
    fontSize: 9,
    fontWeight: "700",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  caseFailBadge: {
    backgroundColor: "#4c0519",
    color: "#f87171",
    fontSize: 9,
    fontWeight: "700",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  caseName: {
    color: "#e2e8f0",
    fontSize: 11,
    fontWeight: "600",
    flex: 1,
  },
  caseIoGrid: {
    flexDirection: "row",
    gap: 8,
  },
  caseIoCol: {
    flex: 1,
  },
  caseIoLabel: {
    color: "#64748b",
    fontSize: 9,
    textTransform: "uppercase",
  },
  caseIoVal: {
    color: "#cbd5e1",
    fontSize: 10,
    fontFamily: "monospace",
    marginTop: 2,
  },
  issueBodyContainer: {
    backgroundColor: "#11141c",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1e2230",
  },
  issueBodyText: {
    color: "#cbd5e1",
    fontSize: 12,
    lineHeight: 18,
  },
  expandToggle: {
    marginTop: 6,
    alignSelf: "flex-start",
  },
  expandToggleText: {
    color: "#6366f1",
    fontSize: 11,
    fontWeight: "600",
  },
  diffCard: {
    backgroundColor: "#11141c",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1e2230",
  },
  diffTitle: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  diffMetrics: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  diffAdditions: {
    color: "#34d399",
    fontSize: 13,
    fontWeight: "700",
  },
  diffDeletions: {
    color: "#f87171",
    fontSize: 13,
    fontWeight: "700",
  },
  diffFiles: {
    color: "#94a3b8",
    fontSize: 12,
  },
  bannerContainer: {
    marginTop: 12,
    padding: 10,
    backgroundColor: "#1e1b4b",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#3730a3",
  },
  statusBanner: {
    color: "#c7d2fe",
    fontSize: 12,
  },
  actionBar: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  btnApprove: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#059669",
  },
  btnReject: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e11d48",
  },
  btnDisabled: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#334155",
  },
  btnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
});
