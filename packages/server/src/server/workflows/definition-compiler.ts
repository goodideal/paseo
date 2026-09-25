import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { StepAdapterRegistry } from "./step-adapter-registry.js";

const MAX_STEPS = 64;
const MAX_DEPTH = 16;
const MAX_FAN_OUT = 16;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_RETRIES = 8;
const MAX_CONCURRENCY = 16;
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const StepIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/);
const StepApprovalSchema = z.enum(["required", "automatic"]);

const WorkflowStepSchema = z
  .object({
    id: StepIdSchema,
    type: z.string().trim().min(1),
    dependsOn: z.array(StepIdSchema).max(MAX_FAN_OUT).optional(),
    when: z.string().trim().min(1).max(1024).optional(),
    promptPath: z.string().trim().min(1).max(1024).optional(),
    input: z.record(z.string(), z.json()).optional(),
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS),
    retries: z.number().int().min(0).max(MAX_RETRIES),
    concurrency: z.number().int().positive().max(MAX_CONCURRENCY),
    approval: StepApprovalSchema,
  })
  .strict();

export const WorkflowDefinitionSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    revision: z.string().trim().min(1).max(128),
    maxConcurrency: z.number().int().positive().max(MAX_CONCURRENCY),
    maxArtifactBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    steps: z.array(WorkflowStepSchema).min(1).max(MAX_STEPS),
  })
  .strict();

const WorkflowStepOverrideSchema = z
  .object({
    enabled: z.boolean().optional(),
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
    retries: z.number().int().min(0).max(MAX_RETRIES).optional(),
    concurrency: z.number().int().positive().max(MAX_CONCURRENCY).optional(),
    approval: StepApprovalSchema.optional(),
  })
  .strict();

export const WorkflowDefinitionOverrideSchema = z
  .object({
    maxConcurrency: z.number().int().positive().max(MAX_CONCURRENCY).optional(),
    maxArtifactBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES).optional(),
    steps: z.record(StepIdSchema, WorkflowStepOverrideSchema).optional(),
  })
  .strict();

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type WorkflowDefinitionOverride = z.infer<typeof WorkflowDefinitionOverrideSchema>;

export interface ResolvedWorkflowDefinition extends WorkflowDefinition {
  steps: WorkflowDefinition["steps"];
}

export interface CompileWorkflowDefinitionInput {
  preset: WorkflowDefinition;
  repositoryOverride?: WorkflowDefinitionOverride;
  runtimeOverride?: WorkflowDefinitionOverride;
  registry: StepAdapterRegistry;
  promptRoot?: string;
}

export interface CompiledWorkflowDefinition {
  definition: ResolvedWorkflowDefinition;
  definitionHash: string;
  promptHashes: Record<string, string>;
}

interface ConditionValue {
  value: boolean;
  skippedReason?: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

function parseReference(reference: string): { stepId: string; output: string } | null {
  const result = /^steps\.([a-z][a-z0-9_-]{0,63})\.outputs\.([A-Za-z][A-Za-z0-9_]*)$/.exec(
    reference,
  );
  return result ? { stepId: result[1], output: result[2] } : null;
}

function outputKeys(schema: z.ZodType): Set<string> {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error("StepAdapter outputSchema must be a Zod object for DSL validation");
  }
  return new Set(Object.keys(schema.shape));
}

function validateReference(
  definition: WorkflowDefinition,
  stepId: string,
  reference: string,
  registry: StepAdapterRegistry,
): void {
  const parsed = parseReference(reference);
  if (!parsed) {
    throw new Error(
      `Workflow ${definition.id} step ${stepId} has an invalid reference: ${reference}`,
    );
  }
  const source = definition.steps.find((step) => step.id === parsed.stepId);
  if (!source) {
    throw new Error(
      `Workflow ${definition.id} step ${stepId} references missing step: ${parsed.stepId}`,
    );
  }
  const adapter = registry.get(source.type);
  if (!adapter) {
    throw new Error(
      `Workflow ${definition.id} step ${source.id} uses unregistered type: ${source.type}`,
    );
  }
  if (!outputKeys(adapter.outputSchema).has(parsed.output)) {
    throw new Error(
      `Workflow ${definition.id} step ${stepId} references undeclared output: ${reference}`,
    );
  }
}

function validateCondition(
  definition: WorkflowDefinition,
  step: WorkflowDefinition["steps"][number],
  registry: StepAdapterRegistry,
): void {
  if (!step.when) return;
  const expression = step.when.trim();
  const match =
    /^(steps\.[a-z][a-z0-9_-]{0,63}\.outputs\.[A-Za-z][A-Za-z0-9_]*)\s*(==|!=)\s*(true|false)$/.exec(
      expression,
    );
  if (!match) {
    throw new Error(
      `Workflow ${definition.id} step ${step.id} has an invalid condition expression`,
    );
  }
  validateReference(definition, step.id, match[1], registry);
}

function validatePrompt(
  definition: WorkflowDefinition,
  step: WorkflowDefinition["steps"][number],
  registry: StepAdapterRegistry,
  promptRoot: string | undefined,
): string | undefined {
  if (!step.promptPath) return undefined;
  if (!promptRoot) {
    throw new Error(
      `Workflow ${definition.id} step ${step.id} declares a prompt without promptRoot`,
    );
  }
  const root = path.resolve(promptRoot);
  const promptPath = path.resolve(root, step.promptPath);
  const relative = path.relative(root, promptPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Workflow ${definition.id} step ${step.id} prompt escapes the prompt root`);
  }
  if (!promptPath.endsWith(".md") || !existsSync(promptPath)) {
    throw new Error(
      `Workflow ${definition.id} step ${step.id} prompt is missing Markdown: ${step.promptPath}`,
    );
  }
  const content = readFileSync(promptPath, "utf8");
  for (const placeholder of content.matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
    const reference = placeholder[1].trim();
    if (
      reference.startsWith("env.") ||
      reference.startsWith("process.") ||
      reference.startsWith("secrets.")
    ) {
      throw new Error(
        `Workflow ${definition.id} step ${step.id} placeholder is not allowlisted: ${reference}`,
      );
    }
    if (reference.startsWith("steps.")) {
      validateReference(definition, step.id, reference, registry);
      continue;
    }
    if (!/^(workflow|run|workspace|directive)(?:\.[A-Za-z][A-Za-z0-9_]*)*$/.test(reference)) {
      throw new Error(
        `Workflow ${definition.id} step ${step.id} placeholder is not allowlisted: ${reference}`,
      );
    }
  }
  return hash(content);
}

function validateGraph(definition: WorkflowDefinition, registry: StepAdapterRegistry): void {
  const ids = new Set<string>();
  for (const step of definition.steps) {
    if (ids.has(step.id))
      throw new Error(`Workflow ${definition.id} contains duplicate step id: ${step.id}`);
    ids.add(step.id);
    if (!registry.get(step.type)) {
      throw new Error(
        `Workflow ${definition.id} step ${step.id} uses unregistered type: ${step.type}`,
      );
    }
  }
  for (const step of definition.steps) {
    for (const dependency of step.dependsOn ?? []) {
      if (!ids.has(dependency)) {
        throw new Error(
          `Workflow ${definition.id} step ${step.id} depends on missing step: ${dependency}`,
        );
      }
    }
    validateCondition(definition, step, registry);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(stepId: string, depth: number): void {
    if (depth > MAX_DEPTH) throw new Error(`Workflow ${definition.id} exceeds maximum DAG depth`);
    if (visiting.has(stepId))
      throw new Error(`Workflow ${definition.id} contains a dependency cycle`);
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    const step = definition.steps.find((candidate) => candidate.id === stepId);
    for (const dependency of step?.dependsOn ?? []) visit(dependency, depth + 1);
    visiting.delete(stepId);
    visited.add(stepId);
  }
  for (const step of definition.steps) visit(step.id, 1);
}

function validateDefinitionLimits(
  current: WorkflowDefinition,
  override: WorkflowDefinitionOverride,
): void {
  if (override.maxConcurrency !== undefined && override.maxConcurrency > current.maxConcurrency) {
    throw new Error("Workflow override cannot increase maxConcurrency");
  }
  if (
    override.maxArtifactBytes !== undefined &&
    override.maxArtifactBytes > current.maxArtifactBytes
  ) {
    throw new Error("Workflow override cannot increase maxArtifactBytes");
  }
}

function mergeStepOverride(
  preset: WorkflowDefinition,
  currentStep: WorkflowDefinition["steps"][number] | undefined,
  stepId: string,
  override: NonNullable<WorkflowDefinitionOverride["steps"]>[string],
): WorkflowDefinition["steps"][number] | undefined {
  if (!preset.steps.some((step) => step.id === stepId)) {
    throw new Error(`Workflow override step does not exist in the preset: ${stepId}`);
  }
  if (currentStep === undefined) {
    if (override.enabled === true) {
      throw new Error(`Workflow override cannot re-enable disabled step: ${stepId}`);
    }
    return undefined;
  }
  const activeStep = currentStep;
  if (override.enabled === false) return undefined;
  if (override.timeoutMs !== undefined && override.timeoutMs > activeStep.timeoutMs) {
    throw new Error(`Workflow override cannot increase timeout for step: ${stepId}`);
  }
  if (override.retries !== undefined && override.retries > activeStep.retries) {
    throw new Error(`Workflow override cannot increase retries for step: ${stepId}`);
  }
  if (override.concurrency !== undefined && override.concurrency > activeStep.concurrency) {
    throw new Error(`Workflow override cannot increase concurrency for step: ${stepId}`);
  }
  if (override.approval === "automatic" && activeStep.approval === "required") {
    throw new Error(`Workflow override cannot relax approval for step: ${stepId}`);
  }
  return Object.assign({}, activeStep, {
    timeoutMs: override.timeoutMs ?? activeStep.timeoutMs,
    retries: override.retries ?? activeStep.retries,
    concurrency: override.concurrency ?? activeStep.concurrency,
    approval: override.approval ?? activeStep.approval,
  });
}

function applyOverride(
  preset: WorkflowDefinition,
  current: WorkflowDefinition,
  override: WorkflowDefinitionOverride,
): WorkflowDefinition {
  const parsed = WorkflowDefinitionOverrideSchema.parse(override);
  validateDefinitionLimits(current, parsed);
  const overrides = parsed.steps ?? {};
  const steps: WorkflowDefinition["steps"] = [];
  for (const step of current.steps) {
    const stepOverride = overrides[step.id];
    const merged = stepOverride ? mergeStepOverride(preset, step, step.id, stepOverride) : step;
    if (merged) steps.push(merged);
  }
  for (const stepId of Object.keys(overrides)) {
    if (!current.steps.some((step) => step.id === stepId)) {
      mergeStepOverride(preset, undefined, stepId, overrides[stepId]);
    }
  }
  return WorkflowDefinitionSchema.parse({
    id: current.id,
    revision: current.revision,
    maxConcurrency: parsed.maxConcurrency ?? current.maxConcurrency,
    maxArtifactBytes: parsed.maxArtifactBytes ?? current.maxArtifactBytes,
    steps,
  });
}

export function compileWorkflowDefinition(
  input: CompileWorkflowDefinitionInput,
): CompiledWorkflowDefinition {
  const preset = WorkflowDefinitionSchema.parse(input.preset);
  let definition = preset;
  if (input.repositoryOverride)
    definition = applyOverride(preset, definition, input.repositoryOverride);
  if (input.runtimeOverride) definition = applyOverride(preset, definition, input.runtimeOverride);
  validateGraph(definition, input.registry);

  const promptHashes: Record<string, string> = {};
  for (const step of definition.steps) {
    const promptHash = validatePrompt(definition, step, input.registry, input.promptRoot);
    if (promptHash) promptHashes[step.id] = promptHash;
  }

  return {
    definition,
    definitionHash: hash(JSON.stringify(canonicalize({ definition, promptHashes }))),
    promptHashes,
  };
}

export function evaluateCondition(
  expression: string,
  outputs: Record<string, Record<string, unknown>>,
): ConditionValue {
  const match =
    /^(steps\.([a-z][a-z0-9_-]{0,63})\.outputs\.([A-Za-z][A-Za-z0-9_]*))\s*(==|!=)\s*(true|false)$/.exec(
      expression.trim(),
    );
  if (!match) throw new Error("Condition expression is invalid");
  const actual = outputs[match[2]]?.[match[3]];
  if (typeof actual !== "boolean") throw new Error(`Condition output is unavailable: ${match[1]}`);
  const expected = match[5] === "true";
  const value = match[4] === "==" ? actual === expected : actual !== expected;
  return value ? { value } : { value, skippedReason: "Condition evaluated to false" };
}
