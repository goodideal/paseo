import React, { useCallback, useRef, useState } from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";

export interface WorkflowInteractionCardProps {
  interaction?: {
    id: string;
    stepId?: string;
    status?: string;
    promptArtifactId?: string;
    question?: string | null;
  } | null;
  promptContent?: string | null;
  supported?: boolean;
  onRespond: (answer: string) => Promise<void> | void;
  isPending?: boolean;
  error?: string | null;
  testID?: string;
}

export function WorkflowInteractionCard({
  interaction,
  promptContent,
  supported = true,
  onRespond,
  isPending = false,
  error,
  testID = "workflow-interaction-card",
}: WorkflowInteractionCardProps) {
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const inputRef = useRef<EditingTextInputHandle>(null);

  const handleSubmit = useCallback(async () => {
    if (!draft.trim() || isSubmitting || isPending) return;
    setIsSubmitting(true);
    setLocalError(null);
    try {
      await onRespond(draft.trim());
      setDraft("");
      inputRef.current?.reset();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to send response");
    } finally {
      setIsSubmitting(false);
    }
  }, [draft, isSubmitting, isPending, onRespond]);

  if (!supported) {
    return (
      <View style={styles.card} testID={testID}>
        <Alert
          variant="warning"
          title="Host Upgrade Required"
          description="Workflow Interactions require a host upgrade. Please update your Paseo daemon to respond to interactions."
        />
      </View>
    );
  }

  if (!interaction || interaction.status !== "pending") {
    return null;
  }

  const effectiveError = error ?? localError;
  const busy = isSubmitting || isPending;
  const displayText =
    promptContent ?? interaction.question ?? "The workflow is requesting your input to proceed:";

  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.title}>Interaction Requested</Text>
      <Text style={styles.prompt}>{displayText}</Text>

      <EditingTextInput
        ref={inputRef}
        style={styles.input}
        accessibilityLabel="Reply"
        placeholder="Type your response..."
        onChangeText={setDraft}
        editable={!busy}
        multiline
      />

      {effectiveError && (
        <View style={styles.errorContainer}>
          <Alert variant="error" title="Submission Error" description={effectiveError} />
        </View>
      )}

      <View style={styles.actionRow}>
        <Button variant="default" size="sm" onPress={handleSubmit} disabled={busy || !draft.trim()}>
          {busy ? "Sending..." : "Send reply"}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    marginBottom: theme.spacing[4],
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    marginBottom: theme.spacing[2],
  },
  prompt: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    marginBottom: theme.spacing[3],
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    color: theme.colors.foreground,
    padding: theme.spacing[3],
    fontSize: theme.fontSize.base,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: theme.spacing[3],
  },
  errorContainer: {
    marginBottom: theme.spacing[3],
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
}));
