import { z } from "zod";
import { defineSettings } from "@getpaseo/plugin";

export const authSettings = defineSettings({
  id: "web-inspector",
  scope: "host",
  version: 1,
  schema: z.object({
    cookieString: z.string().default(""),
    extraHeaders: z.string().default(""),
  }),
});
