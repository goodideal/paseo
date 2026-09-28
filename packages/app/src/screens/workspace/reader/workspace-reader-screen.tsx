import { View, Text, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useWorkspaceEvolution } from "@/hooks/use-workspace-evolution";
import { ReaderHeader } from "./reader-header";
import { ExecutiveSummaryCard } from "./executive-summary-card";
import { EvolutionTimeline } from "./evolution-timeline";

export interface WorkspaceReaderScreenProps {
  serverId?: string | null;
  workspaceId: string;
  onNavigateToAgent?: (agentId: string) => void;
}

export function WorkspaceReaderScreen({
  serverId,
  workspaceId,
  onNavigateToAgent,
}: WorkspaceReaderScreenProps) {
  const { digest, isLoading, isAnalyzing, error, refresh } = useWorkspaceEvolution({
    serverId,
    workspaceId,
  });

  if (isLoading && !digest) {
    return (
      <View style={styles.centerContainer}>
        <LoadingSpinner size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>正在分析工作区演进脉络...</Text>
      </View>
    );
  }

  if (error && !digest) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorTitle}>加载演进大盘失败</Text>
        <Text style={styles.errorSubtitle}>{error}</Text>
      </View>
    );
  }

  const workspaceTitle = digest?.workspaceTitle || workspaceId;
  const branch = digest?.branch || "main";
  const summary = digest?.executiveSummary || "暂无演进纪要。";
  const currentStage = digest?.currentStage || "初始阶段";
  const overallStatus = digest?.overallStatus || "completed";
  const milestones = digest?.milestones || [];

  return (
    <View style={styles.container}>
      <ReaderHeader
        workspaceTitle={workspaceTitle}
        branch={branch}
        isAnalyzing={isAnalyzing}
        onRefresh={refresh}
      />

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        <ExecutiveSummaryCard
          summary={summary}
          currentStage={currentStage}
          overallStatus={overallStatus}
          milestoneCount={milestones.length}
        />

        <EvolutionTimeline
          milestones={milestones}
          serverId={serverId}
          onNavigateToAgent={onNavigateToAgent}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface0,
  },
  loadingText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  errorTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.statusDanger,
  },
  errorSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    maxWidth: 300,
  },
}));
