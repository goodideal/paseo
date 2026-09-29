import type {
  ProviderConnectRequest,
  ProviderCatalogOptions,
  ProviderEvent,
  ProviderInput,
} from "@getpaseo/plugin/server/provider";
import { ProviderEventSchema, ProviderInputSchema } from "@getpaseo/plugin/server/provider";
import { z } from "zod";

export interface PluginWorkflowPresetMetadata {
  workflowId: string;
  name: string;
  sourcePreset: string;
  definition: unknown;
}

export interface PluginProviderMetadata {
  hasCatalogCacheKey?: boolean;
  id: string;
  label: string;
  description?: string;
  iconPath?: string;
}

export interface PluginUsageSourceMetadata {
  id: string;
  label: string;
  icon?: string;
  discover: boolean;
}

export interface PluginWorkflowStepAdapterMetadata {
  type: string;
  version: string;
  executionRisk: "read" | "workspace_observe" | "workspace_write" | "external_write" | "privileged";
  requiredPermissions: string[];
  repositoryCallable: boolean;
  idempotency: "none" | "required";
  cancellation: "unsupported" | "supported" | "best_effort";
  recovery: "not_resumable" | "resumable" | "inspect_before_retry";
  supportedPlatforms: Array<"darwin" | "linux" | "win32">;
  resourceConflictKey: string;
}

export type PluginProcessRequest =
  | {
      type: "initialize";
      pluginId: string;
      bundle: string;
      appVersion: string;
      pluginDirectory?: string;
      settingsDirectory?: string;
    }
  | {
      type: "provider.catalog_key";
      requestId: string;
      providerId: string;
      options: ProviderCatalogOptions;
    }
  | { type: "hook"; requestId: string; kind: "event" | "before"; name: string; input: unknown }
  | { type: "hook.cancel"; requestId: string }
  | { type: "usage.identify"; requestId: string; sourceId: string; input: unknown }
  | { type: "usage.fetch"; requestId: string; sourceId: string; input: unknown }
  | { type: "usage.discover"; requestId: string; sourceId: string }
  | { type: "invoke"; requestId: string; method: string; input: unknown }
  | {
      type: "provider.connect";
      providerId: string;
      connectionId: string;
      request: ProviderConnectRequest;
    }
  | {
      type: "provider.send";
      connectionId: string;
      acceptanceId: string;
      input: ProviderInput;
    }
  | { type: "provider.close"; connectionId: string }
  | { type: "shutdown" }
  | { type: "paseo_frame"; data: string | Uint8Array; isBinary: boolean }
  | { type: "paseo_close" };

export type PluginProcessMessage =
  | { type: "settings.changed"; settingsId: string }
  | { type: "hooks.changed"; hooks: { events: string[]; before: string[] } }
  | {
      type: "ready";
      methods: string[];
      providers: PluginProviderMetadata[];
      workflowPresets?: PluginWorkflowPresetMetadata[];
      workflowStepAdapters?: PluginWorkflowStepAdapterMetadata[];
      usageSources?: PluginUsageSourceMetadata[];
      hooks?: { events: string[]; before: string[] };
    }
  | { type: "result"; requestId: string; output: unknown }
  | { type: "error"; requestId: string; error: string }
  | { type: "fatal"; error: string }
  | {
      type: "provider.connected";
      connectionId: string;
      version: number;
      capabilities: readonly string[];
    }
  | { type: "provider.connect_failed"; connectionId: string; error: string }
  | { type: "provider.accepted"; connectionId: string; acceptanceId: string }
  | {
      type: "provider.rejected";
      connectionId: string;
      acceptanceId: string;
      error: string;
    }
  | { type: "provider.event"; connectionId: string; event: ProviderEvent }
  | { type: "provider.closed"; connectionId: string; error?: string }
  | { type: "paseo_frame"; data: string | Uint8Array; isBinary: boolean }
  | { type: "paseo_close" };

const hooksSchema = z.object({ events: z.array(z.string()), before: z.array(z.string()) }).strict();

const providerMetadataSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    iconPath: z.string().optional(),
    hasCatalogCacheKey: z.boolean().optional(),
  })
  .strict();
const usageSourceMetadataSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    icon: z.string().optional(),
    discover: z.boolean(),
  })
  .strict();
const providerConnectRequestSchema = z
  .object({
    versions: z.array(z.number().int().positive()),
    capabilities: z.array(z.string()),
  })
  .strict();
const frameFields = {
  data: z.union([z.string(), z.instanceof(Uint8Array)]),
  isBinary: z.boolean(),
};

export const PluginProcessRequestSchema: z.ZodType<PluginProcessRequest> = z.discriminatedUnion(
  "type",
  [
    z
      .object({
        type: z.literal("initialize"),
        pluginId: z.string().min(1),
        bundle: z.string(),
        appVersion: z.string(),
        pluginDirectory: z.string().optional(),
        settingsDirectory: z.string().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.catalog_key"),
        requestId: z.string().min(1),
        providerId: z.string().min(1),
        options: z.discriminatedUnion("scope", [
          z.object({ scope: z.literal("global"), force: z.boolean().optional() }).strict(),
          z
            .object({
              scope: z.literal("workspace"),
              cwd: z.string(),
              force: z.boolean().optional(),
            })
            .strict(),
        ]),
      })
      .strict(),
    z
      .object({
        type: z.literal("hook"),
        requestId: z.string(),
        kind: z.enum(["event", "before"]),
        name: z.string(),
        input: z.unknown(),
      })
      .strict(),
    z.object({ type: z.literal("hook.cancel"), requestId: z.string() }).strict(),
    z
      .object({
        type: z.literal("usage.identify"),
        requestId: z.string(),
        sourceId: z.string(),
        input: z.unknown(),
      })
      .strict(),
    z
      .object({
        type: z.literal("usage.fetch"),
        requestId: z.string(),
        sourceId: z.string(),
        input: z.unknown(),
      })
      .strict(),
    z
      .object({ type: z.literal("usage.discover"), requestId: z.string(), sourceId: z.string() })
      .strict(),
    z
      .object({
        type: z.literal("invoke"),
        requestId: z.string().min(1),
        method: z.string().min(1),
        input: z.unknown(),
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.connect"),
        providerId: z.string().min(1),
        connectionId: z.string().min(1),
        request: providerConnectRequestSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.send"),
        connectionId: z.string().min(1),
        acceptanceId: z.string().min(1),
        input: ProviderInputSchema,
      })
      .strict(),
    z.object({ type: z.literal("provider.close"), connectionId: z.string().min(1) }).strict(),
    z.object({ type: z.literal("shutdown") }).strict(),
    z.object({ type: z.literal("paseo_frame"), ...frameFields }).strict(),
    z.object({ type: z.literal("paseo_close") }).strict(),
  ],
);

const workflowStepAdapterMetadataSchema = z
  .object({
    type: z.string().min(1),
    version: z.string().min(1),
    executionRisk: z.enum([
      "read",
      "workspace_observe",
      "workspace_write",
      "external_write",
      "privileged",
    ]),
    requiredPermissions: z.array(z.string()),
    repositoryCallable: z.boolean(),
    idempotency: z.enum(["none", "required"]),
    cancellation: z.enum(["unsupported", "supported", "best_effort"]),
    recovery: z.enum(["not_resumable", "resumable", "inspect_before_retry"]),
    supportedPlatforms: z.array(z.enum(["darwin", "linux", "win32"])),
    resourceConflictKey: z.string().min(1),
  })
  .strict();

export const PluginProcessMessageSchema: z.ZodType<PluginProcessMessage> = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("settings.changed"), settingsId: z.string() }).strict(),
    z.object({ type: z.literal("hooks.changed"), hooks: hooksSchema }).strict(),
    z
      .object({
        type: z.literal("ready"),
        methods: z.array(z.string()),
        providers: z.array(providerMetadataSchema),
        workflowPresets: z
          .array(
            z
              .object({
                workflowId: z.string().min(1),
                name: z.string().min(1),
                sourcePreset: z.string().min(1),
                definition: z.unknown(),
              })
              .strict(),
          )
          .optional(),
        workflowStepAdapters: z.array(workflowStepAdapterMetadataSchema).optional(),
        usageSources: z.array(usageSourceMetadataSchema).optional(),
        hooks: hooksSchema.optional(),
      })
      .strict(),
    z
      .object({ type: z.literal("result"), requestId: z.string().min(1), output: z.unknown() })
      .strict(),
    z
      .object({ type: z.literal("error"), requestId: z.string().min(1), error: z.string() })
      .strict(),
    z.object({ type: z.literal("fatal"), error: z.string() }).strict(),
    z
      .object({
        type: z.literal("provider.connected"),
        connectionId: z.string().min(1),
        version: z.number().int().positive(),
        capabilities: z.array(z.string()),
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.connect_failed"),
        connectionId: z.string().min(1),
        error: z.string(),
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.accepted"),
        connectionId: z.string().min(1),
        acceptanceId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.rejected"),
        connectionId: z.string().min(1),
        acceptanceId: z.string().min(1),
        error: z.string(),
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.event"),
        connectionId: z.string().min(1),
        event: ProviderEventSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.closed"),
        connectionId: z.string().min(1),
        error: z.string().optional(),
      })
      .strict(),
    z.object({ type: z.literal("paseo_frame"), ...frameFields }).strict(),
    z.object({ type: z.literal("paseo_close") }).strict(),
  ],
);
