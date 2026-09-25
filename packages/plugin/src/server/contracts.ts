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

export interface PluginWorkflowPreset {
  workflowId: string;
  name: string;
  sourcePreset: string;
  definition: unknown;
}

import type { PaseoApi } from "@getpaseo/client";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";
import type { PluginRpcContract } from "../rpc.js";
import type { PluginCleanup } from "../contracts.js";
import type { ProviderRegistration } from "./provider.js";
import type { PluginLifecycleRegistration } from "./lifecycle.js";

export interface PluginHandlerContext {
  paseo: PaseoApi;
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
  registerSettings<Schema extends ZodType>(
    definition: import("../settings.js").SettingsDefinition<Schema>,
  ): PluginSettings<Schema>;
  handle<InputSchema extends ZodType, OutputSchema extends ZodType>(
    contract: PluginRpcContract<InputSchema, OutputSchema>,
    handler: (
      input: ZodOutput<InputSchema>,
      context: PluginHandlerContext,
    ) => ZodInput<OutputSchema> | Promise<ZodInput<OutputSchema>>,
  ): void;
  registerProvider(provider: ProviderRegistration): void;
  registerWorkflowPreset?(preset: PluginWorkflowPreset): void;
  registerWorkflowStepAdapter?(manifest: PluginWorkflowStepAdapterManifest): void;
}

export type PluginServerContribution = (server: PluginServerContext) => PluginCleanup;
