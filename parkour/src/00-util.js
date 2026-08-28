/* KINESIS — shared math, rng, formatting.
   Everything hangs off the single global K. */
window.K = window.K || {};

K.util = (function () {
  const TAU = Math.PI * 2;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function sign(v) { return v < 0 ? -1 : 1; }

  /* shortest signed difference between two angles */
  function angDiff(target, current) {
    let d = (target - current) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  /* frame-rate independent approach: pull v toward t, `rate` = fraction per second */
  function approach(v, t, rate, dt) {
    return t + (v - t) * Math.exp(-rate * dt);
  }

  /* mulberry32 — small deterministic prng so a seed reproduces a route */
  function rng(seed) {
    let a = seed >>> 0;
    const f = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + f() * (hi - lo);
    f.int = (lo, hi) => Math.floor(lo + f() * (hi - lo + 1));
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.chance = (p) => f() < p;
    return f;
  }

  const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  /* idle games live and die by their number formatting */
  function num(v) {
    if (!isFinite(v)) return '∞';
    const neg = v < 0; v = Math.abs(v);
    if (v < 1000) {
      if (v >= 100) return (neg ? '-' : '') + Math.floor(v);
      if (v >= 10) return (neg ? '-' : '') + (Math.round(v * 10) / 10);
      return (neg ? '-' : '') + (Math.round(v * 100) / 100);
    }
    let tier = Math.floor(Math.log10(v) / 3);
    tier = Math.min(tier, UNITS.length - 1);
    const scaled = v / Math.pow(1000, tier);
    const s = scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2);
    return (neg ? '-' : '') + s + UNITS[tier];
  }

  function dist(v) {
    if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 1 : 2) + ' km';
    return v.toFixed(v < 100 ? 1 : 0) + ' m';
  }

  function time(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + s + 's';
    return s + 's';
  }

  return { TAU, clamp, lerp, mix, smooth, sign, angDiff, approach, rng, num, dist, time };
})();
