import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const audioBriefSynthesizeRpc = defineRpc({
  name: "audio_brief.synthesize.request",
  input: z.object({
    agentId: z.string(),
    turnId: z.string(),
    text: z.string(),
    customPrompt: z.string().optional(),
    forceRefresh: z.boolean().optional(),
  }),
  output: z.object({
    briefText: z.string(),
    audioBase64: z.string().optional(),
    mimeType: z.string().optional(),
    durationMs: z.number().optional(),
    error: z.string().nullable().optional(),
  }),
});

export type AudioBriefSynthesizeInput = z.infer<typeof audioBriefSynthesizeRpc.input>;
export type AudioBriefSynthesizeOutput = z.infer<typeof audioBriefSynthesizeRpc.output>;
