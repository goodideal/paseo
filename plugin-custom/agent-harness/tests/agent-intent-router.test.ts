import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentIntentRouter,
  resolveRouterTarget,
  type CliRunner,
} from "../server/agent-intent-router.js";
import { clearRepoFingerprintCache, detectRepoFingerprint } from "../server/repo-fingerprint.js";
import { resolveEffectiveHarnessConfig } from "../shared/config-resolver.js";
import { DEFAULT_AGENT_HARNESS_SETTINGS } from "../shared/settings.js";
import type { HostProviderRuntimeInfo } from "../shared/types.js";

const tmpDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  clearRepoFingerprintCache();
  for (const dir of tmpDirs.splice(0, tmpDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("detectRepoFingerprint", () => {
  it("detects backend-only stacks (pom.xml, go.mod, Cargo.toml, pyproject.toml) without frontend markers", () => {
    const mavenDir = makeTempDir("fp-maven-");
    fs.writeFileSync(path.join(mavenDir, "pom.xml"), "<project/>", "utf8");
    const mavenFp = detectRepoFingerprint(mavenDir);
    expect(mavenFp.hasFrontend).toBe(false);
    expect(mavenFp.hasBackendOnlyStack).toBe(true);
    expect(mavenFp.tags).toContain("jvm");

    const goDir = makeTempDir("fp-go-");
    fs.writeFileSync(path.join(goDir, "go.mod"), "module example.com/app\n", "utf8");
    const goFp = detectRepoFingerprint(goDir);
    expect(goFp.hasFrontend).toBe(false);
    expect(goFp.hasBackendOnlyStack).toBe(true);
    expect(goFp.tags).toContain("go");

    const rustDir = makeTempDir("fp-rust-");
    fs.writeFileSync(path.join(rustDir, "Cargo.toml"), '[package]\nname = "svc"\n', "utf8");
    const rustFp = detectRepoFingerprint(rustDir);
    expect(rustFp.hasFrontend).toBe(false);
    expect(rustFp.hasBackendOnlyStack).toBe(true);
    expect(rustFp.tags).toContain("rust");

    const pyDir = makeTempDir("fp-py-");
    fs.writeFileSync(path.join(pyDir, "pyproject.toml"), '[project]\nname = "api"\n', "utf8");
    const pyFp = detectRepoFingerprint(pyDir);
    expect(pyFp.hasFrontend).toBe(false);
    expect(pyFp.hasBackendOnlyStack).toBe(true);
    expect(pyFp.tags).toContain("python");
  });

  it("detects frontend stacks via config files, packages/app, and package.json deps", () => {
    const reactDir = makeTempDir("fp-react-");
    fs.writeFileSync(
      path.join(reactDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^19.0.0", unistyles: "^3.0.0" } }),
      "utf8",
    );
    const reactFp = detectRepoFingerprint(reactDir);
    expect(reactFp.hasFrontend).toBe(true);
    expect(reactFp.hasBackendOnlyStack).toBe(false);
    expect(reactFp.tags).toContain("react");

    const monorepoDir = makeTempDir("fp-monorepo-");
    fs.mkdirSync(path.join(monorepoDir, "packages", "app"), { recursive: true });
    fs.writeFileSync(path.join(monorepoDir, "go.mod"), "module mixed\n", "utf8");
    const monoFp = detectRepoFingerprint(monorepoDir);
    expect(monoFp.hasFrontend).toBe(true);
    expect(monoFp.hasBackendOnlyStack).toBe(false);

    // JS/TS monorepo with root package.json + apps/web/package.json (React)
    const appsWebDir = makeTempDir("fp-apps-web-");
    fs.writeFileSync(
      path.join(appsWebDir, "package.json"),
      JSON.stringify({ name: "monorepo-root", private: true }),
      "utf8",
    );
    fs.mkdirSync(path.join(appsWebDir, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(appsWebDir, "apps", "web", "package.json"),
      JSON.stringify({ dependencies: { react: "^19.0.0" } }),
      "utf8",
    );
    const appsWebFp = detectRepoFingerprint(appsWebDir);
    expect(appsWebFp.hasFrontend).toBe(true);
    expect(appsWebFp.hasBackendOnlyStack).toBe(false);

    // Bare JS/TS package.json without JVM/Go/Rust/Python does not falsely block ui
    const bareNodeDir = makeTempDir("fp-bare-node-");
    fs.writeFileSync(
      path.join(bareNodeDir, "package.json"),
      JSON.stringify({ name: "workspace", private: true }),
      "utf8",
    );
    const bareNodeFp = detectRepoFingerprint(bareNodeDir);
    expect(bareNodeFp.hasBackendOnlyStack).toBe(false);
  });

  it("caches fingerprint for 5 minutes and clears cleanly on clearRepoFingerprintCache", () => {
    const dir = makeTempDir("fp-cache-");
    fs.writeFileSync(path.join(dir, "go.mod"), "module cached\n", "utf8");
    const first = detectRepoFingerprint(dir);
    expect(first.hasBackendOnlyStack).toBe(true);

    // Mutate directory on disk while cached -> cache returns previous result
    fs.writeFileSync(path.join(dir, "vite.config.ts"), "export default {};\n", "utf8");
    const second = detectRepoFingerprint(dir);
    expect(second.hasBackendOnlyStack).toBe(true);

    clearRepoFingerprintCache();
    const third = detectRepoFingerprint(dir);
    expect(third.hasFrontend).toBe(true);
    expect(third.hasBackendOnlyStack).toBe(false);
  });

  it("returns neutral fingerprint for missing or empty cwd", () => {
    expect(detectRepoFingerprint(null)).toEqual({
      cwd: "",
      hasFrontend: false,
      hasBackendOnlyStack: false,
      tags: [],
    });
    expect(detectRepoFingerprint("/non-existent-repo-path-99999")).toEqual({
      cwd: "/non-existent-repo-path-99999",
      hasFrontend: false,
      hasBackendOnlyStack: false,
      tags: [],
    });
  });
});

describe("resolveRouterTarget", () => {
  const hostProviders: HostProviderRuntimeInfo[] = [
    {
      provider: "antigravity",
      enabled: true,
      status: "ready",
      defaultModel: "gemini-4-neon",
      models: [{ id: "gemini-4-hydrogen" }, { id: "gemini-4-neon" }],
    },
    {
      provider: "claude",
      enabled: false,
      status: "disabled",
      models: [{ id: "lite" }, { id: "flash" }],
    },
    {
      provider: "codex",
      enabled: true,
      status: "ready",
      models: [{ id: "lite" }],
    },
  ];

  it("auto-selects active host provider fast model when routerProvider/routerModel are empty", () => {
    const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    expect(resolveRouterTarget(config, hostProviders, "antigravity")).toEqual({
      provider: "antigravity",
      model: "gemini-4-hydrogen",
    });

    expect(resolveRouterTarget(config, hostProviders, "codex")).toEqual({
      provider: "codex",
      model: "lite",
    });
  });

  it("falls back cleanly when configured routerProvider is disabled or routerModel is invalid", () => {
    const config = resolveEffectiveHarnessConfig({
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      routerProvider: "claude",
      routerModel: "gemini-3-flash",
    });
    const resolved = resolveRouterTarget(config, hostProviders, "antigravity");
    expect(resolved).toEqual({
      provider: "antigravity",
      model: "gemini-4-hydrogen",
    });
  });

  it("validates antigravity routerTarget via isModelCompatibleWithProvider (trusting hostEntry.models while rejecting gemini-3*)", () => {
    const customAgHosts: HostProviderRuntimeInfo[] = [
      {
        provider: "antigravity",
        enabled: true,
        status: "ready",
        defaultModel: "claude-sonnet-4-5-thinking",
        models: [{ id: "gemini-3-flash" }, { id: "claude-sonnet-4-5-thinking" }],
      },
    ];

    const rejectDeprecated = resolveEffectiveHarnessConfig({
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      routerProvider: "antigravity",
      routerModel: "gemini-3-flash",
    });
    expect(resolveRouterTarget(rejectDeprecated, customAgHosts, "antigravity")).toEqual({
      provider: "antigravity",
      model: "claude-sonnet-4-5-thinking",
    });

    const acceptHostListed = resolveEffectiveHarnessConfig({
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      routerProvider: "antigravity",
      routerModel: "claude-sonnet-4-5-thinking",
    });
    expect(resolveRouterTarget(acceptHostListed, customAgHosts, "antigravity")).toEqual({
      provider: "antigravity",
      model: "claude-sonnet-4-5-thinking",
    });
  });
});

describe("AgentIntentRouter", () => {
  const agHostProviders: HostProviderRuntimeInfo[] = [
    {
      provider: "antigravity",
      enabled: true,
      defaultModel: "gemini-4-neon",
      models: [{ id: "gemini-4-hydrogen" }, { id: "gemini-4-neon" }],
    },
  ];

  it("invokes agy -p headless CLI with verified flags, empty temp cwd, and sanitized env", async () => {
    const origLazy = process.env.LAZY_TOOL_CONFIG;
    process.env.LAZY_TOOL_CONFIG = "/Users/test/.config/lazy-tool/profiles/backend.yaml";
    try {
      const cliRunner = vi.fn<CliRunner>().mockResolvedValue({
        stdout: JSON.stringify({
          structured_output: {
            role: "architect",
            tier: "plan",
            phase: "design",
            confidence: 0.94,
            reason: "Architecture proposal request",
          },
        }),
        stderr: "",
      });

      const router = new AgentIntentRouter({ cliRunner });
      const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
      const repoDir = makeTempDir("router-fe-");
      fs.writeFileSync(path.join(repoDir, "vite.config.ts"), "export default {};\n");

      const result = await router.route({
        prompt: "<system-reminder>noise</system-reminder>你作为CTO，设计多租户网关架构方案",
        cwd: repoDir,
        config,
        hostProviders: agHostProviders,
        activeSessionProvider: "antigravity",
      });

      expect(result).toEqual({
        role: "architect",
        tier: "plan",
        phase: "design",
        confidence: 0.94,
        reason: "Architecture proposal request",
        matchedRule: "semantic_router:architect",
      });

      expect(cliRunner).toHaveBeenCalledTimes(1);
      const [bin, args, opts] = cliRunner.mock.calls[0]!;
      expect(bin).toBe("agy");
      // Critical flag ordering: promptText MUST follow -p immediately; NO --settings
      expect(args[0]).toBe("-p");
      expect(args[1]).toContain("你作为CTO，设计多租户网关架构方案");
      expect(args[1]).not.toContain("system-reminder");
      expect(args).toContain("--output-format");
      expect(args).toContain("json");
      expect(args).toContain("--json-schema");
      expect(args).toContain("--disable-slash-commands");
      expect(args).toContain("--model");
      expect(args).toContain("gemini-4-hydrogen");
      expect(args).toContain("--effort");
      expect(args).toContain("low");
      expect(args).toContain("--mode");
      expect(args).toContain("plan");
      expect(args).toContain("--print-timeout");
      expect(args.join(" ")).not.toContain("--settings");

      expect(opts?.cwd).not.toBe(path.join(os.tmpdir(), "paseo-harness-router"));
      expect(opts?.cwd?.startsWith(path.join(os.tmpdir(), "paseo-harness-router-"))).toBe(true);
      expect(opts?.env?.PASEO_HARNESS_INTERNAL_ROUTER).toBe("1");
      expect(opts?.env?.LAZY_TOOL_CONFIG).toBeUndefined();
    } finally {
      if (origLazy === undefined) delete process.env.LAZY_TOOL_CONFIG;
      else process.env.LAZY_TOOL_CONFIG = origLazy;
    }
  });

  it("supports claude CLI adapter and stdout JSON fallback parsing", async () => {
    const cliRunner = vi.fn<CliRunner>().mockResolvedValue({
      stdout: JSON.stringify({
        response: '{"role":"review","tier":"review","phase":"review","confidence":0.91}',
      }),
      stderr: "",
    });
    const router = new AgentIntentRouter({ cliRunner });
    const config = resolveEffectiveHarnessConfig({
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      routerProvider: "claude",
    });

    const result = await router.route({
      prompt: "审查最近三个提交的安全漏洞",
      config,
      hostProviders: [
        {
          provider: "claude",
          enabled: true,
          models: [{ id: "lite" }, { id: "flash" }],
        },
      ],
      activeSessionProvider: "claude",
    });

    expect(result).toMatchObject({
      role: "review",
      tier: "review",
      phase: "review",
      confidence: 0.91,
      matchedRule: "semantic_router:review",
    });
    const [bin, args] = cliRunner.mock.calls[0]!;
    expect(bin).toBe("claude");
    expect(args[0]).toBe("-p");
    expect(args).toContain("--tools");
    expect(args).toContain("--no-session-persistence");
  });

  it("applies confidence gating (<0.85 downgrades role to fallback; <0.6 returns null) and blocks orchestrator", async () => {
    const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);

    const midConfRunner = vi.fn<CliRunner>().mockResolvedValue({
      stdout: JSON.stringify({
        structured_output: {
          role: "ui",
          tier: "plan",
          phase: "design",
          confidence: 0.72,
        },
      }),
      stderr: "",
    });
    const midRouter = new AgentIntentRouter({ cliRunner: midConfRunner });
    const midResult = await midRouter.route({
      prompt: "检查整体优化方向",
      config,
      hostProviders: agHostProviders,
    });
    expect(midResult).toMatchObject({
      role: "general",
      tier: "plan",
      phase: "design",
      matchedRule: "semantic_router:tier_only",
    });

    const lowConfRunner = vi.fn<CliRunner>().mockResolvedValue({
      stdout: JSON.stringify({
        structured_output: {
          role: "ui",
          tier: "plan",
          phase: "design",
          confidence: 0.45,
        },
      }),
      stderr: "",
    });
    const lowRouter = new AgentIntentRouter({ cliRunner: lowConfRunner });
    expect(
      await lowRouter.route({
        prompt: "模糊需求",
        config,
        hostProviders: agHostProviders,
      }),
    ).toBeNull();

    const orchRunner = vi.fn<CliRunner>().mockResolvedValue({
      stdout: JSON.stringify({
        structured_output: {
          role: "orchestrator",
          tier: "fast",
          phase: "exec",
          confidence: 0.95,
        },
      }),
      stderr: "",
    });
    const orchRouter = new AgentIntentRouter({ cliRunner: orchRunner });
    const orchResult = await orchRouter.route({
      prompt: "开发前后端新功能",
      config,
      hostProviders: agHostProviders,
    });
    expect(orchResult?.role).toBe("general");
    expect(orchResult?.role).not.toBe("orchestrator");
  });

  it("excludes ui / fe-* roles from schema & prompt and blocks them via repo fingerprint on backend-only repositories", async () => {
    const goDir = makeTempDir("router-go-");
    fs.writeFileSync(path.join(goDir, "go.mod"), "module example.com/gateway\n", "utf8");

    const cliRunner = vi.fn<CliRunner>().mockResolvedValue({
      stdout: JSON.stringify({
        structured_output: {
          role: "ui",
          tier: "standard",
          phase: "exec",
          confidence: 0.92,
        },
      }),
      stderr: "",
    });
    const router = new AgentIntentRouter({ cliRunner });
    const baseConfig = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    const config = {
      ...baseConfig,
      specialists: [
        ...baseConfig.specialists,
        {
          ...baseConfig.specialists.find((s) => s.id === "ui")!,
          id: "fe-widget",
          shortLabel: "FE Widget",
          description: "Frontend widget builder",
          enabled: true,
        },
      ],
    };

    const res = await router.route({
      prompt: "优化表单验证和响应结构体设计",
      cwd: goDir,
      config,
      hostProviders: agHostProviders,
    });
    // Defense-in-depth post-validation still rejects unexpected frontend role
    expect(res?.role).toBe("general");
    expect(res?.role).not.toBe("ui");

    // Pre-CLI exclusion: --json-schema enum and Candidate roles prompt must exclude ui & fe-*
    const [, args] = cliRunner.mock.calls[0]!;
    const promptArg = args[args.indexOf("-p") + 1]!;
    const schemaArg = JSON.parse(args[args.indexOf("--json-schema") + 1]!);
    expect(schemaArg.properties.role.enum).not.toContain("ui");
    expect(schemaArg.properties.role.enum).not.toContain("fe-widget");
    expect(schemaArg.properties.role.enum).toContain("backend");

    const candidateSection =
      promptArg.split("Candidate roles:\n")[1]?.split("\n\nUser request:")[0] ?? "";
    expect(candidateSection).not.toContain("- ui ");
    expect(candidateSection).not.toContain("- fe-widget ");
    expect(candidateSection).toContain("- backend ");
  });

  it("evicts expired LRU cache entries after 15-minute TTL", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const cliRunner = vi.fn<CliRunner>().mockResolvedValue({
        stdout: JSON.stringify({
          structured_output: {
            role: "backend",
            tier: "standard",
            phase: "exec",
            confidence: 0.92,
          },
        }),
        stderr: "",
      });
      const router = new AgentIntentRouter({ cliRunner });
      const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);

      const first = await router.route({
        prompt: "重构后端队列重试机制",
        config,
        hostProviders: agHostProviders,
      });
      expect(first?.role).toBe("backend");
      expect(cliRunner).toHaveBeenCalledTimes(1);

      // Within TTL: served from cache
      vi.advanceTimersByTime(14 * 60_000);
      await router.route({
        prompt: "重构后端队列重试机制",
        config,
        hostProviders: agHostProviders,
      });
      expect(cliRunner).toHaveBeenCalledTimes(1);

      // Past 15-minute TTL: cache entry evicted, CLI invoked again
      vi.advanceTimersByTime(2 * 60_000);
      await router.route({
        prompt: "重构后端队列重试机制",
        config,
        hostProviders: agHostProviders,
      });
      expect(cliRunner).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deduplicates concurrent in-flight requests and hits SHA-256 LRU cache", async () => {
    let resolveCli!: (value: { stdout: string; stderr: string }) => void;
    const cliRunner = vi.fn<CliRunner>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCli = resolve;
        }),
    );

    const router = new AgentIntentRouter({ cliRunner });
    const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);

    const p1 = router.route({
      prompt: "分析数据库死锁问题",
      config,
      hostProviders: agHostProviders,
    });
    const p2 = router.route({
      prompt: "分析数据库死锁问题",
      config,
      hostProviders: agHostProviders,
    });

    // Wait a tick for runner invocation
    await Promise.resolve();
    expect(cliRunner).toHaveBeenCalledTimes(1);

    resolveCli({
      stdout: JSON.stringify({
        structured_output: {
          role: "backend",
          tier: "plan",
          phase: "design",
          confidence: 0.93,
        },
      }),
      stderr: "",
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1?.role).toBe("backend");
    expect(r2?.role).toBe("backend");

    // Subsequent call hits LRU cache without spawning CLI again
    const r3 = await router.route({
      prompt: "分析数据库死锁问题",
      config,
      hostProviders: agHostProviders,
    });
    expect(r3?.role).toBe("backend");
    expect(cliRunner).toHaveBeenCalledTimes(1);
  });

  it("returns null gracefully on CLI error, timeout, invalid JSON, or internal router recursion guard", async () => {
    const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);

    const failRunner = vi.fn<CliRunner>().mockRejectedValue(new Error("Command timed out"));
    const failRouter = new AgentIntentRouter({ cliRunner: failRunner });
    expect(
      await failRouter.route({
        prompt: "排查崩溃问题",
        config,
        hostProviders: agHostProviders,
      }),
    ).toBeNull();

    const garbageRunner = vi.fn<CliRunner>().mockResolvedValue({
      stdout: "not valid json output",
      stderr: "",
    });
    const garbageRouter = new AgentIntentRouter({ cliRunner: garbageRunner });
    expect(
      await garbageRouter.route({
        prompt: "排查崩溃问题",
        config,
        hostProviders: agHostProviders,
      }),
    ).toBeNull();

    // Missing or non-numeric confidence must return null instead of defaulting to 0.7
    for (const badPayload of [
      { role: "backend", tier: "standard", phase: "exec" },
      { role: "backend", tier: "standard", phase: "exec", confidence: "0.95" },
    ]) {
      const badConfRunner = vi.fn<CliRunner>().mockResolvedValue({
        stdout: JSON.stringify({ structured_output: badPayload }),
        stderr: "",
      });
      const badConfRouter = new AgentIntentRouter({ cliRunner: badConfRunner });
      expect(
        await badConfRouter.route({
          prompt: "排查截断输出问题",
          config,
          hostProviders: agHostProviders,
        }),
      ).toBeNull();
    }

    const origGuard = process.env.PASEO_HARNESS_INTERNAL_ROUTER;
    process.env.PASEO_HARNESS_INTERNAL_ROUTER = "1";
    try {
      const guardRunner = vi.fn<CliRunner>();
      const guardRouter = new AgentIntentRouter({ cliRunner: guardRunner });
      expect(
        await guardRouter.route({
          prompt: "任意意图",
          config,
          hostProviders: agHostProviders,
        }),
      ).toBeNull();
      expect(guardRunner).not.toHaveBeenCalled();
    } finally {
      if (origGuard === undefined) delete process.env.PASEO_HARNESS_INTERNAL_ROUTER;
      else process.env.PASEO_HARNESS_INTERNAL_ROUTER = origGuard;
    }
  });

  it("embeds JSON field/enum contract in prompt, passes codex --output-schema file, and parses item.text / part.text / message.content JSONL", async () => {
    const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    const customWorkDir = makeTempDir("paseo-codex-router-");
    const codexHostProviders: HostProviderRuntimeInfo[] = [
      {
        provider: "codex",
        enabled: true,
        models: [{ id: "lite" }, { id: "flash" }, { id: "pro" }],
      },
      {
        provider: "opencode",
        enabled: true,
        models: [{ id: "custom/lite" }, { id: "custom/flash" }],
      },
    ];

    let capturedSchemaContent = "";
    const codexRunner = vi.fn<CliRunner>(async (_bin, args) => {
      const schemaIdx = args.indexOf("--output-schema");
      if (schemaIdx >= 0 && args[schemaIdx + 1]) {
        capturedSchemaContent = fs.readFileSync(args[schemaIdx + 1]!, "utf8");
      }
      return {
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "t1" }),
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "agent_message",
              text: JSON.stringify({
                role: "backend",
                tier: "plan",
                phase: "design",
                confidence: 0.92,
                reason: "architecture design",
              }),
            },
          }),
        ].join("\n"),
        stderr: "",
      };
    });

    const codexRouter = new AgentIntentRouter({
      cliRunner: codexRunner,
      routerWorkDir: customWorkDir,
    });
    const codexRes = await codexRouter.route({
      prompt: "设计分布式锁与事务隔离架构",
      config,
      hostProviders: codexHostProviders,
      activeSessionProvider: "codex",
    });

    expect(codexRes?.role).toBe("backend");
    expect(codexRes?.tier).toBe("plan");
    expect(codexRes?.phase).toBe("design");
    const [, codexArgs] = codexRunner.mock.calls[0]!;
    expect(codexArgs).toContain("--output-schema");
    const firstSchemaPath = codexArgs[codexArgs.indexOf("--output-schema") + 1]!;
    expect(firstSchemaPath.startsWith(`${customWorkDir}${path.sep}`)).toBe(true);
    expect(path.basename(firstSchemaPath)).toMatch(/^router-schema-[0-9a-f]{12}\.json$/);
    expect(JSON.parse(capturedSchemaContent).properties.tier.enum).toEqual([
      "fast",
      "standard",
      "plan",
      "review",
    ]);
    const codexPrompt = codexArgs[codexArgs.length - 1]!;
    expect(codexPrompt).toContain('"role"');
    expect(codexPrompt).toContain('"tier"');
    expect(codexPrompt).toContain('"phase"');
    expect(codexPrompt).toContain('"confidence"');

    // Distinct candidate role sets write distinct content-hashed schema filenames
    const customRoleConfig = resolveEffectiveHarnessConfig({
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      specialists: [
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists,
        {
          ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[0]!,
          id: "docs-specialist",
          name: "Docs Specialist",
          shortLabel: "Docs",
          description: "Technical documentation author",
          enabled: true,
        },
      ],
    });
    await codexRouter.route({
      prompt: "整理系统架构设计文档并补充 API 契约",
      config: customRoleConfig,
      hostProviders: codexHostProviders,
      activeSessionProvider: "codex",
    });
    const [, secondCodexArgs] = codexRunner.mock.calls[1]!;
    const secondSchemaPath = secondCodexArgs[secondCodexArgs.indexOf("--output-schema") + 1]!;
    expect(path.basename(secondSchemaPath)).toMatch(/^router-schema-[0-9a-f]{12}\.json$/);
    expect(secondSchemaPath).not.toBe(firstSchemaPath);

    // OpenCode part.text + message.content string and block array extraction
    const partTextRunner = vi.fn<CliRunner>().mockResolvedValue({
      stdout: JSON.stringify({
        type: "text",
        part: {
          text: JSON.stringify({
            role: "review",
            tier: "review",
            phase: "review",
            confidence: 0.91,
          }),
        },
      }),
      stderr: "",
    });
    const partRouter = new AgentIntentRouter({
      cliRunner: partTextRunner,
      routerWorkDir: customWorkDir,
    });
    const partRes = await partRouter.route({
      prompt: "审查 PR 安全风险",
      config,
      hostProviders: codexHostProviders,
      activeSessionProvider: "opencode",
    });
    expect(partRes?.role).toBe("review");

    const msgBlockRunner = vi.fn<CliRunner>().mockResolvedValue({
      stdout: JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                role: "architect",
                tier: "plan",
                phase: "design",
                confidence: 0.94,
              }),
            },
          ],
        },
      }),
      stderr: "",
    });
    const msgRouter = new AgentIntentRouter({
      cliRunner: msgBlockRunner,
      routerWorkDir: customWorkDir,
    });
    const msgRes = await msgRouter.route({
      prompt: "制定微服务拆分方案",
      config,
      hostProviders: codexHostProviders,
      activeSessionProvider: "opencode",
    });
    expect(msgRes?.role).toBe("architect");
  });

  it("invalidates LRU cache when routerEffort or specialist descriptions change, and removes auto temp workdir on dispose()", async () => {
    const baseConfig = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
    const cliRunner = vi.fn<CliRunner>().mockResolvedValue({
      stdout: JSON.stringify({
        structured_output: {
          role: "backend",
          tier: "standard",
          phase: "exec",
          confidence: 0.9,
        },
      }),
      stderr: "",
    });
    const router = new AgentIntentRouter({ cliRunner });

    await router.route({
      prompt: "修复缓存击穿问题",
      config: baseConfig,
      hostProviders: agHostProviders,
    });
    expect(cliRunner).toHaveBeenCalledTimes(1);

    // Same effort & descriptions hits cache
    await router.route({
      prompt: "修复缓存击穿问题",
      config: baseConfig,
      hostProviders: agHostProviders,
    });
    expect(cliRunner).toHaveBeenCalledTimes(1);

    // Changing routerEffort must miss cache
    await router.route({
      prompt: "修复缓存击穿问题",
      config: { ...baseConfig, routerEffort: "high" },
      hostProviders: agHostProviders,
    });
    expect(cliRunner).toHaveBeenCalledTimes(2);

    // Changing a candidate specialist description must miss cache
    const updatedSpecs = baseConfig.specialists.map((s) =>
      s.id === "backend"
        ? { ...s, description: `${s.description} + custom distributed lock focus` }
        : s,
    );
    await router.route({
      prompt: "修复缓存击穿问题",
      config: { ...baseConfig, routerEffort: "high", specialists: updatedSpecs },
      hostProviders: agHostProviders,
    });
    expect(cliRunner).toHaveBeenCalledTimes(3);

    const spawnCwd = cliRunner.mock.calls[0]![2]?.cwd;
    expect(spawnCwd).toBeTruthy();
    expect(fs.existsSync(spawnCwd!)).toBe(true);

    // dispose() clears auto-created temp workdir
    router.dispose();
    expect(fs.existsSync(spawnCwd!)).toBe(false);

    // Explicit routerWorkDir must NOT be deleted on dispose()
    const explicitDir = makeTempDir("paseo-explicit-router-");
    const explicitRouter = new AgentIntentRouter({ cliRunner, routerWorkDir: explicitDir });
    await explicitRouter.route({
      prompt: "修复连接池泄漏",
      config: baseConfig,
      hostProviders: agHostProviders,
    });
    explicitRouter.dispose();
    expect(fs.existsSync(explicitDir)).toBe(true);
  });
});
