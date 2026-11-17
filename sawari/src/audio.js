// Sawari audio: plays what the simulation says, with native Web Audio nodes only
// (buffer sources, gains, filters, delays, convolvers), so it stays light and
// stable in Safari and Chrome. The same Engine runs on a live AudioContext and on
// an OfflineAudioContext for WAV export. Every time it receives is an audio time.
const SAWARI_AUDIO = (() => {
  const C = SAWARI_CORE;
  const { clamp, lerp } = C;
  const HANN = (() => { const n = 64, a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.sin(Math.PI * i / (n - 1)) ** 2; return a; })();
  const dbg = db => Math.pow(10, db / 20);
  const MAX_VOICES = 90;

  // decaying, darkening stereo noise; seeded so exports repeat exactly
  function makeIR(ctx, size, damp, seed) {
    const sr = ctx.sampleRate, n = Math.max(1, Math.floor(clamp(size, 0.1, 9) * sr)), ir = ctx.createBuffer(2, n, sr), rng = C.makeRng(seed);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch); let y = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, env = Math.exp(-6.9 * t / size) * Math.min(1, t / 0.004 + 0.2);
        const a = clamp(1 - damp * 0.97 * Math.sqrt(t / size), 0.02, 1);
        y += a * ((rng() * 2 - 1) - y);
        d[i] = y * env * (i < sr * 0.012 ? 0.4 : 1);
      }
    }
    return ir;
  }
  const curveCache = new Map();
  function driveCurve(amt) {
    const q = Math.round(clamp(amt, 0, 1) * 20);
    if (curveCache.has('d' + q)) return curveCache.get('d' + q);
    const k = 1 + q * 1.4, n = 1024, c = new Float32Array(n), norm = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
    curveCache.set('d' + q, c); return c;
  }
  function crushCurve(bits) {
    const b = clamp(Math.round(bits), 1, 16), key = 'c' + b;
    if (curveCache.has(key)) return curveCache.get(key);
    const n = 4096, c = new Float32Array(n), steps = 2 ** b;
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.round(x * steps / 2) / (steps / 2); }
    curveCache.set(key, c); return c;
  }

  // ---- room effect units: {in, out, set(fx), stop()} ----
  function dryWet(c) {
    const i = c.createGain(), o = c.createGain(), dry = c.createGain(), wet = c.createGain();
    i.connect(dry); dry.connect(o); wet.connect(o);
    return { i, o, dry, wet, mix(m, t) { dry.gain.setTargetAtTime(1 - m, t, 0.02); wet.gain.setTargetAtTime(m, t, 0.02); } };
  }
  function makeUnit(eng, fx) {
    const c = eng.ctx, now = () => c.currentTime, beat = () => 60 / clamp(eng.w.bpm || 92, 20, 300);
    const T = fx.type;
    if (T === 'filter') {
      const b = c.createBiquadFilter();
      return { in: b, out: b, set(f) { b.type = f.ftype || 'lowpass'; b.frequency.setTargetAtTime(clamp(f.freq, 20, 20000), now(), 0.02); b.Q.setTargetAtTime(clamp(f.q, 0.1, 30), now(), 0.02); }, stop() {} };
    }
    if (T === 'drive') {
      const d = dryWet(c), pre = c.createGain(), sh = c.createWaveShaper(), lp = c.createBiquadFilter(), post = c.createGain();
      lp.type = 'lowpass'; sh.oversample = '2x';
      d.i.connect(pre); pre.connect(sh); sh.connect(lp); lp.connect(post); post.connect(d.wet);
      return { in: d.i, out: d.o, set(f) { sh.curve = driveCurve(f.amt); pre.gain.setTargetAtTime(1 + f.amt * 3, now(), 0.02); post.gain.setTargetAtTime(1 / (1 + f.amt * 1.5), now(), 0.02); lp.frequency.setTargetAtTime(clamp(f.tone, 200, 18000), now(), 0.02); d.mix(f.mix, now()); }, stop() {} };
    }
    if (T === 'delay') {
      const d = dryWet(c), dl = c.createDelay(6), lp = c.createBiquadFilter(), fb = c.createGain();
      lp.type = 'lowpass';
      d.i.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(d.wet);
      return { in: d.i, out: d.o, set(f) { const t = f.sync ? clamp(f.time, 0.0625, 4) * beat() : clamp(f.time, 0.01, 5.9); dl.delayTime.setTargetAtTime(clamp(t, 0.005, 5.9), now(), 0.05); fb.gain.setTargetAtTime(clamp(f.fb, 0, 0.95), now(), 0.02); lp.frequency.setTargetAtTime(clamp(f.tone, 200, 18000), now(), 0.02); d.mix(f.mix, now()); }, stop() {} };
    }
    if (T === 'verb') {
      const d = dryWet(c), cv = c.createConvolver(); let key = '';
      d.i.connect(cv); cv.connect(d.wet);
      return { in: d.i, out: d.o, set(f) { const k = f.size.toFixed(2) + '/' + f.damp.toFixed(2); if (k !== key) { key = k; cv.buffer = makeIR(c, f.size, f.damp, 777 + Math.round(f.size * 100)); } d.mix(f.mix, now()); }, stop() {} };
    }
    if (T === 'crush') {
      const d = dryWet(c), sh = c.createWaveShaper();
      d.i.connect(sh); sh.connect(d.wet);
      return { in: d.i, out: d.o, set(f) { sh.curve = crushCurve(f.bits); d.mix(f.mix, now()); }, stop() {} };
    }
    if (T === 'wobble') {
      const d = dryWet(c), dl = c.createDelay(0.1), fb = c.createGain(), osc = c.createOscillator(), dep = c.createGain();
      d.i.connect(dl); dl.connect(d.wet); dl.connect(fb); fb.connect(dl); osc.connect(dep); dep.connect(dl.delayTime);
      osc.start(eng.offline ? 0 : now());
      return { in: d.i, out: d.o, set(f) { osc.frequency.setTargetAtTime(clamp(f.rate, 0.02, 20), now(), 0.05); dl.delayTime.setTargetAtTime(0.004 + f.depth * 0.008, now(), 0.05); dep.gain.setTargetAtTime(f.depth * 0.0035, now(), 0.05); fb.gain.setTargetAtTime(clamp(f.fb, 0, 0.9), now(), 0.02); d.mix(f.mix, now()); }, stop() { try { osc.stop(); } catch (e) {} } };
    }
    if (T === 'ring') {
      const d = dryWet(c), rg = c.createGain(), osc = c.createOscillator();
      rg.gain.value = 0; d.i.connect(rg); rg.connect(d.wet); osc.connect(rg.gain); osc.start(eng.offline ? 0 : now());
      return { in: d.i, out: d.o, set(f) { osc.frequency.setTargetAtTime(clamp(f.freq, 1, 5000), now(), 0.03); d.mix(f.mix, now()); }, stop() { try { osc.stop(); } catch (e) {} } };
    }
    if (T === 'gate') {
      const vca = c.createGain(), osc = c.createOscillator(), dep = c.createGain();
      osc.type = 'square'; osc.connect(dep); dep.connect(vca.gain); osc.start(eng.offline ? 0 : now());
      return { in: vca, out: vca, set(f) { const hz = f.sync ? clamp(f.rate, 0.25, 16) / beat() : clamp(f.rate, 0.1, 40); osc.frequency.setTargetAtTime(hz, now(), 0.02); vca.gain.setTargetAtTime(1 - f.depth / 2, now(), 0.02); dep.gain.setTargetAtTime(f.depth / 2, now(), 0.02); }, stop() { try { osc.stop(); } catch (e) {} } };
    }
    const g = c.createGain(); return { in: g, out: g, set() {}, stop() {} };
  }

  class RoomChain {
    constructor(eng, room) { this.e = eng; this.in = eng.ctx.createGain(); this.out = eng.ctx.createGain(); this.out.connect(eng.out); this.units = []; this.sig = ''; this.sync(room); }
    sync(room) {
      const sig = room.fx.map(f => f.type + (f.on ? 1 : 0)).join(',');
      if (sig !== this.sig) {
        this.sig = sig;
        this.in.disconnect(); for (const u of this.units) { try { u.out.disconnect(); } catch (e) {} u.stop(); }
        this.units = room.fx.filter(f => f.on).map(f => { const u = makeUnit(this.e, f); u.fx = f; return u; });
        let n = this.in;
        for (const u of this.units) { n.connect(u.in); n = u.out; }
        n.connect(this.out);
      }
      const on = room.fx.filter(f => f.on);
      this.units.forEach((u, i) => { u.fx = on[i]; u.set(on[i]); });
    }
    dispose() { const t = this.e.ctx.currentTime; this.out.gain.setTargetAtTime(0, t, 0.05); setTimeout(() => { try { this.in.disconnect(); this.out.disconnect(); } catch (e) {} for (const u of this.units) u.stop(); }, 400); }
  }

  class Engine {
    constructor(ctx, world, opts = {}) {
      this.ctx = ctx; this.w = world; this.offline = !!opts.offline;
      this.srcs = opts.srcs || new Map();
      this.rng = C.makeRng(((world.seed || 1) ^ 0x51ed27) >>> 0);
      this.rooms = new Map(); this.loops = new Map(); this.tapes = new Map(); this.streams = []; this.live = new Set();
      this.find = opts.find || (id => this.w.objs.find(o => o.id === id));
      const c = ctx;
      this.out = c.createGain(); this.out.gain.value = world.master.vol;
      this.lim = c.createDynamicsCompressor();
      this.lim.threshold.value = -4; this.lim.knee.value = 4; this.lim.ratio.value = 16; this.lim.attack.value = 0.002; this.lim.release.value = 0.12;
      this.out.connect(this.lim); this.lim.connect(c.destination);
      this.dry = c.createGain(); this.dry.connect(this.out);
      // world delay: ping-pong
      this.dIn = c.createGain();
      this.dTone = c.createBiquadFilter(); this.dTone.type = 'lowpass';
      this.dTone.channelCount = 1; this.dTone.channelCountMode = 'explicit';
      this.dL = c.createDelay(6); this.dR = c.createDelay(6); this.fb1 = c.createGain(); this.fb2 = c.createGain();
      const mg = c.createChannelMerger(2);
      this.dIn.connect(this.dTone); this.dTone.connect(this.dL); this.dL.connect(this.fb1); this.fb1.connect(this.dR); this.dR.connect(this.fb2); this.fb2.connect(this.dL);
      this.dL.connect(mg, 0, 0); this.dR.connect(mg, 0, 1); mg.connect(this.out);
      // world reverb
      this.vIn = c.createGain(); this.conv = c.createConvolver(); this.vIn.connect(this.conv); this.conv.connect(this.out);
      this.vKey = '';
      this.syncMaster(); this.syncRooms();
    }
    setWorld(w) { this.w = w; this.syncMaster(); this.syncRooms(); }
    beat() { return 60 / clamp(this.w.bpm || 92, 20, 300); }
    syncMaster() {
      const m = this.w.master, t = this.ctx.currentTime;
      this.out.gain.setTargetAtTime(clamp(m.vol, 0, 1.5), t, 0.03);
      const dt = clamp(m.dBeats * this.beat(), 0.02, 5.9);
      this.dL.delayTime.setTargetAtTime(dt, t, 0.05); this.dR.delayTime.setTargetAtTime(dt, t, 0.05);
      this.fb1.gain.setTargetAtTime(clamp(m.dFb, 0, 0.92), t, 0.02); this.fb2.gain.setTargetAtTime(clamp(m.dFb, 0, 0.92), t, 0.02);
      this.dTone.frequency.setTargetAtTime(clamp(m.dTone, 200, 16000), t, 0.02);
      const k = m.vSize.toFixed(2) + '/' + m.vDamp.toFixed(2);
      if (k !== this.vKey) { this.vKey = k; this.conv.buffer = makeIR(this.ctx, m.vSize, m.vDamp, 4242); }
    }
    syncRooms() {
      const seen = new Set();
      for (const o of this.w.objs) if (o.kind === 'room') {
        seen.add(o.id);
        const r = this.rooms.get(o.id);
        if (r) r.sync(o); else this.rooms.set(o.id, new RoomChain(this, o));
      }
      for (const [id, r] of this.rooms) if (!seen.has(id)) { r.dispose(); this.rooms.delete(id); }
    }
    dest(roomId) { const r = roomId && this.rooms.get(roomId); return r ? r.in : this.dry; }

    // ---- per-voice chains ----
    // one-shots: only the nodes a voice needs
    chain(P, dest) {
      const c = this.ctx, nodes = [];
      const env = c.createGain(); env.gain.value = 0; nodes.push(env);
      let n = env;
      if (P.drive > 0.02) { const sh = c.createWaveShaper(); sh.curve = driveCurve(P.drive); sh.oversample = '2x'; n.connect(sh); n = sh; nodes.push(sh); }
      if (Math.abs(P.tone) > 0.02) {
        const bq = c.createBiquadFilter();
        if (P.tone < 0) { bq.type = 'lowpass'; bq.frequency.value = clamp(18000 * 2 ** (P.tone * 7.2), 60, 20000); }
        else { bq.type = 'highpass'; bq.frequency.value = clamp(25 * 2 ** (P.tone * 8.2), 20, 12000); }
        bq.Q.value = 0.85; n.connect(bq); n = bq; nodes.push(bq);
      }
      if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(P.pan, -1, 1); n.connect(p); n = p; nodes.push(p); }
      const vol = c.createGain(); vol.gain.value = dbg(P.vol) / (1 + P.drive * 1.5); n.connect(vol); nodes.push(vol);
      vol.connect(dest);
      if (P.dly > 0.01) { const s = c.createGain(); s.gain.value = P.dly; vol.connect(s); s.connect(this.dIn); nodes.push(s); }
      if (P.verb > 0.01) { const s = c.createGain(); s.gain.value = P.verb; vol.connect(s); s.connect(this.vIn); nodes.push(s); }
      return { env, nodes, dispose() { for (const x of nodes) { try { x.disconnect(); } catch (e) {} } } };
    }
    // continuous voices (loops, tape readers): every stage present so it can glide
    contChain(dest, at) {
      const c = this.ctx, nodes = [];
      const mk = (n) => { nodes.push(n); return n; };
      const env = mk(c.createGain()); env.gain.value = 0;
      const dryG = mk(c.createGain()), wetG = mk(c.createGain()), sh = mk(c.createWaveShaper()), sum = mk(c.createGain());
      sh.curve = driveCurve(0.6); wetG.gain.value = 0;
      env.connect(dryG); dryG.connect(sum); env.connect(sh); sh.connect(wetG); wetG.connect(sum);
      const lp = mk(c.createBiquadFilter()), hp = mk(c.createBiquadFilter());
      lp.type = 'lowpass'; lp.frequency.value = 20000; hp.type = 'highpass'; hp.frequency.value = 10;
      sum.connect(lp); lp.connect(hp);
      let n = hp, pan = null;
      if (c.createStereoPanner) { pan = mk(c.createStereoPanner()); n.connect(pan); n = pan; }
      const vol = mk(c.createGain()); n.connect(vol);
      const sd = mk(c.createGain()), sv = mk(c.createGain()); sd.gain.value = 0; sv.gain.value = 0;
      vol.connect(sd); sd.connect(this.dIn); vol.connect(sv); sv.connect(this.vIn);
      const route = mk(c.createGain()); vol.connect(route); route.connect(dest);
      const ch = { env, vol, dryG, wetG, lp, hp, pan, sd, sv, route, dest, nodes, extra: [] };
      ch.set = (P, t, tc = 0.04) => {
        const tone = P.tone;
        lp.frequency.setTargetAtTime(tone < 0 ? clamp(18000 * 2 ** (tone * 7.2), 60, 20000) : 20000, t, tc);
        hp.frequency.setTargetAtTime(tone > 0 ? clamp(25 * 2 ** (tone * 8.2), 20, 12000) : 10, t, tc);
        dryG.gain.setTargetAtTime(1 - P.drive, t, tc); wetG.gain.setTargetAtTime(P.drive, t, tc);
        if (pan) pan.pan.setTargetAtTime(clamp(P.pan, -1, 1), t, tc);
        vol.gain.setTargetAtTime(dbg(P.vol) / (1 + P.drive * 1.5), t, tc);
        sd.gain.setTargetAtTime(P.dly, t, tc); sv.gain.setTargetAtTime(P.verb, t, tc);
      };
      ch.reroute = (d, t) => {
        if (d === ch.dest) return;
        const r2 = c.createGain(); r2.gain.value = 0; vol.connect(r2); r2.connect(d); r2.gain.setTargetAtTime(1, t, 0.03);
        const old = ch.route; old.gain.setTargetAtTime(0, t, 0.03);
        if (!this.offline) setTimeout(() => { try { old.disconnect(); } catch (e) {} }, 400);
        ch.route = r2; ch.dest = d; nodes.push(r2);
      };
      ch.dispose = () => { for (const x of nodes) { try { x.disconnect(); } catch (e) {} } for (const x of ch.extra) { try { x.disconnect(); } catch (e) {} } };
      return ch;
    }
    // region in buffer seconds for parameters P
    region(f, src, P) {
      const A = clamp(f.a, 0, src.dur), B = clamp(f.b, A + 0.005, src.dur), L = B - A;
      const a = A + clamp(P.start, 0, 0.95) * L;
      const len = Math.max(0.01, Math.min(B - a, clamp(P.len, 0.02, 1) * L));
      return { a, len };
    }
    grain(t, src, pos, gdur, rate, rev, dest, amp = 1) {
      const c = this.ctx, s = c.createBufferSource();
      s.buffer = rev ? src.rev : src.buf; s.playbackRate.value = rate;
      gdur = Math.min(gdur, src.dur * 0.98);
      pos = clamp(pos, 0, Math.max(0, src.dur - gdur));
      const off = rev ? Math.max(0, src.dur - pos - gdur) : pos;
      const g = c.createGain(); g.gain.value = 0;
      const real = gdur / rate;
      if (amp === 1) g.gain.setValueCurveAtTime(HANN, t, real);
      else { const cv = new Float32Array(HANN.length); for (let i = 0; i < cv.length; i++) cv[i] = HANN[i] * amp; g.gain.setValueCurveAtTime(cv, t, real); }
      s.connect(g); g.connect(dest);
      s.start(t, off, gdur);
      if (!this.offline) s.onended = () => { try { g.disconnect(); } catch (e) {} };
    }

    // ---- events ----
    handle(ev, at) {
      if (!ev || ev.silent) return;
      const f = this.find(ev.id);
      if (!f) return;
      const src = this.srcs.get(f.src);
      if (!src) return;
      const P = ev.P;
      at += P.lag || 0;
      if (!this.offline && at < this.ctx.currentTime - 0.05) return; // stale after a stall
      at = Math.max(at, this.offline ? 0 : this.ctx.currentTime);
      if (ev.loop) { const lp = this.loops.get(f.id); if (lp) { lp.restart(at); return; } }
      if (this.load() > MAX_VOICES) return;
      const { a, len } = this.region(f, src, P);
      const rev = P.rev > 0.5;
      const rate = 2 ** (P.rate / 12);
      const grainy = P.grain > 0.03 || Math.abs(P.pitch) > 0.05 || Math.abs(P.stretch) > 0.03;
      const dest = this.dest(ev.room);
      const ch = this.chain(P, dest);
      if (!grainy) {
        const s = this.ctx.createBufferSource();
        s.buffer = rev ? src.rev : src.buf; s.playbackRate.value = rate;
        const off = rev ? Math.max(0, src.dur - (a + len)) : a, D = len / rate;
        const fin = clamp(P.fin / 1000, 0.002, D * 0.5), fout = clamp(P.fout / 1000, 0.003, D * 0.5);
        const g = ch.env.gain;
        g.setValueAtTime(0, at); g.linearRampToValueAtTime(1, at + fin); g.setValueAtTime(1, at + D - fout); g.linearRampToValueAtTime(0, at + D);
        s.connect(ch.env); s.start(at, off, len); s.stop(at + D + 0.02);
        const rec = { s, ch, t: at, end: at + D };
        if (!this.offline) { this.live.add(rec); s.onended = () => { this.live.delete(rec); ch.dispose(); }; }
      } else {
        const readRate = rate / 2 ** P.stretch, pitchRate = 2 ** ((P.rate + P.pitch) / 12);
        const D = len / readRate, gr = P.grain;
        const size = lerp(0.085, 0.04, gr), hop = size * lerp(0.5, 2.4, gr);
        const fin = clamp(P.fin / 1000, 0.003, D * 0.5), fout = clamp(P.fout / 1000, 0.005, D * 0.5);
        const g = ch.env.gain;
        g.setValueAtTime(0, at); g.linearRampToValueAtTime(1, at + fin); g.setValueAtTime(1, at + D - fout + size); g.linearRampToValueAtTime(0, at + D + size);
        this.streams.push({ t0: at, t1: at + D, next: at, src, a, len, readRate, pitchRate, rev, size, hop, spray: P.spray * (0.3 + gr), ch, kind: 'once' });
      }
    }
    // tape: a reader inside a fragment plays grains at its position
    contact(c, at) {
      const f = this.find(c.id); if (!f) return;
      const src = this.srcs.get(f.src); if (!src) return;
      at = Math.max(at, this.offline ? 0 : this.ctx.currentTime);
      let v = this.tapes.get(c.key);
      const dest = this.dest(c.room);
      if (!v) {
        if (this.load() > MAX_VOICES) return;
        v = { ch: this.contChain(dest, at), next: at, last: at, f };
        v.ch.env.gain.setTargetAtTime(1, at, 0.01);
        this.tapes.set(c.key, v);
      }
      v.last = at;
      v.ch.set(c.P, at);
      v.ch.reroute(dest, at);
      if (at + 1e-4 >= v.next) {
        const P = c.P, A = clamp(f.a, 0, src.dur), B = clamp(f.b, A + 0.005, src.dur);
        const pitchRate = 2 ** ((P.rate + P.pitch) / 12), gr = P.grain;
        const size = lerp(0.075, 0.035, gr), gdur = size * pitchRate;
        const rev = (c.dir < 0) !== (P.rev > 0.5);
        let pos = A + c.pos * (B - A) - gdur / 2 + (this.rng() - 0.5) * P.spray * 0.06;
        pos = clamp(pos, A, Math.max(A, B - gdur));
        this.grain(Math.max(at, v.next), src, pos, gdur, pitchRate, rev, v.ch.env, clamp(0.6 + c.energy * 0.6, 0, 1.2));
        v.next = Math.max(at, v.next) + size * lerp(0.42, 1.6, gr) * (1 + (this.rng() - 0.5) * P.spray);
      }
    }
    // loops: create, update, or retire continuous voices to match the states
    controlLoops(states, at) {
      const seen = new Set();
      for (const s of states) {
        seen.add(s.id);
        const src = this.srcs.get(s.f.src); if (!src) continue;
        let lp = this.loops.get(s.id);
        if (!lp) { lp = new Loop(this, s, src, at); this.loops.set(s.id, lp); }
        else lp.update(s, at);
      }
      for (const [id, lp] of this.loops) if (!seen.has(id)) { lp.stop(at); this.loops.delete(id); }
    }
    // schedule grains up to `until`; retire finished voices
    advance(until) {
      const keep = [];
      for (const st of this.streams) {
        while (!st.dead && st.next < until && st.next < st.t1) {
          const prog = (st.next - st.t0) * st.readRate, gdur = st.size * st.pitchRate;
          let pos = st.rev ? st.a + st.len - prog - gdur : st.a + prog;
          pos += (this.rng() - 0.5) * st.spray * (0.03 + st.len * 0.35);
          this.grain(st.next, st.src, pos, gdur, st.pitchRate, st.rev, st.ch.env);
          st.next += st.hop * (1 + (this.rng() - 0.5) * st.spray * 0.9);
        }
        if (st.next >= st.t1 || st.dead) {
          if (!this.offline) { const ch = st.ch, ms = Math.max(0, (st.t1 - this.ctx.currentTime) * 1000) + 600; setTimeout(() => ch.dispose(), ms); }
        } else keep.push(st);
      }
      this.streams = keep;
      for (const lp of this.loops.values()) lp.advance(until);
      if (!this.offline) {
        const now = this.ctx.currentTime;
        for (const [k, v] of this.tapes) if (v.last < now - 0.25) {
          v.ch.env.gain.setTargetAtTime(0, Math.max(now, v.last + 0.1), 0.03);
          const ch = v.ch; setTimeout(() => ch.dispose(), 600);
          this.tapes.delete(k);
        }
      } else {
        for (const [k, v] of this.tapes) if (v.last < until - 0.35) { v.ch.env.gain.setTargetAtTime(0, v.last + 0.1, 0.03); this.tapes.delete(k); }
      }
    }
    // pause/stop: silence everything that is running or already scheduled
    hush(at) {
      at = at ?? this.ctx.currentTime;
      for (const r of this.live) { try { r.ch.env.gain.cancelScheduledValues(at); r.ch.env.gain.setTargetAtTime(0, at, 0.015); r.s.stop(at + 0.08); } catch (e) {} }
      for (const st of this.streams) { st.dead = true; try { st.ch.env.gain.cancelScheduledValues(at); st.ch.env.gain.setTargetAtTime(0, at, 0.015); } catch (e) {} }
      this.advance(at);
      for (const lp of this.loops.values()) lp.stop(at);
      this.loops.clear();
      for (const v of this.tapes.values()) { v.ch.env.gain.setTargetAtTime(0, at, 0.02); const ch = v.ch; if (!this.offline) setTimeout(() => ch.dispose(), 500); }
      this.tapes.clear();
    }
    load() { return this.live.size + this.streams.length + this.tapes.size; }
    // preview a stretch of a source directly (inspector, library)
    audition(src, a, b, rev) {
      const c = this.ctx, s = c.createBufferSource(), g = c.createGain(), t = c.currentTime + 0.01, len = Math.max(0.01, b - a);
      s.buffer = rev ? src.rev : src.buf; s.connect(g); g.connect(this.dry);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9, t + 0.004); g.gain.setValueAtTime(0.9, t + Math.max(0.005, len - 0.02)); g.gain.linearRampToValueAtTime(0, t + len);
      s.start(t, rev ? src.dur - b : a, len);
      s.onended = () => { try { g.disconnect(); } catch (e) {} };
      if (this.auditioning) try { this.auditioning.stop(); } catch (e) {}
      this.auditioning = s;
      return { t, len };
    }
  }

  // a fragment that keeps sounding: native looping source (cheap, seamless rate glides)
  // crossfaded with a grain layer when pitch, stretch or grain ask for it
  class Loop {
    constructor(eng, s, src, at) {
      this.e = eng; this.src = src; this.id = s.id;
      this.ch = eng.contChain(eng.dest(s.room), at);
      const c = eng.ctx;
      this.plain = c.createGain(); this.grains = c.createGain(); this.plain.gain.value = 1; this.grains.gain.value = 0;
      this.plain.connect(this.ch.env); this.grains.connect(this.ch.env);
      this.ch.extra.push(this.plain, this.grains);
      this.ch.env.gain.setValueAtTime(0, at); this.ch.env.gain.setTargetAtTime(1, at, 0.06);
      this.rev = false; this.node = null; this.ph = 0; this.lastT = at; this.region = null; this.P = s.P;
      this.update(s, at, true);
    }
    snapRegion(f, P) {
      const r = this.e.region(f, this.src, P);
      const key = r.a.toFixed(4) + '/' + r.len.toFixed(4);
      if (this.region && this.region.key === key) return this.region;
      let a = r.a, b = r.a + r.len;
      if (this.src.mono) { a = SAWARI_CODEC.zeroCross(this.src.mono, this.src.sr, a); b = SAWARI_CODEC.zeroCross(this.src.mono, this.src.sr, b); }
      if (b - a < 0.01) { a = r.a; b = r.a + Math.max(0.01, r.len); }
      return { a, b, key };
    }
    newNode(at, rev, region, rate) {
      const c = this.e.ctx, s = c.createBufferSource(), d = this.src.dur;
      s.buffer = rev ? this.src.rev : this.src.buf; s.loop = true;
      const ls = rev ? d - region.b : region.a, le = rev ? d - region.a : region.b;
      s.loopStart = ls; s.loopEnd = le; s.playbackRate.value = rate;
      const g = c.createGain(); g.gain.value = 0; s.connect(g); g.connect(this.plain);
      g.gain.setTargetAtTime(1, at, 0.012);
      s.start(at, ls);
      return { s, g };
    }
    retire(n, at) { if (!n) return; n.g.gain.cancelScheduledValues(at); n.g.gain.setTargetAtTime(0, at, 0.012); try { n.s.stop(at + 0.1); } catch (e) {} if (!this.e.offline) n.s.onended = () => { try { n.g.disconnect(); } catch (e) {} }; }
    update(s, at, first) {
      const P = s.P, f = s.f; this.P = P; this.f = f;
      const rev = P.rev > 0.5, rate = 2 ** (P.rate / 12), region = this.snapRegion(f, P);
      if (first || rev !== this.rev) { this.retire(this.node, at); this.node = this.newNode(at, rev, region, rate); this.rev = rev; }
      else {
        this.node.s.playbackRate.setTargetAtTime(rate, at, 0.03);
        if (region !== this.region) { const d = this.src.dur; this.node.s.loopStart = rev ? d - region.b : region.a; this.node.s.loopEnd = rev ? d - region.a : region.b; }
      }
      this.region = region;
      this.ch.set(P, at);
      this.ch.reroute(this.e.dest(s.room), at);
      const gm = clamp(P.grain * 1.6 + (Math.abs(P.pitch) > 0.1 ? 1 : 0) + (Math.abs(P.stretch) > 0.05 ? 1 : 0), 0, 1);
      this.plain.gain.setTargetAtTime(1 - gm, at, 0.05); this.grains.gain.setTargetAtTime(gm, at, 0.05);
      this.gm = gm;
    }
    restart(at) { this.retire(this.node, at); this.node = this.newNode(at, this.rev, this.region, 2 ** (this.P.rate / 12)); this.ph = 0; }
    advance(until) {
      const P = this.P, r = this.region; if (!r) return;
      const len = r.b - r.a, readRate = 2 ** (P.rate / 12) / 2 ** P.stretch;
      if (this.gm < 0.01) { this.ph = (this.ph + (until - this.lastT) * readRate) % len; this.lastT = until; this.next = until; return; }
      if (this.next === undefined || this.next < this.lastT) this.next = this.lastT;
      const gr = P.grain, size = lerp(0.085, 0.04, gr), hop = size * lerp(0.5, 2.4, gr), pitchRate = 2 ** ((P.rate + P.pitch) / 12);
      while (this.next < until) {
        const gdur = size * pitchRate;
        this.ph = (this.ph + hop * readRate) % len;
        let pos = this.rev ? r.b - this.ph - gdur : r.a + this.ph;
        pos += (this.e.rng() - 0.5) * P.spray * (0.03 + len * 0.3);
        this.e.grain(this.next, this.src, pos, gdur, pitchRate, this.rev, this.grains);
        this.next += hop * (1 + (this.e.rng() - 0.5) * P.spray * 0.9);
      }
      this.lastT = until;
    }
    stop(at) {
      this.ch.env.gain.cancelScheduledValues(at); this.ch.env.gain.setTargetAtTime(0, at, 0.04);
      this.gm = 0;
      if (this.node) try { this.node.s.stop(at + 0.4); } catch (e) {}
      if (!this.e.offline) { const ch = this.ch; setTimeout(() => ch.dispose(), Math.max(0, (at - this.e.ctx.currentTime) * 1000) + 700); }
    }
  }

  // make the source record the engine needs from decoded channels
  function makeSource(ctx, id, ch, sr) {
    const n = ch[0].length, nc = Math.min(2, ch.length);
    const buf = ctx.createBuffer(nc, Math.max(1, n), sr), rev = ctx.createBuffer(nc, Math.max(1, n), sr);
    for (let k = 0; k < nc; k++) {
      buf.copyToChannel(ch[k], k);
      const r = new Float32Array(n), d = ch[k];
      for (let i = 0; i < n; i++) r[i] = d[n - 1 - i];
      rev.copyToChannel(r, k);
    }
    const mono = SAWARI_CODEC.mono(ch.slice(0, nc));
    return { id, buf, rev, dur: n / sr, sr, mono, peaks: SAWARI_CODEC.peaks(mono, 600) };
  }

  return { Engine, makeIR, makeSource, HANN };
})();
