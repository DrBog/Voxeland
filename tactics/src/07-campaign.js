/* IRONWAKE — the run.
   A single skirmish is a demo. What makes a tactics game worth opening twice
   is that the people who survived it are the same people you take into the
   next one, carrying what they learned and what they lost. Four units, no
   reinforcements you did not earn, and a line of battles that gets heavier
   every time. */
K.camp = (function () {
  const U = K.util, Un = K.units;
  const { clamp } = U;
  const KEY = 'ironwake.run.v3';
  const RUN = 8;                 // a run you can finish, not a treadmill

  const START = [
    { cls: 'Blade', name: 'VESS', level: 6 },
    { cls: 'Halberd', name: 'ORD', level: 6 },
    { cls: 'Archer', name: 'KITE', level: 6 },
    { cls: 'Ember', name: 'SOLM', level: 6 }
  ];
  const RECRUITS = ['HALT', 'WREN', 'COBB', 'IDRIS', 'MARR', 'PELL', 'SAVE', 'TOLL', 'VANE', 'YEW'];
  const FOES = ['GHAST', 'BULWARK', 'SPINE', 'NEEDLE', 'MAUL', 'CINDER', 'GRIST', 'HOLLOW', 'RASP', 'THRAW'];

  /* The roster holds one shape and one only: a full record, stats rolled.
     Two shapes — a bare "level 6 Blade" and a veteran's actual numbers — is
     how a reward ends up adding three to an undefined maximum. */
  function fresh() {
    return {
      wave: 1, best: 0, runs: 0, wins: 0, fallen: [], last: null,
      roster: START.map(s => snapshot(Un.make(s.cls, 0, s.name, s.level)))
    };
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
    const o = { cls: u.cls, name: u.name, weapon: Un.keyOf(u.weapon) };
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
    if (spec.weapon && Un.WEAPONS[spec.weapon]) u.weapon = Un.WEAPONS[spec.weapon];
    if (spec.boss) { u.boss = true; u.maxHp += 8; }
    u.hp = u.maxHp;
    return u;
  }

  /* the opposition for a given wave: more of them, and better, every time */
  /* Who they field, not where they stand — the arena decides that, because
     from here on the arena is different every time. */
  const CAPTAINS = ['THE IRONWAKE', 'ASH OF THE WALL', 'VEIL', 'THE LONG COUNT', 'HOLLOWKING'];

  /* Who they field, not where they stand — the arena decides that, because
     from here on the arena is different every time. */
  function enemyPlan(wave, rnd) {
    const n = clamp(4 + Math.ceil(wave / 2), 5, 8);
    const lvl = clamp(2 + Math.floor(wave * 1.4), 2, 20);
    const pool = ['Reaver', 'Halberd', 'Blade', 'Archer', 'Ember', 'Reaver', 'Blade'];
    const arm = wave >= 6 ? 2 : wave >= 3 ? 1 : 0;     // they upgrade too
    const out = [];
    for (let i = 0; i < n; i++) {
      const cls = i === 0 ? 'Reaver' : i === 1 ? 'Halberd' : pool[Math.floor(rnd() * pool.length)];
      const line = Un.ARSENAL[cls];
      out.push({
        cls, name: FOES[i % FOES.length],
        level: clamp(lvl + (i < 2 ? 1 : 0) - (i > 4 ? 1 : 0), 1, 24),
        weapon: line[Math.min(arm, line.length - 1)],
        // the last two of any wave hold the high ground
        guard: i >= n - 2, alert: 5
      });
    }
    // The last field of a run has somebody in charge of it. A run that cannot
    // be finished is a score attack wearing a campaign's clothes.
    if (wave >= RUN) {
      const cls = ['Reaver', 'Halberd', 'Blade'][Math.floor(rnd() * 3)];
      out.unshift({
        cls, name: CAPTAINS[Math.floor(rnd() * CAPTAINS.length)],
        level: clamp(lvl + 4, 4, 26),
        weapon: Un.ARSENAL[cls][2],
        boss: true, guard: false, alert: 9
      });
    }
    return out;
  }

  /* ------------------------------------------------------------- the spoils

     A wave won hands you one choice out of three. Every one of them is a real
     trade — a weapon that is heavier than the one it replaces, a body that
     starts green, a stat that goes to one unit and not another — because a
     reward you would never refuse is not a decision. */
  const STATS = [['str', 'STR'], ['skl', 'SKL'], ['spd', 'SPD'], ['def', 'DEF'], ['lck', 'LCK']];

  function offers(s, rnd) {
    const out = [];
    const roster = s.roster;

    // a weapon for whoever is still carrying the older iron
    const armable = roster
      .map(u => ({ u, next: Un.upgrade(u.cls, u.weapon || Un.CLASSES[u.cls].weapon) }))
      .filter(o => o.next);
    if (armable.length) {
      const pick = armable[Math.floor(rnd() * armable.length)];
      const w = Un.WEAPONS[pick.next], old = Un.WEAPONS[pick.u.weapon || Un.CLASSES[pick.u.cls].weapon];
      out.push({
        kind: 'arm', unit: pick.u.name, weapon: pick.next,
        label: pick.u.name + ' takes the ' + w.name,
        detail: 'mt ' + old.mt + '→' + w.mt + ' · hit ' + old.hit + '→' + w.hit + ' · weight ' + old.wt + '→' + w.wt
      });
    }

    // a recruit, if the line has thinned
    if (roster.length < 5) {
      const cls = ['Blade', 'Halberd', 'Archer', 'Ember', 'Reaver'][Math.floor(rnd() * 5)];
      const avg = Math.round(roster.reduce((a, u) => a + u.level, 0) / Math.max(1, roster.length));
      const name = RECRUITS[Math.floor(rnd() * RECRUITS.length)];
      out.push({
        kind: 'recruit', cls, name, level: clamp(avg - 1, 1, 20),
        label: name + ' joins as a ' + cls,
        detail: 'level ' + clamp(avg - 1, 1, 20) + ' · ' + Un.CLASSES[cls].tag
      });
    }

    // drill: two points of one stat into one unit
    const who = roster[Math.floor(rnd() * roster.length)];
    const st = STATS[Math.floor(rnd() * STATS.length)];
    out.push({
      kind: 'drill', unit: who.name, stat: st[0], amount: 2,
      label: who.name + ' drills ' + st[1],
      detail: '+2 ' + st[1] + ' for the rest of the run'
    });

    // rations: everybody a little tougher
    out.push({
      kind: 'rally', amount: 3,
      label: 'The whole line eats',
      detail: '+3 max HP each · ' + roster.length + ' of you'
    });

    // three, never the same kind twice
    const seen = new Set(), three = [];
    for (const o of out) { if (seen.has(o.kind)) continue; seen.add(o.kind); three.push(o); }
    while (three.length > 3) three.pop();
    return three;
  }

  function take(s, offer) {
    if (!offer) return s;
    const find = (name) => s.roster.find(u => u.name === name);
    if (offer.kind === 'arm') {
      const u = find(offer.unit);
      if (u) u.weapon = offer.weapon;
    } else if (offer.kind === 'recruit') {
      const u = Un.make(offer.cls, 0, offer.name, offer.level);
      s.roster.push(snapshot(u));
    } else if (offer.kind === 'drill') {
      const u = find(offer.unit);
      if (u) u[offer.stat] = (u[offer.stat] || 0) + offer.amount;
    } else if (offer.kind === 'rally') {
      for (const u of s.roster) { u.maxHp += offer.amount; u.hp = u.maxHp; }
    }
    s.offers = null;
    save(s);
    return s;
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
      s.last.final = s.wave >= RUN;
      if (s.wave >= RUN) {
        // the run is finished, and finished is a thing you can be
        s.wins = (s.wins || 0) + 1;
        s.runs = (s.runs || 0) + 1;
        const best = s.best, runs = s.runs, wins = s.wins, last = s.last;
        Object.assign(s, fresh(), { best, runs, wins, last });
      } else {
        s.wave++;
        s.offers = null;
      }
      if (!s.roster.length) { s.runs = (s.runs || 0) + 1; const f = fresh(); f.best = s.best; f.runs = s.runs; f.wins = s.wins; Object.assign(s, f, { last: s.last }); }
    } else {
      s.runs = (s.runs || 0) + 1;
      const best = s.best, runs = s.runs, wins = s.wins, last = s.last;
      Object.assign(s, fresh(), { best, runs, wins, last });
    }
    save(s);
    return s.last;
  }

  return { fresh, load, save, snapshot, restore, enemyPlan, playerPlan, afterBattle,
           offers, take, START, RUN };
})();
