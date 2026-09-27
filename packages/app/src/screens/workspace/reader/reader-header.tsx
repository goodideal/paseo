import { View, Text, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { GitBranch, RefreshCw, BookOpen } from "lucide-react-native";

interface ReaderHeaderProps {
  workspaceTitle: string;
  branch: string;
  isAnalyzing?: boolean;
  onRefresh: () => void;
}

export function ReaderHeader({
  workspaceTitle,
  branch,
  isAnalyzing,
  onRefresh,
}: ReaderHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <View style={styles.titleIconWrap}>
          <BookOpen size={18} color="#3b82f6" />
        </View>
        <Text style={styles.title}>{workspaceTitle}</Text>
        <View style={styles.badge}>
          <GitBranch size={12} color="#6b7280" />
          <Text style={styles.badgeText}>{branch}</Text>
        </View>
      </View>

      <Pressable style={styles.refreshButton} onPress={onRefresh} disabled={isAnalyzing}>
        <RefreshCw size={14} color="#6b7280" />
        <Text style={styles.refreshText}>{isAnalyzing ? "提炼中..." : "重新提炼"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  titleIconWrap: {
    padding: theme.spacing[1],
  },
  title: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  badgeText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  refreshText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.medium,
  },
}));
