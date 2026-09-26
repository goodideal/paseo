import { defineRpc } from "@getpaseo/plugin";
import {
  ResolveDecisionInputSchema,
  ResolveDecisionOutputSchema,
  WatchdogStatusOutputSchema,
} from "./types.js";
import { z } from "zod";

export const resolveDecisionRpc = defineRpc({
  name: "watchdog.resolve_decision",
  input: ResolveDecisionInputSchema,
  output: ResolveDecisionOutputSchema,
});

export const interruptAgentRpc = defineRpc({
  name: "watchdog.interrupt_agent",
  input: z.object({ agentId: z.string() }),
  output: z.object({ success: z.boolean() }),
});

export const getWatchdogStatusRpc = defineRpc({
  name: "watchdog.get_status",
  input: z.object({ agentId: z.string() }),
  output: WatchdogStatusOutputSchema,
});
