// Sawari codec: AIFF/WAV parsing (Chrome cannot decode AIFF itself), WAV writing,
// a small ZIP reader/writer for project files, and analysis helpers
// (onsets for slicing, zero crossings for click-free loops, peaks for drawing).
const SAWARI_CODEC = (() => {
  const td = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  const te = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const tag = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

  // 80-bit IEEE extended (AIFF sample rate)
  function ext80(dv, o) {
    const se = dv.getUint16(o), hi = dv.getUint32(o + 2), lo = dv.getUint32(o + 6);
    const sign = se & 0x8000 ? -1 : 1, e = se & 0x7fff;
    if (e === 0 && hi === 0 && lo === 0) return 0;
    return sign * (hi * 2 ** (e - 16383 - 31) + lo * 2 ** (e - 16383 - 63));
  }

  // returns {sr, ch: Float32Array[]} or null when this is not AIFF/AIFC PCM we understand
  function parseAiff(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength < 12 || tag(dv, 0) !== 'FORM') return null;
    const form = tag(dv, 8);
    if (form !== 'AIFF' && form !== 'AIFC') return null;
    let o = 12, nch = 0, frames = 0, bits = 0, sr = 0, comp = 'NONE', ssnd = -1, ssndLen = 0;
    while (o + 8 <= buf.byteLength) {
      const id = tag(dv, o), len = dv.getUint32(o + 4), body = o + 8;
      if (id === 'COMM') {
        nch = dv.getInt16(body); frames = dv.getUint32(body + 2); bits = dv.getInt16(body + 6); sr = ext80(dv, body + 8);
        if (form === 'AIFC' && len >= 22) comp = tag(dv, body + 18);
      } else if (id === 'SSND') {
        const off = dv.getUint32(body);
        ssnd = body + 8 + off; ssndLen = len - 8 - off;
      }
      o = body + len + (len & 1);
    }
    if (!nch || ssnd < 0 || !sr) return null;
    const c = comp.toLowerCase();
    const le = c === 'sowt', flt = c === 'fl32', dbl = c === 'fl64';
    if (!(c === 'none' || le || flt || dbl)) return null;
    const bps = flt ? 4 : dbl ? 8 : Math.ceil(bits / 8);
    frames = Math.min(frames, Math.floor(Math.max(0, Math.min(ssndLen, buf.byteLength - ssnd)) / (bps * nch)));
    const ch = []; for (let k = 0; k < nch; k++) ch.push(new Float32Array(frames));
    let p = ssnd;
    for (let i = 0; i < frames; i++) {
      for (let k = 0; k < nch; k++) {
        let v;
        if (flt) v = dv.getFloat32(p, false);
        else if (dbl) v = dv.getFloat64(p, false);
        else if (bps === 1) v = dv.getInt8(p) / 128;
        else if (bps === 2) v = dv.getInt16(p, le) / 32768;
        else if (bps === 3) {
          const b0 = dv.getUint8(p), b1 = dv.getUint8(p + 1), b2 = dv.getUint8(p + 2);
          let x = le ? (b2 << 16) | (b1 << 8) | b0 : (b0 << 16) | (b1 << 8) | b2;
          if (x & 0x800000) x -= 0x1000000;
          v = x / 8388608;
        } else v = dv.getInt32(p, le) / 2147483648;
        ch[k][i] = v; p += bps;
      }
    }
    return { sr, ch };
  }

  // minimal WAV reader (PCM 8/16/24/32, float 32/64) — used when decodeAudioData refuses
  function parseWav(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength < 12 || tag(dv, 0) !== 'RIFF' || tag(dv, 8) !== 'WAVE') return null;
    let o = 12, fmt = null, data = -1, dlen = 0;
    while (o + 8 <= buf.byteLength) {
      const id = tag(dv, o), len = dv.getUint32(o + 4, true), body = o + 8;
      if (id === 'fmt ') {
        let f = dv.getUint16(body, true);
        if (f === 0xfffe && len >= 26) f = dv.getUint16(body + 24, true);
        fmt = { f, nch: dv.getUint16(body + 2, true), sr: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
      } else if (id === 'data') { data = body; dlen = Math.min(len, buf.byteLength - body); }
      o = body + len + (len & 1);
    }
    if (!fmt || data < 0) return null;
    const bps = fmt.bits / 8, frames = Math.floor(dlen / (bps * fmt.nch)), ch = [];
    for (let k = 0; k < fmt.nch; k++) ch.push(new Float32Array(frames));
    let p = data;
    for (let i = 0; i < frames; i++) for (let k = 0; k < fmt.nch; k++) {
      let v = 0;
      if (fmt.f === 3) v = bps === 4 ? dv.getFloat32(p, true) : dv.getFloat64(p, true);
      else if (bps === 1) v = (dv.getUint8(p) - 128) / 128;
      else if (bps === 2) v = dv.getInt16(p, true) / 32768;
      else if (bps === 3) { let x = dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getUint8(p + 2) << 16); if (x & 0x800000) x -= 0x1000000; v = x / 8388608; }
      else v = dv.getInt32(p, true) / 2147483648;
      ch[k][i] = v; p += bps;
    }
    return { sr: fmt.sr, ch };
  }

  // interleaved 24-bit (or 16-bit) PCM WAV
  function encodeWav(chans, sr, bits = 24) {
    const nch = chans.length, n = chans[0].length, bps = bits / 8;
    const dataLen = n * nch * bps, buf = new ArrayBuffer(44 + dataLen), dv = new DataView(buf), u8 = new Uint8Array(buf);
    const w = (o, s) => { for (let i = 0; i < 4; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nch, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * nch * bps, true); dv.setUint16(32, nch * bps, true); dv.setUint16(34, bits, true);
    w(36, 'data'); dv.setUint32(40, dataLen, true);
    let o = 44;
    for (let i = 0; i < n; i++) for (let k = 0; k < nch; k++) {
      let v = chans[k][i]; v = v > 1 ? 1 : v < -1 ? -1 : v;
      if (bits === 16) { dv.setInt16(o, Math.round(v < 0 ? v * 32768 : v * 32767), true); o += 2; }
      else { const x = Math.round(v < 0 ? v * 8388608 : v * 8388607); u8[o] = x & 255; u8[o + 1] = (x >> 8) & 255; u8[o + 2] = (x >> 16) & 255; o += 3; }
    }
    return u8;
  }

  // ---- ZIP (stored entries written; stored + deflate read) ----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  // entries: [{name, data: Uint8Array}] -> Uint8Array
  function zipStore(entries) {
    const d = new Date();
    const dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    const dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    const parts = [], central = []; let off = 0;
    for (const e of entries) {
      const nm = te.encode(e.name), data = e.data, crc = crc32(data);
      const L = new DataView(new ArrayBuffer(30));
      L.setUint32(0, 0x04034b50, true); L.setUint16(4, 20, true); L.setUint16(6, 0x0800, true); L.setUint16(10, dt, true); L.setUint16(12, dd, true);
      L.setUint32(14, crc, true); L.setUint32(18, data.length, true); L.setUint32(22, data.length, true); L.setUint16(26, nm.length, true);
      const C = new DataView(new ArrayBuffer(46));
      C.setUint32(0, 0x02014b50, true); C.setUint16(4, 20, true); C.setUint16(6, 20, true); C.setUint16(8, 0x0800, true); C.setUint16(12, dt, true); C.setUint16(14, dd, true);
      C.setUint32(16, crc, true); C.setUint32(20, data.length, true); C.setUint32(24, data.length, true); C.setUint16(28, nm.length, true); C.setUint32(42, off, true);
      parts.push(new Uint8Array(L.buffer), nm, data);
      central.push(new Uint8Array(C.buffer), nm);
      off += 30 + nm.length + data.length;
    }
    const cenLen = central.reduce((a, b) => a + b.length, 0);
    const E = new DataView(new ArrayBuffer(22));
    E.setUint32(0, 0x06054b50, true); E.setUint16(8, entries.length, true); E.setUint16(10, entries.length, true); E.setUint32(12, cenLen, true); E.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(E.buffer)], out = new Uint8Array(off + cenLen + 22);
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('deflate unsupported');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // -> Map name -> Uint8Array
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf instanceof ArrayBuffer ? buf : u8.buffer);
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('not a zip');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    const out = new Map();
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
      const lstart = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
      const raw = u8.subarray(lstart, lstart + csize);
      if (method === 0) out.set(name, raw.slice());
      else if (method === 8) out.set(name, await inflateRaw(raw));
      p += 46 + nlen + xlen + clen;
    }
    return out;
  }

  // ---- analysis ----
  function mono(ch) {
    if (ch.length === 1) return ch[0];
    const n = ch[0].length, m = new Float32Array(n);
    for (const c of ch) for (let i = 0; i < n; i++) m[i] += c[i] / ch.length;
    return m;
  }
  // onset times (seconds) by energy flux in 10 ms frames, within [a, b]
  function onsets(m, sr, a, b, maxN = 32) {
    const hop = Math.max(64, Math.round(sr * 0.01)), i0 = Math.floor(a * sr), i1 = Math.min(m.length, Math.floor(b * sr));
    const env = [];
    for (let i = i0; i + hop <= i1; i += hop) { let s = 0; for (let j = 0; j < hop; j++) s += m[i + j] * m[i + j]; env.push(Math.sqrt(s / hop)); }
    if (env.length < 4) return [];
    const peak = Math.max(...env), floor = peak * 0.04, flux = [];
    for (let k = 0; k < env.length; k++) flux.push(Math.max(0, env[k] - (k ? env[k - 1] : 0)));
    const cand = [];
    for (let k = 2; k < env.length - 1; k++) {
      let mean = 0, c = 0;
      for (let j = Math.max(0, k - 12); j < k; j++) { mean += flux[j]; c++; }
      mean = c ? mean / c : 0;
      if (flux[k] > floor * 0.5 && flux[k] > mean * 2.2 + peak * 0.015 && flux[k] >= flux[k - 1] && flux[k] >= flux[k + 1] && env[k] > floor) cand.push({ k, s: flux[k] });
    }
    const minGap = Math.round(0.08 / 0.01);
    cand.sort((x, y) => y.s - x.s);
    const kept = [];
    for (const c of cand) { if (kept.length >= maxN) break; if (kept.every(k => Math.abs(k - c.k) >= minGap)) kept.push(c.k); }
    kept.sort((x, y) => x - y);
    return kept.map(k => (i0 + Math.max(0, k - 1) * hop) / sr);
  }
  // nearest rising zero crossing to time t (seconds), searched within +-win
  function zeroCross(m, sr, t, win = 0.006) {
    const c = Math.round(t * sr), w = Math.round(win * sr);
    for (let d = 0; d <= w; d++) for (const i of [c + d, c - d]) if (i > 0 && i < m.length && m[i - 1] <= 0 && m[i] > 0) return i / sr;
    return t;
  }
  // min/max pairs for drawing
  function peaks(m, n) {
    const out = new Float32Array(n * 2), step = m.length / n;
    for (let i = 0; i < n; i++) {
      let lo = 0, hi = 0; const a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step));
      for (let j = a; j < b && j < m.length; j++) { const v = m[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
      out[i * 2] = lo; out[i * 2 + 1] = hi;
    }
    return out;
  }
  const encText = s => te.encode(s), decText = u => td.decode(u);
  return { parseAiff, parseWav, encodeWav, zipStore, unzip, crc32, mono, onsets, zeroCross, peaks, encText, decText };
})();
if (typeof module === 'object' && module.exports) module.exports = SAWARI_CODEC;
