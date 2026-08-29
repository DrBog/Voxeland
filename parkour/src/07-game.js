/* KINESIS — the run.
   Owns the clock, the camera, the particles and the life of one attempt.
   Physics runs on a fixed 1/180 s step, so a phone that drops frames gets
   the same body as one that does not. */
K.game = (function () {
  const U = K.util, P = K.phys, E = K.euphoria, R = K.rag;
  const { clamp, lerp } = U;

  const H = 1 / 180;
  const CAMS = ['CHASE', 'AHEAD', 'SIDE'];

  function create(state) {
    const g = {
      state, level: null, ctrl: null, body: null,
      startZ: 0, distance: 0, runTime: 0, dead: false, deadT: 0, deadWhy: '',
      cam: { x: 0, y: 2.4, z: -5, tx: 0, ty: 1, tz: 4, shake: 0, mode: state.cam || 0, fov: 1 },
      timeScale: 1, slowT: 0, acc: 0,
      particles: [], ghosts: [], gateFlash: 0, banner: null,
      earnRate: 0, rateEMA: 0, sinceProgress: 0, runId: 0, popups: [],
      district: K.world.DISTRICTS[0], districtIndex: 0
    };
    newRun(g);
    return g;
  }

  function newRun(g) {
    const s = g.state;
    g.runId++;
    g.level = K.world.Level((Math.random() * 1e9) | 0, K.prog.statLevelFn(s));
    const top = g.level.boxes[0].y1;
    g.body = R.build(0, top + 0.02, 4.0);
    g.ctrl = E.Controller(g.body, K.prog.physStats(s));
    g.ctrl.targetSpeed = g.ctrl.stats.speed * 0.5;
    g.startZ = 4.0;
    g.distance = 0; g.runTime = 0; g.dead = false; g.deadT = 0; g.deadWhy = '';
    g.sinceProgress = 0;
    g.cam.x = 0; g.cam.y = top + 2.4; g.cam.z = 4 - 5;
    g.particles.length = 0; g.ghosts.length = 0;
    g.banner = null; g.groundRef = top;
    g.timeScale = 1; g.slowT = 0;
  }

  function pop(g, text, x, y, z, kind) {
    g.popups.push({ text, x, y, z, t: 0, kind: kind || 'gain' });
    if (g.popups.length > 12) g.popups.shift();
  }

  function spawn(g, kind, x, y, z, n, a) {
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI;
      const sp = (0.4 + Math.random() * 2.0) * (a || 1);
      g.particles.push({
        kind, x, y, z,
        vx: Math.cos(th) * Math.sin(ph) * sp,
        vy: Math.abs(Math.cos(ph)) * sp * (kind === 'spark' ? 1.1 : 0.7),
        vz: Math.sin(th) * Math.sin(ph) * sp * 0.8,
        life: 0, max: kind === 'spark' ? 0.35 : 0.6 + Math.random() * 0.5,
        r: (kind === 'spark' ? 0.025 : 0.05 + Math.random() * 0.07) * (a || 1)
      });
    }
    if (g.particles.length > 240) g.particles.splice(0, g.particles.length - 240);
  }

  function endRun(g, why) {
    if (g.dead) return;
    const s = g.state, c = g.ctrl;
    g.dead = true; g.deadT = 0; g.deadWhy = why;
    s.runs++;
    s.totalDistance += g.distance;
    s.bestRun = Math.max(s.bestRun, g.distance);
    const record = g.distance > s.best;
    s.best = Math.max(s.best, g.distance);
    const f = c.flags, bits = [];
    if (f.grabs) bits.push(f.grabs + ' catch' + (f.grabs > 1 ? 'es' : ''));
    if (f.vaults) bits.push(f.vaults + ' vault' + (f.vaults > 1 ? 's' : ''));
    if (f.rolls) bits.push(f.rolls + ' roll' + (f.rolls > 1 ? 's' : ''));
    if (f.recovered) bits.push(f.recovered + ' save' + (f.recovered > 1 ? 's' : ''));
    s.log.unshift({
      kind: record ? 'record' : 'run', run: s.runs, d: g.distance,
      text: why, detail: bits.join(' · ') || 'clean until it was not'
    });
    s.log = s.log.slice(0, 14);
    g.banner = { title: record ? 'NEW BEST' : 'RUN ENDED', sub: why, t: 0, record };
    K.audio.down();
    K.prog.save(s);
  }

  function step(g, dt) {
    const s = g.state, c = g.ctrl, lv = g.level, b = g.body;
    const pel = b.parts.pelvis;
    lv.ensure(pel.z);

    const di = K.world.districtIndex(g.distance);
    g.district = K.world.DISTRICTS[di]; g.districtIndex = di;

    // crosswind is a real lateral force on every point, not a filter
    let wind = 0;
    if (g.district.wind) {
      const w = Math.sin(g.runTime * 0.7) * 0.6 + Math.sin(g.runTime * 2.3) * 0.3 + 0.35;
      wind = w * g.district.wind * 1.5;
      for (const p of b.list) p.ax += wind;
    }

    K.ai.think(c, lv, dt);
    const v0 = P.comVel(b, dt);
    const airborne = b.contacts === 0;
    P.integrate(b, dt, 1);
    E.step(c, lv, dt);
    const frame = R.frame(b);
    for (let i = 0; i < 5; i++) { P.solveBones(b); P.solveHinges(b, frame); }
    P.collide(b, lv, dt);
    // in free flight the centre of mass is gravity's business, not the
    // muscles' — see phys.ballistic
    if (airborne && b.contacts === 0) P.ballistic(b, dt, v0, wind, 0);

    const d = pel.z - g.startZ;
    if (d > g.distance) {
      const dx = d - g.distance;
      g.distance = d;
      const gain = dx * K.prog.rate(s, g.distance);
      s.momentum += gain; s.earned += gain; s.lifetime += gain;
      g.earnRate = gain / dt;
      g.sinceProgress = 0;
    } else g.sinceProgress += dt;
    g.runTime += dt;

    for (const m of lv.gatesHit) {
      if (m.done) continue;
      if (pel.z > m.exitZ && c.state !== E.S.OUT) {
        m.done = true;
        const bonus = K.prog.gateBonus(s, m.gate);
        s.momentum += bonus.amount; s.earned += bonus.amount; s.lifetime += bonus.amount;
        const wasNew = !s.gates[m.gate.name];
        s.gates[m.gate.name] = true;
        g.gateFlash = 1;
        K.audio.gate();
        pop(g, '+' + U.num(bonus.amount) + ' M', pel.x, pel.y + 1.5, pel.z, 'gate');
        g.banner = { title: wasNew ? 'GATE OPEN — ' + m.gate.name : m.gate.name + ' CLEARED', sub: m.gate.blurb, t: 0, gate: true };
        if (wasNew) {
          s.log.unshift({ kind: 'gate', text: 'opened ' + m.gate.name, d: g.distance });
          s.log = s.log.slice(0, 14);
          K.prog.save(s);
        }
      }
    }

    for (const e of c.effects) {
      if (e.type === 'dust') { spawn(g, 'dust', e.x, e.y, e.z, 3 + (e.a * 5) | 0, e.a); K.audio.step(e.a); }
      else if (e.type === 'impact') {
        spawn(g, 'spark', e.x, e.y, e.z, 4 + (e.a * 9) | 0, e.a);
        K.audio.impact(e.a);
        g.cam.shake = Math.min(1.2, g.cam.shake + e.a * 0.85);
        if (e.a > 0.55) g.slowT = 0.45 * e.a;
      } else if (e.type === 'grab') {
        spawn(g, 'spark', e.x, e.y, e.z, 6, 0.5);
        K.audio.grab();
        pop(g, 'CAUGHT', e.x, e.y + 0.5, e.z, 'good');
      } else if (e.type === 'plant') spawn(g, 'dust', e.x, e.y, e.z, 4, 0.5);
    }
    c.effects.length = 0;

    const gr = lv.groundAt(pel.x, pel.z, pel.y + 0.6);
    if (gr) g.groundRef = gr.y;
    if (!g.dead) {
      if (c.state === E.S.OUT) endRun(g, 'lost consciousness');
      else if (pel.y < g.groundRef - 11) {
        const d2 = lv.deckAt(0, pel.z, g.groundRef + 1);
        const wide = d2 && (pel.x < d2.x0 - 0.2 || pel.x > d2.x1 + 0.2);
        endRun(g, wide ? 'over the side' : 'short of the far edge');
      } else if (g.sinceProgress > 7) endRun(g, 'stopped moving');
    }
  }

  function camera(g, dt) {
    const c = g.ctrl, b = g.body;
    const pel = b.parts.pelvis, ch = b.parts.chest;
    const mode = CAMS[g.cam.mode % CAMS.length];
    const sp = clamp(Math.abs(c.speed) / 10, 0, 1);
    let px, py, pz, tx, ty, tz;
    const fx = pel.x * 0.6, fy = clamp(pel.y, g.groundRef - 3, g.groundRef + 6), fz = pel.z;
    if (mode === 'CHASE') {
      // a touch off the centre line: dead astern hides the whole stride
      px = fx + 1.0; py = fy + 2.05 + sp * 0.35; pz = fz - (7.2 + sp * 2.2);
      tx = pel.x * 0.75 - 0.35; ty = fy + 0.75; tz = fz + 9;
    } else if (mode === 'AHEAD') {
      px = fx; py = fy + 1.55; pz = fz + (7.6 + sp * 1.8);
      tx = pel.x * 0.8; ty = fy + 0.85; tz = fz - 2;
    } else {
      px = fx + 7.4; py = fy + 1.9; pz = fz + 2.2;
      tx = pel.x; ty = fy + 0.6; tz = fz + 2;
    }
    // never let the camera sink below whatever it is standing behind, or the
    // deck the runner just left swallows the whole frame
    const gc = g.level.groundAt(px, pz, py + 8);
    if (gc) py = Math.max(py, gc.y + 1.9);
    const gm = g.level.groundAt(px, (pz + fz) / 2, py + 8);
    if (gm) py = Math.max(py, gm.y + 1.5);

    const k = g.dead ? 2.2 : 5.5;
    g.cam.x = U.approach(g.cam.x, px, k, dt);
    g.cam.y = U.approach(g.cam.y, py, k * 0.7, dt);
    g.cam.z = U.approach(g.cam.z, pz, k, dt);
    g.cam.tx = U.approach(g.cam.tx, tx, k, dt);
    g.cam.ty = U.approach(g.cam.ty, ty, k * 0.7, dt);
    g.cam.tz = U.approach(g.cam.tz, tz, k, dt);
    g.cam.fov = U.approach(g.cam.fov, 1 + sp * 0.12, 3, dt);
    g.cam.shake = Math.max(0, g.cam.shake - dt * 2.6);
  }

  function cycleCam(g) {
    g.cam.mode = (g.cam.mode + 1) % CAMS.length;
    g.state.cam = g.cam.mode;
    return CAMS[g.cam.mode];
  }
  function camName(g) { return CAMS[g.cam.mode % CAMS.length]; }

  function update(g, rawDt) {
    const c = g.ctrl;
    if (g.slowT > 0) { g.slowT -= rawDt; g.timeScale = lerp(g.timeScale, 0.32, 0.25); }
    else g.timeScale = lerp(g.timeScale, 1, 0.08);

    const dt = Math.min(rawDt, 0.05) * (g.dead ? 0.55 : g.timeScale);
    g.acc += dt;
    let steps = 0;
    while (g.acc >= H && steps < 9) { step(g, H); g.acc -= H; steps++; }
    if (g.acc > H * 9) g.acc = 0;

    for (let i = g.particles.length - 1; i >= 0; i--) {
      const p = g.particles[i];
      p.life += rawDt;
      if (p.life > p.max) { g.particles.splice(i, 1); continue; }
      p.x += p.vx * rawDt; p.y += p.vy * rawDt; p.z += p.vz * rawDt;
      p.vy -= (p.kind === 'spark' ? 9 : 1.1) * rawDt;
      p.vx *= 1 - 1.6 * rawDt; p.vz *= 1 - 1.6 * rawDt;
    }
    for (let i = g.popups.length - 1; i >= 0; i--) {
      const p = g.popups[i]; p.t += rawDt; p.y += rawDt * 0.7;
      if (p.t > 1.6) g.popups.splice(i, 1);
    }

    g.ghostT = (g.ghostT || 0) + rawDt;
    if (Math.abs(c.speed) > 6.5 && g.ghostT > 0.06) {
      g.ghostT = 0;
      g.ghosts.push({ pts: g.body.list.map(p => ({ x: p.x, y: p.y, z: p.z, r: p.r })), t: 0 });
      if (g.ghosts.length > 6) g.ghosts.shift();
    }
    for (let i = g.ghosts.length - 1; i >= 0; i--) {
      g.ghosts[i].t += rawDt;
      if (g.ghosts[i].t > 0.28) g.ghosts.splice(i, 1);
    }

    camera(g, rawDt);

    if (g.banner) { g.banner.t += rawDt; if (g.banner.t > 3.2) g.banner = null; }
    if (g.gateFlash > 0) g.gateFlash = Math.max(0, g.gateFlash - rawDt * 1.4);

    g.rateEMA = g.rateEMA * 0.985 + g.earnRate * 0.015;
    g.earnRate *= 0.9;
    g.state.rateSample = Math.max(g.state.rateSample * 0.999, g.rateEMA);

    if (g.dead) { g.deadT += rawDt; if (g.deadT > 2.4) newRun(g); }
    for (const n of c.notes) n.t += rawDt;
    while (c.notes.length && c.notes[0].t > 3) c.notes.shift();
  }

  function restat(g) { Object.assign(g.ctrl.stats, K.prog.physStats(g.state)); }

  return { create, update, newRun, restat, endRun, cycleCam, camName, CAMS };
})();
