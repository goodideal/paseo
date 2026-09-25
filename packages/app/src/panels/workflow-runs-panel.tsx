import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { Activity } from "lucide-react-native";

import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor, type PanelPresentation } from "@/panels/panel-registry";
import { ScreenTitle } from "@/components/headers/screen-title";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useSessionStore } from "@/stores/session-store";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { Theme } from "@/styles/theme";
import type {
  WorkflowRunSummary,
  WorkflowRunDetail,
} from "@getpaseo/protocol/workflow/rpc-schemas";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

export interface WorkflowEngineClient {
  workflowRunList: import("@getpaseo/client/internal/daemon-client").DaemonClient["workflowRunList"];
  workflowRunInspect: import("@getpaseo/client/internal/daemon-client").DaemonClient["workflowRunInspect"];
  workflowRunCancel: import("@getpaseo/client/internal/daemon-client").DaemonClient["workflowRunCancel"];
  workflowApprovalList: import("@getpaseo/client/internal/daemon-client").DaemonClient["workflowApprovalList"];
  workflowApprovalApprove: import("@getpaseo/client/internal/daemon-client").DaemonClient["workflowApprovalApprove"];
  workflowApprovalDeny: import("@getpaseo/client/internal/daemon-client").DaemonClient["workflowApprovalDeny"];
  workflowRunRetry: import("@getpaseo/client/internal/daemon-client").DaemonClient["workflowRunRetry"];
  workflowRunResume: import("@getpaseo/client/internal/daemon-client").DaemonClient["workflowRunResume"];
}

export function isWorkflowEngineClient(client: unknown): client is WorkflowEngineClient {
  return Boolean(
    client &&
    typeof client === "object" &&
    typeof Reflect.get(client, "workflowRunList") === "function",
  );
}

function resolveStatusVariant(status: string): "success" | "error" | "warning" | "muted" {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "cancelled") return "error";
  if (status === "waiting_approval" || status === "running") return "warning";
  return "muted";
}

// Hook model layer with real typed client dependency
export function useWorkflowRuns(
  client: WorkflowEngineClient | null,
  scope: { projectId: string; workspaceId: string } | null,
) {
  const [rawRuns, setRawRuns] = useState<WorkflowRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkflowRunDetail | null>(null);
  const [approvals, setApprovals] = useState<
    import("@getpaseo/protocol/workflow/rpc-schemas").WorkflowApproval[]
  >([]);

  // Pin waiting_approval and failed runs to the top, then sort by createdAt descending
  const runs = useMemo(() => {
    if (!rawRuns) return null;
    return [...rawRuns].sort((a, b) => {
      const priority = (status: string) => {
        if (status === "waiting_approval") return 0;
        if (status === "failed") return 1;
        if (status === "running") return 2;
        return 3;
      };
      const diff = priority(a.status) - priority(b.status);
      if (diff !== 0) return diff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [rawRuns]);

  const fetchRuns = useCallback(async () => {
    if (!client || !scope) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await client.workflowRunList(scope!);
      if (res.error) throw new Error(res.error);
      setRawRuns(res.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch runs");
    } finally {
      setIsLoading(false);
    }
  }, [client, scope]);

  const reloadDetail = useCallback(
    async (runId: string) => {
      if (!client || !scope) return;
      try {
        const res = await client.workflowRunInspect({ ...scope, runId });
        if (res.error) throw new Error(res.error);
        setDetail(res.run);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client, scope],
  );

  useEffect(() => {
    let isMounted = true;
    if (client && scope) {
      client
        .workflowRunList(scope)
        .then((res) => {
          if (res.error) throw new Error(res.error);
          if (isMounted) setRawRuns(res.runs);
          return null;
        })
        .catch((err) => {
          if (isMounted) setError(err instanceof Error ? err.message : String(err));
        });
    } else {
      setRawRuns(null);
    }
    return () => {
      isMounted = false;
    };
  }, [client, scope]);

  useEffect(() => {
    let isMounted = true;
    if (client && scope && selectedRunId) {
      setDetail(null);
      client
        .workflowRunInspect({ ...scope, runId: selectedRunId })
        .then(async (res) => {
          if (isMounted) setDetail(res.run);
          const approvalRes = await client.workflowApprovalList({ ...scope, runId: selectedRunId });
          if (approvalRes.error) throw new Error(approvalRes.error);
          if (isMounted) setApprovals(approvalRes.approvals);
          return null;
        })
        .catch((err) => {
          if (isMounted) setError(err instanceof Error ? err.message : String(err));
        });
    } else {
      setDetail(null);
      setApprovals([]);
    }
    return () => {
      isMounted = false;
    };
  }, [client, scope, selectedRunId]);

  const cancelRun = useCallback(
    async (runId: string) => {
      if (!client || !scope) return;
      setIsActionPending(true);
      setActionError(null);
      try {
        const response = await client.workflowRunCancel({ ...scope, runId });
        if (response.error) throw new Error(response.error);
        setActionSuccess("Workflow cancelled successfully");
        await fetchRuns();
        if (selectedRunId === runId) {
          await reloadDetail(runId);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to cancel run");
      } finally {
        setIsActionPending(false);
      }
    },
    [client, scope, fetchRuns, selectedRunId, reloadDetail],
  );

  const approveRun = useCallback(
    async (runId: string, approvalId: string) => {
      if (!client || !scope) return;
      setIsActionPending(true);
      setActionError(null);
      try {
        const response = await client.workflowApprovalApprove({ ...scope, runId, approvalId });
        if (response.error) throw new Error(response.error);
        setActionSuccess("Step approved and resumed");
        await fetchRuns();
        if (selectedRunId === runId) {
          await reloadDetail(runId);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to approve step");
      } finally {
        setIsActionPending(false);
      }
    },
    [client, scope, fetchRuns, selectedRunId, reloadDetail],
  );

  const denyRun = useCallback(
    async (runId: string, approvalId: string, reason?: string) => {
      if (!client || !scope) return;
      setIsActionPending(true);
      setActionError(null);
      try {
        const response = await client.workflowApprovalDeny({
          ...scope,
          runId,
          approvalId,
          ...(reason ? { reason } : {}),
        });
        if (response.error) throw new Error(response.error);
        setActionSuccess("Step denied");
        await fetchRuns();
        if (selectedRunId === runId) {
          await reloadDetail(runId);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to deny step");
      } finally {
        setIsActionPending(false);
      }
    },
    [client, scope, fetchRuns, selectedRunId, reloadDetail],
  );

  const retryRun = useCallback(
    async (runId: string, stepId: string) => {
      if (!client || !scope) return;
      setIsActionPending(true);
      setActionError(null);
      try {
        const response = await client.workflowRunRetry({ ...scope, runId, stepId });
        if (response.error) throw new Error(response.error);
        setActionSuccess("Step retried");
        await fetchRuns();
        if (selectedRunId === runId) {
          await reloadDetail(runId);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to retry step");
      } finally {
        setIsActionPending(false);
      }
    },
    [client, scope, fetchRuns, selectedRunId, reloadDetail],
  );

  const resumeRun = useCallback(
    async (runId: string) => {
      if (!client || !scope) return;
      setIsActionPending(true);
      setActionError(null);
      try {
        const response = await client.workflowRunResume({ ...scope, runId });
        if (response.error) throw new Error(response.error);
        setActionSuccess("Workflow resumed");
        await fetchRuns();
        if (selectedRunId === runId) {
          await reloadDetail(runId);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to resume run");
      } finally {
        setIsActionPending(false);
      }
    },
    [client, scope, fetchRuns, selectedRunId, reloadDetail],
  );

  return {
    runs,
    isLoading,
    isActionPending,
    error,
    actionError,
    actionSuccess,
    selectedRunId,
    setSelectedRunId,
    detail,
    approvals,
    cancelRun,
    approveRun,
    denyRun,
    retryRun,
    resumeRun,
    fetchRuns,
  };
}

const ThemedActivity = withUnistyles(Activity);

export const workflowRunsPanelPresentation = {
  label: (t) => t("panels.workflowRuns.label", "Workflow Runs"),
  subtitle: (t) => t("panels.workflowRuns.subtitle", "Workspace"),
  tooltip: (t) => t("panels.workflowRuns.label", "Workflow Runs"),
  icon: ThemedActivity,
} satisfies PanelPresentation;

function useWorkflowRunsPanelDescriptor(): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: workflowRunsPanelPresentation.label(t),
    subtitle: workflowRunsPanelPresentation.subtitle(t),
    tooltip: workflowRunsPanelPresentation.tooltip(t),
    titleState: "ready",
    icon: workflowRunsPanelPresentation.icon,
    statusBucket: null,
  };
}

interface RunRowProps {
  run: WorkflowRunSummary;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

function RunRow({ run, isSelected, onSelect }: RunRowProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const handlePress = useCallback(() => {
    onSelect(run.runId);
  }, [onSelect, run.runId]);

  const containerStyle = useMemo(
    () => [
      styles.runRow,
      isSelected ? styles.runRowSelected : null,
      isHovered && !isSelected ? styles.runRowHovered : null,
    ],
    [isSelected, isHovered],
  );

  const statusVariant = useMemo(() => resolveStatusVariant(run.status), [run.status]);

  const displayStatus = useMemo(() => {
    if (run.status === "waiting_approval") return "Awaiting Approval";
    return run.status.charAt(0).toUpperCase() + run.status.slice(1);
  }, [run.status]);

  return (
    <View
      style={styles.runRowWrapper}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable onPress={handlePress} style={containerStyle}>
        <View style={styles.runRowMain}>
          <Text style={styles.runName}>{run.name}</Text>
          <StatusBadge variant={statusVariant} label={displayStatus} />
        </View>
      </Pressable>
    </View>
  );
}

interface StepCardItemProps {
  step: WorkflowRunDetail["stepAttempts"][number];
  index: number;
  isActionPending: boolean;
  onApprove: (stepId: string) => void;
  onDeny: (stepId: string) => void;
  onRetry: (stepId: string) => void;
}

const StepCardItem = React.memo(function StepCardItem({
  step,
  index,
  isActionPending,
  onApprove,
  onDeny,
  onRetry,
}: StepCardItemProps) {
  const handleApprove = useCallback(() => onApprove(step.stepId), [onApprove, step.stepId]);
  const handleDeny = useCallback(() => onDeny(step.stepId), [onDeny, step.stepId]);
  const handleRetry = useCallback(() => onRetry(step.stepId), [onRetry, step.stepId]);

  const isBlocking =
    step.status === "waiting_approval" || step.status === "failed" || step.status === "running";
  const stepVariant = resolveStatusVariant(step.status);

  return (
    <View
      style={[
        styles.stepCard,
        isBlocking ? styles.stepCardBlocking : null,
        index > 0 ? styles.stepIndented : null,
      ]}
    >
      <View style={styles.stepHeader}>
        <View style={styles.stepTitleRow}>
          <Text style={styles.stepNumber}>{index + 1}.</Text>
          <Text style={styles.stepName}>{step.stepId}</Text>
          <Text style={styles.stepAttempt}>Attempt #{step.attempt}</Text>
        </View>
        <StatusBadge variant={stepVariant} label={step.status} />
      </View>

      {step.failureReason ? (
        <Text style={styles.stepFailureText}>Reason: {step.failureReason}</Text>
      ) : null}
      {step.skipReason ? <Text style={styles.stepSkipText}>Skipped: {step.skipReason}</Text> : null}

      <View style={styles.stepActionsRow}>
        {step.status === "waiting_approval" && (
          <>
            <Button variant="default" onPress={handleApprove} disabled={isActionPending}>
              Approve
            </Button>
            <Button variant="destructive" onPress={handleDeny} disabled={isActionPending}>
              Deny
            </Button>
          </>
        )}
        {step.status === "failed" && (
          <Button variant="secondary" onPress={handleRetry} disabled={isActionPending}>
            Retry Step
          </Button>
        )}
      </View>
    </View>
  );
});

export function WorkflowRunsContent({
  serverId,
  workspaceId,
  injectedClient,
}: {
  serverId: string;
  workspaceId: string;
  injectedClient?: WorkflowEngineClient;
}) {
  const baseClient = useHostRuntimeClient(serverId);
  const workflowClient = injectedClient ?? (isWorkflowEngineClient(baseClient) ? baseClient : null);
  const projectId = useSessionStore(
    (state) => state.sessions[serverId]?.workspaces?.get(workspaceId)?.projectId ?? null,
  );
  const workflowScope = useMemo(
    () => (projectId ? { projectId, workspaceId } : null),
    [projectId, workspaceId],
  );

  const supportsWorkflowEngine = useSessionStore((state) => {
    const serverInfo = state.sessions[serverId]?.serverInfo;
    if (!serverInfo || !serverInfo.features) return false;
    return (
      "workflowEngine" in serverInfo.features &&
      (serverInfo.features as { workflowEngine?: boolean }).workflowEngine === true
    );
  });

  const {
    runs,
    error,
    actionError,
    actionSuccess,
    isActionPending,
    selectedRunId,
    setSelectedRunId,
    detail,
    approvals,
    cancelRun,
    approveRun,
    denyRun,
    retryRun,
    resumeRun,
  } = useWorkflowRuns(workflowClient, workflowScope);

  const isCompact = useIsCompactFormFactor();

  const handleClearSelection = useCallback(() => {
    setSelectedRunId(null);
  }, [setSelectedRunId]);

  const handleCancelRun = useCallback(async () => {
    if (!detail) return;
    const confirmed = await confirmDialog({
      title: "Cancel Workflow",
      message: "Are you sure you want to cancel this run? Unstarted steps will be prevented.",
      confirmLabel: "Cancel Run",
      cancelLabel: "Keep Running",
      destructive: true,
    });
    if (confirmed) {
      void cancelRun(detail.runId);
    }
  }, [detail, cancelRun]);

  const handleApproveStep = useCallback(
    async (stepId: string) => {
      if (!detail) return;
      const confirmed = await confirmDialog({
        title: "Approve External Action",
        message: `Are you sure you want to approve step "${stepId}"? This will execute external side effects.`,
        confirmLabel: "Approve",
        cancelLabel: "Cancel",
        destructive: false,
      });
      if (confirmed) {
        const approval = approvals.find(
          (candidate) => candidate.stepId === stepId && candidate.status === "pending",
        );
        if (!approval) return;
        void approveRun(detail.runId, approval.approvalId);
      }
    },
    [detail, approvals, approveRun],
  );

  const handleDenyStep = useCallback(
    async (stepId: string) => {
      if (!detail) return;
      const confirmed = await confirmDialog({
        title: "Deny Step",
        message: `Are you sure you want to deny step "${stepId}"?`,
        confirmLabel: "Deny",
        cancelLabel: "Keep Waiting",
        destructive: true,
      });
      if (confirmed) {
        const approval = approvals.find(
          (candidate) => candidate.stepId === stepId && candidate.status === "pending",
        );
        if (!approval) return;
        void denyRun(detail.runId, approval.approvalId, "User denied");
      }
    },
    [detail, approvals, denyRun],
  );

  const handleRetryStep = useCallback(
    async (stepId: string) => {
      if (!detail) return;
      const confirmed = await confirmDialog({
        title: "Retry Step",
        message: `Retry step "${stepId}"? A new attempt will be created.`,
        confirmLabel: "Retry",
        cancelLabel: "Cancel",
        destructive: false,
      });
      if (confirmed) {
        void retryRun(detail.runId, stepId);
      }
    },
    [detail, retryRun],
  );

  const handleResumeRun = useCallback(async () => {
    if (!detail) return;
    void resumeRun(detail.runId);
  }, [detail, resumeRun]);

  if (!supportsWorkflowEngine) {
    return (
      <View style={styles.container}>
        <View style={styles.contentContainer}>
          <Alert
            variant="warning"
            title="Feature Not Supported"
            description="The workflow engine feature is not supported by the current host daemon."
          />
        </View>
      </View>
    );
  }

  if (!workflowClient) {
    return (
      <View style={styles.container}>
        <View style={styles.contentContainer}>
          <Alert
            variant="info"
            title="API Not Ready"
            description="The workflow engine client API is not yet available."
          />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.contentContainer}>
          <Alert variant="error" title="Workflow Error" description={error} />
        </View>
      </View>
    );
  }

  const renderList = () => {
    if (!runs) {
      return (
        <View style={styles.centerContainer}>
          <ThemedLoadingSpinner size="large" uniProps={foregroundColorMapping} />
        </View>
      );
    }

    if (runs.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>No workflow runs found.</Text>
        </View>
      );
    }

    return (
      <ScrollView style={styles.listContainer}>
        {runs.map((run) => (
          <RunRow
            key={run.runId}
            run={run}
            isSelected={selectedRunId === run.runId}
            onSelect={setSelectedRunId}
          />
        ))}
      </ScrollView>
    );
  };

  const renderDetail = () => {
    if (!selectedRunId) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>Select a workflow run to view details</Text>
        </View>
      );
    }

    if (!detail) {
      return (
        <View style={styles.centerContainer}>
          <ThemedLoadingSpinner size="large" uniProps={foregroundColorMapping} />
        </View>
      );
    }

    const statusVariant = resolveStatusVariant(detail.status);
    const displayStatus =
      detail.status === "waiting_approval"
        ? "Awaiting Approval"
        : detail.status.charAt(0).toUpperCase() + detail.status.slice(1);

    return (
      <View style={styles.detailContainer}>
        <View style={styles.detailHeader}>
          <ScreenTitle>{detail.name}</ScreenTitle>
          <View style={styles.detailHeaderRight}>
            <StatusBadge variant={statusVariant} label={displayStatus} />
            {(detail.status === "running" || detail.status === "waiting_approval") && (
              <Button variant="secondary" onPress={handleCancelRun} disabled={isActionPending}>
                Cancel Run
              </Button>
            )}
            {(detail.status === "blocked" || detail.status === "cancelled") && (
              <Button variant="secondary" onPress={handleResumeRun} disabled={isActionPending}>
                Resume Run
              </Button>
            )}
          </View>
        </View>

        {actionError && <Alert variant="error" title="Action Failed" description={actionError} />}
        {actionSuccess && <Alert variant="success" title="Success" description={actionSuccess} />}

        {/* Vertical Stepper / Indented DAG */}
        <ScrollView style={styles.stepperContainer}>
          <Text style={styles.stepperHeading}>DAG Execution Steps</Text>
          {detail.stepAttempts.map((step, index) => (
            <StepCardItem
              key={`${step.stepId}-${step.attempt}`}
              step={step}
              index={index}
              isActionPending={isActionPending}
              onApprove={handleApproveStep}
              onDeny={handleDenyStep}
              onRetry={handleRetryStep}
            />
          ))}
        </ScrollView>
      </View>
    );
  };

  if (isCompact) {
    if (selectedRunId) {
      return (
        <View style={styles.container}>
          <View style={styles.compactHeader}>
            <Button variant="ghost" onPress={handleClearSelection}>
              Back to List
            </Button>
          </View>
          {renderDetail()}
        </View>
      );
    }
    return (
      <View style={styles.container}>
        <View style={styles.compactHeader}>
          <ScreenTitle>Workflow Runs</ScreenTitle>
        </View>
        {renderList()}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.splitContainer}>
        <View style={styles.leftPane}>
          <View style={styles.compactHeader}>
            <ScreenTitle>Workflow Runs</ScreenTitle>
          </View>
          {renderList()}
        </View>
        <View style={styles.rightPane}>{renderDetail()}</View>
      </View>
    </View>
  );
}

function WorkflowRunsPanel() {
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "workflow_runs", "WorkflowRunsPanel requires workflow_runs target");

  return <WorkflowRunsContent serverId={serverId} workspaceId={workspaceId} />;
}

export const workflowRunsPanelRegistration = definePanel("workflow_runs", {
  component: WorkflowRunsPanel,
  presentation: workflowRunsPanelPresentation,
  useDescriptor: useWorkflowRunsPanelDescriptor,
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  contentContainer: {
    padding: theme.spacing[4],
    flexGrow: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  splitContainer: {
    flex: 1,
    flexDirection: "row",
  },
  leftPane: {
    width: 320,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
  },
  rightPane: {
    flex: 1,
  },
  listContainer: {
    flex: 1,
  },
  compactHeader: {
    padding: theme.spacing[4],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  runRowWrapper: {
    position: "relative",
    minHeight: 48,
  },
  runRow: {
    padding: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  runRowSelected: {
    backgroundColor: theme.colors.surface2,
  },
  runRowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  runRowMain: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  runName: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  emptyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  detailContainer: {
    flex: 1,
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  detailHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  stepperContainer: {
    flex: 1,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
  },
  stepperHeading: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.foregroundMuted,
    marginBottom: theme.spacing[3],
    textTransform: "uppercase",
  },
  stepCard: {
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    marginBottom: theme.spacing[3],
    gap: theme.spacing[2],
  },
  stepCardBlocking: {
    borderColor: theme.colors.accent,
    borderWidth: theme.borderWidth[2],
  },
  stepIndented: {
    marginLeft: theme.spacing[4],
    borderLeftWidth: theme.borderWidth[2],
    borderLeftColor: theme.colors.accent,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  stepNumber: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  stepName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  stepAttempt: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  stepFailureText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusDanger,
  },
  stepSkipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontStyle: "italic",
  },
  stepActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
}));
