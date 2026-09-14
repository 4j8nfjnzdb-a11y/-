// つぶやき57577 — ひらがなをカットアップ的にランダムに拾い、
// 57577のモーラ数だけ守って、女性声でつぶやき続けるジェネレーター。
// 内容の意味は一切保証しない。速度と空白の"間"だけを操作対象にする。

(() => {
  const TANKA_PATTERN = [5, 7, 5, 7, 7];
  const MIN_MS = 40;
  const MAX_MS = 1400;
  const MAX_CARDS = 60;
  const MAX_SPEECH_QUEUE = 5;

  // ---- モーラ（拍）の素材：意味は無視し、日本語の1拍として自然な単位だけを列挙 ----
  const GOJUON = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるろれわをん".split("");
  const DAKUTEN = "がぎぐげござじずぜぞだぢづでどばびぶべぼ".split("");
  const HANDAKUTEN = "ぱぴぷぺぽ".split("");
  const SOKUON = ["っ"];
  const YOON_BASES = ["き", "ぎ", "し", "じ", "ち", "ぢ", "に", "ひ", "び", "ぴ", "み", "り"];
  const YOON_SMALL = ["ゃ", "ゅ", "ょ"];
  const YOON = YOON_BASES.flatMap((b) => YOON_SMALL.map((s) => b + s));
  const CHOUON = ["ー"];

  const MORA = [
    ...GOJUON,
    ...DAKUTEN,
    ...HANDAKUTEN,
    ...SOKUON,
    ...YOON,
    ...CHOUON,
  ];

  function pickMora() {
    return MORA[Math.floor(Math.random() * MORA.length)];
  }

  function buildLine(n) {
    return Array.from({ length: n }, pickMora);
  }

  // ---- 空白（間）のプリセット ----
  const SPACING_PRESETS = {
    tight: { label: "ぎっしり", blankProb: () => 0, pauseMul: () => 1 },
    normal: { label: "ふつう", blankProb: () => 0.12, pauseMul: () => 1.6 },
    airy: { label: "すきま", blankProb: () => 0.3, pauseMul: () => 2.4 },
    chaotic: {
      label: "でたらめ",
      blankProb: () => Math.random() * 0.55,
      pauseMul: () => 1 + Math.random() * 2.5,
    },
  };

  // ---- 速さのプリセット（1拍ぶんの間隔・ミリ秒） ----
  const SPEED_PRESETS = {
    slow: { label: "ゆったり", ms: 900 },
    normal: { label: "ふつう", ms: 420 },
    fast: { label: "きびきび", ms: 180 },
    veryfast: { label: "はやい", ms: 90 },
    ultra: { label: "暴走", ms: 45 },
  };

  // ---- サイコロ（速度の気まぐれ自動変化）の型 ----
  function clamp(v) {
    return Math.min(MAX_MS, Math.max(MIN_MS, v));
  }

  function makeDriftPattern() {
    let value = 400;
    let target = 400;
    return () => {
      if (Math.random() < 0.06) target = MIN_MS + Math.random() * (MAX_MS - MIN_MS);
      value += (target - value) * 0.08;
      return clamp(value);
    };
  }

  function makeJumpPattern() {
    let value = 400;
    let counter = 0;
    let nextJumpAt = 2 + Math.floor(Math.random() * 4);
    return () => {
      counter++;
      if (counter >= nextJumpAt) {
        value = MIN_MS + Math.random() * (MAX_MS - MIN_MS);
        counter = 0;
        nextJumpAt = 2 + Math.floor(Math.random() * 5);
      }
      return clamp(value);
    };
  }

  function makeWavePattern() {
    let t = 0;
    let period = 18 + Math.random() * 20;
    const mid = (MIN_MS + MAX_MS) / 2;
    const amp = ((MAX_MS - MIN_MS) / 2) * 0.9;
    return () => {
      t += 1;
      if (Math.random() < 0.01) period = 10 + Math.random() * 30;
      return clamp(mid + amp * Math.sin(t / period));
    };
  }

  function makeChaosPattern() {
    let x = 0.3 + Math.random() * 0.4;
    const r = 3.97;
    return () => {
      x = r * x * (1 - x);
      return clamp(MIN_MS + x * (MAX_MS - MIN_MS));
    };
  }

  const DICE_PATTERNS = {
    drift: makeDriftPattern,
    jump: makeJumpPattern,
    wave: makeWavePattern,
    chaos: makeChaosPattern,
  };

  // ---- 音声（女性声を優先して選ぶ） ----
  let voices = [];
  let currentVoice = null;
  let pendingSpeechCount = 0;

  const FEMALE_HINTS = [
    "kyoko", "haruka", "ayumi", "sayaka", "nanami", "mei", "o-ren",
    "female", "女性", "naomi", "hanamori",
  ];

  function pickBestJaVoice(list) {
    const ja = list.filter((v) => v.lang && v.lang.toLowerCase().startsWith("ja"));
    if (!ja.length) return null;
    let best = ja[0];
    let bestScore = -1;
    ja.forEach((v) => {
      const name = v.name.toLowerCase();
      let score = 0;
      if (FEMALE_HINTS.some((h) => name.includes(h))) score += 10;
      if (v.default) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    });
    return best;
  }

  let voiceLabel = "声を準備中…";
  let modeLabel = "";

  function renderStatus() {
    statusLine.textContent = modeLabel ? `${voiceLabel} ／ ${modeLabel}` : voiceLabel;
  }

  function refreshVoices() {
    if (!("speechSynthesis" in window)) return;
    voices = window.speechSynthesis.getVoices();
    currentVoice = pickBestJaVoice(voices);
    if (currentVoice) {
      voiceLabel = `声: ${currentVoice.name}`;
    } else if (voices.length) {
      voiceLabel = "日本語の声が見つからないので表示のみで進めます";
    } else {
      voiceLabel = "声を準備中…";
    }
    renderStatus();
  }

  function speakLine(text, intervalMs) {
    if (!("speechSynthesis" in window) || !text.trim()) return;
    if (pendingSpeechCount >= MAX_SPEECH_QUEUE) return;
    const u = new SpeechSynthesisUtterance(text);
    if (currentVoice) u.voice = currentVoice;
    u.lang = "ja-JP";
    const speedRatio = SPEED_PRESETS.normal.ms / intervalMs;
    u.rate = Math.min(2, Math.max(0.7, speedRatio));
    u.pitch = 1.15;
    pendingSpeechCount++;
    const done = () => { pendingSpeechCount = Math.max(0, pendingSpeechCount - 1); };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  }

  // ---- DOM ----
  const playBtn = document.getElementById("playBtn");
  const diceBtn = document.getElementById("diceBtn");
  const spacingSelect = document.getElementById("spacingSelect");
  const speedSelect = document.getElementById("speedSelect");
  const patternSelect = document.getElementById("patternSelect");
  const statusLine = document.getElementById("statusLine");
  const feed = document.getElementById("feed");

  let running = false;
  let diceOn = false;
  let currentIntervalMs = SPEED_PRESETS[speedSelect.value].ms;
  let currentPatternFn = null;
  let timer = null;

  let currentTweet = null;
  let pointer = { line: 0, mora: 0 };

  function randomHandle() {
    const syllables = Array.from({ length: 3 }, pickMora).join("");
    const num = Math.floor(Math.random() * 90 + 10);
    return `@${syllables}${num}`;
  }

  function createTweetCard() {
    const card = document.createElement("article");
    card.className = "tweet";

    const head = document.createElement("div");
    head.className = "tweetHead";
    const handle = document.createElement("span");
    handle.className = "handle";
    handle.textContent = randomHandle();
    const tag = document.createElement("span");
    tag.textContent = "つぶやき中…";
    head.appendChild(handle);
    head.appendChild(tag);

    const lines = document.createElement("div");
    lines.className = "lines";
    const lineEls = TANKA_PATTERN.map(() => {
      const el = document.createElement("div");
      el.className = "line";
      lines.appendChild(el);
      return el;
    });

    card.appendChild(head);
    card.appendChild(lines);
    feed.prepend(card);

    while (feed.children.length > MAX_CARDS) {
      feed.removeChild(feed.lastChild);
    }

    return {
      card,
      tag,
      lineEls,
      moraArrays: TANKA_PATTERN.map((n) => buildLine(n)),
    };
  }

  function startNewTweet() {
    currentTweet = createTweetCard();
    pointer = { line: 0, mora: 0 };
  }

  function finalizeCurrentTweet() {
    if (!currentTweet) return;
    currentTweet.card.classList.add("done");
    currentTweet.tag.textContent = "投稿済み";
  }

  function revealNextUnit() {
    if (!currentTweet) startNewTweet();

    const li = pointer.line;
    if (li >= TANKA_PATTERN.length) {
      finalizeCurrentTweet();
      startNewTweet();
      return { blank: false };
    }

    const spacing = SPACING_PRESETS[spacingSelect.value];
    const isBlank = Math.random() < spacing.blankProb();

    if (isBlank) {
      currentTweet.lineEls[li].textContent += "　";
      return { blank: true, pauseMul: spacing.pauseMul() };
    }

    const moraArr = currentTweet.moraArrays[li];
    const unit = moraArr[pointer.mora];
    currentTweet.lineEls[li].textContent += unit;
    pointer.mora++;

    if (pointer.mora >= moraArr.length) {
      speakLine(moraArr.join(""), currentIntervalMs);
      pointer.line++;
      pointer.mora = 0;
    }

    return { blank: false };
  }

  function updateStatusIndicator() {
    modeLabel = diceOn
      ? `サイコロ稼働中（${patternSelect.options[patternSelect.selectedIndex].text}）`
      : `速度: ${SPEED_PRESETS[speedSelect.value].label}`;
    renderStatus();
  }

  function tick() {
    if (!running) return;

    if (diceOn && currentPatternFn) {
      currentIntervalMs = currentPatternFn();
    } else {
      currentIntervalMs = SPEED_PRESETS[speedSelect.value].ms;
    }

    const result = revealNextUnit();
    let wait = currentIntervalMs;
    if (result.blank) wait *= result.pauseMul;

    if (voiceStatusNeedsRefresh()) refreshVoices();

    timer = setTimeout(tick, wait);
  }

  let lastVoiceCheck = 0;
  function voiceStatusNeedsRefresh() {
    if (currentVoice) return false;
    const now = Date.now();
    if (now - lastVoiceCheck < 2000) return false;
    lastVoiceCheck = now;
    return true;
  }

  function start() {
    running = true;
    playBtn.textContent = "止める";
    playBtn.classList.add("playing");
    if ("speechSynthesis" in window && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    if (!currentTweet) startNewTweet();
    tick();
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    playBtn.textContent = "はじめる";
    playBtn.classList.remove("playing");
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    pendingSpeechCount = 0;
  }

  playBtn.addEventListener("click", () => {
    if (running) stop(); else start();
  });

  diceBtn.addEventListener("click", () => {
    diceOn = !diceOn;
    diceBtn.setAttribute("aria-pressed", String(diceOn));
    speedSelect.disabled = diceOn;
    if (diceOn) {
      currentPatternFn = DICE_PATTERNS[patternSelect.value]();
    }
    updateStatusIndicator();
  });

  patternSelect.addEventListener("change", () => {
    if (diceOn) currentPatternFn = DICE_PATTERNS[patternSelect.value]();
    updateStatusIndicator();
  });

  speedSelect.addEventListener("change", updateStatusIndicator);

  if ("speechSynthesis" in window) {
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  } else {
    statusLine.textContent = "この端末は音声合成に対応していないため、表示のみで進めます";
  }

  updateStatusIndicator();
})();
