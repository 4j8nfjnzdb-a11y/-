/* =========================================================
   M2TS / MTS / TS  →  MP4 remuxer (no re-encode)
   Reads an MPEG transport stream (188-byte TS or 192-byte BDAV/AVCHD m2ts),
   pulls H.264 / HEVC video and AAC / AC-3 audio out of the PES packets, and
   writes a plain MP4 the browser's <video> can seek in. Video is copied as-is.
   ========================================================= */
const TSRemux = (() => {
  class Bits {
    constructor(u8) { this.b = u8; this.p = 0; }
    u(n) { let v = 0; for (let i = 0; i < n; i++) { v = v * 2 + ((this.b[this.p >> 3] >> (7 - (this.p & 7))) & 1); this.p++; } return v; }
    ue() { let z = 0; while (this.u(1) === 0 && z < 31) z++; return z ? Math.pow(2, z) - 1 + this.u(z) : 0; }
    se() { const k = this.ue(); return k & 1 ? (k + 1) / 2 : -(k / 2); }
    skip(n) { this.p += n; }
  }
  // remove emulation-prevention bytes (00 00 03)
  function rbsp(nal) {
    const o = new Uint8Array(nal.length); let n = 0, z = 0;
    for (let i = 0; i < nal.length; i++) { const c = nal[i]; if (z >= 2 && c === 3) { z = 0; continue; } o[n++] = c; z = c === 0 ? z + 1 : 0; }
    return o.subarray(0, n);
  }
  function splitNal(d) {
    const out = []; let i = 0, s = -1; const n = d.length;
    while (i + 2 < n) {
      if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1) {
        if (s >= 0) { let e = i; while (e > s && d[e - 1] === 0) e--; if (e > s) out.push(d.subarray(s, e)); }
        i += 3; s = i;
      } else i++;
    }
    if (s >= 0 && s < n) out.push(d.subarray(s, n));
    return out;
  }
  const SAR = [[1,1],[1,1],[12,11],[10,11],[16,11],[40,33],[24,11],[20,11],[32,11],[80,33],[18,11],[15,11],[64,33],[160,99],[4,3],[3,2],[2,1]];
  function avcSps(nal) {
    const r = new Bits(rbsp(nal)); r.skip(8);
    const prof = r.u(8); r.skip(8); r.u(8); r.ue();
    let cf = 1;
    if ([100,110,122,244,44,83,86,118,128,138,139,134,135].includes(prof)) {
      cf = r.ue(); if (cf === 3) r.skip(1); r.ue(); r.ue(); r.skip(1);
      if (r.u(1)) for (let i = 0; i < (cf !== 3 ? 8 : 12); i++) if (r.u(1)) {
        const sz = i < 6 ? 16 : 64; let last = 8, next = 8;
        for (let j = 0; j < sz; j++) { if (next !== 0) next = (last + r.se() + 256) % 256; last = next === 0 ? last : next; }
      }
    }
    r.ue();
    const poc = r.ue();
    if (poc === 0) r.ue(); else if (poc === 1) { r.skip(1); r.se(); r.se(); const n = r.ue(); for (let i = 0; i < n; i++) r.se(); }
    r.ue(); r.skip(1);
    const wmb = r.ue() + 1, hmu = r.ue() + 1; const fmo = r.u(1); if (!fmo) r.skip(1); r.skip(1);
    let cl = 0, cr = 0, ct = 0, cb = 0; if (r.u(1)) { cl = r.ue(); cr = r.ue(); ct = r.ue(); cb = r.ue(); }
    const ux = cf === 0 || cf === 3 ? 1 : 2, uy = (cf === 1 ? 2 : 1) * (2 - fmo);
    const w = wmb * 16 - (cl + cr) * ux, h = (2 - fmo) * hmu * 16 - (ct + cb) * uy;
    let sarW = 1, sarH = 1;
    if (r.u(1) && r.u(1)) { const idc = r.u(8); if (idc === 255) { sarW = r.u(16); sarH = r.u(16); } else if (SAR[idc]) [sarW, sarH] = SAR[idc]; }
    return { w, h, sarW: sarW || 1, sarH: sarH || 1, prof, cf };
  }
  function hevcSps(nal) {
    const rb = rbsp(nal); const r = new Bits(rb); r.skip(16); r.skip(4);
    const msl = r.u(3); r.skip(1);
    const ptl = rb.slice(3, 15); r.skip(96);
    const sp = [], sl = []; for (let i = 0; i < msl; i++) { sp.push(r.u(1)); sl.push(r.u(1)); }
    if (msl > 0) for (let i = msl; i < 8; i++) r.skip(2);
    for (let i = 0; i < msl; i++) { if (sp[i]) r.skip(88); if (sl[i]) r.skip(8); }
    r.ue(); const cf = r.ue(); if (cf === 3) r.skip(1);
    let w = r.ue(), h = r.ue();
    if (r.u(1)) { const sx = cf === 1 || cf === 2 ? 2 : 1, sy = cf === 1 ? 2 : 1; const a = r.ue(), b = r.ue(), c = r.ue(), d = r.ue(); w -= (a + b) * sx; h -= (c + d) * sy; }
    const bdl = r.ue(), bdc = r.ue();
    return { w, h, sarW: 1, sarH: 1, ptl, cf, bdl, bdc };
  }
  function avcSliceIsI(nal) { try { const r = new Bits(nal.subarray(0, 16)); r.skip(8); r.ue(); const t = r.ue() % 5; return t === 2 || t === 4; } catch (e) { return false; } }

  /* ---------- MP4 box writing ---------- */
  function u8(...a) { return new Uint8Array(a); }
  function u16(v) { return u8((v >> 8) & 255, v & 255); }
  function u32(v) { return u8((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); }
  function i32(v) { return u32(v >>> 0); }
  function str(s) { return new Uint8Array([...s].map(c => c.charCodeAt(0))); }
  function cat(parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let off = 0; for (const p of parts) { o.set(p, off); off += p.length; } return o; }
  function box(type, ...parts) { const body = cat(parts); const o = new Uint8Array(8 + body.length); new DataView(o.buffer).setUint32(0, o.length); o.set(str(type), 4); o.set(body, 8); return o; }
  function full(type, ver, flags, ...parts) { return box(type, u8(ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts); }
  function arr32(vals) { const o = new Uint8Array(vals.length * 4); const dv = new DataView(o.buffer); vals.forEach((v, i) => dv.setUint32(i * 4, v >>> 0)); return o; }
  function arr64(vals) { const o = new Uint8Array(vals.length * 8); const dv = new DataView(o.buffer); vals.forEach((v, i) => { dv.setUint32(i * 8, Math.floor(v / 4294967296)); dv.setUint32(i * 8 + 4, v >>> 0); }); return o; }
  const MATRIX = cat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);
  const zeros = n => new Uint8Array(n);

  function stts(durs) { // run-length
    const runs = []; for (const d of durs) { const l = runs[runs.length - 1]; if (l && l[1] === d) l[0]++; else runs.push([1, d]); }
    return full('stts', 0, 0, u32(runs.length), arr32(runs.flat()));
  }
  function ctts(offs) {
    const runs = []; for (const d of offs) { const l = runs[runs.length - 1]; if (l && l[1] === d) l[0]++; else runs.push([1, d]); }
    return full('ctts', 0, 0, u32(runs.length), arr32(runs.flat()));
  }
  function stbl(entry, t, offsets, co64) {
    const parts = [full('stsd', 0, 0, u32(1), entry), stts(t.durs)];
    if (t.ctts && t.ctts.some(x => x)) parts.push(ctts(t.ctts));
    if (t.sync) parts.push(full('stss', 0, 0, u32(t.sync.length), arr32(t.sync)));
    parts.push(full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)));
    parts.push(full('stsz', 0, 0, u32(0), u32(t.sizes.length), arr32(t.sizes)));
    parts.push(co64 ? full('co64', 0, 0, u32(offsets.length), arr64(offsets)) : full('stco', 0, 0, u32(offsets.length), arr32(offsets)));
    return box('stbl', ...parts);
  }
  function trak(id, t, entry, offsets, co64, movieDur) {
    const isV = t.kind === 'v';
    const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(movieDur), zeros(8), u16(0), u16(0), u16(isV ? 0 : 0x100), u16(0), MATRIX,
      u32(isV ? Math.round(t.dispW * 65536) : 0), u32(isV ? Math.round(t.h * 65536) : 0));
    const edts = t.elst ? box('edts', full('elst', 0, 0, u32(t.elst.length), ...t.elst.map(e => cat([u32(e[0]), i32(e[1]), u32(0x10000)])))) : new Uint8Array(0);
    const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(t.timescale), u32(t.mediaDur), u16(0x55c4), u16(0));
    const hdlr = full('hdlr', 0, 0, u32(0), str(isV ? 'vide' : 'soun'), zeros(12), str(isV ? 'VideoHandler\0' : 'SoundHandler\0'));
    const mh = isV ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, zeros(4));
    const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
    return box('trak', tkhd, edts, box('mdia', mdhd, hdlr, box('minf', mh, dinf, stbl(entry, t, offsets, co64))));
  }
  function videoEntry(t) {
    const cfg = t.codec === 'avc'
      ? box('avcC', u8(1, t.sps[1], t.sps[2], t.sps[3], 0xff, 0xe1), u16(t.sps.length), t.sps, u8(1), u16(t.pps.length), t.pps)
      : hvcC(t);
    const pasp = t.sarW !== t.sarH ? box('pasp', u32(t.sarW), u32(t.sarH)) : new Uint8Array(0);
    const name = zeros(32);
    return box(t.codec === 'avc' ? 'avc1' : 'hvc1', zeros(6), u16(1), zeros(16), u16(t.w), u16(t.h), u32(0x480000), u32(0x480000), u32(0), u16(1), name, u16(0x18), u16(0xffff), cfg, pasp);
  }
  function hvcC(t) {
    const p = t.info.ptl; const arrs = [[32, t.vps], [33, t.sps], [34, t.pps]].filter(a => a[1]);
    return box('hvcC', u8(1, p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], 0xf0, 0x00, 0xfc, 0xfc | (t.info.cf & 3), 0xf8 | (t.info.bdl & 7), 0xf8 | (t.info.bdc & 7), 0, 0, 0x0f, arrs.length),
      ...arrs.map(([ty, n]) => cat([u8(0x80 | ty), u16(1), u16(n.length), n])));
  }
  function audioEntry(t) {
    const head = [zeros(6), u16(1), zeros(8), u16(t.channels), u16(16), u16(0), u16(0), u32((t.rate & 0xffff) * 65536)];
    if (t.codec === 'aac') {
      const asc = t.asc;
      const dsi = cat([u8(5, asc.length), asc]);
      const dcd = cat([u8(4, 13 + dsi.length, 0x40, 0x15, 0, 0, 0), u32(0), u32(0), dsi]);
      const esd = cat([u8(3, 3 + dcd.length + 3), u16(1), u8(0), dcd, u8(6, 1, 2)]);
      return box('mp4a', ...head, full('esds', 0, 0, esd));
    }
    return box('ac-3', ...head, box('dac3', t.dac3));
  }

  /* ---------- audio frame parsers ---------- */
  const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const AC3_RATES = [48000, 44100, 32000];
  const AC3_SIZE = [
    [64,64,80,80,96,96,112,112,128,128,160,160,192,192,224,224,256,256,320,320,384,384,448,448,512,512,640,640,768,768,896,896,1024,1024,1152,1152,1280,1280],
    [69,70,87,88,104,105,121,122,139,140,174,175,208,209,243,244,278,279,348,349,417,418,487,488,557,558,696,697,835,836,975,976,1114,1115,1253,1254,1393,1394],
    [96,96,120,120,144,144,168,168,192,192,240,240,288,288,336,336,384,384,480,480,576,576,672,672,768,768,960,960,1152,1152,1344,1344,1536,1536,1728,1728,1920,1920]];

  function readPts(b, o) { return ((b[o] >> 1) & 7) * 1073741824 + ((b[o + 1] << 22) | ((b[o + 2] >> 1) << 15) | (b[o + 3] << 7) | (b[o + 4] >> 1)); }

  const VTYPES = { 0x1b: 'avc', 0x24: 'hevc', 0x01: 'mpeg2', 0x02: 'mpeg2', 0x10: 'mpeg4', 0xea: 'vc1' };

  async function remux(file, onProgress) {
    const size = file.size;
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    let pk = 0, start = -1;
    for (let o = 0; o < 600 && start < 0; o++) {
      for (const k of [188, 192]) { const lead = k - 188; if (head[o + lead] === 0x47 && head[o + lead + k] === 0x47 && head[o + lead + 2 * k] === 0x47) { pk = k; start = o; break; } }
    }
    if (start < 0) throw new Error('トランスポートストリームとして読めませんでした。');
    let pmt = -1, vpid = -1, apid = -1, vcodec = null, acodec = null;
    const v = { kind: 'v', codec: null, samples: [], sps: null, pps: null, vps: null, info: null };
    const a = { kind: 'a', codec: null, frames: [], firstPts: null, rem: null, remPts: null };
    const pes = new Map();
    let unsupportedAudio = null;

    function flushVideo(st) {
      if (!st.parts.length) return; const d = cat(st.parts); st.parts = [];
      const nals = splitNal(d); const keep = []; let key = false, isI = false, firstSlice = true;
      for (const n of nals) {
        if (!n.length) continue;
        if (vcodec === 'avc') {
          const t = n[0] & 31;
          if (t === 7) { if (!v.sps) { v.sps = n.slice(); v.info = avcSps(v.sps); } continue; }
          if (t === 8) { if (!v.pps) v.pps = n.slice(); continue; }
          if (t === 9 || t === 12) continue;
          if (t === 5) key = true;
          if ((t === 1 || t === 5) && firstSlice) { firstSlice = false; if (t === 1 && avcSliceIsI(n)) isI = true; }
        } else {
          const t = (n[0] >> 1) & 63;
          if (t === 32) { if (!v.vps) v.vps = n.slice(); continue; }
          if (t === 33) { if (!v.sps) { v.sps = n.slice(); v.info = hevcSps(v.sps); } continue; }
          if (t === 34) { if (!v.pps) v.pps = n.slice(); continue; }
          if (t === 35 || t === 38) continue;
          if (t >= 16 && t <= 21) key = true;
        }
        keep.push(n);
      }
      if (!keep.length) return;
      let n = 0; for (const k of keep) n += 4 + k.length;
      const out = new Uint8Array(n); const dv = new DataView(out.buffer); let o = 0;
      for (const k of keep) { dv.setUint32(o, k.length); out.set(k, o + 4); o += 4 + k.length; }
      v.samples.push({ data: out, pts: st.pts, dts: st.dts != null ? st.dts : st.pts, key, isI });
    }
    function feedAudio(st) {
      if (!st.parts.length) return; let d = cat(st.parts); st.parts = [];
      if (a.firstPts == null && st.pts != null) a.firstPts = st.pts;
      if (a.rem) { const m = new Uint8Array(a.rem.length + d.length); m.set(a.rem); m.set(d, a.rem.length); d = m; a.rem = null; }
      let i = 0;
      if (acodec === 'aac') {
        while (i + 7 <= d.length) {
          if (!(d[i] === 0xff && (d[i + 1] & 0xf6) === 0xf0)) { i++; continue; }
          const len = ((d[i + 3] & 3) << 11) | (d[i + 4] << 3) | (d[i + 5] >> 5); const hl = (d[i + 1] & 1) ? 7 : 9;
          if (len < hl) { i++; continue; }
          if (i + len > d.length) break;
          if (!a.asc) {
            const aot = (d[i + 2] >> 6) + 1, sfi = (d[i + 2] >> 2) & 15, ch = ((d[i + 2] & 1) << 2) | (d[i + 3] >> 6);
            a.asc = u8((aot << 3) | (sfi >> 1), ((sfi & 1) << 7) | (ch << 3)); a.rate = AAC_RATES[sfi] || 48000; a.channels = ch || 2; a.spf = 1024;
          }
          a.frames.push(d.slice(i + hl, i + len)); i += len;
        }
      } else if (acodec === 'ac3') {
        while (i + 7 <= d.length) {
          if (!(d[i] === 0x0b && d[i + 1] === 0x77)) { i++; continue; }
          const fs = d[i + 4] >> 6, fc = d[i + 4] & 0x3f;
          if (fs > 2 || fc > 37) { i++; continue; }
          const len = AC3_SIZE[fs][fc] * 2; if (i + len > d.length) break;
          if (!a.dac3) {
            const bsid = d[i + 5] >> 3, bsmod = d[i + 5] & 7; const r = new Bits(d.subarray(i + 6, i + 8));
            const acmod = r.u(3); if ((acmod & 1) && acmod !== 1) r.skip(2); if (acmod & 4) r.skip(2); if (acmod === 2) r.skip(2); const lfe = r.u(1);
            const bits = (fs << 22) | (bsid << 17) | (bsmod << 14) | (acmod << 11) | (lfe << 10) | ((fc >> 1) << 5);
            a.dac3 = u8((bits >> 16) & 255, (bits >> 8) & 255, bits & 255); a.rate = AC3_RATES[fs]; a.channels = [2, 1, 2, 3, 3, 4, 4, 5][acmod] + lfe; a.spf = 1536;
          }
          a.frames.push(d.slice(i, i + len)); i += len;
        }
      }
      if (i < d.length) a.rem = d.slice(i);
    }
    function flush(pid) { const st = pes.get(pid); if (!st) return; if (pid === vpid) flushVideo(st); else if (pid === apid) feedAudio(st); }

    function packet(b, o) {
      const pid = ((b[o + 1] & 0x1f) << 8) | b[o + 2]; const pusi = b[o + 1] & 0x40; const afc = (b[o + 3] >> 4) & 3;
      if (!(afc & 1)) return;
      let p = o + 4; if (afc & 2) p += 1 + b[o + 4]; const end = o + 188; if (p >= end) return;
      if (pid === 0) {
        if (!pusi || pmt >= 0) return; p += 1 + b[p];
        const sl = ((b[p + 1] & 0x0f) << 8) | b[p + 2]; const e = Math.min(end, p + 3 + sl - 4);
        for (let q = p + 8; q + 4 <= e; q += 4) { const prog = (b[q] << 8) | b[q + 1]; if (prog !== 0) { pmt = ((b[q + 2] & 0x1f) << 8) | b[q + 3]; break; } }
        return;
      }
      if (pid === pmt) {
        if (!pusi || vpid >= 0) return; p += 1 + b[p];
        const sl = ((b[p + 1] & 0x0f) << 8) | b[p + 2]; const e = Math.min(end, p + 3 + sl - 4);
        const pil = ((b[p + 10] & 0x0f) << 8) | b[p + 11];
        for (let q = p + 12 + pil; q + 5 <= e;) {
          const st = b[q], ep = ((b[q + 1] & 0x1f) << 8) | b[q + 2], il = ((b[q + 3] & 0x0f) << 8) | b[q + 4];
          let desc = null; for (let k = q + 5; k + 2 <= q + 5 + il; k += 2 + b[k + 1]) { const tag = b[k]; if (tag === 0x6a) desc = 'ac3'; else if (tag === 0x7a) desc = 'eac3'; else if (tag === 0x05 && b[k + 2] === 0x41 && b[k + 3] === 0x43 && b[k + 4] === 0x2d && b[k + 5] === 0x33) desc = 'ac3'; }
          if (vpid < 0 && VTYPES[st]) { vpid = ep; vcodec = VTYPES[st]; }
          else if (apid < 0) {
            const ac = st === 0x0f ? 'aac' : (st === 0x81 || (st === 0x06 && desc === 'ac3')) ? 'ac3' : null;
            if (ac) { apid = ep; acodec = ac; }
            else if (!unsupportedAudio) unsupportedAudio = st === 0x80 ? 'LPCM' : st === 0x03 || st === 0x04 ? 'MPEG オーディオ' : st === 0x87 || desc === 'eac3' ? 'E-AC-3' : null;
          }
          q += 5 + il;
        }
        if (vpid >= 0 && vcodec !== 'avc' && vcodec !== 'hevc') {
          const nm = { mpeg2: 'MPEG-2（HDV / DVD など）', mpeg4: 'MPEG-4 Part 2', vc1: 'VC-1' }[vcodec];
          throw new Error(`この ${file.name} の映像は ${nm} です。ブラウザでは H.264 / HEVC の m2ts しか扱えないので、H.264 に変換してから読み込んでください。`);
        }
        return;
      }
      if (pid !== vpid && pid !== apid) return;
      let st = pes.get(pid); if (!st) { st = { parts: [], pts: null, dts: null }; pes.set(pid, st); }
      if (pusi) {
        flush(pid);
        if (b[p] === 0 && b[p + 1] === 0 && b[p + 2] === 1) {
          const fl = b[p + 7], hl = b[p + 8];
          st.pts = fl & 0x80 ? readPts(b, p + 9) : null; st.dts = (fl & 0xc0) === 0xc0 ? readPts(b, p + 14) : null;
          p += 9 + hl;
        }
      }
      if (p < end) st.parts.push(b.slice(p, end));
    }

    const CH = 4 << 20; let off = start, rem = null, lastProg = 0;
    while (off < size) {
      const buf = new Uint8Array(await file.slice(off, Math.min(size, off + CH)).arrayBuffer()); off += buf.length;
      let b = buf; if (rem) { b = new Uint8Array(rem.length + buf.length); b.set(rem); b.set(buf, rem.length); rem = null; }
      const lead = pk - 188; let i = 0;
      while (i + pk <= b.length) { if (b[i + lead] !== 0x47) { i++; continue; } packet(b, i + lead); i += pk; }
      if (i < b.length) rem = b.slice(i);
      if (onProgress && off - lastProg > 16 << 20) { lastProg = off; onProgress(off / size); await new Promise(r => setTimeout(r, 0)); }
    }
    if (vpid >= 0) flush(vpid); if (apid >= 0) flush(apid);
    if (vpid < 0) throw new Error('映像トラックが見つかりませんでした。');
    if (!v.sps || !v.pps || !v.info) throw new Error('映像の設定情報（SPS/PPS）が見つかりませんでした。');
    v.codec = vcodec;

    // drop leading samples until the first random-access frame
    let first = v.samples.findIndex(s => s.key); if (first < 0) first = v.samples.findIndex(s => s.isI);
    if (first < 0) throw new Error('キーフレームが見つかりませんでした。');
    const S = v.samples.slice(first); const hasIdr = S.some(s => s.key);
    // unwrap / repair timestamps
    let offTs = 0, prev = null, lastDur = 3003;
    for (const s of S) {
      if (s.dts == null) s.dts = prev != null ? prev + lastDur - offTs : 0;
      if (s.pts == null) s.pts = s.dts;
      let d = s.dts + offTs;
      if (prev != null) {
        let delta = d - prev;
        if (delta < -4294967296) { offTs += 8589934592; d += 8589934592; delta = d - prev; }
        if (delta <= 0 || delta > 450000) { const fix = prev + lastDur - d; offTs += fix; d += fix; } else lastDur = delta;
      }
      s.D = d; s.P = s.pts + offTs; if (s.P < s.D) s.P = s.D; prev = d;
    }
    const d0 = S[0].D; const durs = [], cts = [], sizes = [], sync = [];
    let minP = Infinity, maxE = 0;
    S.forEach((s, i) => {
      durs.push(i + 1 < S.length ? S[i + 1].D - s.D : (durs[i - 1] || 3003)); cts.push(s.P - s.D); sizes.push(s.data.length);
      if (hasIdr ? s.key : s.isI) sync.push(i + 1); if (s.P < minP) minP = s.P;
    });
    S.forEach((s, i) => { maxE = Math.max(maxE, s.P + durs[i]); });
    const vMedia = durs.reduce((x, y) => x + y, 0);
    const info = v.info; const dispW = info.w * info.sarW / info.sarH;
    const VT = { kind: 'v', codec: vcodec, timescale: 90000, durs, ctts: cts, sizes, sync, mediaDur: vMedia, w: info.w, h: info.h, dispW, sarW: info.sarW, sarH: info.sarH, sps: v.sps, pps: v.pps, vps: v.vps, info, data: S.map(s => s.data) };
    const startShift = minP - d0; // composition time of the first shown frame
    const span = Math.max(1, maxE - minP);
    VT.elst = [[span, startShift]];

    let AT = null;
    if (apid >= 0 && a.frames.length && a.rate) {
      const n = a.frames.length; const ad = new Array(n).fill(a.spf);
      AT = { kind: 'a', codec: acodec, timescale: a.rate, durs: ad, sizes: a.frames.map(f => f.length), mediaDur: n * a.spf, rate: a.rate, channels: a.channels, asc: a.asc, dac3: a.dac3, data: a.frames };
      // align audio to the first shown video frame (both in 90 kHz before conversion)
      const delta = a.firstPts != null ? (a.firstPts - (S[0].pts + (startShift))) : 0;
      const mv = Math.round(AT.mediaDur * 90000 / a.rate);
      if (delta > 0 && delta < 90000 * 10) AT.elst = [[Math.round(delta), -1], [mv, 0]];
      else if (delta < 0 && delta > -90000 * 10) { const mt = Math.round(-delta * a.rate / 90000); AT.elst = [[Math.max(1, mv - Math.round(-delta)), mt]]; }
    }

    function build(withAudio) {
      const tracks = [VT]; if (withAudio && AT) tracks.push(AT);
      const mdatSize = tracks.reduce((s, t) => s + t.sizes.reduce((x, y) => x + y, 0), 0);
      const co64 = mdatSize > 4000000000; const large = mdatSize + 16 > 4294967295;
      const ftyp = box('ftyp', str('isom'), u32(0x200), str('isomiso2avc1mp41'));
      const movieDur = Math.round(span);
      const make = base => {
        let pos = base; const traks = tracks.map((t, i) => { const offs = []; for (const s of t.sizes) { offs.push(pos); pos += s; } const e = t.kind === 'v' ? videoEntry(t) : audioEntry(t); return trak(i + 1, t, e, offs, co64, movieDur); });
        return box('moov', full('mvhd', 0, 0, u32(0), u32(0), u32(90000), u32(movieDur), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(tracks.length + 1)), ...traks);
      };
      const hdr = large ? cat([u32(1), str('mdat'), arr64([mdatSize + 16])]) : cat([u32(mdatSize + 8), str('mdat')]);
      const probe = make(0); const moov = make(ftyp.length + probe.length + hdr.length);
      const parts = [ftyp, moov, hdr]; for (const t of tracks) for (const d of t.data) parts.push(d);
      return new Blob(parts, { type: 'video/mp4' });
    }
    if (onProgress) onProgress(1);
    return {
      build, hasAudio: !!AT,
      info: { vcodec, acodec: AT ? acodec : null, unsupportedAudio: !AT ? (unsupportedAudio || (apid >= 0 ? acodec : null)) : null, w: info.w, h: info.h, dispW: Math.round(dispW), frames: S.length, duration: vMedia / 90000, packet: pk }
    };
  }
  return { remux };
})();
if (typeof module !== 'undefined') module.exports = TSRemux;
