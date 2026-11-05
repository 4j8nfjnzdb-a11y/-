// ---------------------------------------------------------------------------
// Pigment colour — Kubelka–Munk mixing in six spectral bands.
//
// The reflectance model follows spectral.js by Ronald van Wijnen (MIT License,
// https://github.com/rvanwijnen/spectral.js): an sRGB colour becomes a reflectance
// spectrum built from seven base spectra, each band gets KS = (1-R)^2 / 2R, and
// colours mix by a luminance-weighted average of KS. Here the 38-sample spectra
// are averaged into six bands so a pixel's whole pigment state fits two RGBA
// textures, and the band -> linear RGB matrix was least-squares fitted against
// the full 38-band mix (mean ΔE_OK ≈ 0.3 on random two-colour mixes).
//
// A pixel stores, per band b, Σ w·KS_b plus Σ w and Σ amount, where
// w = amount · luminance · tinting². Every quantity is linear in amount, so the
// fluid solver can advect and interpolate it freely and interpolation *is*
// pigment mixing: blue and yellow make green, not grey.
// ---------------------------------------------------------------------------
const KM = (() => {
  const BASE = {W:[1.00115,1.00065,0.999792,1.00018,1.00052,1.00054],C:[0.971187,0.988054,0.993388,0.439755,0.0166191,0.0145161],M:[0.990491,0.753807,0.0309595,0.582949,0.968866,0.972261],Y:[0.0214208,0.254816,0.964106,0.986234,0.984848,0.984704],R:[0.0308801,0.0123975,0.00654588,0.560412,0.983607,0.985684],G:[0.0097428,0.247493,0.968695,0.417323,0.0315831,0.0281468],B:[0.979043,0.746027,0.0355853,0.0139663,0.0155993,0.0157636]};
  const BAND_Y = [0.00144892,0.0931575,0.495909,0.357169,0.0517704,0.000545408];
  const B2RGB = [[0.0933675,-0.172951,0.859612],[-0.132224,0.183284,0.222326],[-0.16987,0.922475,-0.0528979],[0.413681,0.178076,-0.00401051],[2.27984,-2.73577,-1.18011],[-1.48706,2.62584,1.15398]];
  const RMIN = 0.002;
  const unc = x => x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92;
  const cmp = x => x > 0.0031308 ? 1.055 * x ** (1 / 2.4) - 0.055 : x * 12.92;
  const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const rgbToHex = c => '#' + c.map(x => Math.round(255 * Math.min(1, Math.max(0, x))).toString(16).padStart(2, '0')).join('');
  const ks = R => (1 - R) * (1 - R) / (2 * R);
  const km = k => 1 + k - Math.sqrt(k * k + 2 * k);

  function bandsOf(hex) {
    let l = hexToRgb(hex).map(unc);
    const w = Math.min(...l);
    l = l.map(x => x - w);
    const c = {
      W: w, C: Math.min(l[1], l[2]), M: Math.min(l[0], l[2]), Y: Math.min(l[0], l[1]),
      R: Math.max(0, Math.min(l[0] - l[2], l[0] - l[1])),
      G: Math.max(0, Math.min(l[1] - l[2], l[1] - l[0])),
      B: Math.max(0, Math.min(l[2] - l[1], l[2] - l[0])),
    };
    const R = [0, 1, 2, 3, 4, 5].map(i => Math.max(RMIN, Object.keys(c).reduce((s, k) => s + c[k] * BASE[k][i], 0)));
    const lum = Math.max(1e-4, R.reduce((s, x, i) => s + x * BAND_Y[i], 0));
    return { R, ks: R.map(ks), lum };
  }

  // Per unit of paint: the two texels a splat adds (w·KS0..3) and (w·KS4, w·KS5, w, 1).
  function pigment(hex, tint = 1) {
    const b = bandsOf(hex);
    const w = b.lum * tint * tint;
    return {
      c0: [w * b.ks[0], w * b.ks[1], w * b.ks[2], w * b.ks[3]],
      c1: [w * b.ks[4], w * b.ks[5], w, 1],
    };
  }

  // CPU mix for previews: list of [hex, amount, tint].
  function mix(list) {
    let W = 0; const acc = [0, 0, 0, 0, 0, 0];
    for (const [hex, amt, tint = 1] of list) {
      const b = bandsOf(hex), w = amt * b.lum * tint * tint;
      W += w; for (let i = 0; i < 6; i++) acc[i] += w * b.ks[i];
    }
    const R = acc.map(a => km(a / W));
    const lin = [0, 1, 2].map(c => R.reduce((s, x, i) => s + x * B2RGB[i][c], 0));
    return rgbToHex(lin.map(x => cmp(Math.max(0, x))));
  }

  const rgb01 = hex => hexToRgb(hex);
  const lin01 = hex => hexToRgb(hex).map(unc);
  return { pigment, mix, B2RGB, rgb01, lin01, rgbToHex };
})();
