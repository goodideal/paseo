import type { PluginSettings } from "@getpaseo/plugin/server";
import {
  GiteaHostSettingsSchema,
  type GiteaHostSettings,
  type GiteaWorkflowPolicy,
  type AgentPermissionScope,
} from "../shared/types.js";

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

  getWorkflowPolicy(projectId: string): GiteaWorkflowPolicy {
    return (
      this._current.projects[projectId]?.workflowPolicyOverride || this._current.workflowPolicy
    );
  }

  getAgentProvider(projectId?: string): string {
    if (projectId && this._current.projects[projectId]?.agentProviderOverride) {
      return this._current.projects[projectId].agentProviderOverride!;
    }
    return this._current.agentProvider || this._current.automationProfile || "claude";
  }

  getAgentPermissionScope(projectId?: string): AgentPermissionScope {
    if (projectId && this._current.projects[projectId]?.agentPermissionScopeOverride) {
      return this._current.projects[projectId].agentPermissionScopeOverride!;
    }
    return this._current.agentPermissionScope || "workspace_controlled";
  }

  getAgentModel(projectId?: string): string | undefined {
    if (projectId && this._current.projects[projectId]?.agentModelOverride) {
      return this._current.projects[projectId].agentModelOverride;
    }
    return this._current.agentModel || undefined;
  }

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
