import { engine, initAudioEngine, resumeEngine, readMeterLevel } from "./audioEngine.js";
import { SampleSlot } from "./sampleSlot.js";
import { PatchBay } from "./patchbay.js";
import { recorderAvailable, isRecording, startRecording, stopRecording } from "./recorder.js";

const LOOKAHEAD = 0.15;

async function boot() {
  await initAudioEngine();

  const slotsContainer = document.getElementById("slots");
  const slots = [0, 1, 2, 3].map((i) => new SampleSlot(i));
  slots.forEach((s) => slotsContainer.appendChild(s.rootEl));
  await Promise.all(slots.map((s, i) => s.loadDefault(i)));

  const patchCanvas = document.getElementById("patchCanvas");
  const cableLayer = document.getElementById("cableLayer");
  const patchBay = new PatchBay(patchCanvas, cableLayer, slots);
  patchBay.resetDefaultPatch();

  let addCascade = 0;
  document.querySelectorAll(".addButtons button[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.add;
      const x = 480 + (addCascade % 4) * 220;
      const y = 60 + Math.floor(addCascade / 4) * 260;
      addCascade++;
      patchBay.addBox(type, x, y);
      patchBay.redrawCables();
    });
  });
  document.getElementById("clearPatchBtn").addEventListener("click", () => {
    patchBay.resetDefaultPatch();
  });
  document.getElementById("randomPatchBtn").addEventListener("click", () => {
    patchBay.randomizePatch();
  });

  // 暴走モード — every tick, grab a random handful of every range-type
  // knob on screen (slot faders + box params) and jump it to a new random
  // value by dispatching a real "input" event, so it flows through each
  // control's own existing update logic instead of duplicating it here.
  const chaosBtn = document.getElementById("chaosBtn");
  let chaosTimer = null;
  function chaosTick() {
    const pool = Array.from(document.querySelectorAll(".slot input[type=range], .pbox .pbox-body input[type=range]"));
    if (!pool.length) return;
    const n = Math.min(pool.length, 1 + Math.floor(Math.random() * 4));
    pool.sort(() => Math.random() - 0.5).slice(0, n).forEach((input) => {
      const min = parseFloat(input.min), max = parseFloat(input.max);
      const step = parseFloat(input.step) || 0.01;
      const raw = min + Math.random() * (max - min);
      input.value = Math.round(raw / step) * step;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  chaosBtn.addEventListener("click", () => {
    if (chaosTimer) {
      clearInterval(chaosTimer);
      chaosTimer = null;
      chaosBtn.classList.remove("active");
      chaosBtn.textContent = "🌀 暴走モード";
    } else {
      chaosTimer = setInterval(chaosTick, 450);
      chaosBtn.classList.add("active");
      chaosBtn.textContent = "⏹ 暴走停止";
    }
  });

  const playBtn = document.getElementById("playBtn");
  const bpmInput = document.getElementById("bpm");
  const masterVol = document.getElementById("masterVol");
  const meterBar = document.getElementById("meterBar");

  bpmInput.addEventListener("change", () => {
    engine.bpm = Math.max(40, Math.min(220, +bpmInput.value || 120));
    patchBay.nodes.forEach((n) => {
      if (n.kind !== "box") return;
      const hasDivision = n.box.paramDefs.some((d) => d.key === "division");
      if (hasDivision) n.box.setParam("division", n.box.getParam("division"));
    });
  });

  masterVol.addEventListener("input", () => {
    engine.master.gain.setTargetAtTime(+masterVol.value, engine.ctx.currentTime, 0.01);
  });

  let schedulerTimer = null;
  function schedulerLoop() {
    if (!engine.running) return;
    const now = engine.ctx.currentTime;
    slots.forEach((s) => s.transportTick(now, LOOKAHEAD));
    patchBay.nodes.forEach((n) => {
      if (n.kind === "box" && typeof n.box.tick === "function") n.box.tick(now, LOOKAHEAD);
    });
    schedulerTimer = setTimeout(schedulerLoop, 30);
  }

  async function start() {
    await resumeEngine();
    engine.running = true;
    slots.forEach((s) => s.onTransportStart());
    patchBay.nodes.forEach((n) => {
      if (n.kind === "box" && typeof n.box.onTransportStart === "function") n.box.onTransportStart();
    });
    schedulerLoop();
    playBtn.textContent = "■ 停止";
    playBtn.classList.add("playing");
  }

  function stop() {
    engine.running = false;
    clearTimeout(schedulerTimer);
    slots.forEach((s) => s.onTransportStop());
    playBtn.textContent = "▶ 再生";
    playBtn.classList.remove("playing");
  }

  playBtn.addEventListener("click", () => {
    if (engine.running) stop(); else start();
  });

  const recBtn = document.getElementById("recBtn");
  if (!recorderAvailable()) {
    recBtn.disabled = true;
    recBtn.title = "録音機能が利用できません（AudioWorklet 非対応）";
  }
  recBtn.addEventListener("click", async () => {
    if (isRecording()) {
      const result = stopRecording();
      recBtn.textContent = "● REC";
      recBtn.classList.remove("recording");
      if (result) {
        const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
        downloadBlob(result.blob, `circuit-chop-${ts}.wav`);
      }
    } else {
      await resumeEngine();
      if (startRecording()) {
        recBtn.textContent = "⏹ 停止";
        recBtn.classList.add("recording");
      }
    }
  });

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function uiLoop() {
    slots.forEach((s) => s.updatePlayhead());
    const level = readMeterLevel();
    meterBar.style.width = `${Math.min(100, level * 260)}%`;
    requestAnimationFrame(uiLoop);
  }
  requestAnimationFrame(uiLoop);
}

boot();
