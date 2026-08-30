/* KINESIS — the runner's body, in three dimensions.
   Seventeen point masses: a shoulder and hip yoke keep the limbs apart
   laterally so the thing reads as a person from behind rather than as a
   stick collapsing to the centre line. ~1.78 m, ~72 kg. */
K.rag = (function () {
  const P = K.phys, U = K.util;

  const L = {
    shin: 0.42, thigh: 0.42, foot: 0.17,
    spine: 0.47, neck: 0.26,
    upperArm: 0.29, foreArm: 0.27,
    hipW: 0.12, shW: 0.19,
    hipH: 0.97, chestH: 1.44, headH: 1.70
  };
  L.leg = L.shin + L.thigh;           // hip yoke to ankle, fully straight
  /* Where a foot is asked to go when it is asked to stand on something.
     The ankle rests 0.075 m (its radius) above a surface, so a target
     slightly below that is what makes the foot press in and register as
     contact at all — aim level with the deck and the runner hovers. */
  L.plant = 0.048;
  L.arm = L.upperArm + L.foreArm;

  function build(x, y, z) {
    const b = P.Body();
    const A = (n, dx, dy, dz, m, r) => P.add(b, n, x + dx, y + dy, z + dz, m, r);

    A('pelvis', 0, L.hipH, 0, 14, 0.13);
    A('chest', 0, L.chestH, 0.01, 18, 0.15);
    A('head', 0, L.headH, 0.02, 5, 0.115);
    for (const s of [-1, 1]) {
      const t = s < 0 ? 'L' : 'R';
      A('hip' + t, s * L.hipW, L.hipH - 0.04, 0, 3, 0.10);
      A('sh' + t, s * L.shW, L.chestH + 0.06, 0, 3, 0.10);
      A('knee' + t, s * L.hipW, 0.52, 0.03, 5, 0.085);
      A('foot' + t, s * L.hipW, 0.10, 0, 2.4, 0.075);
      A('toe' + t, s * L.hipW, 0.045, 0.17, 0.8, 0.055);
      A('elbow' + t, s * (L.shW + 0.02), 1.16, -0.02, 2, 0.07);
      A('hand' + t, s * (L.shW + 0.03), 0.91, 0.05, 1.4, 0.062);
    }

    P.bone(b, 'pelvis', 'chest', 1);
    P.bone(b, 'chest', 'head', 1);
    P.bone(b, 'pelvis', 'head', 0.30);
    P.bone(b, 'hipL', 'hipR', 1); P.bone(b, 'shL', 'shR', 1);
    /* Cross-braces, and they carry load.

       Every other bone in the torso — shoulders to chest, shoulders to pelvis,
       hips to chest — keeps its length while the shoulder line ROTATES about
       the spine. Nothing resisted twist at all, so the arms, which are driven
       to targets that are not symmetrical, simply wound the chest up: measured
       on a swordsman standing still, 55 degrees of shoulder twist off the hips,
       and hands swinging through forty centimetres.

       Two diagonals resist rotation while leaving the torso free to bend
       forward, which is why a bookshelf has a diagonal on its back. */
    P.bone(b, 'shL', 'hipR', 0.9); P.bone(b, 'shR', 'hipL', 0.9);
    for (const t of ['L', 'R']) {
      P.bone(b, 'hip' + t, 'pelvis', 1);
      P.bone(b, 'hip' + t, 'chest', 0.65);
      P.bone(b, 'sh' + t, 'chest', 1);
      P.bone(b, 'sh' + t, 'pelvis', 0.65);
      P.bone(b, 'sh' + t, 'head', 0.35);
      P.bone(b, 'hip' + t, 'knee' + t, 1);
      P.bone(b, 'knee' + t, 'foot' + t, 1);
      P.bone(b, 'foot' + t, 'toe' + t, 1);
      P.bone(b, 'sh' + t, 'elbow' + t, 1);
      P.bone(b, 'elbow' + t, 'hand' + t, 1);
      P.hinge(b, 'hip' + t, 'knee' + t, 'foot' + t, 'lat', 0.04, 2.40);
      P.hinge(b, 'knee' + t, 'foot' + t, 'toe' + t, 'lat', 0.35, 1.70);
      P.hinge(b, 'sh' + t, 'elbow' + t, 'hand' + t, 'lat', 0.04, 2.60);
    }
    b.L = L;
    /* The limb lengths this body ACTUALLY has.

       L is the declared anatomy and the joints as placed had drifted off it:
       L says the upper arm is 0.29 and the forearm 0.27, the joints give 0.341
       and 0.260 — a seventeen per cent error. The IK was solving for a limb
       the body does not have, computing an elbow for a 0.29 bone that the bone
       solver then stretched to 0.341, every frame, for ever. Straight-armed
       poses hid it because both answers agree on 'straight out'; a bent arm
       has room to show it. Measure once, here, and let everything solve for
       the body that exists. */
    const seg = (p, q) => {
      const A = b.parts[p], B = b.parts[q];
      return Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
    };
    b.seg = {
      thigh: seg('hipL', 'kneeL'), shin: seg('kneeL', 'footL'),
      upperArm: seg('shL', 'elbowL'), foreArm: seg('elbowL', 'handL')
    };
    b.reach = { leg: b.seg.thigh + b.seg.shin, arm: b.seg.upperArm + b.seg.foreArm };
    // the sprung mass: what a planted leg is actually holding up
    b.trunk = ['pelvis', 'hipL', 'hipR', 'chest', 'shL', 'shR', 'head'].map(n => b.parts[n]);
    return b;
  }

  function legs(b) {
    return [
      { hip: b.parts.hipL, knee: b.parts.kneeL, foot: b.parts.footL, toe: b.parts.toeL, tag: 'L', side: -1 },
      { hip: b.parts.hipR, knee: b.parts.kneeR, foot: b.parts.footR, toe: b.parts.toeR, tag: 'R', side: 1 }
    ];
  }
  function arms(b) {
    return [
      { sh: b.parts.shL, elbow: b.parts.elbowL, hand: b.parts.handL, tag: 'L', side: -1 },
      { sh: b.parts.shR, elbow: b.parts.elbowR, hand: b.parts.handR, tag: 'R', side: 1 }
    ];
  }

  /* body frame: right / up / forward, read off the shoulders and spine */
  function frame(b) {
    const p = b.parts;
    let rx = p.shR.x - p.shL.x, ry = p.shR.y - p.shL.y, rz = p.shR.z - p.shL.z;
    let rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    let ux = p.chest.x - p.pelvis.x, uy = p.chest.y - p.pelvis.y, uz = p.chest.z - p.pelvis.z;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    // forward = right x up
    const fx = ry * uz - rz * uy, fy = rz * ux - rx * uz, fz = rx * uy - ry * ux;
    const fl = Math.hypot(fx, fy, fz) || 1;
    return { rx, ry, rz, ux, uy, uz, fx: fx / fl, fy: fy / fl, fz: fz / fl };
  }

  function reachLeg(b, leg, tx, ty, tz, speed, dt, hint) {
    const h = leg.hip;
    const s = P.ik(h.x, h.y, h.z, tx, ty, tz, b.seg.thigh, b.seg.shin, hint.x, hint.y, hint.z);
    P.drive(leg.knee, s.jx, s.jy, s.jz, speed * 1.1, dt, speed * 12);
    return P.drive(leg.foot, s.ex, s.ey, s.ez, speed, dt, speed * 26);
  }

  function reachArm(b, arm, tx, ty, tz, speed, dt, hint) {
    const s0 = arm.sh;
    const s = P.ik(s0.x, s0.y, s0.z, tx, ty, tz, b.seg.upperArm, b.seg.foreArm, hint.x, hint.y, hint.z);
    P.drive(arm.elbow, s.jx, s.jy, s.jz, speed * 1.1, dt, speed * 26);
    return P.drive(arm.hand, s.ex, s.ey, s.ez, speed, dt, speed * 34);
  }

  /* The support leg, as a height servo over the planted foot.
     A pure axial spring is not enough: a straight leg carries no load along
     its own axis and the hip simply rides an arc into the deck as the body
     vaults over it. What a real stance leg does is hold the hip at a height
     over the foot — flexing and extending the knee to do it — and that is
     what this regulates, with a hard ceiling on the acceleration it can
     produce. The ceiling is what LEG DRIVE buys, and what a hurt or
     unconscious runner loses. */
  /* Exactly enough to carry the body's own weight and no more. Set above
     gravity it does not hold a stance, it presses the body up until the knees
     lock and the unit stands like a post. */
  const HOLD = 11.2;      // m/s^2 on the sprung mass to merely not sink
  function support(b, leg, targetH, maxAcc, dt, share) {
    const hip = leg.hip, f = leg.foot;
    const err = (f.y + targetH) - hip.y;
    const rate = ((hip.y - hip.py) - (f.y - f.py)) / dt;
    // feed-forward the body's own weight, then correct: a pure proportional
    // servo sags by exactly however much weight it forgot to carry
    const t = K.tune || { supportGain: 90, supportDamp: 10 };
    let a = HOLD * (share === undefined ? 1 : share) + err * t.supportGain - rate * t.supportDamp;
    // A leg yields as well as pushes. Clamped to positive it can only ever
    // hold the body UP, so the knees straighten until the skeleton is a pair
    // of struts and the unit stands like a fence post at whatever height it
    // happened to reach — nothing in the system asks it to come back down.
    a = U.clamp(a, -maxAcc * 0.6, maxAcc);
    for (const t of b.trunk) P.addVel(t, 0, a * dt, 0, dt);
    P.addVel(f, 0, -a * dt * 0.5, 0, dt);
    P.addVel(leg.toe, 0, -a * dt * 0.2, 0, dt);
    return a;
  }

  /* Axial push along the leg: the toe-off that turns support into travel. */
  function legSpring(b, leg, targetLen, stiff, maxAcc, dt) {
    const hip = leg.hip, f = leg.foot;
    let dx = hip.x - f.x, dy = hip.y - f.y, dz = hip.z - f.z;
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const rate = (((hip.x - hip.px) - (f.x - f.px)) * ux
                + ((hip.y - hip.py) - (f.y - f.py)) * uy
                + ((hip.z - hip.pz) - (f.z - f.pz)) * uz) / dt;
    // A leg can push on a roof. It cannot pull on one: clamped at zero, so
    // the body settles where the spring balances its weight and no further.
    let a = (targetLen - d) * stiff - rate * 16;
    a = U.clamp(a, 0, maxAcc);
    // the push goes into the whole sprung mass, not just the hip: a leg
    // lifting only its own joint would never get a body off the deck
    for (const t of b.trunk) P.addVel(t, ux * a * dt, uy * a * dt, uz * a * dt, dt);
    P.addVel(f, -ux * a * dt * 0.55, -uy * a * dt * 0.55, -uz * a * dt * 0.55, dt);
    P.addVel(leg.toe, -ux * a * dt * 0.2, -uy * a * dt * 0.2, -uz * a * dt * 0.2, dt);
    return targetLen - d;
  }

  function poseLeg(b, leg, fx, fy, fz, speed, dt, hint) {
    const h = leg.hip;
    const s = P.ik(h.x, h.y, h.z, fx, fy, fz, b.seg.thigh, b.seg.shin, hint.x, hint.y, hint.z);
    P.drive(leg.knee, s.jx, s.jy, s.jz, speed, dt, speed * 22);
  }

  /* The neutral stance, measured once off a freshly built body: every point's
     offset from the pelvis, in a frame facing +z. */
  const NEUTRAL = (function () {
    const b = build(0, 0, 0), o = {}, p = b.parts.pelvis;
    for (const q of b.list) o[q.name] = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
    return o;
  })();

  /* Put a body back into a clean stance at a place, facing a way.

     Muscles are good at HOLDING a pose and bad at recovering one: from a
     tangle, a leg can end up folded with the foot above the knee, where the
     knee hint is parallel to the limb and the joint flaps instead of bending.
     No amount of servo tuning fixes a shape the solver cannot read. A unit
     under its own control on its own tile has no business being in that shape,
     so it is simply put back — blended over a few frames, which reads as
     picking yourself up rather than as a pop. */
  function settle(b, x, y, z, fx, fz, k) {
    const rx = -fz, rz = fx;                       // right, on the ground
    for (const q of b.list) {
      const o = NEUTRAL[q.name];
      if (!o) continue;
      const tx = x + o.x * rx + o.z * fx;
      const ty = y + o.y;
      const tz = z + o.x * rz + o.z * fz;
      q.x += (tx - q.x) * k; q.y += (ty - q.y) * k; q.z += (tz - q.z) * k;
      q.px = q.x; q.py = q.y; q.pz = q.z;          // and no inherited motion
    }
  }

  /* How far this body is from that clean stance. Arms are excluded: they are
     supposed to move — reaching, swinging, guarding — and a body is not
     tangled because its hand is out in front of it. */
  const CORE = /^(pelvis|chest|head|hip|sh|knee|foot|toe)/;
  function strayed(b, x, y, z, fx, fz) {
    const rx = -fz, rz = fx;
    let worst = 0;
    for (const q of b.list) {
      const o = NEUTRAL[q.name];
      if (!o || !CORE.test(q.name)) continue;
      const d = Math.hypot(q.x - (x + o.x * rx + o.z * fx), q.y - (y + o.y), q.z - (z + o.x * rz + o.z * fz));
      if (d > worst) worst = d;
    }
    return worst;
  }

  function uprightness(b) {
    const p = b.parts.pelvis, c = b.parts.chest;
    const dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    return { tilt: Math.acos(U.clamp(dy / l, -1, 1)) };
  }

  return { L, build, legs, arms, frame, reachLeg, reachArm, support, legSpring, poseLeg,
           uprightness, settle, strayed, NEUTRAL };
})();
