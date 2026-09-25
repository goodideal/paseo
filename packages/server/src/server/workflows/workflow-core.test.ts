import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { compileWorkflowDefinition, evaluateCondition } from "./definition-compiler.js";
import { StepAdapterRegistry } from "./step-adapter-registry.js";
import { WorkflowStore } from "./workflow-store.js";
import type { WorkflowRun } from "./workflow-models.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

function makeRegistry(): StepAdapterRegistry {
  const registry = new StepAdapterRegistry();
  registry.registerCore({
    type: "verify.command",
    version: "1.0.0",
    inputSchema: z.object({ profile: z.string() }).strict(),
    outputSchema: z.object({ passed: z.boolean(), report: z.string() }).strict(),
    executionRisk: "workspace_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "required",
    cancellation: "supported",
    recovery: "resumable",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "workspace:{{workspaceId}}:verify",
  });
  registry.registerCore({
    type: "git.create_pr",
    version: "1.0.0",
    inputSchema: z.object({ title: z.string() }).strict(),
    outputSchema: z.object({ url: z.string() }).strict(),
    executionRisk: "external_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "required",
    cancellation: "best_effort",
    recovery: "inspect_before_retry",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "workspace:{{workspaceId}}:branch:{{branch}}",
  });
  return registry;
}

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run_0000000000000001",
    projectId: "prj_0000000000000001",
    workspaceId: "wsp_0000000000000001",
    definitionId: "visual-repair",
    definitionRevision: "rev_1",
    definitionHash: "a".repeat(64),
    workspaceRoot: "/workspace/project",
    principalId: "principal_1",
    status: "queued",
    createdAt: 1,
    updatedAt: 1,
    stepAttempts: [],
    approvals: [],
    artifacts: [],
    intents: [],
    receipts: [],
    leases: [],
    unknownOutcomes: [],
    ...overrides,
  };
}

function makeDefinition() {
  return {
    id: "visual-repair",
    revision: "rev_1",
    maxConcurrency: 2,
    maxArtifactBytes: 1024,
    steps: [
      {
        id: "verify",
        type: "verify.command",
        timeoutMs: 30_000,
        retries: 1,
        concurrency: 1,
        approval: "required",
      },
      {
        id: "ship",
        type: "git.create_pr",
        dependsOn: ["verify"],
        timeoutMs: 30_000,
        retries: 0,
        concurrency: 1,
        approval: "required",
      },
    ],
  };
}

describe("workflow core", () => {
  it("persists scope-bound runs atomically below the injected PASEO_HOME", () => {
    const paseoHome = makeTempDirectory("paseo-workflow-home-");
    const store = new WorkflowStore({ paseoHome });
    const first = makeRun();
    const second = makeRun({
      id: "run_0000000000000002",
      workspaceId: "wsp_0000000000000002",
    });

    store.create(first);
    store.create(second);

    expect(store.list({ projectId: first.projectId, workspaceId: first.workspaceId })).toEqual([
      first,
    ]);
    expect(
      store.get({ projectId: first.projectId, workspaceId: first.workspaceId, runId: first.id }),
    ).toEqual(first);
    expect(
      store.get({ projectId: first.projectId, workspaceId: second.workspaceId, runId: first.id }),
    ).toBeUndefined();

    const runPath = path.join(paseoHome, "workflows", "runs", `${first.id}.json`);
    expect(existsSync(runPath)).toBe(true);
    expect(JSON.parse(readFileSync(runPath, "utf8"))).toMatchObject({ id: first.id });
    expect(() => store.create({ ...first, status: "not-a-status" } as never)).toThrow();
  });

  it("rejects corrupt persisted runs instead of returning them across a scope", () => {
    const paseoHome = makeTempDirectory("paseo-workflow-home-");
    const store = new WorkflowStore({ paseoHome });
    const run = makeRun();
    store.create(run);
    writeFileSync(path.join(paseoHome, "workflows", "runs", `${run.id}.json`), "{invalid");

    expect(() =>
      store.get({ projectId: run.projectId, workspaceId: run.workspaceId, runId: run.id }),
    ).toThrow("Workflow run is invalid");
  });

  it("allows plugin overrides only to disable steps and tighten limits", () => {
    const result = compileWorkflowDefinition({
      preset: makeDefinition(),
      repositoryOverride: {
        steps: {
          ship: { enabled: false },
          verify: { timeoutMs: 10_000, retries: 0, concurrency: 1 },
        },
      },
      runtimeOverride: { steps: { verify: { timeoutMs: 5_000 } } },
      registry: makeRegistry(),
    });

    expect(result.definition.steps).toEqual([
      expect.objectContaining({ id: "verify", timeoutMs: 5_000, retries: 0 }),
    ]);
    expect(result.definitionHash).toHaveLength(64);
    expect(() =>
      compileWorkflowDefinition({
        preset: makeDefinition(),
        runtimeOverride: { steps: { ship: { approval: "automatic" } } },
        registry: makeRegistry(),
      }),
    ).toThrow("cannot relax approval");
    expect(() =>
      compileWorkflowDefinition({
        preset: makeDefinition(),
        repositoryOverride: { steps: { invented: { enabled: false } } },
        registry: makeRegistry(),
      }),
    ).toThrow("does not exist in the preset");
  });

  it("pins only in-root prompt templates with declared placeholders", () => {
    const promptRoot = makeTempDirectory("paseo-workflow-prompts-");
    writeFileSync(path.join(promptRoot, "review.md"), "Review {{ steps.verify.outputs.report }}");
    const definition = makeDefinition();
    definition.steps[1].promptPath = "review.md";

    const result = compileWorkflowDefinition({
      preset: definition,
      registry: makeRegistry(),
      promptRoot,
    });
    expect(result.promptHashes).toEqual({ ship: expect.stringMatching(/^[a-f0-9]{64}$/) });

    definition.steps[1].promptPath = "../outside.md";
    expect(() =>
      compileWorkflowDefinition({ preset: definition, registry: makeRegistry(), promptRoot }),
    ).toThrow("escapes the prompt root");

    writeFileSync(path.join(promptRoot, "review.md"), "{{ env.GITHUB_TOKEN }}");
    definition.steps[1].promptPath = "review.md";
    expect(() =>
      compileWorkflowDefinition({ preset: definition, registry: makeRegistry(), promptRoot }),
    ).toThrow("not allowlisted");
  });

  it("rejects finite DAG violations and reports false conditions as skipped", () => {
    const cyclic = makeDefinition();
    cyclic.steps[0].dependsOn = ["ship"];
    expect(() => compileWorkflowDefinition({ preset: cyclic, registry: makeRegistry() })).toThrow(
      "cycle",
    );

    const invalidOutput = makeDefinition();
    invalidOutput.steps[1].when = "steps.verify.outputs.missing == true";
    expect(() =>
      compileWorkflowDefinition({ preset: invalidOutput, registry: makeRegistry() }),
    ).toThrow("undeclared output");

    expect(
      evaluateCondition("steps.verify.outputs.passed == true", { verify: { passed: false } }),
    ).toEqual({
      value: false,
      skippedReason: "Condition evaluated to false",
    });
  });

  it("keeps core adapter types owned by core and accepts no dynamic module field", () => {
    const registry = makeRegistry();
    expect(() =>
      registry.registerPlugin({
        pluginId: "visual-crawler",
        manifest: {
          type: "verify.command",
          version: "2.0.0",
          inputSchema: z.object({}).strict(),
          outputSchema: z.object({}).strict(),
          executionRisk: "read",
          requiredPermissions: ["workspace.read"],
          repositoryCallable: true,
          idempotency: "none",
          cancellation: "unsupported",
          recovery: "not_resumable",
          supportedPlatforms: ["darwin"],
          resourceConflictKey: "workspace:{{workspaceId}}",
        },
      }),
    ).toThrow("already registered");
    expect(() =>
      registry.registerCore({
        type: "invalid.module",
        version: "1.0.0",
        inputSchema: z.object({}).strict(),
        outputSchema: z.object({}).strict(),
        executionRisk: "read",
        requiredPermissions: ["workspace.read"],
        repositoryCallable: false,
        idempotency: "none",
        cancellation: "unsupported",
        recovery: "not_resumable",
        supportedPlatforms: ["darwin"],
        resourceConflictKey: "workspace:{{workspaceId}}",
        module: "file:///unsafe.mjs",
      } as never),
    ).toThrow();
  });
});
