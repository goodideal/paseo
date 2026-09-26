import { useCallback, useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { resolveDecisionRpc } from "../../shared/rpc.js";
import type { ResolveDecisionInput, ResolveDecisionOutput } from "../../shared/types.js";

export function useDecisionRpc() {
  const resolveDecision = useRpc(resolveDecisionRpc);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitDecision = useCallback(
    async (input: ResolveDecisionInput): Promise<ResolveDecisionOutput | null> => {
      setIsSubmitting(true);
      setError(null);
      try {
        const result = await resolveDecision(input);
        return result;
      } catch (err: any) {
        setError(err.message || "Failed to submit decision");
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [resolveDecision],
  );

  return { submitDecision, isSubmitting, error };
}
