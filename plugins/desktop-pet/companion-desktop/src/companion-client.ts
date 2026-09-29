import { AnimationEngine, type PetMood } from "./animation-engine.js";
import { SoundSynthesizer } from "./sound-synthesizer.js";

const canvas = document.getElementById("pet-canvas") as HTMLCanvasElement;
const bubble = document.getElementById("bubble") as HTMLDivElement;
const flyout = document.getElementById("flyout") as HTMLDivElement;
const taskList = document.getElementById("task-list") as HTMLDivElement;

const engine = new AnimationEngine(canvas);
const synth = new SoundSynthesizer();

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let expanded = false;
canvas.addEventListener("click", () => {
  expanded = !expanded;
  flyout.style.display = expanded ? "block" : "none";
});

function animate() {
  engine.render();
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Determine companion WebSocket host & port (supports remote daemon IP like Tailscale/LAN)
const urlParams = new URLSearchParams(window.location.search);
const wsHost =
  window.location.hostname && window.location.hostname !== ""
    ? window.location.hostname
    : "127.0.0.1";
const wsPort = urlParams.get("port") || window.location.port || "6768";
const ws = new WebSocket(`ws://${wsHost}:${wsPort}`);

ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    if (data.type === "state_update") {
      let mood: PetMood = "idle";
      if (data.waitingCount > 0) {
        mood = "waiting";
        bubble.style.display = "block";
        bubble.innerText = `⚠️ 等待决策 (${data.waitingCount})`;
        synth.playDecisionRequired();
      } else if (data.runningCount > 0) {
        mood = "running";
        bubble.style.display = "none";
      } else {
        mood = "idle";
        bubble.style.display = "none";
      }
      engine.setMood(mood);

      // Render tasks in flyout with safe HTML escaping (C4 XSS fix)
      taskList.innerHTML = (data.tasks || [])
        .map((t: any) => {
          const sec = Math.floor((t.activeDurationMs || 0) / 1000);
          const safeTitle = escapeHtml(t.taskTitle || "Untitled Task");
          const safeState = escapeHtml(t.state || "UNKNOWN");
          return `<div class="task-item">
            <div><b>${safeTitle}</b> [${safeState}]</div>
            <div style="color: #888;">⏱ 已运行: ${sec}s</div>
            ${t.pendingDecision ? `<div style="color: #f59e0b;">⏳ 倒计时中...</div>` : ""}
          </div>`;
        })
        .join("");
    }
  } catch (err) {
    console.error("Failed to parse websocket frame:", err);
  }
};
