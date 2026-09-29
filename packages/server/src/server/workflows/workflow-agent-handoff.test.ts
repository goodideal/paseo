import { describe, expect, it } from "vitest";
import { extractWorkflowAgentHandoff, isWorkflowAgentHandoff } from "./workflow-agent-handoff.js";

describe("Workflow Agent Handoff Extractor", () => {
  it("extracts a valid paseo-workflow-handoff JSON block", () => {
    const text = `完成。\n\n\`\`\`paseo-workflow-handoff
{"version":1,"phase":"design","nextAction":"ask_user","summary":"需要范围确认","question":"是否保留审计？","artifactReferences":[]}
\`\`\``;

    const result = extractWorkflowAgentHandoff(text);
    expect(isWorkflowAgentHandoff(result)).toBe(true);
    expect(result).toMatchObject({
      version: 1,
      phase: "design",
      nextAction: "ask_user",
      summary: "需要范围确认",
      question: "是否保留审计？",
      artifactReferences: [],
    });
  });

  it("extracts the LAST handoff block when multiple exist", () => {
    const text = `
初步构思：
\`\`\`paseo-workflow-handoff
{"version":1,"phase":"draft","nextAction":"ask_user","summary":"初始草稿","artifactReferences":[]}
\`\`\`

进一步思考后，最终决定：
\`\`\`paseo-workflow-handoff
{"version":1,"phase":"design","nextAction":"await_design_approval","summary":"最终方案","artifactReferences":["art_spec_1"]}
\`\`\`
`;

    const result = extractWorkflowAgentHandoff(text);
    expect(isWorkflowAgentHandoff(result)).toBe(true);
    expect(result).toMatchObject({
      phase: "design",
      nextAction: "await_design_approval",
      summary: "最终方案",
      artifactReferences: ["art_spec_1"],
    });
  });

  it("returns missing_block error when no handoff code fence exists", () => {
    const text = "我完成了任务，但是忘记输出结构化 handoff block 了。";
    const result = extractWorkflowAgentHandoff(text);
    expect(isWorkflowAgentHandoff(result)).toBe(false);
    expect(result).toMatchObject({
      error: "missing_block",
    });
  });

  it("returns invalid_json error when handoff block contains invalid JSON", () => {
    const text = `\`\`\`paseo-workflow-handoff
{ bad json here: missing quotes }
\`\`\``;
    const result = extractWorkflowAgentHandoff(text);
    expect(isWorkflowAgentHandoff(result)).toBe(false);
    expect(result).toMatchObject({
      error: "invalid_json",
    });
  });

  it("returns schema_validation_failed error when nextAction is unknown", () => {
    const text = `\`\`\`paseo-workflow-handoff
{"version":1,"phase":"design","nextAction":"unknown_action","summary":"无效动作","artifactReferences":[]}
\`\`\``;
    const result = extractWorkflowAgentHandoff(text);
    expect(isWorkflowAgentHandoff(result)).toBe(false);
    expect(result).toMatchObject({
      error: "schema_validation_failed",
    });
  });

  it("returns schema_validation_failed error when required fields are missing", () => {
    const text = `\`\`\`paseo-workflow-handoff
{"version":1,"nextAction":"ask_user"}
\`\`\``;
    const result = extractWorkflowAgentHandoff(text);
    expect(isWorkflowAgentHandoff(result)).toBe(false);
    expect(result).toMatchObject({
      error: "schema_validation_failed",
    });
  });
});
