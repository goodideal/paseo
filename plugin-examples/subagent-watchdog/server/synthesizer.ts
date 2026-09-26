import type { BlockerReport, DecisionOption } from "../shared/types.js";

export class Synthesizer {
  public createBlockerReport(
    agentId: string,
    summary: string,
    rootCause: string,
    options: DecisionOption[],
    errorCode?: string,
    parentAgentId?: string,
    subagentNickname?: string,
  ): BlockerReport {
    return {
      agentId,
      parentAgentId: parentAgentId ?? null,
      subagentNickname: subagentNickname ?? null,
      summary,
      rootCause,
      errorCode,
      options,
      timestamp: new Date().toISOString(),
    };
  }

  public renderDecisionCard(report: BlockerReport): string {
    let card = `### Watchdog: Escalation Required\n\n`;

    if (report.subagentNickname) {
      card += `**Agent**: ${report.subagentNickname} (${report.agentId})\n`;
    } else {
      card += `**Agent**: ${report.agentId}\n`;
    }

    if (report.errorCode) {
      card += `**Code**: \`${report.errorCode}\`\n`;
    }

    card += `**Summary**: ${report.summary}\n`;
    card += `**Root Cause**: ${report.rootCause}\n\n`;
    card += `**Options**:\n`;

    report.options.forEach((opt, index) => {
      card += `${index + 1}. **${opt.label}**: ${opt.description}\n`;
    });

    return card;
  }
}
