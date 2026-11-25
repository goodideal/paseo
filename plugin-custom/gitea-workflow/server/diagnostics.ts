import { buildResolveProjectOptions, type ProjectGiteaResolver } from "./resolver.js";
import type { GiteaClientPool } from "./client-pool.js";
import type { SettingsManager } from "./settings-manager.js";
import type { PaseoProjectItem } from "./poller.js";
import type { GiteaIdentitySummary, GiteaProjectDiagnostic } from "../shared/types.js";
import type { GiteaIdentityBridge } from "./identity-bridge.js";
import {
  countHarnessSpecialists,
  extractAgentTeamDiagnostic,
  fetchEffectiveHarnessConfig,
} from "./harness-bridge.js";

export interface DiagnosticsHarnessStatus {
  available: boolean;
  enabled: boolean;
  specialistsCount?: number;
}

export interface DiagnosticsIdentityProbeResult {
  identities: GiteaIdentitySummary[];
  teamCollabStatus: {
    available: boolean;
    membersCount: number;
  };
}

export class DiagnosticsService {
  constructor(
    private readonly resolver: ProjectGiteaResolver,
    private readonly clientPool: GiteaClientPool,
    private readonly settings: SettingsManager,
    private readonly getPaseo?: () => unknown,
    private readonly identityBridge?: GiteaIdentityBridge,
  ) {}

  async probeIdentities(paseoOverride?: unknown): Promise<DiagnosticsIdentityProbeResult> {
    if (!this.identityBridge) {
      return {
        identities: [],
        teamCollabStatus: { available: false, membersCount: 0 },
      };
    }
    const paseo = paseoOverride ?? this.getPaseo?.();
    const loaded = await this.identityBridge.loadIdentities(paseo);
    return {
      identities: loaded.identities.map((item) => this.identityBridge!.toIdentitySummary(item)),
      teamCollabStatus: {
        available: loaded.teamCollabAvailable,
        membersCount: loaded.teamCollabMembersCount,
      },
    };
  }

  async probeHarnessStatus(paseoOverride?: unknown): Promise<DiagnosticsHarnessStatus> {
    const paseo = paseoOverride ?? this.getPaseo?.();
    const effective = await fetchEffectiveHarnessConfig(paseo, {
      workspaceId: null,
      cwd: null,
    });
    if (!effective) {
      return { available: false, enabled: false };
    }
    const mode =
      typeof this.settings.getHarnessMode === "function" ? this.settings.getHarnessMode() : "auto";
    return {
      available: true,
      enabled: mode !== "disabled",
      specialistsCount: countHarnessSpecialists(effective),
    };
  }

  async diagnoseProjects(
    projects: PaseoProjectItem[],
    paseoOverride?: unknown,
  ): Promise<GiteaProjectDiagnostic[]> {
    const paseo = paseoOverride ?? this.getPaseo?.();
    return Promise.all(
      projects.map(async (project): Promise<GiteaProjectDiagnostic> => {
        const authorized = this.settings.isProjectAuthorized(project.projectId);
        const readyLabel = this.settings.getReadyLabel(project.projectId);
        const effectiveHarness = paseo
          ? await fetchEffectiveHarnessConfig(paseo, {
              cwd: project.projectRootPath ?? null,
            })
          : null;
        try {
          const resolveOpts = buildResolveProjectOptions({
            settings: this.settings,
            projectId: project.projectId,
            paseo,
            identityBridge: this.identityBridge,
          });
          const resolved = resolveOpts
            ? await this.resolver.resolveProject(project, resolveOpts)
            : await this.resolver.resolveProject(project);
          const agentTeam = extractAgentTeamDiagnostic(
            effectiveHarness,
            resolved?.repoName || project.projectDisplayName || project.projectId,
          );
          if (!resolved) {
            return {
              projectId: project.projectId,
              projectName: project.projectDisplayName || project.projectId,
              host: "",
              baseUrl: "",
              repoOwner: "",
              repoName: "",
              connectionStatus: "not_gitea",
              authSource: "none",
              authorized,
              readyLabel,
              errorMessage: "Not a recognized Gitea repository remote",
              ...(agentTeam ? { agentTeam } : {}),
            };
          }

          if (resolved.authSource === "anonymous" || !resolved.token) {
            return {
              projectId: project.projectId,
              projectName: resolved.projectName,
              host: resolved.host,
              baseUrl: resolved.baseUrl,
              repoOwner: resolved.repoOwner,
              repoName: resolved.repoName,
              connectionStatus: "unauthorized",
              authSource: "none",
              ...(resolved.activeIdentity !== undefined
                ? { activeIdentity: resolved.activeIdentity }
                : {}),
              authorized,
              readyLabel,
              errorMessage:
                resolved.errorMessage ||
                "No Gitea authentication token found via tea or environment",
              ...(agentTeam ? { agentTeam } : {}),
            };
          }

          let pendingIssueCount: number | undefined;
          let connectionStatus: GiteaProjectDiagnostic["connectionStatus"] = "connected";
          let errorMessage: string | undefined;

          try {
            const client = this.clientPool.getClient({
              giteaUrl: resolved.baseUrl,
              giteaToken: resolved.token,
              repoOwner: resolved.repoOwner,
              repoName: resolved.repoName,
              listenLabel: readyLabel,
            });
            const issues = await client.fetchReadyIssues();
            pendingIssueCount = issues.length;
          } catch (clientErr) {
            connectionStatus = "unreachable";
            errorMessage = (clientErr as Error).message;
          }

          return {
            projectId: project.projectId,
            projectName: resolved.projectName,
            host: resolved.host,
            baseUrl: resolved.baseUrl,
            repoOwner: resolved.repoOwner,
            repoName: resolved.repoName,
            connectionStatus,
            authSource: resolved.authSource,
            ...(resolved.activeIdentity !== undefined
              ? { activeIdentity: resolved.activeIdentity }
              : {}),
            authorized,
            readyLabel,
            pendingIssueCount,
            errorMessage,
            ...(agentTeam ? { agentTeam } : {}),
          };
        } catch (err) {
          const agentTeam = extractAgentTeamDiagnostic(
            effectiveHarness,
            project.projectDisplayName || project.projectId,
          );
          return {
            projectId: project.projectId,
            projectName: project.projectDisplayName || project.projectId,
            host: "",
            baseUrl: "",
            repoOwner: "",
            repoName: "",
            connectionStatus: "unreachable",
            authSource: "none",
            authorized,
            readyLabel,
            errorMessage: (err as Error).message,
            ...(agentTeam ? { agentTeam } : {}),
          };
        }
      }),
    );
  }
}
