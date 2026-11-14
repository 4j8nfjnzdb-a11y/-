// Kasane — footage: importing pictures, video and sound, keeping them between visits (IndexedDB),
// stepping video elements in time with the playhead, and playing / mixing the sound.
// Files never leave the device; the project file only refers to them by name.
'use strict';
(() => {
  const U = KS.U, M = KS.M, S = KS.S;
  const MD = KS.Media = { store: new Map() };   // asset.id → { blob, url, el, w, h, audio, thumb, state }

  const EXT = {
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'],
    video: ['mp4', 'mov', 'm4v', 'webm', 'ogv', 'mkv'],
    audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'aif', 'aiff', 'opus'],
  };
  const kindOf = (file) => {
    const t = file.type || '', e = (file.name.split('.').pop() || '').toLowerCase();
    for (const k of ['image', 'video', 'audio']) if (t.startsWith(k + '/') || EXT[k].includes(e)) return k;
    return null;
  };

  // ---- IndexedDB (best effort: a private window or a full disk just means footage has to be re-added)
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res) => {
    try {
      const rq = indexedDB.open('kasane', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('blobs');
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); rq.onblocked = () => res(null);
    } catch (e) { res(null); }
  }));
  const idb = async (mode, fn) => { const d = await db(); if (!d) return null; return new Promise((res) => { try { const tx = d.transaction('blobs', mode), rq = fn(tx.objectStore('blobs')); tx.oncomplete = () => res(rq ? rq.result : null); tx.onerror = tx.onabort = () => res(null); } catch (e) { res(null); } }); };
  MD.keep = (id, blob) => idb('readwrite', (st) => st.put(blob, id));
  MD.fetch = (id) => idb('readonly', (st) => st.get(id));
  MD.dropStored = (id) => idb('readwrite', (st) => st.delete(id));

  // ---- decoding
  let offline = null;
  const decodeAudio = async (blob) => {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!AC) return null;
    if (!offline) offline = new AC(2, 48000, 48000);
    const buf = await blob.arrayBuffer();
    return new Promise((res) => { try { const p = offline.decodeAudioData(buf, (b) => res(b), () => res(null)); if (p && p.catch) p.catch(() => res(null)); } catch (e) { res(null); } });
  };
  const loadImage = (url) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('画像を開けませんでした')); im.src = url; });
  const probeVideo = (url) => new Promise((res, rej) => {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
    let done = false; const fail = () => { if (!done) { done = true; rej(new Error('この動画はこのブラウザで再生できない形式です')); } };
    const tm = setTimeout(fail, 15000);
    v.onerror = fail;
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 3); };
    v.onseeked = () => { if (done) return; done = true; clearTimeout(tm); res({ w: v.videoWidth, h: v.videoHeight, dur: isFinite(v.duration) ? v.duration : 10, thumb: KS.Raster.thumb(v, v.videoWidth, v.videoHeight).toDataURL('image/jpeg', 0.7) }); v.removeAttribute('src'); v.load(); };
    v.src = url;
  });
  async function open(asset, blob) {
    const e = { blob, url: URL.createObjectURL(blob), state: 'loading' };
    MD.store.set(asset.id, e);
    if (asset.kind === 'image') {
      const im = await loadImage(e.url);
      e.el = im; e.w = asset.w = im.naturalWidth || 512; e.h = asset.h = im.naturalHeight || 512;
      e.thumb = KS.Raster.thumb(im, e.w, e.h).toDataURL('image/jpeg', 0.7);
    } else if (asset.kind === 'video') {
      const p = await probeVideo(e.url);
      asset.w = p.w; asset.h = p.h; asset.dur = p.dur; e.thumb = p.thumb;
      decodeAudio(blob).then((b) => { if (b) { e.audio = b; asset.hasAudio = true; analyze(asset, b); KS.emit('struct'); } });
    } else {
      const b = await decodeAudio(blob);
      if (!b) throw new Error('この音声はこのブラウザで読めない形式です');
      e.audio = b; asset.dur = b.duration; asset.hasAudio = true;
      analyze(asset, b);
    }
    e.state = 'ready';
    return e;
  }
  // read the sound into its components as soon as it arrives
  function analyze(asset, buf) {
    const SD = KS.Sound; if (!SD || SD.an.has(asset.id) || SD.pending.has(asset.id)) return;
    SD.pending.add(asset.id); KS.emit('sound');
    SD.analyze(buf, (p) => { SD.progress = p; KS.emit('soundProgress'); }).then((an) => {
      SD.an.set(asset.id, an); SD.pending.delete(asset.id); SD.ver++; KS.docVer++;
      KS.emit('sound'); KS.emit('struct'); KS.emit('doc');
    }).catch((err) => { SD.pending.delete(asset.id); console.warn(err); });
  }

  MD.importFiles = async (files) => {
    const out = [];
    for (const file of files) {
      const kind = kindOf(file);
      if (!kind) { KS.toast(`「${file.name}」は読み込めない種類のファイルです`, 'warn'); continue; }
      const asset = { id: U.uid('a'), kind, name: file.name, size: file.size, mime: file.type, w: 0, h: 0, dur: 0 };
      try { await open(asset, file); } catch (err) { MD.store.delete(asset.id); KS.toast(`「${file.name}」: ${err.message}`, 'warn'); continue; }
      S.project.assets.push(asset); MD.keep(asset.id, file); out.push(asset);
    }
    if (out.length) KS.restructured();
    return out;
  };
  // after a reload: bring back whatever the browser still holds
  MD.restore = async (project) => {
    let missing = 0;
    for (const asset of project.assets) {
      if (MD.store.has(asset.id)) continue;
      const blob = await MD.fetch(asset.id);
      if (!blob) { missing++; continue; }
      try { await open(asset, blob); } catch (e) { missing++; }
    }
    KS.emit('struct'); KS.emit('doc');
    return missing;
  };
  MD.relink = async (asset, file) => { await open(asset, file); MD.keep(asset.id, file); KS.restructured(); };
  MD.image = (id) => { const e = MD.store.get(id); return e && e.el ? e : null; };
  MD.audio = (id) => { const e = MD.store.get(id); return e ? e.audio || null : null; };
  MD.thumb = (id) => { const e = MD.store.get(id); return e ? e.thumb || '' : ''; };
  MD.ready = (id) => { const e = MD.store.get(id); return !!(e && e.state === 'ready'); };

  // ---- video: one element per layer, kept in step with the playhead
  const vids = new Map();       // layer.id → { el, src, used }
  let host = null, tick = 0;
  function videoFor(L) {
    let v = vids.get(L.id);
    const e = MD.store.get(L.src);
    if (!e || !e.url) return null;
    if (v && v.src !== L.src) { v.el.remove(); vids.delete(L.id); v = null; }
    if (!v) {
      if (!host) { host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none'; document.body.append(host); }
      const el = document.createElement('video');
      el.muted = true; el.playsInline = true; el.preload = 'auto'; el.setAttribute('playsinline', ''); el.disablePictureInPicture = true;
      el.src = e.url;
      const poke = () => KS.emit('videoFrame');
      el.addEventListener('seeked', poke); el.addEventListener('loadeddata', poke);
      host.append(el);
      v = { el, src: L.src, used: 0 }; vids.set(L.id, v);
    }
    return v;
  }
  MD.videoFrame = (L, tl, env) => {
    const v = videoFor(L); if (!v) return null;
    const el = v.el, dur = isFinite(el.duration) ? el.duration : 1e9, want = U.clamp(tl, 0, Math.max(0, dur - 0.04));
    v.used = tick;
    if (env.exporting) return el.readyState >= 2 ? v : null;          // the exporter has already placed every video exactly
    if (env.playing) {
      const rate = U.clamp(L.speed || 1, 0.0625, 16);
      if (el.playbackRate !== rate) el.playbackRate = rate;
      if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want;
      if (el.paused && tl >= 0 && tl < dur) el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - want) > 0.012 && !el.seeking) el.currentTime = want;
    }
    return el.readyState >= 2 ? v : null;
  };
  MD.endFrame = () => { for (const v of vids.values()) if (v.used !== tick && !v.el.paused) v.el.pause(); tick++; };
  MD.pauseAll = () => { for (const v of vids.values()) if (!v.el.paused) v.el.pause(); };
  MD.pruneVideos = (project) => { const live = new Set(); for (const c of project.comps) for (const l of c.layers) live.add(l.id); for (const [id, v] of vids) if (!live.has(id)) { v.el.removeAttribute('src'); v.el.load(); v.el.remove(); vids.delete(id); } };
  // export: put every video that shows at time t on exactly the right frame, and wait until it is there
  MD.prepareFrame = async (project, comp, t, depth = 0) => {
    const jobs = [];
    for (const L of comp.layers) {
      if (t < L.in || t >= L.out) continue;
      const tl = (t - L.start) * (L.speed || 1);
      if (L.type === 'comp' && depth < 6) { const nc = M.comp(project, L.comp); if (nc) jobs.push(MD.prepareFrame(project, nc, tl, depth + 1)); }
      if (L.type !== 'video') continue;
      const v = videoFor(L); if (!v) continue;
      const el = v.el, dur = isFinite(el.duration) ? el.duration : 1e9, want = U.clamp(tl + 0.001, 0, Math.max(0, dur - 0.04));
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - want) < 0.0005 && el.readyState >= 2 && !el.seeking) continue;
      jobs.push(new Promise((res) => {
        let done = false; const fin = () => { if (done) return; done = true; el.removeEventListener('seeked', fin); clearTimeout(tm); res(); };
        const tm = setTimeout(fin, 2500);
        el.addEventListener('seeked', fin);
        el.currentTime = want;
      }));
    }
    await Promise.all(jobs);
  };

  // ---- sound playback: decoded buffers scheduled on one clock, which the picture then follows
  let ac = null, master = null, live = [], clock = null;
  MD.context = () => {
    if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ac = new AC(); master = ac.createGain(); master.connect(ac.destination); }
    return ac;
  };
  MD.masterNode = () => master;
  const sounding = (comp) => comp.layers.filter((L) => (L.type === 'audio' || L.type === 'video') && L.vis !== false && MD.audio(L.src));
  function schedule(ctx, dest, project, comp, t0, at, tEnd) {
    const nodes = [], anySolo = comp.layers.some((l) => l.solo), frame = new KS.Frame(project, comp, t0);
    for (const L of sounding(comp)) {
      if (anySolo && !L.solo) continue;
      const buf = MD.audio(L.src), sp = U.clamp(L.speed || 1, 0.0625, 16);
      const a = Math.max(t0, L.in), b = Math.min(tEnd, L.out); if (b <= a) continue;
      const off = (a - L.start) * sp; if (off >= buf.duration) continue;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.playbackRate.value = sp; src.connect(g); g.connect(dest);
      const when = at + (a - t0), span = Math.min(b - a, (buf.duration - Math.max(0, off)) / sp);
      // volume follows its keyframes (and anything tied to it), sampled 40 times a second
      const steps = Math.max(2, Math.min(4000, Math.ceil(span * 40))), curve = new Float32Array(steps);
      for (let i = 0; i < steps; i++) curve[i] = U.clamp(frame.val(L, 'p.vol', a + span * i / (steps - 1)) / 100, 0, 4);
      try { g.gain.setValueCurveAtTime(curve, Math.max(ctx.currentTime, when), Math.max(0.01, span)); } catch (e) { g.gain.value = curve[0]; }
      try { src.start(Math.max(0, when), Math.max(0, off), span * sp); } catch (e) { continue; }
      nodes.push(src);
    }
    return nodes;
  }
  MD.play = (project, comp, t0, tEnd) => {
    MD.stop();
    const perf = () => performance.now() / 1000;
    if (!sounding(comp).length || !MD.context()) { clock = { t0, base: perf(), now: perf }; return; }
    if (ac.state !== 'running') ac.resume().catch(() => {});
    const at = ac.currentTime + 0.06;
    live = schedule(ac, master, project, comp, t0, at, tEnd);
    // if the context is not allowed to run yet, fall back to the wall clock rather than freezing the picture
    clock = { t0, base: at, now: () => (ac.state === 'running' ? ac.currentTime : clock.alt()), alt: (() => { const b = perf(); return () => at + (perf() - b); })() };
  };
  MD.stop = () => { for (const n of live) { try { n.stop(); } catch (e) { /* already ended */ } } live = []; clock = null; };
  MD.time = () => (clock ? clock.t0 + Math.max(0, clock.now() - clock.base) : null);
  MD.mixdown = async (project, comp, t0, t1) => {
    if (!sounding(comp).length) return null;
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!AC) return null;
    const sr = 48000, ctx = new AC(2, Math.max(1, Math.ceil((t1 - t0) * sr)), sr);
    schedule(ctx, ctx.destination, project, comp, t0, 0, t1);
    return ctx.startRendering();
  };
  MD.hasSound = (comp) => sounding(comp).length > 0;
})();
