import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ScreenshotMetadata } from "../shared/types.js";

export interface FormatServiceUrlParams {
  scriptName: string;
  branchName: string;
  projectName: string;
}

export interface ScreenshotBroker {
  execute(command: {
    command: string;
    args?: Record<string, unknown>;
  }): Promise<{ ok: boolean; result?: { browserId?: string; base64?: string }; error?: unknown }>;
}

export function formatServiceProxyUrl(params: FormatServiceUrlParams): string {
  const normalizedBranch = params.branchName.replace(/[^a-zA-Z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  if (params.branchName === "main" || params.branchName === "master") {
    return `http://${params.scriptName}--${params.projectName}.localhost`;
  }
  return `http://${params.scriptName}--${normalizedBranch}--${params.projectName}.localhost`;
}

export async function captureViewports(params: {
  broker: ScreenshotBroker;
  url: string;
  outputDir: string;
}): Promise<ScreenshotMetadata[]> {
  const viewports = [
    { id: "desktop", label: "Desktop (1280x800)", width: 1280, height: 800 },
    { id: "mobile", label: "Mobile (375x667)", width: 375, height: 667 },
  ];

  const results: ScreenshotMetadata[] = [];
  const newTabRes = await params.broker.execute({ command: "new_tab", args: { url: params.url } });
  if (!newTabRes.ok || !newTabRes.result?.browserId) {
    throw new Error(`Failed to open browser tab: ${JSON.stringify(newTabRes.error)}`);
  }
  const browserId = newTabRes.result.browserId;

  try {
    await params.broker.execute({
      command: "wait",
      args: { browserId, url: params.url, timeoutMs: 5000 },
    });

    for (const vp of viewports) {
      await params.broker.execute({
        command: "resize",
        args: { browserId, width: vp.width, height: vp.height },
      });

      const snapRes = await params.broker.execute({
        command: "screenshot",
        args: { browserId, fullPage: false },
      });

      const relativePath = `screenshots/${vp.id}.png`;
      const fullPath = join(params.outputDir, relativePath);
      await mkdir(dirname(fullPath), { recursive: true });

      if (snapRes.result?.base64) {
        await writeFile(fullPath, Buffer.from(snapRes.result.base64, "base64"));
      } else {
        await writeFile(fullPath, Buffer.from(""));
      }

      results.push({
        id: vp.id,
        label: vp.label,
        viewport: { width: vp.width, height: vp.height },
        relativePath,
        capturedAt: new Date().toISOString(),
      });
    }
  } finally {
    await params.broker.execute({ command: "close_tab", args: { browserId } });
  }

  return results;
}

export const ScreenshotPipeline = {
  formatServiceProxyUrl,
  captureViewports,
};
