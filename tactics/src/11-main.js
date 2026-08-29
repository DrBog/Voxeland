/* IRONWAKE — the shell.
   Boot, the fixed-step loop, the camera and the input. The hard problem on a
   phone is that one finger has to mean three things — pick a tile, pick the
   unit standing on it, and move the view — on a board where two tiles can sit
   above one another. Drag moves the camera, a tap picks, and a unit is
   hit-tested in screen space before the ray ever reaches the map. */
(function () {
  const R = K.render, B = K.battle, U = K.util, Un = K.units;
  const { clamp, lerp } = U;

  const canvas = document.getElementById('view');
  const view = R.View(canvas);

  const g = {
    battle: null, cam: null, view,
    t: 0, hover: null, pathPreview: null, cardUnit: null, pair: null,
    threat: [], running: false,
    zoomT: 0.85,            // 0 = in among them, 1 = the whole board
    zoomAuto: true, fitDist: 26, manual: false, look: null
  };
  window.G = g;   // the console is a legitimate debugging surface

  /* ------------------------------------------------------------------ setup */

  function newBattle() {
    const run = g.run;
    const rnd = U.rng((run.wave * 7919 + (run.runs || 0) * 104729) >>> 0);
    g.battle = B.create(null, {
      wave: run.wave,
      avoid: run.lastLayout,
      player: K.camp.playerPlan(run),
      enemy: run.wave === 1 && (run.runs || 0) === 0 ? null : K.camp.enemyPlan(run.wave, rnd)
    });
    g.summary = null;
    // the renderer asks g for the zone, so the shell is what decides it
    g.zone = g.battle.zone;
    g.cam = R.Camera(g.battle.arena);
    g.hover = null; g.pathPreview = null; g.cardUnit = null; g.pair = null; g.threat = [];
    g.manual = false; g.look = null; g.zoomT = 0.85; g.zoomAuto = true;
    measure();
    const c = restPoint();
    g.cam.tx = g.cam.fx = c.x; g.cam.ty = g.cam.fy = c.y; g.cam.tz = g.cam.fz = c.z;
    R.camUpdate(g.cam, 1);
  }

  /* the board is framed in the gap between the two bars, and how far away the
     camera has to be for that is a measurement, not a guess */
  function measure() {
    view.band = K.ui.band();
    R.resize(view);
    if (g.battle && g.cam) g.fitDist = R.fitDistance(view, g.battle.arena, g.cam);
  }

  function restPoint() {
    const b = g.battle;
    const mine = B.living(b, 0);
    if (!mine.length) return { x: 0, y: 1.4, z: 0 };
    let y = 0;
    for (const u of mine) y += b.arena.world(u.surface).y;
    // surveying, the board is the subject and it is centred; the small pull
    // toward your own line is only so your side sits nearer the near edge
    return { x: 0, y: y / mine.length + 1.2, z: 1.2 };
  }

  const unitOn = (b, s) => b.units.find(u => !u.dead && u.surface === s) || null;

  /* ------------------------------------------------------------- reasoning */

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
     straight at the map picks up whatever is a metre further out, so units are
     hit-tested in screen space first. */
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
      const r = Math.max(22, 0.5 * p.s);
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
    // a tap that cannot do anything should say why, once, in the hint line
    if (u && u.side === 0 && u.acted && !b.sel) {
      g.cardUnit = u;
      g.note = { text: u.name + ' has already moved this turn', t: g.t };
      return;
    }
    g.manual = false; g.zoomAuto = true;    // a tap means: follow the game again

    // a target is already proposed: tapping it again is the commit
    if (g.pair) {
      if (u === g.pair.def) { commit(); return; }
      g.pair = null; g.pathPreview = null;
      // and otherwise the tap still means whatever it would have meant
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
          g.pair = { att: b.sel, def: u, spot: spot.s };
          g.cardUnit = u;
          g.pathPreview = spot.s === b.sel.surface ? null : b.arena.pathTo(b.reach, spot.s);
          K.audio.buy();
        } else { g.cardUnit = u; g.threat = threatOf(b, u); }
        return;
      }
      if (u && u.side === 0 && !u.acted) { B.select(b, u); g.cardUnit = u; g.threat = []; return; }
      if (u && u.side === 0 && u.acted) { g.cardUnit = u; g.note = { text: u.name + ' has already moved', t: g.t }; return; }
      if (b.reach.has(s.id) && !B.occupied(b, s, b.sel)) { B.moveTo(b, b.sel, s); g.pathPreview = null; return; }
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
  let gesture = null, downT = 0, downX = 0, downY = 0, pinch0 = 0, zoom0 = 0, mid0 = null;

  function localPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = localPos(e);
    ptrs.set(e.pointerId, p);
    if (ptrs.size === 1) { gesture = null; downT = performance.now(); downX = p.x; downY = p.y; }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      zoom0 = g.zoomT;
      mid0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture = 'two';
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = localPos(e);
    const prev = ptrs.get(e.pointerId);
    if (!prev) { hoverAt(p.x, p.y); return; }   // a mouse simply hovering
    ptrs.set(e.pointerId, p);

    if (ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 12) {
        // pinch zooms, and the two fingers together swing the camera round
        g.zoomT = clamp(zoom0 * (pinch0 / Math.max(12, d)), 0, 1);
        g.zoomAuto = false;
      }
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (mid0) {
        g.cam.wantYaw -= (mid.x - mid0.x) * 0.006;
        g.cam.wantPitch = clamp(g.cam.wantPitch + (mid.y - mid0.y) * 0.005, 0.30, 1.24);
      }
      mid0 = mid;
      return;
    }

    const dx = p.x - prev.x, dy = p.y - prev.y;
    if (!gesture && Math.hypot(p.x - downX, p.y - downY) > 9) gesture = 'pan';
    if (gesture === 'pan') pan(dx, dy);
  });

  /* One finger drags the board itself: the world should stay under the thumb,
     which means converting pixels to metres at the distance being looked at. */
  function pan(dx, dy) {
    const cam = g.cam;
    if (!g.look) g.look = { x: cam.fx, y: cam.fy, z: cam.fz };
    g.manual = true;
    const perPx = cam.dist / Math.max(120, view.f);
    const sy = Math.max(0.35, Math.sin(cam.pitch));
    const rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);      // screen right, on the ground
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);       // screen up, on the ground
    g.look.x -= (rx * dx * perPx) + (fx * dy * perPx / sy);
    g.look.z -= (rz * dx * perPx) + (fz * dy * perPx / sy);
    const lim = K.grid.TILE * 8;
    g.look.x = clamp(g.look.x, -lim, lim);
    g.look.z = clamp(g.look.z, -lim, lim);
  }

  function endPointer(e) {
    const p = localPos(e);
    const had = ptrs.has(e.pointerId);
    ptrs.delete(e.pointerId);
    if (!had) return;
    if (ptrs.size === 0) {
      if (!gesture && performance.now() - downT < 600 && g.running) tap(p.x, p.y);
      gesture = null; mid0 = null;
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => {
    if (!g.cam) return;
    g.zoomT = clamp(g.zoomT + e.deltaY * 0.0011, 0, 1);
    g.zoomAuto = false;
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

  /* The camera has an opinion about how close it wants to be, and it changes
     with what you are doing: survey the board when nothing is selected, come
     in when you pick someone up, get close for the blow. A pinch says you
     would rather decide yourself, and it holds until you tap something. */
  function driveCamera(dt) {
    const b = g.battle, cam = g.cam;
    const CLOSE = Math.min(11.5, g.fitDist);
    let want = null, aim = 0.85;

    if (b.busy && b.busy.kind === 'fight') {
      const a = b.busy.aA, d = b.busy.aD;
      want = { x: (a.pos.x + d.pos.x) / 2, y: (a.body.parts.chest.y + d.body.parts.chest.y) / 2, z: (a.pos.z + d.pos.z) / 2 };
      aim = 0.12;
      g.manual = false;
      // hold on the two of them after the last blow: pulling out the instant
      // the arithmetic finishes is pulling out before the body has landed
      g.hold = { want, aim, t: 1.3 };
    } else if (g.hold && g.hold.t > 0 && !g.manual) {
      g.hold.t -= dt;
      want = g.hold.want; aim = g.hold.aim;
    } else if (b.busy && b.busy.act) {
      const a = b.busy.act;
      want = { x: a.pos.x, y: a.body.parts.chest.y, z: a.pos.z };
      aim = 0.26;
      g.manual = false;
    } else if (!g.manual) {
      const u = b.sel || (b.phase === 'enemy' && b.focus ? null : g.cardUnit);
      const a = u ? B.actorOf(b, u) : (b.phase === 'enemy' ? b.focus : null);
      if (a) { want = { x: a.pos.x, y: a.pos.y + 0.9, z: a.pos.z }; aim = b.sel ? 0.46 : 0.62; }
      else { want = restPoint(); aim = 0.78; }
    } else {
      want = { x: g.look.x, y: g.look.y, z: g.look.z };
      aim = g.zoomT;
    }

    cam.fx = want.x; cam.fy = want.y; cam.fz = want.z;
    if (g.manual) { g.look = { x: want.x, y: want.y, z: want.z }; }
    // coming in is a cut to the action and should be quick; going back out is
    // the game handing control back, and should not yank
    if (g.zoomAuto) g.zoomT = lerp(g.zoomT, aim, clamp(dt * (aim < g.zoomT ? 7 : 2.4), 0, 1));
    const t = g.zoomT;
    // pulled back to see the board, the board is centred; up close, the unit
    // sits low and the ground it is about to cross fills the screen
    view.frameBias = lerp(0.70, 0.5, t);
    cam.wantDist = lerp(CLOSE, g.fitDist, t);
    cam.shake = Math.max(cam.shake, b.shake);
    R.camUpdate(cam, dt);
  }

  /* ------------------------------------------------------------------ loop */

  let last = 0, acc = 0, lastW = 0, lastH = 0;
  const STEP = 1 / 120;

  function loop(now) {
    requestAnimationFrame(loop);
    const t = now / 1000;
    const dt = last ? Math.min(0.1, t - last) : 0.016;
    last = t;
    g.t += dt;

    const r = canvas.getBoundingClientRect();
    if (Math.abs(r.width - lastW) > 0.5 || Math.abs(r.height - lastH) > 0.5) {
      lastW = r.width; lastH = r.height;
      measure();
    }

    if (g.running) {
      acc += dt;
      let n = 0;
      const s0 = performance.now();
      while (acc >= STEP && n < 6) { B.step(g.battle, STEP); acc -= STEP; n++; }
      g.simMs = g.simMs ? g.simMs * 0.92 + (performance.now() - s0) * 0.08 : (performance.now() - s0);
      if (acc > 0.3) acc = 0;
      driveCamera(dt);
      if (g.battle.sel && !g.cardUnit) g.cardUnit = g.battle.sel;
      if (g.pair && (g.pair.def.dead || g.pair.att.dead || g.battle.busy)) { g.pair = null; g.pathPreview = null; }
      if (g.battle.over && !g.summary) {
        const won = g.battle.over === 'win';
        g.summary = K.camp.afterBattle(g.run, g.battle, won);
        // a field won buys a choice; a run finished buys the record
        g.offers = won && !g.summary.final ? K.camp.offers(g.run, U.rng((g.run.wave * 6151 + (g.run.runs || 0) * 97) >>> 0)) : null;
        g.taken = null;
      }
    }

    const t0 = performance.now();
    R.frame(view, g, dt);
    g.drawMs = g.drawMs ? g.drawMs * 0.92 + (performance.now() - t0) * 0.08 : (performance.now() - t0);
    K.ui.sync(g);
  }

  /* ------------------------------------------------------------------ boot */

  K.ui.init({
    start: () => { g.running = true; measure(); },
    again: () => {
      if (g.offers && g.taken !== null) K.camp.take(g.run, g.offers[g.taken]);
      g.offers = null; g.taken = null;
      newBattle(); g.running = true;
    },
    spoil: (i) => { g.taken = i; },
    wipe: () => { g.run = K.camp.fresh(); K.camp.save(g.run); newBattle(); g.running = true; },
    attack: () => commit(),
    wait: () => { const b = g.battle; if (b.sel) B.finishUnit(b, b.sel); g.pair = null; g.cardUnit = null; },
    cancel: () => {
      if (g.pair) { g.pair = null; g.pathPreview = null; return; }
      B.clearSel(g.battle); g.cardUnit = null; g.pathPreview = null;
    },
    end: () => { B.endPhase(g.battle); g.cardUnit = null; g.pair = null; g.manual = false; },
    fit: () => { g.zoomT = g.zoomT > 0.8 ? 0.4 : 1; g.zoomAuto = false; g.manual = false; }
  });

  g.run = K.camp.load();
  newBattle();
  measure();
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', () => setTimeout(measure, 220));
  requestAnimationFrame(loop);
})();
