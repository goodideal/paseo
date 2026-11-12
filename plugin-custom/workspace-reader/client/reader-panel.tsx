import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import type { PluginTheme, PluginAgentSnapshot } from "@getpaseo/plugin";
import { useAgent, useAgents, usePaseo, useRpc, useSubscription } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import {
  getWorkspaceDigestRpc,
  subscribeWorkspaceDigest,
  type AgentMilestoneRecord,
  type OverallEvolutionStatus,
  type WorkspaceEvolutionDigest,
} from "../shared/contracts.js";

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function statusBadgeConfig(status: OverallEvolutionStatus, theme: PluginTheme) {
  switch (status) {
    case "in_progress":
      return { label: "推进中 (In Progress)", color: theme.colors.accent };
    case "ready_for_review":
      return { label: "待合流 (Ready for PR)", color: theme.colors.statusSuccess };
    case "blocked":
      return { label: "受阻 (Blocked)", color: theme.colors.statusDanger };
    case "completed":
    default:
      return { label: "已完成 (Completed)", color: theme.colors.statusSuccess };
  }
}

function SubagentSection({
  parentAgentId,
  theme,
  onOpenAgent,
}: {
  parentAgentId: string;
  theme: PluginTheme;
  onOpenAgent?: (agentId: string) => void;
}) {
  const paseo = usePaseo();
  const agentRefs = useAgents();
  const [subagents, setSubagents] = useState<any[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryPrompt, setRetryPrompt] = useState(
    "请分析刚才执行失败的原因，调整方案并重新尝试完成任务。",
  );

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
            .filter((a: any) => a.parentAgentId === parentAgentId);
          setSubagents(list);
        })
        .catch(() => {});
    }
    return () => {
      mounted = false;
    };
  }, [paseo, parentAgentId, agentRefs.length]);

  if (subagents.length === 0) return null;

  const runningCount = subagents.filter((s: any) => s.status === "running").length;
  const errorCount = subagents.filter(
    (s: any) => s.status === "error" || s.requiresAttention,
  ).length;
  const completedCount = subagents.length - runningCount - errorCount;

  const summary = `子任务流 (${subagents.length})${
    runningCount > 0 ? ` · ${runningCount} 执行中` : ""
  }${errorCount > 0 ? ` · ${errorCount} 异常` : ""}${
    completedCount > 0 ? ` · ${completedCount} 已完成` : ""
  }`;

  const handleBulkArchive = async () => {
    for (const sub of subagents) {
      if (sub.status !== "running") {
        await paseo.agents
          .ref(sub.id)
          .archive()
          .catch(() => undefined);
      }
    }
  };

  return (
    <View
      style={{
        marginTop: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 6,
        overflow: "hidden",
        backgroundColor: theme.colors.surface0,
      }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => setExpanded((prev) => !prev)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: theme.colors.surface1,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
          <Icon name="Layers" size={13} color={theme.colors.foregroundMuted} />
          <Text style={{ fontSize: 12, fontWeight: "500", color: theme.colors.foregroundMuted }}>
            {summary}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {completedCount > 1 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleBulkArchive()}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 4,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Icon name="Archive" size={11} color={theme.colors.foregroundMuted} />
              <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>
                一键清理已完成
              </Text>
            </Pressable>
          ) : null}
          <Icon
            name={expanded ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={theme.colors.foregroundMuted}
          />
        </View>
      </Pressable>

      {expanded ? (
        <View style={{ padding: 8, gap: 6 }}>
          {subagents.map((sub: any) => {
            const isRunning = sub.status === "running";
            const isError = sub.status === "error";
            const elapsedMs = Math.max(0, Date.now() - new Date(sub.createdAt).getTime());
            return (
              <View key={sub.id} style={{ gap: 4 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onOpenAgent?.(sub.id)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 6,
                    paddingHorizontal: 8,
                    borderRadius: 6,
                    backgroundColor: theme.colors.surface1,
                    gap: 8,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                    <Icon name="Bot" size={13} color={theme.colors.foregroundMuted} />
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 12, color: theme.colors.foreground, flex: 1 }}
                    >
                      {sub.title || sub.provider}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>
                      {formatDuration(elapsedMs)}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "600",
                        color: isRunning
                          ? theme.colors.accent
                          : isError
                            ? theme.colors.statusDanger
                            : theme.colors.statusSuccess,
                      }}
                    >
                      {isRunning ? "执行中" : isError ? "异常" : "已完成"}
                    </Text>
                    {isError ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setRetryingId((cur) => (cur === sub.id ? null : sub.id))}
                      >
                        <Icon name="RefreshCw" size={12} color={theme.colors.accent} />
                      </Pressable>
                    ) : null}
                    {!isRunning ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void paseo.agents.ref(sub.id).archive()}
                      >
                        <Icon name="Archive" size={12} color={theme.colors.foregroundMuted} />
                      </Pressable>
                    ) : null}
                  </View>
                </Pressable>

                {retryingId === sub.id ? (
                  <View
                    style={{
                      padding: 8,
                      borderRadius: 6,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      gap: 6,
                    }}
                  >
                    <TextInput
                      value={retryPrompt}
                      onChangeText={setRetryPrompt}
                      multiline
                      style={{
                        fontSize: 12,
                        color: theme.colors.foreground,
                        backgroundColor: theme.colors.surface1,
                        padding: 6,
                        borderRadius: 4,
                        minHeight: 40,
                      }}
                    />
                    <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setRetryingId(null)}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: 4,
                          backgroundColor: theme.colors.surface3,
                        }}
                      >
                        <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>
                          取消
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          void paseo.agents.ref(sub.id).send(retryPrompt);
                          setRetryingId(null);
                        }}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: 4,
                          backgroundColor: theme.colors.accent,
                        }}
                      >
                        <Text style={{ fontSize: 11, color: theme.colors.accentForeground }}>
                          确认重试
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function MilestoneCardView({
  milestone,
  stageNum,
  isTopActive,
  theme,
  onOpenAgent,
}: {
  milestone: AgentMilestoneRecord;
  stageNum: number;
  isTopActive: boolean;
  theme: PluginTheme;
  onOpenAgent?: (agentId: string) => void;
}) {
  const statusIcon =
    milestone.status === "running"
      ? "Loader"
      : milestone.status === "error"
        ? "CircleAlert"
        : "CircleCheck";
  const statusColor =
    milestone.status === "running"
      ? theme.colors.accent
      : milestone.status === "error"
        ? theme.colors.statusDanger
        : theme.colors.statusSuccess;

  const stageStatusText = isTopActive
    ? "当前推进中 (执行中)"
    : milestone.status === "running"
      ? "执行中"
      : "已完成";

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface0,
        borderRadius: 8,
        borderWidth: isTopActive ? 1.5 : 1,
        borderColor: isTopActive ? theme.colors.accent : theme.colors.border,
        padding: 12,
        gap: 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name={statusIcon} size={15} color={statusColor} />
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              color: isTopActive ? theme.colors.accent : theme.colors.foreground,
            }}
          >
            阶段 {stageNum}: {stageStatusText}
          </Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 4,
              backgroundColor: theme.colors.surface1,
            }}
          >
            <Icon name="Bot" size={12} color={theme.colors.foregroundMuted} />
            <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
              {milestone.provider}
              {milestone.model ? ` (${milestone.model})` : ""}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name="Clock" size={12} color={theme.colors.foregroundMuted} />
            <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
              {formatDuration(milestone.durationMs)}
            </Text>
          </View>
        </View>
      </View>

      <View
        style={{
          backgroundColor: theme.colors.surface1,
          padding: 8,
          borderRadius: 6,
          gap: 2,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: "500", color: theme.colors.foregroundMuted }}>
          目标意图
        </Text>
        <Text style={{ fontSize: 13, color: theme.colors.foreground }}>
          {milestone.intentPrompt}
        </Text>
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 12, fontWeight: "500", color: theme.colors.foregroundMuted }}>
          阶段纪要与关键决策
        </Text>
        <Text style={{ fontSize: 13, color: theme.colors.foreground, lineHeight: 18 }}>
          {milestone.executiveSummary}
        </Text>
        {milestone.keyDecisions.map((decision) => (
          <View
            key={`${milestone.agentId}-${decision}`}
            style={{ flexDirection: "row", gap: 4, paddingLeft: 4 }}
          >
            <Text style={{ fontSize: 13, color: theme.colors.foregroundMuted }}>•</Text>
            <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted, flex: 1 }}>
              {decision}
            </Text>
          </View>
        ))}
      </View>

      <SubagentSection parentAgentId={milestone.agentId} theme={theme} onOpenAgent={onOpenAgent} />

      {onOpenAgent ? (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingTop: 2 }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpenAgent(milestone.agentId)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingVertical: 2,
              paddingHorizontal: 6,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "500", color: theme.colors.accent }}>
              查看原始会话
            </Text>
            <Icon name="ArrowRight" size={12} color={theme.colors.accent} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function ReaderPanelView({
  workspaceId,
  theme,
  onOpenAgent,
}: {
  workspaceId: string;
  theme: PluginTheme;
  onOpenAgent?: (agentId: string) => void;
}) {
  const fetchDigestRpc = useRpc(getWorkspaceDigestRpc);
  const [digest, setDigest] = useState<WorkspaceEvolutionDigest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (forceRefresh: boolean) => {
      if (forceRefresh) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      try {
        const res = await fetchDigestRpc({ workspaceId, forceRefresh });
        if (res.error) {
          setError(res.error);
        } else {
          setDigest(res.digest);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [fetchDigestRpc, workspaceId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const subInput = useMemo(() => ({ workspaceId }), [workspaceId]);
  useSubscription(subscribeWorkspaceDigest, subInput, (event) => {
    if (event.workspaceId === workspaceId) {
      setDigest(event.digest);
    }
  });

  if (isLoading && !digest) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.surface0,
          padding: 24,
        }}
      >
        <Text style={{ fontSize: 13, color: theme.colors.foregroundMuted }}>
          正在分析工作区演进脉络...
        </Text>
      </View>
    );
  }

  if (error && !digest) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.surface0,
          padding: 24,
          gap: 8,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.statusDanger }}>
          加载演进大盘失败
        </Text>
        <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted, textAlign: "center" }}>
          {error}
        </Text>
      </View>
    );
  }

  const workspaceTitle = digest?.workspaceTitle || workspaceId;
  const branch = digest?.branch || "main";
  const summary = digest?.executiveSummary || "暂无演进纪要。";
  const currentStage = digest?.currentStage || "初始阶段";
  const overallStatus = digest?.overallStatus || "completed";
  const milestones = digest?.milestones || [];
  const badge = statusBadgeConfig(overallStatus, theme);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.surface0,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
          <Icon name="BookOpen" size={18} color={theme.colors.accent} />
          <Text
            numberOfLines={1}
            style={{ fontSize: 16, fontWeight: "600", color: theme.colors.foreground }}
          >
            {workspaceTitle}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 6,
              backgroundColor: theme.colors.surface1,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Icon name="GitBranch" size={12} color={theme.colors.foregroundMuted} />
            <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>{branch}</Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={isRefreshing}
          onPress={() => void load(true)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface1,
          }}
        >
          <Icon name="RefreshCw" size={13} color={theme.colors.foregroundMuted} />
          <Text style={{ fontSize: 12, fontWeight: "500", color: theme.colors.foregroundMuted }}>
            {isRefreshing ? "提炼中..." : "重新提炼"}
          </Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Executive Summary Card */}
        <View
          style={{
            margin: 16,
            padding: 16,
            backgroundColor: theme.colors.surface1,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: theme.colors.border,
            gap: 12,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name="Sparkles" size={16} color={theme.colors.accent} />
              <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.foreground }}>
                工作区演进综述
              </Text>
            </View>
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: badge.color,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "500", color: badge.color }}>
                {badge.label}
              </Text>
            </View>
          </View>

          <Text style={{ fontSize: 13, color: theme.colors.foreground, lineHeight: 20 }}>
            {summary}
          </Text>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 16,
              paddingTop: 8,
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon name="Layers" size={13} color={theme.colors.foregroundMuted} />
              <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>阶段总数:</Text>
              <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foreground }}>
                {milestones.length}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon name="Activity" size={13} color={theme.colors.foregroundMuted} />
              <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>当前节点:</Text>
              <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foreground }}>
                {currentStage}
              </Text>
            </View>
          </View>
        </View>

        {/* Timeline */}
        {milestones.length === 0 ? (
          <View style={{ padding: 32, alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: "500", color: theme.colors.foreground }}>
              暂无智能体演进记录
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: theme.colors.foregroundMuted,
                textAlign: "center",
                maxWidth: 320,
              }}
            >
              当在本工作区创建或运行智能体时，演进脉络将自动汇聚在此。
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.foreground }}>
              任务与演进脉络流
            </Text>
            <View>
              {milestones.map((milestone, idx) => {
                const isLast = idx === milestones.length - 1;
                const isRunning = milestone.status === "running";
                const isTopActive = idx === 0 && isRunning;
                return (
                  <View key={milestone.agentId} style={{ flexDirection: "row", gap: 12 }}>
                    <View style={{ alignItems: "center", width: 16 }}>
                      <View
                        style={{
                          width: isTopActive ? 12 : 10,
                          height: isTopActive ? 12 : 10,
                          borderRadius: 6,
                          marginTop: 14,
                          backgroundColor: isRunning
                            ? theme.colors.accent
                            : theme.colors.statusSuccess,
                        }}
                      />
                      {!isLast ? (
                        <View
                          style={{
                            flex: 1,
                            width: 2,
                            backgroundColor: theme.colors.border,
                            marginVertical: 4,
                          }}
                        />
                      ) : null}
                    </View>
                    <View style={{ flex: 1, paddingBottom: 16 }}>
                      <MilestoneCardView
                        milestone={milestone}
                        stageNum={milestones.length - idx}
                        isTopActive={isTopActive}
                        theme={theme}
                        onOpenAgent={onOpenAgent}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
