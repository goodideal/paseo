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
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 0; background: transparent; overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        user-select: none; -webkit-app-region: drag;
      }
      #pet-container { width: 120px; height: 120px; position: relative; cursor: grab; }
      #dynamic-pill {
        position: absolute; top: -6px; left: 2px; right: 2px;
        background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 14px;
        padding: 3px 8px; font-size: 10px; color: #f8fafc; display: none;
        align-items: center; justify-content: space-between; gap: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4); white-space: nowrap; z-index: 10;
        -webkit-app-region: no-drag;
      }
      #dynamic-pill.urgent {
        border-color: rgba(239, 68, 68, 0.8); background: rgba(30, 10, 10, 0.94);
        box-shadow: 0 0 14px rgba(239, 68, 68, 0.45);
      }
      .pill-text { overflow: hidden; text-overflow: ellipsis; max-width: 72px; }
      .pill-btn {
        border: none; border-radius: 4px; padding: 1px 5px; font-size: 9px;
        font-weight: 600; cursor: pointer; color: #fff;
      }
      .pill-btn.allow { background: #10b981; }
      .pill-btn.deny { background: #ef4444; }
      .pill-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      #micro-hud {
        position: absolute; left: 128px; top: 0px; width: 290px; max-height: 380px;
        background: rgba(22, 27, 34, 0.94); backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px;
        padding: 12px; color: #f1f5f9; display: none; -webkit-app-region: no-drag;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65); overflow-y: auto; font-size: 11px;
      }
      #micro-hud::-webkit-scrollbar { width: 4px; }
      #micro-hud::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 2px; }
      .hud-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
      .pet-level-badge { font-weight: 700; font-size: 11px; color: #38bdf8; }
      .hud-stats-badges { display: flex; gap: 6px; font-size: 10px; color: #94a3b8; }
      .xp-bar-container { height: 4px; background: rgba(255, 255, 255, 0.08); border-radius: 2px; overflow: hidden; margin-bottom: 10px; }
      .xp-bar-fill { height: 100%; background: linear-gradient(90deg, #38bdf8, #10b981); width: 0%; transition: width 0.3s ease; }
      .section-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; margin-bottom: 6px; color: #94a3b8; }
      .urgent-card { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
      .urgent-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .urgent-title { font-weight: 600; color: #fca5a5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px; }
      .risk-badge { font-size: 9px; padding: 1px 4px; border-radius: 3px; background: #ef4444; color: #fff; font-weight: 700; }
      .action-preview { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; background: rgba(0, 0, 0, 0.35); padding: 4px 6px; border-radius: 4px; color: #f87171; margin: 4px 0 6px 0; word-break: break-all; }
      .card-actions { display: flex; gap: 6px; justify-content: flex-end; }
      .quest-card { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 8px; padding: 7px 10px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; }
      .quest-title { font-weight: 500; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
      .quest-meta { font-size: 9px; color: #64748b; margin-top: 2px; }
      .state-tag { font-size: 9px; padding: 1px 5px; border-radius: 3px; font-weight: 600; }
      .state-tag.running { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
      .settled-section { margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.06); color: #64748b; font-size: 10px; display: flex; justify-content: space-between; }
      .hud-footer { margin-top: 10px; display: flex; justify-content: space-between; align-items: center; }
      .footer-link { color: #38bdf8; text-decoration: none; font-size: 10px; cursor: pointer; }
      .footer-btn { background: transparent; border: 1px solid rgba(255, 255, 255, 0.15); color: #94a3b8; border-radius: 4px; padding: 2px 6px; font-size: 9px; cursor: pointer; }
      .disconnected-bar { background: #ef4444; color: #fff; padding: 4px; text-align: center; font-size: 9px; border-radius: 4px; margin-bottom: 6px; }
    </style>
  </head>
  <body>
    <div id="pet-container">
      <div id="dynamic-pill">
        <span class="pill-text" id="pill-text">⚡ Paseo Pet</span>
        <div id="pill-actions" style="display: flex; gap: 3px"></div>
      </div>
      <canvas id="pet-canvas" width="120" height="120"></canvas>
    </div>
    <div id="micro-hud">
      <div id="conn-banner"></div>
      <div class="hud-header">
        <span class="pet-level-badge" id="hud-pet-level">🐾 Lv.1 Cyber Pet</span>
        <div class="hud-stats-badges" id="hud-stats-badges"><span>0 🚨</span><span>0 ⚒️</span><span>0 🏆</span></div>
      </div>
      <div class="xp-bar-container"><div class="xp-bar-fill" id="hud-xp-fill"></div></div>
      <div id="p0-container"></div>
      <div id="p1-container"></div>
      <div id="p2-container"></div>
      <div class="hud-footer">
        <span class="footer-link" id="open-paseo-btn">🚀 打开 Paseo</span>
        <button class="footer-btn" id="mute-toggle-btn">🔊 提示音</button>
      </div>
    </div>
    <script src="./bundle.js"></script>
  </body>
</html>`;

const COMPANION_JS = `"use strict";
(() => {
  var AnimationEngine = class {
    canvas; ctx; mood = "idle"; frame = 0;
    constructor(canvas2) { this.canvas = canvas2; this.ctx = canvas2.getContext("2d"); }
    setMood(mood) { this.mood = mood; }
    render() {
      const { ctx, canvas: canvas2 } = this;
      ctx.clearRect(0, 0, canvas2.width, canvas2.height);
      const cx = canvas2.width / 2;
      const cy = canvas2.height / 2;
      const bounce = Math.sin(this.frame * 0.2) * 4;
      ctx.save();
      ctx.translate(cx, cy + bounce);
      ctx.fillStyle = this.mood === "urgent" ? "#EF4444" : this.mood === "waiting" ? "#F59E0B" : "#10B981";
      ctx.fillRect(-20, -20, 40, 40);
      ctx.fillStyle = "#111";
      if (this.mood === "idle") {
        ctx.fillRect(-12, -4, 8, 2); ctx.fillRect(4, -4, 8, 2);
      } else {
        ctx.fillRect(-12, -6, 6, 6); ctx.fillRect(6, -6, 6, 6);
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
    muted; volume; ctx = null;
    constructor(opts) { this.muted = opts?.muted ?? false; this.volume = opts?.volume ?? 0.7; }
    getAudioContext() {
      if (typeof window === "undefined") return null;
      if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === "suspended") { this.ctx.resume().catch(() => {}); }
      return this.ctx;
    }
    isMuted() { return this.muted; }
    toggleMute() { this.muted = !this.muted; return this.muted; }
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
    playUrgent() { this.playTone(1200, 0.1, "square"); }
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
  var dynamicPill = document.getElementById("dynamic-pill");
  var pillText = document.getElementById("pill-text");
  var pillActions = document.getElementById("pill-actions");
  var microHud = document.getElementById("micro-hud");
  var connBanner = document.getElementById("conn-banner");
  var hudPetLevel = document.getElementById("hud-pet-level");
  var hudStatsBadges = document.getElementById("hud-stats-badges");
  var hudXpFill = document.getElementById("hud-xp-fill");
  var p0Container = document.getElementById("p0-container");
  var p1Container = document.getElementById("p1-container");
  var p2Container = document.getElementById("p2-container");
  var muteToggleBtn = document.getElementById("mute-toggle-btn");
  var openPaseoBtn = document.getElementById("open-paseo-btn");

  var engine = new AnimationEngine(canvas);
  var synth = new SoundSynthesizer();

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  var expanded = false;
  canvas.addEventListener("click", () => {
    expanded = !expanded;
    microHud.style.display = expanded ? "block" : "none";
  });

  muteToggleBtn && muteToggleBtn.addEventListener("click", () => {
    const muted = synth.toggleMute();
    muteToggleBtn.innerText = muted ? "🔇 已静音" : "🔊 提示音";
  });

  openPaseoBtn && openPaseoBtn.addEventListener("click", () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "agent.focus", agentId: "" }));
    }
    window.open("http://127.0.0.1:6767", "_blank");
  });

  function animate() {
    engine.render();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  var urlParams = new URLSearchParams(window.location.search);
  var wsHost = window.location.hostname && window.location.hostname !== "" ? window.location.hostname : "127.0.0.1";
  var wsPort = urlParams.get("port") || window.location.port || "6768";
  var token = urlParams.get("token") || "";
  var wsUrl = (window.location.protocol === "https:" ? "wss://" : "ws://") + wsHost + ":" + wsPort + (token ? "?token=" + encodeURIComponent(token) : "");
  var ws = null;
  var previousWaitingCount = 0;
  var previousLevel = 1;
  var pendingRequests = new Set();
  var BACKOFF_DELAYS = [1000, 2000, 5000];
  var backoffIdx = 0;

  function sendDecision(agentId, requestId, behavior) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    pendingRequests.add(requestId);
    document.querySelectorAll('[data-req-id="' + requestId + '"]').forEach(function(btn) {
      btn.disabled = true;
      btn.innerText = "处理中...";
    });
    ws.send(JSON.stringify({ type: "decision.respond", agentId: agentId, requestId: requestId, behavior: behavior }));
  }

  function connectWs() {
    ws = new WebSocket(wsUrl);
    ws.onopen = function() {
      backoffIdx = 0;
      if (connBanner) connBanner.innerHTML = "";
    };
    ws.onerror = function() {
      if (connBanner) connBanner.innerHTML = '<div class="disconnected-bar">⚠️ 伴侣服务连接受阻</div>';
    };
    ws.onclose = function() {
      if (connBanner) connBanner.innerHTML = '<div class="disconnected-bar">🔌 连接断开，重连中...</div>';
      document.querySelectorAll(".pill-btn").forEach(function(btn) { btn.disabled = true; });
      var delay = BACKOFF_DELAYS[Math.min(backoffIdx++, BACKOFF_DELAYS.length - 1)];
      setTimeout(connectWs, delay);
    };
    ws.onmessage = function(event) {
      try {
        var data = JSON.parse(event.data);
        if (data.type === "action_ack") {
          if (data.requestId) pendingRequests.delete(data.requestId);
          if (data.success && data.behavior === "ALLOW") synth.playApproved();
          return;
        }
        if (data.type !== "state_update") return;

        var waitingCount = data.waitingCount || 0;
        var runningCount = data.runningCount || 0;
        var stoppedCount = data.stoppedCount || 0;
        var tasks = data.tasks || [];
        var petLevel = data.petLevel || 1;
        var petXp = data.petXp || 0;
        var xpToNextLevel = data.xpToNextLevel || 500;

        if (waitingCount > previousWaitingCount) {
          synth.playDecisionRequired();
        }
        previousWaitingCount = waitingCount;

        if (petLevel > previousLevel) {
          synth.playLevelUp();
          previousLevel = petLevel;
        }

        var activeReqIds = new Set();
        for (var i = 0; i < tasks.length; i++) {
          if (tasks[i].pendingDecision && tasks[i].pendingDecision.requestId) {
            activeReqIds.add(tasks[i].pendingDecision.requestId);
          }
        }
        pendingRequests.forEach(function(reqId) {
          if (!activeReqIds.has(reqId)) pendingRequests.delete(reqId);
        });

        var mood = data.petMood || "idle";
        engine.setMood(mood);

        if (hudPetLevel) hudPetLevel.innerText = "🐾 Lv." + petLevel + " Cyber Pet";
        if (hudStatsBadges) {
          hudStatsBadges.innerHTML = '<span>' + waitingCount + ' 🚨</span><span>' + runningCount + ' ⚒️</span><span>' + stoppedCount + ' 🏆</span>';
        }
        if (hudXpFill) {
          var pct = Math.min(100, Math.floor((petXp / xpToNextLevel) * 100));
          hudXpFill.style.width = pct + "%";
        }

        var p0Tasks = tasks.filter(function(t) { return t.priority === "P0" || t.state === "WAITING_DECISION"; });
        var p1Tasks = tasks.filter(function(t) { return t.priority === "P1" || (t.state === "RUNNING" && !p0Tasks.includes(t)); });
        var now = Date.now();

        if (p0Tasks.length > 0) {
          var topP0 = p0Tasks[0];
          var dec = topP0.pendingDecision || {};
          var reqId = dec.requestId || "";
          var isPending = pendingRequests.has(reqId);
          var remainingSec = Math.max(0, Math.ceil(((dec.expiresAt || 0) - now) / 1000));
          var isExpired = remainingSec === 0 && Boolean(dec.expiresAt);

          dynamicPill.style.display = "flex";
          dynamicPill.className = "urgent";
          var safeTitle = escapeHtml(topP0.taskTitle || "高危操作");
          pillText.innerHTML = '🚨 <b>待批:</b> <span title="' + safeTitle + '">' + safeTitle + '</span> (' + remainingSec + 's)';

          if (isExpired) {
            pillActions.innerHTML = '<span style="font-size: 9px; color: #ef4444">已超时</span>';
          } else {
            pillActions.innerHTML = '<button class="pill-btn allow" data-req-id="' + reqId + '" ' + (isPending ? 'disabled' : '') + '>' + (isPending ? '...' : '✓') + '</button><button class="pill-btn deny" data-req-id="' + reqId + '" ' + (isPending ? 'disabled' : '') + '>' + (isPending ? '...' : '✗') + '</button>';
            pillActions.querySelector(".allow")?.addEventListener("click", function(e) {
              e.stopPropagation();
              sendDecision(topP0.agentId, reqId, "ALLOW");
            });
            pillActions.querySelector(".deny")?.addEventListener("click", function(e) {
              e.stopPropagation();
              sendDecision(topP0.agentId, reqId, "DENY");
            });
          }
        } else if (p1Tasks.length > 0) {
          var topP1 = p1Tasks[0];
          var sec = Math.floor((topP1.activeDurationMs || 0) / 1000);
          var p1Title = escapeHtml(topP1.taskTitle);
          dynamicPill.style.display = "flex";
          dynamicPill.className = "";
          pillText.innerHTML = '⚡ <b title="' + p1Title + '">' + p1Title + '</b> (' + sec + 's)';
          pillActions.innerHTML = "";
        } else {
          dynamicPill.style.display = "none";
          pillActions.innerHTML = "";
        }

        if (p0Tasks.length > 0) {
          p0Container.innerHTML = '<div class="section-title" style="color: #f87171">🚨 紧急审批 (P0)</div>' +
            p0Tasks.map(function(t, idx) {
              var pDec = t.pendingDecision || {};
              var pReqId = pDec.requestId || "";
              var action = pDec.actionRequested || "执行受保护操作";
              var risk = (pDec.riskHint || "medium").toUpperCase();
              var remSec = Math.max(0, Math.ceil(((pDec.expiresAt || 0) - now) / 1000));
              var exp = remSec === 0 && Boolean(pDec.expiresAt);
              var pend = pendingRequests.has(pReqId);
              var tTitle = escapeHtml(t.taskTitle);

              return '<div class="urgent-card">' +
                '<div class="urgent-card-header"><span class="urgent-title" title="' + tTitle + '">' + tTitle + '</span><div style="display:flex;gap:4px;align-items:center"><span style="font-size:9px;color:' + (remSec < 20 ? '#ef4444' : '#f59e0b') + '">⏳ ' + remSec + 's</span><span class="risk-badge">' + escapeHtml(risk) + '</span></div></div>' +
                '<div class="action-preview">' + escapeHtml(action) + '</div>' +
                '<div class="card-actions">' +
                  (exp ? '<span style="font-size:10px;color:#ef4444">⏳ 已超时自动拦截</span>' :
                  '<button class="pill-btn allow" data-req-id="' + pReqId + '" id="p0-allow-' + idx + '" ' + (pend ? 'disabled' : '') + '>' + (pend ? '处理中...' : '✓ 放行') + '</button>' +
                  '<button class="pill-btn deny" data-req-id="' + pReqId + '" id="p0-deny-' + idx + '" ' + (pend ? 'disabled' : '') + '>' + (pend ? '处理中...' : '✗ 拒绝') + '</button>') +
                '</div></div>';
            }).join("");

          p0Tasks.forEach(function(t, idx) {
            var pDec = t.pendingDecision || {};
            var pReqId = pDec.requestId || "";
            document.getElementById("p0-allow-" + idx)?.addEventListener("click", function() {
              sendDecision(t.agentId, pReqId, "ALLOW");
            });
            document.getElementById("p0-deny-" + idx)?.addEventListener("click", function() {
              sendDecision(t.agentId, pReqId, "DENY");
            });
          });
        } else {
          p0Container.innerHTML = "";
        }

        if (p1Tasks.length > 0) {
          p1Container.innerHTML = '<div class="section-title">⚒️ 正在推进 (P1)</div>' +
            p1Tasks.map(function(t) {
              var s = t.activeDurationMs !== null ? Math.floor(t.activeDurationMs / 1000) + "s" : "--";
              var safeP1 = escapeHtml(t.taskTitle);
              return '<div class="quest-card"><div><div class="quest-title" title="' + safeP1 + '">' + safeP1 + '</div><div class="quest-meta">已运行: ' + s + '</div></div><span class="state-tag running">' + escapeHtml(t.state) + '</span></div>';
            }).join("");
        } else {
          p1Container.innerHTML = '<div style="color: #64748b; font-size: 10px; margin-bottom: 8px; text-align: center; padding: 10px 0;">☕ 当前无活跃打工任务</div>';
        }

        p2Container.innerHTML = '<div class="settled-section"><span>🏆 今日已完成: ' + stoppedCount + ' 笔任务</span><span>总经验: ' + petXp + ' XP</span></div>';
      } catch (err) {
        console.error("Failed to parse websocket frame:", err);
      }
    };
  }
  connectWs();
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
          if (this.port !== 0) {
            const portFilePath = join(
              process.env.PASEO_HOME || join(homedir(), ".paseo"),
              "plugins",
              "desktop-pet",
              "companion-port.json",
            );
            await mkdir(join(portFilePath, ".."), { recursive: true });
            await writeFile(portFilePath, JSON.stringify({ port: this.boundPort }), "utf-8");
          }
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

  public broadcastActionAck(ack: { requestId: string; behavior: string; success: boolean }): void {
    if (!this.wss) return;
    const payload = JSON.stringify({
      type: "action_ack",
      ...ack,
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
