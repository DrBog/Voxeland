/* KINESIS — sound, synthesised on the fly. No files to load, nothing to
   wait for. Off until the player asks for it, because a game that starts
   making noise on a phone is a game that gets closed. */
K.audio = (function () {
  let ctx = null, master = null, on = false, last = {};

  function init() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      return true;
    } catch (e) { return false; }
  }

  function enable(v) {
    on = v;
    if (v) { if (init() && ctx.state === 'suspended') ctx.resume(); }
  }

  function noiseBuffer(dur) {
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    return buf;
  }

  function throttle(key, ms) {
    const t = performance.now();
    if (last[key] && t - last[key] < ms) return false;
    last[key] = t; return true;
  }

  function noise(dur, freq, q, gain, type) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const f = ctx.createBiquadFilter();
    f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }

  function tone(f0, f1, dur, gain, type) {
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }

  const api = {
    enable, isOn: () => on,
    step(v) { if (!on || !ctx || !throttle('step', 90)) return; noise(0.09, 900 + Math.random() * 500, 1.2, 0.05 + v * 0.06); },
    impact(v) {
      if (!on || !ctx || !throttle('impact', 60)) return;
      noise(0.22, 240, 0.8, 0.10 + v * 0.28, 'lowpass');
      tone(120 + v * 60, 40, 0.20, 0.10 + v * 0.2, 'sine');
    },
    jump() { if (!on || !ctx) return; noise(0.16, 500, 0.9, 0.07, 'highpass'); },
    grab() { if (!on || !ctx) return; noise(0.10, 2200, 4, 0.10); tone(420, 620, 0.10, 0.06, 'triangle'); },
    gate() {
      if (!on || !ctx) return;
      [392, 523, 659].forEach((f, i) => setTimeout(() => on && tone(f, f, 0.5, 0.09, 'triangle'), i * 90));
    },
    buy() { if (!on || !ctx) return; tone(660, 880, 0.08, 0.05, 'square'); },
    down() { if (!on || !ctx) return; tone(180, 60, 0.5, 0.12, 'sawtooth'); }
  };
  return api;
})();
