import { createHash } from "node:crypto";
import type { StepAdapterRegistry } from "./step-adapter-registry.js";
import { compileWorkflowDefinition, type WorkflowDefinition } from "./definition-compiler.js";

export interface WorkflowPreset {
  workflowId: string;
  name: string;
  sourcePreset: string;
  definition: WorkflowDefinition;
}

export interface WorkflowDefinitionSummary {
  workflowId: string;
  name: string;
  sourcePreset: string;
  definitionRevision: string;
  definitionHash: string;
}

function definitionHash(definition: WorkflowDefinition): string {
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex");
}

function toSummary(preset: WorkflowPreset): WorkflowDefinitionSummary {
  return {
    workflowId: preset.workflowId,
    name: preset.name,
    sourcePreset: preset.sourcePreset,
    definitionRevision: preset.definition.revision,
    definitionHash: definitionHash(preset.definition),
  };
}

export class WorkflowPresetRegistry {
  private readonly presets = new Map<string, WorkflowPreset>();

  constructor(private readonly registry: StepAdapterRegistry) {}

  register(preset: WorkflowPreset): WorkflowPreset {
    if (this.presets.has(preset.workflowId)) {
      throw new Error(`Workflow preset is already registered: ${preset.workflowId}`);
    }
    compileWorkflowDefinition({ preset: preset.definition, registry: this.registry });
    this.presets.set(preset.workflowId, preset);
    return preset;
  }

  get(workflowId: string): WorkflowPreset | undefined {
    return this.presets.get(workflowId);
  }

  list(): WorkflowDefinitionSummary[] {
    return [...this.presets.values()]
      .map(toSummary)
      .sort((left, right) => left.workflowId.localeCompare(right.workflowId));
  }

  inspect(workflowId: string): WorkflowDefinitionSummary | undefined {
    const preset = this.get(workflowId);
    return preset ? toSummary(preset) : undefined;
  }

  unregisterPlugin(pluginId: string): string[] {
    const removed: string[] = [];
    for (const [workflowId, preset] of this.presets) {
      if (preset.sourcePreset === pluginId) {
        this.presets.delete(workflowId);
        removed.push(workflowId);
      }
    }
    return removed;
  }
}

export function createWorkflowPresetRegistry(
  registry: StepAdapterRegistry,
): WorkflowPresetRegistry {
  const presets = new WorkflowPresetRegistry(registry);
  presets.register({
    workflowId: "core.workflow-mvp",
    name: "Core workflow MVP",
    sourcePreset: "core",
    definition: {
      id: "core.workflow-mvp",
      revision: "1",
      maxConcurrency: 1,
      maxArtifactBytes: 1024 * 1024,
      steps: [
        {
          id: "approval",
          type: "approval.wait",
          timeoutMs: 15 * 60 * 1000,
          retries: 0,
          concurrency: 1,
          approval: "required",
        },
      ],
    },
  });
  return presets;
}
