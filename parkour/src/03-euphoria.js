/* KINESIS — the behaviour stack, in three dimensions.
   Nothing here plays an animation. Every pose is a set of world-space
   targets that muscles chase at a bounded speed, layered lowest priority
   first:

       gait -> balance -> steer -> stagger -> protect -> catch -> get up

   A behaviour only ever asks. Whether the body delivers is decided by the
   solver, by muscle strength (which upgrades buy) and by consciousness
   (which impacts take away). Everything worth watching lives in that gap. */
K.euphoria = (function () {
  const P = K.phys, R = K.rag, U = K.util;
  const { clamp, lerp, TAU } = U;

  const S = {
    RUN: 'RUN', AIR: 'AIRBORNE', VAULT: 'VAULT', GRAB: 'CATCH', ROLL: 'ROLL',
    STAGGER: 'STAGGER', FALL: 'PROTECT', DOWN: 'DOWN', GETUP: 'RISE', OUT: 'WIPEOUT'
  };

  function Controller(body, stats) {
    return {
      body, stats,
      state: S.RUN, stateT: 0, prevState: S.RUN,
      phase: 0, swing: 0, swingFrom: null,
      anchor: { x: 0, y: 0, z: 0 }, anchorSet: false,
      consciousness: 1, integrity: 1, injury: { L: 0, R: 0 },
      balanceErr: 0, tilt: 0, speed: 0, drift: 0, grounded: false, airT: 0,
      laneX: 0, targetSpeed: 4,
      grabPoint: null, grabT: 0, vaultObs: null,
      staggerT: 0, downT: 0, rollT: 0, duckT: 0,
      lastImpact: 0, hits: 0, notes: [], flags: {}, protect: '',
      intent: { duck: false },
      effects: []
    };
  }

  function muscle(c, base) {
    const s = c.stats;
    return base * (0.55 + s.legPower * 0.75) * (0.35 + c.consciousness * 0.65);
  }

  function note(c, text, kind) {
    c.notes.push({ text, kind: kind || 'info', t: 0 });
    if (c.notes.length > 6) c.notes.shift();
  }

  function fx(c, type, x, y, z, a) {
    c.effects.push({ type, x, y, z, a: a === undefined ? 1 : a });
    if (c.effects.length > 40) c.effects.shift();
  }

  function setState(c, s) {
    if (c.state === s) return;
    c.prevState = c.state; c.state = s; c.stateT = 0; c.anchorSet = false;
  }

  /* ---------------------------------------------------------- perception */

  function sense(c, level, dt) {  // eslint-disable-line
    const b = c.body;
    const com = P.com(b), cv = P.comVel(b, dt);
    c.com = com; c.comVel = cv;
    c.speed = cv.z; c.drift = cv.x;
    c.tilt = R.uprightness(b).tilt;
    c.frame = R.frame(b);

    let sx = 0, sz = 0, contacts = 0;
    for (const L of R.legs(b)) {
      if (L.foot.grounded || L.toe.grounded) { sx += L.foot.x; sz += L.foot.z; contacts++; }
    }
    c.grounded = contacts > 0;
    c.groundedAny = b.contacts > 0;

    // Where the next foot has to land. Running is a controlled fall, so the
    // honest question is not "is the mass over the feet" — it never is — but
    // "can the next step reach the neutral point before the fall wins".
    const tau = clamp(0.25 / Math.max(1.2, c.cadence || 2.2) + 0.06, 0.08, 0.26);
    c.tau = tau;
    c.captureX = com.x + cv.x * tau;
    c.captureZ = com.z + cv.z * tau;
    c.supportX = contacts ? sx / contacts : com.x;
    c.supportZ = contacts ? sz / contacts : com.z;
    const gnd = level.groundAt(com.x, com.z, com.y + 0.6);
    c.floor = gnd ? gnd.y : null;
    c.stance = gnd ? b.parts.pelvis.y - gnd.y : 1;
    c.reach = (0.40 + c.stats.balance * 0.48 + c.stats.legPower * 0.18)
      * (0.5 + c.consciousness * 0.5) + Math.abs(cv.z) * 0.045;
    const need = Math.hypot(cv.x, cv.z) * tau;
    c.margin = c.reach - need;
    c.balanceErr = Math.max(0, -c.margin);
  }

  /* -------------------------------------------------------------- damage */

  const HURT = {
    head: { w: 2.4, floor: 3.0 }, chest: { w: 1.15, floor: 4.2 }, pelvis: { w: 1.0, floor: 4.6 },
    hip: { w: 0.8, floor: 4.8 }, sh: { w: 0.8, floor: 4.8 },
    knee: { w: 0.45, floor: 6.5 }, foot: { w: 0.30, floor: 8.5 }, toe: { w: 0.15, floor: 9.5 },
    elbow: { w: 0.40, floor: 5.5 }, hand: { w: 0.28, floor: 6.5 }
  };

  function damage(c, dt) {
    const b = c.body;
    let worst = 0, worstPart = null, worstCore = false;
    for (const p of b.list) {
      if (p.impact <= 0) continue;
      const key = p.name.replace(/[LR]$/, '');
      const hurt = HURT[key] || { w: 0.3, floor: 5 };
      const over = p.impact - hurt.floor;
      if (over > 0) {
        const dmg = Math.pow(over, 1.30) * hurt.w * 0.009 / (0.55 + c.stats.conditioning * 0.75);
        c.integrity = Math.max(0, c.integrity - dmg);
        c.consciousness = Math.max(0.05, c.consciousness - dmg * 2.6);
        if (key === 'knee' || key === 'foot') {
          const side = p.name.slice(-1);
          if (c.injury[side] !== undefined) c.injury[side] = clamp(c.injury[side] + dmg * 1.4, 0, 0.85);
        }
        if (p.impact > worst) { worst = p.impact; worstPart = p; worstCore = hurt.w > 0.7; }
      }
      p.impact = 0;
    }
    if (worst > 5.5) {
      c.lastImpact = worst; c.hits++;
      fx(c, 'impact', worstPart.x, worstPart.y, worstPart.z, clamp(worst / 14, 0.2, 1));
      // only a core hit knocks the runner down; feet and knees take
      // punishment every stride and must not read as a collapse
      const rising = c.state === S.GETUP || c.state === S.DOWN;
      if (worstCore && worst > (rising ? 13 : 8.5) && c.state !== S.ROLL && c.state !== S.AIR) {
        setState(c, S.FALL);
        note(c, worstPart.name.startsWith('head') ? 'head strike' : 'hard contact', 'bad');
      }
    }
    c.consciousness = clamp(c.consciousness + dt * (0.34 + c.stats.conditioning * 0.26), 0, 1);
    c.injury.L = Math.max(0, c.injury.L - dt * 0.02);
    c.injury.R = Math.max(0, c.injury.R - dt * 0.02);
    if (c.integrity <= 0 && c.state !== S.OUT) { setState(c, S.OUT); note(c, 'wiped out', 'bad'); }
  }

  /* ------------------------------------------------------------ postures */

  function trunk(c, lean, sideLean, strength) {
    const b = c.body;
    // aim the spine at a direction: mostly up, pitched forward, rolled into the turn
    let tx = sideLean, ty = 1, tz = lean;
    const l = Math.hypot(tx, ty, tz);
    P.aim(b.parts.pelvis, b.parts.chest, tx / l, ty / l, tz / l, strength);
    P.aim(b.parts.chest, b.parts.head, tx / l * 0.4, 1, lean * 0.2, strength * 0.7);
  }

  function armSwing(c, dt, amp, height) {
    const b = c.body, sp = muscle(c, 4.4);
    const hint = { x: 0, y: 0, z: -1 };            // elbows break backward
    for (const A of R.arms(b)) {
      const ph = c.phase + (A.side < 0 ? 0 : Math.PI);
      const s = Math.sin(ph);
      // arms cross slightly in front as they come through, like a runner's
      R.reachArm(b, A, A.sh.x + A.side * (0.16 - Math.max(0, s) * 0.14),
        A.sh.y - height + Math.abs(s) * 0.07,
        A.sh.z + s * amp, sp, dt, hint);
    }
  }

  /* The one honest way to get a body off the floor: push with everything,
     into the whole sprung mass, limited by what the muscles have left. */
  function heave(c, floor, targetH, dt, gain) {
    const b = c.body, st = c.stats;
    const err = (floor + targetH) - b.parts.pelvis.y;
    if (err <= 0.01) return 0;
    const cap = (24 + st.legPower * 22 + st.rebound * 18) * (0.35 + c.consciousness * 0.65) * (gain || 1);
    const a = clamp(err * 70, 0, cap);
    for (const t of b.trunk) P.addVel(t, 0, a * dt, 0, dt);
    return a;
  }

  function tuckLegs(c, dt, amount) {
    const b = c.body, sp = muscle(c, 3.4);
    const hint = { x: 0, y: 0, z: 1 };
    for (const L of R.legs(b)) {
      R.reachLeg(b, L, L.hip.x, L.hip.y - R.L.leg * (1 - 0.45 * amount),
        L.hip.z + 0.20 * amount, sp, dt, hint);
    }
  }

  /* ---------------------------------------------------------------- gait */

  function gait(c, level, dt, opts) {
    const b = c.body, pel = b.parts.pelvis;
    const sp = muscle(c, 6.0);
    const eff = clamp(1 - (c.injury.L + c.injury.R) * 0.5, 0.35, 1);
    const hint = { x: 0, y: 0, z: 1 };            // knees break forward

    // cadence follows the speed the runner is TRYING to hold; a gait that
    // only steps as fast as it is already going can never accelerate
    const drive = Math.max(Math.abs(c.speed), opts.speed * 0.8);
    const cad = clamp(1.45 + drive * 0.34, 1.4, 4.8) * opts.cadence;
    c.cadence = cad;
    c.phase += TAU * cad * 0.5 * dt;
    if (c.phase >= TAU) c.phase -= TAU;
    const nowSwing = c.phase < Math.PI ? 0 : 1;
    const all = R.legs(b);
    if (nowSwing !== c.swing) {
      c.swing = nowSwing; c.anchorSet = false;
      const nl = all[nowSwing];
      c.swingFrom = { x: nl.foot.x, y: nl.foot.y, z: nl.foot.z };
    }
    if (!c.swingFrom) c.swingFrom = { x: pel.x, y: pel.y - R.L.leg, z: pel.z };
    const sPhase = (c.phase % Math.PI) / Math.PI;
    const swingLeg = all[c.swing], stanceLeg = all[1 - c.swing];

    // ---- support: ANY grounded foot carries the body. Tying support to
    // the nominal stance leg means one mistimed contact drops the runner on
    // its face, which is drama the physics should earn, not a bookkeeping bug.
    // A stance leg must sit well inside its full extension or the hip just
    // rides an arc down as the body vaults over a straight leg. The spring
    // needs compression room, and it needs to out-push gravity on the whole
    // sprung mass, not just its own joint.
    // faster running crouches: a lower hip is what buys forward reach, and
    // forward reach is what a stride is made of
    const bob = (0.855 - clamp(Math.abs(c.speed) * 0.016, 0, 0.13))
      + Math.sin(sPhase * Math.PI) * 0.05;
    const power = (44 + c.stats.legPower * 26) * (0.4 + c.consciousness * 0.6) * eff;
    let carried = false;
    let down = 0;
    for (const L of all) if (L.foot.grounded || L.toe.grounded) down++;
    for (const L of all) {
      if (!(L.foot.grounded || L.toe.grounded)) continue;
      // a foot has to be under the body to carry it; a foot up by the hip is
      // a foot on a wall, and standing on it would be climbing your own leg
      if (L.foot.y > L.hip.y - 0.30) continue;
      carried = true;
      const isStance = L === stanceLeg;
      const len = R.L.leg * (isStance ? bob : 0.90) * opts.crouch;
      R.support(b, L, len, power * (isStance ? 1 : 0.55), dt, 1 / Math.max(1, down));
      if (isStance && sPhase > 0.55) R.legSpring(b, L, R.L.leg * 0.97, 160, power * 0.5, dt);
    }
    c.carried = carried;

    if (!c.anchorSet && (stanceLeg.foot.grounded || stanceLeg.toe.grounded)) {
      c.anchor.x = stanceLeg.foot.x; c.anchor.y = stanceLeg.foot.y; c.anchor.z = stanceLeg.foot.z;
      c.anchorSet = true;
      if (Math.abs(c.speed) > 1.5) {
        fx(c, 'dust', stanceLeg.foot.x, stanceLeg.foot.y, stanceLeg.foot.z, clamp(Math.abs(c.speed) / 9, 0.2, 1));
      }
    }
    if (c.anchorSet && !(stanceLeg.foot.grounded || stanceLeg.toe.grounded)) c.anchorSet = false;
    // Toe-off: once the support leg runs out of leg, holding the plant any
    // longer just drags the body backwards. Ending stance on geometry rather
    // than on a timer is what lets a stronger runner actually run faster.
    if (c.anchorSet) {
      const legOut = Math.hypot(stanceLeg.hip.x - stanceLeg.foot.x,
        stanceLeg.hip.y - stanceLeg.foot.y, stanceLeg.hip.z - stanceLeg.foot.z);
      if (legOut > R.L.leg * 0.93 && stanceLeg.foot.z < pel.z - 0.05) {
        c.anchorSet = false;
        c.phase = (c.swing === 0 ? Math.PI : 0) + 0.02;
        c.swing = 1 - c.swing;
        c.swingFrom = { x: stanceLeg.foot.x, y: stanceLeg.foot.y, z: stanceLeg.foot.z };
      }
    }
    if (c.anchorSet) {
      // hold the plant horizontally only: pulling it vertically would lift
      // the foot off the deck it is standing on
      P.drive(stanceLeg.foot, c.anchor.x, stanceLeg.foot.y, c.anchor.z, sp * 0.45, dt, sp * 8);
      R.poseLeg(b, stanceLeg, c.anchor.x, c.anchor.y, c.anchor.z, sp * 0.8, dt, hint);
    } else {
      // no plant: reach the stance foot down for the deck under the hip
      const sg = level.groundAt(stanceLeg.hip.x, pel.z - 0.06, pel.y + 0.6);
      const fy = sg ? sg.y + R.L.plant : pel.y - R.L.leg;
      R.reachLeg(b, stanceLeg, stanceLeg.hip.x, fy, pel.z - 0.06, sp, dt, hint);
    }

    // ---- swing: put the foot where the body needs it, in both axes.
    // Steering IS foot placement: plant inside the turn and the body goes.
    // How far ahead a foot can actually be planted is geometry, not wish:
    // a leg of length L with the hip at height h reaches sqrt(L^2 - h^2)
    // forward, plus whatever the flight phase adds at speed. Ask for more
    // and the runner over-strides into the splits, which is exactly what a
    // real runner does when they try to out-run their own legs.
    // measured against the hip height the gait is TRYING to hold, not the
    // one it currently has, or a sinking body talks itself into the splits
    const hipH = R.L.leg * 0.855 * opts.crouch;
    const maxAhead = Math.sqrt(Math.max(0.04, R.L.leg * R.L.leg - hipH * hipH)) * 0.92
      + Math.abs(c.speed) * 0.045;
    const bias = (0.02 + Math.abs(c.speed) * 0.014) * opts.stride;
    const landZ = clamp(c.captureZ + bias, pel.z - 0.32, pel.z + maxAhead);
    const steer = clamp((c.laneX - c.com.x) * 0.55 - c.drift * 0.12, -0.34, 0.34)
      * (0.55 + c.stats.balance * 0.5) * opts.steer;
    const landX = clamp(c.captureX - steer + swingLeg.side * 0.11,
      c.com.x - 0.5, c.com.x + 0.5);
    const g = level.groundAt(landX, landZ, pel.y + 0.6);
    const groundY = g ? g.y : pel.y - R.L.leg - 0.8;
    const lift = (0.14 + Math.abs(c.speed) * 0.022) * opts.lift
      * Math.sin(Math.pow(clamp(sPhase, 0, 1), 0.55) * Math.PI);
    const t = clamp(sPhase * 1.3, 0, 1);
    const tx = lerp(c.swingFrom.x, landX, t);
    const tz = lerp(c.swingFrom.z, landZ, t);
    const ty = groundY + R.L.plant + lift;
    R.reachLeg(b, swingLeg, tx, ty, tz, sp * eff, dt, hint);
    // toe target sits exactly one foot-bone from the ankle, or the bone and
    // the muscle fight each other forever
    const fl = R.L.foot, fn = Math.hypot(0.3, 1);
    P.drive(swingLeg.toe, swingLeg.foot.x, swingLeg.foot.y - fl * 0.3 / fn, swingLeg.foot.z + fl / fn,
      sp * 0.8, dt, sp * 16);

    // ---- drive, only while something is planted
    if (c.grounded) {
      const errZ = opts.speed * eff - c.speed;
      const accZ = clamp(errZ * 5.0, -14, 9 + c.stats.legPower * 14) * (0.4 + c.consciousness * 0.6);
      // lateral: a damped approach to the chosen line. Overshooting a lane
      // on a deck with nothing under its edges is how a runner dies stupidly.
      const wantX = clamp((c.laneX - c.com.x) * 1.5, -2.0, 2.0);
      let accX = clamp((wantX - c.drift) * 3.6, -5.5, 5.5) * (0.4 + c.consciousness * 0.6) * opts.steer;
      // hip/ankle strategy: a standing human is always quietly pushing its
      // mass back over its feet sideways. Without it the runner walks off
      // the edge of the world with a completely level trunk.
      const lat = clamp((c.supportX - c.com.x) * 7 - c.drift * 2.0, -2.6, 2.6)
        * (0.4 + c.consciousness * 0.6) * (0.6 + c.stats.balance * 0.5);
      accX += lat;
      for (const p of b.trunk) P.addVel(p, accX * dt * 0.8, 0, accZ * dt * 0.8, dt);
    }
    return { swingLeg, stanceLeg, sPhase };
  }

  /* --------------------------------------------------------- behaviours */

  function behaveRun(c, level, dt) {
    const st = c.stats;
    // lean into the acceleration, like anyone does
    const accel = clamp((c.targetSpeed - c.speed) * 0.05, -0.06, 0.16);
    const lean = clamp(0.13 + Math.abs(c.speed) * 0.026 + accel, 0, 0.60);
    const side = clamp((c.laneX - c.com.x) * 0.22, -0.28, 0.28);
    gait(c, level, dt, {
      speed: c.targetSpeed, cadence: 1, stride: 1, lift: 1,
      steer: 1 + (c.edgeFear || 0) * 1.4,
      crouch: c.intent.duck ? 0.66 : 1
    });
    trunk(c, lean, side, clamp(0.34 * (0.6 + st.balance) * c.consciousness, 0, 0.85));
    armSwing(c, dt, 0.42, 0.32);

    // A body dragging itself along the deck is not running, whatever the
    // state machine believes. But a single low frame is a landing, not a
    // collapse, so the reading has to persist before it counts.
    c.grace = Math.max(0, (c.grace || 0) - dt);
    if (c.stance < 0.52 && c.groundedAny && !c.grace) c.lowT = (c.lowT || 0) + dt;
    else c.lowT = 0;
    if (c.lowT > 0.16) {
      c.lowT = 0;
      setState(c, S.GETUP);
      note(c, 'down low', 'warn');
    } else if (c.balanceErr > 0.07 || c.tilt > 0.62) {
      setState(c, S.STAGGER);
      note(c, c.tilt > 0.62 ? 'trunk pitched' : 'off balance', 'warn');
    } else if (!c.groundedAny) {
      // running has a flight phase; that is not the same as being airborne
      c.airT += dt;
      const high = c.floor !== null && (c.body.parts.pelvis.y - c.floor) > 1.15;
      if (c.airT > 0.40 || high) setState(c, S.AIR);
    } else c.airT = 0;
  }

  function behaveStagger(c, level, dt) {
    const st = c.stats;
    c.staggerT += dt;
    gait(c, level, dt, {
      speed: c.targetSpeed * 0.6, cadence: 1.9, stride: 1.9, lift: 0.75, steer: 0.5, crouch: 0.86
    });
    const pitch = clamp((c.captureZ - c.supportZ) * -0.9, -0.7, 0.7);
    const roll = clamp((c.captureX - c.supportX) * -0.8, -0.6, 0.6);
    trunk(c, pitch, roll, clamp(0.46 * (0.6 + st.balance) * c.consciousness, 0, 0.95));

    const b = c.body, sp = muscle(c, 5.5), w = Math.sin(c.stateT * 22);
    const hint = { x: 0, y: 0, z: -1 };
    const A = R.arms(b);
    R.reachArm(b, A[0], A[0].sh.x - 0.36, A[0].sh.y + 0.22 + w * 0.10, A[0].sh.z - 0.05, sp, dt, hint);
    R.reachArm(b, A[1], A[1].sh.x + 0.36, A[1].sh.y + 0.20 - w * 0.10, A[1].sh.z + 0.05, sp, dt, hint);

    const budget = 0.40 + st.balance * 1.70;
    if (c.balanceErr < 0.012 && c.tilt < 0.34) {
      c.staggerT = 0; setState(c, S.RUN);
      note(c, 'recovered', 'good');
      c.flags.recovered = (c.flags.recovered || 0) + 1;
    } else if (c.stance < 0.45 && c.groundedAny) {
      c.staggerT = 0; setState(c, S.GETUP);
    } else if (c.staggerT > budget || c.tilt > 1.05) {
      c.staggerT = 0; setState(c, S.FALL); note(c, 'lost it', 'bad');
    }
  }

  function predictImpact(c, level) {
    const ch = c.body.parts.chest;
    let x = ch.x, y = ch.y, z = ch.z;
    let vx = c.comVel.x, vy = c.comVel.y, vz = c.comVel.z, t = 0;
    for (let i = 0; i < 46; i++) {
      const h = 0.033;
      x += vx * h; z += vz * h; vy -= 11.2 * h; y += vy * h; t += h;
      const g = level.groundAt(x, z, y);
      if (g && y - 0.35 <= g.y) return { x, y: g.y, z, t };
    }
    return { x, y: y - 1.2, z, t };
  }

  function behaveAir(c, level, dt) {
    const b = c.body, st = c.stats;
    c.airT += dt;
    const sp = muscle(c, 5.0);
    const hit = c.predicted = predictImpact(c, level);
    const hintK = { x: 0, y: 0, z: 1 }, hintA = { x: 0, y: 0, z: -1 };

    // a lip in reach? go for it. the most-loved euphoria behaviour there is
    if (c.comVel.y < 1.5 && !c.grabPoint) {
      const range = 0.45 + st.grip * 0.6;
      const led = level.ledgeNear(b.parts.chest.x, b.parts.chest.y, b.parts.chest.z, range + 0.9);
      if (led && led.y < b.parts.chest.y + 0.6 && led.y > b.parts.chest.y - 1.5) {
        const d = Math.hypot(led.x - b.parts.handR.x, led.y - b.parts.handR.y, led.z - b.parts.handR.z);
        if (d < range) { c.grabPoint = led; setState(c, S.GRAB); return; }
        R.reachArm(b, R.arms(b)[1], led.x + 0.16, led.y, led.z, sp * 1.5, dt, hintA);
        R.reachArm(b, R.arms(b)[0], led.x - 0.16, led.y, led.z, sp * 1.4, dt, hintA);
        trunk(c, 0.22, 0, 0.32);
        return;
      }
    }

    // steer in the air, a little
    const wantX = clamp((c.laneX - c.com.x) * 1.4, -2.2, 2.2);
    P.addVel(b.parts.pelvis, clamp(wantX - c.drift, -1, 1) * 1.6 * dt, 0, 0, dt);

    if (hit.t < 0.26) {
      const tx = hit.x + clamp(c.comVel.x * 0.10, -0.3, 0.3);
      const tz = hit.z + clamp(c.comVel.z * 0.10, -0.2, 0.5);
      for (const L of R.legs(b)) R.reachLeg(b, L, tx + L.side * 0.12, hit.y + R.L.plant, tz, sp * 1.3, dt, hintK);
      armSwing(c, dt, 0.24, 0.22);
      trunk(c, 0.24, 0, 0.36 * (0.4 + st.balance));
      if (c.groundedAny) {
        const impactV = -c.comVel.y;
        const rollThresh = 5.6 + st.rebound * 3.4;
        if (impactV > rollThresh && Math.abs(c.speed) > 3.4) { setState(c, S.ROLL); note(c, 'roll out', 'good'); }
        else if (impactV > 11.5 + st.conditioning * 5) { setState(c, S.FALL); note(c, 'landed heavy', 'bad'); }
        else {
          setState(c, S.RUN); c.airT = 0;
          fx(c, 'dust', hit.x, hit.y, hit.z, clamp(impactV / 9, 0.2, 1));
        }
      }
    } else {
      tuckLegs(c, dt, 0.55 + Math.sin(c.airT * 6) * 0.2);
      const A = R.arms(b);
      R.reachArm(b, A[0], A[0].sh.x - 0.24, A[0].sh.y - 0.14, A[0].sh.z + 0.20, sp, dt, hintA);
      R.reachArm(b, A[1], A[1].sh.x + 0.24, A[1].sh.y - 0.06, A[1].sh.z + 0.26, sp, dt, hintA);
      trunk(c, 0.26, 0, 0.28 * (0.4 + st.balance));
    }
    if (c.groundedAny && c.airT > 0.4 && hit.t >= 0.26) { setState(c, S.RUN); c.airT = 0; }
    // wedged, snagged, or resting on something the feet never found: a body
    // that has stopped moving is not airborne, whatever the state says
    const still = Math.hypot(c.comVel.x, c.comVel.y, c.comVel.z) < 1.6;
    if (c.airT > 1.0 && still) { setState(c, S.GETUP); note(c, 'shook it off', 'warn'); }
  }

  function behaveGrab(c, level, dt) {
    const b = c.body, st = c.stats, gp = c.grabPoint;
    if (!gp) { setState(c, S.AIR); return; }
    const R2 = b.parts.handR, L2 = b.parts.handL;
    if (!R2.pinned) {
      R2.pinned = { x: gp.x + 0.16, y: gp.y, z: gp.z };
      fx(c, 'grab', gp.x, gp.y, gp.z, 1);
      note(c, 'caught the edge', 'good');
      c.flags.grabs = (c.flags.grabs || 0) + 1;
    }
    const sp = muscle(c, 4.6);
    const hintA = { x: 0, y: 0, z: -1 };
    R.reachArm(b, R.arms(b)[0], gp.x - 0.16, gp.y, gp.z, sp, dt, hintA);
    c.grabT += dt;

    const load = Math.hypot(c.comVel.x, c.comVel.y, c.comVel.z) * 0.1;
    const hold = 0.38 + st.grip * 1.2;
    if (load > hold && c.grabT > 0.12) {
      R2.pinned = null; L2.pinned = null; c.grabPoint = null; c.grabT = 0;
      setState(c, S.FALL); note(c, 'grip slipped', 'bad');
      return;
    }
    const pullTime = 0.85 - st.grip * 0.42;
    if (c.grabT > pullTime * 0.35) {
      P.drive(b.parts.pelvis, gp.x, gp.y + 0.35, gp.z - 0.15, sp * 0.8, dt, sp * 18);
      for (const L of R.legs(b)) R.reachLeg(b, L, gp.x + L.side * 0.14, gp.y + R.L.plant, gp.z + 0.32, sp, dt, { x: 0, y: 0, z: 1 });
      trunk(c, 0.34, 0, 0.42);
    } else {
      tuckLegs(c, dt, 0.5);
      trunk(c, 0.1, 0, 0.3);
    }
    if (c.grabT > pullTime) {
      R2.pinned = null; L2.pinned = null;
      P.addVel(b.parts.pelvis, 0, 1.4, 1.8 + st.grip * 1.6, 1 / 60);
      c.grabPoint = null; c.grabT = 0;
      setState(c, S.RUN);
      c.targetSpeed *= 0.6;
    }
  }

  function behaveVault(c, level, dt) {
    const b = c.body, o = c.vaultObs;
    if (!o) { setState(c, S.RUN); return; }
    const sp = muscle(c, 6.4);
    const px = clamp(c.com.x, o.x0 + 0.2, o.x1 - 0.2);
    const py = o.y1, pz = o.z1 - 0.06;
    const hintA = { x: 0, y: 0, z: -1 }, hintK = { x: 0, y: 0, z: 1 };
    const A = R.arms(b);
    R.reachArm(b, A[1], px + 0.18, py + 0.02, pz, sp * 1.5, dt, hintA);
    R.reachArm(b, A[0], px - 0.18, py + 0.06, pz, sp * 1.3, dt, hintA);
    const th = clamp(c.stateT / 0.42, 0, 1);
    P.drive(b.parts.pelvis, px, py + 0.55 + Math.sin(th * Math.PI) * 0.14, pz + th * 0.7, sp * 0.8, dt, sp * 20);
    for (const L of R.legs(b)) {
      R.reachLeg(b, L, px + L.side * 0.16, py + 0.32 - th * 0.30, pz + 0.20 + th * 0.9, sp * 1.1, dt, hintK);
    }
    trunk(c, 0.55, 0, 0.45);
    if (c.stateT === 0) fx(c, 'plant', px, py, pz, 1);
    if (c.stateT > 0.42 || b.parts.pelvis.z > o.z1 + 0.35) {
      c.vaultObs = null;
      c.flags.vaults = (c.flags.vaults || 0) + 1;
      setState(c, b.parts.pelvis.y > o.y1 + 0.45 ? S.AIR : S.RUN);
    }
  }

  function behaveRoll(c, level, dt) {
    const b = c.body;
    c.rollT += dt;
    const sp = muscle(c, 6.0);
    const pel = b.parts.pelvis, ch = b.parts.chest;
    for (const L of R.legs(b)) R.reachLeg(b, L, L.hip.x, pel.y - 0.28, pel.z + 0.22, sp, dt, { x: 0, y: 0, z: 1 });
    for (const A of R.arms(b)) R.reachArm(b, A, A.sh.x + A.side * 0.10, pel.y - 0.10, pel.z + 0.26, sp, dt, { x: 0, y: 0, z: -1 });
    const spin = 9 * (1 - c.rollT / 0.55);
    P.addVel(ch, 0, -spin * dt * 0.25, spin * dt * 0.55, dt);
    for (const L of R.legs(b)) P.addVel(L.foot, 0, spin * dt * 0.35, -spin * dt * 0.30, dt);
    if (c.rollT > 0.5) { c.rollT = 0; setState(c, S.GETUP); c.flags.rolls = (c.flags.rolls || 0) + 1; }
  }

  function behaveFall(c, level, dt) {
    const b = c.body;
    const sp = muscle(c, 2.2) * 0.7;
    const hit = c.predicted = predictImpact(c, level);
    const ch = b.parts.chest, hd = b.parts.head;
    const A = R.arms(b), hintA = { x: 0, y: 0, z: -1 };

    if (hd.y < ch.y + 0.05 && c.comVel.y < -1.5) {
      R.reachArm(b, A[0], hd.x - 0.12, hd.y + 0.12, hd.z + 0.06, sp * 2.4, dt, hintA);
      R.reachArm(b, A[1], hit.x + 0.20, hit.y + 0.16, hit.z, sp * 2.2, dt, hintA);
      P.torque(b.parts.pelvis, ch, hd, 0.55, 0.3);
      c.protect = 'head';
    } else {
      const bx = hit.x + clamp(c.comVel.x * 0.08, -0.25, 0.25);
      const bz = hit.z + clamp(c.comVel.z * 0.06, -0.2, 0.35);
      R.reachArm(b, A[0], bx - 0.20, hit.y + 0.28, bz, sp * 2.2, dt, hintA);
      R.reachArm(b, A[1], bx + 0.20, hit.y + 0.28, bz, sp * 2.2, dt, hintA);
      c.protect = 'brace';
    }
    if (c.comVel.y < -2 && hit.t < 0.3) {
      for (const L of R.legs(b)) R.reachLeg(b, L, hit.x + L.side * 0.14, hit.y + R.L.plant, hit.z - 0.20, sp * 1.6, dt, { x: 0, y: 0, z: 1 });
    } else tuckLegs(c, dt, 0.4);
    trunk(c, 0.2, 0, 0.10 * c.consciousness);

    const v = Math.hypot(c.comVel.x, c.comVel.y, c.comVel.z);
    if (c.stateT > 1.6 && v < 1.6) { setState(c, S.DOWN); return; }
    if (c.groundedAny && v < 2.4) {
      c.downT += dt;
      if (c.downT > 0.15) { c.downT = 0; setState(c, S.DOWN); }
    } else c.downT = 0;
    // never lie in the protective pose forever: a body that has stopped
    // being thrown around is a body that should be getting up
    if (c.stateT > 1.3 && c.groundedAny) { c.downT = 0; setState(c, S.DOWN); }
  }

  function behaveDown(c, level, dt) {
    tuckLegs(c, dt, 0.25);
    const pause = clamp(0.55 - c.stats.rebound * 0.30, 0.12, 0.6) * (1.6 - c.consciousness);
    if (c.stateT > pause) setState(c, S.GETUP);
  }

  function behaveGetup(c, level, dt) {
    const b = c.body, st = c.stats;
    const rate = 0.75 + st.rebound * 0.85;
    const sp = muscle(c, 4.2) * (0.7 + st.rebound * 0.7);
    const pel = b.parts.pelvis, ch = b.parts.chest;
    const g = level.groundAt(pel.x, pel.z, pel.y + 0.8);
    const floor = g ? g.y : pel.y - 1;
    const t = c.stateT * rate;
    const hintA = { x: 0, y: 0, z: -1 }, hintK = { x: 0, y: 0, z: 1 };

    // feet gather under the hips from the first moment
    for (const L of R.legs(b)) {
      R.reachLeg(b, L, L.hip.x + L.side * 0.04, floor + R.L.plant,
        pel.z - 0.10 + clamp(t, 0, 0.5) * 0.2, sp * 1.4, dt, hintK);
    }
    if (t < 0.45) {
      // hands press the deck, chest comes off it
      for (const A of R.arms(b)) {
        R.reachArm(b, A, A.sh.x + A.side * 0.22, floor + 0.05, ch.z + 0.28, sp * 1.5, dt, hintA);
      }
      heave(c, floor, 0.42, dt, 0.8);
      P.drive(ch, ch.x, floor + 0.58, ch.z, sp, dt, sp * 14);
      trunk(c, 0.5, 0, 0.35);
    } else {
      // stand up out of the crouch
      const want = lerp(0.45, 0.92, clamp((t - 0.45) / 0.55, 0, 1));
      heave(c, floor, want, dt, 1.15);
      for (const L of R.legs(b)) {
        if (L.foot.grounded || L.toe.grounded) R.legSpring(b, L, R.L.leg * 0.9, 460, 30 + st.legPower * 26, dt);
      }
      trunk(c, 0.2, 0, 0.55 * (0.5 + st.balance));
      armSwing(c, dt, 0.18, 0.30);
      c.phase += TAU * 0.7 * dt;
    }
    // stand all the way up before running again: rising into a crouch and
    // calling it running is how the runner ends up in a fall/rise loop
    const up = c.tilt < 0.5 && (pel.y - floor) > 0.78;
    if (up && c.stateT > 0.25) {
      setState(c, S.RUN);
      c.targetSpeed = 1.6;
      c.anchorSet = false;
      c.grace = 0.6;
      note(c, 'up again', 'good');
    }
    if (t > 5) { setState(c, S.RUN); c.targetSpeed = 1.2; }
  }

  /* ------------------------------------------------------------ requests */

  /* Running has a flight phase, so the moment a take-off is decided is
     usually a moment with no foot on the deck. Buffer the intent and fire it
     on the next plant — the same thing a person does when they see the edge
     coming mid-stride. */
  function requestJump(c, power) {
    if (c.state !== S.RUN && c.state !== S.STAGGER) return false;
    // anything in contact can be pushed off. Requiring a foot specifically
    // strands the runner on the lip of a gap with its toes over the drop,
    // asking to jump forever and never being allowed to.
    if (!c.grounded && !c.groundedAny) {
      c.jumpBuffer = { power, t: 0 };
      return false;
    }
    c.jumpBuffer = null;
    const b = c.body, st = c.stats;
    // A person jumps half a metre standing, a metre with a run-up. Anything
    // much past that turns every gap into a two-second flight and a crash.
    const v = (2.7 + st.legPower * 1.5) * clamp(power, 0.4, 1.25) * (0.5 + c.consciousness * 0.5);
    const eff = clamp(1 - (c.injury.L + c.injury.R) * 0.6, 0.3, 1);
    const dt = 1 / 60;
    // the whole body leaves the deck, not just the bits with names: a jump
    // is an impulse through the centre of mass
    for (const p of b.list) P.addVel(p, 0, v * eff, v * 0.22 * eff, dt);
    for (const L of R.legs(b)) P.addVel(L.foot, 0, -v * 0.25, 0, dt);
    c.flags.jumps = (c.flags.jumps || 0) + 1;
    fx(c, 'dust', b.parts.footL.x, b.parts.footL.y, b.parts.footL.z, 0.8);
    setState(c, S.AIR); c.airT = 0.19;
    return true;
  }

  function requestVault(c, obs) {
    if (c.state !== S.RUN) return false;
    c.vaultObs = obs; setState(c, S.VAULT);
    return true;
  }

  function step(c, level, dt) {
    c.stateT += dt;
    sense(c, level, dt);
    if (c.jumpBuffer) {
      c.jumpBuffer.t += dt;
      if (c.jumpBuffer.t > 0.42) c.jumpBuffer = null;
      else if (c.grounded && (c.state === S.RUN || c.state === S.STAGGER)) {
        const p = c.jumpBuffer.power; c.jumpBuffer = null;
        requestJump(c, p);
      }
    }
    switch (c.state) {
      case S.RUN: behaveRun(c, level, dt); break;
      case S.STAGGER: behaveStagger(c, level, dt); break;
      case S.AIR: behaveAir(c, level, dt); break;
      case S.GRAB: behaveGrab(c, level, dt); break;
      case S.VAULT: behaveVault(c, level, dt); break;
      case S.ROLL: behaveRoll(c, level, dt); break;
      case S.FALL: behaveFall(c, level, dt); break;
      case S.DOWN: behaveDown(c, level, dt); break;
      case S.GETUP: behaveGetup(c, level, dt); break;
      case S.OUT: tuckLegs(c, dt, 0.15); break;
    }
    damage(c, dt);
  }

  return { S, Controller, step, requestJump, requestVault, note, muscle };
})();
