/* IRONWAKE — the run.
   A single skirmish is a demo. What makes a tactics game worth opening twice
   is that the people who survived it are the same people you take into the
   next one, carrying what they learned and what they lost. Four units, no
   reinforcements you did not earn, and a line of battles that gets heavier
   every time. */
K.camp = (function () {
  const U = K.util, Un = K.units;
  const { clamp } = U;
  const KEY = 'ironwake.run.v2';

  const START = [
    { cls: 'Blade', name: 'VESS', level: 6 },
    { cls: 'Halberd', name: 'ORD', level: 6 },
    { cls: 'Archer', name: 'KITE', level: 6 },
    { cls: 'Ember', name: 'SOLM', level: 6 }
  ];
  const RECRUITS = ['HALT', 'WREN', 'COBB', 'IDRIS', 'MARR', 'PELL', 'SAVE', 'TOLL', 'VANE', 'YEW'];
  const FOES = ['GHAST', 'BULWARK', 'SPINE', 'NEEDLE', 'MAUL', 'CINDER', 'GRIST', 'HOLLOW', 'RASP', 'THRAW'];

  function fresh() {
    return { wave: 1, best: 0, runs: 0, roster: START.map(u => ({ ...u })), fallen: [], last: null };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return fresh();
      const s = JSON.parse(raw);
      if (!s || !s.roster || !s.roster.length) return fresh();
      return s;
    } catch (e) { return fresh(); }
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
  }

  const KEEP = ['hp', 'maxHp', 'str', 'mag', 'skl', 'spd', 'lck', 'def', 'res', 'mov', 'exp', 'level'];

  /* a unit, flattened to what survives a battle */
  function snapshot(u) {
    const o = { cls: u.cls, name: u.name };
    for (const k of KEEP) o[k] = u[k];
    return o;
  }

  /* and back again: make() rolls its own growths, so the saved numbers are
     written over the top — a veteran is its history, not its class */
  function restore(spec, side) {
    // A veteran is restored exactly as it was left. A name on a roster with no
    // history behind it is somebody new, and rolls its levels like anyone else
    // — copying a bare level onto level-one stats would quietly hand you four
    // recruits wearing a veteran's rank.
    const veteran = spec.maxHp !== undefined;
    const u = Un.make(spec.cls, side, spec.name, veteran ? 1 : (spec.level || 1));
    if (veteran) for (const k of KEEP) if (spec[k] !== undefined) u[k] = spec[k];
    u.hp = u.maxHp;
    return u;
  }

  /* the opposition for a given wave: more of them, and better, every time */
  /* Who they field, not where they stand — the arena decides that, because
     from here on the arena is different every time. */
  function enemyPlan(wave, rnd) {
    const n = clamp(4 + Math.ceil(wave / 2), 5, 8);
    const lvl = clamp(2 + Math.floor(wave * 1.4), 2, 20);
    const pool = ['Reaver', 'Halberd', 'Blade', 'Archer', 'Ember', 'Reaver', 'Blade'];
    const out = [];
    for (let i = 0; i < n; i++) {
      const cls = i === 0 ? 'Reaver' : i === 1 ? 'Halberd' : pool[Math.floor(rnd() * pool.length)];
      out.push({
        cls, name: FOES[i % FOES.length],
        level: clamp(lvl + (i < 2 ? 1 : 0) - (i > 4 ? 1 : 0), 1, 24),
        // the last two of any wave hold the high ground
        guard: i >= n - 2, alert: 5
      });
    }
    return out;
  }

  /* what the player brings: whoever is left, healed, plus a recruit if the
     line has thinned — never back up to full strength for free */
  function playerPlan(s) {
    const out = s.roster.map(spec => ({ ...spec }));
    if (out.length < 4 && s.wave > 1) {
      const avg = Math.round(out.reduce((a, u) => a + u.level, 0) / Math.max(1, out.length));
      const cls = ['Blade', 'Halberd', 'Archer', 'Ember', 'Reaver'][(s.wave * 3 + out.length) % 5];
      out.push({ cls, name: RECRUITS[(s.wave + out.length) % RECRUITS.length], level: clamp(avg - 2, 1, 20), recruit: true });
    }
    return out;
  }

  /* the field is settled: bank the survivors, count the dead, move on */
  function afterBattle(s, battle, won) {
    s.lastLayout = battle.arena ? battle.arena.layout : null;
    const mine = battle.units.filter(u => u.side === 0);
    const lost = mine.filter(u => u.dead).map(u => u.name);
    s.last = {
      won, wave: s.wave, lost,
      survivors: mine.filter(u => !u.dead).map(u => ({ name: u.name, cls: u.cls, level: u.level, exp: u.exp }))
    };
    if (won) {
      s.roster = mine.filter(u => !u.dead).map(snapshot);
      s.fallen = (s.fallen || []).concat(lost);
      s.best = Math.max(s.best || 0, s.wave);
      s.wave++;
      if (!s.roster.length) { s.runs = (s.runs || 0) + 1; const f = fresh(); f.best = s.best; f.runs = s.runs; Object.assign(s, f, { last: s.last }); }
    } else {
      s.runs = (s.runs || 0) + 1;
      const best = s.best, runs = s.runs, last = s.last;
      Object.assign(s, fresh(), { best, runs, last });
    }
    save(s);
    return s.last;
  }

  return { fresh, load, save, snapshot, restore, enemyPlan, playerPlan, afterBattle, START };
})();
