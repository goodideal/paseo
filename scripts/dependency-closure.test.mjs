import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { computeMissingDependencies } from "./dependency-closure.mjs";

// 构造最小 node_modules 布局：pkg(name, deps, extra) 写出 package.json，支持 @scope/name 目录结构。
function makeNodeModules(root) {
  return {
    pkg(name, deps = {}, extra = {}) {
      const dir = path.join(root, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name, version: "1.0.0", dependencies: deps, ...extra }),
      );
      return dir;
    },
  };
}

test("computes transitive closure of deps missing from target but present in workspace", () => {
  const target = mkdtempSync(path.join(tmpdir(), "paseo-dep-closure-target-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "paseo-dep-closure-ws-"));
  try {
    const t = makeNodeModules(target);
    const w = makeNodeModules(workspace);

    // relay 已同步到 target，声明 @noble/*；target 缺失，workspace 齐备
    const relay = t.pkg("@getpaseo/relay", {
      "@noble/ciphers": "^2.4.0",
      "@noble/curves": "^2.4.0",
      "@noble/hashes": "^2.4.0",
    });
    w.pkg("@noble/ciphers");
    w.pkg("@noble/curves", { "@noble/hashes": "^2.1.0" });
    w.pkg("@noble/hashes");
    // target 与 workspace 均缺失的依赖进 unavailable
    const otherPkg = t.pkg("@getpaseo/other", { "ghost-pkg": "^1.0.0" });

    const { toCopy, unavailable } = computeMissingDependencies({
      roots: [relay, otherPkg],
      targetNodeModules: target,
      workspaceNodeModules: workspace,
    });

    assert.deepEqual([...toCopy].sort(), ["@noble/ciphers", "@noble/curves", "@noble/hashes"]);
    assert.deepEqual([...unavailable].sort(), ["ghost-pkg"]);
  } finally {
    rmSync(target, { force: true, recursive: true });
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("skips deps already satisfied by the target tree without recursing", () => {
  const target = mkdtempSync(path.join(tmpdir(), "paseo-dep-closure-target-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "paseo-dep-closure-ws-"));
  try {
    const t = makeNodeModules(target);
    const w = makeNodeModules(workspace);

    const server = t.pkg("@getpaseo/server", { react: "^19.0.0" });
    t.pkg("react");
    // target 已满足的依赖不递归 —— workspace 的 react 有无都无关紧要
    w.pkg("react");

    const { toCopy, unavailable } = computeMissingDependencies({
      roots: [server],
      targetNodeModules: target,
      workspaceNodeModules: workspace,
    });

    assert.deepEqual([...toCopy], []);
    assert.deepEqual([...unavailable], []);
  } finally {
    rmSync(target, { force: true, recursive: true });
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("ignores optionalDependencies (platform binaries resolved at npm install time)", () => {
  const target = mkdtempSync(path.join(tmpdir(), "paseo-dep-closure-target-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "paseo-dep-closure-ws-"));
  try {
    const t = makeNodeModules(target);

    t.pkg(
      "@getpaseo/server",
      {},
      {
        optionalDependencies: { "@esbuild/linux-x64": "0.25.0" },
      },
    );
    // 两侧都没有 @esbuild/linux-x64 —— optional 依赖不进闭包

    const { toCopy, unavailable } = computeMissingDependencies({
      roots: [target + "/@getpaseo/server"],
      targetNodeModules: target,
      workspaceNodeModules: workspace,
    });

    assert.deepEqual([...toCopy], []);
    assert.deepEqual([...unavailable], []);
  } finally {
    rmSync(target, { force: true, recursive: true });
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("dedupes shared transitive deps across roots", () => {
  const target = mkdtempSync(path.join(tmpdir(), "paseo-dep-closure-target-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "paseo-dep-closure-ws-"));
  try {
    const t = makeNodeModules(target);
    const w = makeNodeModules(workspace);

    const a = t.pkg("@getpaseo/a", { shared: "^1.0.0" });
    const b = t.pkg("@getpaseo/b", { shared: "^1.0.0" });
    w.pkg("shared", { leaf: "^1.0.0" });
    w.pkg("leaf");

    const { toCopy } = computeMissingDependencies({
      roots: [a, b],
      targetNodeModules: target,
      workspaceNodeModules: workspace,
    });

    assert.deepEqual([...toCopy], ["shared", "leaf"]);
  } finally {
    rmSync(target, { force: true, recursive: true });
    rmSync(workspace, { force: true, recursive: true });
  }
});
