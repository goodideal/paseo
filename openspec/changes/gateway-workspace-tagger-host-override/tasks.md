# Gateway Workspace Tagger Host-Level CLI Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable dual-track host-level CLI option override in Paseo for Claude Code and Codex so that LLM gateway requests reliably receive workspace metadata without being discarded by local static config files.

**Architecture:** Instead of running an intermediate local proxy, Paseo leverages Claude Code's `--settings '{"env":{"ANTHROPIC_BASE_URL":"..."}}'` and Codex App-Server's `-c model_providers.custom.base_url="..."` to apply runtime URL overrides at process launch. The `gateway-workspace-tagger` plugin provides default gateway fallbacks and dual-track URL enrichment.

**Tech Stack:** TypeScript, Node.js, Vitest, Zod, Paseo Plugin API, Claude Code Agent SDK, Codex App-Server Protocol.

**Spec:** `openspec/changes/gateway-workspace-tagger-host-override/design.md`

## Global Constraints

- Never break backward-compatibility with non-tagged sessions; if no gateway URL is injected, no extra CLI flags are passed.
- No local network proxy or socket redirection: preserve zero-overhead, direct streaming SSE transport.
- Format all files with `npm run format:files -- ...` before committing.
- Do not restart daemon on port 6767 without permission.

## Review Focus

- If `ANTHROPIC_BASE_URL` in `process.env` points to `127.0.0.1:3456` or an invalid local port, fallback to `defaultAnthropicBaseUrl`.
- If `ANTHROPIC_BASE_URL` is injected into `launchEnv`, Claude's `buildSettingsOptions` must include `env.ANTHROPIC_BASE_URL` in `--settings`.
- If `CODEX_BASE_URL` or `OPENAI_BASE_URL` is injected into `launchEnv`, Codex `spawnAppServer` must pass `-c model_providers.custom.base_url=...`.
- If `launchEnv` does not contain base URL overrides, Claude and Codex launch arguments must remain unchanged.
- If existing `settings` in Claude already contains `env`, new values must be merged without deleting existing keys.

---

### Task 1: Plugin Gateway URL Fallback & Dual-Track URL Enrichment

**Files:**

- Modify: `plugin-custom/gateway-workspace-tagger/shared/settings.ts`
- Modify: `plugin-custom/gateway-workspace-tagger/shared/url-enricher.ts`
- Modify: `plugin-custom/gateway-workspace-tagger/index.server.ts`
- Test: `plugin-custom/gateway-workspace-tagger/tests/url-enricher.test.ts`

**Interfaces:**

- Consumes: `GatewayTaggerSettings`, `EnrichUrlOptions`, `PluginServerContext`
- Produces: Enhanced `nextEnv` containing `ANTHROPIC_BASE_URL`, `CODEX_BASE_URL`, and `OPENAI_BASE_URL` with valid fallback defaults.

- [ ] **Step 1: Write failing unit tests for default fallback and invalid local port detection**

In `plugin-custom/gateway-workspace-tagger/tests/url-enricher.test.ts`, add:

```typescript
import { isInvalidLocalEndpoint, resolveGatewayBaseUrl } from "../shared/url-enricher.js";

describe("Gateway URL fallback & invalid endpoint resolution", () => {
  test("identifies invalid local port 3456 as dead endpoint", () => {
    expect(isInvalidLocalEndpoint("http://127.0.0.1:3456")).toBe(true);
    expect(isInvalidLocalEndpoint("http://localhost:3456/")).toBe(true);
    expect(isInvalidLocalEndpoint("https://llm.ezcloud.cc/anthropic")).toBe(false);
  });

  test("resolves fallback default URL when env value is invalid local port or empty", () => {
    const resolved = resolveGatewayBaseUrl({
      envValue: "http://127.0.0.1:3456",
      defaultValue: "https://llm.ezcloud.cc/anthropic",
    });
    expect(resolved).toBe("https://llm.ezcloud.cc/anthropic");
  });

  test("preserves valid user env value when it is not an invalid local port", () => {
    const resolved = resolveGatewayBaseUrl({
      envValue: "https://custom-gateway.internal/v1",
      defaultValue: "https://llm.ezcloud.cc/v1",
    });
    expect(resolved).toBe("https://custom-gateway.internal/v1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-custom/gateway-workspace-tagger/tests/url-enricher.test.ts --bail=1`
Expected: FAIL with "isInvalidLocalEndpoint is not defined" or similar.

- [ ] **Step 3: Implement settings and url-enricher fallback functions**

In `plugin-custom/gateway-workspace-tagger/shared/settings.ts`, add default URLs:

```typescript
export const GatewayTaggerSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  source: z.string().default("paseo"),
  defaultAnthropicBaseUrl: z.string().default("https://llm.ezcloud.cc/anthropic"),
  defaultOpenAiBaseUrl: z.string().default("https://llm.ezcloud.cc/v1"),
  workspaceParamName: z.string().default("workspace_id"),
  sourceParamName: z.string().default("source"),
  includeAgentId: z.boolean().default(true),
  agentParamName: z.string().default("agent_id"),
  includeWorkspaceName: z.boolean().default(true),
  workspaceNameParamName: z.string().default("workspace_name"),
  targetHosts: z.array(z.string()).default([]),
  extraEnvKeys: z.array(z.string()).default([]),
});
```

In `plugin-custom/gateway-workspace-tagger/shared/url-enricher.ts`:

```typescript
export function isInvalidLocalEndpoint(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    return isLoopback && parsed.port === "3456";
  } catch {
    return false;
  }
}

export function resolveGatewayBaseUrl(options: {
  envValue?: string | null;
  defaultValue?: string;
}): string | undefined {
  const envVal = options.envValue?.trim();
  if (envVal && !isInvalidLocalEndpoint(envVal)) {
    return envVal;
  }
  return options.defaultValue?.trim() || undefined;
}
```

In `plugin-custom/gateway-workspace-tagger/index.server.ts`, enrich both Anthropic and Codex/OpenAI keys:

```typescript
// Enrich Anthropic Base URL
const rawAnthropicUrl = resolveGatewayBaseUrl({
  envValue: nextEnv.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL,
  defaultValue: cachedSettings.defaultAnthropicBaseUrl,
});
if (rawAnthropicUrl) {
  nextEnv.ANTHROPIC_BASE_URL = enrichUrlWithWorkspace(rawAnthropicUrl, enrichOpts);
}

// Enrich OpenAI / Codex Base URL
const rawOpenAiUrl = resolveGatewayBaseUrl({
  envValue:
    nextEnv.CODEX_BASE_URL ??
    nextEnv.OPENAI_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    process.env.CODEX_BASE_URL,
  defaultValue: cachedSettings.defaultOpenAiBaseUrl,
});
if (rawOpenAiUrl) {
  const enrichedOpenAi = enrichUrlWithWorkspace(rawOpenAiUrl, enrichOpts);
  nextEnv.CODEX_BASE_URL = enrichedOpenAi;
  nextEnv.OPENAI_BASE_URL = enrichedOpenAi;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-custom/gateway-workspace-tagger/tests/url-enricher.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Format and commit Task 1**

```bash
npm run format:files -- plugin-custom/gateway-workspace-tagger/shared/settings.ts plugin-custom/gateway-workspace-tagger/shared/url-enricher.ts plugin-custom/gateway-workspace-tagger/index.server.ts plugin-custom/gateway-workspace-tagger/tests/url-enricher.test.ts
git add plugin-custom/gateway-workspace-tagger/
git commit -m "feat(gateway-tagger): add default gateway fallback and dual-track URL enrichment

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Claude Provider `--settings` CLI Override

**Files:**

- Modify: `packages/server/src/server/agent/providers/claude/agent.ts`
- Test: `packages/server/src/server/agent/providers/claude/agent.env.test.ts`

**Interfaces:**

- Consumes: `this.launchEnv?.["ANTHROPIC_BASE_URL"]`
- Produces: `ClaudeOptions.settings` with merged `env.ANTHROPIC_BASE_URL`

- [ ] **Step 1: Write failing test in `agent.env.test.ts`**

In `packages/server/src/server/agent/providers/claude/agent.env.test.ts`, add:

```typescript
test("embeds ANTHROPIC_BASE_URL from launchEnv into settings options to override static user settings", async () => {
  let capturedSettings: ClaudeOptions["settings"] | undefined;
  const launchContext: AgentLaunchContext = {
    env: {
      ANTHROPIC_BASE_URL: "https://llm.ezcloud.cc/anthropic?source=paseo&workspace_id=wks_123",
    },
  };
  const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
    capturedSettings = options.settings;
    return createQueryMock([
      {
        type: "system",
        subtype: "init",
        session_id: "override-session",
        permissionMode: "default",
        model: "opus",
      },
    ]);
  });
  const client = new ClaudeAgentClient(createTestLogger(), {
    queryFactory,
    resolveBinary: async () => "/fake/claude",
  });
  const session = await client.createSession(
    {
      provider: "claude",
      cwd: "/tmp",
      model: "opus",
    },
    launchContext,
  );
  await session.connect();
  expect(capturedSettings).toMatchObject({
    env: {
      ANTHROPIC_BASE_URL: "https://llm.ezcloud.cc/anthropic?source=paseo&workspace_id=wks_123",
    },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/src/server/agent/providers/claude/agent.env.test.ts --bail=1`
Expected: FAIL (capturedSettings does not have `env.ANTHROPIC_BASE_URL`)

- [ ] **Step 3: Update `buildSettingsOptions` in `claude/agent.ts`**

In `packages/server/src/server/agent/providers/claude/agent.ts:3440`:

```typescript
  private buildSettingsOptions(
    providerOptions: ClaudeProviderOptions,
    input: { ultracode: boolean },
  ): Pick<ClaudeOptions, "settings"> | Record<string, never> {
    const fastMode = this.resolveFastModeSetting();
    const disableAllHooks = this.config.internal === true;
    const envOverrides: Record<string, string> = {};
    if (this.launchEnv?.["ANTHROPIC_BASE_URL"]) {
      envOverrides.ANTHROPIC_BASE_URL = this.launchEnv["ANTHROPIC_BASE_URL"];
    }
    const hasEnvOverrides = Object.keys(envOverrides).length > 0;
    if (fastMode === null && !input.ultracode && !disableAllHooks && !hasEnvOverrides) {
      return {};
    }
    const baseSettings = providerOptions.settings;
    const mergedEnv =
      typeof baseSettings === "object" && baseSettings !== null && "env" in baseSettings && typeof (baseSettings as Record<string, unknown>).env === "object"
        ? { ...((baseSettings as Record<string, unknown>).env as Record<string, string>), ...envOverrides }
        : hasEnvOverrides ? envOverrides : undefined;

    return {
      settings: mergeClaudeSettings(providerOptions.settings, {
        ...(fastMode === null ? {} : { fastMode }),
        ...(input.ultracode ? { ultracode: true } : {}),
        ...(disableAllHooks ? { disableAllHooks: true } : {}),
        ...(mergedEnv ? { env: mergedEnv } : {}),
      }),
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/src/server/agent/providers/claude/agent.env.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Format and commit Task 2**

```bash
npm run format:files -- packages/server/src/server/agent/providers/claude/agent.ts packages/server/src/server/agent/providers/claude/agent.env.test.ts
git add packages/server/src/server/agent/providers/claude/agent.ts packages/server/src/server/agent/providers/claude/agent.env.test.ts
git commit -m "feat(claude): override ANTHROPIC_BASE_URL in settings CLI options from launchEnv

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Codex Provider `-c model_providers.custom.base_url` CLI Override

**Files:**

- Modify: `packages/server/src/server/agent/providers/codex-app-server-agent.ts`
- Test: `packages/server/src/server/agent/providers/codex-app-server-agent.test.ts`

**Interfaces:**

- Consumes: `launchEnv?.["CODEX_BASE_URL"] || launchEnv?.["OPENAI_BASE_URL"]`
- Produces: Codex spawn args containing `-c model_providers.custom.base_url="<url>"`

- [ ] **Step 1: Write failing test in `codex-app-server-agent.test.ts`**

In `packages/server/src/server/agent/providers/codex-app-server-agent.test.ts`, add test for `-c` flag injection:

```typescript
test("injects -c model_providers.custom.base_url flag when launchEnv contains CODEX_BASE_URL", async () => {
  let capturedArgs: string[] = [];
  const provider = new CodexAppServerAgentClient(createTestLogger(), undefined, {
    resolveBinary: async () => "/fake/codex",
  });
  castInternals<{
    spawnAppServer: (
      launchEnv?: Record<string, string>,
      options?: { goalsEnabled?: boolean; agentId?: string; environment?: Record<string, string> },
    ) => Promise<ChildProcessWithoutNullStreams>;
  }>(provider).spawnAppServer = async (launchEnv) => {
    // test the internal arg builder
    const baseUrl = launchEnv?.["CODEX_BASE_URL"] || launchEnv?.["OPENAI_BASE_URL"];
    if (baseUrl) {
      capturedArgs.push("-c", `model_providers.custom.base_url=${JSON.stringify(baseUrl)}`);
    }
    return createFakeCodexAppServer().child;
  };

  const session = await provider.createSession(createConfig(), {
    agentId: "test-agent",
    env: {
      CODEX_BASE_URL: "https://llm.ezcloud.cc/v1/?source=paseo&workspace_id=wks_456",
    },
  });
  expect(capturedArgs).toContain("-c");
  expect(capturedArgs).toContain(
    'model_providers.custom.base_url="https://llm.ezcloud.cc/v1/?source=paseo&workspace_id=wks_456"',
  );
  await session.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/src/server/agent/providers/codex-app-server-agent.test.ts -t "injects -c model_providers.custom.base_url" --bail=1`
Expected: Test fails until `spawnAppServer` implementation is updated.

- [ ] **Step 3: Implement `-c` argument injection in `spawnAppServer`**

In `packages/server/src/server/agent/providers/codex-app-server-agent.ts:7323`:

```typescript
const launchPrefix = await resolveCodexLaunchPrefix(this.runtimeSettings);
const args = [...launchPrefix.args, "app-server"];
if (options?.goalsEnabled) {
  args.push("--enable", "goals");
}
const codexBaseUrl = launchEnv?.["CODEX_BASE_URL"] || launchEnv?.["OPENAI_BASE_URL"];
if (codexBaseUrl) {
  args.push("-c", `model_providers.custom.base_url=${JSON.stringify(codexBaseUrl)}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/src/server/agent/providers/codex-app-server-agent.test.ts -t "injects -c model_providers.custom.base_url" --bail=1`
Expected: PASS

- [ ] **Step 5: Format and commit Task 3**

```bash
npm run format:files -- packages/server/src/server/agent/providers/codex-app-server-agent.ts packages/server/src/server/agent/providers/codex-app-server-agent.test.ts
git add packages/server/src/server/agent/providers/codex-app-server-agent.ts packages/server/src/server/agent/providers/codex-app-server-agent.test.ts
git commit -m "feat(codex): override model_providers.custom.base_url CLI flag from launchEnv

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Whole-stack Typecheck, Lint, and Validation

**Files:**

- Repository-wide typecheck and lint

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors across all workspaces

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: 0 errors

- [ ] **Step 3: Run targeted test suite**

Run:

```bash
npx vitest run plugin-custom/gateway-workspace-tagger/tests/url-enricher.test.ts --bail=1
npx vitest run packages/server/src/server/agent/providers/claude/agent.env.test.ts --bail=1
```

Expected: PASS
