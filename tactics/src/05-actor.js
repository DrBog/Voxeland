/* IRONWAKE — the body of a unit.
   This is where the euphoria idea earns its place in a tactics game. A unit
   is pose-driven while it is under its own control: it stands, it walks its
   path, it swings. The moment it is hit, the muscles lose authority and the
   ragdoll takes the blow — stagger, knockdown, or a killing fall off the
   bridge. Nothing here is animation: the same solver that ran the runner
   holds these bodies up, and the same solver drops them. */
K.actor = (function () {
  const P = K.phys, R = K.rag, U = K.util;
  const { clamp, lerp } = U;

  const STANCE = 0.16;       // half the distance between the feet
  const HIP = 0.74;          // hip height over the deck when standing

  function create(unit, arena) {
    const w = arena.world(unit.surface);
    const body = R.build(w.x, w.y + 0.02, w.z);
    return {
      unit, body, arena,
      mode: 'pose', t: 0, face: unit.side === 0 ? 1 : -1,
      strength: 1, limp: 0, phase: 0,
      path: null, leg: 0, stepT: 0, foot: [null, null],
      pos: { x: w.x, y: w.y, z: w.z },
      swing: 0, swingAt: null, fell: false, restT: 0
    };
  }

  function surfaceTop(a) { return a.unit.surface ? a.unit.surface.y : 0; }

  /* the pose a unit holds when it is standing its ground */
  function stand(a, dt, lean) {
    const b = a.body, p = b.parts, u = a.unit;
    const sp = 5.0 * a.strength;
    const gy = surfaceTop(a);
    const f = a.face;
    const hintK = { x: 0, y: 0, z: f }, hintA = { x: 0, y: 0, z: -f };

    // feet planted either side of the tile centre
    const legs = R.legs(b);
    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      const fx = a.pos.x + L.side * STANCE;
      const fz = a.pos.z - L.side * 0.03 * f;
      if (!a.foot[i]) a.foot[i] = { x: fx, z: fz };
      // A body that has been thrown leaves its old footprints behind. Left
      // alone the stance tries to stand on them, the legs trail out behind
      // the hips and the unit quietly sinks to a kneel — so the plant walks
      // itself home whenever it has drifted off the tile.
      const off = Math.hypot(a.foot[i].x - fx, a.foot[i].z - fz);
      if (off > 0.30) {
        const k = U.clamp(dt * 6, 0, 1);
        a.foot[i].x = lerp(a.foot[i].x, fx, k);
        a.foot[i].z = lerp(a.foot[i].z, fz, k);
      }
      R.reachLeg(b, L, a.foot[i].x, gy + R.L.plant, a.foot[i].z, sp, dt, hintK);
      if (L.foot.grounded || L.toe.grounded) {
        R.support(b, L, R.L.leg * 0.88, (34 + 26) * a.strength, dt, 0.5);
      }
      P.drive(L.toe, L.foot.x, L.foot.y - 0.05, L.foot.z + 0.15 * f, sp, dt, sp * 14);
    }
    // hips over the feet, chest up, a little weight forward
    P.drive(p.pelvis, a.pos.x, gy + HIP, a.pos.z, sp * 0.8, dt, 40 * a.strength);
    const l = lean === undefined ? 0.08 : lean;
    P.aim(p.pelvis, p.chest, 0, 1, l * f, 0.30 * a.strength);
    P.aim(p.chest, p.head, 0, 1, 0.05 * f, 0.25 * a.strength);

    // arms: weapon hand forward and across, off hand low
    const A = R.arms(b);
    const guard = a.swing > 0 ? 1 - a.swing : 0;
    for (const arm of A) {
      const lead = (arm.side > 0) === (f > 0);
      const reach = lead ? 0.30 + guard * 0.16 : 0.14;
      R.reachArm(b, arm,
        arm.sh.x + arm.side * (lead ? 0.16 : 0.24),
        arm.sh.y - 0.34 + (lead ? guard * 0.28 : 0),
        arm.sh.z + f * reach, sp, dt, hintA);
    }
  }

  /* walking a path: two-beat, deliberate, nothing fancy — a tactics unit
     covers ground, it does not sprint */
  function walk(a, dt, arena) {
    const b = a.body, p = b.parts;
    const sp = 5.5 * a.strength;
    if (a.dirX === undefined) { a.dirX = 0; a.dirZ = a.face; }
    const gy = a.pos.y;
    const legs = R.legs(b);
    const hintK = { x: 0, y: 0, z: a.face };

    a.stepT += dt * 3.15;
    if (a.stepT >= 1) { a.stepT = 0; a.leg = 1 - a.leg; a.foot[a.leg] = null; }
    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      const home = { x: a.pos.x + L.side * STANCE, z: a.pos.z };
      if (i === a.leg) {
        // swinging: lift and place ahead along the direction of travel
        const s = Math.sin(a.stepT * Math.PI);
        const ahead = lerp(-0.28, 0.34, a.stepT);
        R.reachLeg(b, L,
          home.x + a.dirX * ahead, gy + R.L.plant + s * 0.20, home.z + a.dirZ * ahead,
          sp * 1.9, dt, hintK);
      } else {
        if (!a.foot[i]) a.foot[i] = { x: L.foot.x, z: L.foot.z };
        R.reachLeg(b, L, a.foot[i].x, gy + R.L.plant, a.foot[i].z, sp, dt, hintK);
        if (L.foot.grounded || L.toe.grounded) R.support(b, L, R.L.leg * 0.88, 60 * a.strength, dt, 1);
      }
    }
    P.drive(p.pelvis, a.pos.x, gy + HIP, a.pos.z, sp, dt, 70 * a.strength);
    P.aim(p.pelvis, p.chest, 0, 1, 0.10 * a.face, 0.34 * a.strength);
    P.aim(p.chest, p.head, 0, 1, 0, 0.25 * a.strength);
    const A = R.arms(b);
    for (const arm of A) {
      const s = Math.sin(a.stepT * Math.PI * 2 + (arm.side > 0 ? Math.PI : 0));
      R.reachArm(b, arm, arm.sh.x + arm.side * 0.19, arm.sh.y - 0.36,
        arm.sh.z + s * 0.16 * a.face, sp, dt, { x: 0, y: 0, z: -a.face });
    }
  }

  /* ---------------------------------------------------------------- orders */

  function walkPath(a, path, arena) {
    if (!path || path.length < 2) return false;
    a.path = path.map(s => { const w = arena.world(s); return { x: w.x, y: w.y, z: w.z, s }; });
    a.pathI = 0; a.mode = 'walk'; a.stepT = 0; a.foot = [null, null];
    wake(a);
    return true;
  }

  function faceToward(a, x, z) {
    wake(a);
    const dz = z - a.pos.z, dx = x - a.pos.x;
    a.face = Math.abs(dz) >= Math.abs(dx) ? (dz >= 0 ? 1 : -1) : (dx >= 0 ? 1 : -1);
    a.aimX = dx; a.aimZ = dz;
  }

  function strikeAt(a, target) {
    a.mode = 'strike'; a.t = 0; a.swing = 0; a.swingAt = target;
    wake(a);
    faceToward(a, target.pos.x, target.pos.z);
  }

  /* A blow lands. The muscles lose the argument for a moment; if it is fatal
     they lose it for good, and whatever the body does next is the solver's. */
  function takeHit(a, fromX, fromZ, force, lethal, crit) {
    const b = a.body;
    let dx = a.pos.x - fromX, dz = a.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    const up = lethal ? 2.2 : 1.1;
    const kick = force * (crit ? 1.7 : 1) * (lethal ? 1.5 : 1);
    const dt = 1 / 180;
    for (const p of b.list) P.addVel(p, dx * kick, up * (lethal ? 1 : 0.6), dz * kick, dt);
    // the head and chest take the brunt, which is what makes it read as a hit
    P.addVel(b.parts.chest, dx * kick * 0.6, up * 0.4, dz * kick * 0.6, dt);
    P.addVel(b.parts.head, dx * kick * 0.5, up * 0.5, dz * kick * 0.5, dt);
    a.strength = lethal ? 0.05 : 0.22;
    a.limp = lethal ? 999 : (crit ? 1.1 : 0.7);
    a.mode = lethal ? 'dead' : 'hit';
    a.restT = 0;
    a.foot = [null, null];
    wake(a);
  }

  /* ------------------------------------------------------------------ step */

  /* A dozen ragdolls at 120 Hz is more than a phone should be asked to do for
     eleven units that are standing perfectly still. A body that has come to
     rest under its own pose is frozen until something happens to it — which is
     every unit but the one whose turn it is. */
  function settled(a, dt) {
    const still = a.mode === 'pose' || a.mode === 'dead';
    if (!still || a.limp > 0 || a.path || a.strength < 0.99) { a.calm = 0; a.anchor = null; return false; }
    // A held pose never stops buzzing — the muscles are a control loop, not a
    // pose, and they hunt around the target by a few millimetres for ever. So
    // rest is judged by whether the body has actually GONE anywhere.
    const p = a.body.parts.pelvis;
    if (!a.anchor) { a.anchor = { x: p.x, y: p.y, z: p.z }; a.calm = 0; return false; }
    if (Math.abs(p.x - a.anchor.x) + Math.abs(p.y - a.anchor.y) + Math.abs(p.z - a.anchor.z) > 0.05) {
      a.anchor = { x: p.x, y: p.y, z: p.z }; a.calm = 0; return false;
    }
    a.calm = (a.calm || 0) + dt;
    return a.calm > 0.6;
  }

  function wake(a) { a.rest = false; a.calm = 0; a.anchor = null; }

  function step(a, dt, arena, level) {
    const b = a.body, p = b.parts;
    a.t += dt;
    if (a.rest) {
      if (a.mode === 'pose' || a.mode === 'dead') return;
      a.rest = false;
    }

    if (a.mode === 'walk' && a.path) {
      const tgt = a.path[Math.min(a.pathI + 1, a.path.length - 1)];
      let dx = tgt.x - a.pos.x, dz = tgt.z - a.pos.z;
      const dist = Math.hypot(dx, dz);
      const speed = 3.4;
      if (dist < 0.06) {
        a.pathI++;
        a.pos.y = tgt.y;
        if (a.pathI >= a.path.length - 1) {
          a.unit.surface = a.path[a.path.length - 1].s;
          a.mode = 'pose'; a.path = null; a.foot = [null, null];
        }
      } else {
        a.dirX = dx / dist; a.dirZ = dz / dist;
        faceToward(a, tgt.x, tgt.z);
        const move = Math.min(dist, speed * dt);
        a.pos.x += a.dirX * move; a.pos.z += a.dirZ * move;
        a.pos.y = lerp(a.pos.y, tgt.y, clamp(dt * 6, 0, 1));
      }
    }

    if (a.mode === 'strike') {
      a.swing = clamp(a.t / 0.42, 0, 1);
      if (a.t > 0.5) { a.mode = 'pose'; a.swing = 0; }
    }

    if (a.limp > 0) {
      a.limp -= dt;
      if (a.limp <= 0 && a.mode !== 'dead') {
        a.mode = 'rise'; a.restT = 0;
      }
    }
    if (a.mode === 'rise') {
      // get the feet back under and stand up: the same heave the runner uses
      a.strength = clamp(a.strength + dt * 1.6, 0, 1);
      a.restT += dt;
      const gy = surfaceTop(a);
      const legs = R.legs(b);
      for (const L of legs) {
        R.reachLeg(b, L, a.pos.x + L.side * STANCE, gy + R.L.plant, a.pos.z, 4 * a.strength, dt,
          { x: 0, y: 0, z: a.face });
      }
      const err = (gy + HIP) - p.pelvis.y;
      if (err > 0) {
        const acc = clamp(err * 80, 0, 54) * a.strength;
        for (const t of b.trunk) P.addVel(t, 0, acc * dt, 0, dt);
      }
      if ((a.restT > 0.5 && p.pelvis.y - gy > 0.55) || a.restT > 1.8) {
        a.mode = 'pose'; a.strength = 1; a.foot = [null, null];
      }
    }

    if (a.mode === 'pose' || a.mode === 'strike') {
      a.strength = clamp(a.strength + dt * 2, 0, 1);
      stand(a, dt, a.mode === 'strike' ? 0.10 + Math.sin(a.swing * Math.PI) * 0.34 : 0.08);
      if (a.mode === 'strike' && a.swingAt) {
        // the weapon arm drives through the target
        const A = R.arms(b);
        const arm = A[a.face > 0 ? 1 : 0];
        const th = Math.sin(a.swing * Math.PI);
        const tx = lerp(arm.sh.x, a.swingAt.pos.x, th * 0.45);
        const tz = lerp(arm.sh.z, a.swingAt.pos.z, th * 0.45);
        R.reachArm(b, arm, tx, arm.sh.y - 0.18 + th * 0.2, tz, 9, dt, { x: 0, y: 0, z: -a.face });
      }
    } else if (a.mode === 'walk') {
      walk(a, dt, arena);
    }

    // the solver, every frame, for every body on the field
    P.integrate(b, dt, 1);
    const frame = R.frame(b);
    for (let i = 0; i < 4; i++) { P.solveBones(b); P.solveHinges(b, frame); }
    P.collide(b, level, dt);

    // knocked off the edge: the arena kills, not the arithmetic
    if (!a.fell && p.pelvis.y < surfaceTop(a) - 3.0) {
      a.fell = true;
      a.mode = 'dead'; a.strength = 0.05; a.limp = 999;
    }
    // The stance is anchored to the TILE, not to wherever the body has got
    // to. Letting the pose target chase the pelvis makes a closed loop with no
    // reference: every unit slowly wanders off its own square. Anchored, a
    // unit that has been knocked across the floor picks itself up and lurches
    // back to where it is supposed to be standing.
    if (a.mode !== 'dead' && a.mode !== 'walk' && a.unit.surface) {
      const w = arena.world(a.unit.surface);
      const k = clamp(dt * 2.2, 0, 1);
      a.pos.x = lerp(a.pos.x, w.x, k);
      a.pos.y = lerp(a.pos.y, w.y, k);
      a.pos.z = lerp(a.pos.z, w.z, k);
    }
    if (settled(a, dt)) {
      a.rest = true;
      for (const q of b.list) { q.px = q.x; q.py = q.y; q.pz = q.z; }
    }
  }

  return { create, step, walkPath, strikeAt, takeHit, faceToward, wake, HIP, STANCE };
})();
