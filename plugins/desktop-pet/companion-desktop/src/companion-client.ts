import { AnimationEngine, type PetMood } from "./animation-engine.js";
import { SoundSynthesizer } from "./sound-synthesizer.js";

const canvas = document.getElementById("pet-canvas") as HTMLCanvasElement;
const bubble = document.getElementById("bubble") as HTMLDivElement;
const flyout = document.getElementById("flyout") as HTMLDivElement;
const taskList = document.getElementById("task-list") as HTMLDivElement;

const engine = new AnimationEngine(canvas);
const synth = new SoundSynthesizer();

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

// Connect to companion WebSocket server
const ws = new WebSocket("ws://127.0.0.1:6768"); // Default or discovered port
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

      // Render tasks in flyout
      taskList.innerHTML = (data.tasks || [])
        .map((t: any) => {
          const sec = Math.floor(t.activeDurationMs / 1000);
          return `<div class="task-item">
            <div><b>${t.taskTitle}</b> [${t.state}]</div>
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
