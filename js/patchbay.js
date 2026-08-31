// The node editor: drag boxes, drag cables between ports, and rebuild the
// actual Web Audio graph to match — this is the "回路をつなぎ合わせる"
// (wire up circuits) part of the app.

import { engine } from "./audioEngine.js";
import { createBox } from "./boxes.js";

const NS = "http://www.w3.org/2000/svg";
const SOURCE_COLORS = ["#58e0c0", "#ff7a59", "#c58cff", "#ffd166"];

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
    this.nodes = new Map(); // id -> { kind:'source'|'master'|'box', el, x, y, box? }
    this.connections = []; // { from, to }
    this._pendingConnect = null;

    this._buildSourcesAndMaster();
    this._bindGlobalMouse();
    window.addEventListener("resize", () => this.redrawCables());
  }

  _buildSourcesAndMaster() {
    this.slots.forEach((slot, i) => {
      const id = `slot${i}`;
      const boxEl = el(`
        <div class="pbox source" style="left:20px; top:${30 + i * 130}px; border-color:${SOURCE_COLORS[i]}55">
          <div class="pbox-head">SLOT ${i + 1}<span></span></div>
          <div class="pbox-body"><span style="font-size:0.6rem;color:var(--ink-dim)">サンプル出力</span></div>
          <div class="port out" data-node="${id}" data-port="out"></div>
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
        <div class="port in" data-node="master" data-port="in"></div>
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

    const boxEl = el(`
      <div class="pbox type-${box.type}" style="left:${x}px; top:${y}px;">
        <div class="pbox-head">${box.title}<span class="remove" title="削除">✕</span></div>
        <div class="pbox-body">${paramsHtml}</div>
        <div class="port in" data-node="${box.id}" data-port="in"></div>
        <div class="port out" data-node="${box.id}" data-port="out"></div>
      </div>
    `);

    box.paramDefs.forEach((d) => {
      const input = boxEl.querySelector(`[data-key="${d.key}"]`);
      const showEl = boxEl.querySelector(`[data-show="${d.key}"]`);
      input.addEventListener("input", () => {
        const v = d.type === "select" ? input.value : +input.value;
        box.setParam(d.key, v);
        if (showEl) showEl.textContent = d.format ? d.format(v) : v;
      });
    });

    boxEl.querySelector(".remove").addEventListener("click", () => this.removeBox(box.id));

    this.canvasEl.appendChild(boxEl);
    this.nodes.set(box.id, { kind: "box", el: boxEl, box, input: box.input, output: box.output });
    this._bindBoxDrag([boxEl]);
    this._bindPorts();
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
  }

  connect(from, to) {
    if (from === to) return;
    const fromNode = this.nodes.get(from);
    const toNode = this.nodes.get(to);
    if (!fromNode || !toNode) return;
    if (toNode.kind === "source") return; // sources have no input
    if (fromNode.kind === "master") return; // master has no output
    const exists = this.connections.some((c) => c.from === from && c.to === to);
    if (exists) return;
    this.connections.push({ from, to });
    this.rebuildAudioGraph();
    this.redrawCables();
  }

  disconnectPair(from, to) {
    this.connections = this.connections.filter((c) => !(c.from === from && c.to === to));
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
  }

  rebuildAudioGraph() {
    this.nodes.forEach((n) => {
      if (n.output) { try { n.output.disconnect(); } catch (e) {} }
    });
    this.connections.forEach(({ from, to }) => {
      const fromNode = this.nodes.get(from);
      const toNode = this.nodes.get(to);
      if (!fromNode || !toNode) return;
      try { fromNode.output.connect(toNode.input); } catch (e) {}
    });
  }

  _bindBoxDrag(elements) {
    elements.forEach((boxEl) => {
      const head = boxEl.querySelector(".pbox-head");
      head.addEventListener("mousedown", (e) => {
        if (e.target.classList.contains("remove")) return;
        e.preventDefault();
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
    this.canvasEl.querySelectorAll(".port.out").forEach((portEl) => {
      if (portEl.dataset.bound) return;
      portEl.dataset.bound = "1";
      portEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._pendingConnect = { from: portEl.dataset.node, portEl };
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
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (target && target.classList.contains("port") && target.classList.contains("in")) {
        this.connect(this._pendingConnect.from, target.dataset.node);
      }
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
    this.connections.forEach((conn, i) => {
      const fromNode = this.nodes.get(conn.from);
      const toNode = this.nodes.get(conn.to);
      if (!fromNode || !toNode) return;
      const outPort = fromNode.el.querySelector('.port.out');
      const inPort = toNode.el.querySelector('.port.in');
      if (!outPort || !inPort) return;
      const p1 = this._portCenter(outPort);
      const p2 = this._portCenter(inPort);
      const path = document.createElementNS(NS, "path");
      path.setAttribute("class", "cable");
      path.setAttribute("d", this._bezier(p1.x, p1.y, p2.x, p2.y));
      path.setAttribute("stroke", fromNode.kind === "source" ? (SOURCE_COLORS[Number(conn.from.replace("slot", ""))] || "#58e0c0") : "#8a92a3");
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
      g.addEventListener("click", () => this.disconnectPair(conn.from, conn.to));
      this.svgEl.appendChild(g);
    });
  }
}
