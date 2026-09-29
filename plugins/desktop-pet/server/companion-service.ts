import { createServer, type Server } from "node:http";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import type { PetDashboardSnapshot } from "../shared/types.js";

export class CompanionService {
  private port: number;
  private boundPort: number = 0;
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private actionHandler: ((command: any) => Promise<void>) | null = null;

  constructor(port = 6768) {
    this.port = port;
  }

  public getPort(): number {
    return this.boundPort;
  }

  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ status: "ok", service: "paseo-desktop-pet", port: this.boundPort }),
        );
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

      this.httpServer.listen(this.port, "127.0.0.1", async () => {
        const addr = this.httpServer?.address();
        this.boundPort = addr && typeof addr === "object" ? addr.port : this.port;

        // Persist discovered port for companion clients
        try {
          const portFilePath = join(
            process.env.PASEO_HOME || join(homedir(), ".paseo"),
            "plugins",
            "desktop-pet",
            "companion-port.json",
          );
          await mkdir(join(portFilePath, ".."), { recursive: true });
          await writeFile(portFilePath, JSON.stringify({ port: this.boundPort }), "utf-8");
        } catch {
          // Ignore port file write failure
        }

        resolve(this.boundPort);
      });

      this.httpServer.on("error", (err: any) => {
        // Fallback to random free port if 6768 is occupied
        if (err.code === "EADDRINUSE" && this.port !== 0) {
          console.warn(`[desktop-pet] Port ${this.port} in use, falling back to random free port.`);
          this.port = 0;
          this.httpServer?.listen(0, "127.0.0.1");
        } else {
          reject(err);
        }
      });
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
