import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { approveTaskRpc, listTasksRpc, rejectTaskRpc } from "../shared/contracts.js";
import type { GiteaWorkflowTask } from "../shared/types.js";
import { ScreenshotGallery } from "./screenshot-gallery";
import { FeedbackDialog } from "./feedback-dialog";

interface TaskTabItemProps {
  id: string;
  issueNumber: number;
  issueTitle: string;
  isSelected: boolean;
  onSelect: (taskId: string) => void;
}

const TaskTabItem = React.memo(function TaskTabItem({
  id,
  issueNumber,
  issueTitle,
  isSelected,
  onSelect,
}: TaskTabItemProps) {
  const handlePress = useCallback(() => {
    onSelect(id);
  }, [id, onSelect]);

  const tabStyle = isSelected ? styles.taskTabActive : styles.taskTab;
  const textStyle = isSelected ? styles.taskTabTextActive : styles.taskTabText;
  const shortTitle = issueTitle.length > 18 ? `${issueTitle.slice(0, 18)}...` : issueTitle;

  return (
    <Pressable onPress={handlePress} style={tabStyle}>
      <Text style={textStyle}>
        #{issueNumber} {shortTitle}
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
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

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

  const activeTask = useMemo(
    () => tasks.find((t) => t.id === activeTaskId) ?? null,
    [tasks, activeTaskId],
  );

  const handleApprove = useCallback(async () => {
    if (!activeTask || isSubmitting) return;
    setIsSubmitting(true);
    setStatusMsg("Approving and pushing PR to Gitea...");
    try {
      const res = await approveTask({ taskId: activeTask.id });
      if (res.ok) {
        setStatusMsg(`PR Opened successfully: ${res.prUrl ?? "Done"}`);
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
      setStatusMsg("Submitting change request to Agent...");
      try {
        const res = await rejectTask({ taskId: activeTask.id, feedback });
        if (res.ok) {
          setShowFeedback(false);
          setStatusMsg("Feedback recorded. Agent restarting coding turn.");
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

  const badgeStyle = useMemo(() => {
    switch (activeTask?.state) {
      case "pending_human_review":
        return styles.badgePending;
      case "done":
        return styles.badgeDone;
      case "failed":
        return styles.badgeFailed;
      default:
        return styles.badgeDefault;
    }
  }, [activeTask?.state]);

  const approveBtnStyle = isSubmitting ? styles.btnDisabled : styles.btnApprove;
  const rejectBtnStyle = isSubmitting ? styles.btnDisabled : styles.btnReject;

  if (isLoading && tasks.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator color="#6366f1" />
        <Text style={styles.loadingText}>Syncing project review tasks...</Text>
      </View>
    );
  }

  if (!activeTask) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyIcon}>✓</Text>
        <Text style={styles.emptyTitle}>All Caught Up</Text>
        <Text style={styles.emptySubtitle}>
          No pending review tasks for this project repository.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {tasks.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.taskTabScroll}>
          {tasks.map((task) => (
            <TaskTabItem
              key={task.id}
              id={task.id}
              issueNumber={task.issueNumber}
              issueTitle={task.issueTitle}
              isSelected={task.id === activeTaskId}
              onSelect={setActiveTaskId}
            />
          ))}
        </ScrollView>
      )}

      <View style={styles.header}>
        <View style={styles.metaRow}>
          <View style={badgeStyle}>
            <Text style={styles.badgeText}>{activeTask.state.replace(/_/g, " ")}</Text>
          </View>
          <Text style={styles.repoLabel}>
            {activeTask.repoOwner}/{activeTask.repoName}
          </Text>
        </View>

        <Text style={styles.issueTitle}>
          #{activeTask.issueNumber} {activeTask.issueTitle}
        </Text>
        <Text style={styles.branchLabel}>Branch: {activeTask.branchName}</Text>
      </View>

      <ScreenshotGallery screenshots={activeTask.screenshots} />

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

      {statusMsg ? (
        <View style={styles.bannerContainer}>
          <Text style={styles.statusBanner}>{statusMsg}</Text>
        </View>
      ) : null}

      <View style={styles.actionBar}>
        <Pressable style={approveBtnStyle} onPress={handleApprove} disabled={isSubmitting}>
          <Text style={styles.btnText}>
            {isSubmitting ? "Processing..." : "Approve & Create PR"}
          </Text>
        </Pressable>

        <Pressable style={rejectBtnStyle} onPress={openFeedback} disabled={isSubmitting}>
          <Text style={styles.btnText}>Request Changes</Text>
        </Pressable>
      </View>

      {showFeedback && <FeedbackDialog onSubmit={handleReject} onCancel={closeFeedback} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d0e11",
  },
  contentContainer: {
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#0d0e11",
  },
  loadingText: {
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 12,
  },
  emptyIcon: {
    fontSize: 32,
    color: "#10b981",
    marginBottom: 8,
  },
  emptyTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  emptySubtitle: {
    color: "#64748b",
    fontSize: 13,
    textAlign: "center",
  },
  taskTabScroll: {
    flexDirection: "row",
    marginBottom: 16,
  },
  taskTab: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: "#1e222b",
    marginRight: 8,
  },
  taskTabActive: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: "#3730a3",
    marginRight: 8,
  },
  taskTabText: {
    color: "#94a3b8",
    fontSize: 12,
  },
  taskTabTextActive: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "bold",
  },
  header: {
    marginBottom: 16,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
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
  badgeFailed: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "#ef4444",
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "bold",
    textTransform: "uppercase",
  },
  repoLabel: {
    color: "#94a3b8",
    fontSize: 12,
  },
  issueTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#f8fafc",
    lineHeight: 22,
    marginBottom: 4,
  },
  branchLabel: {
    fontSize: 12,
    color: "#64748b",
    fontFamily: "monospace",
  },
  diffCard: {
    marginTop: 14,
    padding: 12,
    backgroundColor: "#16181f",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#272a37",
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
    fontWeight: "bold",
  },
  diffDeletions: {
    color: "#f87171",
    fontSize: 13,
    fontWeight: "bold",
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
    marginTop: 18,
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
