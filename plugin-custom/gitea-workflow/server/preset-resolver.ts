import { TRIGGER_LABELS, type GiteaTriggerMode } from "../shared/types.js";

export interface ResolvedWorkflowTarget {
  presetId: string;
  mode: GiteaTriggerMode;
  conflictWarning: boolean;
  matchedTriggerLabel: string;
}

export function resolveIssueWorkflowPreset(
  labels: Array<{ name: string }>,
): ResolvedWorkflowTarget | null {
  const autoTag = labels.find((l) =>
    (TRIGGER_LABELS.AUTO as readonly string[]).includes(l.name.trim().toLowerCase()),
  );
  const planTag = labels.find((l) =>
    (TRIGGER_LABELS.PLAN as readonly string[]).includes(l.name.trim().toLowerCase()),
  );

  if (autoTag && planTag) {
    return {
      presetId: "gitea.issue-to-pr.plan",
      mode: "plan",
      conflictWarning: true,
      matchedTriggerLabel: planTag.name,
    };
  }

  if (autoTag) {
    return {
      presetId: "gitea.issue-to-pr.auto",
      mode: "auto",
      conflictWarning: false,
      matchedTriggerLabel: autoTag.name,
    };
  }

  if (planTag) {
    return {
      presetId: "gitea.issue-to-pr.plan",
      mode: "plan",
      conflictWarning: false,
      matchedTriggerLabel: planTag.name,
    };
  }

  return null;
}
