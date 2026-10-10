import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { PetDashboardSnapshot } from "../shared/types.js";

const COMPANION_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Paseo Desktop Pet</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background: transparent;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        user-select: none;
        -webkit-app-region: drag;
      }
      #pet-container {
        width: 120px;
        height: 120px;
        position: relative;
        cursor: grab;
      }
      #bubble {
        position: absolute;
        top: 0;
        left: 10px;
        background: rgba(20, 20, 20, 0.9);
        color: #fff;
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 6px;
        display: none;
        border: 1px solid #333;
        white-space: nowrap;
      }
      #flyout {
        position: absolute;
        left: 130px;
        top: 10px;
        width: 240px;
        background: #181b1a;
        border: 1px solid #2e3430;
        border-radius: 8px;
        padding: 10px;
        display: none;
        color: #eee;
        -webkit-app-region: no-drag;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
      }
      .task-item {
        font-size: 11px;
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px solid #282d2a;
      }
      .disconnected {
        color: #f87171;
        font-size: 10px;
        margin-top: 4px;
      }
    </style>
  </head>
  <body>
    <div id="pet-container">
      <div id="bubble">⏳ 01:20</div>
      <canvas id="pet-canvas" width="120" height="120"></canvas>
    </div>
    <div id="flyout">
      <div style="font-weight: bold; font-size: 12px; margin-bottom: 6px">🐾 Active Tasks</div>
      <div id="connection-status"></div>
      <div id="task-list"></div>
    </div>
    <script src="./bundle.js"></script>
  </body>
</html>`;

const COMPANION_JS = `"use strict";
(() => {
  var AnimationEngine = class {
    canvas;
    ctx;
    mood = "idle";
    frame = 0;
    constructor(canvas2) {
      this.canvas = canvas2;
      this.ctx = canvas2.getContext("2d");
    }
    setMood(mood) {
      this.mood = mood;
    }
    render() {
      const { ctx, canvas: canvas2 } = this;
      ctx.clearRect(0, 0, canvas2.width, canvas2.height);
      const cx = canvas2.width / 2;
      const cy = canvas2.height / 2;
      const bounce = Math.sin(this.frame * 0.2) * 4;
      ctx.save();
      ctx.translate(cx, cy + bounce);
      ctx.fillStyle = this.mood === "urgent" ? "#EF4444" : "#F59E0B";
      ctx.fillRect(-20, -20, 40, 40);
      ctx.fillStyle = "#111";
      if (this.mood === "idle") {
        ctx.fillRect(-12, -4, 8, 2);
        ctx.fillRect(4, -4, 8, 2);
      } else {
        ctx.fillRect(-12, -6, 6, 6);
        ctx.fillRect(6, -6, 6, 6);
      }
      if (this.mood === "waiting" || this.mood === "urgent") {
        ctx.fillStyle = "#DC2626";
        ctx.fillRect(-4, -36, 8, 12);
        ctx.fillRect(-4, -20, 8, 4);
      } else if (this.mood === "running") {
        ctx.fillStyle = "#3B82F6";
        ctx.fillRect(-16, 22, 32, 4);
      }
      ctx.restore();
      this.frame++;
    }
  };

  var SoundSynthesizer = class {
    muted;
    volume;
    ctx = null;
    constructor(opts) {
      this.muted = opts?.muted ?? false;
      this.volume = opts?.volume ?? 0.7;
    }
    getAudioContext() {
      if (typeof window === "undefined") return null;
      if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }
    isMuted() {
      return this.muted;
    }
    toggleMute() {
      this.muted = !this.muted;
      return this.muted;
    }
    playTone(freq, durationSec, type = "square") {
      if (this.muted) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(this.volume * 0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(1e-3, ctx.currentTime + durationSec);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + durationSec);
      } catch {}
    }
    playDecisionRequired() {
      this.playTone(440, 0.15, "square");
      setTimeout(() => this.playTone(880, 0.2, "square"), 150);
    }
    playUrgent() {
      this.playTone(1200, 0.1, "square");
    }
    playApproved() {
      this.playTone(523.25, 0.15, "sine");
      setTimeout(() => this.playTone(659.25, 0.25, "sine"), 120);
    }
    playLevelUp() {
      const notes = [261.63, 329.63, 392, 523.25];
      notes.forEach((freq, idx) => {
        setTimeout(() => this.playTone(freq, 0.18, "triangle"), idx * 100);
      });
    }
  };

  var canvas = document.getElementById("pet-canvas");
  var bubble = document.getElementById("bubble");
  var flyout = document.getElementById("flyout");
  var taskList = document.getElementById("task-list");
  var connStatus = document.getElementById("connection-status");
  var engine = new AnimationEngine(canvas);
  var synth = new SoundSynthesizer();
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  var expanded = false;
  canvas.addEventListener("click", () => {
    expanded = !expanded;
    flyout.style.display = expanded ? "block" : "none";
  });
  function animate() {
    engine.render();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  var urlParams = new URLSearchParams(window.location.search);
  var wsHost =
    window.location.hostname && window.location.hostname !== ""
      ? window.location.hostname
      : "127.0.0.1";
  var wsPort = urlParams.get("port") || window.location.port || "6768";
  var token = urlParams.get("token") || "";

  var wsUrl = (window.location.protocol === "https:" ? "wss://" : "ws://") + wsHost + ":" + wsPort + (token ? "?token=" + encodeURIComponent(token) : "");
  var ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    if (connStatus) connStatus.innerHTML = "";
  };

  ws.onerror = () => {
    if (connStatus) connStatus.innerHTML = '<div class="disconnected">⚠️ 连接未授权或失败</div>';
  };

  ws.onclose = () => {
    if (connStatus) connStatus.innerHTML = '<div class="disconnected">🔌 隧道/连接已断开 (计时冻结)</div>';
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "state_update") {
        let mood = "idle";
        if (data.waitingCount > 0) {
          mood = "waiting";
          bubble.style.display = "block";
          bubble.innerText = "⚠️ 等待决策 (" + data.waitingCount + ")";
          synth.playDecisionRequired();
        } else if (data.runningCount > 0) {
          mood = "running";
          bubble.style.display = "none";
        } else {
          mood = "idle";
          bubble.style.display = "none";
        }
        engine.setMood(mood);
        taskList.innerHTML = (data.tasks || [])
          .map((t) => {
            const sec = t.activeDurationMs !== null ? Math.floor(t.activeDurationMs / 1e3) + "s" : "时长暂不可用";
            const safeTitle = escapeHtml(t.taskTitle || "未命名 agent");
            const safeState = escapeHtml(t.state || "UNKNOWN");
            return '<div class="task-item"><div><b>' + safeTitle + '</b> [' + safeState + ']</div><div style="color: #888;">⏱ 持续: ' + sec + '</div>' + (t.pendingDecision ? '<div style="color: #f59e0b;">⏳ 等待确认 (medium)</div>' : '') + '</div>';
          })
          .join("");
      }
    } catch (err) {
      console.error("Failed to parse websocket frame:", err);
    }
  };
})();
`;

function isAllowedHost(host: string): boolean {
  if (!host) return false;
  const h = host.split(":")[0].toLowerCase();
  return (
    h === "127.0.0.1" ||
    h === "localhost" ||
    h.endsWith(".ts.net") ||
    h.startsWith("100.") ||
    h.startsWith("192.168.") ||
    h.startsWith("10.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)
  );
}

export class CompanionService {
  private port: number;
  private token: string;
  private boundPort: number = 0;
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private actionHandler: ((command: any) => Promise<void>) | null = null;

  constructor(port = 6768, token = "") {
    this.port = port;
    this.token = token;
  }

  public getPort(): number {
    return this.boundPort;
  }

  public setActionHandler(handler: (command: any) => Promise<void>): void {
    this.actionHandler = handler;
  }

  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer((req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");

        // Serve companion bundle.js
        if (url.pathname === "/bundle.js") {
          res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
          return res.end(COMPANION_JS);
        }

        // Serve companion UI index.html
        if (url.pathname === "/" || url.pathname === "/index.html") {
          // If request specifically asked for application/json (e.g. status probe)
          if (
            req.headers.accept?.includes("application/json") &&
            !req.headers.accept?.includes("text/html")
          ) {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(
              JSON.stringify({ status: "ok", service: "paseo-desktop-pet", port: this.boundPort }),
            );
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return res.end(COMPANION_HTML);
        }

        // API status fallback
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ status: "ok", service: "paseo-desktop-pet", port: this.boundPort }),
        );
      });

      this.wss = new WebSocketServer({
        server: this.httpServer,
        verifyClient: (info, callback) => {
          try {
            const reqUrl = new URL(info.req.url || "/", "http://127.0.0.1");
            const tokenQuery = reqUrl.searchParams.get("token") || "";
            const authHeader = (info.req.headers.authorization || "").replace(/^Bearer\s+/i, "");
            const providedToken = (tokenQuery || authHeader).trim();

            if (this.token && providedToken !== this.token) {
              return callback(false, 401, "Unauthorized");
            }

            const host = (info.req.headers.host || "").split(":")[0].toLowerCase();
            if (!isAllowedHost(host)) {
              return callback(false, 403, "Forbidden Host");
            }

            if (info.origin) {
              const originUrl = new URL(info.origin);
              const originHost = originUrl.hostname.toLowerCase();
              if (!isAllowedHost(originHost)) {
                return callback(false, 403, "Forbidden Origin");
              }
            }

            callback(true);
          } catch {
            callback(false, 400, "Bad Request");
          }
        },
      });

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

      this.httpServer.on("error", (err: any) => {
        if (err.code === "EADDRINUSE" && this.port !== 0) {
          console.warn(`[desktop-pet] Port ${this.port} in use, falling back to random free port.`);
          this.port = 0;
          this.httpServer?.listen(0, "127.0.0.1");
        } else {
          reject(err);
        }
      });

      this.httpServer.listen(this.port, "127.0.0.1", async () => {
        const addr = this.httpServer?.address();
        this.boundPort = addr && typeof addr === "object" ? addr.port : this.port;

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
