import type { QuickPromptItem } from "../shared/contracts.js";

export interface ExtractedOption {
  index: string;
  shortLabel: string;
  title?: string;
  summary: string;
  fullPayload: string;
}

export interface ExtractorOptions {
  logger?: (message: string, meta?: unknown) => void;
}

export interface ExtractorDiagnostic {
  decision: "matched_binary" | "matched_options" | "rejected";
  reason: string;
  candidateCount?: number;
  totalLines?: number;
  hasAnchor?: boolean;
}

const STRICT_BINARY_PATTERNS = [
  /\b(?:confirm|proceed|continue)\?\s*\([yY]\/[nN]\)/i,
  /\([yY]\/[nN]\)/i,
  /\[[yY]\/[nN]\]/i,
  /(?:是否继续|确认继续|确认执行|是否执行|是否开始)(?:该操作|此操作|任务|方案|变更)?[？?]/,
];

const BINARY_EXCLUDE_PATTERNS = [
  /(?:哪种|哪一个|何种|怎么|如何|期望|意见|建议|何者|反馈)/,
  /(?:第\s*\d+\s*部分|第一部分|第二部分|第三部分)/,
];

// Anchors indicating a choice question
const CHOICE_QUESTION_ANCHORS = [
  /(?:请问(?:您的|你的)?(?:目标|偏好|选择)是)/i,
  /(?:请(?:从中)?(?:选择|挑选)|你(?:希望|想要|打算|倾向于)?(?:选择|使用|采用))/i,
  /(?:有以下|如下|提供以下).*(?:选择|方案|选项).*(?:供选择|供参考|供你选择|供您选择)?/i,
  /(?:which\s+.*(?:do you|would you|prefer|choose|recommend|one\b)|choose between|would you prefer|select one of)/i,
  /(?:please\s+choose|choose\s+(?:from|one|between)|which\s+(?:one|option|approach|path))/i,
  /(?:希望如何|如何处理|如何执行|选择哪(?:一|个|种)|选择哪|何去何从)/i,
];

// Negative context patterns that indicate reports, summaries, changelogs, architecture notes
const REPORT_OR_SUMMARY_PATTERNS = [
  /(?:已完成|已交付|修改如下|变更如下|改动如下|工作区状态|健康状态|测试通过|全部通过|用例通过|通过以下|审查通过|总结如下|回顾如下|本次改动|测试与质量|审查问题彻底闭环)/i,
  /(?:Status|Summary|Completed|Passed|Changelog|All tests passed)/i,
  /(?:裁决如下|优先级模型|状态流转|架构设计)/i,
];

const CHINESE_DIGIT_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function emitLog(
  logger: ((message: string, meta?: unknown) => void) | undefined,
  message: string,
  meta?: unknown,
): void {
  const taggedMsg = `[QuickPrompts:Extractor] ${message}`;
  if (logger) {
    logger(taggedMsg, meta);
  } else {
    console.debug(taggedMsg, meta !== undefined ? meta : "");
  }
}

/**
 * Strips fenced code blocks to prevent code samples from being misparsed as options.
 */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

/**
 * Checks if the message explicitly asks for a binary (yes/no) confirmation.
 */
function extractBinaryConfirmationOptions(
  text: string,
  isZh: boolean,
  options?: ExtractorOptions,
): QuickPromptItem[] | null {
  // Check exclude patterns first (open-ended / multi-stage reviews)
  if (BINARY_EXCLUDE_PATTERNS.some((p) => p.test(text))) {
    return null;
  }

  const matchedPattern = STRICT_BINARY_PATTERNS.find((pattern) => pattern.test(text));
  if (!matchedPattern) {
    return null;
  }

  emitLog(options?.logger, `Matched binary confirmation pattern: "${matchedPattern.toString()}"`);

  const now = Date.now();
  return [
    {
      id: "ephemeral-confirm-yes",
      label: isZh ? "确认继续" : "Proceed",
      content: isZh ? "确认，请按照方案继续执行。" : "Yes, please proceed with this.",
      shortcut: "yes",
      triggerType: "ephemeral",
      enabled: true,
      ephemeral: true,
      createdAt: now,
      order: -100,
    },
    {
      id: "ephemeral-confirm-no",
      label: isZh ? "取消操作" : "Cancel",
      content: isZh ? "取消，请中止该操作。" : "No, please cancel this operation.",
      shortcut: "no",
      triggerType: "ephemeral",
      enabled: true,
      ephemeral: true,
      createdAt: now,
      order: -99,
    },
  ];
}

/**
 * Removes redundant formatting, markdown tags, backticks, and option prefixes.
 */
export function cleanOptionTitle(raw: string): string {
  let title = raw.trim();
  // Strip outer quotes, bold, italic
  title = title.replace(/^[*_~`]+|[*_~`]+$/g, "");
  // Strip inner markdown backticks: `main` -> main
  title = title.replace(/`([^`]+)`/g, "$1");
  // Strip leading numbering or prefix e.g. "方案 1:", "Option 1 -", "1.", "1、", "一、"
  title = title
    .replace(/^(?:(?:方案|选项|Option)\s*[0-9A-Za-z一二三四五六七八九十]+[:：\-—\s]*)/i, "")
    .replace(
      /^(?:(?:\d{1,2}|[A-Za-z]|[一二三四五六七八九十]{1,2})[)）\]、.:：\-—]|[(（[](?:[0-9A-Za-z]|[一二三四五六七八九十]{1,2})[)）\]][:：、.\-—\s]?)\s*/,
      "",
    )
    .replace(/^[*_~`]+|[*_~`]+$/g, "")
    .trim();
  return title;
}

/**
 * Extracts concise title from an option body.
 */
function extractConciseTitle(body: string): { title?: string; summary: string } {
  const trimmed = body.trim();

  // 1. Look for bold title: **Title**: description or **Title** - description
  const boldMatch = trimmed.match(/^\*\*([^*]+)\*\*(?:[:：\-—\s]*(.*))?$/);
  if (boldMatch) {
    const rawTitle = boldMatch[1].trim();
    const rest = boldMatch[2]?.trim() ?? "";
    const cleanTitle = cleanOptionTitle(rawTitle);
    const summary = rest ? `${cleanTitle}: ${cleanOptionTitle(rest).slice(0, 50)}` : cleanTitle;
    return {
      title: cleanTitle.length <= 24 ? cleanTitle : `${cleanTitle.slice(0, 22)}...`,
      summary,
    };
  }

  // 2. Look for delimiter: Title: Rest or Title - Rest
  const delimiterMatch = trimmed.match(/^([^:：\-—\n]{2,30})[:：\-—]\s*(.+)$/);
  if (delimiterMatch) {
    const rawTitle = delimiterMatch[1].trim();
    const rest = delimiterMatch[2].trim();
    const cleanTitle = cleanOptionTitle(rawTitle);
    const summary = `${cleanTitle}: ${cleanOptionTitle(rest).slice(0, 50)}`;
    return {
      title: cleanTitle.length <= 24 ? cleanTitle : `${cleanTitle.slice(0, 22)}...`,
      summary,
    };
  }

  // 3. Parentheses: Title（explanation）
  const parenMatch = trimmed.match(/^([^（(]{2,20})[（(]([^）)]+)[）)]\s*[?？]?$/);
  if (parenMatch) {
    const cleanTitle = cleanOptionTitle(parenMatch[1]);
    return { title: cleanTitle, summary: cleanOptionTitle(trimmed) };
  }

  // 4. Plain text: use the first short sentence or slice
  const firstSentence = trimmed.split(/[.。!！?？\n]/)[0].trim();
  const clean = cleanOptionTitle(firstSentence);
  return {
    title: clean.length <= 24 ? clean : `${clean.slice(0, 22)}...`,
    summary: clean.slice(0, 60),
  };
}

interface ParsedCandidate {
  rawIndex: string;
  normalizedIndex: number | string;
  body: string;
  lineIndex: number;
}

function parseCandidateLine(line: string, lineIndex: number): ParsedCandidate | null {
  // 1. Digits: 1. / 1) / 1、 / (1) / （1） / [1]
  const digitMatch = line.match(
    /^\s*(?:(\d{1,2})[.)、]|[(（](\d{1,2})[)）]|\[(\d{1,2})\])\s*(.+)$/,
  );
  if (digitMatch) {
    const raw = digitMatch[1] || digitMatch[2] || digitMatch[3];
    const body = digitMatch[4].trim();
    if (raw && body) {
      return {
        rawIndex: raw,
        normalizedIndex: Number.parseInt(raw, 10),
        body,
        lineIndex,
      };
    }
  }

  // 2. Letters: A. / A) / A、 / (A) / （A） / [A]
  const letterMatch = line.match(
    /^\s*(?:([A-Fa-f])[.)、]|[(（]([A-Fa-f])[)）]|\[([A-Fa-f])\])\s*(.+)$/,
  );
  if (letterMatch) {
    const raw = (letterMatch[1] || letterMatch[2] || letterMatch[3]).toUpperCase();
    const body = letterMatch[4].trim();
    if (raw && body) {
      return {
        rawIndex: raw,
        normalizedIndex: raw,
        body,
        lineIndex,
      };
    }
  }

  // 3. Chinese digits: 一、 / 二、 / （一） / (一)
  const cnMatch = line.match(
    /^\s*(?:([一二三四五六七八九十])[、.）)]|[(（]([一二三四五六七八九十])[)）])\s*(.+)$/,
  );
  if (cnMatch) {
    const raw = cnMatch[1] || cnMatch[2];
    const body = cnMatch[3].trim();
    if (raw && body && CHINESE_DIGIT_MAP[raw]) {
      return {
        rawIndex: raw,
        normalizedIndex: CHINESE_DIGIT_MAP[raw],
        body,
        lineIndex,
      };
    }
  }

  // 4. Prefixes: 方案 1: / 选项 A: / Option 1:
  const prefixMatch = line.match(
    /^\s*(?:(?:方案|选项|Option)\s*([0-9A-Fa-f一二三四五六七八九十])[:：\-—\s])\s*(.+)$/i,
  );
  if (prefixMatch) {
    const raw = prefixMatch[1];
    const body = prefixMatch[2].trim();
    if (raw && body) {
      const mapped =
        CHINESE_DIGIT_MAP[raw] ?? (/\d+/.test(raw) ? Number.parseInt(raw, 10) : raw.toUpperCase());
      return {
        rawIndex: raw,
        normalizedIndex: mapped,
        body,
        lineIndex,
      };
    }
  }

  return null;
}

/**
 * Parses assistant message for numbered or lettered option items.
 */
export function extractEphemeralOptions(
  assistantText?: string | null,
  locale: string = "en",
  options?: ExtractorOptions,
): QuickPromptItem[] {
  if (!assistantText || !assistantText.trim()) {
    emitLog(options?.logger, "Skipped: empty assistant text");
    return [];
  }

  const isZh = locale.toLowerCase().startsWith("zh");
  const cleanText = stripCodeBlocks(assistantText);

  // 1. Check for binary confirmation prompts first
  const binaryOptions = extractBinaryConfirmationOptions(cleanText, isZh, options);
  if (binaryOptions) {
    return binaryOptions;
  }

  // 2. Parse candidate option lines
  const lines = cleanText.split("\n");
  const candidates: ParsedCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const candidate = parseCandidateLine(lines[i], i);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  // Require between 2 and 6 options
  if (candidates.length < 2 || candidates.length > 6) {
    emitLog(
      options?.logger,
      `Rejected: candidate count (${candidates.length}) outside acceptable range [2, 6]`,
    );
    return [];
  }

  // 3. Check for Report / Summary Context (Strong Negative Anchor)
  const firstOptionLine = candidates[0].lineIndex;
  const lastOptionLine = candidates[candidates.length - 1].lineIndex;

  // Inspect up to 5 lines preceding the first option for summary / report headings
  const contextLinesBefore = lines
    .slice(Math.max(0, firstOptionLine - 5), firstOptionLine)
    .join("\n");

  const hasSummaryHeading = REPORT_OR_SUMMARY_PATTERNS.some((p) => p.test(contextLinesBefore));
  const hasChoiceAnchor = CHOICE_QUESTION_ANCHORS.some(
    (p) =>
      p.test(contextLinesBefore) ||
      p.test(lines.slice(lastOptionLine, lastOptionLine + 3).join("\n")),
  );

  // If there is an explicit summary header and NO explicit choice anchor, reject immediately
  if (hasSummaryHeading && !hasChoiceAnchor) {
    emitLog(
      options?.logger,
      "Rejected: detected completed summary/report context without choice question anchor",
    );
    return [];
  }

  // Without a choice anchor, ordinary lists should not be treated as prompt buttons
  if (!hasChoiceAnchor) {
    emitLog(
      options?.logger,
      "Rejected: no explicit choice question anchor found around option list",
    );
    return [];
  }

  // 4. Verify sequential progression (e.g. 1, 2, 3 or A, B, C)
  const isNumbered = typeof candidates[0].normalizedIndex === "number";
  if (isNumbered) {
    const baseNum = candidates[0].normalizedIndex as number;
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].normalizedIndex !== baseNum + i) {
        emitLog(
          options?.logger,
          `Rejected: non-sequential numeric sequence at index ${i} (${candidates[i].normalizedIndex} !== ${baseNum + i})`,
        );
        return [];
      }
    }
  } else {
    const baseCode = (candidates[0].normalizedIndex as string).charCodeAt(0);
    for (let i = 0; i < candidates.length; i++) {
      const expected = String.fromCharCode(baseCode + i);
      if (candidates[i].normalizedIndex !== expected) {
        emitLog(
          options?.logger,
          `Rejected: non-sequential letter sequence at index ${i} (${candidates[i].normalizedIndex} !== ${expected})`,
        );
        return [];
      }
    }
  }

  // 5. Build prompt items
  const now = Date.now();
  const result: QuickPromptItem[] = candidates.map((candidate, idx) => {
    const { normalizedIndex, body } = candidate;
    const { title } = extractConciseTitle(body);

    const displayIndex = String(normalizedIndex);
    let label: string;
    if (title && title.length > 0) {
      label = `${displayIndex}. ${title}`;
    } else {
      label = isZh ? `方案 ${displayIndex}` : `Option ${displayIndex}`;
    }

    let content: string;
    if (isZh) {
      content = title
        ? `我选择方案 ${displayIndex}（${title}），请继续执行。`
        : `我选择方案 ${displayIndex}，请继续执行。`;
    } else {
      content = title
        ? `I choose Option ${displayIndex} (${title}). Please proceed.`
        : `I choose Option ${displayIndex}. Please proceed.`;
    }

    const shortcut = isNumbered ? `opt${displayIndex}` : `opt${displayIndex.toLowerCase()}`;

    emitLog(
      options?.logger,
      `Extracted option ${displayIndex}: label="${label}", shortcut="${shortcut}"`,
    );

    return {
      id: `ephemeral-opt-${displayIndex.toLowerCase()}`,
      label,
      content,
      shortcut,
      triggerType: "ephemeral",
      enabled: true,
      ephemeral: true,
      createdAt: now,
      order: -100 + idx,
    };
  });

  emitLog(options?.logger, `Successfully extracted ${result.length} ephemeral prompt options`);

  return result;
}
