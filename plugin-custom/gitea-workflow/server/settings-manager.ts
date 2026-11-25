import type { PluginSettings } from "@getpaseo/plugin/server";
import {
  GiteaHostSettingsSchema,
  type GiteaHarnessMode,
  type GiteaHostSettings,
  type GiteaWorkflowPolicy,
} from "../shared/types.js";
import {
  DEFAULT_AGENT_AUTO_PROMPT,
  DEFAULT_AGENT_PLAN_PROMPT,
  DEFAULT_AGENT_REVIEW_PROMPT,
} from "../shared/prompts.js";

export class SettingsManager {
  private _current: GiteaHostSettings = GiteaHostSettingsSchema.parse({});
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly settingsHandle: PluginSettings<typeof GiteaHostSettingsSchema>) {}

  async initialize(): Promise<void> {
    const initial = await this.settingsHandle.read();
    if (initial.status === "ready") {
      this._current = initial.values;
    }
    this.unsubscribe = this.settingsHandle.subscribe((next) => {
      if (next.status === "ready") {
        this._current = next.values;
      }
    });
  }

  get current(): GiteaHostSettings {
    return this._current;
  }

  isProjectAuthorized(projectId: string): boolean {
    if (!this._current.enabled) return false;
    return Boolean(this._current.projects[projectId]?.enabled);
  }

  getReadyLabel(projectId: string): string {
    return this._current.projects[projectId]?.readyLabel || "agent-ready";
  }

  getBaseBranch(projectId?: string): string | undefined {
    if (projectId && this._current.projects[projectId]?.baseBranch) {
      const candidate = this._current.projects[projectId].baseBranch?.trim();
      if (candidate) return candidate;
    }
    if (this._current.defaultBaseBranch?.trim()) {
      return this._current.defaultBaseBranch.trim();
    }
    return undefined;
  }

  getWorkflowPolicy(projectId: string): GiteaWorkflowPolicy {
    return (
      this._current.projects[projectId]?.workflowPolicyOverride || this._current.workflowPolicy
    );
  }

  getHarnessMode(projectId?: string): GiteaHarnessMode {
    if (projectId && this._current.projects[projectId]?.harnessModeOverride) {
      return this._current.projects[projectId].harnessModeOverride!;
    }
    return this._current.harnessMode || "auto";
  }

  getGiteaIdentityId(projectId?: string): string | undefined {
    if (projectId) {
      const override = this._current.projects[projectId]?.giteaIdentityOverride?.trim();
      if (override) {
        return override;
      }
    }
    const hostId = this._current.giteaIdentityId?.trim();
    if (hostId) {
      return hostId;
    }
    return undefined;
  }

  getPreferIssueAssignee(projectId?: string): boolean {
    if (projectId) {
      const override = this._current.projects[projectId]?.preferIssueAssigneeOverride;
      if (typeof override === "boolean") {
        return override;
      }
    }
    return this._current.preferIssueAssignee ?? true;
  }

  getHasExplicitProviderOverride(projectId?: string): boolean {
    if (!projectId) return false;
    const override = this._current.projects[projectId]?.agentProviderOverride;
    return typeof override === "string" && override.trim().length > 0;
  }

  getReviewProviderOverride(projectId?: string): string | undefined {
    if (projectId && this._current.projects[projectId]?.reviewProviderOverride) {
      const candidate = this._current.projects[projectId].reviewProviderOverride?.trim();
      if (candidate) return candidate;
    }
    return undefined;
  }

  getAgentProvider(projectId?: string): string {
    if (projectId && this._current.projects[projectId]?.agentProviderOverride) {
      return this._current.projects[projectId].agentProviderOverride!;
    }
    return this._current.agentProvider || this._current.automationProfile || "claude";
  }

  getAgentChangeMode(projectId?: string): string {
    if (projectId && this._current.projects[projectId]?.agentChangeModeOverride) {
      return this._current.projects[projectId].agentChangeModeOverride!;
    }
    return this._current.agentChangeMode || "auto";
  }

  getAgentModel(projectId?: string): string | undefined {
    if (projectId && this._current.projects[projectId]?.agentModelOverride) {
      return this._current.projects[projectId].agentModelOverride;
    }
    return this._current.agentModel || undefined;
  }

  getAgentAutoPrompt(projectId?: string): string {
    const override = projectId
      ? this._current.projects[projectId]?.agentAutoPromptOverride
      : undefined;
    if (typeof override === "string" && override.trim().length > 0) {
      return override.trim();
    }
    if (
      typeof this._current.agentAutoPrompt === "string" &&
      this._current.agentAutoPrompt.trim().length > 0
    ) {
      return this._current.agentAutoPrompt.trim();
    }
    return DEFAULT_AGENT_AUTO_PROMPT;
  }

  getAgentPlanPrompt(projectId?: string): string {
    const override = projectId
      ? this._current.projects[projectId]?.agentPlanPromptOverride
      : undefined;
    if (typeof override === "string" && override.trim().length > 0) {
      return override.trim();
    }
    if (
      typeof this._current.agentPlanPrompt === "string" &&
      this._current.agentPlanPrompt.trim().length > 0
    ) {
      return this._current.agentPlanPrompt.trim();
    }
    return DEFAULT_AGENT_PLAN_PROMPT;
  }

  getAgentReviewPrompt(projectId?: string): string {
    const override = projectId
      ? this._current.projects[projectId]?.agentReviewPromptOverride
      : undefined;
    if (typeof override === "string" && override.trim().length > 0) {
      return override.trim();
    }
    if (
      typeof this._current.agentReviewPrompt === "string" &&
      this._current.agentReviewPrompt.trim().length > 0
    ) {
      return this._current.agentReviewPrompt.trim();
    }
    return DEFAULT_AGENT_REVIEW_PROMPT;
  }

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
