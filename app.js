// CUT-UP MACHINE
//
// A generative text tool in the tradition of William Burroughs and
// Brion Gysin's cut-up technique: take one or more source texts, slice
// them into fragments (characters / words / lines / sentences), and
// reassemble the fragments in a new order. "Fold-in" mode interleaves
// fragments from multiple sources instead of shuffling a single one.
//
// The amount of reordering is a first-class control (0 = original
// order, 100 = full shuffle) rather than fixed, so the effect can be
// tuned from a light rearrangement to total noise.

(() => {
  const sourcesEl = document.getElementById("sources");
  const addSourceBtn = document.getElementById("addSourceBtn");
  const presetsEl = document.getElementById("presets");
  const unitEl = document.getElementById("unit");
  const outputCountEl = document.getElementById("outputCount");
  const chunkMinEl = document.getElementById("chunkMin");
  const chunkMaxEl = document.getElementById("chunkMax");
  const chunkMinVal = document.getElementById("chunkMinVal");
  const chunkMaxVal = document.getElementById("chunkMaxVal");
  const randomnessEl = document.getElementById("randomness");
  const randomnessVal = document.getElementById("randomnessVal");
  const foldInEl = document.getElementById("foldIn");
  const keepPunctEl = document.getElementById("keepPunct");
  const capRandomEl = document.getElementById("capRandom");
  const cutBtn = document.getElementById("cutBtn");
  const resultsEl = document.getElementById("results");

  const PLACEHOLDERS = [
    "ここにテクストを貼り付けてください（複数行OK・目安30行程度）。",
    "2つ目の素材。ここに別のテクストを入れると、フォールドインで最初の素材と織り交ぜられます。",
    "3つ目の素材。",
  ];

  const PRESETS = {
    light:  { unit: "sentence", min: 1, max: 2, randomness: 20 },
    medium: { unit: "word", min: 2, max: 5, randomness: 50 },
    heavy:  { unit: "word", min: 1, max: 3, randomness: 80 },
    chaos:  { unit: "char", min: 1, max: 6, randomness: 100 },
  };

  let sourceSeq = 0;

  // ---- source blocks --------------------------------------------------

  function addSourceBlock(prefill) {
    const id = ++sourceSeq;
    const block = document.createElement("div");
    block.className = "source-block";
    block.dataset.id = id;
    block.style.setProperty("--tilt", `${(Math.random() * 1.4 - 0.7).toFixed(2)}deg`);

    const idx = sourcesEl.children.length;
    block.innerHTML = `
      <div class="source-head">
        <span>素材 ${idx + 1}</span>
        <button class="removeSourceBtn" type="button">取り除く</button>
      </div>
      <textarea placeholder="${PLACEHOLDERS[idx] || "追加の素材テクスト。"}"></textarea>
    `;

    if (prefill) block.querySelector("textarea").value = prefill;

    block.querySelector(".removeSourceBtn").addEventListener("click", () => {
      if (sourcesEl.children.length <= 1) return;
      block.remove();
      renumberSources();
    });

    sourcesEl.appendChild(block);
    updateRemoveVisibility();
  }

  function renumberSources() {
    [...sourcesEl.children].forEach((block, i) => {
      block.querySelector(".source-head span").textContent = `素材 ${i + 1}`;
    });
    updateRemoveVisibility();
  }

  function updateRemoveVisibility() {
    const only = sourcesEl.children.length <= 1;
    sourcesEl.querySelectorAll(".removeSourceBtn").forEach((btn) => {
      btn.style.visibility = only ? "hidden" : "visible";
    });
  }

  addSourceBtn.addEventListener("click", () => {
    if (sourcesEl.children.length >= 4) return;
    addSourceBlock();
  });

  addSourceBlock();

  // ---- presets & control wiring ----------------------------------------

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    unitEl.value = p.unit;
    chunkMinEl.value = p.min;
    chunkMaxEl.value = p.max;
    randomnessEl.value = p.randomness;
    syncLabels();
    [...presetsEl.children].forEach((b) => b.classList.toggle("active", b.dataset.preset === name));
  }

  presetsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".presetBtn");
    if (!btn) return;
    applyPreset(btn.dataset.preset);
  });

  [unitEl, chunkMinEl, chunkMaxEl, randomnessEl, foldInEl, keepPunctEl, capRandomEl].forEach((el) => {
    el.addEventListener("input", () => {
      [...presetsEl.children].forEach((b) => b.classList.remove("active"));
    });
  });

  chunkMinEl.addEventListener("input", () => {
    if (+chunkMinEl.value > +chunkMaxEl.value) chunkMaxEl.value = chunkMinEl.value;
    syncLabels();
  });
  chunkMaxEl.addEventListener("input", () => {
    if (+chunkMaxEl.value < +chunkMinEl.value) chunkMinEl.value = chunkMaxEl.value;
    syncLabels();
  });
  randomnessEl.addEventListener("input", syncLabels);

  function syncLabels() {
    chunkMinVal.textContent = chunkMinEl.value;
    chunkMaxVal.textContent = chunkMaxEl.value;
    randomnessVal.textContent = randomnessEl.value;
  }
  syncLabels();
  applyPreset("medium");

  // ---- tokenizers --------------------------------------------------------

  function splitWords(text) {
    return text.split(/\s+/).filter((t) => t.length > 0);
  }

  function splitLines(text) {
    return text.split(/\r?\n/).filter((t) => t.trim().length > 0);
  }

  function splitSentences(text) {
    const matches = text.match(/[^。！？.!?]+[。！？.!?]*/g) || [];
    return matches.map((s) => s.trim()).filter((s) => s.length > 0);
  }

  function groupTokens(tokens, min, max, joinStr) {
    const chunks = [];
    let i = 0;
    while (i < tokens.length) {
      const size = min === max ? min : min + Math.floor(Math.random() * (max - min + 1));
      chunks.push(tokens.slice(i, i + size).join(joinStr));
      i += size;
    }
    return chunks;
  }

  function tokenizeChars(text, min, max) {
    const chars = [...text].filter((c) => c.length > 0);
    const chunks = [];
    let i = 0;
    while (i < chars.length) {
      const size = min === max ? min : min + Math.floor(Math.random() * (max - min + 1));
      chunks.push(chars.slice(i, i + size).join(""));
      i += size;
    }
    return chunks.filter((c) => c.trim().length > 0);
  }

  function tokenize(text, unit, min, max) {
    switch (unit) {
      case "char": return tokenizeChars(text, min, max);
      case "line": return groupTokens(splitLines(text), min, max, "\n");
      case "sentence": return groupTokens(splitSentences(text), min, max, " ");
      case "word":
      default: return groupTokens(splitWords(text), min, max, " ");
    }
  }

  // ---- reordering ---------------------------------------------------------

  function applyShuffle(arr, randomness) {
    const copy = arr.slice();
    const n = copy.length;
    if (randomness <= 0 || n < 2) return copy;
    if (randomness >= 95) {
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    }
    const swaps = Math.round(n * (randomness / 100) * 1.3);
    for (let i = 0; i < swaps; i++) {
      const a = Math.floor(Math.random() * n);
      const b = Math.floor(Math.random() * n);
      [copy[a], copy[b]] = [copy[b], copy[a]];
    }
    return copy;
  }

  function foldInMerge(chunkArrays) {
    const pools = chunkArrays.map((a) => a.slice());
    const result = [];
    while (pools.some((p) => p.length)) {
      const nonEmpty = pools.map((p, i) => i).filter((i) => pools[i].length > 0);
      const pick = nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
      const takeCount = Math.min(pools[pick].length, Math.random() < 0.35 ? 2 : 1);
      for (let k = 0; k < takeCount; k++) result.push(pools[pick].shift());
    }
    return result;
  }

  // ---- post-processing -----------------------------------------------------

  function stripPunct(text) {
    return text.replace(/[、。！？「」『』・…,.!?;:'"()（）\[\]{}]/g, "");
  }

  function randomizeCase(text) {
    return text.replace(/[a-zA-Z]/g, (ch) => (Math.random() < 0.35
      ? (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())
      : ch));
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---- generation -----------------------------------------------------------

  function readOptions() {
    return {
      unit: unitEl.value,
      min: +chunkMinEl.value,
      max: +chunkMaxEl.value,
      randomness: +randomnessEl.value,
      foldIn: foldInEl.checked,
      keepPunct: keepPunctEl.checked,
      capRandom: capRandomEl.checked,
    };
  }

  function readSourceTexts() {
    return [...sourcesEl.querySelectorAll("textarea")]
      .map((t) => t.value)
      .filter((t) => t.trim().length > 0);
  }

  function generateOne(sourceTexts, options) {
    const chunkArrays = sourceTexts.map((text, idx) =>
      tokenize(text, options.unit, options.min, options.max).map((t) => ({ text: t, sourceIndex: idx }))
    );

    const multiSource = sourceTexts.length > 1;
    let combined;

    if (options.foldIn && multiSource) {
      combined = foldInMerge(chunkArrays);
      combined = applyShuffle(combined, options.randomness * 0.6);
    } else {
      combined = chunkArrays.flat();
      combined = applyShuffle(combined, options.randomness);
    }

    if (!options.keepPunct) {
      combined = combined.map((c) => ({ ...c, text: stripPunct(c.text) }));
    }
    if (options.capRandom) {
      combined = combined.map((c) => ({ ...c, text: randomizeCase(c.text) }));
    }

    combined = combined.filter((c) => c.text.trim().length > 0 || options.unit === "line");
    return { chunks: combined, multiSource };
  }

  function chunksToHtml(chunks, unit, multiSource) {
    const sep = { char: "", word: " ", sentence: " ", line: "\n" }[unit] ?? " ";
    let html = "";
    chunks.forEach((c, i) => {
      const seam = multiSource && i > 0 && c.sourceIndex !== chunks[i - 1].sourceIndex;
      if (i > 0) html += escapeHtml(sep);
      html += `<span class="frag${seam ? " seam" : ""}">${escapeHtml(c.text)}</span>`;
    });
    return html;
  }

  function chunksToPlainText(chunks, unit) {
    const sep = { char: "", word: " ", sentence: " ", line: "\n" }[unit] ?? " ";
    return chunks.map((c) => c.text).join(sep);
  }

  function renderCard(index, sourceTexts, options) {
    const card = document.createElement("div");
    card.className = "result-card";
    card.style.setProperty("--tilt", `${(Math.random() * 1.6 - 0.8).toFixed(2)}deg`);
    card.style.setProperty("--delay", `${Math.min(index, 8) * 0.07}s`);

    function paint() {
      const { chunks, multiSource } = generateOne(sourceTexts, options);
      card.querySelector(".result-text").innerHTML = chunksToHtml(chunks, options.unit, multiSource);
      card.dataset.plain = chunksToPlainText(chunks, options.unit);
    }

    card.innerHTML = `
      <div class="result-head">
        <span>CUT #${String(index + 1).padStart(2, "0")}</span>
        <span class="result-actions">
          <button type="button" class="regenBtn">切り直す</button>
          <button type="button" class="copyBtn">コピー</button>
        </span>
      </div>
      <div class="result-text"></div>
    `;

    card.querySelector(".regenBtn").addEventListener("click", () => {
      card.style.animation = "none";
      void card.offsetWidth;
      card.style.animation = "";
      paint();
    });

    card.querySelector(".copyBtn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(card.dataset.plain || "");
        const btn = card.querySelector(".copyBtn");
        const original = btn.textContent;
        btn.textContent = "コピーした";
        setTimeout(() => { btn.textContent = original; }, 1200);
      } catch (e) {
        // clipboard unavailable; silently ignore
      }
    });

    paint();
    return card;
  }

  function runCutUp() {
    const sourceTexts = readSourceTexts();
    if (sourceTexts.length === 0) {
      resultsEl.innerHTML = `<p class="hint">まず、上の欄にテクストを入力してください。</p>`;
      return;
    }

    const options = readOptions();
    const count = +outputCountEl.value;

    resultsEl.innerHTML = "";
    for (let i = 0; i < count; i++) {
      resultsEl.appendChild(renderCard(i, sourceTexts, options));
    }
  }

  cutBtn.addEventListener("click", () => {
    cutBtn.classList.remove("cutting");
    void cutBtn.offsetWidth;
    cutBtn.classList.add("cutting");
    runCutUp();
  });
})();
