/* IRONWAKE — the turn.
   Player phase, enemy phase, and an action queue that lets a blow take the
   time it needs: the swing, the impact, the body going over the rail. */
K.battle = (function () {
  const U = K.util, Un = K.units, A = K.actor;
  const { clamp } = U;

  /* A battle is built from a plan so a campaign can hand it veterans and a
     harder line every wave; with no plan it builds the opening skirmish. */
  function create(seed, plan) {
    const wave = (plan && plan.wave) || 1;
    // the first field is the one everybody sees first, so it is the built one;
    // after that the generator picks, and every map it hands over has been
    // checked for connection, height, a drop and room to form up
    /* Which PLACE this fight is in comes first, because the place decides
       which board shapes are even possible in it: you do not get a citadel in
       the middle of the Glasswaste. The zone names its layouts, the seed
       picks between them, and only then is an arena built. */
    const sd = seed || ((Math.random() * 1e9) | 0);
    const zone = (plan && plan.zone) || (K.zones ? K.zones.forWave(wave) : null);
    const want = (plan && plan.layout)
      || (wave === 1 ? 'courtyard' : (zone ? K.zones.layoutFor(zone, sd) : null));
    const arena = K.grid.make(sd, { layout: want, avoid: plan && plan.avoid });
    const b = {
      arena, zone, level: arena.collider(),
      units: [], actors: new Map(), turn: 1, phase: 'player',
      sel: null, reach: null, targets: [], hover: null,
      busy: null, log: [], banner: null, over: null, focus: null,
      aiT: 0, forecast: null, popups: [], fx: [], shake: 0, threat: []
    };
    b.occupiedFn = (s) => occupied(b, s);

    const place = (u, s) => {
      if (!s) return u;
      u.surface = s; s.occupant = u;
      b.units.push(u);
      b.actors.set(u.id, A.create(u, arena));
      return u;
    };

    /* Form up: the tiles nearest the other side go to whoever is placed first,
       and a roster runs melee-first, so the line ends up with blades in front
       of bows without anybody having to say so. */
    const centre = (list) => {
      if (!list.length) return { x: arena.w / 2, z: arena.d / 2 };
      let x = 0, z = 0;
      for (const s of list) { x += s.x; z += s.z; }
      return { x: x / list.length, z: z / list.length };
    };
    const order = (list, toward) => list.slice().sort((p, q) =>
      (Math.abs(p.x - toward.x) + Math.abs(p.z - toward.z)) -
      (Math.abs(q.x - toward.x) + Math.abs(q.z - toward.z)));
    const mine = order(arena.spawns.player, centre(arena.spawns.enemy));
    const theirs = order(arena.spawns.enemy, centre(arena.spawns.player));
    const held = arena.spawns.guard.slice();
    const taken = new Set();
    const next = (pool) => {
      for (const s of pool) { if (!taken.has(s.id) && !s.occupant) { taken.add(s.id); return s; } }
      return null;
    };

    const P = (plan && plan.player) || K.camp.START;
    P.forEach((spec) => place(K.camp.restore(spec, 0), next(mine)));

    const E = (plan && plan.enemy) || [
      { cls: 'Reaver', name: 'GHAST', level: 3 },
      { cls: 'Halberd', name: 'BULWARK', level: 3 },
      { cls: 'Blade', name: 'SPINE', level: 2 },
      // the pair on the high ground hold what they were put there to hold,
      // and only come off it when something walks into their reach
      { cls: 'Archer', name: 'NEEDLE', level: 3, guard: true, alert: 5 },
      { cls: 'Reaver', name: 'MAUL', level: 3, guard: true, alert: 4 }
    ];
    for (const spec of E) {
      const u = Un.make(spec.cls, 1, spec.name, spec.level || 2);
      u.guard = !!spec.guard;
      u.alert = spec.alert || 4;
      if (spec.weapon && Un.WEAPONS[spec.weapon]) u.weapon = Un.WEAPONS[spec.weapon];
      if (spec.boss) { u.boss = true; u.maxHp += 8; u.hp = u.maxHp; }
      // a guard wants high ground; if there is none left it joins the line
      place(u, (u.guard ? next(held) : null) || next(theirs) || next(held));
    }

    b.units.forEach(u => { u.acted = false; });
    b.wave = wave;
    b.title = arena.title;
    const us = living(b, 0).length, them = living(b, 1).length;
    const boss = b.units.find(u => u.boss);
    b.banner = {
      title: boss ? 'THE LAST FIELD' : 'PLAYER PHASE',
      // the first wave's line used to be written out in full, four against
      // five, which stopped being true the moment anything but the first wave
      // of a fresh run loaded it — the yard is five a side and it still said four
      sub: plan && plan.yard ? (zone ? zone.name.toLowerCase() : 'the yard') + ' · ' + arena.title + ' · every trade, both sides'
        : boss ? boss.name + ' holds ' + arena.title + ' · ' + us + ' against ' + them
          : wave > 1 ? 'wave ' + wave + ' of ' + K.camp.RUN + ' · ' + arena.title + ' · ' + us + ' against ' + them
            : us + ' against ' + them + ', and they hold the high ground',
      t: 0
    };
    return b;
  }

  const actorOf = (b, u) => b.actors.get(u.id);
  const living = (b, side) => b.units.filter(u => !u.dead && (side === undefined || u.side === side));

  function occupied(b, s, except) {
    return b.units.some(u => !u.dead && u.surface === s && u !== except);
  }

  function select(b, u) {
    if (b.busy || b.phase !== 'player' || u.side !== 0 || u.acted || u.dead) return false;
    b.sel = u;
    b.reach = b.arena.reach(u.surface, u.mov, s => occupied(b, s, u));
    b.targets = [];
    b.forecast = null;
    return true;
  }

  function clearSel(b) { b.sel = null; b.reach = null; b.targets = []; b.forecast = null; }

  /* who can this unit hit from where it stands? */
  function targetsFrom(b, u, surface) {
    const save = u.surface; u.surface = surface;
    const out = living(b, u.side === 0 ? 1 : 0).filter(e => Un.inRange(u, e, b.arena));
    u.surface = save;
    return out;
  }

  function moveTo(b, u, surface, then) {
    if (!b.reach || !b.reach.has(surface.id) || occupied(b, surface, u)) return false;
    const path = b.arena.pathTo(b.reach, surface);
    if (!path) return false;
    const act = actorOf(b, u);
    u.surface.occupant = null;
    A.walkPath(act, path, b.arena);
    b.busy = { kind: 'move', u, act, surface, then: then ? 'attack' : null, target: then || null };
    b.focus = act;
    return true;
  }

  /* the exchange, played out with time between the blows */
  function attack(b, att, def) {
    const aA = actorOf(b, att), aD = actorOf(b, def);
    const result = Un.resolve(att, def, b.arena);
    b.busy = {
      kind: 'fight', att, def, aA, aD, result, i: 0, t: 0, stage: 'wind',
      lines: []
    };
    b.focus = aA;
    A.faceToward(aA, aD.pos.x, aD.pos.z);
    A.faceToward(aD, aA.pos.x, aA.pos.z);
    return true;
  }

  /* turn to face whoever is nearest — a line that all faces the same way
     regardless of where the enemy is looks like scenery, not soldiers */
  function faceThreat(b, u) {
    const act = actorOf(b, u);
    if (!act) return;
    let near = null, nd = 1e9;
    for (const f of living(b, u.side === 0 ? 1 : 0)) {
      const d = b.arena.dist(u.surface, f.surface);
      if (d < nd) { nd = d; near = f; }
    }
    const t = near && actorOf(b, near);
    if (t) A.faceToward(act, t.pos.x, t.pos.z);
  }

  function finishUnit(b, u) {
    u.acted = true;
    faceThreat(b, u);
    clearSel(b);
    // level ups are earned in the field, as they should be
    while (u.exp >= 100 && !u.dead) {
      u.exp -= 100;
      const gained = Un.grow(u, Math.random);
      const act = actorOf(b, u);
      if (act) popup(b, act, 'LEVEL ' + u.level, 'level', true);
      note(b, u.name + ' reaches level ' + u.level + (gained.length ? ' — ' + gained.join(' ') : ' — nothing gained'), 'level');
    }
    if (!living(b, 0).some(x => !x.acted)) endPhase(b);
    checkOver(b);
  }

  function note(b, text, kind) {
    b.log.unshift({ text, kind: kind || 'info' });
    b.log = b.log.slice(0, 30);
  }

  function endPhase(b) {
    if (b.over) return;
    b.fields = null;              // everybody has moved; the routes are stale
    clearSel(b);
    if (b.phase === 'player') {
      b.phase = 'enemy';
      living(b, 1).forEach(u => { u.acted = false; });
      b.banner = { title: 'ENEMY PHASE', sub: '', t: 0 };
    } else {
      b.phase = 'player';
      b.turn++;
      living(b, 0).forEach(u => { u.acted = false; });
      b.banner = { title: 'PLAYER PHASE', sub: 'turn ' + b.turn, t: 0 };
    }
    b.aiT = 0.6;
  }

  function checkOver(b) {
    if (b.over) return;
    if (!living(b, 1).length) { b.over = 'win'; b.banner = { title: 'FIELD HELD', sub: 'every one of them is down', t: 0 }; }
    else if (!living(b, 0).length) { b.over = 'loss'; b.banner = { title: 'OVERRUN', sub: 'the arena keeps what it takes', t: 0 }; }
  }

  /* ---------------------------------------------------------------- enemy */

  /* how far every tile is from the enemy this unit should be walking at,
     measured along the ground a unit can actually walk */
  function approachField(b, u, foes) {
    let near = null, nd = 1e9;
    for (const f of foes) {
      const d = b.arena.dist(u.surface, f.surface);
      if (d < nd) { nd = d; near = f; }
    }
    if (!near) return new Map();
    if (!b.fields) b.fields = new Map();
    const key = near.surface.id;
    let field = b.fields.get(key);
    if (!field) { field = b.arena.costsFrom(near.surface); b.fields.set(key, field); }
    return field;
  }

  function aiTurn(b) {
    const me = living(b, 1).filter(u => !u.acted);
    if (!me.length) { endPhase(b); return; }
    const u = me[0];
    const foes = living(b, 0);
    if (!foes.length) { endPhase(b); return; }

    // a guard does not abandon its ground for a target it cannot see coming
    if (u.guard) {
      const near = foes.some(f => b.arena.dist(u.surface, f.surface) <= u.alert);
      if (!near) { u.acted = true; return; }
    }
    const reach = b.arena.reach(u.surface, u.mov, s => occupied(b, s, u));
    let best = null;
    for (const [, entry] of reach) {
      const s = entry.s;
      if (occupied(b, s, u)) continue;
      for (const f of foes) {
        const save = u.surface; u.surface = s;
        const can = Un.inRange(u, f, b.arena);
        const fc = can ? Un.forecast(u, f, b.arena) : null;
        u.surface = save;
        if (!can) continue;
        // prefer a kill, then damage dealt, then damage avoided, then height
        const score = (fc.lethal ? 1000 : 0) + fc.a.total * 10 - (fc.b ? fc.b.total * 6 : -20)
          + (s.y - f.surface.y) * 4 + s.t.avoid * 0.4 - entry.cost * 0.2;
        if (!best || score > best.score) best = { score, s, f, cost: entry.cost };
      }
    }
    if (!best) {
      // Nobody in reach: close on the nearest foe BY THE ROUTE, not by the
      // crow. On a map with a chasm across it the two are different answers,
      // and the crow's answer parks an army on the wrong side of a hole.
      const field = approachField(b, u, foes);
      let goal = null;
      for (const [, entry] of reach) {
        const s = entry.s;
        if (occupied(b, s, u)) continue;
        const d = field.get(s.id);
        if (d === undefined) continue;                 // no route from there
        const score = -d * 10 - entry.cost * 0.1 + s.t.avoid * 0.2;
        if (!goal || score > goal.score) goal = { score, s };
      }
      if (goal && goal.s !== u.surface) {
        const path = b.arena.pathTo(reach, goal.s);
        u.surface.occupant = null;
        A.walkPath(actorOf(b, u), path, b.arena);
        b.busy = { kind: 'move', u, act: actorOf(b, u), surface: goal.s, then: 'wait' };
        b.focus = actorOf(b, u);
      } else { u.acted = true; }
      return;
    }
    if (best.s !== u.surface) {
      const path = b.arena.pathTo(reach, best.s);
      u.surface.occupant = null;
      A.walkPath(actorOf(b, u), path, b.arena);
      b.busy = { kind: 'move', u, act: actorOf(b, u), surface: best.s, then: 'attack', target: best.f };
      b.focus = actorOf(b, u);
    } else {
      attack(b, u, best.f);
    }
  }

  /* ----------------------------------------------------------------- step */

  /* small presentation helpers — the numbers and grit that sell a blow */
  function popup(b, act, text, kind, big) {
    const h = act.body.parts.head;
    b.popups.push({ x: h.x, y: h.y + 0.3, z: h.z, text, kind: kind || 'hit', big: !!big, t: 0 });
  }
  function sparks(b, act, n, force) {
    const c = act.body.parts.chest;
    for (let i = 0; i < n; i++) {
      b.fx.push({
        x: c.x, y: c.y, z: c.z,
        vx: (Math.random() - 0.5) * force, vy: Math.random() * force * 0.8 + 0.6,
        vz: (Math.random() - 0.5) * force,
        r: 0.03 + Math.random() * 0.04, t: 0, max: 0.4 + Math.random() * 0.4,
        kind: Math.random() < 0.6 ? 'spark' : 'dust'
      });
    }
  }

  function step(b, dt) {
    for (const [, a] of b.actors) A.step(a, dt, b.arena, b.level);
    if (b.banner) { b.banner.t += dt; if (b.banner.t > 2.6) b.banner = null; }
    b.shake = Math.max(0, b.shake - dt * 2.5);
    for (let i = b.popups.length - 1; i >= 0; i--) {
      const p = b.popups[i]; p.t += dt;
      if (p.t > 1.5) b.popups.splice(i, 1);
    }
    for (let i = b.fx.length - 1; i >= 0; i--) {
      const p = b.fx[i]; p.t += dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= 9 * dt;
      if (p.t > p.max) b.fx.splice(i, 1);
    }

    if (b.busy) {
      const job = b.busy;
      if (job.kind === 'move') {
        if (job.act.mode !== 'walk') {
          job.u.surface = job.surface;
          job.surface.occupant = job.u;
          b.busy = null;
          if (job.then === 'attack' && job.target && !job.target.dead) attack(b, job.u, job.target);
          else if (job.u.side === 1) job.u.acted = true;
          else {
            // player unit has arrived: offer what it can reach
            b.targets = targetsFrom(b, job.u, job.surface);
            b.sel = job.u;
            b.reach = null;
            if (!b.targets.length) finishUnit(b, job.u);
          }
        }
      } else if (job.kind === 'fight') {
        job.t += dt;
        const blow = job.result.blows[job.i];
        if (!blow) {
          if (job.t > 0.5) {
            b.busy = null;
            const u = job.att;
            if (u.side === 0) finishUnit(b, u); else { u.acted = true; checkOver(b); }
          }
        } else if (job.stage === 'wind') {
          const src = blow.src === job.att ? job.aA : job.aD;
          const dst = blow.src === job.att ? job.aD : job.aA;
          A.strikeAt(src, dst);
          job.stage = 'land'; job.t = 0;
        } else if (job.stage === 'land' && job.t > 0.22) {
          const src = blow.src === job.att ? job.aA : job.aD;
          const dst = blow.src === job.att ? job.aD : job.aA;
          if (blow.hit) {
            const force = 1.2 + blow.dmg * 0.22 + (blow.crit ? 2.2 : 0);
            A.takeHit(dst, src.pos.x, src.pos.z, force, blow.killed, blow.crit);
            K.audio.impact(clamp(blow.dmg / 12, 0.2, 1));
            popup(b, dst, (blow.crit ? '' : '') + blow.dmg, blow.crit ? 'crit' : 'hit', blow.crit || blow.killed);
            sparks(b, dst, blow.crit ? 16 : 8, 1.4 + blow.dmg * 0.16);
            b.shake = Math.min(1, b.shake + (blow.crit ? 0.7 : 0.28) + blow.dmg * 0.02);
            note(b, blow.src.name + (blow.crit ? ' CRITS ' : ' hits ') + blow.dst.name
              + ' for ' + blow.dmg + (blow.killed ? ' — down' : ''), blow.crit ? 'crit' : 'hit');
          } else {
            popup(b, dst, 'miss', 'miss');
            note(b, blow.dst.name + ' evades ' + blow.src.name, 'miss');
          }
          if (blow.killed) {
            blow.dst.surface.occupant = null;
            checkOver(b);
          }
          job.i++; job.stage = 'wind'; job.t = 0;
          if (blow.killed) job.t = -0.6;
        }
      }
      return;
    }

    if (b.over) return;
    if (b.phase === 'enemy') {
      b.aiT -= dt;
      if (b.aiT <= 0) { b.aiT = 0.45; aiTurn(b); }
    }
  }

  return { create, step, select, clearSel, moveTo, attack, targetsFrom, finishUnit,
           endPhase, living, actorOf, occupied, note, popup, aiTurn, faceThreat };
})();
