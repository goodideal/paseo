import { z } from "zod";
import type { StepAdapterRegistry } from "./step-adapter-registry.js";

const AllPlatforms = ["darwin", "linux", "win32"] as const;

const NoOutputSchema = z.object({}).strict();
const WorktreeCreateOutputSchema = z
  .object({ worktreePath: z.string(), branch: z.string() })
  .strict();
const AgentDispatchOutputSchema = z
  .object({ agentId: z.string(), sessionId: z.string(), resumable: z.boolean() })
  .strict();
const VerificationOutputSchema = z.object({ passed: z.boolean(), report: z.string() }).strict();
const GitPushOutputSchema = z.object({ success: z.boolean(), commitSha: z.string() }).strict();
const GitCreatePrOutputSchema = z
  .object({ url: z.string(), prNumber: z.number().int().positive() })
  .strict();
const WorktreeCreateInputSchema = z
  .object({
    sourceWorkspaceId: z.string().trim().min(1).max(256).optional(),
    branch: z.string().trim().min(1).max(256).optional(),
  })
  .strict();
const AgentDispatchInputSchema = z
  .object({
    promptId: z.string().trim().min(1).max(256),
    provider: z.string().trim().min(1).max(128).optional(),
  })
  .strict();
const VerifyCommandInputSchema = z
  .object({
    verificationProfile: z.string().trim().min(1).max(256),
  })
  .strict();
const ReviewAgentInputSchema = z
  .object({
    promptId: z.string().trim().min(1).max(256),
  })
  .strict();
const ApprovalWaitInputSchema = z
  .object({
    reason: z.string().trim().min(1).max(4096),
  })
  .strict();
const GitPushInputSchema = z
  .object({
    remote: z.string().trim().min(1).max(256).optional(),
    branch: z.string().trim().min(1).max(256).optional(),
  })
  .strict();
const GitCreatePrInputSchema = z
  .object({
    title: z.string().trim().min(1).max(512),
    baseBranch: z.string().trim().min(1).max(256).optional(),
    branch: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

const WorkflowAgentProfileSchema = z.union([
  z.string().trim().min(1).max(256),
  z.record(z.string(), z.json()),
]);

const RunWorkflowAgentInputSchema = z
  .object({
    cwd: z.string().trim().min(1).max(4096).optional(),
    prompt: z.string().trim().min(1).max(65536),
    profile: WorkflowAgentProfileSchema.optional().default("default"),
    mode: z.enum(["plan", "execute", "review"]).default("plan"),
  })
  .strict();

const ContinueWorkflowAgentInputSchema = z
  .object({
    cwd: z.string().trim().min(1).max(4096).optional(),
    agentId: z.string().trim().min(1).max(256),
    sessionId: z.string().trim().min(1).max(256).optional(),
    prompt: z.string().trim().min(1).max(65536),
    profile: WorkflowAgentProfileSchema.optional(),
    mode: z.enum(["plan", "execute", "review"]).default("plan"),
    expectedPhase: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

const WorkflowAgentTurnResultSchema = z
  .object({
    agentId: z.string().trim().min(1).max(256),
    sessionId: z.string().trim().min(1).max(256),
    outcome: z.enum(["completed", "failed", "cancelled", "permission_pending"]),
    finalArtifactId: z.string().trim().min(1).max(256),
    handoffArtifactId: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

const InteractionWaitInputSchema = z
  .object({
    question: z.string().trim().min(1).max(16384).optional(),
    promptArtifactId: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

const InteractionWaitOutputSchema = z
  .object({
    interactionId: z.string().trim().min(1).max(256).optional(),
    status: z.enum(["pending", "answered", "expired", "cancelled"]).optional(),
    answerArtifactId: z.string().trim().min(1).max(256).optional(),
    responderId: z.string().trim().min(1).max(256).optional(),
    answeredAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export function registerBuiltInWorkflowStepManifests(registry: StepAdapterRegistry): void {
  registry.registerCore({
    type: "worktree.create",
    version: "1",
    inputSchema: WorktreeCreateInputSchema,
    outputSchema: WorktreeCreateOutputSchema,
    executionRisk: "workspace_write",
    requiredPermissions: ["workspace.manage"],
    repositoryCallable: true,
    idempotency: "required",
    cancellation: "best_effort",
    recovery: "inspect_before_retry",
    supportedPlatforms: [...AllPlatforms],
    resourceConflictKey: "workspace:worktree",
  });
  registry.registerCore({
    type: "agent.dispatch",
    version: "1",
    inputSchema: AgentDispatchInputSchema,
    outputSchema: AgentDispatchOutputSchema,
    executionRisk: "workspace_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "best_effort",
    recovery: "not_resumable",
    supportedPlatforms: [...AllPlatforms],
    resourceConflictKey: "workspace:agent",
  });
  registry.registerCore({
    type: "verify.command",
    version: "1",
    inputSchema: VerifyCommandInputSchema,
    outputSchema: VerificationOutputSchema,
    executionRisk: "workspace_observe",
    requiredPermissions: ["workspace.read"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "supported",
    recovery: "not_resumable",
    supportedPlatforms: [...AllPlatforms],
    resourceConflictKey: "workspace:verification",
  });
  registry.registerCore({
    type: "review.agent",
    version: "1",
    inputSchema: ReviewAgentInputSchema,
    outputSchema: AgentDispatchOutputSchema,
    executionRisk: "workspace_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "best_effort",
    recovery: "not_resumable",
    supportedPlatforms: [...AllPlatforms],
    resourceConflictKey: "workspace:review",
  });
  registry.registerCore({
    type: "approval.wait",
    version: "1",
    inputSchema: ApprovalWaitInputSchema,
    outputSchema: NoOutputSchema,
    executionRisk: "read",
    requiredPermissions: ["workspace.read"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "supported",
    recovery: "resumable",
    supportedPlatforms: [...AllPlatforms],
    resourceConflictKey: "workflow:approval",
  });
  registry.registerCore({
    type: "git.push",
    version: "1",
    inputSchema: GitPushInputSchema,
    outputSchema: GitPushOutputSchema,
    executionRisk: "external_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "required",
    cancellation: "unsupported",
    recovery: "inspect_before_retry",
    supportedPlatforms: [...AllPlatforms],
    resourceConflictKey: "workspace:git-push",
  });
  registry.registerCore({
    type: "git.create_pr",
    version: "1",
    inputSchema: GitCreatePrInputSchema,
    outputSchema: GitCreatePrOutputSchema,
    executionRisk: "external_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "required",
    cancellation: "unsupported",
    recovery: "inspect_before_retry",
    supportedPlatforms: [...AllPlatforms],
    resourceConflictKey: "workspace:git-pr",
  });
  registry.registerCore({
    type: "agent.run_until_complete",
    version: "1",
    inputSchema: RunWorkflowAgentInputSchema,
    outputSchema: WorkflowAgentTurnResultSchema,
    executionRisk: "workspace_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "supported",
    recovery: "not_resumable",
    supportedPlatforms: [...AllPlatforms],
    resourceConflictKey: "workspace:agent",
  });
  registry.registerCore({
    type: "agent.continue_until_complete",
    version: "1",
    inputSchema: ContinueWorkflowAgentInputSchema,
    outputSchema: WorkflowAgentTurnResultSchema,
    executionRisk: "workspace_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "supported",
    recovery: "not_resumable",
    supportedPlatforms: [...AllPlatforms],
    resourceConflictKey: "workspace:agent",
  });
  registry.registerCore({
    type: "interaction.wait",
    version: "1",
    inputSchema: InteractionWaitInputSchema,
    outputSchema: InteractionWaitOutputSchema,
    executionRisk: "read",
    requiredPermissions: ["workspace.read"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "supported",
    recovery: "resumable",
    supportedPlatforms: [...AllPlatforms],
    resourceConflictKey: "workflow:interaction",
  });
}
