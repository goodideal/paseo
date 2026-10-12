import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import WebSocket from "ws";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { DesktopPetAgentProjection } from "./agent-projection.js";

function resolveDaemonPort(home: string): number {
  if (process.env.PASEO_PORT) {
    const p = parseInt(process.env.PASEO_PORT, 10);
    if (!Number.isNaN(p)) return p;
  }
  if (process.env.PASEO_LISTEN) {
    const match = process.env.PASEO_LISTEN.match(/:(\d+)$/);
    if (match) return parseInt(match[1], 10);
  }
  if (home.includes(".dev") || process.env.NODE_ENV === "development") {
    return 6768;
  }
  return 6767;
}

export class AgentSubscriber {
  private client: DaemonClient | null = null;
  private subscription: { release(): Promise<void> } | null = null;

  constructor(private readonly projection: DesktopPetAgentProjection) {}

  public canRespond(): boolean {
    return this.client !== null;
  }

  public async respondToPermission(
    agentId: string,
    requestId: string,
    response: { behavior: "allow" | "deny" },
  ): Promise<void> {
    if (!this.client) {
      throw new Error("AgentSubscriber daemon client not connected");
    }
    await this.client.respondToPermission(agentId, requestId, response);
  }

  public async start(): Promise<void> {
    const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
    const credFile = join(home, "local-credential");
    if (!existsSync(credFile)) {
      console.warn("[desktop-pet] local-credential file not found, skipping agent observation");
      return;
    }

    try {
      const token = readFileSync(credFile, "utf8").trim();
      const daemonPort = resolveDaemonPort(home);
      this.client = new DaemonClient({
        url: `ws://127.0.0.1:${daemonPort}/ws`,
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
