/* IRONWAKE — units, weapons and the arithmetic of a duel.
   Fire Emblem's combat maths, with two additions the third dimension earns:
   height gives the high ground real bite, and a killing blow carries physical
   force, which is what the ragdoll turns into a fall off a bridge. */
K.units = (function () {
  const U = K.util;
  const { clamp } = U;

  const WEAPONS = {
    iron_sword:  { name: 'Iron Sword',  kind: 'sword', mt: 5, hit: 90, crit: 5,  rng: [1, 1], wt: 5 },
    steel_sword: { name: 'Steel Sword', kind: 'sword', mt: 8, hit: 80, crit: 3,  rng: [1, 1], wt: 9 },
    iron_lance:  { name: 'Iron Lance',  kind: 'lance', mt: 6, hit: 85, crit: 3,  rng: [1, 1], wt: 7 },
    iron_axe:    { name: 'Iron Axe',    kind: 'axe',   mt: 7, hit: 75, crit: 3,  rng: [1, 1], wt: 9 },
    hand_axe:    { name: 'Hand Axe',    kind: 'axe',   mt: 6, hit: 65, crit: 2,  rng: [1, 2], wt: 10 },
    short_bow:   { name: 'Short Bow',   kind: 'bow',   mt: 5, hit: 85, crit: 5,  rng: [2, 2], wt: 6 },
    fire:        { name: 'Fire',        kind: 'tome',  mt: 5, hit: 90, crit: 0,  rng: [1, 2], wt: 5, magic: true }
  };

  /* sword beats axe beats lance beats sword */
  const BEATS = { sword: 'axe', axe: 'lance', lance: 'sword' };
  function triangle(a, b) {
    if (!a || !b) return 0;
    if (BEATS[a.kind] === b.kind) return 1;
    if (BEATS[b.kind] === a.kind) return -1;
    return 0;
  }

  const CLASSES = {
    Blade:   { hp: 20, str: 6, mag: 0, skl: 7, spd: 8, lck: 4, def: 6, res: 1, mov: 6,
               growth: { hp: 70, str: 45, skl: 50, spd: 55, lck: 40, def: 35, res: 20 },
               weapon: 'iron_sword', tag: 'quick, fragile, hits often' },
    Halberd: { hp: 24, str: 7, mag: 0, skl: 5, spd: 5, lck: 3, def: 8, res: 2, mov: 5,
               growth: { hp: 85, str: 55, skl: 35, spd: 30, lck: 25, def: 55, res: 25 },
               weapon: 'iron_lance', tag: 'holds ground, beats swords' },
    Reaver:  { hp: 26, str: 9, mag: 0, skl: 4, spd: 4, lck: 2, def: 6, res: 0, mov: 6,
               growth: { hp: 90, str: 65, skl: 30, spd: 30, lck: 20, def: 40, res: 10 },
               weapon: 'iron_axe', tag: 'heaviest swing on the field' },
    Archer:  { hp: 18, str: 5, mag: 0, skl: 8, spd: 6, lck: 5, def: 4, res: 3, mov: 6,
               growth: { hp: 60, str: 40, skl: 60, spd: 45, lck: 45, def: 20, res: 25 },
               weapon: 'short_bow', tag: 'reaches two tiles, cannot counter close' },
    Ember:   { hp: 17, str: 2, mag: 7, skl: 6, spd: 6, lck: 4, def: 3, res: 7, mov: 6,
               growth: { hp: 55, str: 15, skl: 45, spd: 45, lck: 40, def: 15, res: 55 },
               weapon: 'fire', tag: 'burns armour, folds under a blade' }
  };

  let nextId = 1;
  function make(cls, side, name, level) {
    const C = CLASSES[cls];
    const u = {
      id: nextId++, cls, side, name: name || cls, level: level || 1,
      hp: C.hp, maxHp: C.hp,
      str: C.str, mag: C.mag, skl: C.skl, spd: C.spd, lck: C.lck, def: C.def, res: C.res,
      mov: C.mov, weapon: WEAPONS[C.weapon], growth: C.growth, tag: C.tag,
      exp: 0, acted: false, dead: false, surface: null, facing: 0,
      guard: false, alert: 4
    };
    // grow() advances the level itself, so walk to the target from level 1
    const target = u.level;
    u.level = 1;
    while (u.level < target) grow(u, () => Math.random());
    u.hp = u.maxHp;
    return u;
  }

  function grow(u, rnd) {
    const g = u.growth, gained = [];
    for (const k of ['hp', 'str', 'skl', 'spd', 'lck', 'def', 'res']) {
      if ((rnd() * 100) < (g[k] || 0)) {
        if (k === 'hp') { u.maxHp += 1; u.hp += 1; } else u[k] += 1;
        gained.push(k);
      }
    }
    u.level++;
    return gained;
  }

  /* attack speed: a heavy weapon in weak hands slows you down */
  const AS = u => u.spd - Math.max(0, u.weapon.wt - Math.floor(u.str * 0.6 + 3));

  function heightStep(a, d) {
    if (!a.surface || !d.surface) return 0;
    return clamp((a.surface.y - d.surface.y) / 1.5, -1.5, 1.5);
  }

  /* everything one side does to the other in a single exchange */
  function strike(att, def, arena) {
    const w = att.weapon, tri = triangle(w, def.weapon);
    const high = heightStep(att, def);
    const magic = !!w.magic;
    const atk = (magic ? att.mag : att.str) + w.mt + tri * 1 + Math.round(high);
    const armour = (magic ? def.res : def.def) + (def.surface ? def.surface.t.def : 0);
    const dmg = Math.max(0, atk - armour);
    const hit = w.hit + att.skl * 2 + Math.floor(att.lck / 2) + tri * 15 + Math.round(high * 10);
    const avoid = AS(def) * 2 + def.lck + (def.surface ? def.surface.t.avoid : 0);
    const acc = clamp(hit - avoid, 5, 100);
    const crit = clamp(w.crit + Math.floor(att.skl / 2) - def.lck, 0, 60);
    return { dmg, acc, crit, tri, high, magic };
  }

  function inRange(att, def, arena) {
    if (!att.surface || !def.surface) return false;
    const d = arena.dist(att.surface, def.surface);
    return d >= att.weapon.rng[0] && d <= att.weapon.rng[1];
  }

  /* the forecast panel: what will happen if these two meet */
  function forecast(att, def, arena) {
    const a = strike(att, def, arena);
    const canCounter = inRange(def, att, arena) && !def.dead;
    const b = canCounter ? strike(def, att, arena) : null;
    const aDouble = AS(att) - AS(def) >= 4;
    const bDouble = b && AS(def) - AS(att) >= 4;
    return {
      att, def,
      a: { ...a, hits: aDouble ? 2 : 1, total: a.dmg * (aDouble ? 2 : 1) },
      b: b ? { ...b, hits: bDouble ? 2 : 1, total: b.dmg * (bDouble ? 2 : 1) } : null,
      lethal: a.dmg * (aDouble ? 2 : 1) >= def.hp
    };
  }

  /* Fire Emblem rolls hit twice and averages — displayed odds feel honest */
  function rollHit(acc, rnd) { return ((rnd() * 100 + rnd() * 100) / 2) < acc; }

  /* resolve one exchange, returning the blow-by-blow for the presentation */
  function resolve(att, def, arena, rnd) {
    rnd = rnd || Math.random;
    const f = forecast(att, def, arena);
    const blows = [];
    const order = [];
    order.push(['a', 1]);
    if (f.b) order.push(['b', 1]);
    if (f.a.hits > 1) order.push(['a', 2]);
    if (f.b && f.b.hits > 1) order.push(['b', 2]);

    for (const [who] of order) {
      const src = who === 'a' ? att : def;
      const dst = who === 'a' ? def : att;
      if (src.dead || dst.dead) continue;
      const s = who === 'a' ? f.a : f.b;
      const hit = rollHit(s.acc, rnd);
      const crit = hit && (rnd() * 100) < s.crit;
      const dmg = hit ? s.dmg * (crit ? 3 : 1) : 0;
      dst.hp = Math.max(0, dst.hp - dmg);
      const killed = dst.hp <= 0;
      if (killed) dst.dead = true;
      blows.push({ src, dst, hit, crit, dmg, killed, magic: s.magic });
      if (killed) break;
    }
    // experience, the way a tactics game should: more for a kill, more for a
    // fight you were not supposed to win
    if (!att.dead) {
      const lvlGap = clamp(def.level - att.level, -5, 5);
      att.exp += blows.some(b => b.killed && b.src === att) ? 30 + lvlGap * 3 : 10 + lvlGap;
    }
    return { forecast: f, blows };
  }

  return { WEAPONS, CLASSES, make, grow, strike, forecast, resolve, inRange, triangle, AS };
})();
