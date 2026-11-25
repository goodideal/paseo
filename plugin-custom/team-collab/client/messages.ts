import { defineTranslations } from "@getpaseo/plugin/client";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

export const TEAM_USAGE_SCREEN_ID = "team-usage" as const;
export const TEAM_SETTINGS_SCREEN_ID = "team-collab-settings" as const;

export const messages = defineTranslations({
  resources: {
    en,
    "zh-CN": zhCN,
  },
});
