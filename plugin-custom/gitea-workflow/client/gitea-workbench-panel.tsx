import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { ReviewPanel } from "./review-panel.js";
import { WorkflowRunsPanelView } from "./workflow-runs-panel.js";

type WorkbenchTab = "dag" | "review";

/**
 * Unified Gitea Workflow panel combining DAG execution runs and review cards in one workspace surface.
 */
export function GiteaWorkbenchPanel(props: PluginWorkspacePanelProps) {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("dag");
  const { theme } = props;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => setActiveTab("dag")}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 6,
            backgroundColor: activeTab === "dag" ? theme.colors.accent : theme.colors.surface2,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color:
                activeTab === "dag" ? theme.colors.accentForeground : theme.colors.foregroundMuted,
            }}
          >
            DAG 工作流
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setActiveTab("review")}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 6,
            backgroundColor: activeTab === "review" ? theme.colors.accent : theme.colors.surface2,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color:
                activeTab === "review"
                  ? theme.colors.accentForeground
                  : theme.colors.foregroundMuted,
            }}
          >
            审查卡片
          </Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        {activeTab === "dag" ? <WorkflowRunsPanelView {...props} /> : <ReviewPanel {...props} />}
      </View>
    </View>
  );
}
