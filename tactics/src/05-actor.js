/* IRONWAKE — the body of a unit.
   This is where the euphoria idea earns its place in a tactics game. A unit
   is pose-driven while it is under its own control: it stands, it walks its
   path, it swings. The moment it is hit, the muscles lose authority and the
   ragdoll takes the blow — stagger, knockdown, or a killing fall off the
   bridge. Nothing here is animation: the same solver that ran the runner
   holds these bodies up, and the same solver drops them.

   Everything a body does is built in ITS OWN FRAME — a heading it turns
   toward, a forward and a sideways derived from that heading. Build a stance
   on world axes instead and a unit walking east stands square to the camera
   and slides, which is not walking, it is furniture being pushed. */
K.actor = (function () {
  const P = K.phys, R = K.rag, U = K.util;
  const { clamp, lerp, angDiff } = U;

  const STANCE = 0.15;       // half the distance between the feet
  const HIP = 0.74;          // hip height over the deck when standing
  const CAD = 4.3;           // steps per second on the march
  const SPEED = 2.80;        // metres per second
  /* The one number that decides whether a walk reads: how far the hips travel
     in one step is how far the swinging foot has to reach, or the planted one
     skates to make up the difference. */
  const STRIDE = SPEED / CAD;

  function create(unit, arena) {
    const w = arena.world(unit.surface);
    const body = R.build(w.x, w.y + 0.02, w.z);
    const fz = unit.side === 0 ? -1 : 1;
    return {
      unit, body, arena,
      mode: 'pose', t: 0,
      dir: { x: 0, z: fz }, face: fz, aim: null,
      strength: 1, limp: 0,
      path: null, leg: 0, stepT: 0, foot: [null, null], travel: 0,
      pos: { x: w.x, y: w.y, z: w.z },
      swing: 0, swingAt: null, fell: false, restT: 0
    };
  }

  function surfaceTop(a) { return a.unit.surface ? a.unit.surface.y : 0; }

  /* ---------------------------------------------------------------- plants

     A foot that is standing on the ground is not "being driven toward a
     position" — it is ON something, and the rest of the body pivots over it.
     Asking a muscle to hold it there loses the argument to the leg bone: the
     hips advance, the bone drags the foot with them, and the whole body skates
     along at four fifths of walking pace with its legs cycling. Measured, the
     plant was slipping 2.3 m/s. So a planted foot is pinned to the world, and
     the leg pushes the hips instead — which is what a leg is for. */
  function plantFoot(a, i, x, y, z) {
    const L = R.legs(a.body)[i];
    // take the foot where it actually is; only lift it if it came down
    // through the floor, so a plant is never a visible snap
    const fy = Math.abs(L.foot.y - y) < 0.05 ? L.foot.y : y;
    L.foot.pinned = { x, y: fy, z };
    L.foot.x = x; L.foot.y = fy; L.foot.z = z;
    a.foot[i] = { x, z };
  }
  function releaseFoot(a, i) {
    const L = R.legs(a.body)[i];
    if (L.foot.pinned) {
      // hand it back to the solver standing still, not carrying whatever
      // velocity the last frame's arithmetic implied
      L.foot.px = L.foot.x; L.foot.py = L.foot.y; L.foot.pz = L.foot.z;
      L.foot.pinned = null;
    }
  }
  function unplant(a) { releaseFoot(a, 0); releaseFoot(a, 1); }

  /* ---------------------------------------------------------------- facing */

  function turn(a, fx, fz, dt, rate) {
    const l = Math.hypot(fx, fz);
    if (l < 1e-5) return;
    fx /= l; fz /= l;
    const cur = Math.atan2(a.dir.x, a.dir.z);
    const want = Math.atan2(fx, fz);
    const d = angDiff(want, cur);
    const th = cur + clamp(d, -rate * dt, rate * dt);
    a.dir.x = Math.sin(th); a.dir.z = Math.cos(th);
    a.face = a.dir.z >= 0 ? 1 : -1;
  }

  /* the body's own axes: where it is looking, and what is to its right */
  function axes(a) {
    return { fx: a.dir.x, fz: a.dir.z, sx: -a.dir.z, sz: a.dir.x };
  }

  /* an order to look at something; the turn itself takes time */
  function faceToward(a, x, z) {
    wake(a);
    a.aim = { x, z };
  }

  function applyAim(a, dt, rate) {
    if (!a.aim) return;
    turn(a, a.aim.x - a.pos.x, a.aim.z - a.pos.z, dt, rate || 7);
  }

  /* ----------------------------------------------------------------- poses */

  /* the pose a unit holds when it is standing its ground */
  function stand(a, dt, lean) {
    const b = a.body, p = b.parts;
    const sp = 5.0 * a.strength;
    const gy = surfaceTop(a);
    const { fx, fz, sx, sz } = axes(a);
    const hintK = { x: fx, y: 0, z: fz }, hintA = { x: -fx, y: 0, z: -fz };

    const legs = R.legs(b);
    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      // feet planted either side of the tile centre, square to the heading
      const hx = a.pos.x + sx * L.side * STANCE;
      const hz = a.pos.z + sz * L.side * STANCE;
      if (!a.foot[i]) a.foot[i] = { x: hx, z: hz };
      // A body that has been thrown leaves its old footprints behind. Left
      // alone the stance tries to stand on them, the legs trail out behind the
      // hips and the unit quietly sinks to a kneel — so the plant walks itself
      // home whenever it has drifted off the tile.
      const off = Math.hypot(a.foot[i].x - hx, a.foot[i].z - hz);
      if (off > 0.26) {
        const k = clamp(dt * 6, 0, 1);
        a.foot[i].x = lerp(a.foot[i].x, hx, k);
        a.foot[i].z = lerp(a.foot[i].z, hz, k);
      }
      R.reachLeg(b, L, a.foot[i].x, gy + R.L.plant, a.foot[i].z, sp, dt, hintK);
      if (L.foot.grounded || L.toe.grounded) {
        R.support(b, L, R.L.leg * 0.88, (34 + 26) * a.strength, dt, 0.5);
      }
      P.drive(L.toe, L.foot.x + fx * 0.14, L.foot.y - 0.05, L.foot.z + fz * 0.14, sp, dt, sp * 14);
    }
    // hips over the feet, chest up, a little weight forward
    P.drive(p.pelvis, a.pos.x, gy + HIP, a.pos.z, sp * 0.8, dt, 40 * a.strength);
    const l = lean === undefined ? 0.08 : lean;
    P.aim(p.pelvis, p.chest, fx * l, 1, fz * l, 0.30 * a.strength);
    P.aim(p.chest, p.head, fx * 0.05, 1, fz * 0.05, 0.25 * a.strength);

    // arms: the weapon hand forward and across, the off hand low
    const A = R.arms(b);
    const guard = a.swing > 0 ? 1 - a.swing : 0;
    for (const arm of A) {
      const lead = arm.side > 0;                       // the right hand holds it
      const out = lead ? 0.15 : 0.23;
      const reach = lead ? 0.30 + guard * 0.16 : 0.10;
      R.reachArm(b, arm,
        arm.sh.x + sx * arm.side * out + fx * reach,
        arm.sh.y - 0.34 + (lead ? guard * 0.28 : 0),
        arm.sh.z + sz * arm.side * out + fz * reach, sp, dt, hintA);
    }
  }

  /* Walking a path. Two beats, and the one thing that has to be true: while a
     foot is planted it stays where it was put, and the hips pass over it. The
     swinging foot therefore has to cover exactly the ground the hips covered
     in that step — anything less and the plant slides, which reads as a body
     being dragged rather than a body walking. */
  function walk(a, dt) {
    const b = a.body, p = b.parts;
    const sp = 5.5 * a.strength;
    const gy = a.pos.y;
    const legs = R.legs(b);
    const { fx, fz, sx, sz } = axes(a);
    const hintK = { x: fx, y: 0, z: fz };
    const stride = clamp((a.speed || SPEED) / CAD, 0.20, 0.78);

    a.stepT += dt * CAD;
    if (a.stepT >= 1) {
      a.stepT -= 1;
      a.leg = 1 - a.leg;
      // the foot that has just landed takes the weight, exactly where it came
      // down; the other one is handed to the swing
      const landed = legs[1 - a.leg];
      releaseFoot(a, a.leg);
      a.foot[a.leg] = null;
      plantFoot(a, 1 - a.leg, landed.foot.x, gy + R.L.plant, landed.foot.z);
      K.audio.step(0.4);
    }

    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      const hx = a.pos.x + sx * L.side * STANCE;
      const hz = a.pos.z + sz * L.side * STANCE;
      if (i === a.leg) {
        // swinging: lifted, carried from behind the hips to in front of them
        const s = Math.sin(a.stepT * Math.PI);
        const ahead = lerp(-stride * 0.5, stride * 0.5, a.stepT);
        R.reachLeg(b, L,
          hx + fx * ahead, gy + R.L.plant + s * 0.12, hz + fz * ahead,
          sp * 2.0, dt, hintK);
        P.drive(L.toe, L.foot.x + fx * 0.13, L.foot.y - 0.04 + s * 0.03, L.foot.z + fz * 0.13, sp, dt, sp * 14);
      } else {
        if (!a.foot[i] || !L.foot.pinned) plantFoot(a, i, L.foot.x, gy + R.L.plant, L.foot.z);
        // the knee still has to be steered, and the hip still has to be held
        // up — a pin is not a contact, so the support is unconditional here
        R.reachLeg(b, L, a.foot[i].x, gy + R.L.plant, a.foot[i].z, sp, dt, hintK);
        R.support(b, L, R.L.leg * 0.86, 60 * a.strength, dt, 1);
        P.drive(L.toe, L.foot.x + fx * 0.13, L.foot.y - 0.04, L.foot.z + fz * 0.13, sp, dt, sp * 14);
      }
    }

    // the hips ride a little as the legs pass: a walk has a bounce in it
    const bob = Math.abs(Math.sin(a.stepT * Math.PI)) * 0.020;
    P.drive(p.pelvis, a.pos.x, gy + HIP - 0.02 + bob, a.pos.z, sp, dt, 90 * a.strength);
    // hold the trunk up hard: left slack it is dragged along by the hips and
    // the unit walks bent over its own toes
    P.aim(p.pelvis, p.chest, fx * 0.07, 1, fz * 0.07, 0.46 * a.strength);
    P.aim(p.chest, p.head, fx * 0.01, 1, fz * 0.01, 0.40 * a.strength);

    const A = R.arms(b);
    for (const arm of A) {
      // arms swing against the legs, along the way the body is going
      // the off hand swings; the weapon hand mostly carries
      const amp = arm.side > 0 ? 0.09 : 0.17;
      const bias = arm.side > 0 ? 0.13 : 0;
      const s = Math.sin(a.stepT * Math.PI + (arm.side > 0 ? Math.PI : 0) + (a.leg ? Math.PI : 0));
      R.reachArm(b, arm,
        arm.sh.x + sx * arm.side * 0.17 + fx * (bias + s * amp),
        arm.sh.y - 0.35 - Math.abs(s) * 0.02,
        arm.sh.z + sz * arm.side * 0.17 + fz * (bias + s * amp),
        sp, dt, { x: -fx, y: 0, z: -fz });
    }
  }

  /* ---------------------------------------------------------------- orders */

  function walkPath(a, path, arena) {
    if (!path || path.length < 2) return false;
    a.path = path.map(s => { const w = arena.world(s); return { x: w.x, y: w.y, z: w.z, s }; });
    a.pathI = 0; a.mode = 'walk'; a.stepT = 0; a.foot = [null, null]; a.aim = null;
    unplant(a);
    a.speed = SPEED;
    wake(a);
    return true;
  }

  function strikeAt(a, target) {
    a.mode = 'strike'; a.t = 0; a.swing = 0; a.swingAt = target;
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
    unplant(a);            // a body taking a blow owns nothing, least of all the floor
    wake(a);
  }

  /* ------------------------------------------------------------------ rest */

  /* A dozen ragdolls at 120 Hz is more than a phone should be asked to do for
     units that are standing perfectly still. A body that has come to rest
     under its own pose is frozen until something happens to it. */
  function settled(a, dt) {
    const still = a.mode === 'pose' || a.mode === 'dead';
    if (!still || a.limp > 0 || a.path || a.strength < 0.99) { a.calm = 0; a.anchor = null; return false; }
    // A held pose never stops buzzing — the muscles are a control loop, not a
    // pose, and they hunt around the target for ever. So rest is judged by
    // whether the body has actually GONE anywhere.
    const p = a.body.parts.pelvis;
    if (!a.anchor) { a.anchor = { x: p.x, y: p.y, z: p.z }; a.calm = 0; return false; }
    if (Math.abs(p.x - a.anchor.x) + Math.abs(p.y - a.anchor.y) + Math.abs(p.z - a.anchor.z) > 0.05) {
      a.anchor = { x: p.x, y: p.y, z: p.z }; a.calm = 0; return false;
    }
    a.calm = (a.calm || 0) + dt;
    return a.calm > 0.6;
  }

  function wake(a) { a.rest = false; a.calm = 0; a.anchor = null; }

  /* ------------------------------------------------------------------ step */

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
      if (dist < 0.06) {
        a.pathI++;
        a.pos.y = tgt.y;
        if (a.pathI >= a.path.length - 1) {
          a.unit.surface = a.path[a.path.length - 1].s;
          a.mode = 'pose'; a.path = null; a.foot = [null, null]; a.speed = 0;
          unplant(a);
        }
      } else {
        const tx = dx / dist, tz = dz / dist;
        // turn toward the next tile, and only walk as fast as you are pointed
        // at it: a unit that pivots on the spot beats one that crabs sideways
        turn(a, tx, tz, dt, 8);
        const align = clamp(a.dir.x * tx + a.dir.z * tz, 0, 1);
        a.speed = SPEED * (0.25 + 0.75 * align * align);
        const move = Math.min(dist, a.speed * dt);
        a.pos.x += tx * move; a.pos.z += tz * move;
        a.pos.y = lerp(a.pos.y, tgt.y, clamp(dt * 6, 0, 1));
      }
    } else {
      applyAim(a, dt, a.mode === 'strike' ? 12 : 7);
    }

    if (a.mode === 'strike') {
      a.swing = clamp(a.t / 0.42, 0, 1);
      if (a.t > 0.5) { a.mode = 'pose'; a.swing = 0; }
    }

    if (a.limp > 0) {
      a.limp -= dt;
      if (a.limp <= 0 && a.mode !== 'dead') { a.mode = 'rise'; a.restT = 0; }
    }
    if (a.mode === 'rise') {
      // get the feet back under and stand up: the same heave the runner uses
      a.strength = clamp(a.strength + dt * 1.6, 0, 1);
      a.restT += dt;
      const gy = surfaceTop(a);
      const { fx, fz, sx, sz } = axes(a);
      for (const L of R.legs(b)) {
        R.reachLeg(b, L, a.pos.x + sx * L.side * STANCE, gy + R.L.plant, a.pos.z + sz * L.side * STANCE,
          4 * a.strength, dt, { x: fx, y: 0, z: fz });
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
        const arm = R.arms(b)[1];
        const th = Math.sin(a.swing * Math.PI);
        const tx = lerp(arm.sh.x, a.swingAt.pos.x, th * 0.45);
        const tz = lerp(arm.sh.z, a.swingAt.pos.z, th * 0.45);
        R.reachArm(b, arm, tx, arm.sh.y - 0.18 + th * 0.2, tz, 9, dt,
          { x: -a.dir.x, y: 0, z: -a.dir.z });
      }
    } else if (a.mode === 'walk') {
      walk(a, dt);
    }

    // the solver, every frame, for every body on the field
    P.integrate(b, dt, 1);
    const frame = R.frame(b);
    for (let i = 0; i < 4; i++) { P.solveBones(b); P.solveHinges(b, frame); }
    P.collide(b, level, dt);
    P.holdPins(b);

    // nothing but a walking body may hold on to the floor
    if (a.mode !== 'walk') unplant(a);
    // knocked off the edge: the arena kills, not the arithmetic
    if (!a.fell && p.pelvis.y < surfaceTop(a) - 3.0) {
      a.fell = true;
      a.mode = 'dead'; a.strength = 0.05; a.limp = 999;
    }
    // The stance is anchored to the TILE, not to wherever the body has got to.
    // Letting the pose target chase the pelvis makes a closed loop with no
    // reference: every unit slowly wanders off its own square.
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

  return { create, step, walkPath, strikeAt, takeHit, faceToward, wake, turn, unplant,
           HIP, STANCE, SPEED, CAD, STRIDE };
})();
