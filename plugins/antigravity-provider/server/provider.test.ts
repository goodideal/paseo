import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProviderEvent } from "@getpaseo/plugin/server/provider";
import { afterEach, describe, expect, it } from "vitest";
import { createAntigravityProvider } from "./provider.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function launchAgent(source: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-antigravity-acp-"));
  directories.push(directory);
  const executable = path.join(directory, "agy.cjs");
  await writeFile(executable, source);
  return {
    directory,
    launch: {
      command: process.execPath,
      args: [executable, "acp", "--disable-telemetry"],
      env: { CAPTURE: path.join(directory, "requests.ndjson") },
    },
  };
}

it("reports a CLI without the acp subcommand as unavailable", async () => {
  const { launch } = await launchAgent(`
    process.stderr.write("Unknown command: acp");
    process.exitCode = 1;
  `);
  const provider = createAntigravityProvider();
  expect(provider.command?.slice(0, 2)).toEqual(["agy", "acp"]);
  expect(await provider.status!({ launch })).toMatchObject({
    available: false,
    diagnostic: expect.stringContaining("1.5.0"),
  });
});

const minimalAcpAgent = `
  const { createInterface } = require("node:readline");
  createInterface({ input: process.stdin }).on("line", (line) => {
    const { id, method } = JSON.parse(line);
    if (method === "initialize")
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: 1, agentCapabilities: {} } }) + "\\n");
  });
`;

describe("diagnostic", () => {
  it("says agy runs outside an SSH session when the daemon has no SSH variables", async () => {
    const { launch } = await launchAgent(minimalAcpAgent);
    expect(await createAntigravityProvider().status!({ launch })).toEqual({
      available: true,
      diagnostic: "SSH session: no\nSign-in: can differ from agy over SSH",
    });
  });

  it.each(["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"])(
    "says agy runs in an SSH session when the daemon has %s",
    async (variable) => {
      const { launch } = await launchAgent(minimalAcpAgent);
      const env = { ...launch.env, [variable]: "set" };
      expect(await createAntigravityProvider().status!({ launch: { ...launch, env } })).toEqual({
        available: true,
        diagnostic: `SSH session: yes (${variable})\nSign-in: can differ from agy outside SSH`,
      });
    },
  );

  it("says whether agy runs in an SSH session when ACP does not start", async () => {
    const { launch } = await launchAgent(`process.exit(1);`);
    const env = { ...launch.env, SSH_CONNECTION: "set" };
    expect(await createAntigravityProvider().status!({ launch: { ...launch, env } })).toEqual({
      available: false,
      diagnostic: [
        "Antigravity ACP did not start. Install Antigravity 1.5.0 or later. If you override the command, include the acp subcommand.",
        "SSH session: yes (SSH_CONNECTION)",
        "Sign-in: can differ from agy outside SSH",
      ].join("\n"),
    });
  });
});

it("publishes Antigravity skills separately from built-in commands", async () => {
  const { directory, launch } = await launchAgent(`
    const { createInterface } = require("node:readline");
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
    createInterface({ input: process.stdin }).on("line", (line) => {
      const { id, method } = JSON.parse(line);
      if (method === "initialize") {
        send({ id, result: { protocolVersion: 1 } });
      }
      if (method === "session/new") {
        send({ id, result: { sessionId: "native", modes: {
          currentModeId: "default", availableModes: [{ id: "default", name: "Default" }],
        } } });
        send({ method: "session/update", params: { sessionId: "native", update: {
          sessionUpdate: "available_commands_update",
          availableCommands: ["goal", "compact", "schedule", "browser", "plan", "grill-me",
            "teamwork", "learn", "boost", "agy-customizations", "antigravity-guide", "diagnose"]
            .map(name => ({ name, description: name })),
        } } });
      }
    });
  `);
  const connection = await createAntigravityProvider().connect({
    launch,
    versions: [1],
    capabilities: [],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  try {
    await connection.send({
      type: "session.open",
      requestId: "new",
      sessionId: "test",
      history: "skip",
      config: { cwd: directory, env: {}, mcpServers: {}, settings: {}, persist: false },
    });
    await expect
      .poll(() =>
        events.find(
          (event) => event.type === "session.commands" || event.type === "request.failed",
        ),
      )
      .toMatchObject({ type: "session.commands" });
    await expect
      .poll(() => events.find((event) => event.type === "session.commands")?.commands)
      .toEqual([
        ...[
          "goal",
          "compact",
          "schedule",
          "browser",
          "plan",
          "grill-me",
          "teamwork",
          "learn",
          "boost",
        ].map((name) => ({ name, description: name, kind: "command" })),
        ...["agy-customizations", "antigravity-guide", "diagnose"].map((name) => ({
          name,
          description: name,
          kind: "skill",
        })),
      ]);
  } finally {
    await connection.close();
  }
});

it.each([true, false])(
  "loads a saved stream-JSON session with ACP system prompt support %s",
  async (supportsSystemPrompt) => {
    const { directory, launch } = await launchAgent(`
      const { appendFileSync } = require("node:fs");
      const { createInterface } = require("node:readline");
      const configOptions = [
        { id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-neon",
          options: [{ value: "gemini-4-neon", name: "Gemini 4 Neon" }, { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }, { value: "gemini-4-neon-high", name: "Gemini 4 Neon High" }] },
        { id: "thought_level", name: "Thinking", category: "thought_level", type: "select", currentValue: "low",
          options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
        { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "accept-edits",
          options: [{ value: "default", name: "Default" }, { value: "accept-edits", name: "Accept edits" }] },
      ];
      const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
      createInterface({ input: process.stdin }).on("line", (line) => {
        appendFileSync(process.env.CAPTURE, line + "\\n");
        const { id, method, params } = JSON.parse(line);
        switch (method) {
          case "initialize":
            send({ id, result: { protocolVersion: 1, agentCapabilities: {
              loadSession: true,
              _meta: { antigravity: { systemPrompt: { append: ${supportsSystemPrompt} } } },
            } } });
            break;
          case "session/load":
            send({ method: "session/update", params: { sessionId: params.sessionId, update: {
              sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Saved reply" },
            } } });
            send({ method: "session/update", params: { sessionId: params.sessionId, update: {
              sessionUpdate: "tool_call", toolCallId: "write", name: "write_file", title: "File notes.txt",
              status: "completed", kind: "edit", rawInput: { Path: "/repo/notes.txt", Content: "hello" },
            } } });
            send({ id, result: { configOptions } });
            break;
          case "session/set_config_option":
            configOptions.find(option => option.id === params.configId).currentValue = params.value;
            send({ id, result: { configOptions } });
            break;
          case "session/close":
            send({ id, result: {} });
            break;
        }
      });
    `);
    const provider = createAntigravityProvider();
    expect(await provider.status!({ launch })).toMatchObject({ available: true });
    const connection = await provider.connect({
      launch,
      versions: [1],
      capabilities: ["session.configure", "session.persistence"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    try {
      await connection.send({
        type: "session.open",
        requestId: "restore",
        sessionId: "test",
        history: "replay",
        persistence: { version: 1, data: { conversationId: "saved-conversation" } },
        config: {
          cwd: directory,
          model: "gemini-3.8-flash-high",
          mode: "full-access",
          systemPrompt: "A test system instruction",
          env: {},
          mcpServers: {},
          settings: {},
          persist: true,
        },
      });
      await expect
        .poll(
          () =>
            events.find(
              (event) => event.type === "session.ready" || event.type === "request.failed",
            ),
          { timeout: 3_000 },
        )
        .toMatchObject({ type: "session.ready" });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "session.opened",
          persistence: { version: 1, data: { sessionId: "saved-conversation" } },
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "timeline.item",
          item: expect.objectContaining({ type: "assistant_message", text: "Saved reply" }),
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "session.config",
          config: expect.objectContaining({
            mode: "full-access",
            modes: expect.arrayContaining([
              expect.objectContaining({ id: "full-access", isUnattended: true }),
            ]),
            model: "gemini-3.8-flash",
            thinkingOption: "high",
          }),
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "timeline.item",
          item: expect.objectContaining({
            type: "tool_call",
            detail: { type: "write", filePath: "/repo/notes.txt", content: "hello" },
          }),
        }),
      );
      await connection.send({
        type: "session.configure",
        requestId: "native-model",
        sessionId: "test",
        changes: { model: "gemini-4-neon-high" },
      });
      await expect
        .poll(() =>
          events.find(
            (event) =>
              event.type === "session.config" && event.config.model === "gemini-4-neon-high",
          ),
        )
        .toBeDefined();
      const requests = (await readFile(launch.env.CAPTURE, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const load = requests.find((request) => request.method === "session/load");
      expect(load.params.sessionId).toBe("saved-conversation");
      expect(load.params._meta.antigravity).toEqual(
        supportsSystemPrompt
          ? { systemPrompt: { append: "A test system instruction" } }
          : undefined,
      );
    } finally {
      await connection.close();
    }
  },
);

const completedToolCalls = [
  {
    toolCallId: "shell",
    name: "run_command",
    kind: "execute",
    rawInput: {
      CommandLine: "printf test; exit 7",
      WaitMsBeforeAsync: 5000,
      toolSummary: "Run exit code test",
    },
    rawOutput: { output: "Command exited with code 7.\n\nCommand output:\ntest", exit_code: 7 },
  },
  {
    toolCallId: "read",
    name: "read_file",
    kind: "read",
    locations: [{ path: "/repo/probe.txt" }],
    rawInput: { Path: "/repo/probe.txt", StartLine: 2, EndLine: 2 },
  },
  {
    toolCallId: "write",
    name: "write_file",
    kind: "edit",
    locations: [{ path: "/repo/probe.txt" }],
    rawInput: { Path: "/repo/probe.txt", Content: "alpha\nbeta\ngamma\n", Overwrite: true },
    rawOutput: {},
    content: [{ type: "diff", path: "/repo/probe.txt", newText: "alpha\nbeta\ngamma\n" }],
  },
  {
    toolCallId: "edit",
    name: "edit_file",
    kind: "edit",
    locations: [{ path: "/repo/probe.txt" }],
    rawInput: { Path: "/repo/probe.txt", Target: "beta", Replacement: "delta" },
    rawOutput: {},
    content: [
      {
        type: "diff",
        path: "/repo/probe.txt",
        oldText: "alpha\nbeta\ngamma\n",
        newText: "alpha\ndelta\ngamma\n",
      },
    ],
  },
  {
    toolCallId: "web",
    name: "search_web",
    kind: "search",
    rawInput: { query: "IANA example domains" },
  },
  {
    toolCallId: "paseo",
    name: "mcp_paseo_send_agent_prompt",
    kind: "other",
    rawInput: { agentId: "agent-1", prompt: "Hello", toolSummary: "Send message" },
  },
  {
    toolCallId: "mcp",
    name: "mcp_local_tools_echo_message",
    kind: "other",
    rawInput: { message: "hello", toolSummary: "Echo message hello" },
  },
  {
    toolCallId: "ambiguous",
    name: "mcp_paseo_get_agent_status",
    kind: "other",
    rawInput: { agentId: "agent-1", toolSummary: "Get agent status" },
  },
];

it.each(["live", "replay"] as const)(
  "maps Antigravity tool calls in %s timelines",
  async (source) => {
    const { directory, launch } = await launchAgent(`
    const { createInterface } = require("node:readline");
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
    const tools = ${JSON.stringify(completedToolCalls)};
    const modes = { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] };
    createInterface({ input: process.stdin }).on("line", (line) => {
      const { id, method, params } = JSON.parse(line);
      const update = (update) => send({ method: "session/update", params: { sessionId: params.sessionId ?? "agy-session", update } });
      switch (method) {
        case "initialize":
          send({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
          break;
        case "session/new":
          send({ id, result: { sessionId: "agy-session", modes } });
          update({ sessionUpdate: "available_commands_update", availableCommands: [] });
          break;
        case "session/load":
        case "session/prompt":
          for (const { rawOutput, content, ...tool } of tools) {
            const completed = { status: "completed", rawOutput, content };
            if (method === "session/load") {
              update({ sessionUpdate: "tool_call", title: tool.name, ...tool, ...completed });
            } else {
              update({ sessionUpdate: "tool_call", title: tool.name, ...tool, status: "in_progress" });
              update({ sessionUpdate: "tool_call_update", toolCallId: tool.toolCallId, ...completed });
            }
          }
          send({ id, result: method === "session/load" ? { modes } : { stopReason: "end_turn" } });
          break;
        case "session/close":
          send({ id, result: {} });
          break;
      }
    });
  `);
    const connection = await createAntigravityProvider().connect({
      launch,
      versions: [1],
      capabilities: ["session.persistence", "prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    try {
      await connection.send({
        type: "session.open",
        requestId: "open",
        sessionId: "test",
        history: source === "replay" ? "replay" : "skip",
        persistence:
          source === "replay" ? { version: 1, data: { sessionId: "agy-session" } } : undefined,
        config: {
          cwd: directory,
          env: {},
          mcpServers: {
            paseo_get: { type: "stdio", command: "other-server" },
            local_tools: { type: "stdio", command: "echo-mcp" },
          },
          settings: {},
          persist: true,
        },
      });
      await expect
        .poll(
          () =>
            events.find(
              (event) => event.type === "session.ready" || event.type === "request.failed",
            ),
          { timeout: 4_000 },
        )
        .toMatchObject({ type: "session.ready" });
      if (source === "live") {
        await connection.send({
          type: "session.prompt",
          sessionId: "test",
          prompt: {
            clientMessageId: "exercise-tools",
            delivery: "auto",
            input: { type: "message", content: [{ type: "text", text: "Exercise tools" }] },
          },
        });
      }
      const calls = () =>
        events.flatMap((event) =>
          event.type === "timeline.item" && event.item.type === "tool_call" ? [event.item] : [],
        );
      await expect
        .poll(() => calls().filter((call) => call.status === "completed").length)
        .toBe(completedToolCalls.length);
      const completed = Object.fromEntries(calls().map((call) => [call.id, call]));
      expect(completed.shell.detail).toEqual({
        type: "shell",
        command: "printf test; exit 7",
        output: "Command exited with code 7.\n\nCommand output:\ntest",
        exitCode: 7,
      });
      expect(completed.read.detail).toEqual({
        type: "read",
        filePath: "/repo/probe.txt",
        offset: 2,
        limit: 1,
      });
      expect(completed.write.detail).toEqual({
        type: "write",
        filePath: "/repo/probe.txt",
        content: "alpha\nbeta\ngamma\n",
      });
      expect(completed.edit.detail).toEqual({
        type: "edit",
        filePath: "/repo/probe.txt",
        oldString: "alpha\nbeta\ngamma\n",
        newString: "alpha\ndelta\ngamma\n",
      });
      expect(completed.web.detail).toEqual({
        type: "search",
        toolName: "web_search",
        query: "IANA example domains",
      });
      expect(completed.paseo).toMatchObject({
        name: "paseo.send_agent_prompt",
        detail: { type: "unknown", input: { agentId: "agent-1", prompt: "Hello" }, output: null },
      });
      expect(completed.paseo.detail).not.toHaveProperty("input.toolSummary");
      expect(completed.mcp).toMatchObject({
        name: "local_tools.echo_message",
        detail: { type: "unknown", input: { message: "hello" }, output: null },
      });
      expect(completed.mcp.detail).not.toHaveProperty("input.toolSummary");
      expect(completed.ambiguous).toMatchObject({
        name: "mcp_paseo_get_agent_status",
        detail: { type: "unknown", input: { agentId: "agent-1" }, output: null },
      });
      if (source === "live") {
        expect(calls()).toContainEqual(
          expect.objectContaining({
            id: "shell",
            status: "running",
            detail: { type: "shell", command: "printf test; exit 7" },
          }),
        );
      }
    } finally {
      await connection.close();
    }
  },
);

// agy 1.5.14 lists `thought_level` only for the selected model and omits it for Orchestrator.
it("offers each model its own thinking options and opens Orchestrator with its default", async () => {
  const { directory, launch } = await launchAgent(`
    const { createInterface } = require("node:readline");
    const levels = (...values) => values.map((value) => ({ value, name: value }));
    const thinking = {
      "gemini-4-neon": { currentValue: "high", options: levels("low", "medium", "high", "xhigh") },
      "gemini-4-carbon": { currentValue: "high", options: levels("low", "medium", "high") },
      "claude-opus-5-5": { currentValue: "medium", options: levels("low", "medium", "high") },
    };
    let model = "gemini-4-neon";
    const configOptions = () => [
      { id: "model", name: "Model", category: "model", type: "select", currentValue: model, options: [
        { value: "gemini-4-neon", name: "Gemini 4 Neon" },
        { value: "gemini-4-carbon", name: "Gemini 4 Carbon" },
        { value: "gemini-pro-orchestrator-neon", name: "Orchestrator (Neon)" },
        { value: "claude-opus-5-5", name: "Claude Opus 5.5" },
      ] },
      ...(thinking[model] ? [{ id: "thought_level", name: "Thinking", category: "thought_level", type: "select", ...thinking[model] }] : []),
      { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default",
        options: [{ value: "default", name: "Default" }, { value: "plan", name: "Plan" }] },
    ];
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
    createInterface({ input: process.stdin }).on("line", (line) => {
      const { id, method, params } = JSON.parse(line);
      if (method === "initialize") send({ id, result: { protocolVersion: 1, agentCapabilities: {} } });
      if (method === "session/new") {
        model = "gemini-4-neon";
        send({ id, result: { sessionId: "native", configOptions: configOptions() } });
      }
      if (method === "session/set_config_option") {
        if (params.configId === "thought_level" && !thinking[model]) {
          send({ id, error: { code: -32602, message: "unknown config option" } });
          return;
        }
        if (params.configId === "model") model = params.value;
        else if (params.configId === "thought_level") thinking[model].currentValue = params.value;
        send({ id, result: { configOptions: configOptions() } });
      }
      if (method === "session/close") send({ id, result: {} });
    });
  `);
  const connection = await createAntigravityProvider().connect({
    launch,
    versions: [1],
    capabilities: ["session.configure"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  try {
    await connection.send({ type: "catalog", requestId: "catalog", cwd: directory });
    await expect
      .poll(() =>
        events.find((event) => event.type === "catalog" || event.type === "request.failed"),
      )
      .toMatchObject({ type: "catalog" });
    const catalog = events.find((event) => event.type === "catalog");
    if (catalog?.type !== "catalog") throw new Error("Expected a catalog");
    const thinkingByModel = Object.fromEntries(
      catalog.catalog.models.map((model) => [
        model.id,
        {
          options: model.thinkingOptions?.map((option) => option.id),
          default: model.defaultThinkingOptionId,
        },
      ]),
    );
    expect(thinkingByModel).toEqual({
      "gemini-4-neon": { options: ["low", "medium", "high", "xhigh"], default: "high" },
      "gemini-4-carbon": { options: ["low", "medium", "high"], default: "high" },
      "gemini-pro-orchestrator-neon": { options: [], default: undefined },
      "claude-opus-5-5": { options: ["low", "medium", "high"], default: "medium" },
    });

    await connection.send({
      type: "session.open",
      requestId: "open",
      sessionId: "orchestrator",
      history: "skip",
      config: {
        cwd: directory,
        model: "gemini-pro-orchestrator-neon",
        mode: "full-access",
        thinkingOption: thinkingByModel["gemini-pro-orchestrator-neon"]!.default,
        env: {},
        mcpServers: {},
        settings: {},
        persist: true,
      },
    });
    await expect
      .poll(
        () =>
          events.find(
            (event) =>
              (event.type === "session.ready" && event.sessionId === "orchestrator") ||
              (event.type === "request.failed" && event.requestId === "open"),
          ),
        { timeout: 3_000 },
      )
      .toMatchObject({ type: "session.ready" });
  } finally {
    await connection.close();
  }
});

describe("installation", () => {
  const signal = new AbortController().signal;

  it("reports the version agy prints and links its install docs", async () => {
    // A real `agy acp --version` starts the ACP server, so the fake refuses it.
    const { launch } = await launchAgent(`
      const args = process.argv.slice(2);
      if (args.includes("acp")) process.exit(1);
      if (args[0] === "--version") console.log("Antigravity CLI 1.6.2");
    `);
    const installation = createAntigravityProvider().installation!;
    expect(installation.installUrl).toBe("https://antigravity.google/docs/getting-started?tab=cli");
    expect(installation.update).toBeUndefined();
    await expect(
      installation.inspect!({ launch: { ...launch, resolved: true }, signal }),
    ).resolves.toEqual({
      status: "installed",
      version: "1.6.2",
    });
  });

  it("is not installed when the executable does not resolve", async () => {
    const launch = { command: "agy", args: ["acp"], env: {}, resolved: false };
    await expect(
      createAntigravityProvider().installation!.inspect!({ launch, signal }),
    ).resolves.toEqual({ status: "not_installed" });
  });
});

it("completes the turn when a recurring schedule stays in progress after end_turn", async () => {
  const { directory, launch } = await launchAgent(`
    const { createInterface } = require("node:readline");
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
    createInterface({ input: process.stdin }).on("line", (line) => {
      const { id, method } = JSON.parse(line);
      const update = (update) => send({ method: "session/update", params: { sessionId: "agy-session", update } });
      switch (method) {
        case "initialize":
          send({ id, result: { protocolVersion: 1 } });
          break;
        case "session/new":
          send({ id, result: { sessionId: "agy-session", modes: {
            currentModeId: "default", availableModes: [{ id: "default", name: "Default" }],
          } } });
          update({ sessionUpdate: "available_commands_update", availableCommands: [] });
          break;
        case "session/prompt": {
          const args = { CronExpression: "*/15 * * * *", Prompt: "ping" };
          update({ sessionUpdate: "usage_update", used: 12725, size: 1048576 });
          update({
            sessionUpdate: "tool_call", toolCallId: "cron", name: "schedule",
            args, status: "in_progress", kind: "other", title: "Run schedule", rawInput: args,
          });
          update({ sessionUpdate: "usage_update", used: 12915, size: 1048576 });
          send({ id, result: { stopReason: "end_turn" } });
          break;
        }
        case "session/close":
          send({ id, result: {} });
          break;
      }
    });
  `);
  const connection = await createAntigravityProvider().connect({
    launch,
    versions: [1],
    capabilities: ["prompt.message"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  try {
    await connection.send({
      type: "session.open",
      requestId: "open",
      sessionId: "test",
      history: "skip",
      config: { cwd: directory, env: {}, mcpServers: {}, settings: {}, persist: false },
    });
    await expect
      .poll(() => events)
      .toContainEqual(expect.objectContaining({ type: "session.ready", sessionId: "test" }));
    await connection.send({
      type: "session.prompt",
      sessionId: "test",
      prompt: {
        clientMessageId: "schedule-turn",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "Schedule a recurring ping" }] },
      },
    });
    await expect
      .poll(() => events)
      .toContainEqual(
        expect.objectContaining({
          type: "timeline.item",
          item: expect.objectContaining({ type: "tool_call", id: "cron", status: "running" }),
        }),
      );
    await expect
      .poll(() => events)
      .toContainEqual({
        type: "session.turn",
        sessionId: "test",
        turnId: "acp:schedule-turn",
        state: "completed",
      });
  } finally {
    await connection.close();
  }
});

it("keeps a turn open for backgrounded run_command calls but not IsDaemon commands", async () => {
  const { directory, launch } = await launchAgent(`
    const { createInterface } = require("node:readline");
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
    let turn = 0;
    createInterface({ input: process.stdin }).on("line", (line) => {
      const { id, method, params } = JSON.parse(line);
      switch (method) {
        case "initialize":
          send({ id, result: { protocolVersion: 1, agentCapabilities: {} } });
          break;
        case "session/new":
          send({ id, result: { sessionId: "agy-session", configOptions: [
            { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default",
              options: [{ value: "default", name: "Default" }] },
          ] } });
          break;
        case "session/prompt":
          turn += 1;
          if (turn === 1) {
            send({ method: "session/update", params: { sessionId: params.sessionId, update: {
              sessionUpdate: "tool_call", toolCallId: "daemon-1", name: "run_command",
              title: "Dev server", status: "in_progress", rawInput: { CommandLine: "npm run dev", IsDaemon: true },
            } } });
            send({ id, result: { stopReason: "end_turn" } });
          } else {
            send({ method: "session/update", params: { sessionId: params.sessionId, update: {
              sessionUpdate: "tool_call", toolCallId: "bg-1", name: "run_command",
              title: "Background build", status: "in_progress", rawInput: { CommandLine: "sleep 1" },
            } } });
            send({ id, result: { stopReason: "end_turn" } });
            setTimeout(() => {
              send({ method: "session/update", params: { sessionId: params.sessionId, update: {
                sessionUpdate: "tool_call_update", toolCallId: "bg-1", status: "completed",
              } } });
              send({ method: "session/update", params: { sessionId: params.sessionId, update: {
                sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Build finished." },
              } } });
              send({ method: "session/update", params: { sessionId: params.sessionId, update: {
                sessionUpdate: "usage_update", used: 50, size: 1000,
              } } });
            }, 80);
          }
          break;
        case "session/close":
          send({ id, result: {} });
          break;
      }
    });
  `);
  const provider = createAntigravityProvider();
  const connection = await provider.connect({
    launch,
    versions: [1],
    capabilities: ["prompt.message"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  try {
    await connection.send({
      type: "session.open",
      requestId: "open-1",
      sessionId: "agy-test",
      history: "skip",
      config: {
        cwd: directory,
        env: {},
        mcpServers: {},
        settings: {},
        persist: false,
      },
    });
    await expect
      .poll(() => events.find((event) => event.type === "session.ready"), { timeout: 3_000 })
      .toBeDefined();

    // Turn 1: IsDaemon: true completes immediately on end_turn.
    await connection.send({
      type: "session.prompt",
      sessionId: "agy-test",
      prompt: {
        clientMessageId: "daemon-turn",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "start dev server" }] },
      },
    });
    await expect
      .poll(
        () =>
          events.find(
            (event) =>
              event.type === "session.turn" &&
              event.turnId === "acp:daemon-turn" &&
              event.state === "completed",
          ),
        { timeout: 3_000 },
      )
      .toBeDefined();

    // Turn 2: non-daemon background command keeps turn open until completion + reply + usage_update.
    await connection.send({
      type: "session.prompt",
      sessionId: "agy-test",
      prompt: {
        clientMessageId: "bg-turn",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "run build" }] },
      },
    });
    await expect
      .poll(
        () =>
          events.find(
            (event) =>
              event.type === "timeline.item" &&
              event.item.type === "tool_call" &&
              event.item.id === "bg-1" &&
              event.item.status === "running",
          ),
        { timeout: 3_000 },
      )
      .toBeDefined();
    expect(
      events.some(
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:bg-turn" &&
          event.state === "completed",
      ),
    ).toBe(false);
    await expect
      .poll(
        () =>
          events.find(
            (event) =>
              event.type === "session.turn" &&
              event.turnId === "acp:bg-turn" &&
              event.state === "completed",
          ),
        { timeout: 3_000 },
      )
      .toBeDefined();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "timeline.item",
        item: expect.objectContaining({ type: "assistant_message", text: "Build finished." }),
      }),
    );
  } finally {
    await connection.close();
  }
});

describe("background task log tailing", () => {
  it("streams local task log tail with activity and silence annotations, rejects traversal, and preserves final rawOutput", async () => {
    const { directory, launch } = await launchAgent(`
      const { createInterface } = require("node:readline");
      const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
      createInterface({ input: process.stdin }).on("line", (line) => {
        const { id, method, params } = JSON.parse(line);
        switch (method) {
          case "initialize":
            send({ id, result: { protocolVersion: 1, agentCapabilities: {} } });
            break;
          case "session/new":
            send({ id, result: { sessionId: "sess-bg-1", configOptions: [
              { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default",
                options: [{ value: "default", name: "Default" }] },
            ] } });
            send({ method: "session/update", params: { sessionId: "sess-bg-1", update: {
              sessionUpdate: "available_commands_update", availableCommands: [],
            } } });
            break;
          case "session/prompt":
            if (params.prompt?.[0]?.text === "finish") {
              send({ method: "session/update", params: { sessionId: params.sessionId, update: {
                sessionUpdate: "tool_call_update", toolCallId: "cmd-bg", status: "completed",
                rawOutput: { output: "FINAL COMPLETE OUTPUT", exit_code: 0 },
              } } });
              send({ id, result: { stopReason: "end_turn" } });
              break;
            }
            send({ method: "session/update", params: { sessionId: params.sessionId, update: {
              sessionUpdate: "tool_call", toolCallId: "cmd-bg", name: "run_command",
              title: "Run OCR review", status: "in_progress",
              rawInput: { CommandLine: "ocr review --effort low", toolSummary: "Run OCR review" },
            } } });
            send({ id, result: { stopReason: "end_turn" } });
            break;
          case "session/close":
            send({ id, result: {} });
            break;
        }
      });
    `);

    const brainRoot = path.join(directory, "brain");
    const sessionDir = path.join(brainRoot, "sess-bg-1");
    const logsDir = path.join(sessionDir, ".system_generated", "logs");
    const tasksDir = path.join(sessionDir, ".system_generated", "tasks");
    await mkdir(logsDir, { recursive: true });
    await mkdir(tasksDir, { recursive: true });

    const outsideSecret = path.join(directory, "secret.log");
    await writeFile(outsideSecret, "TOP SECRET DO NOT LEAK\n");
    const validTaskLog = path.join(tasksDir, "task-42.log");
    await writeFile(validTaskLog, "[ocr] scanning file 1\n[ocr] scanning file 2\n");

    const transcriptLines = [
      JSON.stringify({
        step_index: 41,
        type: "GENERIC",
        status: "RUNNING",
        content: `Tool is running as a background task with task id: sess-bg-1/task-41\nTask Description: evil command\nTask logs are available at: file://${outsideSecret}`,
      }),
      JSON.stringify({
        step_index: 42,
        type: "GENERIC",
        status: "RUNNING",
        content: `Tool is running as a background task with task id: sess-bg-1/task-42\nTask Description: ocr review --effort low\nTask logs are available at: file://${validTaskLog}`,
      }),
    ];
    await writeFile(path.join(logsDir, "transcript.jsonl"), transcriptLines.join("\n") + "\n");

    let clockMs = 10_000;
    const provider = createAntigravityProvider({
      brainRootDir: brainRoot,
      initialDelayMs: 15,
      pollIntervalMs: 25,
      silentThresholdMs: 200,
      now: () => clockMs,
    });
    const connection = await provider.connect({
      launch,
      versions: [1],
      capabilities: ["prompt.message", "prompt.steer"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));

    try {
      await connection.send({
        type: "session.open",
        requestId: "open-bg",
        sessionId: "agy-bg",
        history: "skip",
        config: { cwd: directory, env: {}, mcpServers: {}, settings: {}, persist: false },
      });
      await expect
        .poll(() => events.find((event) => event.type === "session.ready"), { timeout: 3_000 })
        .toBeDefined();

      await connection.send({
        type: "session.prompt",
        sessionId: "agy-bg",
        prompt: {
          clientMessageId: "p1",
          delivery: "auto",
          input: { type: "message", content: [{ type: "text", text: "start" }] },
        },
      });

      await expect
        .poll(
          () =>
            events.find(
              (event) =>
                event.type === "timeline.item" &&
                event.item.type === "tool_call" &&
                event.item.id === "cmd-bg" &&
                event.item.detail.type === "shell" &&
                event.item.detail.output?.includes("[ocr] scanning file 2"),
            ),
          { timeout: 3_000 },
        )
        .toBeDefined();

      await expect
        .poll(
          () =>
            events.find(
              (event) =>
                event.type === "session.background_work" &&
                event.items?.[0]?.description === "Run OCR review · 活跃",
            ),
          { timeout: 3_000 },
        )
        .toBeDefined();

      // Advance clock past silentThresholdMs without growing the file -> transitions to 静默.
      clockMs = 10_250;
      await expect
        .poll(
          () =>
            events.find(
              (event) =>
                event.type === "session.background_work" &&
                event.items?.[0]?.description === "Run OCR review · 静默 200ms+",
            ),
          { timeout: 3_000 },
        )
        .toBeDefined();
      expect(
        events.some(
          (event) =>
            event.type === "timeline.item" &&
            event.item.type === "tool_call" &&
            event.item.detail.type === "shell" &&
            event.item.detail.output?.includes("静默"),
        ),
      ).toBe(true);

      // Finish the tool via steer prompt and ensure final rawOutput wins cleanly.
      await connection.send({
        type: "session.prompt",
        sessionId: "agy-bg",
        prompt: {
          clientMessageId: "p2",
          delivery: "steer",
          input: { type: "message", content: [{ type: "text", text: "finish" }] },
        },
      });
      await expect
        .poll(
          () =>
            events.find(
              (event) =>
                event.type === "timeline.item" &&
                event.item.type === "tool_call" &&
                event.item.id === "cmd-bg" &&
                event.item.status === "completed" &&
                event.item.detail.type === "shell" &&
                event.item.detail.output === "FINAL COMPLETE OUTPUT",
            ),
          { timeout: 3_000 },
        )
        .toBeDefined();
      await expect
        .poll(() => events.findLast((event) => event.type === "session.background_work")?.items, {
          timeout: 3_000,
        })
        .toEqual([]);
    } finally {
      await connection.close();
    }
  });

  it("rejects task log paths escaping .system_generated/tasks/", async () => {
    const { directory, launch } = await launchAgent(`
      const { createInterface } = require("node:readline");
      const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
      createInterface({ input: process.stdin }).on("line", (line) => {
        const { id, method, params } = JSON.parse(line);
        if (method === "initialize") send({ id, result: { protocolVersion: 1, agentCapabilities: {} } });
        if (method === "session/new") {
          send({ id, result: { sessionId: "sess-escape", configOptions: [
            { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default",
              options: [{ value: "default", name: "Default" }] },
          ] } });
          send({ method: "session/update", params: { sessionId: "sess-escape", update: {
            sessionUpdate: "available_commands_update", availableCommands: [],
          } } });
        }
        if (method === "session/prompt") {
          send({ method: "session/update", params: { sessionId: params.sessionId, update: {
            sessionUpdate: "tool_call", toolCallId: "cmd-escape", name: "run_command",
            title: "Escape check", status: "in_progress",
            rawInput: { CommandLine: "evil command" },
          } } });
          send({ id, result: { stopReason: "end_turn" } });
        }
        if (method === "session/close") send({ id, result: {} });
      });
    `);

    const brainRoot = path.join(directory, "brain");
    const sessionDir = path.join(brainRoot, "sess-escape");
    const logsDir = path.join(sessionDir, ".system_generated", "logs");
    const tasksDir = path.join(sessionDir, ".system_generated", "tasks");
    await mkdir(logsDir, { recursive: true });
    await mkdir(tasksDir, { recursive: true });

    const outsideLog = path.join(directory, "outside.log");
    await writeFile(outsideLog, "SENSITIVE OUTSIDE CONTENT\n");
    const symlinkLog = path.join(tasksDir, "task-2.log");
    await symlink(outsideLog, symlinkLog);
    await writeFile(
      path.join(logsDir, "transcript.jsonl"),
      [
        JSON.stringify({
          step_index: 1,
          type: "GENERIC",
          status: "RUNNING",
          content: `Tool is running as a background task with task id: sess-escape/task-1\nTask Description: evil command\nTask logs are available at: file://${tasksDir}/../../../outside.log`,
        }),
        JSON.stringify({
          step_index: 2,
          type: "GENERIC",
          status: "RUNNING",
          content: `Tool is running as a background task with task id: sess-escape/task-2\nTask Description: evil command\nTask logs are available at: file://${symlinkLog}`,
        }),
      ].join("\n") + "\n",
    );

    const provider = createAntigravityProvider({
      brainRootDir: brainRoot,
      initialDelayMs: 10,
      pollIntervalMs: 20,
      silentThresholdMs: 5_000,
    });
    const connection = await provider.connect({
      launch,
      versions: [1],
      capabilities: ["prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));

    try {
      await connection.send({
        type: "session.open",
        requestId: "open-escape",
        sessionId: "agy-escape",
        history: "skip",
        config: { cwd: directory, env: {}, mcpServers: {}, settings: {}, persist: false },
      });
      await expect
        .poll(() => events.find((event) => event.type === "session.ready"), { timeout: 3_000 })
        .toBeDefined();
      await connection.send({
        type: "session.prompt",
        sessionId: "agy-escape",
        prompt: {
          clientMessageId: "p-esc",
          delivery: "auto",
          input: { type: "message", content: [{ type: "text", text: "go" }] },
        },
      });
      await expect
        .poll(
          () =>
            events.find(
              (event) =>
                event.type === "session.background_work" &&
                event.items?.[0]?.description === "Escape check · 活跃",
            ),
          { timeout: 3_000 },
        )
        .toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(
        events.some(
          (event) =>
            event.type === "timeline.item" &&
            event.item.type === "tool_call" &&
            event.item.detail.type === "shell" &&
            event.item.detail.output?.includes("SENSITIVE OUTSIDE CONTENT"),
        ),
      ).toBe(false);
    } finally {
      await connection.close();
    }
  });

  it("ignores stale historical records and rebinds when a newer matching task log appears", async () => {
    const { directory, launch } = await launchAgent(`
      const { createInterface } = require("node:readline");
      const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
      createInterface({ input: process.stdin }).on("line", (line) => {
        const { id, method, params } = JSON.parse(line);
        if (method === "initialize") send({ id, result: { protocolVersion: 1, agentCapabilities: {} } });
        if (method === "session/new") {
          send({ id, result: { sessionId: "sess-rebind", configOptions: [
            { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default",
              options: [{ value: "default", name: "Default" }] },
          ] } });
          send({ method: "session/update", params: { sessionId: "sess-rebind", update: {
            sessionUpdate: "available_commands_update", availableCommands: [],
          } } });
        }
        if (method === "session/prompt") {
          send({ method: "session/update", params: { sessionId: params.sessionId, update: {
            sessionUpdate: "tool_call", toolCallId: "cmd-rebind", name: "run_command",
            title: "Run tests", status: "in_progress",
            rawInput: { CommandLine: "npm test" },
          } } });
          send({ id, result: { stopReason: "end_turn" } });
        }
        if (method === "session/close") send({ id, result: {} });
      });
    `);

    const brainRoot = path.join(directory, "brain");
    const sessionDir = path.join(brainRoot, "sess-rebind");
    const logsDir = path.join(sessionDir, ".system_generated", "logs");
    const tasksDir = path.join(sessionDir, ".system_generated", "tasks");
    await mkdir(logsDir, { recursive: true });
    await mkdir(tasksDir, { recursive: true });

    const staleLog = path.join(tasksDir, "task-1.log");
    await writeFile(staleLog, "OLD STALE OUTPUT\n");
    const recentOldLog = path.join(tasksDir, "task-2.log");
    await writeFile(recentOldLog, "INITIAL RECENT OUTPUT\n");
    const freshNewLog = path.join(tasksDir, "task-3.log");
    await writeFile(freshNewLog, "NEW RUN OUTPUT\n");

    const transcriptPath = path.join(logsDir, "transcript.jsonl");
    const nowIso = new Date().toISOString();
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          step_index: 1,
          type: "GENERIC",
          status: "RUNNING",
          created_at: "2020-01-01T00:00:00Z",
          content: `Tool is running as a background task with task id: sess-rebind/task-1\nTask Description: npm test\nTask logs are available at: file://${staleLog}`,
        }),
        JSON.stringify({
          step_index: 2,
          type: "GENERIC",
          status: "DONE",
          created_at: nowIso,
          content: `Tool is running as a background task with task id: sess-rebind/task-2\nTask Description: npm test\nTask logs are available at: file://${recentOldLog}`,
        }),
      ].join("\n") + "\n",
    );

    const provider = createAntigravityProvider({
      brainRootDir: brainRoot,
      initialDelayMs: 10,
      pollIntervalMs: 25,
      silentThresholdMs: 5_000,
    });
    const connection = await provider.connect({
      launch,
      versions: [1],
      capabilities: ["prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));

    try {
      await connection.send({
        type: "session.open",
        requestId: "open-rebind",
        sessionId: "agy-rebind",
        history: "skip",
        config: { cwd: directory, env: {}, mcpServers: {}, settings: {}, persist: false },
      });
      await expect
        .poll(() => events.find((event) => event.type === "session.ready"), { timeout: 3_000 })
        .toBeDefined();
      await connection.send({
        type: "session.prompt",
        sessionId: "agy-rebind",
        prompt: {
          clientMessageId: "p-rebind",
          delivery: "auto",
          input: { type: "message", content: [{ type: "text", text: "go" }] },
        },
      });

      await expect
        .poll(
          () =>
            events.find(
              (event) =>
                event.type === "session.background_work" &&
                event.items?.[0]?.description === "Run tests · 活跃",
            ),
          { timeout: 3_000 },
        )
        .toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(
        events.some(
          (event) =>
            event.type === "timeline.item" &&
            event.item.type === "tool_call" &&
            event.item.detail.type === "shell" &&
            (event.item.detail.output?.includes("OLD STALE OUTPUT") ||
              event.item.detail.output?.includes("INITIAL RECENT OUTPUT")),
        ),
      ).toBe(false);

      // Now the new RUNNING step lands in transcript.jsonl and should be bound immediately.
      await writeFile(
        transcriptPath,
        JSON.stringify({
          step_index: 3,
          type: "GENERIC",
          status: "RUNNING",
          created_at: new Date().toISOString(),
          content: `Tool is running as a background task with task id: sess-rebind/task-3\nTask Description: npm test\nTask logs are available at: file://${freshNewLog}`,
        }) + "\n",
        { flag: "a" },
      );

      await expect
        .poll(
          () =>
            events.find(
              (event) =>
                event.type === "timeline.item" &&
                event.item.type === "tool_call" &&
                event.item.detail.type === "shell" &&
                event.item.detail.output?.includes("NEW RUN OUTPUT"),
            ),
          { timeout: 3_000 },
        )
        .toBeDefined();
    } finally {
      await connection.close();
    }
  });
});
