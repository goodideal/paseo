import type { WatchdogIntent } from "../shared/types.js";

export class ManagedGovernor {
  private turnCounts = new Map<string, number>();
  private maxAutoTurns: number;
  private lastOutput = new Map<string, string>();

  constructor(maxAutoTurns = 5) {
    this.maxAutoTurns = maxAutoTurns;
  }

  public getAutoTurnCount(agentId: string): number {
    return this.turnCounts.get(agentId) || 0;
  }

  public incrementTurn(agentId: string) {
    const current = this.getAutoTurnCount(agentId);
    this.turnCounts.set(agentId, current + 1);
  }

  public resetTurn(agentId: string) {
    this.turnCounts.delete(agentId);
    this.lastOutput.delete(agentId);
  }

  public evaluateOutput(agentId: string, outputText: string, toolCalls: string[]): WatchdogIntent {
    const trimmedOutput = outputText.trim();

    // 1. Check for thread limit failure or explicit errors
    if (
      trimmedOutput.includes("collab spawn failed: agent thread limit reached") ||
      trimmedOutput.includes("fatal: ") ||
      trimmedOutput.includes("ERR_BLOCKED")
    ) {
      return "BLOCKER_ESCALATE";
    }

    // 2. Check for completed intent
    if (
      (trimmedOutput.includes("STATUS: DONE") ||
        trimmedOutput.includes("所有任务已全部完成") ||
        trimmedOutput.includes("交付完成")) &&
      !trimmedOutput.includes("- [ ]")
    ) {
      return "COMPLETED";
    }

    // 3. Check for flapping (exact repeat of last output)
    const last = this.lastOutput.get(agentId);
    if (last && last === trimmedOutput && trimmedOutput.length > 0) {
      return "BLOCKER_ESCALATE";
    }
    this.lastOutput.set(agentId, trimmedOutput);

    // 4. Check auto-turn limit
    if (this.getAutoTurnCount(agentId) >= this.maxAutoTurns) {
      return "BLOCKER_ESCALATE"; // Reached auto-turn limit
    }

    // 5. Incomplete intents: unchecked markdown todos or continuation prompts
    const hasUncheckedTodo = trimmedOutput.includes("- [ ]");
    const hasContinuationPrompt = /需要继续吗|是否继续|继续执行|继续下一步|进行下一步/.test(
      trimmedOutput,
    );

    // 6. Safe read-only commands
    const readOnlyCommands = [
      "git status",
      "git diff",
      "cat ",
      "ls ",
      "grep ",
      "npm test",
      "vitest",
    ];
    const hasSafeCommand = toolCalls.some((call) =>
      readOnlyCommands.some((cmd) => call.includes(cmd)),
    );

    if (hasUncheckedTodo || hasContinuationPrompt || hasSafeCommand) {
      return "AUTO_CONTINUE";
    }

    return "NEUTRAL";
  }
}
