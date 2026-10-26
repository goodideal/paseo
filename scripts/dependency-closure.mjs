import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * 计算全局运行时缺失的第三方依赖闭包。
 *
 * 背景：install-local 增量同步只覆盖 @getpaseo/* 包的 dist + package.json，
 * 上游新增的第三方运行时依赖（如 0.13.0 为 relay 新增的 @noble/*）不会出现在
 * 全局运行时 node_modules 里，全局 CLI 会抛 ERR_MODULE_NOT_FOUND。
 *
 * 从 roots（全局运行时中的包目录）出发遍历 dependencies —— 不含 optionalDependencies，
 * 平台相关原生二进制由 npm 安装期决定：
 * - 依赖在 targetNodeModules 已存在 → 满足，不递归（全局树由 npm 安装，自身一致）；
 * - 缺失但 workspaceNodeModules 有 → 进 toCopy，并递归其依赖（拷贝树必须自身闭合）；
 * - 两侧都缺失 → 进 unavailable，由调用方告警。
 *
 * @param {{ roots: string[], targetNodeModules: string, workspaceNodeModules: string }} input
 * @returns {{ toCopy: string[], unavailable: string[] }} 依赖名，按发现顺序去重
 */
export function computeMissingDependencies({ roots, targetNodeModules, workspaceNodeModules }) {
  const toCopy = [];
  const unavailable = [];
  const seen = new Set();

  const manifestOf = (dir) => {
    const manifestPath = path.join(dir, "package.json");
    if (!existsSync(manifestPath)) return null;
    try {
      return JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      return null;
    }
  };

  const visitManifest = (dir) => {
    const pkg = manifestOf(dir);
    if (!pkg) return;
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      if (existsSync(path.join(targetNodeModules, dep))) continue;
      const workspaceDir = path.join(workspaceNodeModules, dep);
      if (existsSync(workspaceDir)) {
        toCopy.push(dep);
        visitManifest(workspaceDir);
      } else {
        unavailable.push(dep);
      }
    }
  };

  for (const root of roots) visitManifest(root);
  return { toCopy, unavailable };
}
