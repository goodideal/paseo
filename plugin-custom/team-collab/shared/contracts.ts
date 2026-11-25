import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  createSystemBotOwnerMetadata,
  DEFAULT_TEAM_COLLAB_SETTINGS,
  GitProviderKindSchema,
  MEMBER_ID_PATTERN,
  parseWorkspaceOwnerMetadata,
  SYSTEM_BOT_DEFAULT_EMAIL,
  SYSTEM_BOT_DEFAULT_NAME,
  SYSTEM_BOT_MEMBER_ID,
  TEAM_COLLAB_OWNER_META_KEY,
  TeamCollabPoliciesSchema,
  teamCollabSettings,
  TeamCollabSettingsSchema,
  TeamMemberIdSchema,
  TeamMemberProfileSchema,
  WorkspaceOwnerKindSchema,
  WorkspaceOwnerMetadataSchema,
  type GitProviderKind,
  type TeamCollabPolicies,
  type TeamCollabSettings,
  type TeamMemberProfile,
  type TeamMemberProfileInput,
  type WorkspaceOwnerKind,
  type WorkspaceOwnerMetadata,
} from "./settings.js";

export {
  createSystemBotOwnerMetadata,
  DEFAULT_TEAM_COLLAB_SETTINGS,
  GitProviderKindSchema,
  MEMBER_ID_PATTERN,
  parseWorkspaceOwnerMetadata,
  SYSTEM_BOT_DEFAULT_EMAIL,
  SYSTEM_BOT_DEFAULT_NAME,
  SYSTEM_BOT_MEMBER_ID,
  TEAM_COLLAB_OWNER_META_KEY,
  TeamCollabPoliciesSchema,
  teamCollabSettings,
  TeamCollabSettingsSchema,
  TeamMemberIdSchema,
  TeamMemberProfileSchema,
  WorkspaceOwnerKindSchema,
  WorkspaceOwnerMetadataSchema,
  type GitProviderKind,
  type TeamCollabPolicies,
  type TeamCollabSettings,
  type TeamMemberProfile,
  type TeamMemberProfileInput,
  type WorkspaceOwnerKind,
  type WorkspaceOwnerMetadata,
};

export const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date string");

export const MemberCredentialStatusSchema = z.object({
  gitProvider: GitProviderKindSchema.default("gitea"),
  hasHttpToken: z.boolean().default(false),
  httpTokenPreview: z.string().nullable().default(null),
  httpServerUrl: z.string().nullable().default(null),
  hasGiteaToken: z.boolean(),
  giteaTokenPreview: z.string().nullable(),
  giteaUrl: z.string().nullable().optional(),
  hasGithubToken: z.boolean(),
  githubTokenPreview: z.string().nullable(),
  hasSshKey: z.boolean(),
  sshKeyPathPreview: z.string().nullable(),
});
export type MemberCredentialStatus = z.infer<typeof MemberCredentialStatusSchema>;

export const RosterMemberStatusSchema = TeamMemberProfileSchema.extend({
  credentials: MemberCredentialStatusSchema,
});
export type RosterMemberStatus = z.infer<typeof RosterMemberStatusSchema>;

export const DiscoveredHostAccountSchema = z.object({
  source: z.enum(["tea", "gh", "glab", "git-global"]),
  gitProvider: GitProviderKindSchema.default("gitea"),
  loginName: z.string(),
  suggestedId: TeamMemberIdSchema,
  suggestedName: z.string(),
  suggestedEmail: z.string(),
  giteaUrl: z.string().nullable(),
  giteaUsername: z.string().nullable(),
  hasToken: z.boolean(),
  tokenPreview: z.string().nullable(),
  hasSshKey: z.boolean(),
  sshKeyPathPreview: z.string().nullable(),
  isDefault: z.boolean(),
  alreadyInRoster: z.boolean(),
});
export type DiscoveredHostAccount = z.infer<typeof DiscoveredHostAccountSchema>;

const CONTROL_CHAR_PATTERN = /[\r\n\0]/;

export const NoControlCharStringSchema = z
  .string()
  .refine(
    (val) => !CONTROL_CHAR_PATTERN.test(val),
    "Credential fields must not contain CR, LF, or NUL control characters",
  );

const OptionalSecretStringSchema = NoControlCharStringSchema.nullable().optional();

export const HttpUrlStringSchema = z
  .string()
  .refine(
    (val) => !CONTROL_CHAR_PATTERN.test(val),
    "Server URL must not contain CR, LF, or NUL control characters",
  )
  .refine((val) => {
    const trimmed = val.trim();
    if (!trimmed) {
      return true;
    }
    try {
      const parsed = new URL(trimmed);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname)
      );
    } catch {
      return false;
    }
  }, "Server URL must be a valid http:// or https:// URL");

const OptionalGiteaUrlSchema = HttpUrlStringSchema.nullable().optional();

export const MemberCredentialsInputSchema = z.object({
  gitProvider: GitProviderKindSchema.optional(),
  httpToken: NoControlCharStringSchema.nullable().optional(),
  httpServerUrl: HttpUrlStringSchema.nullable().optional(),
  giteaToken: OptionalSecretStringSchema,
  giteaUrl: OptionalGiteaUrlSchema,
  githubToken: OptionalSecretStringSchema,
  sshKeyPath: OptionalSecretStringSchema,
  useDiscoveredTeaLogin: z
    .string()
    .trim()
    .min(1)
    .refine(
      (val) => !CONTROL_CHAR_PATTERN.test(val),
      "useDiscoveredTeaLogin must not contain CR, LF, or NUL control characters",
    )
    .optional(),
});
export type MemberCredentialsInput = z.infer<typeof MemberCredentialsInputSchema>;

export const DetectedServerHintSchema = z.object({
  gitProvider: GitProviderKindSchema,
  serverUrl: z.string(),
});
export type DetectedServerHint = z.infer<typeof DetectedServerHintSchema>;

export const teamCollabRosterStatusRpc = defineRpc({
  name: "team_collab.roster.status.request",
  input: z.object({}).optional().default({}),
  output: z.object({
    members: z.array(RosterMemberStatusSchema),
    policies: TeamCollabPoliciesSchema,
    discoveredAccounts: z.array(DiscoveredHostAccountSchema).default([]),
    discoveredSshKeys: z.array(z.string()).default([]),
    detectedServerHint: DetectedServerHintSchema.nullable().default(null),
  }),
});

export const teamCollabSyncHostAccountsRpc = defineRpc({
  name: "team_collab.roster.sync_host.request",
  input: z
    .object({
      loginNames: z.array(z.string()).optional(),
      overwriteExistingCredentials: z.boolean().default(false),
    })
    .optional()
    .default({ overwriteExistingCredentials: false }),
  output: z.object({
    importedIds: z.array(z.string()),
    members: z.array(RosterMemberStatusSchema),
    discoveredAccounts: z.array(DiscoveredHostAccountSchema),
  }),
});

export const teamCollabMemberUpsertRpc = defineRpc({
  name: "team_collab.member.upsert.request",
  input: z.object({
    member: TeamMemberProfileSchema,
    credentials: MemberCredentialsInputSchema.optional(),
  }),
  output: z.object({
    member: RosterMemberStatusSchema,
    success: z.boolean(),
  }),
});

export const teamCollabMemberRemoveRpc = defineRpc({
  name: "team_collab.member.remove.request",
  input: z.object({
    memberId: TeamMemberIdSchema,
  }),
  output: z.object({
    memberId: z.string(),
    removed: z.boolean(),
  }),
});

export const teamCollabWorkspaceAssignRpc = defineRpc({
  name: "team_collab.workspace.assign.request",
  input: z.object({
    workspaceId: z.string().min(1),
    memberId: z.string().min(1).nullable(),
  }),
  output: z.object({
    workspaceId: z.string(),
    owner: WorkspaceOwnerMetadataSchema.nullable(),
    gitConfigured: z.boolean(),
    isWorktree: z.boolean(),
  }),
});

export const UsageTotalsSchema = z.object({
  turns: z.number().int().nonnegative(),
  completedTurns: z.number().int().nonnegative(),
  failedTurns: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  commitCount: z.number().int().nonnegative(),
});
export type UsageTotals = z.infer<typeof UsageTotalsSchema>;

export const MemberModelUsageSchema = z.object({
  provider: z.string(),
  model: z.string(),
  turns: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
});
export type MemberModelUsage = z.infer<typeof MemberModelUsageSchema>;

export const MemberUsageSummarySchema = z.object({
  ownerId: z.string(),
  ownerName: z.string(),
  ownerEmail: z.string(),
  kind: z.string(),
  turns: z.number().int().nonnegative(),
  completedTurns: z.number().int().nonnegative().default(0),
  failedTurns: z.number().int().nonnegative().default(0),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  commitCount: z.number().int().nonnegative(),
  models: z.array(MemberModelUsageSchema),
});
export type MemberUsageSummary = z.infer<typeof MemberUsageSummarySchema>;

export const DailyUsagePointSchema = z.object({
  date: DateStringSchema,
  ownerId: z.string(),
  ownerName: z.string(),
  kind: z.string(),
  turns: z.number().int().nonnegative(),
  completedTurns: z.number().int().nonnegative(),
  failedTurns: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type DailyUsagePoint = z.infer<typeof DailyUsagePointSchema>;

export const RecentTurnRecordSchema = z.object({
  turnId: z.string().nullable(),
  timestamp: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  workspaceId: z.string().nullable(),
  branch: z.string().nullable(),
  agentId: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  outcome: z.string(),
  promptPreview: z.string().nullable(),
});
export type RecentTurnRecord = z.infer<typeof RecentTurnRecordSchema>;

export const teamCollabUsageQueryRpc = defineRpc({
  name: "team_collab.usage.query.request",
  input: z
    .object({
      fromDate: DateStringSchema.optional(),
      toDate: DateStringSchema.optional(),
      memberId: z.string().min(1).optional(),
      limitTurns: z.number().int().min(1).max(500).default(50),
    })
    .default({ limitTurns: 50 }),
  output: z.object({
    totals: UsageTotalsSchema,
    byMember: z.array(MemberUsageSummarySchema),
    dailySeries: z.array(DailyUsagePointSchema),
    recentTurns: z.array(RecentTurnRecordSchema),
  }),
});

export const UsageExportFormatSchema = z.enum(["csv", "json"]);
export type UsageExportFormat = z.infer<typeof UsageExportFormatSchema>;

export const teamCollabUsageExportRpc = defineRpc({
  name: "team_collab.usage.export.request",
  input: z
    .object({
      fromDate: DateStringSchema.optional(),
      toDate: DateStringSchema.optional(),
      memberId: z.string().min(1).optional(),
      format: UsageExportFormatSchema.default("csv"),
    })
    .default({ format: "csv" }),
  output: z.object({
    format: UsageExportFormatSchema,
    filename: z.string(),
    content: z.string(),
    rowCount: z.number().int().nonnegative(),
  }),
});

export type TeamCollabRosterStatusInput = z.infer<typeof teamCollabRosterStatusRpc.input>;
export type TeamCollabRosterStatusOutput = z.infer<typeof teamCollabRosterStatusRpc.output>;
export type TeamCollabSyncHostAccountsInput = z.infer<typeof teamCollabSyncHostAccountsRpc.input>;
export type TeamCollabSyncHostAccountsOutput = z.infer<typeof teamCollabSyncHostAccountsRpc.output>;
export type TeamCollabMemberUpsertInput = z.infer<typeof teamCollabMemberUpsertRpc.input>;
export type TeamCollabMemberUpsertOutput = z.infer<typeof teamCollabMemberUpsertRpc.output>;
export type TeamCollabMemberRemoveInput = z.infer<typeof teamCollabMemberRemoveRpc.input>;
export type TeamCollabMemberRemoveOutput = z.infer<typeof teamCollabMemberRemoveRpc.output>;
export type TeamCollabWorkspaceAssignInput = z.infer<typeof teamCollabWorkspaceAssignRpc.input>;
export type TeamCollabWorkspaceAssignOutput = z.infer<typeof teamCollabWorkspaceAssignRpc.output>;
export type TeamCollabUsageQueryInput = z.infer<typeof teamCollabUsageQueryRpc.input>;
export type TeamCollabUsageQueryOutput = z.infer<typeof teamCollabUsageQueryRpc.output>;
export type TeamCollabUsageExportInput = z.infer<typeof teamCollabUsageExportRpc.input>;
export type TeamCollabUsageExportOutput = z.infer<typeof teamCollabUsageExportRpc.output>;
