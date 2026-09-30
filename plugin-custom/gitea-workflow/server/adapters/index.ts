import type { GiteaClientPool } from "../client-pool.js";
import type { IssueRunIndexStore } from "../store.js";
import type { SettingsManager } from "../settings-manager.js";
import { createFetchIssueAdapter } from "./fetch-issue.js";
import { createClaimIssueAdapter } from "./claim-issue.js";
import { createUpdateStatusAdapter } from "./update-status.js";
import { createPostSummaryAdapter } from "./post-summary.js";
import { createResolveDeliveryAdapter } from "./resolve-delivery.js";
import { createAgentExecuteAdapter } from "./agent-execute.js";
import { createDualApprovalGateAdapter } from "./dual-approval-gate.js";

export {
  createFetchIssueAdapter,
  createClaimIssueAdapter,
  createUpdateStatusAdapter,
  createPostSummaryAdapter,
  createResolveDeliveryAdapter,
  createAgentExecuteAdapter,
  createDualApprovalGateAdapter,
};

export function createGiteaStepAdapters(
  clientPool: GiteaClientPool,
  indexStore?: IssueRunIndexStore,
  settingsManager?: SettingsManager,
) {
  const adapters = [
    createFetchIssueAdapter(clientPool, indexStore),
    createClaimIssueAdapter(clientPool, indexStore),
    createUpdateStatusAdapter(clientPool, indexStore),
    createPostSummaryAdapter(clientPool, indexStore),
    createResolveDeliveryAdapter(indexStore),
    createDualApprovalGateAdapter(clientPool, indexStore),
  ];
  if (settingsManager && indexStore) {
    adapters.push(createAgentExecuteAdapter(settingsManager, indexStore));
  }
  return adapters;
}
