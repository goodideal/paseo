import React, { useCallback, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import type { FixDirective, Severity } from "../../shared/types.js";
import { palette, styles } from "./styles.js";

function getDirectiveBadgeStyle(severity: Severity) {
  if (severity === "P0") return styles.badgeP0;
  if (severity === "P1") return styles.badgeP1;
  if (severity === "P2") return styles.badgeP2;
  return styles.badgeP3;
}

function getDirectiveBadgeTextStyle(severity: Severity) {
  if (severity === "P0") return styles.badgeTextP0;
  if (severity === "P1") return styles.badgeTextP1;
  if (severity === "P2") return styles.badgeTextP2;
  return styles.badgeTextP3;
}

const SEVERITIES = ["ALL", "P0", "P1", "P2", "P3"] as const;

interface SeverityFilterPillProps {
  severity: Severity | "ALL";
  isSelected: boolean;
  onSelect: (sev: Severity | "ALL") => void;
}

const SeverityFilterPill = React.memo(function SeverityFilterPill({
  severity,
  isSelected,
  onSelect,
}: SeverityFilterPillProps) {
  const handlePress = useCallback(() => onSelect(severity), [onSelect, severity]);
  const pillStyle = isSelected ? styles.statPillSelected : styles.statPill;
  const textStyle = isSelected ? styles.statPillTextSelected : styles.statPillText;

  return (
    <Pressable onPress={handlePress} style={pillStyle} accessibilityRole="button">
      <Text style={textStyle}>{severity}</Text>
    </Pressable>
  );
});

interface DirectiveCardProps {
  directive: FixDirective;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

const DirectiveCard = React.memo(function DirectiveCard({
  directive,
  onApprove,
  onReject,
}: DirectiveCardProps) {
  const isPending = directive.status === "pending_review";
  const isInProgress = directive.status === "in_progress";
  const isResolved = directive.status === "resolved";

  const handleApprove = useCallback(() => onApprove(directive.id), [onApprove, directive.id]);
  const handleReject = useCallback(() => onReject(directive.id), [onReject, directive.id]);

  const badgeStyle = getDirectiveBadgeStyle(directive.severity);
  const badgeTextStyle = getDirectiveBadgeTextStyle(directive.severity);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <View style={badgeStyle}>
            <Text style={badgeTextStyle}>{directive.severity}</Text>
          </View>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {directive.title}
          </Text>
        </View>

        <Text style={styles.occurrenceText}>
          {directive.occurrenceCount} occurrences ({directive.affectedPages.length} routes)
        </Text>
      </View>

      {/* Source Hint if available */}
      {directive.sourceHint && (
        <Text style={styles.sourceHintText}>
          📁 {directive.sourceHint.filePath}
          {directive.sourceHint.line ? `:${directive.sourceHint.line}` : ""}
        </Text>
      )}

      {/* Error Snippet Box */}
      <View style={styles.codeBox}>
        <Text style={styles.codeText} numberOfLines={2}>
          {directive.errorDetails.message}
        </Text>
      </View>

      {/* Suggested Fix */}
      <Text style={styles.suggestedFixText}>💡 {directive.suggestedFix}</Text>

      {/* Action Bar */}
      <View style={styles.cardActionsRow}>
        {isPending && (
          <>
            <Pressable
              style={styles.buttonSecondary}
              onPress={handleReject}
              accessibilityRole="button"
            >
              <Text style={styles.buttonSecondaryText}>Ignore</Text>
            </Pressable>
            <Pressable
              style={styles.buttonPrimary}
              onPress={handleApprove}
              accessibilityRole="button"
            >
              <Text style={styles.buttonPrimaryText}>Approve & Fix</Text>
            </Pressable>
          </>
        )}

        {isInProgress && (
          <View style={styles.actionWorkingRow}>
            <ActivityIndicator size="small" color={palette.accent} />
            <Text style={styles.actionWorkingText}>Fixing in Worktree...</Text>
          </View>
        )}

        {isResolved && (
          <View style={styles.resolvedBadge}>
            <Text style={styles.resolvedBadgeText}>
              ✓ PR Created {directive.prUrl ? `(${directive.prUrl.split("/").pop()})` : ""}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
});

interface TriageBoardProps {
  directives: FixDirective[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onBatchApprove: (minSeverity: Severity) => void;
}

export const TriageBoard = React.memo(function TriageBoard({
  directives,
  onApprove,
  onReject,
  onBatchApprove,
}: TriageBoardProps) {
  const [filterSeverity, setFilterSeverity] = useState<Severity | "ALL">("ALL");

  const filtered = directives.filter((d) => {
    if (filterSeverity === "ALL") return true;
    return d.severity === filterSeverity;
  });

  const handleBatch = useCallback(() => {
    onBatchApprove("P1");
  }, [onBatchApprove]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.listContent}>
      {/* Triage Filter & Batch Action */}
      <View style={styles.rowBetweenCenter}>
        <View style={styles.filterPillRow}>
          {SEVERITIES.map((sev) => (
            <SeverityFilterPill
              key={sev}
              severity={sev}
              isSelected={filterSeverity === sev}
              onSelect={setFilterSeverity}
            />
          ))}
        </View>

        <Pressable style={styles.buttonPrimary} onPress={handleBatch} accessibilityRole="button">
          <Text style={styles.buttonPrimaryText}>⚡ Batch Fix P0/P1</Text>
        </Pressable>
      </View>

      {/* Directives Cards List */}
      {filtered.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No defects found matching current filter.</Text>
        </View>
      ) : (
        filtered.map((d) => (
          <DirectiveCard key={d.id} directive={d} onApprove={onApprove} onReject={onReject} />
        ))
      )}
    </ScrollView>
  );
});
