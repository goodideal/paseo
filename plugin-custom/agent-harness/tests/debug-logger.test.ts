import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEBUG_LOG_MAX_BYTES,
  HarnessDebugLogger,
  isSensitiveKey,
  resolveAgentHarnessDataDir,
} from "../server/debug-logger.js";
import {
  HarnessDebugLogEntrySchema,
  harnessDebugClearRpc,
  harnessDebugStatusRpc,
  harnessDebugToggleRpc,
} from "../shared/contracts.js";

const createdDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-debug-logger-test-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("HarnessDebugLogger & Debug RPC contracts", () => {
  it("declares pure Zod contracts for debug RPCs and 5 MiB default max size", () => {
    expect(DEBUG_LOG_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(harnessDebugStatusRpc.name).toBe("agent_harness.debug.status.request");
    expect(harnessDebugToggleRpc.name).toBe("agent_harness.debug.toggle.request");
    expect(harnessDebugClearRpc.name).toBe("agent_harness.debug.clear.request");

    const parsedEntry = HarnessDebugLogEntrySchema.parse({
      ts: new Date().toISOString(),
      event: "harness.route",
      level: "info",
      agentId: "agt_1",
      role: "ui",
      phase: "exec",
      provider: "claude",
      model: "flash",
      detail: { tier: "standard" },
    });
    expect(parsedEntry.event).toBe("harness.route");
  });

  it("performs zero disk I/O when disabled unless force is true", () => {
    const baseDir = makeTempDir();
    const nestedDataDir = path.join(baseDir, "nested-plugin-data");
    const logger = new HarnessDebugLogger({ dataDir: nestedDataDir, enabled: false });

    logger.record({
      event: "harness.route",
      level: "info",
      detail: { role: "ui" },
    });

    expect(fs.existsSync(nestedDataDir)).toBe(false);
    expect(fs.existsSync(logger.logFilePath)).toBe(false);

    const emptyStatus = logger.getStatus();
    expect(emptyStatus).toEqual({
      enabled: false,
      logFilePath: logger.logFilePath,
      totalLines: 0,
      fileSizeBytes: 0,
      rotatedExists: false,
      entries: [],
    });

    logger.record(
      {
        event: "debug.toggled",
        level: "info",
        detail: { enabled: false },
      },
      { force: true },
    );

    expect(fs.existsSync(logger.logFilePath)).toBe(true);
    const dirMode = fs.statSync(nestedDataDir).mode & 0o777;
    const fileMode = fs.statSync(logger.logFilePath).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it("recursively redacts tokens/secrets and truncates overly long preview strings", () => {
    const dataDir = makeTempDir();
    const logger = new HarnessDebugLogger({ dataDir, enabled: true });

    const longPayload = "x".repeat(2000);
    logger.record({
      event: "env.inject",
      level: "warn",
      agentId: "agt_secret",
      detail: {
        authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def",
        "x-api-key": "super-secret-header",
        nested: {
          apiKey: "sk-proj-1234567890abcdef",
          api_key: "another-secret",
          token: "tok-123",
          secret: "sec-123",
          password: "pw-123",
          inlineNote: "Used Bearer my-inline-bearer-token and sk-inline123456 key",
        },
        longText: longPayload,
        safeField: "keep-me",
      },
    });

    const rawContent = fs.readFileSync(logger.logFilePath, "utf8");
    expect(rawContent).not.toContain("eyJhbGci");
    expect(rawContent).not.toContain("super-secret-header");
    expect(rawContent).not.toContain("1234567890abcdef");
    expect(rawContent).not.toContain("another-secret");
    expect(rawContent).not.toContain("tok-123");
    expect(rawContent).not.toContain("sec-123");
    expect(rawContent).not.toContain("pw-123");
    expect(rawContent).not.toContain("my-inline-bearer-token");
    expect(rawContent).not.toContain("inline123456");
    expect(rawContent).toContain("[REDACTED]");
    expect(rawContent).toContain("keep-me");
    expect(rawContent).not.toContain(longPayload);

    const status = logger.getStatus(10);
    expect(status.entries).toHaveLength(1);
    expect(status.entries[0]?.detail?.safeField).toBe("keep-me");
    expect(String(status.entries[0]?.detail?.longText).length).toBeLessThan(700);
  });

  it("rotates active log file to debug-trace.1.jsonl at threshold and returns reverse chronological recent N entries", () => {
    const dataDir = makeTempDir();
    const logger = new HarnessDebugLogger({ dataDir, enabled: true, maxFileBytes: 450 });

    for (let i = 1; i <= 6; i += 1) {
      logger.record({
        event: `turn.transition.${i}`,
        level: "info",
        agentId: `agt_${i}`,
        detail: { step: i, note: "transition event payload for rotation test" },
      });
    }

    expect(fs.existsSync(logger.rotatedFilePath)).toBe(true);
    const status = logger.getStatus(2);
    expect(status.rotatedExists).toBe(true);
    expect(status.fileSizeBytes).toBeGreaterThan(0);
    expect(status.totalLines).toBeGreaterThan(0);
    expect(status.entries).toHaveLength(2);
    expect(status.entries[0]?.event).toBe("turn.transition.6");
    expect(status.entries[1]?.event).toBe("turn.transition.5");

    const cleared = logger.clear();
    expect(cleared.cleared).toBe(true);
    expect(cleared.removedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(logger.logFilePath)).toBe(false);
    expect(fs.existsSync(logger.rotatedFilePath)).toBe(false);
  });

  it("resolves default dataDir using PASEO_HOME", () => {
    const prev = process.env.PASEO_HOME;
    try {
      process.env.PASEO_HOME = "/tmp/custom-paseo-home";
      expect(resolveAgentHarnessDataDir()).toBe(
        path.join("/tmp/custom-paseo-home", "plugin-data", "agent-harness"),
      );
      expect(resolveAgentHarnessDataDir("/tmp/explicit-dir")).toBe(
        path.resolve("/tmp/explicit-dir"),
      );
    } finally {
      if (prev === undefined) delete process.env.PASEO_HOME;
      else process.env.PASEO_HOME = prev;
    }
  });

  it("redacts camelCase/snake_case/kebab-case sensitive keys and env/header/query/quoted inline secrets", () => {
    expect(isSensitiveKey("authToken")).toBe(true);
    expect(isSensitiveKey("webhookSecret")).toBe(true);
    expect(isSensitiveKey("dbPassword")).toBe(true);
    expect(isSensitiveKey("privateKey")).toBe(true);
    expect(isSensitiveKey("signingKey")).toBe(true);
    expect(isSensitiveKey("Set-Cookie")).toBe(true);
    expect(isSensitiveKey("roleMatchedRule")).toBe(false);

    const dataDir = makeTempDir();
    const logger = new HarnessDebugLogger({ dataDir, enabled: true });
    logger.record({
      event: "env.inject",
      level: "warn",
      detail: {
        authToken: "camel-tok-999",
        webhookSecret: "camel-sec-888",
        dbPassword: "camel-pw-777",
        privateKey: "-----BEGIN PRIVATE KEY-----",
        "Set-Cookie": "sid=abc123",
        envDump:
          "OPENAI_API_KEY=sk-proj-envsecret123 HARNESS_LLM_API_KEY=llm-sec-456 ANTHROPIC_AUTH_TOKEN=anth-tok-789 GITHUB_TOKEN=ghp_1234567890abcdef",
        httpHeaders: "x-api-key: hdr-api-sec, Authorization: Basic dXNlcjpwYXNz",
        callbackUrl: "https://hook.example.com/cb?token=qtok-111&api_key=qkey-222&ok=1",
        quotedCmd: `token="my-secret token" password='abc def' safe=yes`,
      },
    });

    const raw = fs.readFileSync(logger.logFilePath, "utf8");
    for (const leaked of [
      "camel-tok-999",
      "camel-sec-888",
      "camel-pw-777",
      "BEGIN PRIVATE KEY",
      "sid=abc123",
      "envsecret123",
      "llm-sec-456",
      "anth-tok-789",
      "1234567890abcdef",
      "hdr-api-sec",
      "dXNlcjpwYXNz",
      "qtok-111",
      "qkey-222",
      "my-secret token",
      "abc def",
    ]) {
      expect(raw).not.toContain(leaked);
    }

    expect(raw).toContain("safe=yes");
    expect(raw).toContain("ok=1");
    expect(raw).toContain('token=\\"[REDACTED]\\"');
    expect(raw).toContain("password='[REDACTED]'");
    expect(raw).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(raw).toContain("HARNESS_LLM_API_KEY=[REDACTED]");
    expect(raw).toContain("ANTHROPIC_AUTH_TOKEN=[REDACTED]");
  });

  it("reads large (>128 KiB) logs via chunked line count + tail window without full readFileSync", () => {
    const dataDir = makeTempDir();
    const logger = new HarnessDebugLogger({
      dataDir,
      enabled: true,
      maxFileBytes: 10 * 1024 * 1024,
    });

    // Write > 150 KiB of valid JSONL entries directly (~500 lines x ~320 bytes)
    const totalRecords = 500;
    const chunks: string[] = [];
    for (let i = 1; i <= totalRecords; i += 1) {
      chunks.push(
        JSON.stringify({
          ts: new Date(1_700_000_000_000 + i * 1000).toISOString(),
          event: `bulk.event.${i}`,
          level: "info",
          agentId: `agt_bulk_${i}`,
          detail: { seq: i, padding: "p".repeat(220) },
        }),
      );
    }
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(logger.logFilePath, `${chunks.join("\n")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    expect(fs.statSync(logger.logFilePath).size).toBeGreaterThan(128 * 1024);

    const readFileSpy = vi.spyOn(fs, "readFileSync");
    try {
      const status = logger.getStatus(5);
      expect(readFileSpy).not.toHaveBeenCalled();
      expect(status.totalLines).toBe(totalRecords);
      expect(status.entries).toHaveLength(5);
      expect(status.entries.map((e) => e.event)).toEqual([
        "bulk.event.500",
        "bulk.event.499",
        "bulk.event.498",
        "bulk.event.497",
        "bulk.event.496",
      ]);
    } finally {
      readFileSpy.mockRestore();
    }

    // Also verify clear() resets dirEnsured and recovers cleanly if directory is removed externally
    logger.clear();
    expect(fs.existsSync(logger.logFilePath)).toBe(false);
    fs.rmSync(dataDir, { recursive: true, force: true });
    logger.record({ event: "after.rmdir", level: "info" });
    expect(fs.existsSync(logger.logFilePath)).toBe(true);
    expect(logger.getStatus(5).entries[0]?.event).toBe("after.rmdir");
  });
});
