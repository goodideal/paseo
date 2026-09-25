import { z } from "zod";
import {
  WorkflowExecutionRiskSchema,
  WorkflowPermissionSchema,
  type WorkflowExecutionRisk,
  type WorkflowPermission,
} from "./workflow-models.js";

const AdapterTypeSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const AdapterVersionSchema = z.string().trim().min(1).max(128);
const ResourceConflictKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) => !value.includes(".."),
    "resourceConflictKey must not contain traversal segments",
  );

const StepAdapterManifestMetadataSchema = z
  .object({
    type: AdapterTypeSchema,
    version: AdapterVersionSchema,
    executionRisk: WorkflowExecutionRiskSchema,
    requiredPermissions: z.array(WorkflowPermissionSchema).min(1),
    repositoryCallable: z.boolean(),
    idempotency: z.enum(["none", "required"]),
    cancellation: z.enum(["unsupported", "supported", "best_effort"]),
    recovery: z.enum(["not_resumable", "resumable", "inspect_before_retry"]),
    supportedPlatforms: z.array(z.enum(["darwin", "linux", "win32"])).min(1),
    resourceConflictKey: ResourceConflictKeySchema,
  })
  .strict();

export interface StepAdapterManifest {
  type: string;
  version: string;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  executionRisk: WorkflowExecutionRisk;
  requiredPermissions: WorkflowPermission[];
  repositoryCallable: boolean;
  idempotency: "none" | "required";
  cancellation: "unsupported" | "supported" | "best_effort";
  recovery: "not_resumable" | "resumable" | "inspect_before_retry";
  supportedPlatforms: Array<"darwin" | "linux" | "win32">;
  resourceConflictKey: string;
}

export interface RegisteredStepAdapter extends StepAdapterManifest {
  owner: { kind: "core" } | { kind: "plugin"; pluginId: string };
}

export interface PluginStepAdapterRegistration {
  pluginId: string;
  manifest: StepAdapterManifest;
}

function validateManifest(manifest: StepAdapterManifest): StepAdapterManifest {
  const allowedKeys = new Set([
    "type",
    "version",
    "inputSchema",
    "outputSchema",
    "executionRisk",
    "requiredPermissions",
    "repositoryCallable",
    "idempotency",
    "cancellation",
    "recovery",
    "supportedPlatforms",
    "resourceConflictKey",
  ]);
  for (const key of Object.keys(manifest)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`StepAdapter manifest contains unsupported field: ${key}`);
    }
  }

  const { inputSchema, outputSchema, ...metadata } = manifest;
  StepAdapterManifestMetadataSchema.parse(metadata);
  if (!(inputSchema instanceof z.ZodType) || !(outputSchema instanceof z.ZodType)) {
    throw new Error("StepAdapter manifest must provide Zod inputSchema and outputSchema");
  }
  return manifest;
}

export class StepAdapterRegistry {
  private readonly adapters = new Map<string, RegisteredStepAdapter>();

  registerCore(manifest: StepAdapterManifest): RegisteredStepAdapter {
    return this.register(manifest, { kind: "core" });
  }

  registerPlugin(registration: PluginStepAdapterRegistration): RegisteredStepAdapter {
    if (!registration.pluginId.trim()) {
      throw new Error("Plugin StepAdapter registration requires pluginId");
    }
    return this.register(registration.manifest, {
      kind: "plugin",
      pluginId: registration.pluginId,
    });
  }

  get(type: string): RegisteredStepAdapter | undefined {
    return this.adapters.get(type);
  }

  list(): RegisteredStepAdapter[] {
    return [...this.adapters.values()].sort((left, right) => left.type.localeCompare(right.type));
  }

  unregisterPlugin(pluginId: string): string[] {
    const unregistered: string[] = [];
    for (const [type, adapter] of this.adapters.entries()) {
      if (adapter.owner.kind === "plugin" && adapter.owner.pluginId === pluginId) {
        this.adapters.delete(type);
        unregistered.push(type);
      }
    }
    return unregistered;
  }

  private register(
    manifest: StepAdapterManifest,
    owner: RegisteredStepAdapter["owner"],
  ): RegisteredStepAdapter {
    const validated = validateManifest(manifest);
    const existing = this.adapters.get(validated.type);
    if (existing) {
      throw new Error(
        `StepAdapter type is already registered: ${validated.type} (owned by ${existing.owner.kind})`,
      );
    }
    const registered: RegisteredStepAdapter = { ...validated, owner };
    this.adapters.set(registered.type, registered);
    return registered;
  }
}
