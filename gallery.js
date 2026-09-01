// atelier — app gallery & mixer
//
// A pannable, zoomable 3D stage. Every "app" — a built-in piece made
// here before, a pasted artifact's HTML, or an embeddable URL — becomes
// a card floating at some (x, y, depth). Depth is real CSS perspective,
// not a fake scale trick, so pushing a card back or pulling it forward
// reads as actual distance. Cards can overlap and blend (mix-blend-mode)
// and, since built-in apps run live in their own iframe, anything with
// sound just mixes for real when two cards play at once.

(() => {
  const STORAGE_KEY = "atelier-gallery-v1";
  const PERSPECTIVE = 1600;
  const Z_MIN = -900;
  const Z_MAX = 900; // clamped further below PERSPECTIVE so nothing flips

  const BUILTIN_APPS = [
    {
      appId: "kizashi",
      title: "kizashi",
      src: "apps/kizashi/index.html",
      w: 480,
      h: 640,
    },
    {
      appId: "hibana",
      title: "hibana",
      src: "apps/hibana/index.html",
      w: 480,
      h: 640,
    },
    { appId: "random-pitch-sister", title: "Random Pitch Sister", src: "apps/random-pitch-sister/index.html", w: 640, h: 620 },
    { appId: "meguri", title: "meguri 巡", src: "apps/meguri/index.html", w: 560, h: 700 },
    { appId: "fourtrack-looper", title: "Fourtrack Looper", src: "apps/fourtrack-looper/index.html", w: 640, h: 620 },
    { appId: "circuit-chop", title: "CIRCUIT CHOP", src: "apps/circuit-chop/index.html", w: 680, h: 640 },
    { appId: "rhythm-box", title: "リズム箱", src: "apps/rhythm-box/index.html", w: 560, h: 620 },
    { appId: "glitchbox", title: "glitchbox", src: "apps/glitchbox/index.html", w: 560, h: 620 },
    { appId: "himawari", title: "ひまわり", src: "apps/himawari/index.html", w: 480, h: 640 },
    { appId: "genetic-drift", title: "Genetic Drift", src: "apps/genetic-drift/index.html", w: 640, h: 600 },
    { appId: "swerve-sampler", title: "Swerve Sampler", src: "apps/swerve-sampler/index.html", w: 640, h: 620 },
    { appId: "ikimono", title: "ikimono", src: "apps/ikimono/index.html", w: 620, h: 680 },
    { appId: "mic-check", title: "Mic Check", src: "apps/mic-check/index.html", w: 480, h: 560 },
    { appId: "cut-up-machine", title: "CUT-UP MACHINE", src: "apps/cut-up-machine/index.html", w: 560, h: 700 },
    { appId: "grainfield", title: "GrainField", src: "apps/grainfield/index.html", w: 640, h: 600 },
    { appId: "cuedeck", title: "Cuedeck", src: "apps/cuedeck/index.html", w: 620, h: 640 },
    { appId: "senon", title: "線音 SenOn", src: "apps/senon/index.html", w: 480, h: 700 },
    { appId: "autopoiesis", title: "Autopoiesis", src: "apps/autopoiesis/index.html", w: 640, h: 600 },
    { appId: "cutup", title: "cutup", src: "apps/cutup/index.html", w: 560, h: 640 },
    { appId: "dappi", title: "dappi", src: "apps/dappi/index.html", w: 560, h: 640 },
    { appId: "graindeck", title: "GrainDeck", src: "apps/graindeck/index.html", w: 620, h: 560 },
    { appId: "mojihoukai", title: "文字崩壊", src: "apps/mojihoukai/index.html", w: 560, h: 640 },
    { appId: "kirikizami", title: "kirikizami", src: "apps/kirikizami/index.html", w: 560, h: 700 },
  ];

  const stage = document.getElementById("stage");
  const world = document.getElementById("world");

  const addBtn = document.getElementById("addBtn");
  const shuffleBtn = document.getElementById("shuffleBtn");
  const resetViewBtn = document.getElementById("resetViewBtn");

  const modalBackdrop = document.getElementById("modalBackdrop");
  const modalCloseBtn = document.getElementById("modalCloseBtn");
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = Array.from(document.querySelectorAll(".tab-panel"));
  const builtinList = document.getElementById("builtinList");

  const htmlInput = document.getElementById("htmlInput");
  const htmlTitle = document.getElementById("htmlTitle");
  const htmlAddBtn = document.getElementById("htmlAddBtn");

  const urlInput = document.getElementById("urlInput");
  const urlTitle = document.getElementById("urlTitle");
  const urlAddBtn = document.getElementById("urlAddBtn");

  let view = { panX: 0, panY: 0, zoom: 1 };
  let cards = [];
  let nextId = 1;
  let selectedId = null;

  // ---- persistence -----------------------------------------------

  function save() {
    try {
      const serializable = cards.map((c) => ({
        id: c.id,
        title: c.title,
        kind: c.kind,
        src: c.src,
        html: c.html,
        x: c.x, y: c.y, z: c.z,
        w: c.w, h: c.h,
        blend: c.blend,
        opacity: c.opacity,
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ view, cards: serializable, nextId }));
    } catch (e) {
      // storage full or unavailable — the space still works, it just
      // won't remember the arrangement next time
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.cards)) return false;
      view = data.view || view;
      nextId = data.nextId || 1;
      data.cards.forEach((c) => addCard(c, { skipSave: true }));
      return cards.length > 0;
    } catch (e) {
      return false;
    }
  }

  // ---- card lifecycle ----------------------------------------------

  function addCard(spec, opts = {}) {
    const id = spec.id ?? nextId++;
    nextId = Math.max(nextId, id + 1);

    const card = {
      id,
      title: spec.title || "無題",
      kind: spec.kind,
      src: spec.src,
      html: spec.html,
      x: spec.x ?? (Math.random() - 0.5) * 400,
      y: spec.y ?? (Math.random() - 0.5) * 260,
      z: spec.z ?? 0,
      w: spec.w ?? 420,
      h: spec.h ?? 320,
      blend: spec.blend || "normal",
      opacity: spec.opacity ?? 1,
      el: null,
    };

    const el = document.createElement("div");
    el.className = "card";
    el.dataset.id = String(id);

    const header = document.createElement("div");
    header.className = "card-header";
    header.innerHTML = `<span class="card-title"></span>`;
    header.querySelector(".card-title").textContent = card.title;

    const frontBtn = mkHeaderBtn("⤒", "手前へ");
    const backBtn = mkHeaderBtn("⤓", "奥へ");
    const removeBtn = mkHeaderBtn("×", "削除");
    header.append(frontBtn, backBtn, removeBtn);

    const body = document.createElement("div");
    body.className = "card-body";
    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-scripts allow-same-origin allow-forms allow-modals allow-pointer-lock";
    iframe.allow = "autoplay; microphone; camera; clipboard-read; clipboard-write";
    iframe.loading = "lazy";
    if (card.kind === "html") {
      iframe.srcdoc = card.html;
    } else {
      iframe.src = card.src;
    }
    const shade = document.createElement("div");
    shade.className = "card-shade";
    body.append(iframe, shade);

    const controls = document.createElement("div");
    controls.className = "card-controls";
    controls.innerHTML = `
      <span>混ぜ方</span>
      <select class="blendSelect">
        ${["normal", "screen", "multiply", "overlay", "difference", "lighten", "color-dodge"]
          .map((b) => `<option value="${b}">${b}</option>`)
          .join("")}
      </select>
      <span>不透明度</span>
      <input class="opacityRange" type="range" min="0.15" max="1" step="0.05" />
    `;
    const blendSelect = controls.querySelector(".blendSelect");
    const opacityRange = controls.querySelector(".opacityRange");
    blendSelect.value = card.blend;
    opacityRange.value = String(card.opacity);

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "resize-handle";

    el.append(header, body, controls, resizeHandle);
    world.appendChild(el);
    card.el = el;
    cards.push(card);

    applyCardStyle(card);

    // ---- interactions ----
    header.addEventListener("pointerdown", (e) => startDragCard(e, card));
    resizeHandle.addEventListener("pointerdown", (e) => startResizeCard(e, card));
    el.addEventListener("pointerdown", () => selectCard(card.id));

    frontBtn.addEventListener("click", () => { card.z = Math.min(Z_MAX, card.z + 80); applyCardStyle(card); save(); });
    backBtn.addEventListener("click", () => { card.z = Math.max(Z_MIN, card.z - 80); applyCardStyle(card); save(); });
    removeBtn.addEventListener("click", () => removeCard(card.id));

    blendSelect.addEventListener("change", () => { card.blend = blendSelect.value; applyCardStyle(card); save(); });
    opacityRange.addEventListener("input", () => { card.opacity = +opacityRange.value; applyCardStyle(card); save(); });

    // Wheel events don't bubble out of the iframe's own document, so this
    // only ever fires over the chrome (header / controls) — that's fine,
    // the front/back buttons cover depth changes while hovering the app
    // itself.
    el.addEventListener("wheel", (e) => {
      if (e.ctrlKey) return; // let pinch-zoom fall through to the stage
      e.preventDefault();
      e.stopPropagation();
      card.z = clamp(card.z - e.deltaY * 1.2, Z_MIN, Z_MAX);
      applyCardStyle(card);
      save();
    }, { passive: false });

    if (!opts.skipSave) save();
    return card;
  }

  function mkHeaderBtn(label, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    return b;
  }

  function removeCard(id) {
    const idx = cards.findIndex((c) => c.id === id);
    if (idx === -1) return;
    cards[idx].el.remove();
    cards.splice(idx, 1);
    save();
  }

  function selectCard(id) {
    selectedId = id;
    cards.forEach((c) => c.el.classList.toggle("selected", c.id === id));
  }

  function applyCardStyle(card) {
    const el = card.el;
    el.style.width = card.w + "px";
    el.style.height = card.h + "px";
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.transform =
      `translate3d(${card.x - card.w / 2}px, ${card.y - card.h / 2}px, ${card.z}px)`;
    el.style.mixBlendMode = card.blend;
    el.style.opacity = String(card.opacity);

    // extra depth cue: things far back dim and blur slightly, like fog
    const depthT = clamp((card.z - Z_MIN) / (Z_MAX - Z_MIN), 0, 1); // 0 far, 1 near
    const fog = 1 - depthT; // 0 near, 1 far
    const shade = el.querySelector(".card-shade");
    shade.style.background = `rgba(11,13,16,${fog * 0.55})`;
    el.style.filter = `blur(${fog * 2.2}px)`;
    el.style.zIndex = String(1000 + Math.round(card.z));
  }

  // ---- dragging cards (move in the x/y plane) -----------------------

  function startDragCard(e, card) {
    e.preventDefault();
    e.stopPropagation();
    selectCard(card.id);
    const startX = e.clientX, startY = e.clientY;
    const origX = card.x, origY = card.y;

    function onMove(ev) {
      const dx = (ev.clientX - startX) / view.zoom;
      const dy = (ev.clientY - startY) / view.zoom;
      card.x = origX + dx;
      card.y = origY + dy;
      applyCardStyle(card);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      save();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startResizeCard(e, card) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const origW = card.w, origH = card.h;

    function onMove(ev) {
      const dx = (ev.clientX - startX) / view.zoom;
      const dy = (ev.clientY - startY) / view.zoom;
      card.w = Math.max(200, origW + dx);
      card.h = Math.max(140, origH + dy);
      applyCardStyle(card);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      save();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // ---- stage: pan + zoom -------------------------------------------

  function applyViewStyle() {
    world.style.transform =
      `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.target !== stage && e.target.id !== "floor") return;
    stage.classList.add("panning");
    const startX = e.clientX, startY = e.clientY;
    const origPanX = view.panX, origPanY = view.panY;

    function onMove(ev) {
      view.panX = origPanX + (ev.clientX - startX);
      view.panY = origPanY + (ev.clientY - startY);
      applyViewStyle();
    }
    function onUp() {
      stage.classList.remove("panning");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      save();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const worldX = (cx - rect.width / 2 - view.panX) / view.zoom;
    const worldY = (cy - rect.height / 2 - view.panY) / view.zoom;

    const factor = Math.exp(-e.deltaY * 0.0015);
    view.zoom = clamp(view.zoom * factor, 0.25, 2.5);

    view.panX = cx - rect.width / 2 - worldX * view.zoom;
    view.panY = cy - rect.height / 2 - worldY * view.zoom;

    applyViewStyle();
    save();
  }, { passive: false });

  function resetView() {
    view = { panX: 0, panY: 0, zoom: 1 };
    applyViewStyle();
    save();
  }

  // ---- shuffle: instant remix of the arrangement ---------------------

  function shuffle() {
    cards.forEach((c) => {
      c.x = (Math.random() - 0.5) * 700;
      c.y = (Math.random() - 0.5) * 420;
      c.z = Math.round((Math.random() - 0.5) * 2 * 500);
      applyCardStyle(c);
    });
    save();
  }

  // ---- add-item modal -------------------------------------------------

  function openModal() {
    renderBuiltinList();
    modalBackdrop.hidden = false;
  }
  function closeModal() {
    modalBackdrop.hidden = true;
  }

  function renderBuiltinList() {
    builtinList.innerHTML = "";
    BUILTIN_APPS.forEach((app) => {
      const row = document.createElement("div");
      row.className = "builtin-item";
      const label = document.createElement("span");
      label.textContent = app.title;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "追加";
      btn.addEventListener("click", () => {
        addCard({ title: app.title, kind: "app", src: app.src, w: app.w, h: app.h });
        closeModal();
      });
      row.append(label, btn);
      builtinList.appendChild(row);
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panels.forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    });
  });

  htmlAddBtn.addEventListener("click", () => {
    const html = htmlInput.value.trim();
    if (!html) return;
    addCard({ title: htmlTitle.value.trim() || "貼り付けたもの", kind: "html", html });
    htmlInput.value = "";
    htmlTitle.value = "";
    closeModal();
  });

  urlAddBtn.addEventListener("click", () => {
    const url = urlInput.value.trim();
    if (!url) return;
    addCard({ title: urlTitle.value.trim() || url, kind: "url", src: url });
    urlInput.value = "";
    urlTitle.value = "";
    closeModal();
  });

  addBtn.addEventListener("click", openModal);
  modalCloseBtn.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });
  shuffleBtn.addEventListener("click", shuffle);
  resetViewBtn.addEventListener("click", resetView);

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ---- boot -----------------------------------------------------------

  // Any built-in app not already sitting on the canvas (a fresh gallery,
  // or one that predates apps added later) gets seeded into a grid so
  // "everything you've made" is visible without manually adding each one.
  function seedMissingBuiltins() {
    const existingSrcs = new Set(cards.filter((c) => c.kind === "app").map((c) => c.src));
    const missing = BUILTIN_APPS.filter((app) => !existingSrcs.has(app.src));
    if (missing.length === 0) return;

    const cols = Math.ceil(Math.sqrt(BUILTIN_APPS.length));
    const rows = Math.ceil(BUILTIN_APPS.length / cols);
    const spacingX = 600, spacingY = 720;

    missing.forEach((app) => {
      const idx = BUILTIN_APPS.indexOf(app);
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      addCard({
        title: app.title,
        kind: "app",
        src: app.src,
        w: app.w,
        h: app.h,
        x: (col - (cols - 1) / 2) * spacingX,
        y: (row - (rows - 1) / 2) * spacingY,
        z: 0,
      }, { skipSave: true });
    });
    save();
  }

  load();
  seedMissingBuiltins();
  applyViewStyle();
})();
