import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { approveTaskRpc, listTasksRpc, rejectTaskRpc } from "../shared/contracts.js";
import type { GiteaWorkflowTask } from "../shared/types.js";
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
  else if (task.state === "coding" || task.state === "self_review")
    dotStyle = styles.statusDotWorking;

  const shortTitle =
    task.issueTitle.length > 20 ? `${task.issueTitle.slice(0, 20)}...` : task.issueTitle;

  const tabStyle = isSelected ? styles.taskTabActive : styles.taskTab;
  const textStyle = isSelected ? styles.taskTabTextActive : styles.taskTabText;

  return (
    <Pressable onPress={handlePress} style={tabStyle} accessibilityRole="button">
      <View style={dotStyle} />
      <Text style={textStyle}>
        #{task.issueNumber} {shortTitle}
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
  }, [id, onSelect]);

  const pillStyle = isSelected ? styles.projectPillActive : styles.projectPill;
  const textStyle = isSelected ? styles.projectPillTextActive : styles.projectPillText;

  return (
    <Pressable style={pillStyle} onPress={handlePress}>
      <Text style={textStyle}>
        {name} ({count})
      </Text>
    </Pressable>
  );
});

export function ReviewPanel(props: Partial<PluginWorkspacePanelProps>) {
  const workspaceId = props.workspaceId;
  const listTasks = useRpc(listTasksRpc);
  const approveTask = useRpc(approveTaskRpc);
  const rejectTask = useRpc(rejectTaskRpc);

  const [tasks, setTasks] = useState<GiteaWorkflowTask[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("ALL");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDescExpanded, setIsDescExpanded] = useState(false);

  const refreshTasks = useCallback(async () => {
    try {
      const res = await listTasks({ workspaceId });
      setTasks(res.tasks);
      setActiveTaskId((prev) => {
        if (prev && res.tasks.some((t) => t.id === prev)) {
          return prev;
        }
        return res.tasks[0]?.id ?? null;
      });
    } catch (e) {
      console.error("[ReviewPanel] Failed fetching tasks:", e);
    } finally {
      setIsLoading(false);
    }
  }, [listTasks, workspaceId]);

  useEffect(() => {
    void refreshTasks();
    const timer = setInterval(() => {
      void refreshTasks();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshTasks]);

  // Derive unique projects for multi-project filtering
  const projectList = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const t of tasks) {
      const key = t.projectId || t.repoName;
      const name = t.repoName || t.projectId;
      const entry = map.get(key) ?? { id: key, name, count: 0 };
      entry.count++;
      map.set(key, entry);
    }
    return Array.from(map.values());
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (selectedProjectId === "ALL") return tasks;
    return tasks.filter((t) => (t.projectId || t.repoName) === selectedProjectId);
  }, [tasks, selectedProjectId]);

  const activeTask = useMemo(
    () => filteredTasks.find((t) => t.id === activeTaskId) ?? filteredTasks[0] ?? null,
    [filteredTasks, activeTaskId],
  );

  const handleApprove = useCallback(async () => {
    if (!activeTask || isSubmitting) return;
    setIsSubmitting(true);
    setStatusMsg("Approving, committing and submitting PR to Gitea...");
    try {
      const res = await approveTask({ taskId: activeTask.id });
      if (res.ok) {
        setStatusMsg(`PR Created successfully: ${res.prUrl ?? "Done"}`);
        void refreshTasks();
      } else {
        setStatusMsg(`Approval failed: ${res.error ?? "Unknown error"}`);
      }
    } catch (e) {
      setStatusMsg(`Error: ${(e as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [activeTask, approveTask, isSubmitting, refreshTasks]);

  const handleReject = useCallback(
    async (feedback: string) => {
      if (!activeTask || isSubmitting) return;
      setIsSubmitting(true);
      setStatusMsg("Submitting change request to Agent worktree...");
      try {
        const res = await rejectTask({ taskId: activeTask.id, feedback });
        if (res.ok) {
          setShowFeedback(false);
          setStatusMsg("Feedback dispatched. Agent resumed iteration.");
          void refreshTasks();
        } else {
          setStatusMsg(`Rejection failed: ${res.error ?? "Unknown error"}`);
        }
      } catch (e) {
        setStatusMsg(`Error: ${(e as Error).message}`);
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeTask, isSubmitting, refreshTasks, rejectTask],
  );

  const openFeedback = useCallback(() => setShowFeedback(true), []);
  const closeFeedback = useCallback(() => setShowFeedback(false), []);
  const toggleDesc = useCallback(() => setIsDescExpanded((v) => !v), []);

  const badgeStyle = useMemo(() => {
    switch (activeTask?.state) {
      case "pending_human_review":
        return styles.badgePending;
      case "done":
        return styles.badgeDone;
      case "failed":
        return styles.badgeFailed;
      case "coding":
      case "self_review":
        return styles.badgeWorking;
      default:
        return styles.badgeDefault;
    }
  }, [activeTask?.state]);

  const approveBtnStyle = isSubmitting ? styles.btnDisabled : styles.btnApprove;
  const rejectBtnStyle = isSubmitting ? styles.btnDisabled : styles.btnReject;

  if (isLoading && tasks.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="small" color="#818cf8" />
        <Text style={styles.loadingText}>Syncing Gitea tasks & repositories...</Text>
      </View>
    );
  }

  if (tasks.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyIcon}>✨</Text>
        <Text style={styles.emptyTitle}>All caught up!</Text>
        <Text style={styles.emptySubtitle}>
          No issues labeled &quot;agent-ready&quot; in your registered Gitea repositories.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Multi-Project Filter Tabs (shown when multiple projects exist) */}
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

      {/* Task List Selector */}
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
        <View style={styles.taskCard}>
          {/* Header Row */}
          <View style={styles.metaRow}>
            <View style={badgeStyle}>
              <Text style={styles.badgeText}>{activeTask.state.replace(/_/g, " ")}</Text>
            </View>
            <View style={styles.repoPill}>
              <Text style={styles.repoLabel}>
                {activeTask.repoOwner}/{activeTask.repoName}
              </Text>
            </View>
            {activeTask.prUrl ? (
              <View style={styles.prBadge}>
                <Text style={styles.prBadgeText}>PR OPENED</Text>
              </View>
            ) : null}
          </View>

          {/* Title & Branch */}
          <Text style={styles.issueTitle}>
            #{activeTask.issueNumber} {activeTask.issueTitle}
          </Text>
          <View style={styles.branchRow}>
            <Text style={styles.branchIcon}>⌥</Text>
            <Text style={styles.branchLabel}>{activeTask.branchName}</Text>
          </View>

          {/* Collapsible Issue Details */}
          {activeTask.issueBody ? (
            <View style={styles.issueBodyContainer}>
              <Text style={styles.issueBodyText} numberOfLines={isDescExpanded ? undefined : 2}>
                {activeTask.issueBody}
              </Text>
              <Pressable onPress={toggleDesc} style={styles.expandToggle}>
                <Text style={styles.expandToggleText}>
                  {isDescExpanded ? "▴ Collapse Details" : "▾ View Full Issue"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* Visual Proof: Headless Browser Screenshots */}
          <ScreenshotGallery screenshots={activeTask.screenshots} />

          {/* Diff Metric Summary */}
          {activeTask.diffSummary && (
            <View style={styles.diffCard}>
              <Text style={styles.diffTitle}>Verified Code Changes</Text>
              <View style={styles.diffMetrics}>
                <Text style={styles.diffAdditions}>+{activeTask.diffSummary.additions}</Text>
                <Text style={styles.diffDeletions}>-{activeTask.diffSummary.deletions}</Text>
                <Text style={styles.diffFiles}>
                  {activeTask.diffSummary.filesChanged} files touched
                </Text>
              </View>
            </View>
          )}

          {/* Status Message Banner */}
          {statusMsg ? (
            <View style={styles.bannerContainer}>
              <Text style={styles.statusBanner}>{statusMsg}</Text>
            </View>
          ) : null}

          {/* Action Bar */}
          <View style={styles.actionBar}>
            <Pressable style={approveBtnStyle} onPress={handleApprove} disabled={isSubmitting}>
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.btnText}>✓ Approve & Create PR</Text>
              )}
            </Pressable>

            <Pressable style={rejectBtnStyle} onPress={openFeedback} disabled={isSubmitting}>
              <Text style={styles.btnText}>✕ Request Changes</Text>
            </Pressable>
          </View>

          {/* Feedback Form Sheet */}
          {showFeedback && <FeedbackDialog onSubmit={handleReject} onCancel={closeFeedback} />}
        </View>
      )}
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
  loadingText: {
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 12,
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
    marginRight: 8,
    backgroundColor: "#6366f1",
  },
  statusDotPending: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 8,
    backgroundColor: "#8b5cf6",
  },
  statusDotDone: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 8,
    backgroundColor: "#10b981",
  },
  statusDotWorking: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 8,
    backgroundColor: "#f59e0b",
  },
  statusDotFailed: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 8,
    backgroundColor: "#ef4444",
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
    backgroundColor: "#12141a",
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1e222d",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  badgeDefault: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "#3b82f6",
  },
  badgePending: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "#8b5cf6",
  },
  badgeDone: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "#10b981",
  },
  badgeWorking: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "#f59e0b",
  },
  badgeFailed: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "#ef4444",
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  repoPill: {
    backgroundColor: "#1c202c",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  repoLabel: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "500",
  },
  prBadge: {
    backgroundColor: "#064e3b",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  prBadgeText: {
    color: "#34d399",
    fontSize: 10,
    fontWeight: "700",
  },
  issueTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#f8fafc",
    lineHeight: 22,
    marginBottom: 4,
  },
  branchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 8,
  },
  branchIcon: {
    color: "#64748b",
    fontSize: 12,
  },
  branchLabel: {
    fontSize: 12,
    color: "#818cf8",
    fontFamily: "monospace",
  },
  issueBodyContainer: {
    backgroundColor: "#0a0c10",
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#1a1d26",
    marginBottom: 10,
  },
  issueBodyText: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 18,
  },
  expandToggle: {
    marginTop: 6,
    alignSelf: "flex-start",
  },
  expandToggleText: {
    color: "#818cf8",
    fontSize: 11,
    fontWeight: "500",
  },
  diffCard: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#161922",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#222634",
  },
  diffTitle: {
    color: "#cbd5e1",
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
