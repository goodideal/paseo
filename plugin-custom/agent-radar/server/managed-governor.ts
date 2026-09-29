import type { WatchdogIntent } from "../shared/types.js";
import { DEFAULT_SAFE_COMMANDS } from "../shared/settings.js";

export class ManagedGovernor {
  private turnCounts = new Map<string, number>();
  private maxAutoTurns: number;
  private lastOutput = new Map<string, string>();
  private errorCounts = new Map<string, { fingerprint: string; count: number }>();
  private lastBlockerReason = new Map<string, string>();
  private agentOverrides = new Map<string, boolean>();
  private safeCommandWhitelist: string[] = [...DEFAULT_SAFE_COMMANDS];
  private consecutiveErrorTolerance = 2;

  constructor(maxAutoTurns = 5) {
    this.maxAutoTurns = maxAutoTurns;
  }

  public setMaxAutoTurns(turns: number) {
    this.maxAutoTurns = turns;
  }

  public getMaxAutoTurns(): number {
    return this.maxAutoTurns;
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
    this.errorCounts.delete(agentId);
    this.lastBlockerReason.delete(agentId);
  }

  public getLastBlockerReason(agentId: string): string | undefined {
    return this.lastBlockerReason.get(agentId);
  }

  public setSafeCommandWhitelist(list: string[]) {
    this.safeCommandWhitelist = [...list];
  }

  public getSafeCommandWhitelist(): string[] {
    return this.safeCommandWhitelist;
  }

  public setConsecutiveErrorTolerance(tolerance: number) {
    this.consecutiveErrorTolerance = tolerance;
  }

  public getConsecutiveErrorTolerance(): number {
    return this.consecutiveErrorTolerance;
  }

  public setAgentAutoContinue(agentId: string, enabled: boolean) {
    this.agentOverrides.set(agentId, enabled);
  }

  public isAgentAutoContinueEnabled(agentId: string, globalDefault = false): boolean {
    const override = this.agentOverrides.get(agentId);
    if (override !== undefined) {
      return override;
    }
    return globalDefault;
  }

  public isSafeCommand(command: string): boolean {
    const cmd = command.trim();
    // Blacklist check - explicitly include PR merge and dangerous commands
    const dangerousPatterns = [
      /rm\s/,
      /git\s+push/,
      /git\s+merge/,
      /gh\s+pr\s+merge/,
      /glab\s+mr\s+merge/,
      /gitea.*merge/,
      /chmod/,
      /sudo/,
      />/,
    ];
    if (dangerousPatterns.some((p) => p.test(cmd))) {
      return false;
    }

    // Whitelist check against configured safe prefixes
    return this.safeCommandWhitelist.some((prefix) => cmd.startsWith(prefix));
  }

  public isPrMergeIntent(text: string, toolCalls: string[]): boolean {
    const textPrPattern =
      /准备合并\s*pr|准备合并\s*pull request|合并\s*pr\s*#|合并\s*pull request|ready to merge pr|merge pull request|merge pr\s*#|merging the pull request/i;
    if (textPrPattern.test(text)) {
      return true;
    }

    const commandPrPattern =
      /(?:gh\s+pr\s+merge|git\s+merge|glab\s+mr\s+merge|gitea.*merge|merge_pull_request|merge_pr)/i;
    if (toolCalls.some((call) => commandPrPattern.test(call))) {
      return true;
    }

    return false;
  }

  public extractErrorFingerprint(text: string): string | null {
    // 1. TypeScript compiler error code
    const tsMatch = text.match(/TS\d{4,5}:?[^\n]+/);
    if (tsMatch) return tsMatch[0].trim();

    // 2. Standard Error/Exception lines
    const errorMatch = text.match(/(?:Error|Exception|FAIL|AssertionError):\s*([^\n]+)/i);
    if (errorMatch) return errorMatch[0].trim();

    // 3. Process exit failure
    const exitMatch = text.match(/(?:failed with (?:exit )?code \d+)/i);
    if (exitMatch) return exitMatch[0].trim();

    return null;
  }

  public computeSimilarity(a: string, b: string): number {
    const cleanA = a.replace(/\s+/g, " ").trim().toLowerCase();
    const cleanB = b.replace(/\s+/g, " ").trim().toLowerCase();
    if (cleanA === cleanB) return 1.0;
    if (cleanA.length === 0 || cleanB.length === 0) return 0.0;

    const getBigrams = (str: string): Set<string> => {
      const set = new Set<string>();
      for (let i = 0; i < str.length - 1; i++) {
        set.add(str.slice(i, i + 2));
      }
      return set;
    };

    const setA = getBigrams(cleanA);
    const setB = getBigrams(cleanB);
    if (setA.size === 0 || setB.size === 0) return 0.0;

    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0.0;
  }

  public isHumanDecisionNeeded(text: string): boolean {
    const pattern =
      /请确认选择方案|方案\s*[a-zA-Z0-9一二12]\s*还是\s*方案|请确认方案|请选择方案|需要哪一种实现|无法确定具体需求|which approach do you prefer|please choose between|what would you prefer/i;
    return pattern.test(text);
  }

  public evaluateOutput(agentId: string, outputText: string, toolCalls: string[]): WatchdogIntent {
    const trimmedOutput = outputText.trim();
    const lowerOutput = trimmedOutput.toLowerCase();

    // 1. Check for thread limit failure or explicit errors
    if (
      trimmedOutput.includes("collab spawn failed: agent thread limit reached") ||
      trimmedOutput.includes("ERR_BLOCKED")
    ) {
      this.lastBlockerReason.set(agentId, "Agent execution error or thread limit reached");
      return "BLOCKER_ESCALATE";
    }

    // 2. PR Merge Protection: Never auto-continue or auto-pass PR merge
    if (this.isPrMergeIntent(trimmedOutput, toolCalls)) {
      this.lastBlockerReason.set(
        agentId,
        "PR merge intent detected: manual human approval required",
      );
      return "BLOCKER_ESCALATE";
    }

    // 3. Human Decision / Clarification Needed
    // When the agent is explicitly asking the human to choose or clarify,
    // this is healthy dialogue — NOT an error blocker.
    // Return NEUTRAL so the turn ends naturally waiting for the user's reply in chat.
    if (this.isHumanDecisionNeeded(trimmedOutput)) {
      return "NEUTRAL";
    }

    // 4. Content-Aware: Error Fingerprint Non-Convergence (Repeated identical error across consecutive turns)
    const errorFp = this.extractErrorFingerprint(trimmedOutput);
    if (errorFp) {
      const current = this.errorCounts.get(agentId);
      if (current && current.fingerprint === errorFp) {
        const newCount = current.count + 1;
        this.errorCounts.set(agentId, { fingerprint: errorFp, count: newCount });
        if (newCount >= this.consecutiveErrorTolerance) {
          this.lastBlockerReason.set(
            agentId,
            `Repeated error detected across ${newCount} consecutive turns: ${errorFp.slice(0, 80)}`,
          );
          return "BLOCKER_ESCALATE";
        }
      } else {
        this.errorCounts.set(agentId, { fingerprint: errorFp, count: 1 });
      }
    } else {
      this.errorCounts.delete(agentId);
    }

    // 5. Completed intent check
    if (
      (trimmedOutput.includes("STATUS: DONE") ||
        trimmedOutput.includes("所有任务已全部完成") ||
        trimmedOutput.includes("交付完成") ||
        lowerOutput.includes("all tasks completed") ||
        lowerOutput.includes("all tasks complete") ||
        lowerOutput.includes("delivery complete") ||
        lowerOutput.includes("task complete")) &&
      !trimmedOutput.includes("- [ ]")
    ) {
      return "COMPLETED";
    }

    // 6. Fuzzy Flapping Detection (Exact match or >= 80% similarity with no toolCalls)
    const last = this.lastOutput.get(agentId);
    if (last && trimmedOutput.length > 0) {
      const isExactRepeat = last === trimmedOutput;
      const isFuzzyRepeat =
        toolCalls.length === 0 && this.computeSimilarity(last, trimmedOutput) >= 0.8;
      if (isExactRepeat || isFuzzyRepeat) {
        this.lastBlockerReason.set(
          agentId,
          "Detected flapping or stagnant output without progress",
        );
        return "BLOCKER_ESCALATE";
      }
    }
    this.lastOutput.set(agentId, trimmedOutput);

    // 7. Check auto-turn limit
    if (this.getAutoTurnCount(agentId) >= this.maxAutoTurns) {
      this.lastBlockerReason.set(agentId, `Reached auto-turn limit of ${this.maxAutoTurns}`);
      return "BLOCKER_ESCALATE";
    }

    // 8. Incomplete intents: unchecked markdown todos or continuation prompts
    const hasUncheckedTodo = trimmedOutput.includes("- [ ]");
    const hasContinuationPrompt = /需要继续吗|是否继续|继续执行|继续下一步|进行下一步/.test(
      trimmedOutput,
    );

    // 9. Safe read-only commands
    const hasSafeCommand = toolCalls.some((call) => this.isSafeCommand(call));

    if (hasUncheckedTodo || hasContinuationPrompt || hasSafeCommand) {
      return "AUTO_CONTINUE";
    }

    return "NEUTRAL";
  }
}
