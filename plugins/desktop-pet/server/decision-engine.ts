import { randomUUID } from "node:crypto";
import type { AuditRecord, PendingDecision } from "../shared/types.js";

export interface DecisionResult {
  decision: "allow" | "deny";
  riskLevel: "low" | "medium" | "high";
  reason: string;
}

const HIGH_RISK_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|--recursive)\b/i,
  /\bgit\s+push\b.*(--force|-f)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bcurl\b.*\|\s*(ba)?sh\b/i,
  /\bchmod\s+(-R\s+)?777\b/i,
  /\b(\/etc\/|\/var\/root|\/System\/|~?\/\.ssh\/)/i,
];

const SAFE_PATTERNS = [
  /\bgit\s+(status|diff|log|branch|show)\b/i,
  /\bnpm\s+(test|run\s+lint|run\s+typecheck|run\s+format:check)\b/i,
  /\b(ls|dir|cat|head|tail|grep|rg)\b/i,
];

export class DecisionEngine {
  public evaluateAction(actionRequested: string, contextDescription?: string): DecisionResult {
    const normalized = actionRequested.trim();

    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          decision: "deny",
          riskLevel: "high",
          reason: `Destructive or sensitive pattern detected: "${normalized}". Automatically denied for safety.`,
        };
      }
    }

    for (const pattern of SAFE_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          decision: "allow",
          riskLevel: "low",
          reason: `Read-only or safe verification command: "${normalized}". Automatically approved.`,
        };
      }
    }

    // Default to balanced policy: if unknown command, inspect context or deny
    return {
      decision: "deny",
      riskLevel: "medium",
      reason: `Command "${normalized}" requires explicit human authorization. Context: ${contextDescription ?? "N/A"}`,
    };
  }

  public async executeTimeoutDecision(params: {
    agent: { respondToPermission: (opts: any) => Promise<void> };
    agentId: string;
    taskTitle: string;
    decision: PendingDecision;
  }): Promise<AuditRecord> {
    const evaluation = this.evaluateAction(params.decision.actionRequested);
    const behavior = evaluation.decision;

    await params.agent.respondToPermission({
      requestId: params.decision.requestId,
      response: {
        behavior,
        message: `[Paseo Desktop Pet Timeout Decision] ${evaluation.reason}`,
      },
    });

    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      agentId: params.agentId,
      taskTitle: params.taskTitle,
      triggerType: "TIMEOUT_AUTO_DECISION",
      requestedAction: params.decision.actionRequested,
      decision: behavior === "allow" ? "ALLOW" : "DENY",
      riskLevel: evaluation.riskLevel,
      aiReason: evaluation.reason,
      reviewedByHuman: false,
    };
  }
}
