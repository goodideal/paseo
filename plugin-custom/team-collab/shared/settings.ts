import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const TEAM_COLLAB_OWNER_META_KEY = "team-collab.owner" as const;
export const SYSTEM_BOT_MEMBER_ID = "system-bot" as const;
export const SYSTEM_BOT_DEFAULT_NAME = "System Bot" as const;
export const SYSTEM_BOT_DEFAULT_EMAIL = "system-bot@paseo.local" as const;

export const MEMBER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export const TeamMemberIdSchema = z
  .string()
  .trim()
  .regex(MEMBER_ID_PATTERN, "Member ID must match /^[a-z0-9][a-z0-9._-]{0,63}$/");

export const WorkspaceOwnerKindSchema = z.enum(["member", "bot"]);
export type WorkspaceOwnerKind = z.infer<typeof WorkspaceOwnerKindSchema>;

export const GitProviderKindSchema = z.enum(["gitea", "gitlab", "github", "generic"]);
export type GitProviderKind = z.infer<typeof GitProviderKindSchema>;

export const WorkspaceOwnerIdSchema = z.union([
  z.literal(SYSTEM_BOT_MEMBER_ID),
  TeamMemberIdSchema,
]);

export const WorkspaceOwnerMetadataSchema = z.object({
  id: WorkspaceOwnerIdSchema,
  name: z.string().min(1),
  email: z.string().min(1),
  kind: WorkspaceOwnerKindSchema,
  assignedAt: z.string().min(1),
});
export type WorkspaceOwnerMetadata = z.infer<typeof WorkspaceOwnerMetadataSchema>;

export const TeamMemberProfileSchema = z.object({
  id: TeamMemberIdSchema,
  name: z.string().trim().min(1),
  email: z
    .string()
    .trim()
    .min(3)
    .refine((val) => val.includes("@") && !/\s/.test(val), "Invalid email address"),
  gitProvider: GitProviderKindSchema.optional(),
  gitUsername: z.string().trim().min(1).optional(),
  giteaUsername: z.string().trim().min(1).optional(),
  githubUsername: z.string().trim().min(1).optional(),
  enabled: z.boolean().default(true),
});
export type TeamMemberProfile = z.infer<typeof TeamMemberProfileSchema>;
export type TeamMemberProfileInput = z.input<typeof TeamMemberProfileSchema>;

export const TeamCollabPoliciesSchema = z.object({
  enforceWorktreeOnCreate: z.boolean().default(true),
  blockUnclaimedGitCommitPush: z.boolean().default(true),
  allowSharedLocalCheckoutCommit: z.boolean().default(false),
  retentionDays: z.number().int().min(7).max(3650).default(90),
});
export type TeamCollabPolicies = z.infer<typeof TeamCollabPoliciesSchema>;

export const TeamCollabSettingsSchema = z.object({
  members: z.array(TeamMemberProfileSchema).default([]),
  enforceWorktreeOnCreate: z.boolean().default(true),
  blockUnclaimedGitCommitPush: z.boolean().default(true),
  allowSharedLocalCheckoutCommit: z.boolean().default(false),
  retentionDays: z.number().int().min(7).max(3650).default(90),
});
export type TeamCollabSettings = z.infer<typeof TeamCollabSettingsSchema>;

export const DEFAULT_TEAM_COLLAB_SETTINGS: TeamCollabSettings = {
  members: [],
  enforceWorktreeOnCreate: true,
  blockUnclaimedGitCommitPush: true,
  allowSharedLocalCheckoutCommit: false,
  retentionDays: 90,
};

export const teamCollabSettings = defineSettings({
  id: "team-collab",
  scope: "host",
  version: 1,
  schema: TeamCollabSettingsSchema,
});

export function createSystemBotOwnerMetadata(
  assignedAt: string = new Date().toISOString(),
): WorkspaceOwnerMetadata {
  return {
    id: SYSTEM_BOT_MEMBER_ID,
    name: SYSTEM_BOT_DEFAULT_NAME,
    email: SYSTEM_BOT_DEFAULT_EMAIL,
    kind: "bot",
    assignedAt,
  };
}

export function parseWorkspaceOwnerMetadata(raw: unknown): WorkspaceOwnerMetadata | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate =
    TEAM_COLLAB_OWNER_META_KEY in raw
      ? (raw as Record<string, unknown>)[TEAM_COLLAB_OWNER_META_KEY]
      : raw;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const parsed = WorkspaceOwnerMetadataSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
