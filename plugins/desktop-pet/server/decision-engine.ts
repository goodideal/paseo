import { randomUUID } from "node:crypto";
import type { AuditRecord, PendingDecision } from "../shared/types.js";

export interface DecisionResult {
  decision: "allow" | "deny";
  riskLevel: "low" | "medium" | "high";
  reason: string;
}

// 1. Sensitive system and credential paths anywhere in arguments
const SENSITIVE_PATHS = [
  /(^|[\s"'\`=])(\/etc(\/|\b)|~?\/\.ssh(\/|\b)|\/var\/root|\/System\/|\/proc\/|\/dev\/)/i,
];

// 2. High-risk destructive commands (regardless of flag ordering, correctly matching non-word hyphens)
const HIGH_RISK_COMMANDS = [
  /\brm\s+(.*?\s)?(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(\s|$)/i,
  /\bgit\s+push\b.*(^|\s)(--force|-f)(\s|$)/i,
  /\bgit\s+reset\b.*(^|\s)--hard(\s|$)/i,
  /\b(curl|wget)\b.*\|\s*(ba)?sh\b/i,
  /\bchmod\s+.*(^|\s)(-[a-zA-Z]*R[a-zA-Z]*\s+)?(777|a\+rwx)(\s|$)/i,
  /\b(mkfs|dd\s+if=)\b/i,
];

// 3. Shell chaining or redirection operators requiring manual inspection
const CHAINING_OR_REDIRECTION = /[;&|`]|(\$\()|>/;

// 4. Safe read-only & testing commands
const SAFE_COMMAND_PREFIXES = [
  /^git\s+(status|diff|log|branch|show)\b/i,
  /^npm\s+(test|run\s+lint|run\s+typecheck|run\s+format:check)\b/i,
  /^(ls|dir|cat|head|tail|grep|rg)\b/i,
];

export class DecisionEngine {
  public evaluateAction(actionRequested: string, contextDescription?: string): DecisionResult {
    const normalized = actionRequested.trim();

    // Priority 1: Check for sensitive paths
    for (const pattern of SENSITIVE_PATHS) {
      if (pattern.test(normalized)) {
        return {
          decision: "deny",
          riskLevel: "high",
          reason: `Sensitive path access detected in "${normalized}". Automatically denied for safety.`,
        };
      }
    }

    // Priority 2: Check for destructive commands
    for (const pattern of HIGH_RISK_COMMANDS) {
      if (pattern.test(normalized)) {
        return {
          decision: "deny",
          riskLevel: "high",
          reason: `Destructive command detected: "${normalized}". Automatically denied for safety.`,
        };
      }
    }

    // Priority 3: Check for chaining / redirection operators
    if (CHAINING_OR_REDIRECTION.test(normalized)) {
      return {
        decision: "deny",
        riskLevel: "medium",
        reason: `Command chaining, piping, or redirection detected in "${normalized}". Requires explicit human authorization.`,
      };
    }

    // Priority 4: Safe verification / read commands
    for (const prefix of SAFE_COMMAND_PREFIXES) {
      if (prefix.test(normalized)) {
        return {
          decision: "allow",
          riskLevel: "low",
          reason: `Safe read-only or verification command: "${normalized}". Automatically approved.`,
        };
      }
    }

    // Priority 5: Default fallback to deny (balanced policy)
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
