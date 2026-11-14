// Kasane — getting work out: video (frame-exact through WebCodecs, or recorded in real time where that is
// missing), a still frame, and the project file.
'use strict';
(() => {
  const U = KS.U, S = KS.S, G = KS.G, R = KS.R, MD = KS.Media;
  const EX = KS.Export = { cancel: false, busy: false };

  // the muxer / encoder front end is fetched only when a video is actually exported
  const MB_URLS = ['https://cdn.jsdelivr.net/npm/mediabunny@1.62.1/dist/bundles/mediabunny.min.mjs', 'https://unpkg.com/mediabunny@1.62.1/dist/bundles/mediabunny.min.mjs'];
  let mbp = null;
  EX.loadMB = () => mbp || (mbp = (async () => {
    for (const url of MB_URLS) {
      try {
        const m = await Promise.race([import(url), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))]);
        if (m && m.Output) return m;
      } catch (e) { /* try the next host */ }
    }
    mbp = null;
    return null;
  })());

  const inViewer = () => !!(window.claude && typeof window.claude.use === 'function');
  EX.deliver = async (name, blob) => {
    if (inViewer()) {
      const dl = await window.claude.use('downloads');
      if (dl) {
        try { await dl.save({ filename: name, data: blob }); return `${name} を保存しました`; }
        catch (e) {
          const c = e && e.code;
          if (c === 'declined') return '保存をやめました';
          if (c === 'rate_limited') throw new Error('保存の確認がまだ開いています。閉じてからもう一度押してください');
          if (c === 'too_large') throw new Error('ファイルが大きすぎて保存できませんでした。解像度か長さを下げてください');
          throw new Error('この表示ではファイルを保存できません');
        }
      }
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return `${name} を書き出しました`;
  };
  const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
  const safe = (s) => String(s || 'kasane').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);

  // o: { format: 'mp4'|'webm', scale: 1|0.5, range: 'work'|'all', audio: bool, quality: 'high'|'medium'|'veryhigh' }
  EX.video = async (o, onProgress) => {
    const comp = KS.comp(), project = S.project, fps = comp.fps;
    const [t0, t1] = o.range === 'all' ? [0, comp.dur] : comp.wa;
    const scale = o.scale || 1, W = Math.max(2, Math.round(comp.w * scale / 2) * 2), H = Math.max(2, Math.round(comp.h * scale / 2) * 2);
    const frames = Math.max(1, Math.round((t1 - t0) * fps));
    EX.cancel = false; EX.busy = true; S.exporting = true; KS.emit('play');
    KS.V.exportBegin(W, H);
    let result = null;
    try {
      const MB = typeof VideoEncoder !== 'undefined' ? await EX.loadMB() : null;
      result = MB ? await viaCodecs(MB) : await viaRecorder();
    } finally {
      KS.V.exportEnd(); S.exporting = false; EX.busy = false; MD.pauseAll(); KS.emit('play'); KS.emit('view');
    }
    return result;

    async function viaCodecs(MB) {
      let ext = o.format === 'webm' ? 'webm' : 'mp4', note = '';
      let vcodec = await MB.getFirstEncodableVideoCodec(ext === 'webm' ? ['vp9', 'vp8', 'av1'] : ['avc'], { width: W, height: H });
      if (!vcodec && ext === 'mp4') { ext = 'webm'; vcodec = await MB.getFirstEncodableVideoCodec(['vp9', 'vp8', 'av1'], { width: W, height: H }); note = 'このブラウザは MP4 に書き出せないため、WebM にしました。'; }
      if (!vcodec) return viaRecorder();
      const q = { veryhigh: MB.QUALITY_VERY_HIGH, high: MB.QUALITY_HIGH, medium: MB.QUALITY_MEDIUM }[o.quality] || MB.QUALITY_HIGH;
      const output = new MB.Output({ format: ext === 'webm' ? new MB.WebMOutputFormat() : new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
      const vs = new MB.CanvasSource(G.canvas, { codec: vcodec, bitrate: q, keyFrameInterval: 2 });
      output.addVideoTrack(vs, { frameRate: fps });
      let as = null, mix = null;
      if (o.audio !== false) {
        onProgress(0, '音をまとめています');
        mix = await MD.mixdown(project, comp, t0, t1);
        if (mix) {
          const acodec = await MB.getFirstEncodableAudioCodec(ext === 'webm' ? ['opus', 'vorbis'] : ['aac', 'opus'], { numberOfChannels: mix.numberOfChannels, sampleRate: mix.sampleRate });
          if (acodec) { as = new MB.AudioBufferSource({ codec: acodec, bitrate: MB.QUALITY_HIGH }); output.addAudioTrack(as); if (ext === 'mp4' && acodec !== 'aac') note += ' このブラウザは AAC に書き出せないため、音は Opus で入っています（再生できないアプリがあります）。'; }
          else note += ' 音はこのブラウザで符号化できなかったため入っていません。';
        }
      }
      await output.start();
      R.resetProcesses();
      for (let i = 0; i < frames; i++) {
        if (EX.cancel) break;
        const t = t0 + i / fps;
        await MD.prepareFrame(project, comp, t);
        const rt = R.frame(project, comp, t, { res: scale, mb: true, exporting: true });
        R.flatten(rt, comp, null); G.release(rt); G.sweep();
        await vs.add(i / fps, 1 / fps);
        onProgress((i + 1) / frames, `${i + 1} / ${frames} コマ`);
        if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      if (EX.cancel) { try { await output.cancel(); } catch (e) { /* nothing to undo */ } return { canceled: true }; }
      if (as) { onProgress(1, '音を書き込んでいます'); await as.add(mix); }
      onProgress(1, 'ファイルを閉じています');
      await output.finalize();
      const blob = new Blob([output.target.buffer], { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' });
      return { blob, name: `${safe(comp.name)}-${stamp()}.${ext}`, note, w: W, h: H, frames, exact: true };
    }

    // no WebCodecs: play it through once and record the canvas
    async function viaRecorder() {
      if (!window.MediaRecorder || !G.canvas.captureStream) throw new Error('このブラウザは動画の書き出しに対応していません。静止画は保存できます');
      const types = (o.format === 'webm' ? [] : ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']).concat(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
      const mime = types.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
      const stream = G.canvas.captureStream(fps);
      let tap = null;
      if (o.audio !== false && MD.hasSound(comp) && MD.context()) { try { tap = MD.context().createMediaStreamDestination(); MD.masterNode().connect(tap); tap.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr)); } catch (e) { tap = null; } }
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: W >= 1600 ? 16e6 : 10e6 } : { videoBitsPerSecond: 10e6 });
      const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((res) => { rec.onstop = res; });
      R.resetProcesses();
      rec.start(250);
      MD.play(project, comp, t0, t1);
      await new Promise((res) => {
        const step = () => {
          const t = MD.time();
          if (EX.cancel || t === null || t >= t1) return res();
          const rt = R.frame(project, comp, t, { res: scale, mb: true, playing: true });
          R.flatten(rt, comp, null); G.release(rt); G.sweep(); MD.endFrame();
          onProgress((t - t0) / (t1 - t0), '再生しながら録画しています');
          requestAnimationFrame(step);
        };
        step();
      });
      MD.stop(); rec.stop(); await stopped;
      if (tap) { try { MD.masterNode().disconnect(tap); } catch (e) { /* fine */ } }
      if (EX.cancel) return { canceled: true };
      const type = rec.mimeType || mime || 'video/webm', ext = type.includes('mp4') ? 'mp4' : 'webm', blob = new Blob(chunks, { type });
      if (blob.size < 2048) throw new Error('録画が空でした。タブを表示したまま、もう一度お試しください');
      return { blob, name: `${safe(comp.name)}-${stamp()}.${ext}`, note: 'このブラウザでは再生しながらの録画になりました。', w: W, h: H, frames, exact: false };
    }
  };

  EX.still = async (alpha) => {
    const comp = KS.comp(), { px, w, h } = R.pixels(S.project, comp, S.t, { flat: !alpha, mb: true });
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    return { blob, name: `${safe(comp.name)}-${U.fmtTime(S.t, comp.fps).replace(/:/g, '')}.png` };
  };

  EX.projectFile = () => ({ blob: new Blob([JSON.stringify(S.project)], { type: 'application/json' }), name: `${safe(S.project.name)}.kasane.json` });
  EX.readProject = async (file) => {
    const p = JSON.parse(await file.text());
    if (!p || p.app !== 'kasane' || !Array.isArray(p.comps) || !p.comps.length) throw new Error('Kasane のプロジェクトファイルではありません');
    return p;
  };
})();
