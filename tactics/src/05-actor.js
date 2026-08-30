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

  const STANCE = 0.19;       // half the distance between the feet

  /* How each trade stands, and which hand its weapon is in.

     At the size a unit is drawn, joints are invisible and the silhouette is
     everything: how wide the feet are, where the hands sit, whether the weapon
     is up or down. Five classes that all stood identically were five identical
     grey figures. Distances are metres from the shoulder — out to the side,
     forward, and below. */
  /* Footing, and it is narrower than it wants to be.

     A stance's foot width and lead used to run 0.15-0.25 and 0.03-0.13, which
     read well and did not stand up. The two legs each run a height servo, and
     the servos both correct the shared trunk — so the further apart the feet
     are in BOTH axes, the more different the two legs' geometry, and the
     harder the two servos pull against each other. Measured, that shook the
     hip yoke through six centimetres and a knee hanging under it through
     thirteen, on units standing still. Neither number alone did it: swapping
     width or lead on its own changed nothing, swapping both together took the
     knee from 10.4 cm to 0.5.

     Sweeping the two toward the one stance that was measurably quiet, the
     whole roster comes good at about 85% of the way, and the response is
     lumpy rather than smooth on the way — it is a resonance, not a gradient —
     so these sit well inside the calm region rather than on its edge. The
     ordering survives: a reaver still stands widest and a mage narrowest. The
     magnitude does not, and at twenty-odd pixels a unit it was never the part
     of a stance you could see. The weapon and the arms carry that. */
  const STANCES = {
    Blade:   { feet: 0.160, lead: 0.053, hip: 0.00, lean: 0.10, hand: 1,
               main: { out: 0.30, fwd: 0.24, drop: 0.32 }, off: { out: 0.30, fwd: 0.04, drop: 0.40 } },
    Halberd: { feet: 0.165, lead: 0.043, hip: 0.00, lean: 0.03, hand: 1,
               main: { out: 0.19, fwd: 0.28, drop: 0.16 }, off: { out: 0.13, fwd: 0.31, drop: 0.36 } },
    Reaver:  { feet: 0.169, lead: 0.046, hip: -0.03, lean: 0.15, hand: 1,
               main: { out: 0.17, fwd: 0.30, drop: 0.40 }, off: { out: 0.07, fwd: 0.33, drop: 0.44 } },
    Archer:  { feet: 0.156, lead: 0.047, hip: 0.00, lean: 0.05, hand: -1,
               main: { out: 0.34, fwd: 0.30, drop: 0.20 }, off: { out: 0.11, fwd: 0.05, drop: 0.28 } },
    Ember:   { feet: 0.154, lead: 0.044, hip: 0.01, lean: 0.02, hand: 1,
               main: { out: 0.15, fwd: 0.33, drop: 0.12 }, off: { out: 0.27, fwd: 0.00, drop: 0.42 } }
  };
  const stanceOf = (a) => STANCES[a.unit.cls] || STANCES.Blade;
  /* Nearly straight, but not locked: at 0.74 the knees bent sixty degrees,
     which is a crouch, and from a camera looking down at it a knee that far
     forward projects BELOW its own foot. */
  /* Where the hips ride when a body is standing.

     This is the pelvis, measured from the deck, and it is deliberately ONE
     number. The hip servo and the pelvis drive used to hold two targets 6.7 cm
     apart, because the servo measured from the ankle and the drive measured
     from the floor. They spent every standing frame pulling against each other
     and the servo lost: the legs locked out straight and the body stood on
     stilts at whatever height the collision happened to allow. */
  const FOOT = 0.075;        // where an ankle comes to rest on a surface
  const RISE = 0.04;         // the pelvis sits this far above the hip joints
  const HIP = 0.885;         // pelvis over the deck: 92% leg extension, a knee
  // the same height in the hip servo's units: hip joint above the ankle
  const hipOverFoot = (st) => HIP + (st ? st.hip : 0) - FOOT - RISE;
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
    const st = STANCES[unit.cls] || STANCES.Blade;
    return {
      // everybody breathes at their own rate, or a line of them pulses as one
      breath: (unit.id * 0.37) % 1, weaponSide: st.hand,
      step: st.hand > 0 ? 0 : 1, stepAt: 0,
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
    const st = stanceOf(a);
    // a hint with a little height in it can never end up parallel to a leg,
    // which is the state that makes the knee flap instead of bend
    const hintK = { x: fx, y: 0.15, z: fz }, hintA = { x: -fx, y: 0, z: -fz };

    const legs = R.legs(b);
    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      // feet planted either side of the tile centre, square to the heading
      // A stance is not symmetrical. The weapon side stands back, the other
      // foot leads, and the difference between the two is most of what tells
      // you at a glance that this is a person facing that way.
      // the weapon side stands back, the other foot leads, and the size of
      // that difference is part of what tells one trade from another
      const lead = (L.side === st.hand ? -st.lead : st.lead * 0.7)
        + (i === a.step ? (a.stepAt || 0) : 0);
      const hx = a.pos.x + sx * L.side * st.feet + fx * lead;
      const hz = a.pos.z + sz * L.side * st.feet + fz * lead;
      // Seed the plant from where the foot ACTUALLY is, not from where the
      // stance wants it. A body that has just stopped walking has its feet
      // mid-stride; snapping the pin to the stance home teleports them. The
      // tracker below walks them in over the next few frames instead.
      if (!a.foot[i]) a.foot[i] = { x: L.foot.x, z: L.foot.z };
      // A body that has been thrown leaves its old footprints behind, so the
      // plant walks itself home whenever it has drifted off the tile.
      // and it tracks its stance closely enough that a trade's footing is
      // actually the footing it was given, rather than whatever it inherited
      const off = Math.hypot(a.foot[i].x - hx, a.foot[i].z - hz);
      if (off > 0.07) {
        const k = clamp(dt * (off > 0.26 ? 6 : 2.2), 0, 1);
        a.foot[i].x = lerp(a.foot[i].x, hx, k);
        a.foot[i].z = lerp(a.foot[i].z, hz, k);
      }
      /* A standing foot is ON the floor; it is not being asked to hover
         there. Left to a muscle it loses the argument to the leg bone the
         moment the hips twist, and the two feet walk into each other —
         measured across one sword swing a stance closed from 0.32 m to
         0.06 m, and the legs read on screen as a single column. So a standing
         foot is pinned, exactly like a walking one, and the legs carry the
         hips over it. The muscle stays in the loop only to steer the knee. */
      const py = L.foot.pinned
        ? lerp(L.foot.pinned.y, gy + FOOT, clamp(dt * 6, 0, 1))
        : (Math.abs(L.foot.y - gy - FOOT) < 0.12 ? L.foot.y : gy + FOOT);
      R.reachLeg(b, L, a.foot[i].x, py, a.foot[i].z, sp, dt, hintK);
      L.foot.pinned = { x: a.foot[i].x, y: py, z: a.foot[i].z };
      // hold the hips at standing height above the foot — a fraction of the
      // leg's length is a different number, and it is the one that locks the
      // knees straight; the leg left standing carries the whole weight
      if (L.foot.grounded || L.toe.grounded || L.foot.y - gy < 0.14) {
        R.support(b, L, hipOverFoot(st), (34 + 26) * a.strength, dt, 0.5);
      }
      P.drive(L.toe, L.foot.x + fx * 0.14, L.foot.y - 0.05, L.foot.z + fz * 0.14, sp, dt, sp * 14);
    }
    /* Idle life. A held pose is a statue, and a line of statues is what makes
       a board look dead: the chest rises and falls, the weight drifts from one
       foot to the other, and every unit does it on its own clock. It is two
       centimetres of movement and it is the difference between a squad waiting
       and a row of furniture. */
    a.breath += dt * 0.23;
    const air = Math.sin(a.breath * Math.PI * 2);
    const shift = Math.sin(a.breath * Math.PI * 0.61);
    // and when it is swinging, the body goes with the blow: the lead foot
    // steps in, the hips follow it, and the weight arrives with the weapon.
    // A body that swings from the shoulders alone is waving, not hitting.
    const push = a.push || 0;
    const bx = a.pos.x + sx * shift * 0.022 + fx * push;
    const bz = a.pos.z + sz * shift * 0.022 + fz * push;
    // hips over the feet, chest up, a little weight forward
    P.drive(p.pelvis, bx, gy + HIP + st.hip + air * 0.012, bz, sp * 0.8, dt, 40 * a.strength);

    /* Hold the shoulders square to the way the body is facing.

       Nothing did, and the arms hang off them: a shoulder line free to rotate
       is a pair of arms free to swing, and they swung through forty
       centimetres. The braces above stop the torso winding up; this stops it
       wandering off the heading in the first place. The HIPS deliberately get
       no such treatment — driving a three-kilo joint hard against stiff bones
       just gives it something to chatter against, which measured four times
       worse than leaving it alone. */
    const hold = (part, sgn, half, k) => P.drive(part,
      bx + sx * sgn * half, part.y, bz + sz * sgn * half, sp, dt, k * a.strength);
    hold(p.shL, -1, R.L.shW, 22); hold(p.shR, 1, R.L.shW, 22);
    /* If the body has strayed from the stance it is supposed to be holding —
       a leg folded the wrong way, an arm through the chest, a knee above a hip
       — put it back. The muscles hold a pose well and recover one badly, and a
       unit standing on its own tile under its own control has no business in a
       shape the solver cannot read its way out of. Blended, so it reads as
       picking yourself up rather than as a pop. */
    /* It fires when the pose is BROKEN, and only then.

       strayed() reports the worst distance between a core joint and where it
       sits on a freshly built body. That baseline is not the stance: every
       trade stands with its feet wider than the build and its hips lower, so a
       perfectly healthy body reads about a third of a metre from neutral all
       day long. Measured on a swordsman standing still, the signal never left
       0.338-0.345 — and the trigger was 0.34, sitting inside its own noise.
       It fired on two frames in every three.

       settle() writes joint positions directly, so what that amounted to was a
       controller reaching in several times a second and dragging the limbs
       back toward a pose nobody had asked for: the feet in toward 0.12 while
       the stance pushed them out to 0.19, the arms in to the sides while the
       stance held them out. Those are the wobbly feet and the wobbly arms.

       So: a threshold clear of the healthy band, and hysteresis, because a
       bang-bang controller living on the edge of its own signal is what went
       wrong here in the first place. A body that has really been thrown reads
       far past 0.85. */
    const stray = a.swing > 0 ? 0 : R.strayed(b, a.pos.x, gy + HIP, a.pos.z, fx, fz);
    if (stray > 0.85) a.mending = true;
    else if (stray < 0.50) a.mending = false;
    if (a.mending) {
      a.mend = (a.mend || 0) + dt;
      R.settle(b, a.pos.x, gy + HIP, a.pos.z, fx, fz, clamp(dt * (a.mend > 0.8 ? 9 : 3.5), 0, 1));
    } else a.mend = 0;
    const l = lean === undefined ? st.lean : lean;
    P.aim(p.pelvis, p.chest, fx * l, 1, fz * l, 0.30 * a.strength);
    // the head rides level whatever the shoulders are doing
    P.aim(p.chest, p.head, fx * 0.04, 1, fz * 0.04, 0.34 * a.strength);

    /* Arms, by trade: a swordsman carries the blade out and low, a halberdier
       has both hands on the shaft, an archer holds the bow arm out and keeps
       the drawing hand at the chest, a mage keeps a palm forward. */
    const A = R.arms(b);
    const swing = a.swing || 0;
    for (const arm of A) {
      const main = arm.side === st.hand;
      const g = main ? st.main : st.off;
      // during a strike the weapon arm is driven separately; the off arm
      // counterweights, which is what stops a swing looking like a wave
      const counter = main ? 0 : -swing * 0.16;
      R.reachArm(b, arm,
        arm.sh.x + sx * arm.side * g.out + fx * (g.fwd + counter),
        arm.sh.y - g.drop + air * 0.008,
        arm.sh.z + sz * arm.side * g.out + fz * (g.fwd + counter), sp, dt, hintA);
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
        R.support(b, L, HIP - R.L.plant - 0.02, 60 * a.strength, dt, 1);
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
    a.fix = [0, 0];
    unplant(a);            // a body taking a blow owns nothing, least of all the floor
    wake(a);
  }

  /* ------------------------------------------------------------------ rest */

  /* A dozen ragdolls at 120 Hz is more than a phone should be asked to do for
     units that are standing perfectly still. A body that has come to rest
     under its own pose is frozen until something happens to it. */
  function settled(a, dt) {
    // Only the dead keep perfectly still. A living unit breathes and shifts
    // its weight, and freezing that to save a fraction of a millisecond is
    // what made a waiting line look like a row of furniture.
    if (a.mode !== 'dead') { a.calm = 0; a.anchor = null; return false; }
    const still = a.mode === 'pose' || a.mode === 'dead';
    if (!still || a.limp > 0 || a.path || a.strength < 0.99) { a.calm = 0; a.anchor = null; return false; }
    // A held pose never stops buzzing — the muscles are a control loop, not a
    // pose, and they hunt around the target for ever. So rest is judged by
    // whether the body has actually GONE anywhere.
    /* Never freeze a body that is standing badly. Rest is a promise that this
       pose is the one it meant to hold, and a frozen body has no way back —
       whatever shape it was in when the clock ran out is the shape it keeps
       for the rest of the battle. Checking the hips alone is not enough: a
       unit can carry the right hip height with one leg folded up in the air,
       and that is exactly the shape that kept turning up on the field. */
    const p = a.body.parts.pelvis;
    if (a.mode === 'pose') {
      const gy = surfaceTop(a);
      if (Math.abs(p.y - gy - HIP) > 0.10) { a.calm = 0; a.anchor = null; return false; }
      if (a.body.parts.head.y < a.body.parts.chest.y + 0.15) { a.calm = 0; a.anchor = null; return false; }
      for (const L of R.legs(a.body)) {
        if (L.foot.y - gy > 0.13) { a.calm = 0; a.anchor = null; return false; }
      }
    }
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

    /* A blow in four beats rather than one reach.

       Wind: the weight goes back and the weapon comes up. Drive: the lead foot
       steps in and the whole body goes with the swing — contact lands at the
       end of this beat, which is when the battle applies it. Follow: the
       weapon carries past the target instead of stopping dead on it. Recover:
       back to a stance. A single interpolation toward the target reads as
       pointing at somebody; this reads as hitting them. */
    if (a.mode === 'strike') {
      const t = a.t;
      if (t < 0.12) a.swing = (t / 0.12) * 0.28;              // wind, weapon back
      else if (t < 0.24) a.swing = 0.28 + ((t - 0.12) / 0.12) * 0.62;   // drive
      else if (t < 0.40) a.swing = 0.90 + ((t - 0.24) / 0.16) * 0.10;   // follow through
      else a.swing = Math.max(0, 1 - (t - 0.40) / 0.22);      // recover
      // the lead foot steps into it and comes back afterwards
      a.stepAt = t < 0.12 ? -0.05 * (t / 0.12)
        : t < 0.24 ? lerp(-0.05, 0.20, (t - 0.12) / 0.12)
          : t < 0.44 ? 0.20 : Math.max(0, 0.20 * (1 - (t - 0.44) / 0.20));
      a.push = a.stepAt * 0.8;
      if (t > 0.66) { a.mode = 'pose'; a.swing = 0; a.stepAt = 0; a.push = 0; }
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
      // hand back to the stance once it is upright enough for the stance to
      // finish the job — the stance can now stand itself up either way
      if ((a.restT > 0.5 && p.pelvis.y - gy > 0.55) || a.restT > 1.8) {
        a.mode = 'pose'; a.strength = 1; a.foot = [null, null];
      }
    }

    if (a.mode === 'pose' || a.mode === 'strike') {
      a.strength = clamp(a.strength + dt * 2, 0, 1);
      stand(a, dt, a.mode === 'strike' ? 0.10 + Math.sin(a.swing * Math.PI) * 0.34 : 0.08);
      if (a.mode === 'strike' && a.swingAt) {
        /* The weapon hand's path: back over the shoulder, then through where
           the target IS and out the other side. Reaching to the target and
           stopping there is a poke; going past it is a swing. */
        const st2 = stanceOf(a);
        const arm = R.arms(b)[st2.hand > 0 ? 1 : 0];
        const { fx: dx, fz: dz, sx: rx, sz: rz } = axes(a);
        const s = a.swing;
        const wind = clamp(s / 0.28, 0, 1);              // 0..1 through the wind-up
        const thru = clamp((s - 0.28) / 0.72, 0, 1);     // 0..1 through the blow
        // how far along the line to the target the hand is: negative behind
        const reach = lerp(-0.34, 1.22, thru);
        const gx = lerp(arm.sh.x, a.swingAt.pos.x, 0.55), gz = lerp(arm.sh.z, a.swingAt.pos.z, 0.55);
        const tx = arm.sh.x + (gx - arm.sh.x) * reach + rx * st2.hand * 0.22 * (1 - thru);
        const tz = arm.sh.z + (gz - arm.sh.z) * reach + rz * st2.hand * 0.22 * (1 - thru);
        const ty = arm.sh.y + wind * 0.30 - thru * 0.46;
        R.reachArm(b, arm, tx, ty, tz, 11, dt, { x: -dx, y: 0.2, z: -dz });
        // and the body goes with it: weight back on the wind, through on the blow
        const twist = (thru - wind * 0.6) * 0.30;
        P.aim(p.pelvis, p.chest, dx * twist + rx * st2.hand * 0.10 * (1 - thru), 1,
          dz * twist + rz * st2.hand * 0.10 * (1 - thru), 0.42 * a.strength);
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

    // a body owns the floor while it stands on it or walks over it, and
    // never while it is being thrown around
    if (a.mode !== 'walk' && a.mode !== 'pose' && a.mode !== 'strike') unplant(a);
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

  return { create, step, walkPath, strikeAt, takeHit, faceToward, wake, turn, unplant, STANCES,
           HIP, STANCE, SPEED, CAD, STRIDE };
})();
