import { describe, it, expect, afterEach } from "vitest";
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
      runningCount: 1,
      waitingCount: 0,
      stoppedCount: 0,
      petXp: 100,
      petLevel: 1,
      tasks: [],
    });

    const received = await receivedPromise;
    expect(received.type).toBe("state_update");
    expect(received.runningCount).toBe(1);

    client.close();
  });
});
