import { describe, expect, it } from "vitest";
import { normalizeDaemonWsUrl } from "../index.server.js";

describe("normalizeDaemonWsUrl", () => {
  it("rewrites wildcard binds to loopback", () => {
    expect(normalizeDaemonWsUrl("0.0.0.0:27067")).toBe("ws://127.0.0.1:27067/ws");
    expect(normalizeDaemonWsUrl("ws://0.0.0.0:27067")).toBe("ws://127.0.0.1:27067/ws");
  });

  it("keeps concrete hosts and ports", () => {
    expect(normalizeDaemonWsUrl("127.0.0.1:27067")).toBe("ws://127.0.0.1:27067/ws");
    expect(normalizeDaemonWsUrl("daemon.lan:6767")).toBe("ws://daemon.lan:6767/ws");
  });

  it("preserves an explicit ws path and scheme", () => {
    expect(normalizeDaemonWsUrl("ws://127.0.0.1:27067/ws")).toBe("ws://127.0.0.1:27067/ws");
    expect(normalizeDaemonWsUrl("wss://daemon.example.com")).toBe("wss://daemon.example.com/ws");
  });
});
