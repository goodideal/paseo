import type { GiteaClientPool } from "../client-pool.js";
import { createFetchIssueAdapter } from "./fetch-issue.js";
import { createClaimIssueAdapter } from "./claim-issue.js";
import { createUpdateStatusAdapter } from "./update-status.js";
import { createPostSummaryAdapter } from "./post-summary.js";
import { createResolveDeliveryAdapter } from "./resolve-delivery.js";

export {
  createFetchIssueAdapter,
  createClaimIssueAdapter,
  createUpdateStatusAdapter,
  createPostSummaryAdapter,
  createResolveDeliveryAdapter,
};

export function createGiteaStepAdapters(clientPool: GiteaClientPool) {
  return [
    createFetchIssueAdapter(clientPool),
    createClaimIssueAdapter(clientPool),
    createUpdateStatusAdapter(clientPool),
    createPostSummaryAdapter(clientPool),
    createResolveDeliveryAdapter(),
  ];
}
