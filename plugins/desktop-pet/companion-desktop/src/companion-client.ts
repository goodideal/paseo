import { AnimationEngine, type PetMood } from "./animation-engine.js";
import { SoundSynthesizer } from "./sound-synthesizer.js";

const canvas = document.getElementById("pet-canvas") as HTMLCanvasElement;
const dynamicPill = document.getElementById("dynamic-pill") as HTMLDivElement;
const pillText = document.getElementById("pill-text") as HTMLSpanElement;
const pillActions = document.getElementById("pill-actions") as HTMLDivElement;
const microHud = document.getElementById("micro-hud") as HTMLDivElement;
const connBanner = document.getElementById("conn-banner") as HTMLDivElement;

const hudPetLevel = document.getElementById("hud-pet-level") as HTMLSpanElement;
const hudStatsBadges = document.getElementById("hud-stats-badges") as HTMLDivElement;
const hudXpFill = document.getElementById("hud-xp-fill") as HTMLDivElement;
const p0Container = document.getElementById("p0-container") as HTMLDivElement;
const p1Container = document.getElementById("p1-container") as HTMLDivElement;
const p2Container = document.getElementById("p2-container") as HTMLDivElement;
const muteToggleBtn = document.getElementById("mute-toggle-btn") as HTMLButtonElement;
const openPaseoBtn = document.getElementById("open-paseo-btn") as HTMLSpanElement;

const engine = new AnimationEngine(canvas);
const synth = new SoundSynthesizer();

function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let expanded = false;
canvas.addEventListener("click", () => {
  expanded = !expanded;
  microHud.style.display = expanded ? "block" : "none";
});

muteToggleBtn?.addEventListener("click", () => {
  const muted = synth.toggleMute();
  muteToggleBtn.innerText = muted ? "🔇 已静音" : "🔊 提示音";
});

openPaseoBtn?.addEventListener("click", () => {
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

// Determine companion WebSocket endpoint
const urlParams = new URLSearchParams(window.location.search);
const wsHost =
  window.location.hostname && window.location.hostname !== ""
    ? window.location.hostname
    : "127.0.0.1";
const wsPort = urlParams.get("port") || window.location.port || "6768";
const token = urlParams.get("token") || "";
const wsUrl = `${window.location.protocol === "https:" ? "wss://" : "ws://"}${wsHost}:${wsPort}${
  token ? `?token=${encodeURIComponent(token)}` : ""
}`;

let ws: WebSocket | null = null;
let previousWaitingCount = 0;
let previousLevel = 1;
const pendingRequests = new Set<string>();
const BACKOFF_DELAYS = [1000, 2000, 5000];
let backoffIdx = 0;

function sendDecision(agentId: string, requestId: string, behavior: "ALLOW" | "DENY") {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  pendingRequests.add(requestId);
  // Synchronously disable associated buttons across all UI surfaces
  document.querySelectorAll<HTMLButtonElement>(`[data-req-id="${requestId}"]`).forEach((btn) => {
    btn.disabled = true;
    btn.innerText = "处理中...";
  });
  ws.send(
    JSON.stringify({
      type: "decision.respond",
      agentId,
      requestId,
      behavior,
    }),
  );
}

function connectWs() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    backoffIdx = 0;
    if (connBanner) connBanner.innerHTML = "";
  };

  ws.onerror = () => {
    if (connBanner)
      connBanner.innerHTML = `<div class="disconnected-bar">⚠️ 伴侣服务连接受阻</div>`;
  };

  ws.onclose = () => {
    if (connBanner)
      connBanner.innerHTML = `<div class="disconnected-bar">🔌 连接已断开，自动重连中...</div>`;
    document.querySelectorAll<HTMLButtonElement>(".pill-btn").forEach((btn) => {
      btn.disabled = true;
    });
    const delay = BACKOFF_DELAYS[Math.min(backoffIdx++, BACKOFF_DELAYS.length - 1)];
    setTimeout(connectWs, delay);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // Handle action acknowledgment from server
      if (data.type === "action_ack") {
        if (data.requestId) {
          pendingRequests.delete(data.requestId);
        }
        if (data.success && data.behavior === "ALLOW") {
          synth.playApproved();
        }
        return;
      }

      if (data.type !== "state_update") return;

      const waitingCount = data.waitingCount || 0;
      const runningCount = data.runningCount || 0;
      const stoppedCount = data.stoppedCount || 0;
      const tasks = data.tasks || [];
      const petLevel = data.petLevel || 1;
      const petXp = data.petXp || 0;
      const xpToNextLevel = data.xpToNextLevel || 500;

      // Audio cue on new waiting decision
      if (waitingCount > previousWaitingCount) {
        synth.playDecisionRequired();
      }
      previousWaitingCount = waitingCount;

      // Audio cue on Level Up
      if (petLevel > previousLevel) {
        synth.playLevelUp();
        previousLevel = petLevel;
      }

      // Cleanup pending requests that are no longer active
      const activeReqIds = new Set<string>();
      for (const t of tasks) {
        if (t.pendingDecision?.requestId) {
          activeReqIds.add(t.pendingDecision.requestId);
        }
      }
      for (const reqId of pendingRequests) {
        if (!activeReqIds.has(reqId)) {
          pendingRequests.delete(reqId);
        }
      }

      // Pet mood
      let mood: PetMood = data.petMood || "idle";
      if (!data.petMood) {
        if (waitingCount > 0) mood = "waiting";
        else if (runningCount > 0) mood = "running";
        else mood = "idle";
      }
      engine.setMood(mood);

      // Render Header & XP
      if (hudPetLevel) hudPetLevel.innerText = `🐾 Lv.${petLevel} Cyber Pet`;
      if (hudStatsBadges) {
        hudStatsBadges.innerHTML = `
          <span style="color: ${waitingCount > 0 ? "#f87171" : "#94a3b8"}">${waitingCount} 🚨</span>
          <span style="color: ${runningCount > 0 ? "#38bdf8" : "#94a3b8"}">${runningCount} ⚒️</span>
          <span>${stoppedCount} 🏆</span>
        `;
      }
      if (hudXpFill) {
        const pct = Math.min(100, Math.floor((petXp / xpToNextLevel) * 100));
        hudXpFill.style.width = `${pct}%`;
      }

      // Filter tasks by priority
      const p0Tasks = tasks.filter(
        (t: any) => t.priority === "P0" || t.state === "WAITING_DECISION",
      );
      const p1Tasks = tasks.filter(
        (t: any) => t.priority === "P1" || (t.state === "RUNNING" && !p0Tasks.includes(t)),
      );

      const now = Date.now();

      // Render Dynamic Pill
      if (p0Tasks.length > 0) {
        const topP0 = p0Tasks[0];
        const dec = topP0.pendingDecision || {};
        const reqId = dec.requestId || "";
        const isPending = pendingRequests.has(reqId);
        const remainingSec = Math.max(0, Math.ceil(((dec.expiresAt || 0) - now) / 1000));
        const isExpired = remainingSec === 0 && Boolean(dec.expiresAt);

        dynamicPill.style.display = "flex";
        dynamicPill.className = "urgent";
        const titleSafe = escapeHtml(topP0.taskTitle || "高危操作");
        pillText.innerHTML = `🚨 <b>待批:</b> <span title="${titleSafe}">${titleSafe}</span> (${remainingSec}s)`;

        if (isExpired) {
          pillActions.innerHTML = `<span style="font-size: 9px; color: #ef4444">已超时</span>`;
        } else {
          pillActions.innerHTML = `
            <button class="pill-btn allow" data-req-id="${reqId}" ${isPending ? "disabled" : ""}>${
              isPending ? "..." : "✓"
            }</button>
            <button class="pill-btn deny" data-req-id="${reqId}" ${isPending ? "disabled" : ""}>${
              isPending ? "..." : "✗"
            }</button>
          `;
          pillActions.querySelector(".allow")?.addEventListener("click", (e) => {
            e.stopPropagation();
            sendDecision(topP0.agentId, reqId, "ALLOW");
          });
          pillActions.querySelector(".deny")?.addEventListener("click", (e) => {
            e.stopPropagation();
            sendDecision(topP0.agentId, reqId, "DENY");
          });
        }
      } else if (p1Tasks.length > 0) {
        const topP1 = p1Tasks[0];
        const sec = Math.floor((topP1.activeDurationMs || 0) / 1000);
        const titleSafe = escapeHtml(topP1.taskTitle);
        dynamicPill.style.display = "flex";
        dynamicPill.className = "";
        pillText.innerHTML = `⚡ <b title="${titleSafe}">${titleSafe}</b> (${sec}s)`;
        pillActions.innerHTML = "";
      } else {
        dynamicPill.style.display = "none";
        pillActions.innerHTML = "";
      }

      // Render P0 Urgent Section in HUD
      if (p0Tasks.length > 0) {
        p0Container.innerHTML = `
          <div class="section-title" style="color: #f87171">🚨 紧急审批 (P0)</div>
          ${p0Tasks
            .map((t: any, idx: number) => {
              const dec = t.pendingDecision || {};
              const reqId = dec.requestId || "";
              const action = dec.actionRequested || "执行受保护操作";
              const risk = (dec.riskHint || "medium").toUpperCase();
              const remainingSec = Math.max(0, Math.ceil(((dec.expiresAt || 0) - now) / 1000));
              const isExpired = remainingSec === 0 && Boolean(dec.expiresAt);
              const isPending = pendingRequests.has(reqId);
              const titleSafe = escapeHtml(t.taskTitle);

              return `
              <div class="urgent-card" id="urgent-card-${idx}">
                <div class="urgent-card-header">
                  <span class="urgent-title" title="${titleSafe}">${titleSafe}</span>
                  <div style="display: flex; gap: 4px; align-items: center">
                    <span style="font-size: 9px; color: ${remainingSec < 20 ? "#ef4444" : "#f59e0b"}">⏳ ${remainingSec}s</span>
                    <span class="risk-badge">${escapeHtml(risk)}</span>
                  </div>
                </div>
                <div class="action-preview">${escapeHtml(action)}</div>
                <div class="card-actions">
                  ${
                    isExpired
                      ? `<span style="font-size: 10px; color: #ef4444">⏳ 已超时自动拦截</span>`
                      : `
                    <button class="pill-btn allow" data-req-id="${reqId}" id="p0-allow-${idx}" ${
                      isPending ? "disabled" : ""
                    }>${isPending ? "处理中..." : "✓ 放行"}</button>
                    <button class="pill-btn deny" data-req-id="${reqId}" id="p0-deny-${idx}" ${
                      isPending ? "disabled" : ""
                    }>${isPending ? "处理中..." : "✗ 拒绝"}</button>
                  `
                  }
                </div>
              </div>`;
            })
            .join("")}
        `;
        p0Tasks.forEach((t: any, idx: number) => {
          const dec = t.pendingDecision || {};
          const reqId = dec.requestId || "";
          document.getElementById(`p0-allow-${idx}`)?.addEventListener("click", () => {
            sendDecision(t.agentId, reqId, "ALLOW");
          });
          document.getElementById(`p0-deny-${idx}`)?.addEventListener("click", () => {
            sendDecision(t.agentId, reqId, "DENY");
          });
        });
      } else {
        p0Container.innerHTML = "";
      }

      // Render P1 Active Quests in HUD
      if (p1Tasks.length > 0) {
        p1Container.innerHTML = `
          <div class="section-title">⚒️ 正在推进 (P1)</div>
          ${p1Tasks
            .map((t: any) => {
              const sec =
                t.activeDurationMs !== null ? `${Math.floor(t.activeDurationMs / 1000)}s` : "--";
              const titleSafe = escapeHtml(t.taskTitle);
              return `
              <div class="quest-card">
                <div>
                  <div class="quest-title" title="${titleSafe}">${titleSafe}</div>
                  <div class="quest-meta">已运行: ${sec}</div>
                </div>
                <span class="state-tag running">${escapeHtml(t.state)}</span>
              </div>`;
            })
            .join("")}
        `;
      } else {
        p1Container.innerHTML = `
          <div style="color: #64748b; font-size: 10px; margin-bottom: 8px; text-align: center; padding: 10px 0;">
            ☕ 当前无活跃打工任务
          </div>
        `;
      }

      // Render P2 Settled Section in HUD
      p2Container.innerHTML = `
        <div class="settled-section">
          <span>🏆 今日已完成: ${stoppedCount} 笔任务</span>
          <span>总经验: ${petXp} XP</span>
        </div>
      `;
    } catch (err) {
      console.error("[desktop-pet] Failed to parse websocket frame:", err);
    }
  };
}

connectWs();
