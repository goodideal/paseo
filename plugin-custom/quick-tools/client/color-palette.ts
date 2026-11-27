import {
  DEFAULT_LOCAL_LABEL_COLOR,
  WORKSPACE_LABEL_COLORS,
  type QuickPromptColor,
  type WorkspaceLabelColor,
} from "../shared/contracts.js";

export interface PromptColorTheme {
  label: string;
  dotColor: string;
  border: string;
  tint: string;
  text: string;
}

interface WorkspaceLabelIdentitySpec {
  label: string;
  baseHex: string;
  lightText: string;
  darkText: string;
}

// Aligned with Paseo's identity color tokens (packages/app/src/styles/identity-colors.ts)
// so light and dark themes both clear WCAG AA contrast (> 5.3:1 light, > 6.3:1 dark).
const WORKSPACE_LABEL_IDENTITY_SPECS: Record<WorkspaceLabelColor, WorkspaceLabelIdentitySpec> = {
  violet: {
    label: "Violet",
    baseHex: "#7a6aa8",
    lightText: "#6d49b5",
    darkText: "#a392d5",
  },
  sky: {
    label: "Sky",
    baseHex: "#3d7ea6",
    lightText: "#3d6985",
    darkText: "#6aa6ce",
  },
  emerald: {
    label: "Emerald",
    baseHex: "#388068",
    lightText: "#3e6e5d",
    darkText: "#6cae96",
  },
  orange: {
    label: "Orange",
    baseHex: "#a4673a",
    lightText: "#845838",
    darkText: "#cc8f64",
  },
  pink: {
    label: "Pink",
    baseHex: "#b05c80",
    lightText: "#974168",
    darkText: "#d87da3",
  },
  indigo: {
    label: "Indigo",
    baseHex: "#6a70b8",
    lightText: "#5251c2",
    darkText: "#9299d5",
  },
  teal: {
    label: "Teal",
    baseHex: "#368080",
    lightText: "#3e6d6c",
    darkText: "#6cacab",
  },
  red: {
    label: "Red",
    baseHex: "#b06260",
    lightText: "#9c4243",
    darkText: "#d88381",
  },
  amber: {
    label: "Amber",
    baseHex: "#8f7838",
    lightText: "#716239",
    darkText: "#b29d64",
  },
  blue: {
    label: "Blue",
    baseHex: "#5179b0",
    lightText: "#39649e",
    darkText: "#7ba1d5",
  },
};

function buildLabelColorTheme(
  spec: WorkspaceLabelIdentitySpec,
  scheme: "light" | "dark",
): PromptColorTheme {
  const ink = scheme === "light" ? spec.lightText : spec.darkText;
  return {
    label: spec.label,
    dotColor: ink,
    border: ink,
    tint: `${spec.baseHex}1a`,
    text: ink,
  };
}

export const WORKSPACE_LABEL_COLOR_PALETTE: Record<WorkspaceLabelColor, PromptColorTheme> =
  Object.fromEntries(
    WORKSPACE_LABEL_COLORS.map((color) => [
      color,
      buildLabelColorTheme(WORKSPACE_LABEL_IDENTITY_SPECS[color], "dark"),
    ]),
  ) as Record<WorkspaceLabelColor, PromptColorTheme>;

export const WORKSPACE_LABEL_LIGHT_COLOR_PALETTE: Record<WorkspaceLabelColor, PromptColorTheme> =
  Object.fromEntries(
    WORKSPACE_LABEL_COLORS.map((color) => [
      color,
      buildLabelColorTheme(WORKSPACE_LABEL_IDENTITY_SPECS[color], "light"),
    ]),
  ) as Record<WorkspaceLabelColor, PromptColorTheme>;

export function isLightSurfaceColor(hexColor?: string): boolean {
  if (!hexColor || typeof hexColor !== "string") return false;
  const cleaned = hexColor.trim().replace(/^#/, "");
  let r = 0;
  let g = 0;
  let b = 0;
  if (cleaned.length === 3) {
    r = Number.parseInt(cleaned[0] + cleaned[0], 16);
    g = Number.parseInt(cleaned[1] + cleaned[1], 16);
    b = Number.parseInt(cleaned[2] + cleaned[2], 16);
  } else if (cleaned.length >= 6) {
    r = Number.parseInt(cleaned.slice(0, 2), 16);
    g = Number.parseInt(cleaned.slice(2, 4), 16);
    b = Number.parseInt(cleaned.slice(4, 6), 16);
  } else {
    return false;
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return false;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55;
}

export function resolveWorkspaceLabelColorTheme(
  color: WorkspaceLabelColor,
  surfaceHex?: string,
): PromptColorTheme {
  const palette = isLightSurfaceColor(surfaceHex)
    ? WORKSPACE_LABEL_LIGHT_COLOR_PALETTE
    : WORKSPACE_LABEL_COLOR_PALETTE;
  return palette[color] ?? palette[DEFAULT_LOCAL_LABEL_COLOR];
}

const ORDERED_LABEL_OPTION_COLORS: readonly WorkspaceLabelColor[] = [
  "sky",
  "violet",
  "emerald",
  "orange",
  "pink",
  "indigo",
  "teal",
  "red",
  "amber",
  "blue",
];

export const WORKSPACE_LABEL_COLOR_OPTIONS: readonly {
  label: string;
  value: WorkspaceLabelColor;
}[] = ORDERED_LABEL_OPTION_COLORS.map((value) => ({
  label: WORKSPACE_LABEL_IDENTITY_SPECS[value].label,
  value,
}));

export const PROMPT_COLOR_PALETTE: Record<QuickPromptColor, PromptColorTheme> = {
  neutral: {
    label: "默认",
    dotColor: "#9ca3af",
    border: "#404040",
    tint: "transparent",
    text: "#f3f4f6",
  },
  sky: {
    label: "天蓝",
    dotColor: "#38bdf8",
    border: "#38bdf8",
    tint: "rgba(56, 189, 248, 0.12)",
    text: "#38bdf8",
  },
  emerald: {
    label: "翠绿",
    dotColor: "#34d399",
    border: "#34d399",
    tint: "rgba(52, 211, 153, 0.12)",
    text: "#34d399",
  },
  amber: {
    label: "琥珀",
    dotColor: "#fbbf24",
    border: "#fbbf24",
    tint: "rgba(251, 191, 36, 0.12)",
    text: "#fbbf24",
  },
  rose: {
    label: "玫瑰",
    dotColor: "#fb7185",
    border: "#fb7185",
    tint: "rgba(251, 113, 133, 0.12)",
    text: "#fb7185",
  },
  violet: {
    label: "紫罗兰",
    dotColor: "#a78bfa",
    border: "#a78bfa",
    tint: "rgba(167, 139, 250, 0.12)",
    text: "#a78bfa",
  },
  indigo: {
    label: "靛蓝",
    dotColor: "#818cf8",
    border: "#818cf8",
    tint: "rgba(129, 140, 248, 0.12)",
    text: "#818cf8",
  },
};

export const COMMON_PROMPT_ICONS = [
  { name: "Rocket", label: "火箭" },
  { name: "Zap", label: "闪电" },
  { name: "Bug", label: "调试" },
  { name: "FlaskConical", label: "测试" },
  { name: "Eye", label: "审查" },
  { name: "Sparkles", label: "闪光" },
  { name: "Wrench", label: "修复" },
  { name: "Play", label: "执行" },
  { name: "CheckCircle2", label: "完成" },
  { name: "GitPullRequest", label: "PR" },
  { name: "Terminal", label: "终端" },
  { name: "FileSearch", label: "搜索" },
] as const;
