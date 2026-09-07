// The node editor: drag boxes, drag cables between ports, and rebuild the
// actual Web Audio graph to match — this is the "回路をつなぎ合わせる"
// (wire up circuits) part of the app.
//
// Two kinds of cable exist. Audio cables (solid) carry sound and are wired
// straight into the Web Audio graph. Mod cables (dashed, magenta) carry no
// audio at all — they tell a MOD box's drifting/wandering value to steer
// one parameter on a target box, blended against whatever the user has that
// slider set to. That's the self-modulating, "artificial life" layer: once
// patched, a box's own knob quietly wanders on its own.

import { engine } from "./audioEngine.js";
import { createBox } from "./boxes.js";

const NS = "http://www.w3.org/2000/svg";
const SOURCE_COLORS = ["#58e0c0", "#ff7a59", "#c58cff", "#ffd166"];
const MOD_COLOR = "#f042ff";

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export class PatchBay {
  constructor(canvasEl, svgEl, slots) {
    this.canvasEl = canvasEl;
    this.svgEl = svgEl;
    this.slots = slots;
    this.nodes = new Map(); // id -> { kind:'source'|'master'|'box', el, output?, input?, box? }
    this.connections = []; // { from, to, role: 'audio'|'mod' }
    this._pendingConnect = null;

    this._topZ = 10;

    this._buildSourcesAndMaster();
    this._bindGlobalMouse();
    window.addEventListener("resize", () => this.redrawCables());
    this._modTimer = setInterval(() => this._modTick(), 60);
  }

  _buildSourcesAndMaster() {
    this.slots.forEach((slot, i) => {
      const id = `slot${i}`;
      const boxEl = el(`
        <div class="pbox source" style="left:20px; top:${30 + i * 130}px; border-color:${SOURCE_COLORS[i]}55">
          <div class="pbox-head">SLOT ${i + 1}<span></span></div>
          <div class="pbox-body"><span style="font-size:0.6rem;color:var(--ink-dim)">サンプル出力</span></div>
          <div class="port out" data-role="audio" data-node="${id}" data-port="out"></div>
        </div>
      `);
      this.canvasEl.appendChild(boxEl);
      this.nodes.set(id, { kind: "source", el: boxEl, output: slot.outputBus });
    });

    const masterInput = engine.ctx.createGain();
    masterInput.connect(engine.master);
    const masterEl = el(`
      <div class="pbox master" style="left:1220px; top:280px;">
        <div class="pbox-head">MASTER OUT<span></span></div>
        <div class="pbox-body"><span style="font-size:0.6rem;color:var(--ink-dim)">最終出力</span></div>
        <div class="port in" data-role="audio" data-node="master" data-port="in"></div>
      </div>
    `);
    this.canvasEl.appendChild(masterEl);
    this.nodes.set("master", { kind: "master", el: masterEl, input: masterInput });

    this._bindBoxDrag(document.querySelectorAll(".pbox"));
    this._bindPorts();
  }

  addBox(type, x, y) {
    const box = createBox(type);
    const paramsHtml = box.paramDefs.map((d) => {
      const val = box.getParam(d.key);
      if (d.type === "select") {
        return `
          <label class="param">${d.label}
            <select data-key="${d.key}">
              ${d.options.map((o) => `<option value="${o}" ${o === val ? "selected" : ""}>${o}</option>`).join("")}
            </select>
          </label>`;
      }
      const fmt = d.format ? d.format(val) : val;
      return `
        <label class="param">${d.label} <span class="valnum" data-show="${d.key}">${fmt}</span>
          <input type="range" data-key="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${val}" />
        </label>`;
    }).join("");

    const audioPorts = box.isModSource
      ? ""
      : `<div class="port in" data-role="audio" data-node="${box.id}" data-port="in"></div>
         <div class="port out" data-role="audio" data-node="${box.id}" data-port="out"></div>`;
    const modPort = box.isModSource
      ? `<div class="port modout" data-role="mod" data-node="${box.id}" data-port="out"></div>`
      : box.modTargetKey
        ? `<div class="port modin" data-role="mod" data-node="${box.id}" data-port="in"></div>`
        : "";

    const boxEl = el(`
      <div class="pbox type-${box.type}" style="left:${x}px; top:${y}px;">
        <div class="pbox-head"><span class="pbox-title">${box.title}</span><span class="remove" title="削除">✕</span></div>
        <div class="pbox-body">${paramsHtml}</div>
        ${audioPorts}
        ${modPort}
      </div>
    `);

    box._userBase = {};
    box.paramDefs.forEach((d) => { box._userBase[d.key] = box.getParam(d.key); });

    box.paramDefs.forEach((d) => {
      const input = boxEl.querySelector(`[data-key="${d.key}"]`);
      const showEl = boxEl.querySelector(`[data-show="${d.key}"]`);
      input.addEventListener("input", () => {
        const v = d.type === "select" ? input.value : +input.value;
        box.setParam(d.key, v);
        box._userBase[d.key] = v;
        if (showEl) showEl.textContent = d.format ? d.format(v) : v;
      });
    });

    boxEl.querySelector(".remove").addEventListener("click", () => this.removeBox(box.id));

    this.canvasEl.appendChild(boxEl);
    this.nodes.set(box.id, { kind: "box", el: boxEl, box, input: box.input, output: box.output });
    this._bindBoxDrag([boxEl]);
    this._bindPorts();
    this._relabelBoxes();
    return box.id;
  }

  removeBox(id) {
    const node = this.nodes.get(id);
    if (!node || node.kind !== "box") return;
    node.box.dispose();
    node.el.remove();
    this.nodes.delete(id);
    this.connections = this.connections.filter((c) => c.from !== id && c.to !== id);
    this.rebuildAudioGraph();
    this.redrawCables();
    this._relabelBoxes();
  }

  // Same-type boxes (e.g. two GLITCHes) are otherwise indistinguishable —
  // number them "GLITCH 1" / "GLITCH 2" in creation order the moment a
  // second one of a type exists, and drop the number if only one remains.
  _relabelBoxes() {
    const groups = new Map();
    this.nodes.forEach((n) => {
      if (n.kind !== "box") return;
      const t = n.box.type;
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(n);
    });
    groups.forEach((list) => {
      list.forEach((n, i) => {
        const label = list.length > 1 ? `${n.box.title} ${i + 1}` : n.box.title;
        const titleEl = n.el.querySelector(".pbox-title");
        if (titleEl) titleEl.textContent = label;
      });
    });
  }

  connect(from, to, role = "audio") {
    if (from === to) return;
    const fromNode = this.nodes.get(from);
    const toNode = this.nodes.get(to);
    if (!fromNode || !toNode) return;

    if (role === "mod") {
      if (!fromNode.box || !fromNode.box.isModSource) return;
      if (!toNode.box || !toNode.box.modTargetKey) return;
      // one mod source per target — a fresh connection replaces the old one
      this.connections = this.connections.filter((c) => !(c.role === "mod" && c.to === to));
    } else {
      if (toNode.kind === "source") return; // sources have no input
      if (fromNode.kind === "master") return; // master has no output
      if (fromNode.box && fromNode.box.isModSource) return; // mod boxes carry no audio
    }

    const exists = this.connections.some((c) => c.from === from && c.to === to && (c.role || "audio") === role);
    if (exists) return;
    this.connections.push({ from, to, role });
    this.rebuildAudioGraph();
    this.redrawCables();
  }

  disconnectPair(from, to, role = "audio") {
    this.connections = this.connections.filter((c) => !(c.from === from && c.to === to && (c.role || "audio") === role));
    this.rebuildAudioGraph();
    this.redrawCables();
  }

  clearConnections() {
    this.connections = [];
    this.rebuildAudioGraph();
    this.redrawCables();
  }

  resetDefaultPatch() {
    // remove all user-added boxes
    [...this.nodes.entries()].forEach(([id, n]) => { if (n.kind === "box") this.removeBox(id); });
    this.connections = [];
    const glitchId = this.addBox("glitch", 260, 40);
    this.connect("slot0", glitchId);
    this.connect(glitchId, "master");
    this.connect("slot1", "master");
    this.connect("slot2", "master");
    this.connect("slot3", "master");

    // a slow drifting MOD source wired into the glitch box's probability —
    // the patch quietly evolves on its own from the moment it exists
    const modId = this.addBox("mod", 260, 460);
    this.connect(modId, glitchId, "mod");
  }

  // 配線ガチャ — reshuffles the whole patch: each slot gets a random
  // (possibly empty) chain of 0-2 effect boxes before master, and every
  // MOD box has a chance of driving a random target. The number of
  // connections and the shape of the routing differs on every press, but
  // a live path to master is always guaranteed.
  randomizePatch() {
    const boxEntries = [...this.nodes.entries()].filter(([, n]) => n.kind === "box" && !n.box.isModSource);
    const modEntries = [...this.nodes.entries()].filter(([, n]) => n.kind === "box" && n.box.isModSource);
    const boxIds = boxEntries.map(([id]) => id);
    const slotIds = this.slots.map((_, i) => `slot${i}`);
    const shuffledSlots = [...slotIds].sort(() => Math.random() - 0.5);

    const newConnections = [];
    let reachesMaster = false;

    shuffledSlots.forEach((sid) => {
      if (shuffledSlots.length > 1 && Math.random() < 0.15) return; // sometimes leave a slot silent
      const chainLen = boxIds.length ? Math.floor(Math.random() * Math.min(3, boxIds.length + 1)) : 0;
      const chain = [...boxIds].sort(() => Math.random() - 0.5).slice(0, chainLen);
      let prev = sid;
      chain.forEach((bid) => {
        newConnections.push({ from: prev, to: bid, role: "audio" });
        prev = bid;
      });
      newConnections.push({ from: prev, to: "master", role: "audio" });
      reachesMaster = true;
    });

    if (!reachesMaster) {
      newConnections.push({ from: shuffledSlots[0], to: "master", role: "audio" });
    }

    modEntries.forEach(([mid]) => {
      const targetable = boxIds.filter((id) => this.nodes.get(id).box.modTargetKey);
      if (!targetable.length || Math.random() < 0.25) return; // some MOD boxes stay unpatched
      const targetId = targetable[Math.floor(Math.random() * targetable.length)];
      newConnections.push({ from: mid, to: targetId, role: "mod" });
    });

    this.connections = newConnections;
    this.rebuildAudioGraph();
    this.redrawCables();
  }

  rebuildAudioGraph() {
    this.nodes.forEach((n) => {
      if (n.output) { try { n.output.disconnect(); } catch (e) {} }
    });
    this.connections.forEach(({ from, to, role }) => {
      if ((role || "audio") !== "audio") return;
      const fromNode = this.nodes.get(from);
      const toNode = this.nodes.get(to);
      if (!fromNode || !toNode) return;
      try { fromNode.output.connect(toNode.input); } catch (e) {}
    });
  }

  _modTick() {
    if (!engine.ctx) return;
    const t = engine.ctx.currentTime;
    this.connections.forEach((conn) => {
      if ((conn.role || "audio") !== "mod") return;
      const src = this.nodes.get(conn.from);
      const tgt = this.nodes.get(conn.to);
      if (!src || !tgt || src.kind !== "box" || tgt.kind !== "box") return;
      const key = tgt.box.modTargetKey;
      const def = tgt.box.paramDefs.find((d) => d.key === key);
      if (!def) return;

      const raw = src.box.getValue(t);
      const depth = src.box.getParam("depth");
      const base = tgt.box._userBase && tgt.box._userBase[key] !== undefined ? tgt.box._userBase[key] : tgt.box.getParam(key);
      const modded = def.min + raw * (def.max - def.min);
      const value = base * (1 - depth) + modded * depth;
      tgt.box.setParam(key, value);

      const input = tgt.el.querySelector(`[data-key="${key}"]`);
      const showEl = tgt.el.querySelector(`[data-show="${key}"]`);
      if (input) input.value = value;
      if (showEl) showEl.textContent = def.format ? def.format(value) : value;
    });
  }

  _updateModVisuals() {
    const moddedTargets = new Set(this.connections.filter((c) => (c.role || "audio") === "mod").map((c) => c.to));
    this.nodes.forEach((n, id) => {
      if (n.kind !== "box" || !n.box.modTargetKey) return;
      const label = n.el.querySelector(`[data-key="${n.box.modTargetKey}"]`)?.closest(".param");
      if (label) label.classList.toggle("modulating", moddedTargets.has(id));
    });
  }

  _bindBoxDrag(elements) {
    elements.forEach((boxEl) => {
      const head = boxEl.querySelector(".pbox-head");
      head.addEventListener("mousedown", (e) => {
        if (e.target.classList.contains("remove")) return;
        e.preventDefault();
        boxEl.style.zIndex = ++this._topZ;
        const startX = e.clientX, startY = e.clientY;
        const origLeft = parseFloat(boxEl.style.left) || 0;
        const origTop = parseFloat(boxEl.style.top) || 0;
        const onMove = (ev) => {
          boxEl.style.left = `${Math.max(0, origLeft + (ev.clientX - startX))}px`;
          boxEl.style.top = `${Math.max(0, origTop + (ev.clientY - startY))}px`;
          this.redrawCables();
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
    });
  }

  _bindPorts() {
    this.canvasEl.querySelectorAll(".port.out, .port.modout").forEach((portEl) => {
      if (portEl.dataset.bound) return;
      portEl.dataset.bound = "1";
      portEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ownerBox = portEl.closest(".pbox");
        if (ownerBox) ownerBox.style.zIndex = ++this._topZ;
        this._pendingConnect = { from: portEl.dataset.node, role: portEl.dataset.role || "audio", portEl };
        this._dragPath = document.createElementNS(NS, "path");
        this._dragPath.setAttribute("class", "cable-drag");
        this.svgEl.appendChild(this._dragPath);
      });
    });
  }

  _bindGlobalMouse() {
    this.canvasEl.addEventListener("mousemove", (e) => {
      if (!this._pendingConnect) return;
      const rect = this.canvasEl.getBoundingClientRect();
      const p1 = this._portCenter(this._pendingConnect.portEl);
      const x2 = e.clientX - rect.left, y2 = e.clientY - rect.top;
      this._dragPath.setAttribute("d", this._bezier(p1.x, p1.y, x2, y2));
    });

    window.addEventListener("mouseup", (e) => {
      if (!this._pendingConnect) return;
      const role = this._pendingConnect.role;
      const wantsClass = role === "mod" ? "modin" : "in";
      const target = document.elementFromPoint(e.clientX, e.clientY);
      let targetNode = (target && target.classList.contains("port") && target.classList.contains(wantsClass))
        ? target.dataset.node
        : null;

      if (!targetNode) {
        // Ports are small and can end up visually under another box while
        // dragging — fall back to whichever matching port is nearest the
        // drop point, so a slightly-off drop still connects.
        const selector = role === "mod" ? ".port.modin" : ".port.in";
        let bestDist = 26;
        this.canvasEl.querySelectorAll(selector).forEach((p) => {
          const r = p.getBoundingClientRect();
          const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
          if (d < bestDist) { bestDist = d; targetNode = p.dataset.node; }
        });
      }

      if (targetNode) this.connect(this._pendingConnect.from, targetNode, role);
      if (this._dragPath) this._dragPath.remove();
      this._dragPath = null;
      this._pendingConnect = null;
    });
  }

  _portCenter(portEl) {
    const rect = portEl.getBoundingClientRect();
    const canvasRect = this.canvasEl.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - canvasRect.left, y: rect.top + rect.height / 2 - canvasRect.top };
  }

  _bezier(x1, y1, x2, y2) {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  redrawCables() {
    while (this.svgEl.firstChild) this.svgEl.removeChild(this.svgEl.firstChild);
    this.connections.forEach((conn) => {
      const isMod = (conn.role || "audio") === "mod";
      const fromNode = this.nodes.get(conn.from);
      const toNode = this.nodes.get(conn.to);
      if (!fromNode || !toNode) return;
      const outPort = fromNode.el.querySelector(isMod ? ".port.modout" : ".port.out");
      const inPort = toNode.el.querySelector(isMod ? ".port.modin" : ".port.in");
      if (!outPort || !inPort) return;
      const p1 = this._portCenter(outPort);
      const p2 = this._portCenter(inPort);
      const path = document.createElementNS(NS, "path");
      path.setAttribute("class", isMod ? "cable cable-mod" : "cable");
      path.setAttribute("d", this._bezier(p1.x, p1.y, p2.x, p2.y));
      path.setAttribute("stroke", isMod ? MOD_COLOR : (fromNode.kind === "source" ? SOURCE_COLORS[Number(conn.from.replace("slot", ""))] || "#58e0c0" : "#8a92a3"));
      this.svgEl.appendChild(path);

      const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "cableDelete");
      g.setAttribute("transform", `translate(${midX},${midY})`);
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("r", "8");
      const t = document.createElementNS(NS, "text");
      t.textContent = "×";
      g.appendChild(c); g.appendChild(t);
      g.addEventListener("mousedown", (e) => e.stopPropagation());
      g.addEventListener("click", () => this.disconnectPair(conn.from, conn.to, conn.role || "audio"));
      this.svgEl.appendChild(g);
    });
    this._updateModVisuals();
  }
}
