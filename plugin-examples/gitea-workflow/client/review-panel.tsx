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
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refreshTasks = useCallback(async () => {
    try {
      const res = await listTasks({});
      if (res.tasks.length > 0) {
        setActiveTask((prev) => {
          if (!prev) return res.tasks[0];
          const match = res.tasks.find((t) => t.id === prev.id);
          return match ?? res.tasks[0];
        });
      }
    } catch (e) {
      console.error(e);
    }
  }, [listTasks]);

  useEffect(() => {
    void refreshTasks();
    const timer = setInterval(() => {
      void refreshTasks();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshTasks]);

  const handleApprove = useCallback(async () => {
    if (!activeTask || isSubmitting) return;
    setIsSubmitting(true);
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
    } finally {
      setIsSubmitting(false);
    }
  }, [activeTask, approveTask, isSubmitting, refreshTasks]);

  const handleReject = useCallback(
    async (feedback: string) => {
      if (!activeTask || isSubmitting) return;
      setIsSubmitting(true);
      setStatusMsg("Sending feedback back to Agent...");
      try {
        const res = await rejectTask({ taskId: activeTask.id, feedback });
        if (res.ok) {
          setShowFeedback(false);
          setStatusMsg("Feedback submitted; agent will iterate.");
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
        <Pressable
          style={isSubmitting ? styles.disabledBtn : styles.approveBtn}
          onPress={handleApprove}
          disabled={isSubmitting}
        >
          <Text style={styles.actionBtnText}>
            {isSubmitting ? "Processing..." : "Approve & Create PR"}
          </Text>
        </Pressable>
        <Pressable
          style={isSubmitting ? styles.disabledBtn : styles.rejectBtn}
          onPress={toggleFeedback}
          disabled={isSubmitting}
        >
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
  disabledBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: "center",
    backgroundColor: "#4b5563",
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
