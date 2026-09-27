import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";

export const inspectUrlRpc = defineRpc({
  name: "web_inspector.diagnose.request",
  input: z.object({
    url: z.string().url(),
  }),
  output: z.object({
    url: z.string(),
    screenshotBase64: z.string(),
    consoleLogs: z.array(
      z.object({
        type: z.enum(["log", "warn", "error", "info", "debug"]),
        text: z.string(),
        location: z.string().optional(),
      }),
    ),
    networkErrors: z.array(
      z.object({
        url: z.string(),
        status: z.number(),
        statusText: z.string(),
        method: z.string(),
      }),
    ),
    diagnostics: z.string().optional(),
  }),
});

export type InspectOutput = z.infer<typeof inspectUrlRpc.output>;

// Attachment source RPC
export const searchInspectorRpc = defineRpc({
  name: "web_inspector.attachment.search",
  input: z.object({ query: z.string() }),
  output: PluginAttachmentSearchPayloadSchema,
});
