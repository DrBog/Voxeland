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
      // Face-on, with a few degrees of swing for depth. A board turned to the
      // diamond spends the width of a portrait screen on its own diagonal and
      // leaves two triangles of void along the bottom edge; square on, the
      // near rank is a full-width line and the arena fills the frame.
      yaw: Math.PI + 0.10, pitch: 0.66, dist: 24,
      wantYaw: Math.PI + 0.10, wantPitch: 0.66, wantDist: 24,
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
    return {
      canvas, ctx: canvas.getContext('2d'), w: 0, h: 0, dpr: 1, f: 500, items: [], fog: FOG,
      // the strip of screen the board gets: the HUD owns the rest, and framing
      // the arena in the whole viewport puts half of it under the bars
      band: { top: 44, bottom: 96 },
      // where in that band the camera's own target sits. Looking down at a
      // board, everything you are about to do with a unit is UP-screen of it,
      // so a centred unit wastes the bottom third on empty floor.
      frameBias: 0.62
    };
  }
  function midY(v) {
    const h = Math.max(140, v.h - v.band.top - v.band.bottom);
    return v.band.top + h * (v.frameBias === undefined ? 0.5 : v.frameBias);
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
    const band = Math.max(140, v.h - v.band.top - v.band.bottom);
    // scale is set by the SHORTER axis of the space the board actually has, so
    // a unit is the same size in your hand whatever the phone
    const ref = Math.min(v.w * 1.42, band);
    /* A narrow lens, and a camera further back to make up for it.

       At 58 degrees the board sheared across the frame: a unit near the bottom
       was being looked at from almost directly overhead — measured, its hips
       projected three pixels above its feet and its knees projected BELOW
       them, so the legs collapsed into the tile and the body looked cut off at
       the waist — while a unit at the top of the same frame was seen almost
       side on. Tiles at the edges sheared hard enough to read as billboards.
       A long lens costs a little depth and buys a board that looks the same
       everywhere on it. */
    const fovY = 0.72 / (cam.fov || 1);
    v.f = (ref * 0.5) / Math.tan(fovY * 0.5);
    v.cam = { x: cam.x, y: cam.y, z: cam.z, yaw: cam.yaw, fx, fy, fz, rx, ry, rz, ux, uy, uz, sx: sx || 0, sy: sy || 0 };
    v.my = midY(v);
    /* The horizon, properly. This used to be uz/fz, which is the right answer
       only when the camera looks straight down world z — and this camera never
       does, it sits at yaw PI+0.1, so fz was negative, the guard failed every
       frame and the horizon was pinned to its fallback off the top of the
       screen for every pitch. Nothing that hangs off the horizon has ever been
       in the right place.

       A horizontal direction d projects to cy/cz = (d.u)/(d.f). Take d as the
       camera's own forward flattened onto the ground plane and it reduces to
       the dot products below — which is just tan(pitch), but computed from the
       basis rather than assuming one. */
    const hl = fx * fx + fz * fz;
    v.horizonY = hl > 1e-6 ? v.my - v.f * ((fx * ux + fz * uz) / hl) : -v.h * 4;
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
  function toScreen(v, p) {
    const s = v.f / p.cz;
    return { x: v.w / 2 + p.cx * s + v.cam.sx, y: v.my - p.cy * s + v.cam.sy, s, z: p.cz };
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
    if (depth > (v.fogFar || FOG_FAR) + 40) return;
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
    const fn = v.fogNear || FOG_NEAR, ff = v.fogFar || FOG_FAR;
    const fogT = clamp((centre - fn) / (ff - fn), 0, 1);
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
      /* The terrain table says what a surface IS; the zone says what light
         is falling on it. Tinting here rather than in the grid keeps one
         rubble tile one rubble tile in every zone, and still means the
         Glasswaste is bleached and the Ashfall is rusted. */
      const zg = g.zone && g.zone.ground;
      const tint = zg ? mix(rgb(s.t.col), rgb(zg.col), zg.mix) : rgb(s.t.col);
      // the shade cache is keyed by terrain, so the zone has to be part of
      // that key or the first zone drawn paints every zone after it
      const zk = g.zone ? g.zone.id : '-';
      const n = hash(s.id * 977);
      boxItem(v, box, mix(tint, [255, 255, 255], 0.03 + Math.round(n * 3) * 0.017), {
        open: s.open, key: zk + s.terrain + (Math.round(n * 3)),
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

  /* Three groups, each with its own real thickness. Batching every limb into
     one stroke width was cheap and turned a body into a lump: a thigh drawn as
     wide as a torso does not read as a leg, it reads as more torso. The group
     is the unit of batching AND the unit of thickness, so a body still costs
     six strokes instead of twenty-eight but a leg is a leg. */
  const TORSO = 0, LIMB = 1, THIN = 2;
  const LIMBS = [
    ['pelvis', 'chest', TORSO], ['shL', 'shR', TORSO],
    ['hipL', 'kneeL', LIMB], ['kneeL', 'footL', LIMB],
    ['hipR', 'kneeR', LIMB], ['kneeR', 'footR', LIMB], ['hipL', 'hipR', LIMB],
    ['shL', 'elbowL', THIN], ['elbowL', 'handL', THIN],
    ['shR', 'elbowR', THIN], ['elbowR', 'handR', THIN],
    ['footL', 'toeL', THIN], ['footR', 'toeR', THIN], ['chest', 'head', THIN]
  ];
  const GIRTH = [0.115, 0.070, 0.044];

  /* --------------------------------------------------------- what they wear

     Ported from DelveCraft, which builds a figure out of named materials —
     SKIN, TUNIC, LEATHER, PLATE, BOOT, CAPE — rather than painting the whole
     body one colour. That app ships no art at all: the materials ARE the
     characters, and this is the part of it worth having.

     It costs nothing here because the renderer already batches the body into
     three girth groups, and those groups happen to be exactly the right
     divisions: the trunk is the tunic, the legs are the armour, the arms and
     neck are skin. Three materials, still four strokes a body.

     The side's colour stays on the trunk, which is the largest block on the
     figure and therefore the thing that answers "whose is that" at a glance.
     Skin is pulled a little way toward it for the same reason — at twenty-odd
     pixels a unit, two identical flesh-coloured heads across a board would
     cost more than the material variety buys. */
  const MATS = {
    skin:    [223, 186, 158],
    leather: [104, 74, 54],
    plate:   [138, 146, 162],
    boot:    [58, 46, 42],
    cape:    [86, 62, 96],
    steel:   [166, 174, 188]
  };
  // what each trade has on its legs; everything else is common
  const KIT = {
    Blade:   { armour: 'leather' },
    Halberd: { armour: 'plate' },
    Reaver:  { armour: 'boot' },
    Archer:  { armour: 'leather' },
    Ember:   { armour: 'cape' }
  };
  function kitOf(unit, tunic) {
    const k = KIT[unit.cls] || KIT.Blade;
    return {
      tunic,
      armour: mix(MATS[k.armour], tunic, 0.16),
      skin: mix(MATS.skin, tunic, 0.34)
    };
  }


  // an archer's bow is in the forward hand; everyone else's weapon is in the
  // right — the actor knows which, because the stance decided it
  function weaponHand(a) { return a.weaponSide < 0 ? a.body.parts.handL : a.body.parts.handR; }

  function drawWeapon(v, ctx, a, fogT, col) {
    const u = a.unit, kind = u.weapon.kind;
    const h = weaponHand(a), p = a.body.parts;
    const el = a.weaponSide < 0 ? p.elbowL : p.elbowR;
    /* A weapon is carried the way its shape is carried, and only points where
       the arm points when the arm is actually swinging it: a blade hangs from
       the fist, a polearm stands up out of it, a bow lies along the forearm.
       Aiming everything down the forearm is what made a walking swordsman look
       like a man prodding the floor with a stick. */
    const sw = a.swing || 0;
    const fwd = a.dir || { x: 0, z: 1 };
    let ax = h.x - el.x, ay = h.y - el.y, az = h.z - el.z;
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    let cx, cy, cz;
    // out to the weapon side, so a carried blade clears the leg instead of
    // hanging through the thigh
    const ox = -fwd.z * (a.weaponSide || 1), oz = fwd.x * (a.weaponSide || 1);
    if (kind === 'lance') { cx = fwd.x * 0.18 + ox * 0.10; cy = 1; cz = fwd.z * 0.18 + oz * 0.10; }
    else if (kind === 'bow') { cx = ax; cy = ay; cz = az; }
    else { cx = -fwd.x * 0.26 + ox * 0.34; cy = -1; cz = -fwd.z * 0.26 + oz * 0.34; }
    let dx = lerp(cx, ax, sw), dy = lerp(cy, ay, sw), dz = lerp(cz, az, sw);
    const d = Math.hypot(dx, dy, dz) || 1;
    dx /= d; dy /= d; dz /= d;
    const len = kind === 'lance' ? 1.25 : kind === 'axe' ? 0.62 : kind === 'sword' ? 0.60 : 0.50;
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
    /* A slab sorts by its nearest corner and a body by its hips, so the tile a
       unit is standing on always counts as nearer than the unit standing on it
       — and paints over its legs. Everyone was cut off at the waist. A body
       therefore sorts in front of the ground under its own feet, and against
       everything else on its own merits. */
    const under = g.battle.level.groundAt(pel.x, pel.z, pel.y + 0.3);
    const floor = under ? boxDepth(v, under.box) - 0.08 : 1e9;
    const fogT = clamp((depth - (v.fogNear || FOG_NEAR)) / ((v.fogFar || FOG_FAR) - (v.fogNear || FOG_NEAR)), 0, 1);
    const S = SIDE[a.unit.side];
    const dead = a.unit.dead;
    // a unit that has had its turn should look like it: on a board of eleven
    // bodies, "who can still move" has to be answerable at a glance
    const spent = !dead && a.unit.acted;
    const skin = dead ? mix(S.body, [70, 66, 74], 0.55)
      : spent ? mix(S.body, [86, 92, 108], 0.62) : S.body;
    const acc = rgb(S.accent);
    v.items.push({
      z: Math.min(depth - 0.35, floor),
      draw: (ctx) => {
        // shadow first, on whatever surface is under the hips
        const gr = under;
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
          const r = a.unit.boss ? 0.82 : 0.62;
          const pts = [];
          for (let i = 0; i < 22; i++) {
            const th = i / 22 * Math.PI * 2;
            pts.push(proj(v, pel.x + Math.cos(th) * r, gy, pel.z + Math.sin(th) * r));
          }
          const puls = sel ? 0.55 + 0.45 * Math.sin(g.t * 5) : 1;
          const ring = a.unit.boss ? [255, 209, 102] : rgb(S.ring);
          strokePoly(v, ctx, pts, css(spent ? [120, 126, 142] : ring, (spent ? 0.35 : 0.75) * puls),
            sel ? 3 : a.unit.boss ? 2.6 : 1.8);
          if (sel) fillPoly(v, ctx, pts, css(ring, 0.10));
          if (a.unit.boss) fillPoly(v, ctx, pts, css(ring, 0.07 + 0.05 * Math.sin(g.t * 2.2)));
        }

        // A stroke costs an order of magnitude more than a fill in a software
        // canvas, and a body drawn limb by limb, outlined and filled, is
        // twenty-eight of them. The segments are bucketed into a heavy group
        // and a light one and each is stroked twice — four strokes a body, and
        // the silhouette still reads.
        const groups = [[], [], []], depths = [0, 0, 0];
        for (const [p0, p1, g] of LIMBS) {
          const pa = proj(v, P[p0].x, P[p0].y, P[p0].z), pb = proj(v, P[p1].x, P[p1].y, P[p1].z);
          if (pa.cz < NEAR || pb.cz < NEAR) continue;
          const seg = { z: (pa.cz + pb.cz) / 2, a: toScreen(v, pa), b: toScreen(v, pb) };
          groups[g].push(seg); depths[g] += seg.z;
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const alpha = dead ? 0.72 : spent ? 0.8 : 1;
        const ink = 'rgba(8,8,13,' + (0.85 * alpha) + ')';
        // one shading pass, applied to each material: distance darkening then
        // the zone's own fog, so a unit sits in its place rather than on it
        const shade = (c) => css(mix(mix(c, [26, 24, 34], clamp((depth - 6) / 22, 0, 0.35)),
          v.fog, fogT * 0.7), alpha);
        const kit = kitOf(a.unit, skin);
        // group order is trunk, legs, arms — which is tunic, armour, skin
        const coats = [shade(kit.tunic), shade(kit.armour), shade(kit.skin)];
        const scale = v.f / Math.max(NEAR, depth);
        const draw = (gi) => {
          const list = groups[gi];
          if (!list.length) return;
          const w = Math.max(1.2, GIRTH[gi] * 2 * scale);
          ctx.beginPath();
          for (const s of list) { ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); }
          ctx.strokeStyle = ink; ctx.lineWidth = w + Math.max(1.4, w * 0.24); ctx.stroke();
          ctx.strokeStyle = coats[gi]; ctx.lineWidth = w; ctx.stroke();
        };
        // the group furthest away goes down first, so limbs read in front of
        // and behind the trunk rather than always on top of it
        const order = [0, 1, 2].filter(i => groups[i].length)
          .sort((p, q) => (depths[q] / groups[q].length) - (depths[p] / groups[p].length));
        for (const gi of order) draw(gi);
        const hp = screenOf(v, P.head.x, P.head.y, P.head.z);
        if (hp) {
          const r = Math.max(2, 0.104 * hp.s);
          ctx.fillStyle = 'rgba(8,8,13,' + (0.85 * alpha) + ')';
          ctx.beginPath(); ctx.arc(hp.x, hp.y, r + Math.max(1.5, r * 0.24), 0, 7); ctx.fill();
          ctx.fillStyle = css(mix(kit.skin, v.fog, fogT * 0.7), alpha);
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
      ctx.globalAlpha = 1;
    }

    /* Names, nearest first, and a name that would land on top of one already
       drawn is dropped. Nine bodies at a spawn point turn a row of labels into
       a smear, and a smear is worse than no label at all — the ring and the
       bar still say whose it is and how it is doing. */
    ctx.textAlign = 'center';
    const claimed = [];
    const order = list.slice().sort((p, q) =>
      (q.u.boss ? 1e6 : 0) - (p.u.boss ? 1e6 : 0) + (p.s.z - q.s.z));
    for (const it of order) {
      const { u, s } = it;
      const w = clamp(1.05 * s.s, 22, 74), hgt = Math.max(3, w * 0.085);
      const size = clamp(0.30 * s.s, 8, 15);
      ctx.font = font(size);
      const text = u.dead ? '✕ ' + u.name : u.name;
      const half = ctx.measureText(text).width / 2 + 3;
      const y = s.y - hgt - 5;
      const box = { x0: s.x - half, x1: s.x + half, y0: y - size, y1: y + 3 };
      if (claimed.some(c => box.x0 < c.x1 && box.x1 > c.x0 && box.y0 < c.y1 && box.y1 > c.y0)) continue;
      claimed.push(box);
      ctx.globalAlpha = clamp(1 - (s.z - 34) / 18, 0.25, 1);
      ctx.fillStyle = u.dead ? 'rgba(150,152,166,0.8)'
        : u.boss ? '#ffd166'
          : u.side === 0 ? 'rgba(226,238,255,0.95)' : 'rgba(255,206,196,0.95)';
      ctx.fillText(text, s.x, y);
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


  /* ------------------------------------------------------------------ sky

     A skybox in a software renderer is not a cube of textures; it is whatever
     you can draw before the board that behaves as though it were infinitely
     far away. Which is the whole trick here: put a point 900 m along a
     direction from the CAMERA and hand it to the same projection everything
     else uses, and it parallaxes correctly for free — it swings with yaw,
     rises and falls with pitch, and never moves when the camera dollies,
     because 900 m is far enough that a few metres of travel is nothing.
     No new maths, no second pipeline, and the horizon lands exactly where
     the ground plane says it should.

     Everything below is drawn in one order: gradient, stars, sun, ridge,
     haze, motes. Each layer is optional and each is driven entirely by the
     zone's data, so a new zone is a new object and not a new code path. */

  const SKY_R = 900;

  // a direction on the celestial sphere, as a point the projector will accept
  function skyPoint(v, az, alt) {
    const ca = Math.cos(alt);
    return screenOf(v,
      v.cam.x + Math.sin(az) * ca * SKY_R,
      v.cam.y + Math.sin(alt) * SKY_R,
      v.cam.z + Math.cos(az) * ca * SKY_R);
  }

  // cheap value noise on a ring, so a ridge line is stable frame to frame
  function ridgeAt(r, az) {
    const f = az * r.freq / (Math.PI * 2) * 8;
    let sum = 0, amp = 1, tot = 0;
    for (let o = 0; o < 3; o++) {
      const k = f * (1 << o), i = Math.floor(k), t = k - i;
      const a = hash((i + r.seed * 131 + o * 977) & 8191);
      const b = hash((i + 1 + r.seed * 131 + o * 977) & 8191);
      const sm = t * t * (3 - 2 * t);
      sum += (a + (b - a) * sm) * amp; tot += amp; amp *= 0.5;
    }
    let n = sum / tot;
    // teeth pushes the profile from rolling hills toward broken silhouette
    n = n * (1 - r.teeth) + Math.pow(n, 2.4) * r.teeth * 1.6;
    return r.base + n * r.amp;
  }

  function starField(z) {
    if (!z.stars) return null;
    if (z._stars && z._stars.length === z.stars) return z._stars;
    const rnd = U.rng(z.id.length * 7717 + z.stars);
    const out = [];
    for (let i = 0; i < z.stars; i++) {
      out.push({
        az: rnd() * Math.PI * 2,
        // biased upward: nobody looks for stars at their feet
        alt: (2 + Math.pow(rnd(), 0.65) * 76) * (Math.PI / 180),
        m: 0.35 + rnd() * 0.65, tw: rnd() * 6.3
      });
    }
    z._stars = out;
    return out;
  }

  function drawSky(v, g, dt) {
    const ctx = v.ctx, z = g.zone || (K.zones ? K.zones.LIST[0] : null);
    if (!z) return;
    const hy = clamp(v.horizonY, -v.h * 3, v.h * 2.5);

    // 1. the gradient, hung off the horizon so it tilts with the camera
    const grad = ctx.createLinearGradient(0, hy - v.h * 1.35, 0, hy);
    const st = z.sky.stops;
    grad.addColorStop(0, st[0]); grad.addColorStop(0.45, st[1]);
    grad.addColorStop(0.80, st[2]); grad.addColorStop(1, st[3]);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, v.w, v.h);

    // 2. stars, before the sun, so the sun's glow washes them out
    const stars = starField(z);
    if (stars) {
      ctx.fillStyle = '#ffffff';
      for (const s of stars) {
        const p = skyPoint(v, s.az, s.alt);
        if (!p || p.y > hy) continue;
        ctx.globalAlpha = s.m * (0.55 + 0.45 * Math.sin(g.t * 1.7 + s.tw)) * 0.9;
        const r = 0.6 + s.m * 1.1;
        ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
      }
      ctx.globalAlpha = 1;
    }

    // 3. the sun or moon, with the glow doing most of the work
    if (z.sun) {
      const p = skyPoint(v, z.sun.az, z.sun.alt);
      if (p) {
        const rad = z.sun.r * v.f;
        const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * z.sun.glowR);
        gr.addColorStop(0, css(rgb(z.sun.glow), z.sun.glowA));
        gr.addColorStop(0.35, css(rgb(z.sun.glow), z.sun.glowA * 0.30));
        gr.addColorStop(1, css(rgb(z.sun.glow), 0));
        ctx.fillStyle = gr; ctx.fillRect(0, 0, v.w, v.h);
        ctx.fillStyle = z.sun.col;
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, 7); ctx.fill();
      }
    }

    // 4. the horizon. Sampled from behind the camera round to behind it
    //    again, so the visible arc is always one unbroken run of points and
    //    never has to be stitched across the wrap.
    if (z.ridge) {
      const N = 96, span = Math.PI, y0 = v.cam.yaw !== undefined ? v.cam.yaw : 0;
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const az = y0 - span + (i / N) * span * 2;
        const p = skyPoint(v, az, ridgeAt(z.ridge, az));
        if (!p) continue;
        pts.push({ x: clamp(p.x, -v.w * 8, v.w * 9), y: p.y });
      }
      if (pts.length > 2) {
        ctx.fillStyle = z.ridge.col;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        // close down past the bottom of the frame; the board covers the seam
        ctx.lineTo(pts[pts.length - 1].x, v.h + 40);
        ctx.lineTo(pts[0].x, v.h + 40);
        ctx.closePath(); ctx.fill();
      }
    }

    // 5. haze: the band that makes a horizon a distance rather than an edge
    if (z.sky.haze && hy > -v.h) {
      const band = v.h * 0.30;
      const hz = ctx.createLinearGradient(0, hy - band, 0, hy + band * 0.5);
      hz.addColorStop(0, css(rgb(z.sky.haze), 0));
      hz.addColorStop(0.72, css(rgb(z.sky.haze), z.sky.hazeA));
      hz.addColorStop(1, css(rgb(z.sky.haze), 0));
      ctx.fillStyle = hz; ctx.fillRect(0, hy - band, v.w, band * 1.5);
    }

    // 6. weather. Screen space on purpose: ash and mist are near the camera,
    //    not on the sky sphere, and at this cost they can be per-frame.
    if (z.motes) {
      if (!v.motes || v.motes.z !== z.id) {
        const rnd = U.rng(z.id.length * 331 + 7);
        const list = [];
        for (let i = 0; i < z.motes.n; i++) list.push({ x: rnd(), y: rnd(), s: 0.4 + rnd(), d: rnd() * 6.3 });
        v.motes = { z: z.id, list };
      }
      const m = z.motes;
      ctx.fillStyle = m.col;
      for (const p of v.motes.list) {
        p.y += (m.rise ? -1 : 1) * m.speed * p.s * dt;
        p.x += Math.sin(g.t * 0.5 + p.d) * 0.00035;
        if (p.y > 1.05) p.y = -0.05; else if (p.y < -0.05) p.y = 1.05;
        ctx.globalAlpha = m.a * (0.45 + 0.55 * Math.sin(g.t * 2 + p.d)) * 0.9;
        const r = m.size * p.s;
        ctx.beginPath(); ctx.arc(p.x * v.w, p.y * v.h, r, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }


  /* ------------------------------------------------------------ the ground

     Measured at the game's own camera: the horizon sits 224 px ABOVE the top
     of the frame. Every pixel on screen is therefore looking at ground, and
     the empty band above the board is not sky at all — it is the ground plane
     25 to 35 m out, which the renderer was drawing as nothing. That band is
     what made the board read as a slab floating in a void.

     So the world gets a floor. It is drawn as concentric squares from far to
     near, each filled at its own fog depth, which gives banded aerial
     perspective for the cost of a dozen polygons and lets the plane fade into
     the zone's fog exactly where the arena's own fog takes over. When the
     player orbits the camera down and the true horizon comes into frame, this
     plane meets it on its own, because it is real geometry and not a gradient
     pretending to be one. */

  function drawGround(v, g, z) {
    if (!z) return;
    const ctx = v.ctx, c = v.cam;
    const arena = g.battle.arena;
    // sit it just under the arena's lowest deck so it never z-fights the board
    let base = 1e9;
    for (const s of arena.surfaces) base = Math.min(base, s.y - Math.max(0.18, s.solid));
    if (!isFinite(base)) base = 0;
    base -= 0.35;

    /* This began as twelve concentric quads, each filled at its own fog depth.
       At a grazing angle those compress toward the horizon and the steps
       between them became visible stripes right across the top of the frame —
       measured on the Glasswaste, four hard value steps at y = 18, 64, 122 and
       195 that read as bands of sky.

       An infinite plane seen from a fixed height has a closed form: a screen
       row an angle A below the horizon is looking at ground camH / tan(A) away.
       So the whole floor is one vertical gradient whose stops are sampled from
       that distance, which is both exact and free of steps — a gradient
       interpolates where twelve quads could only jump. */
    const earth = rgb(z.ground.col);
    const fn = v.fogNear || FOG_NEAR, ff = v.fogFar || FOG_FAR;
    const camH = Math.max(0.5, c.y - base);
    const hz = clamp(v.horizonY, -v.h * 6, v.h);
    if (hz >= v.h) return;
    const grad = ctx.createLinearGradient(0, hz, 0, v.h);
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const ang = ((hz + (v.h - hz) * t) - hz) / v.f;   // radians below horizon
      const d = ang > 1e-4 ? camH / Math.tan(ang) : 1e7;
      const fogT = clamp((d - fn) / (ff - fn), 0, 1);
      // held under the deck's own value: the arena is the lit thing, the
      // ground around it is not, and without that gap the board stops
      // reading as a board and becomes a patch of ground with pieces on it
      grad.addColorStop(t, css(mix(mix(earth, [8, 9, 14], 0.62 * (1 - fogT)),
        v.fog, Math.pow(fogT, 0.8) * 0.96), 1));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, Math.max(0, hz), v.w, v.h - Math.max(0, hz));
  }

  /* ---------------------------------------------------------------- frame */

  function frame(v, g, dt) {
    const ctx = v.ctx;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    const zone = g.zone || (K.zones ? K.zones.LIST[0] : null);
    v.fog = zone ? zone.fog : FOG;
    v.fogNear = zone ? zone.near : FOG_NEAR;
    v.fogFar = zone ? zone.far : FOG_FAR;
    const cam = g.cam;
    const sh = cam.shake;
    setCamera(v, cam, (Math.random() - 0.5) * sh * 12, (Math.random() - 0.5) * sh * 12);

    drawSky(v, g, dt);
    drawGround(v, g, zone);

    /* There used to be a fixed blue wash here, standing in for a world the
       renderer did not have: it turned the void under the board into "a room".
       There is a real ground plane now, and the wash was a cold blue circle
       painted straight over the top of it — in the Ashfall it read as a sheet
       of grey slate lying across a rust-coloured desert. The world replaced
       the trick, so the trick goes. */

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
    const ax = (sx - v.w / 2) / v.f, ay = (v.my - sy) / v.f;
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

  /* The distance at which the whole arena sits inside the band, with room to
     spare — the far end of the zoom, and the number every other distance is
     expressed as a fraction of. */
  function fitDistance(v, arena, cam) {
    if (!v.w || !v.h) return 26;
    const T = K.grid.TILE;
    const pts = [];
    for (const s of arena.surfaces) {
      const w = arena.world(s);
      pts.push([w.x - T / 2, s.y, w.z - T / 2], [w.x + T / 2, s.y, w.z + T / 2],
               [w.x + T / 2, s.y + 1.8, w.z - T / 2], [w.x - T / 2, s.y + 1.8, w.z + T / 2]);
    }
    // the whole board is only ever framed centred, so it is measured centred
    const bias0 = v.frameBias;
    v.frameBias = 0.5;
    const availW = v.w * 0.94;
    const availH = Math.max(140, v.h - v.band.top - v.band.bottom) * 0.94;
    const probe = { tx: 0, ty: 1.1, tz: 0, yaw: cam.yaw, pitch: cam.pitch, dist: 26, fov: cam.fov };
    let d = 26;
    for (let it = 0; it < 5; it++) {
      probe.dist = d;
      const ch = Math.cos(probe.pitch);
      probe.x = probe.tx - Math.sin(probe.yaw) * ch * d;
      probe.y = probe.ty + Math.sin(probe.pitch) * d;
      probe.z = probe.tz - Math.cos(probe.yaw) * ch * d;
      setCamera(v, probe, 0, 0);
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const p of pts) {
        const s = screenOf(v, p[0], p[1], p[2]);
        if (!s) continue;
        if (s.x < x0) x0 = s.x; if (s.x > x1) x1 = s.x;
        if (s.y < y0) y0 = s.y; if (s.y > y1) y1 = s.y;
      }
      if (x1 <= x0) break;
      const k = Math.max((x1 - x0) / availW, (y1 - y0) / availH);
      d = clamp(d * (0.35 + 0.65 * k), 8, 70);
      if (Math.abs(k - 1) < 0.02) break;
    }
    v.frameBias = bias0;
    return d;
  }

  return { View, resize, frame, pick, Camera, camUpdate, screenOf, fitDistance, SIDE,
    // for measuring: where the renderer thinks the horizon and the lens are
    probe: (v) => ({ horizonY: v.horizonY, my: v.my, f: v.f, h: v.h, w: v.w }) };
})();
