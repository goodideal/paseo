import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

interface MinimalWorkspaceRecord {
  workspaceId: string;
  cwd: string;
  title: string | null;
  displayName: string;
}

export function resolveWorkspaceNameFast(workspaceId: string, fallbackCwd: string): string {
  const paseoHome = process.env.PASEO_HOME || path.join(homedir(), ".paseo");
  const workspacesFilePath = path.join(paseoHome, "projects", "workspaces.json");

  if (existsSync(workspacesFilePath)) {
    try {
      const content = readFileSync(workspacesFilePath, "utf8");
      const records = JSON.parse(content) as MinimalWorkspaceRecord[];
      const found = records.find((item) => item.workspaceId === workspaceId);
      if (found) {
        if (found.title && found.title.trim().length > 0) {
          return found.title.trim();
        }
        if (found.displayName && found.displayName.trim().length > 0) {
          return found.displayName.trim();
        }
      }
    } catch {
      // 容错降级，不阻断主链路
    }
  }

  // 兜底返回 CWD 的目录名
  try {
    return path.basename(fallbackCwd) || workspaceId;
  } catch {
    return workspaceId;
  }
}
