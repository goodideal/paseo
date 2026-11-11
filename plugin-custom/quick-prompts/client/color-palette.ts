import type { QuickPromptColor } from "../shared/contracts.js";

export interface PromptColorTheme {
  label: string;
  dotColor: string;
  border: string;
  tint: string;
  text: string;
}

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
