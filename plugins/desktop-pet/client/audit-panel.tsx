import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet } from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { getAuditLogsRpc, markAuditReviewedRpc } from "../shared/contracts.js";
import type { AuditRecord } from "../shared/types.js";

export function AuditPanel({ theme }: PluginSurfaceProps) {
  const getLogs = useRpc(getAuditLogsRpc);
  const markReviewed = useRpc(markAuditReviewedRpc);
  const [logs, setLogs] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLogs({ limit: 50 });
      setLogs(res.records);
    } catch (err) {
      console.error("[desktop-pet] Failed to fetch audit logs:", err);
    } finally {
      setLoading(false);
    }
  }, [getLogs]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const handleReview = async (id: string) => {
    try {
      await markReviewed({ id });
      setLogs((prev) =>
        prev.map((log) => (log.id === id ? { ...log, reviewedByHuman: true } : log)),
      );
    } catch (err) {
      console.error("[desktop-pet] Failed to mark reviewed:", err);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: theme.colors.foreground }]}>
        🐾 Desktop Pet AI Decision Audit Log
      </Text>
      {loading ? (
        <Text style={{ color: theme.colors.foregroundMuted, textAlign: "center", marginTop: 24 }}>
          Loading records...
        </Text>
      ) : logs.length === 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted, textAlign: "center", marginTop: 24 }}>
          No audit records yet. All safe!
        </Text>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={item.decision === "ALLOW" ? styles.allowBadge : styles.denyBadge}>
                  {item.decision}
                </Text>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                  {item.timestamp.slice(11, 19)}
                </Text>
              </View>
              <Text style={[styles.taskTitle, { color: theme.colors.foreground }]}>
                {item.taskTitle}
              </Text>
              <Text style={styles.code}>{item.requestedAction}</Text>
              <Text style={[styles.reason, { color: theme.colors.foregroundMuted }]}>
                {item.aiReason}
              </Text>
              {!item.reviewedByHuman && (
                <Pressable style={styles.reviewBtn} onPress={() => handleReview(item.id)}>
                  <Text style={styles.btnText}>Mark Acknowledged</Text>
                </Pressable>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 18, fontWeight: "bold", marginBottom: 12 },
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  allowBadge: { color: "#4ADE80", fontWeight: "bold", fontSize: 12 },
  denyBadge: { color: "#F87171", fontWeight: "bold", fontSize: 12 },
  taskTitle: { fontWeight: "600", fontSize: 14, marginBottom: 4 },
  code: {
    fontFamily: "monospace",
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    color: "#DDD",
    padding: 6,
    borderRadius: 4,
    fontSize: 12,
    marginBottom: 6,
  },
  reason: { fontSize: 12, marginBottom: 6 },
  reviewBtn: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  btnText: { color: "#FFF", fontSize: 11 },
});
