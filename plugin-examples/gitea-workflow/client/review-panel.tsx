import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { approveTaskRpc, listTasksRpc, rejectTaskRpc } from "../shared/contracts.js";
import type { GiteaWorkflowTask } from "../shared/types.js";
import { ScreenshotGallery } from "./screenshot-gallery";
import { FeedbackDialog } from "./feedback-dialog";

export function ReviewPanel() {
  const listTasks = useRpc(listTasksRpc);
  const approveTask = useRpc(approveTaskRpc);
  const rejectTask = useRpc(rejectTaskRpc);

  const [activeTask, setActiveTask] = useState<GiteaWorkflowTask | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const refreshTasks = useCallback(async () => {
    try {
      const res = await listTasks({});
      if (res.tasks.length > 0) {
        setActiveTask(res.tasks[0]);
      }
    } catch (e) {
      console.error(e);
    }
  }, [listTasks]);

  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);

  const handleApprove = useCallback(async () => {
    if (!activeTask) return;
    setStatusMsg("Approving and creating Gitea PR...");
    try {
      const res = await approveTask({ taskId: activeTask.id });
      if (res.ok) {
        setStatusMsg(`PR Opened: ${res.prUrl ?? "Success"}`);
        void refreshTasks();
      } else {
        setStatusMsg(`Approval failed: ${res.error ?? "Unknown error"}`);
      }
    } catch (e) {
      setStatusMsg(`Error: ${(e as Error).message}`);
    }
  }, [activeTask, approveTask, refreshTasks]);

  const handleReject = useCallback(
    async (feedback: string) => {
      if (!activeTask) return;
      setStatusMsg("Sending feedback back to Agent...");
      try {
        const res = await rejectTask({ taskId: activeTask.id, feedback });
        if (res.ok) {
          setShowFeedback(false);
          setStatusMsg("Feedback submitted; agent will iterate.");
          void refreshTasks();
        }
      } catch (e) {
        setStatusMsg(`Error: ${(e as Error).message}`);
      }
    },
    [activeTask, refreshTasks, rejectTask],
  );

  const toggleFeedback = useCallback(() => {
    setShowFeedback((prev) => !prev);
  }, []);

  const closeFeedback = useCallback(() => {
    setShowFeedback(false);
  }, []);

  if (!activeTask) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyTitle}>No active Gitea tasks</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.badge}>{activeTask.state}</Text>
        <Text style={styles.issueTitle}>
          #{activeTask.issueNumber} {activeTask.issueTitle}
        </Text>
      </View>

      <ScreenshotGallery screenshots={activeTask.screenshots} />

      {activeTask.diffSummary && (
        <View style={styles.diffCard}>
          <Text style={styles.diffText}>
            Changes: +{activeTask.diffSummary.additions} / -{activeTask.diffSummary.deletions} in{" "}
            {activeTask.diffSummary.filesChanged} files
          </Text>
        </View>
      )}

      {statusMsg ? <Text style={styles.statusBanner}>{statusMsg}</Text> : null}

      <View style={styles.actionBar}>
        <Pressable style={styles.approveBtn} onPress={handleApprove}>
          <Text style={styles.actionBtnText}>Approve & Create PR</Text>
        </Pressable>
        <Pressable style={styles.rejectBtn} onPress={toggleFeedback}>
          <Text style={styles.actionBtnText}>Request Changes</Text>
        </Pressable>
      </View>

      {showFeedback && <FeedbackDialog onSubmit={handleReject} onCancel={closeFeedback} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#111113",
  },
  header: {
    marginBottom: 16,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "bold",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  issueTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#ffffff",
  },
  diffCard: {
    marginTop: 12,
    padding: 8,
    backgroundColor: "#1a1a1e",
    borderRadius: 6,
  },
  diffText: {
    color: "#10b981",
    fontSize: 12,
  },
  statusBanner: {
    marginVertical: 8,
    color: "#60a5fa",
    fontSize: 12,
  },
  actionBar: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  approveBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: "center",
    backgroundColor: "#10b981",
  },
  rejectBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: "center",
    backgroundColor: "#dc2626",
  },
  actionBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "bold",
  },
  emptyTitle: {
    color: "#9ca3af",
    fontSize: 14,
    textAlign: "center",
    marginTop: 40,
  },
});
