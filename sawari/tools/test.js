// Offline tests for Sawari's pure parts (geometry, codecs, simulation). Usage: node tools/test.js
const C = require('../src/core.js');
const K = require('../src/codec.js');
const W = require('../src/world.js');
const results = [];
const test = (label, ok, info = '') => results.push([ok ? 'ok  ' : 'FAIL', label, info]);

(async () => {
  // ---- core ----
  {
    const a = C.makeRng(5), b = C.makeRng(5), xs = [], ys = [];
    for (let i = 0; i < 100; i++) { xs.push(a()); ys.push(b()); }
    test('seeded rng repeats', xs.every((x, i) => x === ys[i]) && xs.every(x => x >= 0 && x < 1));
    const r = { pts: [[0, 0], [100, 0], [100, 100]], closed: false };
    const g = C.railGeom(r);
    test('rail length', Math.abs(g.L - 200) < 1e-9, g.L);
    const p = C.railPoint(r, 150);
    test('rail point', Math.abs(p.x - 100) < 1e-9 && Math.abs(p.y - 50) < 1e-9, `${p.x},${p.y}`);
    const n = C.railNearest(r, 50, 20);
    test('rail nearest', Math.abs(n.s - 50) < 1e-9 && Math.abs(n.d - 20) < 1e-9, `${n.s} ${n.d}`);
    test('rail cache is not serialised', !JSON.stringify(r).includes('_g'));
  }

  // ---- codecs ----
  {
    const sr = 44100, n = 1000, L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = Math.sin(i / 10) * 0.8; R[i] = Math.cos(i / 13) * 0.5; }
    for (const bits of [16, 24]) {
      const wav = K.encodeWav([L, R], sr, bits), back = K.parseWav(wav.buffer);
      let err = 0; for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(back.ch[0][i] - L[i]), Math.abs(back.ch[1][i] - R[i]));
      test(`wav ${bits}-bit round trip`, back.sr === sr && back.ch.length === 2 && err < (bits === 16 ? 1e-4 : 1e-6), `max err ${err.toExponential(2)}`);
    }
    // AIFF (big-endian 16-bit) and AIFC sowt, built by hand
    const mkAiff = (form, comp, le) => {
      const frames = n, nch = 2, dataLen = frames * nch * 2, commLen = form === 'AIFC' ? 24 : 18;
      const total = 4 + 8 + commLen + 8 + 8 + dataLen + (form === 'AIFC' ? 12 : 0);
      const buf = new ArrayBuffer(8 + total), dv = new DataView(buf); let o = 0;
      const tag = s => { for (let i = 0; i < 4; i++) dv.setUint8(o++, s.charCodeAt(i)); };
      tag('FORM'); dv.setUint32(o, total); o += 4; tag(form);
      if (form === 'AIFC') { tag('FVER'); dv.setUint32(o, 4); o += 4; dv.setUint32(o, 0xA2805140); o += 4; }
      tag('COMM'); dv.setUint32(o, commLen); o += 4; dv.setInt16(o, nch); o += 2; dv.setUint32(o, frames); o += 4; dv.setInt16(o, 16); o += 2;
      // 44100 as 80-bit extended
      dv.setUint16(o, 0x400E); dv.setUint32(o + 2, 0xAC440000); dv.setUint32(o + 6, 0); o += 10;
      if (form === 'AIFC') { tag(comp); dv.setUint16(o, 0); o += 2; }
      tag('SSND'); dv.setUint32(o, 8 + dataLen); o += 4; dv.setUint32(o, 0); o += 4; dv.setUint32(o, 0); o += 4;
      for (let i = 0; i < frames; i++) { dv.setInt16(o, Math.round(L[i] * 32767), le); o += 2; dv.setInt16(o, Math.round(R[i] * 32767), le); o += 2; }
      return buf;
    };
    for (const [form, comp, le] of [['AIFF', null, false], ['AIFC', 'sowt', true], ['AIFC', 'NONE', false]]) {
      const a = K.parseAiff(mkAiff(form, comp, le));
      let err = 0; for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(a.ch[0][i] - L[i]));
      test(`aiff parse ${form}${comp ? ' ' + comp : ''}`, a && Math.abs(a.sr - 44100) < 1e-6 && a.ch[0].length === n && err < 1e-4, `sr ${a && a.sr} err ${err.toExponential(2)}`);
    }
    test('aiff parser ignores non-aiff', K.parseAiff(new ArrayBuffer(64)) === null);
    const z = K.zipStore([{ name: 'sawari.json', data: K.encText('{"a":1}') }, { name: 'audio/x.wav', data: new Uint8Array([1, 2, 3, 250]) }]);
    const m = await K.unzip(z.buffer);
    test('zip round trip', K.decText(m.get('sawari.json')) === '{"a":1}' && m.get('audio/x.wav').join(',') === '1,2,3,250');
    // onsets on clicks every 0.25 s
    const s2 = 48000, mono = new Float32Array(s2 * 2);
    for (let k = 0; k < 8; k++) { const at = Math.round((0.1 + k * 0.25) * s2); for (let i = 0; i < 2000; i++) mono[at + i] = Math.sin(i / 3) * Math.exp(-i / 300); }
    const on = K.onsets(mono, s2, 0, 2, 32);
    test('onsets find the clicks', on.length >= 6 && on.length <= 9, on.map(t => t.toFixed(2)).join(' '));
  }

  // ---- simulation ----
  const mkWorld = () => {
    const w = W.newWorld(1234);
    w.objs = [];
    w.sources = [{ id: 'a1', name: 'x', dur: 1 }];
    return w;
  };
  const frag = (w, x, y, extra = {}) => { const f = W.newFrag('a1', 0, 1, x, y, C.makeRng(1)); f.r = 20; Object.assign(f, extra); w.objs.push(f); return f; };
  const run = (sim, sec) => { const ev = []; while (sim.T < sec - 1e-9) ev.push(...sim.step()); return ev; };
  {
    // ripple: hit time = emission + (distance - 0.7 r) / speed
    const w = mkWorld(); const rp = W.newRipple(0, 0); rp.sync = false; rp.period = 10; rp.speed = 200; rp.reach = 1000; w.objs.push(rp);
    const f = frag(w, 300, 0); f.p.prob = 1;
    const sim = new W.Sim(w), ev = run(sim, 3);
    const want = (300 - 20 * 0.7) / 200;
    test('ripple hits at distance / speed', ev.length === 1 && Math.abs(ev[0].t - want) < 1e-9, ev.map(e => e.t.toFixed(4)).join(','));
  }
  {
    // train on a closed rail hits a fragment once per lap per car
    const w = mkWorld(); const rail = W.newRail(C.circlePts(0, 0, 200, 64), true); w.objs.push(rail);
    const tr = W.newTrain(rail.id, 0); tr.speed = 400; tr.cars = 2; tr.reach = 40; w.objs.push(tr);
    frag(w, 0, 210);
    const sim = new W.Sim(w), L = C.railGeom(rail).L, ev = run(sim, L / 400 * 3 + 0.01);
    test('train: 2 cars x 3 laps = 6 hits', ev.length === 6, `${ev.length} hits, lap ${(L / 400).toFixed(3)}s`);
    const gaps = ev.slice(1).map((e, i) => e.t - ev[i].t);
    test('train: car spacing = gap / speed', Math.abs(gaps[0] - 50 / 400) < 1e-6, gaps.map(g => g.toFixed(3)).join(','));
  }
  {
    // open rail bounces: a fragment in the middle is passed twice per round trip
    const w = mkWorld(); const rail = W.newRail([[-300, 0], [300, 0]], false); w.objs.push(rail);
    const tr = W.newTrain(rail.id, 0); tr.speed = 600; tr.cars = 1; w.objs.push(tr);
    frag(w, 0, 10);
    const sim = new W.Sim(w), ev = run(sim, 2.0 + 0.01);
    test('train: bounce passes twice per round trip', ev.length === 2, ev.map(e => e.t.toFixed(3)).join(','));
  }
  {
    // radar sweep with period 4 s hits each fragment once per turn, at its angle
    const w = mkWorld(); const sw = W.newSweep(0, 0); sw.sync = false; sw.period = 4; sw.r = 400; sw.ang0 = 0; sw.dir = 1; w.objs.push(sw);
    frag(w, 0, 200); // angle +90deg -> quarter turn -> t = 1 s
    const sim = new W.Sim(w), ev = run(sim, 8.5);
    test('sweep: angle is time', ev.length === 2 && Math.abs(ev[0].t - 1) < 1e-6 && Math.abs(ev[1].t - 5) < 1e-6, ev.map(e => e.t.toFixed(3)).join(','));
  }
  {
    // line scan: position along the width is the time within the period
    const w = mkWorld(); const sc = W.newScan(0, 0, 800, 200); sc.sync = false; sc.period = 8; w.objs.push(sc);
    frag(w, 200, 0); // 3/4 across -> 6 s
    const sim = new W.Sim(w), ev = run(sim, 9);
    test('scan: x is time', ev.length === 1 && Math.abs(ev[0].t - 6) < 1e-6, ev.map(e => e.t.toFixed(3)).join(','));
  }
  {
    // thread: A then B after length / threadSpeed
    const w = mkWorld(); const rp = W.newRipple(0, 0); rp.sync = false; rp.period = 100; rp.speed = 1000; rp.reach = 120; w.objs.push(rp);
    const a = frag(w, 50, 0), b = frag(w, 50, 500); // b is outside the ripple's reach
    const th = W.newThread(a.id, b.id); th.prob = 1; w.objs.push(th); w.threadSpeed = 250;
    const sim = new W.Sim(w), ev = run(sim, 4);
    const ea = ev.find(e => e.id === a.id), eb = ev.find(e => e.id === b.id);
    test('thread: B follows A by length / speed', ea && eb && Math.abs((eb.t - ea.t) - 500 / 250) < 1e-6, ea && eb ? (eb.t - ea.t).toFixed(4) : 'missing');
  }
  {
    // laws: size -> vol moves volume by span * 2 * (feature - 0.5) * amount
    const w = mkWorld(); w.laws[0].m = { 'size>vol': 1 }; w.ear.mode = 'off';
    const small = frag(w, 0, 0, { r: 8 }), big = frag(w, 800, 0, { r: 240 });
    const sim = new W.Sim(w);
    const ps = sim.probe(small).P.vol, pb = sim.probe(big).P.vol;
    test('law size>vol: small quieter, big louder, symmetric', Math.abs(ps + 18) < 1e-6 && Math.abs(pb - 12) < 1e-6, `${ps} ${pb}`);
    small.law = -1;
    test('law "none" leaves the base value', sim.probe(small).P.vol === 0);
  }
  {
    // determinism: same seed, same world -> same events (incl. flocks and chance)
    const make = () => {
      const w = W.newWorld(77); w.sources = [{ id: 'a1', name: 'x', dur: 1 }];
      const rng = C.makeRng(3);
      for (let i = 0; i < 30; i++) { const f = W.newFrag('a1', 0, 1, (rng() - 0.5) * 1600, (rng() - 0.5) * 1000, rng); f.id = 'f' + i; f.p.prob = 0.7; f.mut = 0.5; w.objs.push(f); }
      w.objs.forEach((o, i) => { if (o.kind !== 'frag') o.id = 'o' + i; if (o.kind === 'train') o.rail = w.objs.find(r => r.kind === 'rail').id; });
      return w;
    };
    const sig = w => { const s = new W.Sim(w); return run(s, 20).map(e => e.id + '@' + e.t.toFixed(5) + (e.silent ? 's' : '')).join('|'); };
    const s1 = sig(make()), s2 = sig(make());
    test('same seed gives the same piece', s1 === s2 && s1.length > 0, `${s1.split('|').length} events`);
    const w3 = make(); w3.seed = 78;
    test('another seed gives another piece', sig(w3) !== s1);
  }
  {
    // tape: a train passing over a tape fragment yields contacts that sweep its position
    const w = mkWorld(); const rail = W.newRail([[-400, 0], [400, 0]], false); w.objs.push(rail);
    const tr = W.newTrain(rail.id, 0); tr.speed = 200; tr.cars = 1; w.objs.push(tr);
    const f = frag(w, 0, 0, { mode: 'tape', ang: 0, r: 80 });
    const sim = new W.Sim(w); const pos = [];
    while (sim.T < 3) { sim.step(); for (const c of sim.contacts) if (c.id === f.id) pos.push(c.pos); }
    test('tape: contacts read forward across the strip', pos.length > 50 && pos[0] < 0.1 && pos[pos.length - 1] > 0.9 && pos.every((p, i) => !i || p >= pos[i - 1]), `${pos.length} contacts ${pos[0]?.toFixed(2)}..${pos[pos.length - 1]?.toFixed(2)}`);
    f.ang = Math.PI;
    const sim2 = new W.Sim(w); const pos2 = [], dir2 = [];
    while (sim2.T < 3) { sim2.step(); for (const c of sim2.contacts) if (c.id === f.id) { pos2.push(c.pos); dir2.push(c.dir); } }
    test('tape: turning the strip 180° reads it backwards', pos2[0] > 0.9 && dir2.every(d => d === -1), `${pos2[0]?.toFixed(2)} dir ${dir2[0]}`);
  }

  {
    // unipolar sources: at rest they change nothing
    const w = mkWorld(); w.ear.mode = 'off'; w.laws[0].m = { 'motion>pitch': 1, 'near>grain': 1, 'crowd>rate': 1, 'room>verb': 1 };
    const f = frag(w, 0, 0); const sim = new W.Sim(w); const P = sim.probe(f).P;
    test('resting fragment: motion/near/crowd/room laws add nothing', P.pitch === 0 && P.grain === 0 && P.rate === 0 && Math.abs(P.verb - 0.12) < 1e-9, `${P.pitch} ${P.grain} ${P.rate} ${P.verb}`);
  }
  {
    // the ear: farther is quieter and darker, side gives pan, a building muffles
    const w = mkWorld(); w.laws[0].m = {}; w.ear = { mode: 'view', x: 0, y: 0, r: 600, amt: 1 };
    const near = frag(w, 50, 0), far = frag(w, 1200, 0), left = frag(w, -400, 0);
    const sim = new W.Sim(w), pn = sim.probe(near).P, pf = sim.probe(far).P, pl = sim.probe(left).P;
    test('ear: far is quieter and darker', pf.vol < pn.vol - 10 && pf.tone < pn.tone - 0.2, `${pn.vol.toFixed(1)}/${pf.vol.toFixed(1)} dB, tone ${pn.tone.toFixed(2)}/${pf.tone.toFixed(2)}`);
    test('ear: left of the ear pans left', pl.pan < -0.5 && pn.pan > 0, `${pl.pan.toFixed(2)} ${pn.pan.toFixed(2)}`);
    const wall = W.newThing(600, 0, C.makeRng(1), 'tower'); wall.r = 60; w.objs.push(wall); sim.index(); sim.refresh();
    const po = sim.probe(far).P;
    test('ear: a building between ear and fragment muffles it', po.tone < pf.tone - 0.2 && po.vol < pf.vol - 3, `tone ${pf.tone.toFixed(2)}→${po.tone.toFixed(2)}`);
    w.ear.x = 1200; sim.refresh();
    test('ear: moving the ear changes the mix', sim.probe(far).P.vol > pf.vol + 10);
  }
  {
    // train: cars play the chord; the train bends the pitch as it leaves
    const w = mkWorld(); w.ear.mode = 'off'; w.laws[0].m = {};
    const rail = W.newRail([[-600, 0], [600, 0]], false); w.objs.push(rail);
    const tr = W.newTrain(rail.id, 0); tr.speed = 300; tr.cars = 3; tr.chord = 'chord'; tr.doppler = 0.8; w.objs.push(tr);
    const f = frag(w, 0, 20);
    const sim = new W.Sim(w), ev = run(sim, 2.5).filter(e => e.via === 'train');
    test('train: each car plays its own interval (0, 4, 7)', ev.length >= 3 && ev[0].mod.st === 0 && ev[1].mod.st === 4 && ev[2].mod.st === 7, ev.map(e => e.mod.st).join(','));
    const s2 = new W.Sim(w); run(s2, 0.6); // head has passed x=0 at t=2s? speed 300, starts at -600 -> reaches 0 at 2s
    const s3 = new W.Sim(w); run(s3, 1.0);
    const before = s3.bend({ k: 'train', id: tr.id, car: 0 }, f.id, s3.T);
    const s4 = new W.Sim(w); run(s4, 3.0);
    const after = s4.bend({ k: 'train', id: tr.id, car: 0 }, f.id, s4.T);
    test('train: doppler rises while approaching, falls while leaving', before > 1 && after < -1, `${before.toFixed(2)} / ${after.toFixed(2)} st`);
  }
  {
    // radar: angle = scale degree; scan: height = pitch
    const w = mkWorld(); w.ear.mode = 'off'; w.laws[0].m = {};
    const sw = W.newSweep(0, 0); sw.sync = false; sw.period = 4; sw.ang0 = -Math.PI / 2; sw.range = 12; sw.scale = 'penta'; w.objs.push(sw);
    frag(w, 0, -200); frag(w, 200, 0); frag(w, 0, 200);   // 0, quarter, half turn
    const sim = new W.Sim(w), ev = run(sim, 4.2).sort((a, b) => a.t - b.t);
    const sts = ev.map(e => e.mod.st);
    test('sweep: angle snaps to the pentatonic scale (quarter→2, half→7, full turn→0)', sts.length === 3 && sts[0] === 2 && sts[1] === 7 && sts[2] === 0, sts.join(','));
    const w2 = mkWorld(); w2.ear.mode = 'off'; w2.laws[0].m = {};
    const sc = W.newScan(0, 0, 800, 400); sc.sync = false; sc.period = 4; sc.range = 24; sc.scale = 'chrom'; w2.objs.push(sc);
    frag(w2, -100, -200 + 1); frag(w2, 100, 200 - 1);
    const ev2 = run(new W.Sim(w2), 4.1).sort((a, b) => a.t - b.t);
    test('scan: top is high, bottom is low', ev2.length === 2 && ev2[0].mod.st === 12 && ev2[1].mod.st === -12, ev2.map(e => e.mod.st).join(','));
    test('scan: those pitches reach the sound (rate)', Math.abs(ev2[0].P.rate - 12) < 1e-9 && Math.abs(ev2[1].P.rate + 12) < 1e-9);
  }
  {
    // ripple: farther fragments sound darker and wetter; successive rings read further in
    const w = mkWorld(); w.ear.mode = 'off'; w.laws[0].m = {};
    const rp = W.newRipple(0, 0); rp.sync = false; rp.period = 1; rp.speed = 500; rp.reach = 800; rp.dark = 1; rp.adv = 0.3; w.objs.push(rp);
    const a = frag(w, 100, 0), b = frag(w, 700, 0);
    const ev = run(new W.Sim(w), 2.95);
    const ea = ev.filter(e => e.id === a.id), eb = ev.filter(e => e.id === b.id);
    test('ripple: far is darker and wetter', eb[0].P.tone < ea[0].P.tone - 0.4 && eb[0].P.verb > ea[0].P.verb + 0.2, `tone ${ea[0].P.tone.toFixed(2)}/${eb[0].P.tone.toFixed(2)}`);
    test('ripple: each ring starts the sound further in', ea.length >= 3 && new Set(ea.map(e => e.P.start.toFixed(3))).size === ea.length, ea.map(e => e.P.start.toFixed(2)).join(','));
  }
  {
    // thread: each hop transposes by its step
    const w = mkWorld(); w.ear.mode = 'off'; w.laws[0].m = {}; w.threadSpeed = 1000;
    const rp = W.newRipple(0, 0); rp.sync = false; rp.period = 100; rp.speed = 1000; rp.reach = 100; w.objs.push(rp);
    const a = frag(w, 30, 0), b = frag(w, 30, 300), c = frag(w, 30, 600);
    const t1 = W.newThread(a.id, b.id), t2 = W.newThread(b.id, c.id); t1.prob = t2.prob = 1; t1.step = 7; t2.step = 5; w.objs.push(t1, t2);
    const ev = run(new W.Sim(w), 2);
    const r = id => ev.find(e => e.id === id).P.rate;
    test('thread: hops climb by their steps (0, +7, +12)', r(a.id) === 0 && r(b.id) === 7 && r(c.id) === 12, `${r(a.id)} ${r(b.id)} ${r(c.id)}`);
  }
  {
    // rooms: the deeper inside, the more of the sound goes through the room
    const w = mkWorld(); w.ear.mode = 'off';
    const m = W.newRoom(0, 0, 600, 600); w.objs.push(m);
    const edge = frag(w, 290, 0), mid = frag(w, 200, 0), deep = frag(w, 0, 0), out = frag(w, 500, 0);
    const sim = new W.Sim(w), wt = f => sim.probe(f).P.roomW;
    test('room: weight grows with depth (0 outside, 1 deep inside)', wt(out) === 0 && wt(edge) < 0.2 && wt(mid) > wt(edge) && wt(deep) === 1, [out, edge, mid, deep].map(f => wt(f).toFixed(2)).join(' '));
  }
  {
    // knobs reach every fragment that follows the law, live
    const w = mkWorld(); w.ear.mode = 'off'; w.laws[0].m = { 'knobA>tone': 1 };
    const f = frag(w, 0, 0); const sim = new W.Sim(w);
    const t0 = sim.probe(f).P.tone; w.circuit.knobs[0].v = 0; const t1 = sim.probe(f).P.tone; w.circuit.knobs[0].v = 1; const t2 = sim.probe(f).P.tone;
    test('knob A sweeps the tone through the law', t0 === 0 && t1 === -1 && t2 === 1, `${t1} ${t0} ${t2}`);
    sim.ext.bend = 1; w.circuit.pb = 2;
    test('pitch bend raises every rate', sim.probe(f).P.rate === 2);
  }
  {
    // older saves gain the new fields
    const old = JSON.parse(JSON.stringify(W.newWorld(5))); delete old.ear; delete old.circuit; old.objs.forEach(o => { delete o.chord; delete o.dark; delete o.range; delete o.song; delete o.step; });
    const n = W.normalize(old);
    test('normalize fills ear, circuit and activator characters', n.ear.mode === 'view' && n.circuit.knobs.length === 4 && n.objs.filter(o => o.kind === 'train').every(o => o.chord === 'chord'));
  }
  {
    // world survives JSON (undo / save)
    const w = W.newWorld(3), j = JSON.stringify(w), w2 = JSON.parse(j);
    const s = new W.Sim(w2); run(s, 1);
    test('world round-trips through JSON and runs', JSON.stringify(w2).length > 100);
  }

  let fail = 0;
  for (const [s, l, i] of results) { console.log(s, l, i === '' ? '' : `(${i})`); if (s === 'FAIL') fail++; }
  console.log(fail ? `\n${fail} failed` : `\nall ${results.length} passed`);
  process.exit(fail ? 1 : 0);
})();
