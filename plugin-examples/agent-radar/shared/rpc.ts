import { defineRpc } from "@getpaseo/plugin";
import {
  ResolveDecisionInputSchema,
  ResolveDecisionOutputSchema,
  WatchdogStatusOutputSchema,
  RadarSnapshotSchema,
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

// Radar primary RPC contracts
export const radarGetSnapshotRpc = defineRpc({
  name: "radar.get_snapshot",
  input: z.object({ agentId: z.string() }),
  output: RadarSnapshotSchema,
});

export const radarResolveDecisionRpc = defineRpc({
  name: "radar.resolve_decision",
  input: ResolveDecisionInputSchema,
  output: ResolveDecisionOutputSchema,
});
