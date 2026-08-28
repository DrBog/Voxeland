/* KINESIS — the idle layer.
   Every upgrade here is wired to a number the physics actually reads. There
   is no "damage +5%" that means nothing: GRIP is metres of reach and newtons
   of hold, FLOW is metres per second, FRAME is how much of an impact your
   skeleton keeps. Buying is how you change the body, and the body is what
   gets you through the gate. */
K.prog = (function () {
  const U = K.util;
  const { clamp } = U;

  const UPGRADES = [
    { key: 'legPower', name: 'LEG DRIVE', unit: 'kN', cost: 12, growth: 1.155, step: 0.115,
      blurb: 'Take-off speed and the shove that carries the hips forward.',
      read: v => (3.2 + v * 2.9).toFixed(1) + ' m/s take-off' },
    { key: 'flow', name: 'FLOW', unit: 'm/s', cost: 22, growth: 1.185, step: 0.100,
      blurb: 'Cruising speed. Everything downstream is distance per second.',
      read: v => (3.0 + v * 1.6).toFixed(1) + ' m/s cruise' },
    { key: 'balance', name: 'CORE', unit: '', cost: 15, growth: 1.165, step: 0.100,
      blurb: 'How far off your feet you can be and still get them back.',
      read: v => (0.40 + v * 0.48).toFixed(2) + ' m step reach' },
    { key: 'reflex', name: 'REFLEX', unit: '', cost: 18, growth: 1.170, step: 0.090,
      blurb: 'Lookahead and timing. Sloppy take-offs come from cheap reflexes.',
      read: v => (34 + v * 100).toFixed(0) + ' cm/(m/s) lookahead' },
    { key: 'grip', name: 'GRIP', unit: '', cost: 20, growth: 1.180, step: 0.100,
      blurb: 'Reach for a lip you are falling past, and hold it once you have it.',
      read: v => (0.45 + v * 0.55).toFixed(2) + ' m reach' },
    { key: 'conditioning', name: 'FRAME', unit: '', cost: 16, growth: 1.160, step: 0.100,
      blurb: 'What your skeleton keeps instead of passing on to the rest of you.',
      read: v => '-' + (100 - 100 / (0.55 + v * 0.75) * 0.55).toFixed(0) + '% impact' },
    { key: 'rebound', name: 'REBOUND', unit: 's', cost: 22, growth: 1.175, step: 0.100,
      blurb: 'Rolling out of a landing, and the seconds you lose lying down.',
      read: v => clamp(0.55 - v * 0.30, 0.12, 0.6).toFixed(2) + ' s down time' },
    { key: 'line', name: 'LINE', unit: 'x', cost: 34, growth: 1.215, step: 0.090, econ: true,
      blurb: 'Reading the route. Pure momentum per metre.',
      read: v => 'x' + (1 + v).toFixed(2) + ' momentum' },
    { key: 'ghost', name: 'GHOST', unit: 'h', cost: 120, growth: 1.260, step: 1, econ: true, lock: 1,
      blurb: 'A version of you that keeps running while the screen is off.',
      read: v => (2 + v * 1.5).toFixed(1) + ' h banked, ' + (30 + v * 6).toFixed(0) + '% rate' }
  ];
  const BY_KEY = {}; for (const u of UPGRADES) BY_KEY[u.key] = u;

  function fresh() {
    return {
      v: 1,
      momentum: 0, earned: 0, lifetime: 0,
      levels: { legPower: 0, flow: 0, balance: 0, reflex: 0, grip: 0, conditioning: 0, rebound: 0, line: 0, ghost: 0 },
      instinct: 0, instinctSpent: 0,
      best: 0, bestRun: 0, runs: 0, totalDistance: 0, resets: 0,
      gates: {}, log: [], auto: false, muted: true,
      seen: Date.now(), started: Date.now(),
      rateSample: 0
    };
  }

  function level(s, key) { return s.levels[key] | 0; }

  function cost(s, key, n) {
    const u = BY_KEY[key];
    const lv = level(s, key);
    n = n || 1;
    let total = 0;
    for (let i = 0; i < n; i++) total += u.cost * Math.pow(u.growth, lv + i);
    return Math.ceil(total);
  }

  function canBuy(s, key) {
    const u = BY_KEY[key];
    if (u.lock !== undefined && clearedGates(s) < u.lock) return false;
    return s.momentum >= cost(s, key);
  }

  function buy(s, key) {
    if (!canBuy(s, key)) return false;
    s.momentum -= cost(s, key);
    s.levels[key] = level(s, key) + 1;
    return true;
  }

  function unlocked(s, key) {
    const u = BY_KEY[key];
    return u.lock === undefined || clearedGates(s) >= u.lock;
  }

  function clearedGates(s) { return Object.keys(s.gates).length; }

  const INSTINCT_BODY = 0.022;   // per point, on every physical stat value
  const INSTINCT_ECON = 0.060;   // per point, on momentum

  /* normalised values handed to the physics */
  function physStats(s) {
    const boost = 1 + s.instinct * INSTINCT_BODY;
    const out = {};
    for (const u of UPGRADES) {
      out[u.key] = level(s, u.key) * u.step * (u.econ ? 1 : boost);
    }
    // The gait converts roughly 60% of a commanded pace into ground speed —
    // stride and turnover are the limit, as they are for a person — so the
    // controller is asked for more than the readout promises, and the
    // readout is what the runner actually does.
    out.speed = 4.8 + out.flow * 2.6;
    return out;
  }

  function statLevelFn(s) {
    return (key) => {
      if (key === 'all') {
        let m = Infinity;
        for (const u of UPGRADES) if (!u.econ) m = Math.min(m, level(s, u.key));
        return m;
      }
      return level(s, key);
    };
  }

  function districtMult(distance) {
    return K.world.DISTRICTS[K.world.districtIndex(distance)].mult;
  }

  /* momentum per metre at a given point on the route */
  const BASE_RATE = 2.2;
  function rate(s, distance) {
    const st = physStats(s);
    return BASE_RATE * (1 + st.line) * districtMult(distance) * (1 + s.instinct * INSTINCT_ECON);
  }

  function gateBonus(s, gate) {
    const first = !s.gates[gate.name];
    const base = 40 * Math.pow(2.9, K.world.GATES.indexOf(gate));
    return { amount: base * (first ? 3 : 1) * (1 + s.instinct * INSTINCT_ECON), first };
  }

  /* ------------------------------------------------------------ prestige */

  function prestigeGain(s) {
    const best = Math.max(s.best, s.bestRun);
    if (best < 1200) return 0;
    const g = Math.floor(4.2 * Math.pow(best / 1000, 0.78));
    return Math.max(0, g - s.instinct);
  }

  function prestige(s) {
    const gain = prestigeGain(s);
    if (gain <= 0) return false;
    s.instinct += gain;
    s.resets++;
    s.momentum = 0;
    for (const k in s.levels) s.levels[k] = 0;
    s.gates = {};
    s.bestRun = 0;
    s.log.unshift({ kind: 'reset', text: 'MUSCLE MEMORY — +' + gain + ' instinct', d: 0 });
    s.log = s.log.slice(0, 14);
    return true;
  }

  /* ------------------------------------------------------------- offline */

  function offline(s, now) {
    const dt = Math.max(0, (now - (s.seen || now)) / 1000);
    const st = physStats(s);
    const capH = 2 + level(s, 'ghost') * 1.5;
    const eff = 0.30 + level(s, 'ghost') * 0.06;
    const t = Math.min(dt, capH * 3600);
    if (t < 60 || !s.rateSample) return null;
    const gained = s.rateSample * eff * t;
    s.momentum += gained;
    s.earned += gained;
    s.lifetime += gained;
    return { seconds: t, away: dt, gained, capped: dt > capH * 3600, eff };
  }

  /* ---------------------------------------------------------------- save */

  const KEY = 'kinesis.save.v1';
  function save(s) {
    s.seen = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      const f = fresh();
      for (const k in f) if (s[k] === undefined) s[k] = f[k];
      for (const k in f.levels) if (s.levels[k] === undefined) s.levels[k] = 0;
      return s;
    } catch (e) { return null; }
  }
  function wipe() { try { localStorage.removeItem(KEY); } catch (e) {} }

  return {
    UPGRADES, BY_KEY, fresh, level, cost, canBuy, buy, unlocked, clearedGates,
    physStats, statLevelFn, rate, districtMult, gateBonus,
    prestigeGain, prestige, offline, save, load, wipe,
    INSTINCT_BODY, INSTINCT_ECON
  };
})();
