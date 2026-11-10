export interface PluginWorkflowStepAdapterManifest {
  type: string;
  version: string;
  inputSchema: ZodType;
  outputSchema: ZodType;
  executionRisk: "read" | "workspace_observe" | "workspace_write" | "external_write" | "privileged";
  requiredPermissions: string[];
  repositoryCallable: boolean;
  idempotency: "none" | "required";
  cancellation: "unsupported" | "supported" | "best_effort";
  recovery: "not_resumable" | "resumable" | "inspect_before_retry";
  supportedPlatforms: Array<"darwin" | "linux" | "win32">;
  resourceConflictKey: string;
}

export interface PluginWorkflowRunReference {
  projectId: string;
  workspaceId: string;
  runId: string;
  workspaceRoot?: string;
  stepOutputs?: Record<string, Record<string, unknown>>;
}

export interface PluginWorkflowStepExecutionContext {
  paseo: PaseoApi;
  run: PluginWorkflowRunReference;
  stepOutputs?: Record<string, Record<string, unknown>>;
}

export interface PluginWorkflowStepAdapterRegistration extends PluginWorkflowStepAdapterManifest {
  execute(
    input: Record<string, unknown>,
    context: PluginWorkflowStepExecutionContext,
  ): Promise<Record<string, unknown>>;
}

export interface PluginWorkflowPreset {
  workflowId: string;
  name: string;
  sourcePreset: string;
  definition: unknown;
}

import type { PaseoApi } from "@getpaseo/client";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";
import type { PluginRpcContract, PluginSubscriptionContract, PluginWireInput } from "../rpc.js";
import type { PluginCleanup } from "../contracts.js";
import type { ProviderRegistration } from "./provider.js";
import type { UsageSourceRegistration } from "./usage.js";
import type { PluginLifecycleRegistration } from "./lifecycle.js";

export interface PluginHandlerContext {
  paseo: PaseoApi;
}

/** What a subscription handler receives beside its input. */
export interface PluginSubscriptionContext<Event = unknown> extends PluginHandlerContext {
  /**
   * Sends one event to this subscriber. A `Uint8Array` event travels as a binary frame; any other
   * event is JSON and must not contain a `Uint8Array`. Resolves once the event left the plugin
   * process. Events pushed after `signal` aborts are dropped.
   */
  push(event: Event): Promise<void>;
  /** Aborts when the subscriber releases, disconnects, or the plugin stops. */
  signal: AbortSignal;
}

export type PluginSettingsState<Schema extends ZodType> =
  | {
      status: "ready";
      revision: string;
      values: ZodOutput<Schema>;
    }
  | {
      status: "invalid";
      revision: string;
      error: string;
    };

export interface PluginSettings<Schema extends ZodType> {
  read(): Promise<PluginSettingsState<Schema>>;
  subscribe(listener: (state: PluginSettingsState<Schema>) => void | Promise<void>): PluginCleanup;
}

export interface PluginServerContext extends PluginLifecycleRegistration {
  readonly paseo: PaseoApi;
  registerSettings<Schema extends ZodType>(
    definition: import("../settings.js").SettingsDefinition<Schema>,
  ): PluginSettings<Schema>;
  /**
   * Serves a subscription. The handler starts the work and returns; the subscription stays open
   * until `signal` aborts. A handler that throws refuses the subscription. When it returns a
   * promise, settling the promise closes the subscription, with the rejection as its error.
   */
  handle<InputSchema extends ZodType, EventSchema extends ZodType>(
    contract: PluginSubscriptionContract<InputSchema, EventSchema>,
    handler: (
      input: ZodOutput<InputSchema>,
      context: PluginSubscriptionContext<PluginWireInput<ZodInput<EventSchema>>>,
    ) => void | Promise<void>,
  ): void;
  handle<InputSchema extends ZodType, OutputSchema extends ZodType>(
    contract: PluginRpcContract<InputSchema, OutputSchema>,
    handler: (
      input: ZodOutput<InputSchema>,
      context: PluginHandlerContext,
    ) => PluginWireInput<ZodInput<OutputSchema>> | Promise<PluginWireInput<ZodInput<OutputSchema>>>,
  ): void;
  registerProvider(provider: ProviderRegistration): void;
  registerUsageSource(source: UsageSourceRegistration): void;
  registerWorkflowPreset?(preset: PluginWorkflowPreset): void;
  registerWorkflowStepAdapter?(adapter: PluginWorkflowStepAdapterRegistration): void;
}

export type PluginServerContribution = (server: PluginServerContext) => PluginCleanup;
