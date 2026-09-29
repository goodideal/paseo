import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import {
  AuditRecordSchema,
  DesktopPetSettingsSchema,
  PetDashboardSnapshotSchema,
} from "./types.js";

export const getDashboardRpc = defineRpc({
  name: "pet.get_dashboard",
  input: z.object({}),
  output: PetDashboardSnapshotSchema,
});

export const getAuditLogsRpc = defineRpc({
  name: "pet.get_audit_logs",
  input: z.object({
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
    unreadOnly: z.boolean().optional(),
  }),
  output: z.object({
    records: z.array(AuditRecordSchema),
    total: z.number().int().min(0),
  }),
});

export const markAuditReviewedRpc = defineRpc({
  name: "pet.mark_audit_reviewed",
  input: z.object({ id: z.string() }),
  output: z.object({ success: z.boolean() }),
});

export const respondPermissionRpc = defineRpc({
  name: "pet.respond_permission",
  input: z.object({
    agentId: z.string(),
    requestId: z.string(),
    behavior: z.enum(["allow", "deny"]),
  }),
  output: z.object({ success: z.boolean() }),
});

export const petSettingsDefinition = defineSettings({
  id: "desktop-pet-settings",
  scope: "host",
  version: 1,
  schema: DesktopPetSettingsSchema,
});
