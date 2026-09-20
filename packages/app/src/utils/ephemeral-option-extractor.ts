import type { QuickPromptItem } from "@/stores/quick-prompts-store";

export interface ExtractedOption {
  index: string;
  shortLabel: string;
  title?: string;
  summary: string;
  fullPayload: string;
}

const BINARY_CONFIRMATION_PATTERNS = [
  /\b(?:confirm|proceed|continue)\?\s*\([yY]\/[nN]\)/i,
  /\([yY]\/[nN]\)/i,
  /\[[yY]\/[nN]\]/i,
  /(?:是否继续|确认继续|是否确认|请确认|确认执行).*[？?]/,
];

const CHOICE_CONTEXT_PATTERNS = [
  /(?:which|choose|prefer|option|alternative|select)/i,
  /(?:选择|方案|哪一个|哪种|何者)/,
];

/**
 * Strips fenced code blocks to prevent code samples from being misparsed as options.
 */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

/**
 * Checks if the message explicitly asks for a binary (yes/no) confirmation.
 */
function extractBinaryConfirmationOptions(text: string, isZh: boolean): QuickPromptItem[] | null {
  const isBinary = BINARY_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(text));
  if (!isBinary) {
    return null;
  }

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
 * Extracts concise title from an option body.
 * Prefers bold markdown: 1. **Title**: description -> "Title"
 * Or before colon/dash: 1. Title - description -> "Title"
 */
function extractConciseTitle(body: string): { title?: string; summary: string } {
  const trimmed = body.trim();

  // 1. Look for bold title: **Title**
  const boldMatch = trimmed.match(/^\*\*([^*]+)\*\*(?:[:：\-—]\s*(.*))?$/);
  if (boldMatch) {
    const rawTitle = boldMatch[1].trim();
    const rest = boldMatch[2]?.trim() ?? "";
    const cleanTitle = cleanOptionPrefix(rawTitle);
    const summary = rest ? `${cleanTitle}: ${rest.slice(0, 50)}` : cleanTitle;
    return { title: cleanTitle, summary };
  }

  // 2. Look for delimiter: Title: Rest or Title - Rest
  const delimiterMatch = trimmed.match(/^([^:：\-—\n]{2,24})[:：\-—]\s*(.+)$/);
  if (delimiterMatch) {
    const rawTitle = delimiterMatch[1].trim();
    const rest = delimiterMatch[2].trim();
    const cleanTitle = cleanOptionPrefix(rawTitle);
    const summary = `${cleanTitle}: ${rest.slice(0, 50)}`;
    return { title: cleanTitle, summary };
  }

  // 3. Plain text: use the first short sentence or slice
  const firstSentence = trimmed.split(/[.。!！?？\n]/)[0].trim();
  const clean = cleanOptionPrefix(firstSentence);
  return {
    title: clean.length <= 12 ? clean : undefined,
    summary: clean.slice(0, 60),
  };
}

/**
 * Removes redundant "Option 1" or "方案 1" prefixes from extracted titles.
 */
function cleanOptionPrefix(title: string): string {
  return title
    .replace(/^[([]?[0-9A-Za-z][)\]][:：\s]*/, "")
    .replace(/^[([]?[0-9A-Za-z][)\]][:：\s]*/, "")
    .trim();
}

/**
 * Parses assistant message for numbered or lettered option items.
 */
export function extractEphemeralOptions(
  assistantText?: string | null,
  locale: string = "en",
): QuickPromptItem[] {
  if (!assistantText || !assistantText.trim()) {
    return [];
  }

  const isZh = locale.toLowerCase().startsWith("zh");
  const cleanText = stripCodeBlocks(assistantText);

  // 1. Check for binary confirmation prompts first
  const binaryOptions = extractBinaryConfirmationOptions(cleanText, isZh);
  if (binaryOptions) {
    return binaryOptions;
  }

  // 2. Parse ordered options (numbers or letters)
  const lines = cleanText.split("\n");
  const optionRegex = /^\s*(?:(\d{1,2})[.)]|\((\d{1,2})\)|([A-Da-d])[.)]|\(([A-Da-d])\))\s+(.+)$/;

  interface ParsedCandidate {
    indexStr: string;
    body: string;
    lineIndex: number;
  }

  const candidates: ParsedCandidate[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(optionRegex);
    if (match) {
      const indexStr = match[1] || match[2] || match[3] || match[4];
      const body = match[5].trim();
      if (indexStr && body) {
        candidates.push({ indexStr: indexStr.toUpperCase(), body, lineIndex: i });
      }
    }
  }

  // Require at least 2 options and at most 6 options
  if (candidates.length < 2 || candidates.length > 6) {
    return [];
  }

  // Check if options are near the end of the text (within last 80% or accompanied by choice prompt)
  const totalLines = lines.length;
  const firstOptionLine = candidates[0].lineIndex;
  const hasChoicePrompt = CHOICE_CONTEXT_PATTERNS.some((p) => p.test(cleanText));
  const isNearEnd = firstOptionLine >= Math.max(0, totalLines - 25);

  if (!hasChoicePrompt && !isNearEnd) {
    return [];
  }

  // Verify sequential progression (e.g. 1, 2, 3 or A, B, C)
  const firstIdx = candidates[0].indexStr;
  const isNumbered = /^\d+$/.test(firstIdx);
  if (isNumbered) {
    for (let i = 0; i < candidates.length; i++) {
      const expected = String(Number(candidates[0].indexStr) + i);
      if (candidates[i].indexStr !== expected) {
        return [];
      }
    }
  }

  const now = Date.now();
  return candidates.map((candidate, idx) => {
    const { indexStr, body } = candidate;
    const { title } = extractConciseTitle(body);

    // Build ultra-compact button label
    // If title is short (<= 10 chars), show `[1. Title]` or `[A. Title]`
    // Otherwise fallback to `[Option 1]` or `[选项 1]`
    let label: string;
    if (title && title.length > 0 && title.length <= 10) {
      label = `${indexStr}. ${title}`;
    } else {
      label = isZh ? `选项 ${indexStr}` : `Option ${indexStr}`;
    }

    // Build comprehensive full prompt payload
    let content: string;
    if (isZh) {
      content = title
        ? `我选择方案 ${indexStr}（${title}），请继续执行。`
        : `我选择方案 ${indexStr}，请继续执行。`;
    } else {
      content = title
        ? `I choose Option ${indexStr} (${title}). Please proceed.`
        : `I choose Option ${indexStr}. Please proceed.`;
    }

    const shortcut = isNumbered ? `opt${indexStr}` : `opt${indexStr.toLowerCase()}`;

    return {
      id: `ephemeral-opt-${indexStr.toLowerCase()}`,
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
}
