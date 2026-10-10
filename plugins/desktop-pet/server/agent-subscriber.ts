import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import WebSocket from "ws";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { DesktopPetAgentProjection } from "./agent-projection.js";

export class AgentSubscriber {
  private client: DaemonClient | null = null;
  private subscription: { release(): Promise<void> } | null = null;

  constructor(private readonly projection: DesktopPetAgentProjection) {}

  public async start(): Promise<void> {
    const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
    const credFile = join(home, "local-credential");
    if (!existsSync(credFile)) {
      console.warn("[desktop-pet] local-credential file not found, skipping agent observation");
      return;
    }

    try {
      const token = readFileSync(credFile, "utf8").trim();
      this.client = new DaemonClient({
        url: "ws://127.0.0.1:6767/ws",
        clientId: "desktop-pet-agent-subscriber",
        clientType: "cli",
        localCredential: () => token,
        webSocketFactory: (url, config) =>
          new WebSocket(url, config?.protocols, { headers: config?.headers }) as any,
        reconnect: { enabled: true },
      });

      await this.client.connect();

      const sub = this.client.observeAgents({ scope: "active" });
      this.subscription = sub;

      sub.subscribe({
        snapshot: (payload) => {
          const agents = payload.entries.map((e) => e.agent);
          this.projection.handleSnapshot(agents);
        },
        update: (msg) => {
          if (msg.type !== "agent_update") return;
          if (msg.payload.kind === "upsert") {
            this.projection.handleUpdate(msg.payload.agent);
          } else if (msg.payload.kind === "remove") {
            this.projection.handleRemove(msg.payload.agentId);
          }
        },
      });
    } catch (err) {
      console.error("[desktop-pet] Failed to connect AgentSubscriber:", err);
    }
  }

  public async stop(): Promise<void> {
    if (this.subscription) {
      await this.subscription.release().catch(() => {});
      this.subscription = null;
    }
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
    }
  }
}
