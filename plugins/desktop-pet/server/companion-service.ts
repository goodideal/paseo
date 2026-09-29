import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { PetDashboardSnapshot } from "../shared/types.js";

export class CompanionService {
  private port: number;
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private actionHandler: ((command: any) => Promise<void>) | null = null;

  constructor(port = 0) {
    this.port = port;
  }

  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: "paseo-desktop-pet" }));
      });

      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on("connection", (ws) => {
        ws.on("message", async (data) => {
          try {
            const command = JSON.parse(data.toString());
            if (this.actionHandler) {
              await this.actionHandler(command);
            }
          } catch (err) {
            console.error("[desktop-pet] Failed to parse companion message:", err);
          }
        });
      });

      this.httpServer.listen(this.port, "127.0.0.1", () => {
        const addr = this.httpServer?.address();
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          resolve(this.port);
        }
      });

      this.httpServer.on("error", reject);
    });
  }

  public broadcastSnapshot(snapshot: PetDashboardSnapshot): void {
    if (!this.wss) return;
    const payload = JSON.stringify({
      type: "state_update",
      ...snapshot,
    });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  public onActionCommand(callback: (command: any) => Promise<void>): void {
    this.actionHandler = callback;
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        for (const client of this.wss.clients) {
          client.terminate();
        }
        this.wss.close();
      }
      if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
