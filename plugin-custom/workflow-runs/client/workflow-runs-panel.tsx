import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  useAgent,
  useAgents,
  usePaseo,
  useWorkspace,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import {
  buildProjectedWorkflowRuns,
  isProjectedRunId,
  sortWorkflowRuns,
  type WorkflowRunItemDetail,
  type WorkflowRunItemSummary,
} from "./projected-runs.js";

function statusColor(status: string, theme: PluginTheme): string {
  if (status === "succeeded") return theme.colors.statusSuccess;
  if (status === "failed" || status === "cancelled") return theme.colors.statusDanger;
  if (status === "waiting_approval" || status === "running") return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

function formatStatusLabel(status: string): string {
  if (status === "waiting_approval") return "Awaiting Approval";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function WorkflowRunsPanelView({
  workspaceId,
  theme,
  layout,
  navigation,
}: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const toast = useToast();
  const workspace = useWorkspace(workspaceId, (ws) => ({ projectId: ws.projectId }));
  const projectId = workspace?.projectId ?? null;

  // useAgents returns array of AgentRefs; we fetch each agent with useAgent in child components or inspect via paseo.agents.list
  const agentRefs = useAgents();
  const [activeAgents, setActiveAgents] = useState<any[]>([]);

  useEffect(() => {
    let mounted = true;
    if (typeof paseo?.agents?.list === "function") {
      paseo.agents
        .list()
        .then((res: any) => {
          if (!mounted) return;
          const entries = res?.entries ?? [];
          const list = entries
            .map((e: any) => e.agent ?? e)
            .filter((a: any) => a.workspaceId === workspaceId);
          setActiveAgents(list);
        })
        .catch(() => {});
    }
    return () => {
      mounted = false;
    };
  }, [paseo, workspaceId, agentRefs.length]);

  const projected = useMemo(() => buildProjectedWorkflowRuns(activeAgents), [activeAgents]);

  const [rawRuns, setRawRuns] = useState<WorkflowRunItemSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [remoteDetail, setRemoteDetail] = useState<WorkflowRunItemDetail | null>(null);
  const [approvals, setApprovals] = useState<
    Array<{ approvalId: string; stepId: string; status: string }>
  >([]);
  const [interactionDraft, setInteractionDraft] = useState("");
  const [isPending, setIsPending] = useState(false);

  const loadRuns = useCallback(async () => {
    if (!projectId || !paseo?.workflows) return;
    try {
      const res = await paseo.workflows.runList({ projectId, workspaceId });
      if (!res.error && res.runs) {
        setRawRuns(
          res.runs.map((r: any) => ({
            runId: r.runId,
            name: r.name,
            status: r.status,
            createdAt: r.createdAt,
          })),
        );
      }
    } catch {
      // Daemon might not have any workflow runs yet
    }
  }, [paseo, projectId, workspaceId]);

  const loadDetail = useCallback(
    async (runId: string) => {
      if (isProjectedRunId(runId) || !projectId || !paseo?.workflows) return;
      try {
        const res = await paseo.workflows.runInspect({ projectId, workspaceId, runId });
        if (res.run) {
          setRemoteDetail({
            runId: res.run.runId,
            name: res.run.name,
            status: res.run.status,
            pendingInteraction: res.run.pendingInteraction,
            stepAttempts: res.run.stepAttempts,
          });
        }
        const appr = await paseo.workflows.approvalList({ projectId, workspaceId, runId });
        if (appr.approvals) {
          setApprovals(appr.approvals);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to inspect workflow run");
      }
    },
    [paseo, projectId, toast, workspaceId],
  );

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!selectedRunId) {
      setRemoteDetail(null);
      setApprovals([]);
      return;
    }
    if (!isProjectedRunId(selectedRunId)) {
      void loadDetail(selectedRunId);
    }
  }, [loadDetail, selectedRunId]);

  const runs = useMemo(
    () => sortWorkflowRuns([...rawRuns, ...projected.summaries]),
    [projected.summaries, rawRuns],
  );

  const detail = useMemo(() => {
    if (!selectedRunId) return null;
    if (isProjectedRunId(selectedRunId)) {
      return projected.details.get(selectedRunId) ?? null;
    }
    return remoteDetail;
  }, [projected.details, remoteDetail, selectedRunId]);

  const handleCancelRun = async () => {
    if (!detail || !projectId) return;
    setIsPending(true);
    try {
      if (detail.isProjected) {
        const agentId = detail.runId.replace("virtual:session:", "");
        await paseo.agents.ref(agentId).archive();
        toast.show("Session archived", { variant: "success" });
      } else {
        const res = await paseo.workflows.runCancel({
          projectId,
          workspaceId,
          runId: detail.runId,
        });
        if (res.error) throw new Error(res.error);
        toast.show("Workflow cancelled", { variant: "success" });
        await loadRuns();
        await loadDetail(detail.runId);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel run");
    } finally {
      setIsPending(false);
    }
  };

  const handleResumeRun = async () => {
    if (!detail || detail.isProjected || !projectId) return;
    setIsPending(true);
    try {
      const res = await paseo.workflows.runResume({
        projectId,
        workspaceId,
        runId: detail.runId,
      });
      if (res.error) throw new Error(res.error);
      toast.show("Workflow resumed", { variant: "success" });
      await loadRuns();
      await loadDetail(detail.runId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resume run");
    } finally {
      setIsPending(false);
    }
  };

  const handleStepDecision = async (stepId: string, approve: boolean) => {
    if (!detail || !projectId) return;
    const pending = approvals.find((a) => a.stepId === stepId && a.status === "pending");
    if (!pending) return;
    setIsPending(true);
    try {
      const res = approve
        ? await paseo.workflows.approvalApprove({
            projectId,
            workspaceId,
            runId: detail.runId,
            approvalId: pending.approvalId,
          })
        : await paseo.workflows.approvalDeny({
            projectId,
            workspaceId,
            runId: detail.runId,
            approvalId: pending.approvalId,
            reason: "Denied from Workflow Runs panel",
          });
      if (res.error) throw new Error(res.error);
      toast.show(approve ? "Step approved" : "Step denied", { variant: "success" });
      await loadRuns();
      await loadDetail(detail.runId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit approval");
    } finally {
      setIsPending(false);
    }
  };

  const handleRetryStep = async (stepId: string) => {
    if (!detail || detail.isProjected || !projectId) return;
    setIsPending(true);
    try {
      const res = await paseo.workflows.runRetry({
        projectId,
        workspaceId,
        runId: detail.runId,
        stepId,
      });
      if (res.error) throw new Error(res.error);
      toast.show("Step retried", { variant: "success" });
      await loadRuns();
      await loadDetail(detail.runId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to retry step");
    } finally {
      setIsPending(false);
    }
  };

  const handleRespondInteraction = async () => {
    if (!detail?.pendingInteraction || !interactionDraft.trim() || !projectId) return;
    setIsPending(true);
    try {
      const res = await paseo.workflows.interactionRespond({
        projectId,
        workspaceId,
        runId: detail.runId,
        interactionId: detail.pendingInteraction.id,
        answer: interactionDraft.trim(),
      });
      if (res.error) throw new Error(res.error);
      setInteractionDraft("");
      toast.show("Interaction answered and resumed", { variant: "success" });
      await loadRuns();
      await loadDetail(detail.runId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send response");
    } finally {
      setIsPending(false);
    }
  };

  const renderList = () => {
    if (runs.length === 0) {
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ fontSize: 13, color: theme.colors.foregroundMuted, textAlign: "center" }}>
            No active or completed workflows found in this workspace.
          </Text>
        </View>
      );
    }

    return (
      <ScrollView style={{ flex: 1 }}>
        {runs.map((run) => {
          const isSelected = selectedRunId === run.runId;
          const badgeColor = statusColor(run.status, theme);
          return (
            <Pressable
              key={run.runId}
              accessibilityRole="button"
              onPress={() => setSelectedRunId(run.runId)}
              style={{
                padding: 12,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
                backgroundColor: isSelected ? theme.colors.surface2 : "transparent",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 13,
                    fontWeight: "500",
                    color: theme.colors.foreground,
                    flexShrink: 1,
                  }}
                >
                  {run.name}
                </Text>
                {run.isProjected ? (
                  <View
                    style={{
                      paddingHorizontal: 6,
                      paddingVertical: 1,
                      borderRadius: 4,
                      backgroundColor: theme.colors.surface1,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
                      Session
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={{ fontSize: 11, fontWeight: "600", color: badgeColor }}>
                {formatStatusLabel(run.status)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    );
  };

  const renderDetail = () => {
    if (!selectedRunId) {
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ fontSize: 13, color: theme.colors.foregroundMuted }}>
            Select a workflow run to view details
          </Text>
        </View>
      );
    }

    if (!detail) {
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ fontSize: 13, color: theme.colors.foregroundMuted }}>Loading run...</Text>
        </View>
      );
    }

    return (
      <View style={{ flex: 1, padding: 16, gap: 12 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", color: theme.colors.foreground }}>
            {detail.name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                fontSize: 12,
                fontWeight: "600",
                color: statusColor(detail.status, theme),
              }}
            >
              {formatStatusLabel(detail.status)}
            </Text>
            {detail.status === "running" || detail.status === "waiting_approval" ? (
              <Pressable
                accessibilityRole="button"
                disabled={isPending}
                onPress={() => void handleCancelRun()}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 6,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text style={{ fontSize: 12, color: theme.colors.foreground }}>Cancel Run</Text>
              </Pressable>
            ) : null}
            {(detail.status === "blocked" || detail.status === "cancelled") &&
            !detail.isProjected ? (
              <Pressable
                accessibilityRole="button"
                disabled={isPending}
                onPress={() => void handleResumeRun()}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 6,
                  backgroundColor: theme.colors.accent,
                }}
              >
                <Text style={{ fontSize: 12, color: theme.colors.accentForeground }}>
                  Resume Run
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {detail.pendingInteraction && detail.pendingInteraction.status === "pending" ? (
          <View
            style={{
              padding: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.accent,
              backgroundColor: theme.colors.surface1,
              gap: 8,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.foreground }}>
              Interaction Requested
            </Text>
            <Text style={{ fontSize: 13, color: theme.colors.foregroundMuted }}>
              {detail.pendingInteraction.question ??
                "The workflow is requesting your input to proceed:"}
            </Text>
            <TextInput
              value={interactionDraft}
              onChangeText={setInteractionDraft}
              placeholder="Type your response..."
              multiline
              style={{
                minHeight: 64,
                padding: 8,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface0,
                color: theme.colors.foreground,
                fontSize: 13,
              }}
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
              <Pressable
                accessibilityRole="button"
                disabled={isPending || !interactionDraft.trim()}
                onPress={() => void handleRespondInteraction()}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: theme.colors.accent,
                  opacity: isPending || !interactionDraft.trim() ? 0.5 : 1,
                }}
              >
                <Text style={{ fontSize: 12, color: theme.colors.accentForeground }}>
                  Send reply
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <ScrollView
          style={{
            flex: 1,
            backgroundColor: theme.colors.surface1,
            padding: 12,
            borderRadius: 8,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "700",
              color: theme.colors.foregroundMuted,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            DAG Execution Steps
          </Text>
          {detail.stepAttempts.map((step, index) => (
            <View
              key={`${step.stepId}-${step.attempt}`}
              style={{
                backgroundColor: theme.colors.surface0,
                borderWidth: 1,
                borderColor:
                  step.status === "waiting_approval" || step.status === "running"
                    ? theme.colors.accent
                    : theme.colors.border,
                borderRadius: 6,
                padding: 12,
                marginBottom: 8,
                marginLeft: index > 0 ? 12 : 0,
                gap: 6,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "500", color: theme.colors.foreground }}>
                  {index + 1}. {step.stepId} (#{step.attempt})
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "600",
                    color: statusColor(step.status, theme),
                  }}
                >
                  {step.status}
                </Text>
              </View>

              {step.description ? (
                <Text
                  numberOfLines={2}
                  style={{ fontSize: 12, color: theme.colors.foregroundMuted }}
                >
                  {step.description}
                </Text>
              ) : null}
              {step.failureReason ? (
                <Text style={{ fontSize: 12, color: theme.colors.statusDanger }}>
                  Reason: {step.failureReason}
                </Text>
              ) : null}

              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                {step.agentId && navigation?.openAgent ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => navigation.openAgent({ agentId: step.agentId! })}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 4,
                      backgroundColor: theme.colors.surface2,
                    }}
                  >
                    <Text style={{ fontSize: 12, color: theme.colors.foreground }}>
                      {step.isSubagent ? "View Sub-agent" : "View Chat"}
                    </Text>
                  </Pressable>
                ) : null}

                {step.status === "waiting_approval" ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      disabled={isPending}
                      onPress={() => void handleStepDecision(step.stepId, true)}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 4,
                        backgroundColor: theme.colors.accent,
                      }}
                    >
                      <Text style={{ fontSize: 12, color: theme.colors.accentForeground }}>
                        Approve
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={isPending}
                      onPress={() => void handleStepDecision(step.stepId, false)}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 4,
                        backgroundColor: theme.colors.statusDanger,
                      }}
                    >
                      <Text style={{ fontSize: 12, color: "#fff" }}>Deny</Text>
                    </Pressable>
                  </>
                ) : null}

                {step.status === "failed" && !step.isProjected ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={isPending}
                    onPress={() => void handleRetryStep(step.stepId)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 4,
                      backgroundColor: theme.colors.surface2,
                    }}
                  >
                    <Text style={{ fontSize: 12, color: theme.colors.foreground }}>Retry Step</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="Workflow" size={17} color={theme.colors.accent} />
          <Text style={{ fontSize: 15, fontWeight: "600", color: theme.colors.foreground }}>
            Workflow Runs
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => void loadRuns()}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 6,
            backgroundColor: theme.colors.surface1,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Icon name="RefreshCw" size={12} color={theme.colors.foregroundMuted} />
          <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>Refresh</Text>
        </Pressable>
      </View>

      {layout.compact ? (
        selectedRunId ? (
          <View style={{ flex: 1 }}>
            <View
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}
            >
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelectedRunId(null)}
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Text style={{ fontSize: 13, color: theme.colors.accent }}>← Back to List</Text>
              </Pressable>
            </View>
            {renderDetail()}
          </View>
        ) : (
          renderList()
        )
      ) : (
        <View style={{ flex: 1, flexDirection: "row" }}>
          <View
            style={{
              width: 300,
              borderRightWidth: 1,
              borderRightColor: theme.colors.border,
            }}
          >
            {renderList()}
          </View>
          <View style={{ flex: 1 }}>{renderDetail()}</View>
        </View>
      )}
    </View>
  );
}
