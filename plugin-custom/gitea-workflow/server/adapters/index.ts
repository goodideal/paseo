import type { GiteaClientPool } from "../client-pool.js";
import type { IssueRunIndexStore } from "../store.js";
import type { SettingsManager } from "../settings-manager.js";
import type { GiteaIdentityBridge } from "../identity-bridge.js";
import { createFetchIssueAdapter } from "./fetch-issue.js";
import { createClaimIssueAdapter } from "./claim-issue.js";
import { createUpdateStatusAdapter } from "./update-status.js";
import { createPostSummaryAdapter } from "./post-summary.js";
import { createResolveDeliveryAdapter } from "./resolve-delivery.js";
import { createAgentExecuteAdapter } from "./agent-execute.js";
import { createDualApprovalGateAdapter } from "./dual-approval-gate.js";
import { createQualityGateAdapter } from "./quality-gate.js";
import { createDeliverPrAdapter } from "./deliver-pr.js";

export {
  createFetchIssueAdapter,
  createClaimIssueAdapter,
  createUpdateStatusAdapter,
  createPostSummaryAdapter,
  createResolveDeliveryAdapter,
  createAgentExecuteAdapter,
  createDualApprovalGateAdapter,
  createQualityGateAdapter,
  createDeliverPrAdapter,
};

export function createGiteaStepAdapters(
  clientPool: GiteaClientPool,
  indexStore?: IssueRunIndexStore,
  settingsManager?: SettingsManager,
  identityBridge?: GiteaIdentityBridge,
) {
  const adapters = [
    createFetchIssueAdapter(clientPool, indexStore),
    createClaimIssueAdapter(clientPool, indexStore),
    createUpdateStatusAdapter(clientPool, indexStore),
    createPostSummaryAdapter(clientPool, indexStore),
    createResolveDeliveryAdapter(indexStore, settingsManager),
    createDualApprovalGateAdapter(clientPool, indexStore),
    createDeliverPrAdapter(clientPool, indexStore, settingsManager, { identityBridge }),
    createQualityGateAdapter(settingsManager, indexStore, { identityBridge }),
  ];
  if (settingsManager && indexStore) {
    adapters.push(createAgentExecuteAdapter(settingsManager, indexStore, identityBridge));
  }
  return adapters;
}
