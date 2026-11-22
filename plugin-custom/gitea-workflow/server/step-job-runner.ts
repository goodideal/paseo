import { randomUUID } from "node:crypto";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { PluginWorkflowStepAdapterRegistration } from "../shared/workflow-types.js";

interface StepJobRecord {
  status: "running" | "succeeded" | "failed";
  output?: Record<string, unknown>;
  error?: string;
  updatedAt: number;
}

const FAST_SETTLE_WINDOW_MS = 1_000;
const JOB_TTL_MS = 60 * 60_000;

export class WorkflowStepJobRunner {
  private readonly adapters = new Map<string, PluginWorkflowStepAdapterRegistration>();
  private readonly jobs = new Map<string, StepJobRecord>();

  constructor(adapters: readonly PluginWorkflowStepAdapterRegistration[]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.type, adapter);
    }
  }

  async dispatch(
    payload: {
      adapterType: string;
      input: Record<string, unknown>;
      run: {
        projectId: string;
        workspaceId: string;
        runId: string;
        workspaceRoot?: string;
        runInput?: Record<string, unknown>;
        stepOutputs?: Record<string, Record<string, unknown>>;
      };
    },
    context: PluginHandlerContext,
  ): Promise<{
    status: "running" | "succeeded" | "failed";
    jobId?: string;
    output?: Record<string, unknown>;
    error?: string;
  }> {
    this.pruneOldJobs();
    const adapter = this.adapters.get(payload.adapterType);
    if (!adapter) {
      return {
        status: "failed",
        error: `Unknown gitea-workflow step adapter: ${payload.adapterType}`,
      };
    }

    const jobId = `job_${randomUUID().replaceAll("-", "")}`;
    const record: StepJobRecord = {
      status: "running",
      updatedAt: Date.now(),
    };
    this.jobs.set(jobId, record);

    const execution = adapter
      .execute(payload.input, {
        paseo: context.paseo,
        run: payload.run,
        stepOutputs: payload.run.stepOutputs,
      })
      .then((output) => {
        record.status = "succeeded";
        record.output = output;
        record.updatedAt = Date.now();
        return { status: "succeeded" as const, output };
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        record.status = "failed";
        record.error = message;
        record.updatedAt = Date.now();
        return { status: "failed" as const, error: message };
      });

    const raced = await Promise.race([
      execution,
      new Promise<"pending">((resolve) =>
        setTimeout(() => resolve("pending"), FAST_SETTLE_WINDOW_MS),
      ),
    ]);

    if (raced === "pending") {
      return { status: "running", jobId };
    }
    this.jobs.delete(jobId);
    return raced;
  }

  poll(jobId: string): {
    status: "running" | "succeeded" | "failed";
    output?: Record<string, unknown>;
    error?: string;
  } {
    const record = this.jobs.get(jobId);
    if (!record) {
      return { status: "failed", error: `Unknown or expired workflow step job: ${jobId}` };
    }
    if (record.status === "succeeded") {
      this.jobs.delete(jobId);
      return { status: "succeeded", output: record.output ?? {} };
    }
    if (record.status === "failed") {
      this.jobs.delete(jobId);
      return { status: "failed", error: record.error ?? "Step failed" };
    }
    return { status: "running" };
  }

  private pruneOldJobs(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, record] of this.jobs.entries()) {
      if (record.status !== "running" && record.updatedAt < cutoff) {
        this.jobs.delete(id);
      }
    }
  }
}
