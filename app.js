// Quantum Cut — a sample video editor whose transitions and filters are
// literally driven by textbook quantum-mechanics formulas (superposition,
// interference, tunneling, the uncertainty principle, entanglement
// correlations, path integrals, and unitary time evolution). It is an
// artistic/educational demo, not a physics simulator: the formulas are
// computed for real and used to drive real pixels, but the video "clips"
// are just RGB image data, not quantum systems.

(() => {
  const W = 480, H = 270; // working resolution for all pixel-level math

  const outputCanvas = document.getElementById("output");
  outputCanvas.width = W; outputCanvas.height = H;
  const outCtx = outputCanvas.getContext("2d", { willReadFrequently: true });

  const previewEls = { A: document.getElementById("previewA"), B: document.getElementById("previewB") };
  const videoEls = { A: document.getElementById("videoA"), B: document.getElementById("videoB") };

  const playBtn = document.getElementById("playBtn");
  const recordBtn = document.getElementById("recordBtn");
  const recStatus = document.getElementById("recStatus");
  const effectSelect = document.getElementById("effectSelect");
  const effectDesc = document.getElementById("effectDesc");
  const paramPanel = document.getElementById("paramPanel");
  const formulaEq = document.getElementById("formulaEq");
  const formulaValues = document.getElementById("formulaValues");

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hash2 = (a, b) => {
    const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
    return x - Math.floor(x);
  };

  // ---- sources: each slot is either a loaded <video> or a synthetic
  // "sample" generator, both rendered into a working canvas every frame ----

  function makeSource(slot) {
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    return { slot, type: "gen", gen: slot === "A" ? "doubleslit" : "wavepacket", canvas, ctx, video: videoEls[slot] };
  }

  const sources = { A: makeSource("A"), B: makeSource("B") };

  function loadFile(slot, file) {
    const src = sources[slot];
    const url = URL.createObjectURL(file);
    src.video.src = url;
    src.video.play().catch(() => {});
    src.type = "video";
  }

  function loadGenerator(slot, gen) {
    const src = sources[slot];
    src.type = "gen";
    src.gen = gen;
  }

  // ---- synthetic "sample" clips, drawn purely from formulas ----------

  function drawDoubleSlit(ctx, t) {
    ctx.fillStyle = "#050510";
    ctx.fillRect(0, 0, W, H);

    const barrierX = W * 0.3;
    const screenX = W * 0.72;
    const slitSep = H * 0.11;   // d
    const slitWidth = H * 0.03; // a

    ctx.fillStyle = "#1b2140";
    ctx.fillRect(barrierX - 4, 0, 8, H / 2 - slitSep / 2 - slitWidth / 2);
    ctx.fillRect(barrierX - 4, H / 2 - slitSep / 2 + slitWidth / 2, 8, slitSep - slitWidth);
    ctx.fillRect(barrierX - 4, H / 2 + slitSep / 2 + slitWidth / 2, 8, H / 2 - slitSep / 2 - slitWidth / 2);

    const lambda = 34;
    const distToScreen = screenX - barrierX;
    const buildup = Math.min(t / 6, 1);

    for (let y = 0; y < H; y++) {
      const dy = y - H / 2;
      const theta = Math.atan2(dy, distToScreen);
      const pathDiff = slitSep * Math.sin(theta);
      const slitTerm = (Math.PI * slitWidth * Math.sin(theta)) / lambda;
      const singleSlit = slitTerm === 0 ? 1 : Math.pow(Math.sin(slitTerm) / slitTerm, 2);
      const phase = (2 * Math.PI * pathDiff) / lambda;
      const intensity = Math.pow(Math.cos(phase / 2), 2) * singleSlit;
      const a = intensity * buildup;
      ctx.fillStyle = `rgba(140, 220, 255, ${0.04 + a * 0.95})`;
      ctx.fillRect(screenX, y, W - screenX, 1.4);
    }

    ctx.strokeStyle = "rgba(140,220,255,0.25)";
    ctx.beginPath(); ctx.moveTo(screenX, 0); ctx.lineTo(screenX, H); ctx.stroke();

    const emitY = H / 2 + Math.sin(t * 3) * H * 0.03;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath(); ctx.arc(W * 0.06, emitY, 3, 0, Math.PI * 2); ctx.fill();
  }

  function drawWavepacket(ctx, t) {
    ctx.fillStyle = "#040309";
    ctx.fillRect(0, 0, W, H);

    const sigma0 = H * 0.045;
    const spreadRate = 0.16; // stand-in for ħ / (2 m σ0²)
    const sigma = sigma0 * Math.sqrt(1 + Math.pow(t * spreadRate, 2));
    const cx = W * 0.5 + Math.sin(t * 0.27) * W * 0.14;
    const cy = H * 0.5 + Math.cos(t * 0.21) * H * 0.12;

    const rings = 42;
    for (let i = rings; i >= 1; i--) {
      const r = sigma * 3 * (i / rings);
      const density = Math.exp(-(r * r) / (2 * sigma * sigma)); // |ψ|²
      const phase = (8 * r) / sigma - t * 4; // traveling wavefronts
      const shade = 0.5 + 0.5 * Math.cos(phase);
      const hue = 205 + 45 * Math.sin(t * 0.2);
      const alpha = density * 0.85 * (0.35 + 0.65 * shade);
      ctx.beginPath();
      ctx.fillStyle = `hsla(${hue}, 85%, 66%, ${alpha})`;
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const GENERATORS = { doubleslit: drawDoubleSlit, wavepacket: drawWavepacket };

  function updateSource(slot, t) {
    const src = sources[slot];
    if (src.type === "video") {
      if (src.video.readyState >= 2) {
        src.ctx.drawImage(src.video, 0, 0, W, H);
      }
    } else {
      GENERATORS[src.gen](src.ctx, t);
    }
    const pv = previewEls[slot];
    const pctx = pv.getContext("2d");
    pctx.drawImage(src.canvas, 0, 0, pv.width, pv.height);
  }

  // ---- effect state kept across frames ------------------------------

  const fxState = {
    prevAData: null,
    trailBuffer: [], // ring buffer of {canvas} snapshots for path-integral trail
    outImageData: outCtx.createImageData(W, H),
    blurCanvas: document.createElement("canvas"),
  };
  fxState.blurCanvas.width = W; fxState.blurCanvas.height = H;

  // ---- the eight quantum-formula effects -----------------------------

  const EFFECTS = {
    superposition: {
      label: "重ね合わせ干渉ブレンド",
      desc: "2つの映像を量子状態の重ね合わせ |ψ⟩=cosθ/2|A⟩+e^{iφ}sinθ/2|B⟩ として合成し、観測強度に干渉の交差項を含めます。",
      formula: "I = cos²(θ/2)·I_A + sin²(θ/2)·I_B + sin θ·cos φ·√(I_A·I_B)",
      params: [
        { key: "mix", label: "混合角 θ", min: 0, max: 100, step: 1, def: 50, fmt: v => `${Math.round((v/100)*180)}°` },
        { key: "phaseSpeed", label: "位相速度 dφ/dt", min: 0, max: 500, step: 1, def: 120, fmt: v => (v/100).toFixed(2) + " rad/s" },
      ],
      render(ctxA, ctxB, t, p) {
        const dataA = ctxA.getImageData(0, 0, W, H).data;
        const dataB = ctxB.getImageData(0, 0, W, H).data;
        const out = fxState.outImageData.data;
        const theta = (p.mix / 100) * Math.PI;
        const phi = t * (p.phaseSpeed / 100);
        const cA2 = Math.cos(theta / 2) ** 2;
        const cB2 = Math.sin(theta / 2) ** 2;
        const cross = Math.sin(theta) * Math.cos(phi);
        for (let i = 0; i < dataA.length; i += 4) {
          for (let c = 0; c < 3; c++) {
            const Ia = dataA[i + c], Ib = dataB[i + c];
            const v = cA2 * Ia + cB2 * Ib + cross * Math.sqrt(Ia * Ib);
            out[i + c] = clamp(v, 0, 255);
          }
          out[i + 3] = 255;
        }
        outCtx.putImageData(fxState.outImageData, 0, 0);
        this._readout = [
          `θ = ${(theta * 180 / Math.PI).toFixed(0)}°`,
          `cos²(θ/2) = ${cA2.toFixed(2)}`,
          `sin²(θ/2) = ${cB2.toFixed(2)}`,
          `干渉項係数 = ${cross.toFixed(2)}`,
        ];
      },
      readout() { return this._readout || []; },
    },

    doubleslitOverlay: {
      label: "二重スリット干渉オーバーレイ",
      desc: "ヤングの二重スリットの強度分布 I(θ) を明滅する縞パターンとして重ね、AとBのクロスフェードに干渉縞を掛け合わせます。",
      formula: "I(θ) = cos²(π d sinθ / λ) · sinc²(π a sinθ / λ)",
      params: [
        { key: "mix", label: "クロスフェード", min: 0, max: 100, step: 1, def: 50, fmt: v => `${v}% B` },
        { key: "d", label: "スリット間隔 d", min: 20, max: 140, step: 1, def: 70, fmt: v => v + " px" },
        { key: "lambda", label: "波長 λ", min: 15, max: 80, step: 1, def: 34, fmt: v => v + " px" },
        { key: "speed", label: "縞の移動速度", min: 0, max: 200, step: 1, def: 40, fmt: v => (v/100).toFixed(2) },
      ],
      render(ctxA, ctxB, t, p) {
        outCtx.drawImage(ctxA.canvas, 0, 0);
        outCtx.globalAlpha = p.mix / 100;
        outCtx.drawImage(ctxB.canvas, 0, 0);
        outCtx.globalAlpha = 1;

        const distToScreen = W * 0.5;
        const lambda = p.lambda;
        const d = p.d;
        const speed = p.speed / 100;
        let avgI = 0;
        for (let x = 0; x < W; x++) {
          const dx = x - W / 2;
          const theta = Math.atan2(dx, distToScreen);
          const phase = (2 * Math.PI * d * Math.sin(theta)) / lambda + t * speed;
          const intensity = Math.pow(Math.cos(phase / 2), 2);
          avgI += intensity;
          const shade = (intensity - 0.5) * 0.7;
          outCtx.fillStyle = shade >= 0
            ? `rgba(160,225,255,${shade * 0.55})`
            : `rgba(0,0,10,${-shade * 0.55})`;
          outCtx.fillRect(x, 0, 1.2, H);
        }
        this._readout = [
          `d = ${d}px`, `λ = ${lambda}px`,
          `平均干渉強度 = ${(avgI / W).toFixed(2)}`,
        ];
      },
      readout() { return this._readout || []; },
    },

    tunneling: {
      label: "量子トンネル遷移",
      desc: "ポテンシャル障壁 V を越えられないはずのエネルギー E の粒子が、指数関数的に減衰しながら障壁の向こうへ透過する様子でワイプ遷移します。",
      formula: "T = e^{-2κL},  κ = √(2m(V−E)) / ħ",
      params: [
        { key: "progress", label: "遷移の進行度", min: 0, max: 100, step: 1, def: 40, fmt: v => `${v}%` },
        { key: "V", label: "障壁の高さ V", min: 20, max: 100, step: 1, def: 60, fmt: v => (v/10).toFixed(1) + " eV" },
        { key: "E", label: "粒子のエネルギー E", min: 5, max: 95, step: 1, def: 30, fmt: v => (v/10).toFixed(1) + " eV" },
        { key: "mass", label: "有効質量 m", min: 10, max: 200, step: 1, def: 60, fmt: v => (v/100).toFixed(2) },
      ],
      render(ctxA, ctxB, t, p) {
        const barrierPx = 70;
        const xFront = (p.progress / 100) * (W + barrierPx) - barrierPx;
        const V = p.V / 10, E = Math.min(p.E / 10, V - 0.1);
        const m = p.mass / 100;
        const kappa = Math.sqrt(Math.max(0, 2 * m * (V - E))) * 0.06; // ħ absorbed into scale
        const T = Math.exp(-2 * kappa * (barrierPx / 8));

        outCtx.drawImage(ctxA.canvas, 0, 0);
        outCtx.save();
        outCtx.beginPath();
        outCtx.rect(0, 0, Math.max(0, xFront), H);
        outCtx.clip();
        outCtx.drawImage(ctxB.canvas, 0, 0);
        outCtx.restore();

        const bStart = clamp(xFront, 0, W);
        const bEnd = clamp(xFront + barrierPx, 0, W);
        for (let x = bStart; x < bEnd; x++) {
          const depth = x - xFront;
          const alpha = clamp(Math.exp(-2 * kappa * (depth / 8)), 0, 1);
          outCtx.save();
          outCtx.beginPath();
          outCtx.rect(x, 0, 1.2, H);
          outCtx.clip();
          outCtx.globalAlpha = alpha;
          outCtx.drawImage(ctxB.canvas, 0, 0);
          outCtx.restore();
        }
        outCtx.fillStyle = "rgba(150,120,255,0.25)";
        outCtx.fillRect(bStart, 0, Math.max(0, bEnd - bStart), H);

        this._readout = [
          `κ = ${kappa.toFixed(3)}`,
          `V−E = ${(V - E).toFixed(2)} eV`,
          `透過確率 T = ${T.toFixed(3)}`,
        ];
      },
      readout() { return this._readout || []; },
    },

    heisenberg: {
      label: "不確定性原理ブラー",
      desc: "運動量の不確かさ Δp が大きい（動きの速い）領域ほど位置は鋭く、動きの少ない領域ほど位置の不確かさ Δx（ぼかし）が増します。",
      formula: "Δx · Δp ≥ ħ/2  ⇒  Δx ∝ ħ / (2Δp)",
      params: [
        { key: "hbar", label: "ħ（不確定性の強さ）", min: 5, max: 100, step: 1, def: 45, fmt: v => (v/10).toFixed(1) },
        { key: "sensitivity", label: "運動検出感度", min: 5, max: 100, step: 1, def: 50, fmt: v => (v/100).toFixed(2) },
      ],
      render(ctxA, ctxB, t, p) {
        const dataA = ctxA.getImageData(0, 0, W, H).data;
        const prev = fxState.prevAData || dataA;

        const blurPx = clamp((p.hbar / 100) * 14, 1, 14);
        fxState.blurCanvas.getContext("2d").clearRect(0, 0, W, H);
        const bctx = fxState.blurCanvas.getContext("2d");
        bctx.filter = `blur(${blurPx}px)`;
        bctx.drawImage(ctxA.canvas, 0, 0);
        bctx.filter = "none";

        outCtx.drawImage(ctxA.canvas, 0, 0);

        const block = 20;
        const sens = p.sensitivity / 100;
        let sumDp = 0, count = 0;
        for (let by = 0; by < H; by += block) {
          for (let bx = 0; bx < W; bx += block) {
            const cx = Math.min(bx + block >> 1, W - 1);
            const cy = Math.min(by + block >> 1, H - 1);
            const idx = (cy * W + cx) * 4;
            const diff = Math.abs(dataA[idx] - prev[idx]) + Math.abs(dataA[idx + 1] - prev[idx + 1]) + Math.abs(dataA[idx + 2] - prev[idx + 2]);
            const dp = diff * sens * 0.02 + 0.05; // Δp proxy
            const dxWeight = clamp(1 / (dp * 3), 0, 1); // Δx ∝ 1/Δp
            sumDp += dp; count++;
            if (dxWeight > 0.03) {
              outCtx.save();
              outCtx.beginPath();
              outCtx.rect(bx, by, block, block);
              outCtx.clip();
              outCtx.globalAlpha = dxWeight;
              outCtx.drawImage(fxState.blurCanvas, 0, 0);
              outCtx.restore();
            }
          }
        }
        fxState.prevAData = dataA;

        const avgDp = sumDp / count;
        this._readout = [
          `平均 Δp ≈ ${avgDp.toFixed(2)}`,
          `対応する Δx ≈ ${(1 / (avgDp * 3)).toFixed(2)} (正規化)`,
          `ħ/2 = ${(p.hbar / 20).toFixed(2)}`,
        ];
      },
      readout() { return this._readout || []; },
    },

    entanglement: {
      label: "量子もつれカラーグレーディング",
      desc: "画面を2つの『もつれた粒子』として左右に分割し、片方の測定基底角を変えるともう片方の色相がベル相関に従って瞬時に変化します。",
      formula: "E(θ_A, θ_B) = −cos(θ_A − θ_B)",
      params: [
        { key: "deltaTheta", label: "測定基底の差 Δθ", min: 0, max: 180, step: 1, def: 45, fmt: v => `${v}°` },
        { key: "drift", label: "基底の自動回転速度", min: 0, max: 100, step: 1, def: 30, fmt: v => (v/100).toFixed(2) },
      ],
      render(ctxA, ctxB, t, p) {
        const hueA = (t * p.drift * 0.3) % 360;
        const deltaTheta = p.deltaTheta;
        const E = -Math.cos((deltaTheta * Math.PI) / 180);
        const hueB = (hueA + 180 + deltaTheta) % 360;

        outCtx.save();
        outCtx.beginPath(); outCtx.rect(0, 0, W / 2, H); outCtx.clip();
        outCtx.filter = `hue-rotate(${hueA.toFixed(1)}deg) saturate(1.3)`;
        outCtx.drawImage(ctxA.canvas, 0, 0);
        outCtx.restore();

        outCtx.save();
        outCtx.beginPath(); outCtx.rect(W / 2, 0, W / 2, H); outCtx.clip();
        outCtx.filter = `hue-rotate(${hueB.toFixed(1)}deg) saturate(1.3)`;
        outCtx.drawImage(ctxB.canvas, 0, 0);
        outCtx.restore();
        outCtx.filter = "none";

        const glow = 0.3 + 0.3 * Math.abs(E);
        outCtx.fillStyle = `rgba(200,180,255,${glow})`;
        outCtx.fillRect(W / 2 - 1.5, 0, 3, H);

        this._readout = [
          `θ_A = ${hueA.toFixed(0)}°`, `Δθ = ${deltaTheta}°`,
          `相関 E = ${E.toFixed(2)}`,
        ];
      },
      readout() { return this._readout || []; },
    },

    pathintegral: {
      label: "経路積分モーショントレイル",
      desc: "ファインマンの経路積分のように、過去の各フレーム（経路）を位相 e^{iS/ħ} で重み付けして足し合わせ、干渉するモーショントレイルを作ります。",
      formula: "K = Σ_paths e^{iS_k/ħ},  重み w_k = cos(ω k Δt)",
      params: [
        { key: "n", label: "経路数（過去フレーム）", min: 3, max: 24, step: 1, def: 12, fmt: v => v },
        { key: "omega", label: "作用の角振動数 ω", min: 10, max: 300, step: 1, def: 90, fmt: v => (v/100).toFixed(2) },
      ],
      render(ctxA, ctxB, t, p) {
        outCtx.drawImage(ctxB.canvas, 0, 0);
        outCtx.globalCompositeOperation = "lighter";

        const snap = document.createElement("canvas");
        snap.width = W; snap.height = H;
        snap.getContext("2d").drawImage(ctxA.canvas, 0, 0);
        fxState.trailBuffer.unshift(snap);
        const N = p.n;
        while (fxState.trailBuffer.length > N) fxState.trailBuffer.pop();

        const omega = p.omega / 100;
        let constructive = 0;
        fxState.trailBuffer.forEach((c, k) => {
          const w = Math.cos(omega * k);
          if (w > 0) {
            constructive++;
            const envelope = 1 - k / N;
            outCtx.globalAlpha = w * envelope * 0.55;
            outCtx.drawImage(c, 0, 0);
          }
        });
        outCtx.globalAlpha = 1;
        outCtx.globalCompositeOperation = "source-over";

        this._readout = [
          `経路数 N = ${N}`, `ω = ${omega.toFixed(2)}`,
          `建設的干渉した経路 = ${constructive}/${N}`,
        ];
      },
      readout() { return this._readout || []; },
    },

    rabi: {
      label: "シュレーディンガー時間発展（ラビ振動）",
      desc: "2準位系の状態がユニタリー時間発展の下でAとBの間をラビ振動しながら遷移する確率で、映像をクロスフェードします。",
      formula: "|ψ(t)⟩ = e^{-iHt/ħ}|ψ(0)⟩ ⇒ P_B(t) = sin²(Ω t / 2)",
      params: [
        { key: "omega", label: "ラビ周波数 Ω", min: 5, max: 300, step: 1, def: 60, fmt: v => (v/100).toFixed(2) + " rad/s" },
      ],
      render(ctxA, ctxB, t, p) {
        const omega = p.omega / 100;
        const pB = Math.sin((omega * t) / 2) ** 2;
        outCtx.drawImage(ctxA.canvas, 0, 0);
        outCtx.globalAlpha = pB;
        outCtx.drawImage(ctxB.canvas, 0, 0);
        outCtx.globalAlpha = 1;
        this._readout = [`Ω = ${omega.toFixed(2)} rad/s`, `P_B(t) = ${pB.toFixed(2)}`];
      },
      readout() { return this._readout || []; },
    },

    collapse: {
      label: "波動関数の収縮ディゾルブ",
      desc: "各ブロックが干渉パターン状の確率密度 |ψ|² を持ち、観測（進行度）が閾値を超えた瞬間に不可逆的にAからBへ『収縮』します。",
      formula: "ρ(x,y) = |ψ(x,y)|²,  収縮条件: p·ρ(x,y) > r_{xy}",
      params: [
        { key: "progress", label: "観測の進行度 p", min: 0, max: 100, step: 1, def: 35, fmt: v => `${v}%` },
        { key: "block", label: "ブロックサイズ", min: 8, max: 40, step: 2, def: 18, fmt: v => v + " px" },
      ],
      render(ctxA, ctxB, t, p) {
        const block = p.block;
        const prog = p.progress / 100;
        let collapsedCount = 0, total = 0, rhoSum = 0;
        for (let by = 0; by < H; by += block) {
          for (let bx = 0; bx < W; bx += block) {
            const bw = Math.min(block, W - bx), bh = Math.min(block, H - by);
            const gx = bx / block, gy = by / block;
            const rho = (0.5 + 0.5 * Math.sin(gx * 0.6 + t * 0.5)) *
                        (0.5 + 0.5 * Math.cos(gy * 0.7 - t * 0.35));
            const r = hash2(gx, gy);
            const collapsed = prog * rho > r;
            rhoSum += rho; total++;
            if (collapsed) collapsedCount++;
            outCtx.drawImage(
              collapsed ? ctxB.canvas : ctxA.canvas,
              bx, by, bw, bh, bx, by, bw, bh
            );
          }
        }
        this._readout = [
          `p = ${(prog * 100).toFixed(0)}%`,
          `平均 ρ = ${(rhoSum / total).toFixed(2)}`,
          `収縮済み = ${((collapsedCount / total) * 100).toFixed(0)}%`,
        ];
      },
      readout() { return this._readout || []; },
    },
  };

  // ---- UI wiring -------------------------------------------------

  const paramValues = {}; // effectKey -> { paramKey: value }
  Object.entries(EFFECTS).forEach(([key, fx]) => {
    paramValues[key] = {};
    fx.params.forEach(pr => { paramValues[key][pr.key] = pr.def; });
  });

  Object.entries(EFFECTS).forEach(([key, fx]) => {
    const opt = document.createElement("option");
    opt.value = key; opt.textContent = fx.label;
    effectSelect.appendChild(opt);
  });

  let currentEffectKey = "superposition";

  function buildParamPanel() {
    const fx = EFFECTS[currentEffectKey];
    effectDesc.textContent = fx.desc;
    formulaEq.textContent = fx.formula;
    paramPanel.innerHTML = "";
    fx.params.forEach(pr => {
      const row = document.createElement("div");
      row.className = "param-row";
      const labelRow = document.createElement("div");
      labelRow.className = "param-label";
      const nameSpan = document.createElement("span");
      nameSpan.textContent = pr.label;
      const valSpan = document.createElement("b");
      valSpan.textContent = pr.fmt(paramValues[currentEffectKey][pr.key]);
      labelRow.appendChild(nameSpan);
      labelRow.appendChild(valSpan);

      const input = document.createElement("input");
      input.type = "range";
      input.min = pr.min; input.max = pr.max; input.step = pr.step;
      input.value = paramValues[currentEffectKey][pr.key];
      input.addEventListener("input", () => {
        const v = +input.value;
        paramValues[currentEffectKey][pr.key] = v;
        valSpan.textContent = pr.fmt(v);
      });

      row.appendChild(labelRow);
      row.appendChild(input);
      paramPanel.appendChild(row);
    });
    // switching effects resets stateful buffers so old trails/motion data
    // don't leak into a differently-shaped effect
    fxState.trailBuffer = [];
    fxState.prevAData = null;
  }

  effectSelect.value = currentEffectKey;
  effectSelect.addEventListener("change", () => {
    currentEffectKey = effectSelect.value;
    buildParamPanel();
  });
  buildParamPanel();

  document.querySelectorAll(".file-input").forEach(input => {
    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) loadFile(input.dataset.slot, file);
    });
  });

  document.querySelectorAll(".sample-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      loadGenerator(btn.dataset.slot, btn.dataset.gen);
    });
  });

  // ---- playback clock ---------------------------------------------

  let playing = false;
  let clock = 0;
  let lastRAF = null;

  function setPlaying(v) {
    playing = v;
    playBtn.textContent = playing ? "⏸ 一時停止" : "▶ 再生";
    Object.values(sources).forEach(s => {
      if (s.type === "video") {
        if (playing) s.video.play().catch(() => {}); else s.video.pause();
      }
    });
  }

  playBtn.addEventListener("click", () => setPlaying(!playing));

  function loop(now) {
    if (lastRAF == null) lastRAF = now;
    const dt = (now - lastRAF) / 1000;
    lastRAF = now;
    if (playing) clock += dt;

    updateSource("A", clock);
    updateSource("B", clock);

    const fx = EFFECTS[currentEffectKey];
    fx.render(sources.A.ctx, sources.B.ctx, clock, paramValues[currentEffectKey]);

    const values = fx.readout();
    formulaValues.innerHTML = "";
    values.forEach(v => {
      const span = document.createElement("span");
      span.textContent = v;
      formulaValues.appendChild(span);
    });

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---- export via MediaRecorder ------------------------------------

  let recorder = null;
  let recordedChunks = [];
  let recTimerHandle = null;
  let recSeconds = 0;

  function pickMimeType() {
    const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return candidates.find(c => window.MediaRecorder && MediaRecorder.isTypeSupported(c)) || "video/webm";
  }

  recordBtn.addEventListener("click", () => {
    if (!recorder || recorder.state === "inactive") {
      const stream = outputCanvas.captureStream(30);
      recordedChunks = [];
      try {
        recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
      } catch (err) {
        recStatus.textContent = "このブラウザでは書き出しに対応していません";
        return;
      }
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `quantum-cut-${currentEffectKey}.webm`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        recStatus.textContent = "書き出し完了 (ダウンロードされました)";
        recordBtn.textContent = "● 書き出し開始";
        recordBtn.classList.remove("recording");
        clearInterval(recTimerHandle);
      };
      recorder.start();
      if (!playing) setPlaying(true);
      recSeconds = 0;
      recStatus.textContent = "録画中... 0:00";
      recordBtn.textContent = "■ 書き出し停止";
      recordBtn.classList.add("recording");
      recTimerHandle = setInterval(() => {
        recSeconds += 1;
        const m = Math.floor(recSeconds / 60), s = recSeconds % 60;
        recStatus.textContent = `録画中... ${m}:${s.toString().padStart(2, "0")}`;
      }, 1000);
    } else {
      recorder.stop();
    }
  });
})();
