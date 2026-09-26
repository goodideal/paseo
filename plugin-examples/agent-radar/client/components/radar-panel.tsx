import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { radarGetSnapshotRpc } from "../../shared/rpc.js";
import type { RadarSnapshot } from "../../shared/types.js";
import { PipelineView } from "./pipeline-view.js";
import { TopologyView } from "./topology-view.js";
import { NodeInspector } from "./node-inspector.js";

export function RadarPanelHost(props: PluginAgentPanelProps) {
  const getSnapshot = useRpc(radarGetSnapshotRpc);
  const [snapshot, setSnapshot] = useState<RadarSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string>(props.agentId);
  const [activeTab, setActiveTab] = useState<"auto" | "pipeline" | "topology">("auto");

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      let interval = 3000;
      try {
        const res = await getSnapshot({ agentId: props.agentId });
        if (mounted) {
          setSnapshot(res);
          if (res.watchdog.activeHeartbeat || res.watchdog.activeBlocker) {
            interval = 1500;
          }
        }
      } catch {
        // Silent catch transient error
      }

      if (mounted) {
        timer = setTimeout(poll, interval);
      }
    };

    poll();

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [props.agentId, getSnapshot]);

  const showPipeline =
    activeTab === "pipeline" ||
    (activeTab === "auto" && snapshot?.mode === "superpower" && Boolean(snapshot.superpower));

  return (
    <ScrollView style={styles.container}>
      {/* Top Header Mode Bar */}
      <View style={styles.topBar}>
        <View style={styles.modeTag}>
          <Text style={styles.modeTagText}>
            {snapshot?.mode === "superpower" ? "⚡ Superpowers SDD 模式" : "🌐 通用拓扑模式"}
          </Text>
        </View>

        <View style={styles.tabButtons}>
          <Pressable
            onPress={() => setActiveTab("auto")}
            style={[styles.tabBtn, activeTab === "auto" && styles.tabBtnActive]}
          >
            <Text style={[styles.tabBtnText, activeTab === "auto" && styles.tabBtnTextActive]}>
              自动
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("pipeline")}
            style={[styles.tabBtn, activeTab === "pipeline" && styles.tabBtnActive]}
          >
            <Text style={[styles.tabBtnText, activeTab === "pipeline" && styles.tabBtnTextActive]}>
              流水线
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("topology")}
            style={[styles.tabBtn, activeTab === "topology" && styles.tabBtnActive]}
          >
            <Text style={[styles.tabBtnText, activeTab === "topology" && styles.tabBtnTextActive]}>
              拓扑树
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Main View Area */}
      {showPipeline && snapshot?.superpower && (
        <PipelineView
          superpower={snapshot.superpower}
          onSelectTask={(id) => setSelectedId(id)}
          selectedTaskId={selectedId}
        />
      )}

      {(!showPipeline || activeTab === "topology") && snapshot?.topology && (
        <TopologyView
          topology={snapshot.topology}
          onSelectNode={(id) => setSelectedId(id)}
          selectedNodeId={selectedId}
        />
      )}

      {/* Node Inspector & Watchdog In-situ Card */}
      {snapshot && (
        <NodeInspector
          agentId={selectedId}
          heartbeat={snapshot.watchdog.activeHeartbeat}
          blocker={snapshot.watchdog.activeBlocker}
          autoTurnCount={snapshot.watchdog.autoTurnCount}
          maxAutoTurns={snapshot.watchdog.maxAutoTurns}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 14,
    flex: 1,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e9ecef",
    paddingBottom: 8,
  },
  modeTag: {
    backgroundColor: "#e8f4fd",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  modeTagText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#0a7ea4",
  },
  tabButtons: {
    flexDirection: "row",
    gap: 4,
  },
  tabBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "#f1f3f5",
  },
  tabBtnActive: {
    backgroundColor: "#0d6efd",
  },
  tabBtnText: {
    fontSize: 11,
    color: "#495057",
  },
  tabBtnTextActive: {
    color: "#ffffff",
    fontWeight: "600",
  },
});
