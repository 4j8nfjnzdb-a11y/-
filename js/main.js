import { engine, initAudioEngine, resumeEngine, readMeterLevel } from "./audioEngine.js";
import { SampleSlot } from "./sampleSlot.js";
import { PatchBay } from "./patchbay.js";

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

  function uiLoop() {
    slots.forEach((s) => s.updatePlayhead());
    const level = readMeterLevel();
    meterBar.style.width = `${Math.min(100, level * 260)}%`;
    requestAnimationFrame(uiLoop);
  }
  requestAnimationFrame(uiLoop);
}

boot();
