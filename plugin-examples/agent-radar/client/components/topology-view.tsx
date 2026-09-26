import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import type { AgentTopologyNode } from "../../shared/types.js";

interface TopologyViewProps {
  topology: {
    rootAgentId: string;
    nodes: Record<string, AgentTopologyNode>;
  };
  onSelectNode?: (agentId: string) => void;
  selectedNodeId?: string;
}

export function TopologyView({ topology, onSelectNode, selectedNodeId }: TopologyViewProps) {
  const rootNode = topology.nodes[topology.rootAgentId];

  const getStatusColor = (status: AgentTopologyNode["status"]) => {
    switch (status) {
      case "running":
        return "#198754";
      case "error":
        return "#dc3545";
      case "idle":
        return "#0d6efd";
      default:
        return "#6c757d";
    }
  };

  const renderNode = (nodeId: string, level = 0) => {
    const node = topology.nodes[nodeId];
    if (!node) return null;

    const isSelected = selectedNodeId === nodeId;
    const statusColor = getStatusColor(node.status);

    return (
      <View key={nodeId} style={{ marginLeft: level * 16 }}>
        <Pressable
          onPress={() => onSelectNode?.(nodeId)}
          style={[styles.nodeCard, isSelected && styles.nodeCardSelected]}
        >
          <View style={styles.nodeHeader}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={styles.nodeTitle} numberOfLines={1}>
              {node.title}
            </Text>
            <Text style={styles.nodeStatus}>{node.status}</Text>
          </View>

          {node.runningTool && (
            <View style={styles.toolRow}>
              <Text style={styles.toolLabel}>Tool:</Text>
              <Text style={styles.toolName} numberOfLines={1}>
                {node.runningTool}
              </Text>
              {node.durationMs > 0 && (
                <Text style={styles.toolDuration}>({Math.round(node.durationMs / 1000)}s)</Text>
              )}
            </View>
          )}
        </Pressable>

        {node.childAgentIds.map((childId) => renderNode(childId, level + 1))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>🌐 Agent 派生与运行拓扑</Text>
      <View style={styles.treeContainer}>
        {rootNode ? (
          renderNode(topology.rootAgentId)
        ) : (
          <Text style={styles.emptyText}>无活跃 Agent 拓扑</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#212529",
    marginBottom: 10,
  },
  treeContainer: {
    gap: 8,
  },
  nodeCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dee2e6",
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
  },
  nodeCardSelected: {
    borderColor: "#0d6efd",
    backgroundColor: "#f8faff",
  },
  nodeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  nodeTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#212529",
    flex: 1,
  },
  nodeStatus: {
    fontSize: 10,
    color: "#6c757d",
    textTransform: "uppercase",
  },
  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  toolLabel: {
    fontSize: 10,
    color: "#6c757d",
  },
  toolName: {
    fontSize: 10,
    fontFamily: "monospace",
    color: "#0a7ea4",
    flex: 1,
  },
  toolDuration: {
    fontSize: 10,
    color: "#dc3545",
    fontWeight: "500",
  },
  emptyText: {
    fontSize: 12,
    color: "#6c757d",
  },
});
