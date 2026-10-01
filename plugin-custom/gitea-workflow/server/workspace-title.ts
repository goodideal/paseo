export type IssueKind = "bug" | "feature";

export type LabelLike = { name: string } | string;

const BUG_LABEL_REGEX = /^(bug|defect|故障|缺陷|crash)/i;
const FEATURE_LABEL_REGEX = /^(feat|feature|enhancement|req|需求)/i;

const BUG_TITLE_KEYWORDS = [
  "bug",
  "defect",
  "crash",
  "fix",
  "修复",
  "缺陷",
  "报错",
  "异常",
  "崩溃",
  "白屏",
];

const FEATURE_TITLE_KEYWORDS = ["feat", "feature", "req", "需求", "支持", "新增", "实现", "优化"];

/**
 * Detect whether an issue represents a Bug or a Feature.
 */
export function detectIssueKind(rawTitle: string, labels?: LabelLike[]): IssueKind {
  if (labels && labels.length > 0) {
    for (const label of labels) {
      const name = typeof label === "string" ? label : label?.name;
      if (!name) continue;
      const trimmed = name.trim();
      if (BUG_LABEL_REGEX.test(trimmed)) return "bug";
      if (FEATURE_LABEL_REGEX.test(trimmed)) return "feature";
    }
  }

  const lower = rawTitle.toLowerCase();
  for (const kw of BUG_TITLE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      return "bug";
    }
  }

  for (const kw of FEATURE_TITLE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      return "feature";
    }
  }

  return "feature";
}

/**
 * Strips noise metadata prefixes from an issue title (e.g. [req/TR], [S], [P1], SP1, [BUG], etc.)
 */
export function cleanIssueTitle(rawTitle: string): string {
  if (!rawTitle) return "";
  let current = rawTitle.trim();

  // 1. Repeatedly strip leading noise bracket tags:
  // e.g. [req/TR], [S], [P1], [SP1], [BUG], [Feat], [Fix], [Core] only when preceded by other noise
  const bracketNoisePattern =
    /^\[\s*(?:sp\d+|p[0-4]|s|m|l|xl|req\/[^\]]+|req|feat(?:ure)?|bug|defect|fix|task|chore|doc(?:s)?)\s*\]\s*/i;

  let matched = true;
  while (matched) {
    matched = false;
    const m = current.match(bracketNoisePattern);
    if (m) {
      current = current.slice(m[0].length).trim();
      matched = true;
    }
  }

  // 2. Strip leading bare noise like SP1:, SP1 -, P0:, fix(auth):, feat:
  const bareNoisePattern =
    /^(?:sp\d+|p[0-4]|(?:feat(?:ure)?|fix|bug|defect|chore|req)(?:\([^)]*\))?)\s*[:：\-—]\s*/i;
  const bareMatch = current.match(bareNoisePattern);
  if (bareMatch) {
    current = current.slice(bareMatch[0].length).trim();
  }

  // 3. Clean any remaining leading punctuation like ':', '-', '：'
  current = current.replace(/^[:：\-—_]\s*/, "").trim();

  // 4. If all text was stripped away, fallback to original title
  if (!current) {
    return rawTitle.trim();
  }

  return current;
}

export interface FormatWorkspaceTitleOptions {
  issueNumber: number;
  rawTitle: string;
  labels?: LabelLike[];
}

/**
 * Formats a clean, high-signal Workspace Title for Gitea Workflow:
 * e.g.
 * - 🐞 #99 [Bug] 修复登录白屏崩溃问题
 * - ✨ #138 [Feature] 支持下游断连感知与上游流式推理的主动取消熔断
 */
export function formatWorkflowWorkspaceTitle(options: FormatWorkspaceTitleOptions): string {
  const { issueNumber, rawTitle, labels } = options;
  const kind = detectIssueKind(rawTitle, labels);
  const clean = cleanIssueTitle(rawTitle);

  const prefix = kind === "bug" ? "🐞" : "✨";
  const tag = kind === "bug" ? "[Bug]" : "[Feature]";

  return `${prefix} #${issueNumber} ${tag} ${clean}`;
}
