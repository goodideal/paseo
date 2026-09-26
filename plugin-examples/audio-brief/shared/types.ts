import type { z } from "zod";
import type { audioBriefSynthesizeRpc } from "./contracts.js";

export type AudioBriefSynthesizeInput = z.infer<typeof audioBriefSynthesizeRpc.input>;
export type AudioBriefSynthesizeOutput = z.infer<typeof audioBriefSynthesizeRpc.output>;
