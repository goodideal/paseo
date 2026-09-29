"use strict";
(() => {
  // plugins/desktop-pet/companion-desktop/src/animation-engine.ts
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

  // plugins/desktop-pet/companion-desktop/src/sound-synthesizer.ts
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

  // plugins/desktop-pet/companion-desktop/src/companion-client.ts
  var canvas = document.getElementById("pet-canvas");
  var bubble = document.getElementById("bubble");
  var flyout = document.getElementById("flyout");
  var taskList = document.getElementById("task-list");
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
  var ws = new WebSocket(`ws://${wsHost}:${wsPort}`);
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "state_update") {
        let mood = "idle";
        if (data.waitingCount > 0) {
          mood = "waiting";
          bubble.style.display = "block";
          bubble.innerText = `\u26A0\uFE0F \u7B49\u5F85\u51B3\u7B56 (${data.waitingCount})`;
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
            const sec = Math.floor((t.activeDurationMs || 0) / 1e3);
            const safeTitle = escapeHtml(t.taskTitle || "Untitled Task");
            const safeState = escapeHtml(t.state || "UNKNOWN");
            return `<div class="task-item">
            <div><b>${safeTitle}</b> [${safeState}]</div>
            <div style="color: #888;">\u23F1 \u5DF2\u8FD0\u884C: ${sec}s</div>
            ${t.pendingDecision ? `<div style="color: #f59e0b;">\u23F3 \u5012\u8BA1\u65F6\u4E2D...</div>` : ""}
          </div>`;
          })
          .join("");
      }
    } catch (err) {
      console.error("Failed to parse websocket frame:", err);
    }
  };
})();
