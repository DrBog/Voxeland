/* IRONWAKE — the view.
   The same software 3D renderer that carried the runner, turned on an arena:
   perspective projection, near-plane clipping, a painter's sort and fog, all
   in canvas2d. A tactics map has to be READ, not just seen — so the tiles
   carry the information (where you can walk, who you can reach, how high the
   ground is) and the bodies carry the drama. */
K.render = (function () {
  const U = K.util;
  const { clamp, lerp } = U;

  const NEAR = 0.30;
  const FOG_NEAR = 14, FOG_FAR = 74;

  const SKY = ['#101827', '#1b2438', '#2b3247', '#3a3140'];
  const FOG = [43, 50, 71];

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
  function hash(i) {
    let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const SIDE = [
    { body: [232, 236, 246], accent: '#7fd8ff', ring: '#7fd8ff' },   // yours
    { body: [226, 176, 168], accent: '#ff7d6b', ring: '#ff7d6b' }    // theirs
  ];

  /* ---------------------------------------------------------------- camera */

  function Camera(arena) {
    return {
      x: 0, y: 0, z: 0,
      tx: 0, ty: 0.9, tz: 0,        // what we look at
      fx: 0, fy: 0.9, fz: 0,        // where we want to look
      yaw: 2.35, pitch: 0.88, dist: 28,
      wantYaw: 2.35, wantPitch: 0.88, wantDist: 28,
      shake: 0, fov: 1
    };
  }

  function camUpdate(cam, dt) {
    cam.yaw = lerp(cam.yaw, cam.wantYaw, clamp(dt * 9, 0, 1));
    cam.pitch = lerp(cam.pitch, clamp(cam.wantPitch, 0.16, 1.32), clamp(dt * 9, 0, 1));
    cam.dist = lerp(cam.dist, clamp(cam.wantDist, 7, 40), clamp(dt * 6, 0, 1));
    cam.tx = lerp(cam.tx, cam.fx, clamp(dt * 3.4, 0, 1));
    cam.ty = lerp(cam.ty, cam.fy, clamp(dt * 3.4, 0, 1));
    cam.tz = lerp(cam.tz, cam.fz, clamp(dt * 3.4, 0, 1));
    const ch = Math.cos(cam.pitch);
    cam.x = cam.tx - Math.sin(cam.yaw) * ch * cam.dist;
    cam.y = cam.ty + Math.sin(cam.pitch) * cam.dist;
    cam.z = cam.tz - Math.cos(cam.yaw) * ch * cam.dist;
    cam.shake = Math.max(0, cam.shake - dt * 2.4);
  }

  function View(canvas) {
    return { canvas, ctx: canvas.getContext('2d'), w: 0, h: 0, dpr: 1, f: 500, items: [], fog: FOG };
  }

  function resize(v) {
    const r = v.canvas.getBoundingClientRect();
    // fill rate is the whole cost of a software renderer: a phone at 3x is
    // drawing nine times the pixels of a phone at 1x for no visible gain
    const dpr = Math.min(window.devicePixelRatio || 1, 1.7);
    v.w = r.width; v.h = r.height; v.dpr = dpr;
    v.canvas.width = Math.max(1, Math.round(r.width * dpr));
    v.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  function setCamera(v, cam, sx, sy) {
    let fx = cam.tx - cam.x, fy = cam.ty - cam.y, fz = cam.tz - cam.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, ry = 0, rz = fx;                       // fwd x worldUp
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;  // right x fwd
    const fovY = 1.02 / (cam.fov || 1);
    v.f = (v.h * 0.5) / Math.tan(fovY * 0.5);
    v.cam = { x: cam.x, y: cam.y, z: cam.z, fx, fy, fz, rx, ry, rz, ux, uy, uz, sx: sx || 0, sy: sy || 0 };
    const dfwd = fz, dup = uz;
    v.horizonY = dfwd > 0.01 ? v.h * (0.5 + FRAME) - v.f * (dup / dfwd) : -v.h;
  }

  function proj(v, x, y, z) {
    const c = v.cam;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    return {
      cx: dx * c.rx + dy * c.ry + dz * c.rz,
      cy: dx * c.ux + dy * c.uy + dz * c.uz,
      cz: dx * c.fx + dy * c.fy + dz * c.fz
    };
  }
  /* The board is framed a little below centre: the status bar lives at the top
     of a phone and the far rank of a tactics map is the last thing that should
     be hiding under it. */
  const FRAME = 0.055;
  function toScreen(v, p) {
    const s = v.f / p.cz;
    return { x: v.w / 2 + p.cx * s + v.cam.sx, y: v.h * (0.5 + FRAME) - p.cy * s + v.cam.sy, s, z: p.cz };
  }
  function screenOf(v, x, y, z) {
    const p = proj(v, x, y, z);
    if (p.cz < NEAR) return null;
    return toScreen(v, p);
  }

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

  function path(v, ctx, camPts) {
    const pts = clipNear(camPts);
    if (pts.length < 3) return false;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const s = toScreen(v, pts[i]);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
    return true;
  }
  function fillPoly(v, ctx, camPts, style) {
    if (path(v, ctx, camPts)) { ctx.fillStyle = style; ctx.fill(); }
  }
  function strokePoly(v, ctx, camPts, style, w) {
    if (path(v, ctx, camPts)) { ctx.strokeStyle = style; ctx.lineWidth = w; ctx.stroke(); }
  }

  /* ----------------------------------------------------------------- boxes */

  const FACES = [
    { i: [4, 5, 6, 7], n: [0, 1, 0], k: 1.00, side: -1 },
    { i: [0, 1, 5, 4], n: [0, 0, -1], k: 0.74, side: 3 },
    { i: [2, 3, 7, 6], n: [0, 0, 1], k: 0.44, side: 2 },
    { i: [3, 0, 4, 7], n: [-1, 0, 0], k: 0.58, side: 1 },
    { i: [1, 2, 6, 5], n: [1, 0, 0], k: 0.64, side: 0 }
  ];

  /* depth of the corner nearest the camera: a slab that stands between the
     camera and a body must be painted after it, and a slab's centre is a
     poor witness to that */
  function boxDepth(v, b) {
    const c = v.cam;
    let best = 1e9;
    for (let i = 0; i < 8; i++) {
      const x = (i & 1) ? b.x1 : b.x0, y = (i & 2) ? b.y1 : b.y0, z = (i & 4) ? b.z1 : b.z0;
      const d = (x - c.x) * c.fx + (y - c.y) * c.fy + (z - c.z) * c.fz;
      if (d < best) best = d;
    }
    return best;
  }

  /* colour strings are the renderer's hidden cost: building a few thousand
     rgba() strings a second is real work, and there are only a few dozen
     distinct shades on the board */
  const styleCache = new Map();
  function shadeOf(base, k, fogT, fog, key) {
    const bucket = Math.round(fogT * 8);
    const ck = key + '|' + k + '|' + bucket;
    let s = styleCache.get(ck);
    if (s === undefined) {
      s = css(mix(mix(base, [6, 7, 12], 1 - k), fog, (bucket / 8) * 0.9));
      styleCache.set(ck, s);
    }
    return s;
  }

  function boxItem(v, b, base, opts) {
    opts = opts || {};
    const c = v.cam;
    const depth = boxDepth(v, b);
    if (depth > FOG_FAR + 40) return;
    const cy = (b.y0 + b.y1) / 2;
    const centre = ((b.x0 + b.x1) / 2 - c.x) * c.fx + (cy - c.y) * c.fy + ((b.z0 + b.z1) / 2 - c.z) * c.fz;
    if (centre < -6) return;
    const corners = [
      [b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x1, b.y0, b.z1], [b.x0, b.y0, b.z1],
      [b.x0, b.y1, b.z0], [b.x1, b.y1, b.z0], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]
    ].map(p => proj(v, p[0], p[1], p[2]));
    // screen-space cull: a tile nobody can see still costs five fills
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, near = false;
    for (const p of corners) {
      if (p.cz < NEAR) { near = true; continue; }
      const s = v.f / p.cz;
      const sx = v.w / 2 + p.cx * s, sy = v.h / 2 - p.cy * s;
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
      if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
    }
    if (!near) {
      if (x1 < -24 || x0 > v.w + 24 || y1 < -24 || y0 > v.h + 24) return;
    }
    const fogT = clamp((centre - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1);
    v.items.push({
      z: depth,
      draw: (ctx) => {
        for (const F of FACES) {
          if (F.side >= 0 && opts.open && !opts.open[F.side]) continue;
          const fx = F.n[0] > 0 ? b.x1 : F.n[0] < 0 ? b.x0 : (b.x0 + b.x1) / 2;
          const fy = F.n[1] > 0 ? b.y1 : F.n[1] < 0 ? b.y0 : (b.y0 + b.y1) / 2;
          const fz = F.n[2] > 0 ? b.z1 : F.n[2] < 0 ? b.z0 : (b.z0 + b.z1) / 2;
          if ((fx - c.x) * F.n[0] + (fy - c.y) * F.n[1] + (fz - c.z) * F.n[2] > 0) continue;
          fillPoly(v, ctx, F.i.map(i => corners[i]),
            opts.key ? shadeOf(base, F.k, fogT, v.fog, opts.key) : css(mix(mix(base, [6, 7, 12], 1 - F.k), v.fog, fogT * 0.9)));
        }
        if (opts.edge) {
          strokePoly(v, ctx, [corners[4], corners[5], corners[6], corners[7]],
            css(mix(rgb(opts.edge), v.fog, fogT), opts.edgeA === undefined ? 0.30 : opts.edgeA), 1.1);
        }
      }
    });
  }

  /* --------------------------------------------------------------- arena */

  function tileQuad(v, arena, s, lift) {
    const T = K.grid.TILE, w = arena.world(s), h = T / 2 - 0.03, y = s.y + (lift || 0);
    return [
      proj(v, w.x - h, y, w.z - h), proj(v, w.x + h, y, w.z - h),
      proj(v, w.x + h, y, w.z + h), proj(v, w.x - h, y, w.z + h)
    ];
  }

  function drawArena(v, g) {
    const b = g.battle, arena = b.arena, T = K.grid.TILE;
    for (const s of arena.surfaces) {
      const w = arena.world(s);
      const box = {
        x0: w.x - T / 2, x1: w.x + T / 2,
        y0: s.y - Math.max(0.18, s.solid), y1: s.y,
        z0: w.z - T / 2, z1: w.z + T / 2
      };
      const tint = rgb(s.t.col);
      const n = hash(s.id * 977);
      boxItem(v, box, mix(tint, [255, 255, 255], 0.03 + Math.round(n * 3) * 0.017), {
        open: s.open, key: s.terrain + (Math.round(n * 3)),
        edge: s.terrain === 'bridge' || s.terrain === 'fort' || s.terrain === 'roof' ? '#8d9ab5' : '#6d7791',
        edgeA: 0.22
      });
    }
  }

  /* the overlays are the game's language: where you may go, who you may hit */
  function drawOverlays(v, g) {
    const b = g.battle, arena = b.arena;
    const t = g.t;
    const puls = 0.5 + 0.5 * Math.sin(t * 3.4);

    const T = K.grid.TILE;
    const paint = (s, col, a, edge) => {
      const q = tileQuad(v, arena, s, 0.035);
      const w = arena.world(s);
      const depth = boxDepth(v, {
        x0: w.x - T / 2, x1: w.x + T / 2,
        y0: s.y - Math.max(0.18, s.solid), y1: s.y,
        z0: w.z - T / 2, z1: w.z + T / 2
      });
      v.items.push({
        z: depth - 0.05,
        draw: (ctx) => {
          fillPoly(v, ctx, q, css(col, a));
          if (edge) strokePoly(v, ctx, q, css(col, Math.min(1, a * 2.4)), 1.4);
        }
      });
    };

    if (b.reach && b.sel) {
      const inRange = new Set();
      for (const [, e] of b.reach) inRange.add(e.s.x + ',' + e.s.z);
      for (const [, e] of b.reach) {
        if (e.s === b.sel.surface) continue;
        if (b.occupiedFn && b.occupiedFn(e.s)) continue;
        // only the outside of the range gets an edge: a grid of outlines is
        // noise, one silhouette is information
        const rim = !inRange.has((e.s.x + 1) + ',' + e.s.z) || !inRange.has((e.s.x - 1) + ',' + e.s.z)
          || !inRange.has(e.s.x + ',' + (e.s.z + 1)) || !inRange.has(e.s.x + ',' + (e.s.z - 1));
        paint(e.s, [86, 178, 255], 0.20 + puls * 0.05, rim);
      }
    }
    // tapping one of theirs asks the only question that matters before you
    // step out: where can it reach me next turn?
    if (g.threat && g.threat.length) {
      const set = new Set(g.threat.map(s => s.x + ',' + s.z));
      for (const s of g.threat) {
        const rim = !set.has((s.x + 1) + ',' + s.z) || !set.has((s.x - 1) + ',' + s.z)
          || !set.has(s.x + ',' + (s.z + 1)) || !set.has(s.x + ',' + (s.z - 1));
        paint(s, [255, 122, 96], 0.16 + puls * 0.04, rim);
      }
    }
    for (const u of b.targets || []) {
      if (u.dead) continue;
      paint(u.surface, [255, 96, 84], 0.30 + puls * 0.14, true);
    }
    if (g.hover) paint(g.hover, [244, 246, 255], 0.16 + puls * 0.08, true);

    if (g.pathPreview && g.pathPreview.length > 1) {
      const pts = g.pathPreview.map(s => { const w = arena.world(s); return { x: w.x, y: s.y + 0.06, z: w.z }; });
      const depth = boxDepth(v, { x0: pts[0].x, x1: pts[0].x, y0: pts[0].y, y1: pts[0].y, z0: pts[0].z, z1: pts[0].z });
      v.items.push({
        z: depth - 0.12,
        draw: (ctx) => {
          ctx.lineWidth = 3.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.strokeStyle = 'rgba(150,214,255,0.85)';
          ctx.beginPath();
          let started = false;
          for (const p of pts) {
            const s = screenOf(v, p.x, p.y, p.z);
            if (!s) { started = false; continue; }
            if (!started) { ctx.moveTo(s.x, s.y); started = true; } else ctx.lineTo(s.x, s.y);
          }
          ctx.stroke();
          const last = pts[pts.length - 1];
          const s = screenOf(v, last.x, last.y, last.z);
          if (s) {
            ctx.fillStyle = 'rgba(150,214,255,0.9)';
            ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(3, 0.16 * s.s), 0, 7); ctx.fill();
          }
        }
      });
    }
  }

  /* ---------------------------------------------------------------- bodies */

  const LIMBS = [
    ['hipL', 'kneeL', 0.090], ['kneeL', 'footL', 0.074], ['footL', 'toeL', 0.060],
    ['hipR', 'kneeR', 0.090], ['kneeR', 'footR', 0.074], ['footR', 'toeR', 0.060],
    ['shL', 'elbowL', 0.061], ['elbowL', 'handL', 0.051],
    ['shR', 'elbowR', 0.061], ['elbowR', 'handR', 0.051],
    ['hipL', 'hipR', 0.084], ['shL', 'shR', 0.094],
    ['pelvis', 'chest', 0.124], ['chest', 'head', 0.067]
  ];

  function weaponHand(a) {
    const p = a.body.parts;
    return a.face > 0 ? p.handR : p.handL;
  }

  function drawWeapon(v, ctx, a, fogT, col) {
    const u = a.unit, kind = u.weapon.kind;
    const h = weaponHand(a), p = a.body.parts;
    const el = a.face > 0 ? p.elbowR : p.elbowL;
    let dx = h.x - el.x, dy = h.y - el.y + 0.16, dz = h.z - el.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    dx /= d; dy /= d; dz /= d;
    const len = kind === 'lance' ? 1.15 : kind === 'axe' ? 0.60 : kind === 'sword' ? 0.58 : 0.50;
    const a0 = screenOf(v, h.x - dx * 0.10, h.y - dy * 0.10, h.z - dz * 0.10);
    const a1 = screenOf(v, h.x + dx * len, h.y + dy * len, h.z + dz * len);
    if (!a0 || !a1) return;
    if (kind === 'tome') {
      const gl = ctx.createRadialGradient(a0.x, a0.y, 0, a0.x, a0.y, Math.max(5, 0.5 * a0.s));
      gl.addColorStop(0, 'rgba(255,190,120,0.85)');
      gl.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(a0.x, a0.y, Math.max(5, 0.5 * a0.s), 0, 7); ctx.fill();
      return;
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = css(mix([18, 18, 26], v.fog, fogT), 0.9);
    ctx.lineWidth = Math.max(2.4, (kind === 'lance' ? 0.05 : 0.07) * a0.s + 2);
    ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.stroke();
    ctx.strokeStyle = css(mix(col, [255, 255, 255], 0.45), 0.95);
    ctx.lineWidth = Math.max(1.2, (kind === 'lance' ? 0.03 : 0.045) * a0.s);
    ctx.beginPath();
    if (kind === 'bow') {
      const mx = (a0.x + a1.x) / 2, my = (a0.y + a1.y) / 2;
      ctx.moveTo(a0.x, a0.y);
      ctx.quadraticCurveTo(mx + (a1.y - a0.y) * 0.4, my - (a1.x - a0.x) * 0.4, a1.x, a1.y);
    } else {
      ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y);
    }
    ctx.stroke();
    if (kind === 'axe') {
      ctx.fillStyle = css(mix(col, [255, 255, 255], 0.4), 0.95);
      ctx.beginPath(); ctx.arc(a1.x, a1.y, Math.max(2.5, 0.12 * a1.s), 0, 7); ctx.fill();
    }
  }

  function bodyItem(v, g, a) {
    const P = a.body.parts;
    const c = v.cam;
    const pel = P.pelvis;
    const depth = (pel.x - c.x) * c.fx + (pel.y - c.y) * c.fy + (pel.z - c.z) * c.fz;
    if (depth < NEAR) return;
    const fogT = clamp((depth - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1);
    const S = SIDE[a.unit.side];
    const dead = a.unit.dead;
    const skin = dead ? mix(S.body, [70, 66, 74], 0.55) : S.body;
    const acc = rgb(S.accent);
    v.items.push({
      z: depth - 0.35,
      draw: (ctx) => {
        // shadow first, on whatever surface is under the hips
        const gr = g.battle.level.groundAt(pel.x, pel.z, pel.y + 0.3);
        if (gr) {
          const s = screenOf(v, pel.x, gr.y + 0.03, pel.z);
          if (s) {
            const height = clamp(pel.y - gr.y, 0, 4);
            ctx.save();
            ctx.globalAlpha = clamp(0.30 - height * 0.05, 0.04, 0.30);
            ctx.fillStyle = '#000';
            const rx = (0.40 + height * 0.10) * s.s;
            ctx.beginPath(); ctx.ellipse(s.x, s.y, rx, rx * 0.42, 0, 0, 7); ctx.fill();
            ctx.restore();
          }
        }
        // a ring under the unit: side, whether it has acted, whether it is picked
        if (!dead) {
          const gy = (gr ? gr.y : a.pos.y) + 0.035;
          const sel = g.battle.sel === a.unit;
          const spent = a.unit.acted;
          const r = 0.62;
          const pts = [];
          for (let i = 0; i < 22; i++) {
            const th = i / 22 * Math.PI * 2;
            pts.push(proj(v, pel.x + Math.cos(th) * r, gy, pel.z + Math.sin(th) * r));
          }
          const puls = sel ? 0.55 + 0.45 * Math.sin(g.t * 5) : 1;
          strokePoly(v, ctx, pts, css(spent ? [120, 126, 142] : rgb(S.ring), (spent ? 0.35 : 0.75) * puls), sel ? 3 : 1.8);
          if (sel) fillPoly(v, ctx, pts, css(rgb(S.ring), 0.10));
        }

        // A stroke costs an order of magnitude more than a fill in a software
        // canvas, and a body drawn limb by limb, outlined and filled, is
        // twenty-eight of them. The segments are bucketed into a heavy group
        // and a light one and each is stroked twice — four strokes a body, and
        // the silhouette still reads.
        const heavy = [], light = [];
        let hz = 0, lz = 0;
        for (const [p0, p1, w] of LIMBS) {
          const pa = proj(v, P[p0].x, P[p0].y, P[p0].z), pb = proj(v, P[p1].x, P[p1].y, P[p1].z);
          if (pa.cz < NEAR || pb.cz < NEAR) continue;
          const seg = { z: (pa.cz + pb.cz) / 2, a: toScreen(v, pa), b: toScreen(v, pb), w };
          if (w >= 0.08) { heavy.push(seg); hz += seg.z; } else { light.push(seg); lz += seg.z; }
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const alpha = dead ? 0.72 : 1;
        const ink = 'rgba(8,8,13,' + (0.85 * alpha) + ')';
        const flesh = css(mix(mix(skin, [26, 24, 34], clamp((depth - 6) / 22, 0, 0.35)), v.fog, fogT * 0.7), alpha);
        const scale = P.pelvis ? (v.f / Math.max(NEAR, depth)) : 1;
        const bucket = (list, wide) => {
          if (!list.length) return;
          const w = Math.max(1.3, wide * 2 * scale);
          ctx.beginPath();
          for (const s of list) { ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); }
          ctx.strokeStyle = ink; ctx.lineWidth = w + Math.max(1.5, w * 0.30); ctx.stroke();
          ctx.strokeStyle = flesh; ctx.lineWidth = w; ctx.stroke();
        };
        // whichever group is further away is laid down first
        const heavyFirst = (heavy.length ? hz / heavy.length : 0) >= (light.length ? lz / light.length : 0);
        if (heavyFirst) { bucket(heavy, 0.098); bucket(light, 0.060); }
        else { bucket(light, 0.060); bucket(heavy, 0.098); }
        const hp = screenOf(v, P.head.x, P.head.y, P.head.z);
        if (hp) {
          const r = Math.max(2, 0.125 * hp.s);
          ctx.fillStyle = 'rgba(8,8,13,' + (0.85 * alpha) + ')';
          ctx.beginPath(); ctx.arc(hp.x, hp.y, r + Math.max(1.5, r * 0.24), 0, 7); ctx.fill();
          ctx.fillStyle = css(mix(skin, v.fog, fogT * 0.7), alpha);
          ctx.beginPath(); ctx.arc(hp.x, hp.y, r, 0, 7); ctx.fill();
          if (!dead) {
            ctx.strokeStyle = css(mix(acc, [255, 255, 255], 0.3), 0.6);
            ctx.lineWidth = Math.max(1, r * 0.24);
            ctx.beginPath(); ctx.arc(hp.x, hp.y, r, -2.5, -0.4); ctx.stroke();
          }
        }
        drawWeapon(v, ctx, a, fogT, acc);
      }
    });
  }

  /* ------------------------------------------------------------ billboards */

  /* Canvas re-parses the font every time the string changes, and a size that
     follows the perspective changes it every frame for every unit — which
     turned out to cost more than the entire arena. Sizes are quantised so the
     same handful of strings repeat. */
  const FONT = [];
  function font(px, weight) {
    const n = Math.max(8, Math.min(34, Math.round(px / 2) * 2));
    const k = (weight || 600) + '_' + n;
    let s = FONT[k];
    if (!s) { s = FONT[k] = (weight || 600) + ' ' + n + 'px "IBM Plex Mono", ui-monospace, monospace'; }
    return s;
  }

  function billboards(v, ctx, g) {
    const b = g.battle;
    const list = [];
    for (const u of b.units) {
      const a = b.actors.get(u.id);
      if (!a) continue;
      const h = a.body.parts.head;
      const s = screenOf(v, h.x, h.y + 0.42, h.z);
      if (!s || s.z > 52) continue;
      list.push({ u, a, s });
    }
    list.sort((p, q) => q.s.z - p.s.z);
    for (const it of list) {
      const { u, s } = it;
      const w = clamp(1.05 * s.s, 22, 74), hgt = Math.max(3, w * 0.085);
      const fade = clamp(1 - (s.z - 34) / 18, 0.25, 1);
      ctx.globalAlpha = fade;
      if (!u.dead) {
        ctx.fillStyle = 'rgba(6,7,12,0.72)';
        ctx.fillRect(s.x - w / 2 - 1, s.y - hgt - 1, w + 2, hgt + 2);
        const frac = clamp(u.hp / u.maxHp, 0, 1);
        ctx.fillStyle = u.side === 0
          ? (frac > 0.5 ? '#7fe0b0' : frac > 0.25 ? '#ffd479' : '#ff7b6b')
          : (frac > 0.5 ? '#ff9a86' : '#ff6a58');
        ctx.fillRect(s.x - w / 2, s.y - hgt, w * frac, hgt);
        // segment ticks make small chip damage legible
        ctx.strokeStyle = 'rgba(8,9,14,0.6)'; ctx.lineWidth = 1;
        const seg = Math.max(4, Math.round(u.maxHp / 5));
        for (let i = seg; i < u.maxHp; i += seg) {
          const x = s.x - w / 2 + w * (i / u.maxHp);
          ctx.beginPath(); ctx.moveTo(x, s.y - hgt); ctx.lineTo(x, s.y); ctx.stroke();
        }
      }
      ctx.textAlign = 'center';
      ctx.font = font(clamp(0.30 * s.s, 8, 15));
      ctx.fillStyle = u.dead ? 'rgba(150,152,166,0.8)'
        : u.side === 0 ? 'rgba(226,238,255,0.95)' : 'rgba(255,206,196,0.95)';
      ctx.fillText(u.dead ? '✕ ' + u.name : u.name, s.x, s.y - hgt - 5);
      ctx.globalAlpha = 1;
    }

    // floating numbers: the only place a raw damage figure belongs
    ctx.textAlign = 'center';
    for (const p of g.battle.popups) {
      const s = screenOf(v, p.x, p.y + p.t * 1.1, p.z);
      if (!s) continue;
      const a = clamp(1.5 - p.t, 0, 1) * clamp(p.t * 6, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = font(clamp((p.big ? 0.52 : 0.38) * s.s, 11, p.big ? 34 : 24), 700);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,5,9,0.8)';
      ctx.strokeText(p.text, s.x, s.y);
      ctx.fillStyle = p.kind === 'crit' ? '#ffd166' : p.kind === 'miss' ? '#a8b0c4'
        : p.kind === 'heal' ? '#8affc0' : p.kind === 'level' ? '#9ad8ff' : '#ffffff';
      ctx.fillText(p.text, s.x, s.y);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
  }

  /* ---------------------------------------------------------------- frame */

  function frame(v, g, dt) {
    const ctx = v.ctx;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    v.fog = FOG;
    const cam = g.cam;
    const sh = cam.shake;
    setCamera(v, cam, (Math.random() - 0.5) * sh * 12, (Math.random() - 0.5) * sh * 12);

    const hy = clamp(v.horizonY, -v.h * 2, v.h * 1.8);
    const sky = ctx.createLinearGradient(0, hy - v.h * 1.2, 0, hy + v.h * 0.4);
    sky.addColorStop(0, SKY[0]); sky.addColorStop(0.5, SKY[1]);
    sky.addColorStop(0.85, SKY[2]); sky.addColorStop(1, SKY[3]);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, v.w, v.h);
    if (hy < v.h) {
      const deep = ctx.createLinearGradient(0, hy, 0, v.h);
      deep.addColorStop(0, css(mix(FOG, [10, 12, 20], 0.4), 0.95));
      deep.addColorStop(1, 'rgba(6,7,12,1)');
      ctx.fillStyle = deep; ctx.fillRect(0, hy, v.w, v.h - hy);
    }

    v.items.length = 0;
    drawArena(v, g);
    drawOverlays(v, g);
    for (const [, a] of g.battle.actors) bodyItem(v, g, a);
    for (const p of g.battle.fx) {
      const cp = proj(v, p.x, p.y, p.z);
      if (cp.cz < NEAR) continue;
      v.items.push({
        z: cp.cz - 0.4,
        draw: (ctx2) => {
          const s = toScreen(v, cp);
          const a = clamp(1 - p.t / p.max, 0, 1);
          ctx2.globalAlpha = a * (p.kind === 'spark' ? 0.95 : 0.4);
          ctx2.fillStyle = p.kind === 'spark' ? '#ffd9a0' : '#cfd6e6';
          ctx2.beginPath(); ctx2.arc(s.x, s.y, Math.max(0.8, p.r * s.s), 0, 7); ctx2.fill();
          ctx2.globalAlpha = 1;
        }
      });
    }

    v.items.sort((a, b) => b.z - a.z);
    for (const it of v.items) it.draw(ctx);

    billboards(v, ctx, g);

    const vg = ctx.createRadialGradient(v.w / 2, v.h * 0.5, v.h * 0.3, v.w / 2, v.h * 0.5, v.h * 0.98);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, v.w, v.h);
  }

  /* ----------------------------------------------------------------- pick */

  /* A tap has to mean the tile the finger is over, on the level it looks like.
     Projecting tile centres and taking the nearest gets a bridge confused with
     the courtyard beneath it, so this casts the actual ray. */
  function pick(v, sx, sy, arena) {
    if (!v.cam) return null;
    const c = v.cam;
    const ax = (sx - v.w / 2) / v.f, ay = (v.h * (0.5 + FRAME) - sy) / v.f;
    const dx = c.fx + c.rx * ax + c.ux * ay;
    const dy = c.fy + c.ry * ax + c.uy * ay;
    const dz = c.fz + c.rz * ax + c.uz * ay;
    const T = K.grid.TILE;
    let best = null;
    for (const s of arena.surfaces) {
      const w = arena.world(s);
      const b = {
        x0: w.x - T / 2, x1: w.x + T / 2,
        y0: s.y - Math.max(0.18, s.solid), y1: s.y,
        z0: w.z - T / 2, z1: w.z + T / 2
      };
      let t0 = 0, t1 = 1e9;
      let ok = true;
      const slab = (o, d, lo, hi) => {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) ok = false; return; }
        let a = (lo - o) / d, bb = (hi - o) / d;
        if (a > bb) { const tmp = a; a = bb; bb = tmp; }
        if (a > t0) t0 = a;
        if (bb < t1) t1 = bb;
        if (t0 > t1) ok = false;
      };
      slab(c.x, dx, b.x0, b.x1); if (!ok) continue;
      slab(c.y, dy, b.y0, b.y1); if (!ok) continue;
      slab(c.z, dz, b.z0, b.z1); if (!ok) continue;
      if (t1 < 0) continue;
      const t = t0 > 0 ? t0 : t1;
      if (!best || t < best.t) best = { t, s };
    }
    return best ? best.s : null;
  }

  return { View, resize, frame, pick, Camera, camUpdate, screenOf, SIDE };
})();
