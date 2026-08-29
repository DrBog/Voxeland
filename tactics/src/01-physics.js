/* KINESIS — verlet body solver, three dimensions.
   Units are SI: metres, seconds, kilograms.
     x = lateral (left/right across the deck)
     y = up
     z = forward, the direction of the run and of the camera's gaze.
   A body is point masses held by distance bones and hinge joints. Muscles
   are not springs — they are drives: a muscle asks for a velocity toward a
   target and may change the point's real velocity by at most `accel` per
   second. Weak muscles lose to gravity, which is why a hurt runner folds. */
K.phys = (function () {
  const { clamp, angDiff } = K.util;

  const GRAVITY = -11.2;      // a touch hot; reads better on a small screen
  const AIR_DAMP = 0.020;

  function Part(name, x, y, z, mass, radius) {
    return {
      name, x, y, z, px: x, py: y, pz: z,
      ax: 0, ay: 0, az: 0,
      vx0: 0, vy0: 0, vz0: 0, fx: 0, fy: 0, fz: 0,
      m: mass, im: 1 / mass, r: radius,
      grounded: false, ground: null, friction: 1, touched: false, touchedLast: false,
      impact: 0, pinned: null
    };
  }

  function Body() { return { parts: {}, list: [], bones: [], hinges: [], contacts: 0 }; }

  function add(body, name, x, y, z, mass, radius) {
    const p = Part(name, x, y, z, mass, radius);
    body.parts[name] = p; body.list.push(p);
    return p;
  }

  function bone(body, a, b, k) {
    const A = body.parts[a], B = body.parts[b];
    const len = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
    body.bones.push({ a: A, b: B, len, k: k === undefined ? 1 : k });
  }

  /* A hinge: the middle point is pulled into the plane whose normal is the
     joint axis, and the bend angle is clamped. Knees and elbows therefore
     fold one way, on one plane, however hard the body lands. */
  function hinge(body, a, b, c, axis, min, max) {
    body.hinges.push({ a: body.parts[a], b: body.parts[b], c: body.parts[c], axis, min, max });
  }

  function integrate(body, dt, gscale) {
    const g = GRAVITY * (gscale === undefined ? 1 : gscale);
    for (const p of body.list) {
      // NB: contact flags are cleared in collide(), not here — the behaviour
      // layer runs between the two and has to be able to see the last plant
      p.touchedLast = p.touched; p.touched = false;
      if (p.pinned) {
        p.px = p.x = p.pinned.x; p.py = p.y = p.pinned.y; p.pz = p.z = p.pinned.z;
        p.ax = p.ay = p.az = 0; p.vx0 = p.vy0 = p.vz0 = 0;
        continue;
      }
      p.vx0 = (p.x - p.px) / dt; p.vy0 = (p.y - p.py) / dt; p.vz0 = (p.z - p.pz) / dt;
      // Constraint solving turns position corrections into velocity, and at
      // 180 Hz a millimetre reads as metres per second. Impacts are judged on
      // a short moving average instead, which noise cannot fake but a real
      // arrival sustains.
      p.fx += (p.vx0 - p.fx) * 0.22; p.fy += (p.vy0 - p.fy) * 0.22; p.fz += (p.vz0 - p.fz) * 0.22;
      let vx = p.x - p.px, vy = p.y - p.py, vz = p.z - p.pz;
      const sp = Math.hypot(vx, vy, vz) / dt;
      const drag = Math.max(0.5, 1 - AIR_DAMP * sp * dt);
      vx *= drag; vy *= drag; vz *= drag;
      const nx = p.x + vx + p.ax * dt * dt;
      const ny = p.y + vy + (p.ay + g) * dt * dt;
      const nz = p.z + vz + p.az * dt * dt;
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.x = nx; p.y = ny; p.z = nz;
      p.ax = p.ay = p.az = 0;
    }
  }

  function solveBones(body) {
    for (const c of body.bones) {
      const a = c.a, b = c.b;
      let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      let d = Math.hypot(dx, dy, dz);
      if (d < 1e-6) { d = 1e-6; dx = 1e-6; }
      const diff = (d - c.len) / d * c.k;
      const wa = a.pinned ? 0 : a.im, wb = b.pinned ? 0 : b.im;
      const w = wa + wb; if (w === 0) continue;
      const fa = diff * (wa / w), fb = diff * (wb / w);
      a.x += dx * fa; a.y += dy * fa; a.z += dz * fa;
      b.x -= dx * fb; b.y -= dy * fb; b.z -= dz * fb;
    }
  }

  /* rotate p around pivot, about unit axis k, by angle t (Rodrigues).
     `quiet` rotates the previous position too, so the correction moves the
     point without inventing velocity. Joint limits must be quiet — they are
     structure, not muscle — or the skeleton pumps itself into orbit. */
  function spin(p, piv, kx, ky, kz, t, quiet) {
    const c = Math.cos(t), s = Math.sin(t);
    const dot0 = kx * (p.x - piv.x) + ky * (p.y - piv.y) + kz * (p.z - piv.z);
    const dx = p.x - piv.x, dy = p.y - piv.y, dz = p.z - piv.z;
    const cx = ky * dz - kz * dy, cy = kz * dx - kx * dz, cz = kx * dy - ky * dx;
    p.x = piv.x + dx * c + cx * s + kx * dot0 * (1 - c);
    p.y = piv.y + dy * c + cy * s + ky * dot0 * (1 - c);
    p.z = piv.z + dz * c + cz * s + kz * dot0 * (1 - c);
    if (quiet) {
      const qx = p.px - piv.x, qy = p.py - piv.y, qz = p.pz - piv.z;
      const qdot = kx * qx + ky * qy + kz * qz;
      const ax = ky * qz - kz * qy, ay = kz * qx - kx * qz, az = kx * qy - ky * qx;
      p.px = piv.x + qx * c + ax * s + kx * qdot * (1 - c);
      p.py = piv.y + qy * c + ay * s + ky * qdot * (1 - c);
      p.pz = piv.z + qz * c + az * s + kz * qdot * (1 - c);
    }
  }

  function bendAngle(a, b, c) {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    return Math.atan2(Math.hypot(cx, cy, cz), ux * vx + uy * vy + uz * vz);
  }

  /* push the a-b-c bend toward `target` radians, strength 0..1 */
  function torque(a, b, c, target, strength, quiet) {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-7) return;
    nx /= nl; ny /= nl; nz /= nl;
    const cur = Math.atan2(nl, ux * vx + uy * vy + uz * vz);
    const err = (target - cur) * clamp(strength, 0, 1);
    if (Math.abs(err) < 1e-5) return;
    const wa = a.pinned ? 0 : a.im, wc = c.pinned ? 0 : c.im;
    const w = wa + wc; if (w === 0) return;
    spin(a, b, nx, ny, nz, err * (wa / w), quiet);
    spin(c, b, nx, ny, nz, -err * (wc / w), quiet);
  }

  /* Swing the segment a->b toward a target direction (unit vector).
     The pivot is the segment's centre of mass, so the rotation is a torque
     rather than a shove. It is still allowed to do work — it is a muscle —
     and free flight is kept honest by ballistic(), below. */
  function aim(a, b, tx, ty, tz, strength) {
    let ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const ul = Math.hypot(ux, uy, uz); if (ul < 1e-7) return;
    ux /= ul; uy /= ul; uz /= ul;
    let nx = uy * tz - uz * ty, ny = uz * tx - ux * tz, nz = ux * ty - uy * tx;
    const nl = Math.hypot(nx, ny, nz);
    const dot = clamp(ux * tx + uy * ty + uz * tz, -1, 1);
    const ang = Math.atan2(nl, dot) * clamp(strength, 0, 1);
    if (nl < 1e-7 || Math.abs(ang) < 1e-5) return;
    nx /= nl; ny /= nl; nz /= nl;
    const wa = a.pinned ? 0 : a.im, wb = b.pinned ? 0 : b.im;
    const w = wa + wb; if (w === 0) return;
    const piv = {
      x: (a.x * wb + b.x * wa) / w, y: (a.y * wb + b.y * wa) / w, z: (a.z * wb + b.z * wa) / w
    };
    spin(a, piv, nx, ny, nz, ang);
    spin(b, piv, nx, ny, nz, ang);
  }

  function solveHinges(body, frame) {
    for (const h of body.hinges) {
      const a = h.a, b = h.b, c = h.c;
      // 1. hold the joint on its plane. A pinned point is world geometry and
      // no constraint may move it — the ankle hinge has the FOOT as its middle
      // joint, so without this guard a planted foot creeps out from under the
      // body a millimetre a frame, which at walking pace is a skate.
      if (!b.pinned) {
        const ax = h.axis === 'lat' ? frame.rx : 0;
        const ay = h.axis === 'lat' ? frame.ry : 1;
        const az = h.axis === 'lat' ? frame.rz : 0;
        const mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2, mz = (a.z + c.z) / 2;
        const dx = b.x - mx, dy = b.y - my, dz = b.z - mz;
        const comp = dx * ax + dy * ay + dz * az;
        const k = 0.35;
        b.x -= ax * comp * k; b.y -= ay * comp * k; b.z -= az * comp * k;
        b.px -= ax * comp * k; b.py -= ay * comp * k; b.pz -= az * comp * k;
      }
      // 2. clamp the fold, quietly
      const cur = bendAngle(a, b, c);
      if (cur < h.min) torque(a, b, c, h.min, 0.6, true);
      else if (cur > h.max) torque(a, b, c, h.max, 0.6, true);
    }
  }

  /* put every pinned point back exactly where it was pinned: cheap insurance
     that no solver pass has quietly dragged the floor out from under a foot */
  function holdPins(body) {
    for (const p of body.list) {
      if (!p.pinned) continue;
      p.x = p.px = p.pinned.x; p.y = p.py = p.pinned.y; p.z = p.pz = p.pinned.z;
    }
  }

  function drive(p, tx, ty, tz, maxSpeed, dt, accel) {
    if (p.pinned) return 0;
    const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-5) return 0;
    const want = Math.min(maxSpeed, d / 0.05);
    const k = want / d;
    let ddx = dx * k - (p.x - p.px) / dt;
    let ddy = dy * k - (p.y - p.py) / dt;
    let ddz = dz * k - (p.z - p.pz) / dt;
    const dd = Math.hypot(ddx, ddy, ddz);
    const cap = (accel === undefined ? maxSpeed * 16 : accel) * dt;
    if (dd > cap) { const s = cap / dd; ddx *= s; ddy *= s; ddz *= s; }
    p.px -= ddx * dt; p.py -= ddy * dt; p.pz -= ddz * dt;
    return d;
  }

  function addVel(p, vx, vy, vz, dt) { p.px -= vx * dt; p.py -= vy * dt; p.pz -= vz * dt; }
  function vel(p, dt) { return { x: (p.x - p.px) / dt, y: (p.y - p.py) / dt, z: (p.z - p.pz) / dt }; }

  function collide(body, level, dt) {
    body.contacts = 0;
    for (const p of body.list) {
      p.grounded = false; p.ground = null;
      if (p.pinned) continue;
      const boxes = level.solidsNear(p.z, p.r + 0.6);
      for (const b of boxes) {
        // A foot resting a few millimetres proud of a deck is standing on it.
        // Without this skin, contact flickers on and off at 180 Hz and the
        // support leg spends half its life believing it is in mid-air.
        if (p.x > b.x0 - p.r && p.x < b.x1 + p.r && p.z > b.z0 - p.r && p.z < b.z1 + p.r) {
          const gap = p.y - (b.y1 + p.r);
          if (gap >= 0 && gap < 0.035) {
            p.grounded = true; p.ground = b; p.touched = true; body.contacts++;
            continue;
          }
        }
        if (p.x < b.x0 - p.r || p.x > b.x1 + p.r) continue;
        if (p.y < b.y0 - p.r || p.y > b.y1 + p.r) continue;
        if (p.z < b.z0 - p.r || p.z > b.z1 + p.r) continue;
        const dTop = (b.y1 + p.r) - p.y, dBot = p.y - (b.y0 - p.r);
        const dL = p.x - (b.x0 - p.r), dR = (b.x1 + p.r) - p.x;
        const dB = p.z - (b.z0 - p.r), dF = (b.z1 + p.r) - p.z;
        const m = Math.min(dTop, dBot, dL, dR, dB, dF);
        let nx = 0, ny = 0, nz = 0;
        if (m === dTop) ny = 1; else if (m === dBot) ny = -1;
        else if (m === dL) nx = -1; else if (m === dR) nx = 1;
        else if (m === dB) nz = -1; else nz = 1;

        let vx = (p.x - p.px) / dt, vy = (p.y - p.py) / dt, vz = (p.z - p.pz) / dt;
        // an impact is an arrival, not a resting load: a part already in
        // contact last step is leaning, not hitting
        const vn0 = p.fx * nx + p.fy * ny + p.fz * nz;
        if (!p.touchedLast && vn0 < -1 && -vn0 > p.impact) p.impact = -vn0;
        p.touched = true;

        // Push out of the surface WITHOUT inventing velocity: in Verlet a
        // bare position correction is read as motion, and at 180 Hz a five
        // centimetre depenetration reads as nine metres per second — which is
        // how a runner who clipped a crate ended up eleven metres in the air.
        // The velocity response is applied separately, just below.
        p.x += nx * m; p.y += ny * m; p.z += nz * m;
        p.px += nx * m; p.py += ny * m; p.pz += nz * m;
        const vn = vx * nx + vy * ny + vz * nz;
        if (vn < 0) { vx -= nx * vn; vy -= ny * vn; vz -= nz * vn; }
        // coulomb-ish friction: a fixed tangential deceleration, so glass is
        // genuinely glass and a dry deck genuinely holds a plant
        // friction follows the normal: a foot on a deck grips, a shoulder
        // scraping a vertical face does not hang there like velcro
        const grip = ny > 0.3 ? 1 : 0.08;
        const mu = (b.friction === undefined ? 1 : b.friction) * p.friction * grip;
        const vt = Math.hypot(vx, vy, vz);
        if (vt > 1e-6) {
          const fr = mu * 55 * dt;
          const s = vt <= fr ? 0 : (vt - fr) / vt;
          vx *= s; vy *= s; vz *= s;
        }
        p.px = p.x - vx * dt; p.py = p.y - vy * dt; p.pz = p.z - vz * dt;
        // touching a wall is still touching something; only an upward normal
        // counts as standing on it
        body.contacts++;
        if (ny > 0) { p.grounded = true; p.ground = b; }
      }
      // last-resort sanity clamp, so a bad frame cannot fling the body away
      const sp2 = Math.hypot(p.x - p.px, p.y - p.py, p.z - p.pz) / dt;
      if (sp2 > 34) {
        const k = 34 / sp2;
        p.px = p.x - (p.x - p.px) * k; p.py = p.y - (p.y - p.py) * k; p.pz = p.z - (p.z - p.pz) * k;
      }
    }
  }

  /* With nothing in contact there are no external forces but gravity, so the
     centre of mass MUST follow a parabola no matter what the limbs are doing.
     Muscle work inside a free body can move its parts and its orientation; it
     cannot move its centre of mass. Enforcing that literally is what stops a
     ragdoll swimming through the air, which is otherwise very hard to prevent
     when every muscle is a position correction. */
  function ballistic(body, dt, v0, extraX, extraZ) {
    let vx = 0, vy = 0, vz = 0, m = 0;
    for (const p of body.list) {
      vx += (p.x - p.px) / dt * p.m; vy += (p.y - p.py) / dt * p.m; vz += (p.z - p.pz) / dt * p.m;
      m += p.m;
    }
    vx /= m; vy /= m; vz /= m;
    const wantX = v0.x + (extraX || 0) * dt;
    const wantY = v0.y + GRAVITY * dt;
    const wantZ = v0.z + (extraZ || 0) * dt;
    const dx = (wantX - vx) * dt, dy = (wantY - vy) * dt, dz = (wantZ - vz) * dt;
    for (const p of body.list) { p.px -= dx; p.py -= dy; p.pz -= dz; }
  }

  function com(body) {
    let x = 0, y = 0, z = 0, m = 0;
    for (const p of body.list) { x += p.x * p.m; y += p.y * p.m; z += p.z * p.m; m += p.m; }
    return { x: x / m, y: y / m, z: z / m, m };
  }

  function comVel(body, dt) {
    let x = 0, y = 0, z = 0, m = 0;
    for (const p of body.list) {
      x += (p.x - p.px) / dt * p.m; y += (p.y - p.py) / dt * p.m; z += (p.z - p.pz) / dt * p.m; m += p.m;
    }
    return { x: x / m, y: y / m, z: z / m };
  }

  /* two-link IK. `hint` biases which way the knee or elbow breaks. */
  function ik(rx, ry, rz, tx, ty, tz, l1, l2, hx, hy, hz) {
    let dx = tx - rx, dy = ty - ry, dz = tz - rz;
    let d = Math.hypot(dx, dy, dz);
    const maxd = (l1 + l2) * 0.998, mind = Math.abs(l1 - l2) + 1e-3;
    if (d > maxd) { const s = maxd / d; dx *= s; dy *= s; dz *= s; d = maxd; }
    if (d < mind) { const s = mind / (d || 1e-6); dx *= s; dy *= s; dz *= s; d = mind; }
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    // hint, perpendicular to the limb line
    const hd = hx * ux + hy * uy + hz * uz;
    let px = hx - ux * hd, py = hy - uy * hd, pz = hz - uz * hd;
    let pl = Math.hypot(px, py, pz);
    if (pl < 1e-5) {
      // The hint was parallel to the limb, so it says nothing about which way
      // the joint should break. Fall back to something stable — up crossed
      // with the limb — rather than an arbitrary perpendicular that flips sign
      // as the limb swings, which makes a knee flap instead of bend.
      px = uz * 1 - uy * 0; py = 0; pz = -ux * 1;
      pl = Math.hypot(px, py, pz);
      if (pl < 1e-5) { px = 1; py = 0; pz = 0; pl = 1; }
    }
    px /= pl; py /= pl; pz /= pl;
    return {
      jx: rx + ux * a + px * h, jy: ry + uy * a + py * h, jz: rz + uz * a + pz * h,
      ex: rx + dx, ey: ry + dy, ez: rz + dz
    };
  }

  return {
    GRAVITY, Body, add, bone, hinge, integrate, solveBones, solveHinges,
    torque, aim, bendAngle, drive, collide, ballistic, com, comVel, ik, vel, addVel, spin, holdPins
  };
})();
