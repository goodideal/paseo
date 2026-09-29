import { type WorkflowAgentHandoff, WorkflowAgentHandoffSchema } from "./workflow-models.js";

export interface WorkflowAgentHandoffError {
  error: "missing_block" | "invalid_json" | "schema_validation_failed";
  message: string;
  rawContent?: string;
}

export function isWorkflowAgentHandoff(
  value: WorkflowAgentHandoff | WorkflowAgentHandoffError,
): value is WorkflowAgentHandoff {
  return typeof value === "object" && value !== null && !("error" in value);
}

const HANDOFF_CODE_FENCE_REGEX = /```(?:paseo-workflow-handoff)\s*\r?\n([\s\S]*?)\r?\n?```/g;

/**
 * Extracts and validates the structured paseo-workflow-handoff code block from agent output.
 * If multiple blocks are present, only the LAST one is evaluated.
 */
export function extractWorkflowAgentHandoff(
  text: string,
): WorkflowAgentHandoff | WorkflowAgentHandoffError {
  const matches = Array.from(text.matchAll(HANDOFF_CODE_FENCE_REGEX));
  if (matches.length === 0) {
    return {
      error: "missing_block",
      message: "No paseo-workflow-handoff code fence found in agent output",
    };
  }

  const lastMatch = matches[matches.length - 1];
  const blockContent = lastMatch[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(blockContent);
  } catch (err) {
    return {
      error: "invalid_json",
      message: err instanceof Error ? err.message : String(err),
      rawContent: blockContent,
    };
  }

  const result = WorkflowAgentHandoffSchema.safeParse(parsed);
  if (!result.success) {
    return {
      error: "schema_validation_failed",
      message: result.error.message,
      rawContent: blockContent,
    };
  }

  return result.data;
}
