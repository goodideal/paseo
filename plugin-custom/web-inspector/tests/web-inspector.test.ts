import { describe, expect, it } from "vitest";
import { inspectUrlRpc, searchInspectorRpc } from "../shared/inspect.js";
import { authSettings } from "../shared/settings.js";
import contributeClient from "../index.client.js";
import contributeServer from "../index.server.js";

describe("web-inspector plugin", () => {
  it("validates inspectUrlRpc contract schema", () => {
    expect(inspectUrlRpc.name).toBe("web_inspector.diagnose.request");

    const validInput = { url: "https://example.com/test" };
    expect(inspectUrlRpc.input.parse(validInput)).toEqual(validInput);

    expect(() => inspectUrlRpc.input.parse({ url: "not-a-url" })).toThrow();

    const validOutput = {
      url: "https://example.com/test",
      screenshotBase64: "base64data",
      consoleLogs: [{ type: "error" as const, text: "Uncaught error", location: "app.js:10" }],
      networkErrors: [
        {
          url: "https://example.com/api",
          status: 500,
          statusText: "Internal Error",
          method: "GET",
        },
      ],
      diagnostics: "1 error found",
    };
    expect(inspectUrlRpc.output.parse(validOutput)).toEqual(validOutput);
  });

  it("validates searchInspectorRpc contract schema", () => {
    expect(searchInspectorRpc.name).toBe("web_inspector.attachment.search");

    const validInput = { query: "https://example.com" };
    expect(searchInspectorRpc.input.parse(validInput)).toEqual(validInput);

    const validOutput = {
      items: [
        {
          id: "diag-1",
          identifier: "https://example.com",
          title: "Diagnostics",
          subtitle: "Found errors",
          url: "https://example.com",
          text: "Report body",
          resourceType: "Web Diagnostics",
        },
      ],
    };
    expect(searchInspectorRpc.output.parse(validOutput)).toEqual(validOutput);
  });

  it("validates authSettings schema", () => {
    expect(authSettings.id).toBe("web-inspector");
    expect(authSettings.scope).toBe("host");
    const parsed = authSettings.schema.parse({});
    expect(parsed).toEqual({ cookieString: "", extraHeaders: "" });
  });

  it("registers client contributions with valid icons and returns cleanup function", () => {
    const panels: any[] = [];
    const commands: any[] = [];
    const sources: any[] = [];
    const settings: any[] = [];

    const mockClient = {
      addWorkspacePanel: (p: any) => {
        panels.push(p);
        return () => {};
      },
      addSlashCommand: (c: any) => {
        commands.push(c);
        return () => {};
      },
      addAttachmentSource: (s: any) => {
        sources.push(s);
        return () => {};
      },
      addSettingsScreen: (st: any) => {
        settings.push(st);
        return () => {};
      },
    } as any;

    const cleanup = contributeClient(mockClient);
    expect(typeof cleanup).toBe("function");

    expect(panels).toHaveLength(1);
    expect(panels[0].id).toBe("web-inspector-panel");
    expect(panels[0].icon).toBe("Bug");

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("inspect");

    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe("web-inspector-source");
    expect(sources[0].icon).toBe("Bug");

    expect(settings).toHaveLength(1);
    expect(settings[0].id).toBe("web-inspector-settings");
    expect(settings[0].icon).toBe("Key");

    expect(() => cleanup()).not.toThrow();
  });

  it("registers server handlers and returns cleanup function", () => {
    const handled: string[] = [];
    const mockServer = {
      registerSettings: () => ({
        read: async () => ({ status: "ready", values: {} }),
      }),
      handle: (contract: any) => {
        handled.push(contract.name);
      },
    } as any;

    const cleanup = contributeServer(mockServer);
    expect(typeof cleanup).toBe("function");
    expect(handled).toContain("web_inspector.diagnose.request");
    expect(handled).toContain("web_inspector.attachment.search");
    expect(() => cleanup()).not.toThrow();
  });
});
