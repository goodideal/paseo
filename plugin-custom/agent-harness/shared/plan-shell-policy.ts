/**
 * Policy for detecting read-only shell commands during planning/design phase.
 * Prevents unnecessary permission prompts for discovery/inspection commands,
 * while strictly rejecting modification, execution, or redirection writes.
 */

// Commands that are purely read-only or informational
const READ_ONLY_COMMAND_ROOTS = new Set([
  "pwd",
  "ls",
  "dir",
  "find",
  "grep",
  "rg",
  "tree",
  "cat",
  "head",
  "tail",
  "wc",
  "cd",
  "echo",
  "which",
  "where",
  "whoami",
  "file",
  "stat",
  "diff",
  "git",
  "rtk",
  "test",
  "[",
  "[[",
  "true",
  "false",
]);

// Git subcommands that are strictly read-only
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "branch",
  "rev-parse",
  "blame",
  "describe",
  "tag",
  "remote",
  "check-ignore",
  "cat-file",
  "ls-files",
  "ls-remote",
  "var",
  "config", // will check flags below to reject --set, etc.
]);

// RTK subcommands that are read-only
const READ_ONLY_RTK_SUBCOMMANDS = new Set([
  "read",
  "ls",
  "find",
  "grep",
  "rg",
  "ast-grep",
  "tree",
  "wc",
  "diff",
  "json",
  "deps",
  "git",
]);

/**
 * Removes safe redirects like `2>/dev/null`, `2>&1`, `1>&2`, `< /dev/null`.
 * Also detects unsafe write redirects like `>`, `>>`, `&>`, `1>`, `| tee`.
 */
function checkAndStripRedirects(cmd: string): { sanitized: string; hasWriteRedirect: boolean } {
  let sanitized = cmd;

  // Check for unsafe tee
  if (/\btee\b/.test(sanitized)) {
    return { sanitized, hasWriteRedirect: true };
  }

  // Strip safe redirects:
  // e.g. 2>/dev/null, 2>&1, 1>&2, 2> /dev/null, < /dev/null, </dev/null
  sanitized = sanitized.replace(/\b2>\s*&1\b/g, "");
  sanitized = sanitized.replace(/\b1>\s*&2\b/g, "");
  sanitized = sanitized.replace(/\b2>\s*\/dev\/null\b/g, "");
  sanitized = sanitized.replace(/<\s*\/dev\/null\b/g, "");

  // Inspect remaining characters outside quotes for any write or read-write redirect (`>`, `>>`, `&>`, `<>`, `1>`)
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;
  for (let i = 0; i < sanitized.length; i++) {
    const ch = sanitized[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\" && !inSingleQuote) {
      escapeNext = true;
      continue;
    }
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote && ch === ">") {
      return { sanitized, hasWriteRedirect: true };
    }
  }

  return { sanitized: sanitized.trim(), hasWriteRedirect: false };
}

/**
 * Tokenize a single command line segment into arguments respecting quotes.
 */
function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\" && !inSingleQuote) {
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Evaluates whether a single command segment (without pipes or &&) is strictly read-only.
 */
function isSingleSegmentReadOnly(rawSegment: string): boolean {
  const trimmed = rawSegment.trim();
  if (!trimmed) {
    return true;
  }

  const { sanitized, hasWriteRedirect } = checkAndStripRedirects(trimmed);
  if (hasWriteRedirect) {
    return false;
  }

  const tokens = tokenizeSegment(sanitized);
  if (tokens.length === 0) {
    return true;
  }

  // Strip leading env var assignments: e.g. FOO=bar git status
  let startIndex = 0;
  while (startIndex < tokens.length && /^[a-zA-Z_][a-zA-Z0-9_]*=/.test(tokens[startIndex])) {
    startIndex++;
  }

  if (startIndex >= tokens.length) {
    return true;
  }

  let command = tokens[startIndex];
  // Strip path prefix if any: e.g. /usr/bin/git -> git
  if (command.includes("/")) {
    const parts = command.split("/");
    command = parts[parts.length - 1];
  }

  const args = tokens.slice(startIndex + 1);

  // Check sed: only `sed -n ...` (or -n as an option) is considered read-only
  if (command === "sed") {
    // Must have -n flag and NOT have -i (in-place)
    const hasN = args.some((arg) => arg === "-n" || (arg.startsWith("-") && arg.includes("n")));
    const hasI = args.some((arg) => arg === "-i" || (arg.startsWith("-") && arg.includes("i")));
    return hasN && !hasI;
  }

  // Check awk / perl / python: too easy to write or invoke system, reject
  if (command === "awk" || command === "perl" || command === "python" || command === "python3") {
    return false;
  }

  // Check git commands
  if (command === "git") {
    return isGitReadOnly(args);
  }

  // Check rtk wrapper
  if (command === "rtk") {
    return isRtkReadOnly(args);
  }

  // Check ocr delegate read-only commands
  if (command === "ocr") {
    return isOcrReadOnly(args);
  }

  // Check standard read-only commands
  if (READ_ONLY_COMMAND_ROOTS.has(command)) {
    return true;
  }

  return false;
}

/**
 * Validates git command arguments.
 */
function isGitReadOnly(args: string[]): boolean {
  // Strip git flags before subcommand: e.g. git -C /path status, git --no-pager diff
  let subcmdIndex = 0;
  while (subcmdIndex < args.length) {
    const arg = args[subcmdIndex];
    if (arg === "-C" || arg === "--git-dir" || arg === "--work-tree") {
      subcmdIndex += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      subcmdIndex++;
      continue;
    }
    break;
  }

  if (subcmdIndex >= args.length) {
    // e.g. `git` alone or `git --version`
    return true;
  }

  const subcmd = args[subcmdIndex];
  if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcmd)) {
    return false;
  }

  // Additional check for `git config`: only read is allowed, not --set, --add, etc.
  if (subcmd === "config") {
    const forbiddenFlags = new Set([
      "--replace-all",
      "--add",
      "--unset",
      "--unset-all",
      "--rename-section",
      "--remove-section",
    ]);
    if (args.some((a) => forbiddenFlags.has(a))) {
      return false;
    }
  }

  return true;
}

/**
 * Validates rtk command arguments.
 */
function isRtkReadOnly(args: string[]): boolean {
  if (args.length === 0) {
    return true;
  }
  const subcmd = args[0];
  if (!READ_ONLY_RTK_SUBCOMMANDS.has(subcmd)) {
    return false;
  }

  // If rtk git ..., check sub-args
  if (subcmd === "git") {
    return isGitReadOnly(args.slice(1));
  }

  return true;
}

/**
 * Validates ocr command arguments (only LLM-Free read-only `ocr delegate preview|rule` and help/version).
 */
export function isOcrReadOnly(args: string[]): boolean {
  if (args.length === 0) {
    return true;
  }
  if (
    args.length === 1 &&
    (args[0] === "--version" || args[0] === "-V" || args[0] === "--help" || args[0] === "-h")
  ) {
    return true;
  }
  if (args[0] === "delegate" && (args[1] === "preview" || args[1] === "rule")) {
    return true;
  }
  return false;
}

/**
 * Split a complex command into segments across logical and/or and pipes.
 * Returns false immediately if background (&), sequence (;), or subshells () are used in risky ways.
 */
export function isReadOnlyShellCommand(command: string): boolean {
  if (typeof command !== "string") {
    return false;
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  // If command contains semicolons or backticks or command substitution $(...), be cautious
  // Allow simple substitution if needed, but for safety in plan mode, reject backticks and $(
  if (trimmed.includes("`") || trimmed.includes("$(")) {
    return false;
  }

  // Split by pipeline `|`, logical `&&`, and logical `||`
  // We need to parse while respecting quotes
  const segments: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\" && !inSingleQuote) {
      escapeNext = true;
      current += char;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      // Reject unquoted newlines, carriage returns, subshells, or process substitutions `<(...)` / `>(...)`
      if (char === "\n" || char === "\r" || char === "(" || char === ")") {
        return false;
      }

      // Reject semicolon chaining
      if (char === ";") {
        // If it's a semicolon, split as segment
        segments.push(current);
        current = "";
        continue;
      }

      // Check for && or ||
      if (char === "&" && trimmed[i + 1] === "&") {
        segments.push(current);
        current = "";
        i++; // skip second &
        continue;
      }

      if (char === "|" && trimmed[i + 1] === "|") {
        segments.push(current);
        current = "";
        i++; // skip second |
        continue;
      }

      // Check for standalone & (background) - reject
      if (char === "&" && trimmed[i + 1] !== "&") {
        // unless it's 2>&1 which is handled later, but here bare & could be background
        // if followed by space or end of string
        if (i === trimmed.length - 1 || /\s/.test(trimmed[i + 1])) {
          return false;
        }
      }

      // Check for pipe |
      if (char === "|") {
        segments.push(current);
        current = "";
        continue;
      }
    }

    current += char;
  }

  if (inSingleQuote || inDoubleQuote) {
    return false;
  }

  if (current.trim().length > 0) {
    segments.push(current);
  }

  if (segments.length === 0) {
    return false;
  }

  // All segments must be read-only
  for (const seg of segments) {
    if (!isSingleSegmentReadOnly(seg)) {
      return false;
    }
  }

  return true;
}
