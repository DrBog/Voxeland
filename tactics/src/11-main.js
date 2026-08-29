/* IRONWAKE — the shell.
   Boot, the fixed-step loop, the camera, and the one hard input problem a
   3D tactics game has on a phone: telling a tap on a tile apart from a drag
   of the world, on a map where two tiles can sit above each other. */
(function () {
  const R = K.render, B = K.battle, U = K.util, Un = K.units;
  const { clamp, lerp } = U;

  const canvas = document.getElementById('view');
  const view = R.View(canvas);

  const g = {
    battle: null, cam: null, view,
    t: 0, hover: null, pathPreview: null, cardUnit: null, pair: null,
    threat: [], running: false, baseDist: 21
  };
  window.G = g;   // the console is a legitimate debugging surface

  function newBattle(seed) {
    const run = g.run;
    const rnd = U.rng((run.wave * 7919 + (run.runs || 0) * 104729) >>> 0);
    g.battle = B.create(seed, {
      wave: run.wave,
      player: K.camp.playerPlan(run),
      enemy: run.wave === 1 && (run.runs || 0) === 0 ? null : K.camp.enemyPlan(run.wave, rnd)
    });
    g.summary = null;
    g.cam = R.Camera(g.battle.arena);
    g.baseDist = 21;
    g.cam.wantDist = g.baseDist;
    g.hover = null; g.pathPreview = null; g.cardUnit = null; g.pair = null; g.threat = [];
    const c = centreOf(g.battle);
    g.cam.tx = g.cam.fx = c.x; g.cam.ty = g.cam.fy = c.y; g.cam.tz = g.cam.fz = c.z;
    R.camUpdate(g.cam, 1);
  }

  /* At rest the camera sits between your line and the middle of the board:
     close enough that the units you command are the subject, wide enough that
     you can see what is coming for them. */
  function centreOf(b) {
    const mine = B.living(b, 0);
    if (!mine.length) return { x: 0, y: 1.4, z: 0 };
    let x = 0, y = 0, z = 0;
    for (const u of mine) { const w = b.arena.world(u.surface); x += w.x; y += w.y; z += w.z; }
    const k = 0.45;
    return { x: lerp(x / mine.length, 0, k), y: y / mine.length + 1.1, z: lerp(z / mine.length, 0, k) };
  }

  const unitOn = (b, s) => b.units.find(u => !u.dead && u.surface === s) || null;

  /* where should this unit stand to hit that one? cheapest tile that reaches,
     preferring cover, height, and a weak answer */
  function bestApproach(b, u, foe) {
    if (!b.reach) return null;
    let best = null;
    for (const [, e] of b.reach) {
      const s = e.s;
      if (s !== u.surface && B.occupied(b, s, u)) continue;
      const save = u.surface; u.surface = s;
      const can = Un.inRange(u, foe, b.arena);
      const fc = can ? Un.forecast(u, foe, b.arena) : null;
      u.surface = save;
      if (!can) continue;
      const score = fc.a.total * 8 - (fc.b ? fc.b.total * 5 : -14)
        + fc.a.crit * 0.3 + s.t.avoid * 0.5 + (s.y - foe.surface.y) * 3 - e.cost * 1.2;
      if (!best || score > best.score) best = { score, s };
    }
    return best;
  }

  /* every tile an enemy could strike next turn — the question you actually
     ask before you step out from behind a wall */
  function threatOf(b, u) {
    const reach = b.arena.reach(u.surface, u.mov, s => B.occupied(b, s, u));
    const out = new Set(), lo = u.weapon.rng[0], hi = u.weapon.rng[1];
    for (const [, e] of reach) {
      for (const s of b.arena.surfaces) {
        const d = b.arena.dist(e.s, s);
        if (d >= lo && d <= hi) out.add(s);
      }
    }
    return [...out];
  }

  /* ------------------------------------------------------------------ taps */

  /* A finger lands on a BODY, not on the tile behind it. Casting the tap ray
     straight at the map picks up whatever is a metre further out, which is how
     you end up selecting the tile behind the unit you meant to pick, so units
     are hit-tested in screen space first. */
  function unitAt(sx, sy) {
    const b = g.battle;
    let best = null;
    for (const u of b.units) {
      if (u.dead) continue;
      const a = B.actorOf(b, u);
      if (!a) continue;
      const c = a.body.parts.chest;
      const p = R.screenOf(view, c.x, c.y, c.z);
      if (!p) continue;
      const d = Math.hypot(p.x - sx, p.y - sy);
      const r = Math.max(20, 0.5 * p.s);
      if (d < r && (!best || d < best.d)) best = { u, d };
    }
    return best ? best.u : null;
  }

  function tap(sx, sy) {
    const b = g.battle;
    const hit = unitAt(sx, sy);
    const s = hit ? hit.surface : R.pick(view, sx, sy, b.arena);
    if (!s) { if (!b.sel) { g.cardUnit = null; g.threat = []; } return; }
    const u = hit || unitOn(b, s);

    if (b.over) return;
    if (b.busy || b.phase !== 'player') { if (u) g.cardUnit = u; return; }

    // a target is already proposed: tapping it again is the commit
    if (g.pair) {
      if (u === g.pair.def) { commit(); return; }
      g.pair = null; g.pathPreview = null;
      // fall through: the tap also means whatever it would have meant
    }

    // the unit has moved and is choosing who to hit
    if (b.sel && !b.reach) {
      if (u && b.targets.indexOf(u) >= 0) {
        g.pair = { att: b.sel, def: u, spot: b.sel.surface }; g.cardUnit = u;
        K.audio.buy();
      } else if (u) g.cardUnit = u;
      return;
    }

    // the unit is choosing where to go
    if (b.sel && b.reach) {
      if (u === b.sel) {                       // hold this ground
        b.targets = B.targetsFrom(b, b.sel, b.sel.surface);
        b.reach = null; g.pathPreview = null;
        if (!b.targets.length) B.finishUnit(b, b.sel);
        return;
      }
      if (u && u.side === 1) {
        // A tap on an enemy PROPOSES the attack: it shows where you would end
        // up and what the exchange looks like. Committing is a second,
        // deliberate act — nobody should lose a unit to a stray tap.
        const spot = bestApproach(b, b.sel, u);
        if (spot) {
          const save = b.sel.surface; b.sel.surface = spot.s;
          g.pair = { att: b.sel, def: u, spot: spot.s };
          b.sel.surface = save;
          g.cardUnit = u;
          g.pathPreview = spot.s === b.sel.surface ? null : b.arena.pathTo(b.reach, spot.s);
          K.audio.buy();
        } else { g.cardUnit = u; g.threat = threatOf(b, u); }
        return;
      }
      if (u && u.side === 0 && !u.acted) { B.select(b, u); g.cardUnit = u; g.threat = []; return; }
      if (b.reach.has(s.id) && !B.occupied(b, s, b.sel)) {
        B.moveTo(b, b.sel, s);
        g.pathPreview = null;
        return;
      }
      B.clearSel(b); g.cardUnit = null; g.pathPreview = null;
      return;
    }

    // nothing selected
    if (u) {
      g.cardUnit = u;
      if (u.side === 0 && !u.acted) { B.select(b, u); g.threat = []; K.audio.buy(); }
      else g.threat = threatOf(b, u);
    } else { g.cardUnit = null; g.threat = []; }
  }

  /* the second tap: walk there if we have to, then swing */
  function commit() {
    const b = g.battle;
    if (!g.pair || b.busy) return;
    const { att, def, spot } = g.pair;
    g.pair = null; g.pathPreview = null; b.targets = [];
    if (spot && spot !== att.surface && b.reach) B.moveTo(b, att, spot, def);
    else B.attack(b, att, def);
  }

  /* --------------------------------------------------------------- pointer */

  const ptrs = new Map();
  let dragging = false, downT = 0, downX = 0, downY = 0, pinch0 = 0, dist0 = 0;

  function localPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = localPos(e);
    ptrs.set(e.pointerId, p);
    if (ptrs.size === 1) { dragging = false; downT = performance.now(); downX = p.x; downY = p.y; }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      dist0 = g.cam.wantDist;
      dragging = true;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = localPos(e);
    const prev = ptrs.get(e.pointerId);
    if (!prev) {                                  // a mouse simply hovering
      hoverAt(p.x, p.y);
      return;
    }
    ptrs.set(e.pointerId, p);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 8) {
        g.baseDist = clamp(dist0 * (pinch0 / Math.max(8, d)), 8, 38);
        g.cam.wantDist = g.baseDist;
      }
      return;
    }
    const dx = p.x - prev.x, dy = p.y - prev.y;
    if (!dragging && Math.hypot(p.x - downX, p.y - downY) > 9) dragging = true;
    if (dragging) {
      g.cam.wantYaw -= dx * 0.0075;
      g.cam.wantPitch = clamp(g.cam.wantPitch + dy * 0.0055, 0.14, 1.32);
    }
  });

  function endPointer(e) {
    const p = localPos(e);
    const had = ptrs.has(e.pointerId);
    ptrs.delete(e.pointerId);
    if (!had) return;
    if (ptrs.size === 0 && !dragging && performance.now() - downT < 600) {
      if (g.running) tap(p.x, p.y);
    }
    if (ptrs.size === 0) dragging = false;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => {
    if (!g.cam) return;
    g.baseDist = clamp(g.baseDist + e.deltaY * 0.012, 8, 38);
    g.cam.wantDist = g.baseDist;
  }, { passive: true });

  function hoverAt(sx, sy) {
    const b = g.battle;
    if (!b || b.busy) return;
    const hit = unitAt(sx, sy);
    const s = hit ? hit.surface : R.pick(view, sx, sy, b.arena);
    g.hover = s;
    if (g.pair) return;
    g.pathPreview = null;
    if (s && b.sel && b.reach && b.reach.has(s.id) && !B.occupied(b, s, b.sel)) {
      g.pathPreview = b.arena.pathTo(b.reach, s);
    }
  }

  /* ---------------------------------------------------------------- camera */

  function driveCamera(dt) {
    const b = g.battle, cam = g.cam;
    let want = null, close = null;
    if (b.busy && b.busy.kind === 'fight') {
      const a = b.busy.aA, d = b.busy.aD;
      want = { x: (a.pos.x + d.pos.x) / 2, y: (a.body.parts.chest.y + d.body.parts.chest.y) / 2, z: (a.pos.z + d.pos.z) / 2 };
      close = Math.min(g.baseDist, 13.5);
    } else if (b.busy && b.busy.act) {
      const a = b.busy.act;
      want = { x: a.pos.x, y: a.body.parts.chest.y, z: a.pos.z };
      close = Math.min(g.baseDist, 17);
    } else if (b.sel) {
      const a = B.actorOf(b, b.sel);
      if (a) want = { x: a.pos.x, y: a.pos.y + 0.9, z: a.pos.z };
    } else if (b.phase === 'enemy' && b.focus) {
      want = { x: b.focus.pos.x, y: b.focus.pos.y + 0.9, z: b.focus.pos.z };
    } else if (g.cardUnit && !g.cardUnit.dead) {
      // looking one of theirs up should also look AT them
      const a = B.actorOf(b, g.cardUnit);
      if (a) want = { x: a.pos.x, y: a.pos.y + 0.9, z: a.pos.z };
    }
    if (!want) {
      want = centreOf(b);
    }
    cam.fx = want.x; cam.fy = want.y; cam.fz = want.z;
    cam.wantDist = close || g.baseDist;
    cam.shake = Math.max(cam.shake, b.shake);
    R.camUpdate(cam, dt);
  }

  /* ------------------------------------------------------------------ loop */

  let last = 0, acc = 0;
  const STEP = 1 / 120;

  function loop(now) {
    requestAnimationFrame(loop);
    const t = now / 1000;
    let dt = last ? Math.min(0.1, t - last) : 0.016;
    last = t;
    g.t += dt;

    if (g.running) {
      acc += dt;
      let n = 0;
      const s0 = performance.now();
      while (acc >= STEP && n < 6) { B.step(g.battle, STEP); acc -= STEP; n++; }
      g.simMs = g.simMs ? g.simMs * 0.92 + (performance.now() - s0) * 0.08 : (performance.now() - s0);
      if (acc > 0.3) acc = 0;
      driveCamera(dt);
      // keep the selection card honest without the player having to re-tap
      if (g.battle.sel && !g.cardUnit) g.cardUnit = g.battle.sel;
      if (g.pair && (g.pair.def.dead || g.pair.att.dead || g.battle.busy)) { g.pair = null; g.pathPreview = null; }
      // the moment a field is settled, the run banks it
      if (g.battle.over && !g.summary) {
        g.summary = K.camp.afterBattle(g.run, g.battle, g.battle.over === 'win');
      }
    }

    if (view.w !== canvas.getBoundingClientRect().width) R.resize(view);
    const t0 = performance.now();
    R.frame(view, g, dt);
    // a running estimate of how much of the frame this costs, so the cost of
    // a change is a number rather than an opinion
    g.drawMs = g.drawMs ? g.drawMs * 0.92 + (performance.now() - t0) * 0.08 : (performance.now() - t0);
    K.ui.sync(g);
  }

  /* ------------------------------------------------------------------ boot */

  K.ui.init({
    start: () => { g.running = true; },
    again: () => { newBattle(); g.running = true; },
    wipe: () => { g.run = K.camp.fresh(); K.camp.save(g.run); newBattle(); g.running = true; },
    attack: () => commit(),
    wait: () => { const b = g.battle; if (b.sel) B.finishUnit(b, b.sel); g.pair = null; g.cardUnit = null; },
    cancel: () => { B.clearSel(g.battle); g.pair = null; g.cardUnit = null; g.pathPreview = null; },
    end: () => { B.endPhase(g.battle); g.cardUnit = null; g.pair = null; }
  });

  g.run = K.camp.load();
  newBattle();
  R.resize(view);
  window.addEventListener('resize', () => R.resize(view));
  window.addEventListener('orientationchange', () => setTimeout(() => R.resize(view), 220));
  requestAnimationFrame(loop);
})();
