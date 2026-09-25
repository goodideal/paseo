import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerBuiltInWorkflowStepManifests } from "./core-step-manifests.js";
import { StepAdapterRegistry } from "./step-adapter-registry.js";
import { WorkflowService } from "./workflow-service.js";
import { WorkflowStore } from "./workflow-store.js";
import type { WorkflowDefinition } from "./definition-compiler.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function setup() {
  const paseoHome = mkdtempSync(path.join(tmpdir(), "plugin-wf-test-"));
  tempDirs.push(paseoHome);
  const registry = new StepAdapterRegistry();
  registerBuiltInWorkflowStepManifests(registry);
  const store = new WorkflowStore({ paseoHome });
  const service = new WorkflowService({
    store,
    registry,
    now: () => 1000,
    createId: (kind) => `${kind}_0000000000000001`,
  });
  return { paseoHome, registry, store, service };
}

describe("Workflow Plugin Contribution and Lifecycle Integration (Task 4.2)", () => {
  it("allows plugin to register custom step adapter and rejects duplicate core types", () => {
    const { registry } = setup();

    // Register a valid plugin step adapter
    registry.registerPlugin({
      pluginId: "visual-crawler",
      manifest: {
        type: "crawler.inspect_dom",
        version: "1.0.0",
        inputSchema: z.object({ selector: z.string() }).strict(),
        outputSchema: z.object({ found: z.boolean() }).strict(),
        executionRisk: "workspace_observe",
        requiredPermissions: ["workspace.read"],
        repositoryCallable: true,
        idempotency: "none",
        cancellation: "supported",
        recovery: "not_resumable",
        supportedPlatforms: ["darwin", "linux", "win32"],
        resourceConflictKey: "workspace:{{workspaceId}}:crawler",
      },
    });

    expect(registry.get("crawler.inspect_dom")).toBeDefined();
    expect(registry.get("crawler.inspect_dom")?.owner).toEqual({
      kind: "plugin",
      pluginId: "visual-crawler",
    });

    // Attempting to register existing Core type must throw
    expect(() =>
      registry.registerPlugin({
        pluginId: "visual-crawler",
        manifest: {
          type: "verify.command", // already registered core type
          version: "1.0.0",
          inputSchema: z.object({}).strict(),
          outputSchema: z.object({}).strict(),
          executionRisk: "workspace_observe",
          requiredPermissions: ["workspace.read"],
          repositoryCallable: true,
          idempotency: "none",
          cancellation: "supported",
          recovery: "not_resumable",
          supportedPlatforms: ["darwin"],
          resourceConflictKey: "workspace:{{workspaceId}}",
        },
      }),
    ).toThrow("already registered");

    // Core adapter remains intact
    expect(registry.get("verify.command")?.owner).toEqual({ kind: "core" });
  });

  it("rejects duplicate type registrations from another plugin", () => {
    const { registry } = setup();
    registry.registerPlugin({
      pluginId: "plugin-alpha",
      manifest: {
        type: "custom.action",
        version: "1.0.0",
        inputSchema: z.object({}).strict(),
        outputSchema: z.object({}).strict(),
        executionRisk: "read",
        requiredPermissions: ["workspace.read"],
        repositoryCallable: true,
        idempotency: "none",
        cancellation: "supported",
        recovery: "resumable",
        supportedPlatforms: ["darwin"],
        resourceConflictKey: "workspace:{{workspaceId}}",
      },
    });

    expect(() =>
      registry.registerPlugin({
        pluginId: "plugin-beta",
        manifest: {
          type: "custom.action",
          version: "2.0.0",
          inputSchema: z.object({}).strict(),
          outputSchema: z.object({}).strict(),
          executionRisk: "read",
          requiredPermissions: ["workspace.read"],
          repositoryCallable: true,
          idempotency: "none",
          cancellation: "supported",
          recovery: "resumable",
          supportedPlatforms: ["darwin"],
          resourceConflictKey: "workspace:{{workspaceId}}",
        },
      }),
    ).toThrow("already registered: custom.action (owned by plugin)");
  });

  it("unregisters plugin adapters, rejects new runs, and transitions active runs to blocked on unload", () => {
    const { registry, service } = setup();

    registry.registerPlugin({
      pluginId: "visual-crawler",
      manifest: {
        type: "crawler.review_triage",
        version: "1.0.0",
        inputSchema: z.object({}).strict(),
        outputSchema: z.object({ approved: z.boolean() }).strict(),
        executionRisk: "workspace_write",
        requiredPermissions: ["workspace.write"],
        repositoryCallable: true,
        idempotency: "none",
        cancellation: "supported",
        recovery: "not_resumable",
        supportedPlatforms: ["darwin", "linux", "win32"],
        resourceConflictKey: "workspace:{{workspaceId}}:triage",
      },
    });

    const pluginDef: WorkflowDefinition = {
      id: "crawler-workflow",
      revision: "rev1",
      maxConcurrency: 1,
      maxArtifactBytes: 1024,
      steps: [
        {
          id: "triage",
          type: "crawler.review_triage",
          timeoutMs: 10_000,
          retries: 0,
          concurrency: 1,
          approval: "required",
        },
      ],
    };

    // Create a run using this plugin adapter
    const run = service.create({
      projectId: "prj_1",
      workspaceId: "wsp_1",
      principalId: "user_1",
      workspaceRoot: "/workspace",
      definition: pluginDef,
    });
    expect(run.status).toBe("waiting_approval");
    expect(run.stepAttempts[0].adapterType).toBe("crawler.review_triage");

    // Unload the plugin
    const unregistered = registry.unregisterPlugin("visual-crawler");
    expect(unregistered).toEqual(["crawler.review_triage"]);
    expect(registry.get("crawler.review_triage")).toBeUndefined();

    // Inform service of plugin unload
    service.handlePluginUnload("visual-crawler", unregistered);

    // Active run must now be blocked with actionable reason
    const inspected = service.inspect({ projectId: "prj_1", workspaceId: "wsp_1", runId: run.id });
    expect(inspected.status).toBe("blocked");
    expect(inspected.stepAttempts[0]).toMatchObject({
      status: "blocked",
      failureClassification: "dependency_unavailable",
      skipReason: "Plugin visual-crawler contribution unavailable",
    });

    // New runs using the unregistered adapter are rejected
    expect(() =>
      service.create({
        projectId: "prj_1",
        workspaceId: "wsp_1",
        principalId: "user_1",
        workspaceRoot: "/workspace",
        definition: pluginDef,
      }),
    ).toThrow("unregistered type: crawler.review_triage");
  });
});
