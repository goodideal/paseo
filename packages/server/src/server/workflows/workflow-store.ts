import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensurePrivateDirectory, writePrivateFileAtomicSync } from "../private-files.js";
import { WorkflowRunSchema, type WorkflowRun } from "./workflow-models.js";

export interface WorkflowScope {
  projectId: string;
  workspaceId: string;
}

export interface WorkflowStoreGetInput extends WorkflowScope {
  runId: string;
}

export interface WorkflowStoreOptions {
  paseoHome: string;
}

export class WorkflowStore {
  private readonly runsDirectory: string;

  constructor(options: WorkflowStoreOptions) {
    this.runsDirectory = path.join(options.paseoHome, "workflows", "runs");
  }

  create(run: WorkflowRun): WorkflowRun {
    const validated = WorkflowRunSchema.parse(run);
    const target = this.filePath(validated.id);
    if (existsSync(target)) {
      throw new Error(`Workflow run already exists: ${validated.id}`);
    }
    this.write(validated);
    return validated;
  }

  get(input: WorkflowStoreGetInput): WorkflowRun | undefined {
    const run = this.read(input.runId);
    if (!run || run.projectId !== input.projectId || run.workspaceId !== input.workspaceId) {
      return undefined;
    }
    return run;
  }

  list(scope?: WorkflowScope): WorkflowRun[] {
    this.ensureDirectory();
    return readdirSync(this.runsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => this.readRequired(entry.name.slice(0, -5)))
      .filter((run) =>
        scope ? run.projectId === scope.projectId && run.workspaceId === scope.workspaceId : true,
      )
      .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
  }

  update(
    input: WorkflowStoreGetInput,
    updater: (current: WorkflowRun) => WorkflowRun,
  ): WorkflowRun {
    const current = this.get(input);
    if (!current) {
      throw new Error(`Workflow run was not found in scope: ${input.runId}`);
    }
    const updated = WorkflowRunSchema.parse(updater(current));
    if (
      updated.id !== current.id ||
      updated.projectId !== current.projectId ||
      updated.workspaceId !== current.workspaceId
    ) {
      throw new Error("Workflow run update cannot change identity or scope");
    }
    this.write(updated);
    return updated;
  }

  private read(runId: string): WorkflowRun | undefined {
    const target = this.filePath(runId);
    if (!existsSync(target)) {
      return undefined;
    }
    return this.readRequired(runId);
  }

  private readRequired(runId: string): WorkflowRun {
    const target = this.filePath(runId);
    try {
      return WorkflowRunSchema.parse(JSON.parse(readFileSync(target, "utf8")));
    } catch (error) {
      throw new Error(`Workflow run is invalid: ${runId}`, { cause: error });
    }
  }

  private write(run: WorkflowRun): void {
    this.ensureDirectory();
    writePrivateFileAtomicSync(this.filePath(run.id), `${JSON.stringify(run, null, 2)}\n`);
  }

  private ensureDirectory(): void {
    ensurePrivateDirectory(this.runsDirectory);
  }

  private filePath(runId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
      throw new Error(`Workflow run id is invalid: ${runId}`);
    }
    return path.join(this.runsDirectory, `${runId}.json`);
  }
}
