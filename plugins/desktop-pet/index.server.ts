import type { PluginServerContext } from "@getpaseo/plugin/server";
import { join } from "node:path";
import { homedir } from "node:os";
import { AgentTracker } from "./server/agent-tracker.js";
import { DecisionEngine } from "./server/decision-engine.js";
import { AuditLogger } from "./server/audit-logger.js";
import { XpManager } from "./server/xp-manager.js";
import { CompanionService } from "./server/companion-service.js";
import {
  getAuditLogsRpc,
  getDashboardRpc,
  markAuditReviewedRpc,
  petSettingsDefinition,
  respondPermissionRpc,
} from "./shared/contracts.js";

export default function contribute(server: PluginServerContext) {
  const auditPath = join(
    process.env.PASEO_HOME || join(homedir(), ".paseo"),
    "plugins",
    "desktop-pet",
    "audit-log.json",
  );

  const tracker = new AgentTracker();
  const decisionEngine = new DecisionEngine();
  const auditLogger = new AuditLogger(auditPath);
  const xpManager = new XpManager(0);
  const companion = new CompanionService(6768);

  // Sync XP and Level into tracker
  tracker.setXpAndLevel(xpManager.getXp(), xpManager.getLevel());

  let timerHandle: NodeJS.Timeout | null = null;

  // Broadcast ticker: checks expired timeouts every 1s and pushes updates
  const startTick = () => {
    timerHandle = setInterval(async () => {
      const now = Date.now();
      const expired = tracker.getExpiredPendingDecisions(now);

      for (const item of expired) {
        try {
          const agentRef = server.paseo.agents.ref(item.agentId);
          const audit = await decisionEngine.executeTimeoutDecision({
            agent: agentRef,
            agentId: item.agentId,
            taskTitle: `Task ${item.agentId.slice(0, 6)}`,
            decision: item.decision,
          });
          await auditLogger.append(audit);
          tracker.resolvePermission(item.agentId, item.decision.requestId, now);
          xpManager.awardAutoDecision();
          tracker.setXpAndLevel(xpManager.getXp(), xpManager.getLevel());
        } catch (err) {
          console.error(`[desktop-pet] Failed to auto-decide for agent ${item.agentId}:`, err);
        }
      }

      companion.broadcastSnapshot(tracker.getSnapshot(now));
    }, 1000);
  };

  companion
    .start()
    .then(() => startTick())
    .catch(() => {});

  // Listen to lifecycle events
  server.on("agent.turn_started", async (event) => {
    const title = event.agent.title || `Task ${event.agent.id.slice(0, 6)}`;
    tracker.startTask(event.agent.id, title);
  });

  server.on("agent.permission_requested", async (event) => {
    const actionRequested =
      event.request.kind === "shell" ? event.request.command : JSON.stringify(event.request);

    tracker.recordPermissionRequest({
      agentId: event.agent.id,
      requestId: event.request.id,
      actionRequested,
      timeoutSeconds: 180,
    });
  });

  server.on("agent.permission_resolved", async (event) => {
    tracker.resolvePermission(event.agent.id, event.requestId);
  });

  server.on("agent.turn_ended", async (event) => {
    tracker.stopTask(event.agent.id);
    if (event.outcome.kind === "completed") {
      xpManager.awardTaskCompletion();
      tracker.setXpAndLevel(xpManager.getXp(), xpManager.getLevel());
    }
  });

  // RPC handlers
  server.handle(getDashboardRpc, async () => {
    return tracker.getSnapshot();
  });

  server.handle(getAuditLogsRpc, async ({ input }) => {
    return auditLogger.list(input);
  });

  server.handle(markAuditReviewedRpc, async ({ input }) => {
    const success = await auditLogger.markReviewed(input.id);
    return { success };
  });

  server.handle(respondPermissionRpc, async ({ input }) => {
    const agentRef = server.paseo.agents.ref(input.agentId);
    await agentRef.respondToPermission({
      requestId: input.requestId,
      response: { behavior: input.behavior },
    });
    tracker.resolvePermission(input.agentId, input.requestId);
    xpManager.awardManualPrompt();
    tracker.setXpAndLevel(xpManager.getXp(), xpManager.getLevel());
    return { success: true };
  });

  server.registerSettings(petSettingsDefinition);

  return () => {
    if (timerHandle) clearInterval(timerHandle);
    companion.stop().catch(() => {});
  };
}
