/* KINESIS — the view.
   A small software 3D renderer: perspective projection, near-plane clipping,
   painter's sort, fog. No library, no WebGL — the scene is a few dozen boxes
   and one body, and canvas2d draws that comfortably at 60 on a phone.
   Canvas draws the world only; every readable character is DOM. */
K.render = (function () {
  const U = K.util;
  const { clamp, lerp } = U;

  const NEAR = 0.28;
  const FOG_NEAR = 10, FOG_FAR = 78;

  function hash(i) {
    let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function css(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : a) + ')';
  }

  function View(canvas) {
    return {
      canvas, ctx: canvas.getContext('2d'), w: 0, h: 0, dpr: 1,
      f: 500, items: [], poly: []
    };
  }

  function resize(v) {
    const r = v.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.2);
    v.w = r.width; v.h = r.height; v.dpr = dpr;
    v.canvas.width = Math.max(1, Math.round(r.width * dpr));
    v.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  /* ---------------------------------------------------------------- camera */

  function setCamera(v, cam, shakeX, shakeY) {
    let fx = cam.tx - cam.x, fy = cam.ty - cam.y, fz = cam.tz - cam.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    // right = fwd x worldUp = (fx,fy,fz) x (0,1,0)
    let rx = -fz, ry = 0, rz = fx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    // up = right x fwd
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    const fovY = 1.06 / (cam.fov || 1);
    v.f = (v.h * 0.5) / Math.tan(fovY * 0.5);
    v.cam = { x: cam.x, y: cam.y, z: cam.z, fx, fy, fz, rx, ry, rz, ux, uy, uz, sx: shakeX, sy: shakeY };
    // horizon: where a world-forward ray vanishes
    const dz = { x: 0, y: 0, z: 1 };
    const dfwd = dz.z * fz + dz.y * fy + dz.x * fx;
    const dup = dz.z * uz + dz.y * uy + dz.x * ux;
    v.horizonY = dfwd > 0.01 ? v.h / 2 - v.f * (dup / dfwd) : v.h * 0.35;
  }

  function proj(v, x, y, z) {
    const c = v.cam;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const cz = dx * c.fx + dy * c.fy + dz * c.fz;
    const cx = dx * c.rx + dy * c.ry + dz * c.rz;
    const cy = dx * c.ux + dy * c.uy + dz * c.uz;
    return { cx, cy, cz };
  }
  function toScreen(v, p) {
    const s = v.f / p.cz;
    return { x: v.w / 2 + p.cx * s + v.cam.sx, y: v.h / 2 - p.cy * s + v.cam.sy, s, z: p.cz };
  }

  /* clip a polygon of camera-space points against the near plane */
  function clipNear(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ain = a.cz > NEAR, bin = b.cz > NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (NEAR - a.cz) / (b.cz - a.cz);
        out.push({ cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t, cz: NEAR });
      }
    }
    return out;
  }

  function fillPoly(v, ctx, camPts, style, stroke) {
    const pts = clipNear(camPts);
    if (pts.length < 3) return;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const s = toScreen(v, pts[i]);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  /* --------------------------------------------------------------- scene */

  const FACES = [
    { i: [4, 5, 6, 7], n: [0, 1, 0], k: 1.00 },     // top
    { i: [0, 3, 2, 1], n: [0, -1, 0], k: 0.28 },    // bottom
    { i: [0, 1, 5, 4], n: [0, 0, -1], k: 0.80 },    // near face (-z)
    { i: [2, 3, 7, 6], n: [0, 0, 1], k: 0.46 },     // far face (+z)
    { i: [3, 0, 4, 7], n: [-1, 0, 0], k: 0.60 },    // -x
    { i: [1, 2, 6, 5], n: [1, 0, 0], k: 0.66 }      // +x
  ];

  function boxItem(v, g, b, base, opts) {
    opts = opts || {};
    const c = v.cam;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
    const depth = (cx - c.x) * c.fx + (cy - c.y) * c.fy + (cz - c.z) * c.fz;
    if (depth < -14 || depth > FOG_FAR + 40) return;
    const corners = [
      [b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x1, b.y0, b.z1], [b.x0, b.y0, b.z1],
      [b.x0, b.y1, b.z0], [b.x1, b.y1, b.z0], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]
    ].map(p => proj(v, p[0], p[1], p[2]));
    const fogT = clamp((depth - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1);
    v.items.push({
      z: depth,
      draw: (ctx) => {
        for (const F of FACES) {
          // visible if the face normal points back toward the camera
          const p0 = [b.x0, b.y0, b.z0], p1 = [b.x1, b.y1, b.z1];
          const fx = F.n[0] > 0 ? p1[0] : F.n[0] < 0 ? p0[0] : (p0[0] + p1[0]) / 2;
          const fy = F.n[1] > 0 ? p1[1] : F.n[1] < 0 ? p0[1] : (p0[1] + p1[1]) / 2;
          const fz = F.n[2] > 0 ? p1[2] : F.n[2] < 0 ? p0[2] : (p0[2] + p1[2]) / 2;
          const vx = fx - c.x, vy = fy - c.y, vz = fz - c.z;
          if (vx * F.n[0] + vy * F.n[1] + vz * F.n[2] > 0) continue;
          const shade = mix(base, [0, 0, 0], 1 - F.k);
          const col = mix(shade, v.fog, fogT * 0.92);
          fillPoly(v, ctx, F.i.map(i => corners[i]), css(col, opts.alpha === undefined ? 1 : opts.alpha));
        }
        if (opts.edge) {
          const col = mix(rgb(opts.edge), v.fog, fogT);
          const top = [corners[4], corners[5], corners[6], corners[7]];
          const pts = clipNear(top);
          if (pts.length >= 3) {
            ctx.beginPath();
            for (let i = 0; i < pts.length; i++) {
              const s = toScreen(v, pts[i]);
              if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
            }
            ctx.closePath();
            ctx.strokeStyle = css(col, 0.5 * (1 - fogT * 0.7));
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }
        }
      }
    });
  }

  const KIND_COL = {
    deck: '#3a3f52', gatepad: '#4a4152', ledgepad: '#3d4356', glass: '#37545e',
    crate: '#6a5136', vent: '#4e5464', wall: '#5a4046', bar: '#8a8f9c',
    step: '#454b60', block: '#555b70', gatewall: '#5b4a58'
  };

  function drawScene(v, g) {
    const lv = g.level, D = g.district;
    const build = rgb(D.build);
    const camZ = g.cam.z;

    for (const t of lv.towers) {
      if (t.z1 < camZ - 20 || t.z0 > camZ + FOG_FAR + 30) continue;
      const shade = 0.55 + hash((t.seed * 9871) | 0) * 0.5;
      boxItem(v, g, t, mix(build, [255, 255, 255], 0.06 * shade), { tower: true });
      // a few lit windows on the face that looks at the deck
      const depth = (t.z0 - g.cam.z);
      if (depth > 0 && depth < 46 && t.lit > 0.35) {
        v.items.push({
          z: depth - 0.05,
          draw: (ctx) => {
            const face = t.x1 < 0 ? t.x1 : t.x0;
            const rows = Math.min(10, Math.floor((t.y1 - t.y0) / 1.6));
            const fogT = clamp((depth - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1);
            for (let r = 0; r < rows; r++) {
              for (let cN = 0; cN < 2; cN++) {
                const hh = hash((t.seed * 733 + r * 31 + cN * 7) | 0);
                if (hh < 0.62) continue;
                const y = t.y0 + 1.0 + r * 1.6;
                const z = t.z0 + 0.6 + cN * (t.z1 - t.z0 - 1.2);
                const p = proj(v, face, y, z);
                if (p.cz < NEAR) continue;
                const s = toScreen(v, p);
                const w = Math.max(1, 0.6 * s.s), h2 = Math.max(1, 0.9 * s.s);
                ctx.fillStyle = css(mix(hh > 0.95 ? [255, 228, 176] : rgb(D.accent), v.fog, fogT * 0.9), 0.55 * (1 - fogT));
                ctx.fillRect(s.x - w / 2, s.y - h2 / 2, w, h2);
              }
            }
          }
        });
      }
    }

    for (const b of lv.boxes) {
      if (b.z1 < camZ - 14 || b.z0 > camZ + FOG_FAR + 20) continue;
      const isDeck = b.kind === 'deck' || b.kind === 'gatepad' || b.kind === 'glass' || b.kind === 'ledgepad';
      const col = rgb(KIND_COL[b.kind] || '#4a5064');
      const tinted = mix(col, rgb(D.accent), isDeck ? 0.06 : 0.12);
      boxItem(v, g, b, tinted, { edge: isDeck ? D.accent : null });
      if (isDeck) deckMarks(v, g, b, D);
    }

    for (const p of lv.props) {
      if (p.z < camZ - 8 || p.z > camZ + FOG_FAR) continue;
      propItem(v, g, p, D);
    }

    for (const m of lv.gatesHit) {
      if (m.entryZ < camZ - 8 || m.entryZ > camZ + FOG_FAR + 20) continue;
      gateItem(v, g, m, D);
    }
  }

  /* transverse rungs on the deck: the cheapest, strongest speed cue there is */
  function deckMarks(v, g, b, D) {
    const camZ = g.cam.z;
    const start = Math.ceil(Math.max(b.z0, camZ - 4) / 2) * 2;
    const acc = rgb(D.accent);
    for (let z = start; z < Math.min(b.z1, camZ + 62); z += 2) {
      const depth = z - camZ;
      const fogT = clamp((depth - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1);
      const major = Math.abs(z % 25) < 1;
      v.items.push({
        z: depth - 0.02,
        draw: (ctx) => {
          const a = proj(v, b.x0 + 0.12, b.y1 + 0.005, z);
          const c2 = proj(v, b.x1 - 0.12, b.y1 + 0.005, z);
          if (a.cz < NEAR && c2.cz < NEAR) return;
          const pts = clipNear([a, c2, { cx: c2.cx, cy: c2.cy, cz: c2.cz + 0.001 }]);
          if (pts.length < 2) return;
          const s0 = toScreen(v, pts[0]), s1 = toScreen(v, pts[1]);
          ctx.strokeStyle = css(mix(acc, v.fog, fogT), (major ? 0.34 : 0.13) * (1 - fogT * 0.8));
          ctx.lineWidth = major ? 2 : 1;
          ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
        }
      });
    }
  }

  function propItem(v, g, p, D) {
    const depth = p.z - g.cam.z;
    const fogT = clamp((depth - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1);
    v.items.push({
      z: depth,
      draw: (ctx) => {
        if (p.kind === 'antenna') {
          const a = proj(v, p.x, p.y, p.z), b = proj(v, p.x, p.y + 1.8 * p.s, p.z);
          if (a.cz < NEAR || b.cz < NEAR) return;
          const s0 = toScreen(v, a), s1 = toScreen(v, b);
          ctx.strokeStyle = css(mix([26, 30, 40], v.fog, fogT), 0.9);
          ctx.lineWidth = Math.max(1, 0.05 * s0.s);
          ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
          ctx.fillStyle = 'rgba(255,90,90,' + (0.35 + 0.4 * Math.sin(g.runTime * 3 + p.seed * 10)) + ')';
          ctx.beginPath(); ctx.arc(s1.x, s1.y, Math.max(1, 0.07 * s1.s), 0, 7); ctx.fill();
        } else if (p.kind === 'lamp') {
          const a = proj(v, p.x, p.y, p.z), b = proj(v, p.x, p.y + 2.4, p.z);
          if (a.cz < NEAR || b.cz < NEAR) return;
          const s0 = toScreen(v, a), s1 = toScreen(v, b);
          ctx.strokeStyle = css(mix([30, 34, 44], v.fog, fogT), 0.9);
          ctx.lineWidth = Math.max(1, 0.06 * s0.s);
          ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
          const gl = ctx.createRadialGradient(s1.x, s1.y, 0, s1.x, s1.y, Math.max(4, 1.6 * s1.s));
          gl.addColorStop(0, css(rgb(D.accent), 0.55 * (1 - fogT)));
          gl.addColorStop(1, css(rgb(D.accent), 0));
          ctx.fillStyle = gl;
          ctx.beginPath(); ctx.arc(s1.x, s1.y, Math.max(4, 1.6 * s1.s), 0, 7); ctx.fill();
        } else if (p.kind === 'sign') {
          const w = 0.9 * p.s, h = 1.5 * p.s;
          const pts = [
            proj(v, p.x, p.y + 1.0, p.z - w / 2), proj(v, p.x, p.y + 1.0 + h, p.z - w / 2),
            proj(v, p.x, p.y + 1.0 + h, p.z + w / 2), proj(v, p.x, p.y + 1.0, p.z + w / 2)
          ];
          fillPoly(v, ctx, pts, css(mix(rgb(D.accent), v.fog, fogT), 0.22 + 0.12 * Math.sin(g.runTime * 2 + p.seed * 8)));
        }
      }
    });
  }

  function gateItem(v, g, m, D) {
    const depth = m.entryZ - g.cam.z;
    const col = m.done ? '#8affc0' : m.met ? D.accent : '#ff6b6b';
    const half = K.world.HALF + 0.4;
    v.items.push({
      z: depth,
      draw: (ctx) => {
        const fogT = clamp((depth - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1);
        const c = rgb(col);
        // two posts and a beam across the deck
        for (const sx of [-half, half]) {
          const a = proj(v, sx, m.top, m.entryZ), b = proj(v, sx, m.top + 3.6, m.entryZ);
          if (a.cz < NEAR || b.cz < NEAR) continue;
          const s0 = toScreen(v, a), s1 = toScreen(v, b);
          ctx.strokeStyle = css(mix(c, v.fog, fogT), 0.75);
          ctx.lineWidth = Math.max(1.5, 0.12 * s0.s);
          ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
        }
        const l = proj(v, -half, m.top + 3.4, m.entryZ), r = proj(v, half, m.top + 3.4, m.entryZ);
        if (l.cz > NEAR && r.cz > NEAR) {
          const s0 = toScreen(v, l), s1 = toScreen(v, r);
          ctx.strokeStyle = css(mix(c, v.fog, fogT), 0.85);
          ctx.lineWidth = Math.max(2, 0.16 * s0.s);
          ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
          // name and requirement, hung on the beam
          const mid = proj(v, 0, m.top + 2.85, m.entryZ);
          if (mid.cz > NEAR && mid.cz < 60) {
            const s = toScreen(v, mid);
            const size = clamp(0.42 * s.s, 7, 30);
            ctx.textAlign = 'center';
            ctx.font = '600 ' + size.toFixed(0) + 'px ui-monospace, Menlo, monospace';
            ctx.fillStyle = css(mix(c, v.fog, fogT), 0.95 * (1 - fogT * 0.7));
            ctx.fillText(m.gate.name, s.x, s.y);
            ctx.font = '500 ' + (size * 0.62).toFixed(0) + 'px ui-monospace, Menlo, monospace';
            ctx.fillStyle = css(mix([230, 235, 246], v.fog, fogT), 0.6 * (1 - fogT * 0.7));
            const req = m.gate.stat === 'all' ? 'ALL ' + m.gate.need : m.gate.stat.toUpperCase() + ' ' + m.gate.need;
            ctx.fillText(m.done ? 'CLEARED' : req, s.x, s.y + size * 0.9);
            ctx.textAlign = 'left';
          }
        }
      }
    });
  }

  /* ---------------------------------------------------------------- body */

  const LIMBS = [
    ['hipL', 'kneeL', 0.092, 0], ['kneeL', 'footL', 0.075, 0], ['footL', 'toeL', 0.062, 0],
    ['hipR', 'kneeR', 0.092, 0], ['kneeR', 'footR', 0.075, 0], ['footR', 'toeR', 0.062, 0],
    ['shL', 'elbowL', 0.062, 0], ['elbowL', 'handL', 0.052, 0],
    ['shR', 'elbowR', 0.062, 0], ['elbowR', 'handR', 0.052, 0],
    ['hipL', 'hipR', 0.085, 1], ['shL', 'shR', 0.095, 1],
    ['pelvis', 'chest', 0.125, 1], ['chest', 'head', 0.068, 1]
  ];

  function drawBody(v, ctx, g, alpha, tint) {
    const b = g.body, c = g.ctrl, P = b.parts;
    const hurt = 1 - c.consciousness;
    const skin = tint || [246 - hurt * 26, 236 - hurt * 70, 220 - hurt * 92];
    const segs = [];
    for (const [a, d, w, core] of LIMBS) {
      const pa = proj(v, P[a].x, P[a].y, P[a].z), pb = proj(v, P[d].x, P[d].y, P[d].z);
      if (pa.cz < NEAR || pb.cz < NEAR) continue;
      segs.push({ z: (pa.cz + pb.cz) / 2, a: toScreen(v, pa), b: toScreen(v, pb), w, core });
    }
    segs.sort((p, q) => q.z - p.z);
    ctx.lineCap = 'round';
    // each part is outlined before it is filled, so overlapping limbs stay
    // legible from behind instead of merging into one silhouette
    for (const s of segs) {
      const dark = clamp((s.z - 3) / 9, 0, 0.4);
      const w = Math.max(1.4, s.w * 2 * s.a.s);
      if (!tint) {
        ctx.strokeStyle = 'rgba(9,8,14,' + (0.85 * alpha) + ')';
        ctx.lineWidth = w + Math.max(1.6, w * 0.34);
        ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
      }
      ctx.strokeStyle = css(mix(skin, [30, 26, 38], dark * 0.7 + (s.core ? 0 : 0.09)), alpha);
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
    }
    const hp = proj(v, P.head.x, P.head.y, P.head.z);
    if (hp.cz > NEAR) {
      const s = toScreen(v, hp);
      const r = Math.max(2, 0.125 * s.s);
      if (!tint) {
        ctx.fillStyle = 'rgba(9,8,14,' + (0.85 * alpha) + ')';
        ctx.beginPath(); ctx.arc(s.x, s.y, r + Math.max(1.6, r * 0.22), 0, 7); ctx.fill();
      }
      ctx.fillStyle = css(skin, alpha);
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 7); ctx.fill();
      // a warm edge on the shoulders and skull picks the figure off the deck
      if (!tint) {
        ctx.strokeStyle = css(mix(rgb(g.district.accent), [255, 255, 255], 0.35), 0.5 * alpha);
        ctx.lineWidth = Math.max(1, r * 0.22);
        ctx.beginPath(); ctx.arc(s.x, s.y, r, -2.5, -0.4); ctx.stroke();
      }
    }
  }

  function bodyShadow(v, ctx, g) {
    const b = g.body, lv = g.level;
    const pel = b.parts.pelvis;
    const gr = lv.groundAt(pel.x, pel.z, pel.y + 0.4);
    if (!gr) return;
    const p = proj(v, pel.x, gr.y + 0.02, pel.z);
    if (p.cz < NEAR) return;
    const s = toScreen(v, p);
    const height = clamp(pel.y - gr.y, 0, 4);
    const a = clamp(0.34 - height * 0.06, 0.04, 0.34);
    const rx = (0.42 + height * 0.10) * s.s, ry = rx * 0.42;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, rx, ry, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  /* --------------------------------------------------------------- frame */

  function frame(v, g, t) {
    const ctx = v.ctx;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    const D = g.district || K.world.DISTRICTS[0];
    v.fog = rgb(D.sky[2]);

    const shake = g.cam.shake;
    setCamera(v, g.cam, (Math.random() - 0.5) * shake * 10, (Math.random() - 0.5) * shake * 10);

    // sky, anchored to the horizon so pitching the camera feels right
    const hy = clamp(v.horizonY, -v.h, v.h * 1.6);
    const sky = ctx.createLinearGradient(0, hy - v.h * 1.1, 0, hy + v.h * 0.55);
    sky.addColorStop(0, D.sky[0]);
    sky.addColorStop(0.55, D.sky[1]);
    sky.addColorStop(0.86, D.sky[2]);
    sky.addColorStop(1, D.sky[3]);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, v.w, v.h);

    ctx.save();
    for (let i = 0; i < 70; i++) {
      const sx = hash(i * 7 + 1) * v.w;
      const sy = hash(i * 13 + 3) * Math.max(10, hy) * 0.9;
      const a = (1 - sy / Math.max(1, hy)) * 0.5 * hash(i * 3 + 9);
      ctx.globalAlpha = clamp(a * (0.6 + 0.4 * Math.sin(t * 1.5 + i)), 0, 0.55);
      ctx.fillStyle = '#dfe8ff';
      ctx.fillRect(sx, sy, 1.4, 1.4);
    }
    ctx.restore();

    // below the horizon is the city, not more sky: a tight glow band on the
    // skyline, then everything under it falls away into the dark
    const band = ctx.createLinearGradient(0, hy - v.h * 0.12, 0, hy + v.h * 0.10);
    band.addColorStop(0, css(v.fog, 0));
    band.addColorStop(0.55, css(rgb(D.sky[3]), 0.55));
    band.addColorStop(1, css(v.fog, 0));
    ctx.fillStyle = band;
    ctx.fillRect(0, hy - v.h * 0.12, v.w, v.h * 0.22);
    const deep = ctx.createLinearGradient(0, hy, 0, v.h);
    deep.addColorStop(0, css(mix(v.fog, [4, 5, 10], 0.55), 0.9));
    deep.addColorStop(0.45, css(mix(v.fog, [3, 4, 8], 0.86), 0.98));
    deep.addColorStop(1, 'rgba(3,4,8,1)');
    ctx.fillStyle = deep;
    ctx.fillRect(0, hy, v.w, v.h - hy);

    // ---- collect and paint the world
    v.items.length = 0;
    drawScene(v, g);

    const pel = g.body.parts.pelvis;
    const pd = proj(v, pel.x, pel.y, pel.z).cz;
    v.items.push({
      z: pd,
      draw: (ctx2) => {
        bodyShadow(v, ctx2, g);
        for (const gh of g.ghosts) {
          const a = (1 - gh.t / 0.28) * 0.16;
          ctx2.globalAlpha = a;
          ctx2.fillStyle = D.accent;
          for (const pt of gh.pts) {
            const p = proj(v, pt.x, pt.y, pt.z);
            if (p.cz < NEAR) continue;
            const s = toScreen(v, p);
            ctx2.beginPath(); ctx2.arc(s.x, s.y, Math.max(1, pt.r * s.s), 0, 7); ctx2.fill();
          }
        }
        ctx2.globalAlpha = 1;
        drawBody(v, ctx2, g, 1, null);
      }
    });

    for (const p of g.particles) {
      const cp = proj(v, p.x, p.y, p.z);
      if (cp.cz < NEAR) continue;
      v.items.push({
        z: cp.cz - 0.01,
        draw: (ctx2) => {
          const s = toScreen(v, cp);
          const a = 1 - p.life / p.max;
          ctx2.globalAlpha = p.kind === 'spark' ? a : a * 0.35;
          ctx2.fillStyle = p.kind === 'spark' ? '#ffdba0' : '#d9cfc0';
          const r = Math.max(0.8, p.r * s.s * (1 + p.life * 1.5));
          ctx2.beginPath(); ctx2.arc(s.x, s.y, r, 0, 7); ctx2.fill();
          ctx2.globalAlpha = 1;
        }
      });
    }

    v.items.sort((a, b) => b.z - a.z);
    for (const it of v.items) it.draw(ctx);

    // ---- in-world popups
    ctx.textAlign = 'center';
    for (const p of g.popups) {
      const cp = proj(v, p.x, p.y, p.z);
      if (cp.cz < NEAR) continue;
      const s = toScreen(v, cp);
      const a = clamp(1.6 - p.t, 0, 1) * clamp(p.t * 5, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.kind === 'gate' ? '#8affc0' : p.kind === 'good' ? D.accent : '#fff';
      ctx.font = '600 ' + clamp(0.36 * s.s, 10, 26).toFixed(0) + 'px ui-monospace, Menlo, monospace';
      ctx.fillText(p.text, s.x, s.y);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';

    weather(v, ctx, g, t);

    const vg = ctx.createRadialGradient(v.w / 2, v.h * 0.5, v.h * 0.28, v.w / 2, v.h * 0.5, v.h * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, v.w, v.h);

    if (shake > 0.25) {
      ctx.globalAlpha = clamp((shake - 0.25) * 0.45, 0, 0.3);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, v.w, v.h); ctx.globalAlpha = 1;
    }
    if (g.gateFlash > 0) {
      ctx.globalAlpha = g.gateFlash * 0.20;
      ctx.fillStyle = D.accent; ctx.fillRect(0, 0, v.w, v.h); ctx.globalAlpha = 1;
    }
  }

  function weather(v, ctx, g, t) {
    const d = g.districtIndex;
    ctx.save();
    if (d === 3) {
      ctx.strokeStyle = 'rgba(190,230,255,0.28)'; ctx.lineWidth = 1;
      for (let i = 0; i < 80; i++) {
        const sp = 420 + hash(i * 3) * 300;
        const x = (hash(i * 11) * v.w * 1.3 - g.cam.x * 30) % (v.w * 1.3);
        const y = (hash(i * 7) * v.h + t * sp) % v.h;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + 12); ctx.stroke();
      }
    } else if (d === 4) {
      for (let i = 0; i < 14; i++) {
        const z = Math.floor(g.cam.z / 9) * 9 + i * 9;
        const ph = (t * 0.3 + hash(i * 5)) % 1;
        const p = proj(v, (hash(i * 3) - 0.5) * 5, g.groundRef + ph * 3.4, z);
        if (p.cz < NEAR) continue;
        const s = toScreen(v, p);
        ctx.globalAlpha = 0.14 * (1 - ph);
        ctx.fillStyle = '#ffd9b0';
        ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(3, (0.4 + ph * 1.4) * s.s), 0, 7); ctx.fill();
      }
    } else if (d >= 5) {
      ctx.strokeStyle = 'rgba(200,215,255,0.15)'; ctx.lineWidth = 1;
      for (let i = 0; i < 22; i++) {
        const y = hash(i * 17) * v.h;
        const x = (hash(i * 23) * v.w * 1.6 + t * (260 + hash(i) * 380)) % (v.w * 1.6) - v.w * 0.3;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 30 + hash(i * 3) * 44, y + 2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  return { View, resize, frame };
})();
