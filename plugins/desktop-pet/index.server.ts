import type { PluginServerContext } from "@getpaseo/plugin/server";
import { join } from "node:path";
import { homedir } from "node:os";
import { DesktopPetAgentProjection } from "./server/agent-projection.js";
import { AgentSubscriber } from "./server/agent-subscriber.js";
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

  const projection = new DesktopPetAgentProjection();
  const auditLogger = new AuditLogger(auditPath);
  const xpManager = new XpManager(0);
  const companion = new CompanionService(6768);

  // Sync XP and Level into projection
  projection.setXpAndLevel(xpManager.getXp(), xpManager.getLevel());

  let timerHandle: NodeJS.Timeout | null = null;
  let subscriber: AgentSubscriber | null = null;
  let serverObservation: { dispose(): void } | null = null;
  let lastPaseoContext: any = null;

  // 1. Authoritative observation via server.observeAgents if supported by daemon
  if (typeof (server as any).observeAgents === "function") {
    serverObservation = (server as any).observeAgents({
      onSnapshot: (agents: any[]) => {
        projection.handleSnapshot(agents);
      },
      onUpdate: (agent: any) => {
        projection.handleUpdate(agent);
      },
      onRemove: (agentId: string) => {
        projection.handleRemove(agentId);
      },
    });
  } else {
    // 2. Direct daemon client observation fallback (reads local-credential)
    subscriber = new AgentSubscriber(projection);
    void subscriber.start().catch((err) => {
      console.error("[desktop-pet] Failed to start agent subscriber:", err);
    });
  }

  // Broadcast ticker: pushes state updates to connected companions every 1s
  const startTick = () => {
    timerHandle = setInterval(() => {
      companion.broadcastSnapshot(projection.getSnapshot());
    }, 1000);
  };

  companion.setActionHandler(async (command: any) => {
    try {
      if (command.type === "decision.respond") {
        const behavior = (command.behavior || "allow").toLowerCase() as "allow" | "deny";
        let handled = false;

        if (subscriber && subscriber.canRespond()) {
          await subscriber.respondToPermission(command.agentId, command.requestId, { behavior });
          handled = true;
        } else if (lastPaseoContext?.agents?.ref) {
          const agentRef = lastPaseoContext.agents.ref(command.agentId);
          await agentRef.respondToPermission({
            requestId: command.requestId,
            response: { behavior },
          });
          handled = true;
        } else if ((server as any)?.paseo?.agents?.ref) {
          const agentRef = (server as any).paseo.agents.ref(command.agentId);
          await agentRef.respondToPermission({
            requestId: command.requestId,
            response: { behavior },
          });
          handled = true;
        }

        if (handled) {
          xpManager.awardManualPrompt();
          projection.setXpAndLevel(xpManager.getXp(), xpManager.getLevel());
          companion.broadcastActionAck({
            requestId: command.requestId,
            behavior: command.behavior,
            success: true,
          });
          companion.broadcastSnapshot(projection.getSnapshot());
        }
      }
    } catch (err) {
      console.error("[desktop-pet] Failed to handle companion action:", err);
    }
  });

  companion
    .start()
    .then(() => startTick())
    .catch((err) => {
      console.error("[desktop-pet] Companion service failed to start:", err);
    });

  // Track task completions for pet XP
  server.on("agent.turn_ended", async (event) => {
    if (event.outcome.kind === "completed") {
      xpManager.awardTaskCompletion();
      projection.setXpAndLevel(xpManager.getXp(), xpManager.getLevel());
    }
  });

  // RPC handlers
  server.handle(getDashboardRpc, async () => {
    return projection.getSnapshot();
  });

  server.handle(getAuditLogsRpc, async (input) => {
    return auditLogger.list(input);
  });

  server.handle(markAuditReviewedRpc, async (input) => {
    const success = await auditLogger.markReviewed(input.id);
    return { success };
  });

  server.handle(respondPermissionRpc, async (input, context) => {
    if ((context as any)?.paseo) {
      lastPaseoContext = (context as any).paseo;
    }
    const agentRef =
      (context as any)?.paseo?.agents?.ref(input.agentId) ??
      (server as any)?.paseo?.agents?.ref(input.agentId);
    if (!agentRef) {
      throw new Error(`Agent API unavailable to respond to permission for ${input.agentId}`);
    }
    await agentRef.respondToPermission({
      requestId: input.requestId,
      response: { behavior: input.behavior },
    });
    xpManager.awardManualPrompt();
    projection.setXpAndLevel(xpManager.getXp(), xpManager.getLevel());
    return { success: true };
  });

  server.registerSettings(petSettingsDefinition);

  return () => {
    if (timerHandle) clearInterval(timerHandle);
    if (serverObservation) serverObservation.dispose();
    if (subscriber) void subscriber.stop();
    companion.stop().catch(() => {});
  };
}
