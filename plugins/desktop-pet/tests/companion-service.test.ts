import { describe, it, expect, afterEach, vi } from "vitest";
import { CompanionService } from "../server/companion-service.js";
import WebSocket from "ws";

describe("CompanionService", () => {
  let service: CompanionService | null = null;

  afterEach(async () => {
    if (service) {
      await service.stop();
      service = null;
    }
  });

  it("broadcasts snapshots to connected companion clients", async () => {
    service = new CompanionService(0); // Random free port
    const port = await service.start();

    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => client.on("open", () => resolve()));

    const receivedPromise = new Promise<any>((resolve) => {
      client.on("message", (data) => resolve(JSON.parse(data.toString())));
    });

    service.broadcastSnapshot({
      petMood: "running",
      runningCount: 1,
      waitingCount: 0,
      stoppedCount: 0,
      petXp: 100,
      petLevel: 1,
      xpToNextLevel: 500,
      tasks: [],
    });

    const received = await receivedPromise;
    expect(received.type).toBe("state_update");
    expect(received.runningCount).toBe(1);

    client.close();
  });

  it("routes decision.respond action to actionHandler correctly", async () => {
    service = new CompanionService(0);
    const actionMock = vi.fn().mockResolvedValue(undefined);
    service.setActionHandler(actionMock);
    const port = await service.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((res) => ws.on("open", res));

    ws.send(
      JSON.stringify({
        type: "decision.respond",
        agentId: "agent-123",
        requestId: "req-1",
        behavior: "ALLOW",
      }),
    );

    await vi.waitFor(() => {
      expect(actionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "decision.respond",
          agentId: "agent-123",
          requestId: "req-1",
          behavior: "ALLOW",
        }),
      );
    });

    ws.close();
  });

  it("serves valid JavaScript without syntax errors from /bundle.js", async () => {
    service = new CompanionService(0);
    const port = await service.start();

    const response = await fetch(`http://127.0.0.1:${port}/bundle.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");

    const jsText = await response.text();
    expect(jsText.length).toBeGreaterThan(100);

    // Verify syntax is 100% valid by parsing as a JS function
    expect(() => new Function(jsText)).not.toThrow();
  });
});
