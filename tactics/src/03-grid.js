/* IRONWAKE — the arena.
   A tactics map is not a heightmap: a bridge has to be able to cross over a
   courtyard, and a unit has to be able to stand on either. So a tile is a
   COLUMN holding any number of walkable surfaces, each with its own height,
   terrain and cover. Movement, ranging and line of sight all work on
   surfaces, which is what makes a genuinely multi-level arena possible.

   Maps are built, not drawn: a small kit of operations (ground, block, span,
   stairway, pit) and a handful of archetypes that compose them. A generated
   map is worthless if it is unfair or if half of it cannot be walked to, so
   nothing reaches the player until it has been checked — both lines placed,
   every spawn and every held position connected, real height, a real drop,
   and the two sides far enough apart to have a first turn. */
K.grid = (function () {
  const U = K.util;
  const { clamp } = U;

  const TILE = 1.7;              // metres per tile
  const CLIMB = 0.62;            // step up you can take without a cost
  const DROP = 1.25;             // and the most you will drop of your own will
  const HOP = 1.5;               // gap you can cross for extra movement
  const HEAD = 1.7;              // headroom a standing body needs

  const TERRAIN = {
    stone:  { name: 'stone',  cost: 1, avoid: 0,  def: 0, col: '#4a4f60' },
    grass:  { name: 'turf',   cost: 1, avoid: 5,  def: 0, col: '#3f5348' },
    rubble: { name: 'rubble', cost: 2, avoid: 10, def: 1, col: '#584f45' },
    roof:   { name: 'roof',   cost: 1, avoid: 5,  def: 0, col: '#5a4a52' },
    bridge: { name: 'bridge', cost: 1, avoid: 0,  def: 0, col: '#655244' },
    stair:  { name: 'stair',  cost: 1, avoid: 0,  def: 0, col: '#514f5c' },
    fort:   { name: 'rampart',cost: 2, avoid: 20, def: 2, col: '#6a5a64' }
  };

  /* ------------------------------------------------------------------ build */

  function Arena(seed, layoutName) {
    const rnd = U.rng(seed);
    const name = LAYOUTS[layoutName] ? layoutName : 'courtyard';
    const a = { w: 14, d: 14, cols: new Map(), surfaces: [], props: [], seed, layout: name };

    function col(x, z) {
      const k = x + ',' + z;
      let c = a.cols.get(k);
      if (!c) { c = []; a.cols.set(k, c); }
      return c;
    }
    function reindex(c) { c.sort((p, q) => p.y - q.y); c.forEach((v, i) => { v.i = i; }); }

    /* add a walkable surface to a column; `solid` is how far down it fills */
    function put(x, z, y, terrain, solid) {
      if (x < 0 || z < 0 || x >= a.w || z >= a.d) return null;
      const c = col(x, z);
      const s = {
        x, z, y, t: TERRAIN[terrain] || TERRAIN.stone, terrain,
        solid: solid === undefined ? 0.5 : solid,
        i: c.length, id: 0, occupant: null
      };
      c.push(s);
      reindex(c);
      a.surfaces.push(s);
      return s;
    }
    function drop(x, z, pred) {
      const c = col(x, z);
      for (let i = c.length - 1; i >= 0; i--) {
        if (pred && !pred(c[i])) continue;
        const s = c.splice(i, 1)[0];
        const j = a.surfaces.indexOf(s);
        if (j >= 0) a.surfaces.splice(j, 1);
      }
      reindex(c);
    }
    a.put = put;
    a.col = (x, z) => a.cols.get(x + ',' + z) || [];

    /* ---- the kit every layout is written in ---------------------------- */
    const inb = (x, z) => x >= 0 && z >= 0 && x < a.w && z < a.d;
    const kit = {
      rnd,
      /* the courtyard floor everything else is cut out of */
      ground(turf) {
        for (let x = 0; x < a.w; x++) for (let z = 0; z < a.d; z++) {
          const edge = x === 0 || z === 0 || x === a.w - 1 || z === a.d - 1;
          put(x, z, 0, edge ? 'stone' : (rnd() < (turf === undefined ? 0.18 : turf) ? 'grass' : 'stone'), 3);
        }
      },
      /* a solid mass: nothing walks under a building, so nothing is left there */
      block(x0, z0, x1, z1, y, terrain) {
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
          if (!inb(x, z)) continue;
          drop(x, z, s => s.y < y - 0.05);
          put(x, z, y, terrain || 'roof', y);
        }
      },
      /* a hole with nothing under it — the arena's own weapon */
      pit(x0, z0, x1, z1) {
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
          if (!inb(x, z)) continue;
          drop(x, z, s => s.solid >= 1);
        }
      },
      /* a walkway with air beneath it */
      span(x0, z0, x1, z1, y, terrain) {
        const dx = Math.sign(x1 - x0), dz = Math.sign(z1 - z0);
        const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
        for (let i = 0; i <= n; i++) {
          const x = x0 + dx * i, z = z0 + dz * i;
          if (!inb(x, z)) continue;
          if (a.col(x, z).some(s => Math.abs(s.y - y) < 0.06)) continue;
          put(x, z, y, terrain || 'bridge', 0.25);
        }
      },
      /* A flight of steps from one height to another, laid along a direction.
         The rise per step is whatever keeps it inside CLIMB, so a stair built
         by the kit is always walkable in both directions — which is the whole
         point of building maps out of a kit instead of by hand. */
      stairway(x, z, dx, dz, from, to, terrain) {
        const n = Math.max(1, Math.ceil(Math.abs(to - from) / CLIMB));
        let last = null;
        for (let i = 1; i <= n; i++) {
          const y = from + (to - from) * (i / n);
          const tx = x + dx * (i - 1), tz = z + dz * (i - 1);
          if (!inb(tx, tz)) break;
          // a landing that already exists at this height IS the step
          const there = a.col(tx, tz).find(s => Math.abs(s.y - y) < 0.08);
          if (there) { last = there; continue; }
          drop(tx, tz, s => s.y < y - 0.05 && s.solid >= 1);
          last = put(tx, tz, y, terrain || 'stair', y);
        }
        return last;
      },
      scatter(n, terrain) {
        for (let i = 0; i < n; i++) {
          const x = 1 + Math.floor(rnd() * (a.w - 2)), z = 1 + Math.floor(rnd() * (a.d - 2));
          const c = a.col(x, z);
          if (c.length === 1 && c[0].y === 0) { c[0].terrain = terrain || 'rubble'; c[0].t = TERRAIN[terrain || 'rubble']; }
        }
      },
      rect(x0, z0, x1, z1) {
        const out = [];
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (inb(x, z)) out.push([x, z]);
        return out;
      }
    };

    const plan = LAYOUTS[name](kit, rnd, a);
    a.surfaces.forEach((s, i) => { s.id = i; });

    /* Which sides of each slab can actually be seen? In a solid courtyard
       every tile hides its neighbours' walls, and drawing two hundred buried
       faces is most of what a software renderer would spend its frame on. */
    (function faces() {
      const span = (s) => ({ hi: s.y, lo: s.y - Math.max(0.2, s.solid) });
      for (const s of a.surfaces) {
        const me = span(s);
        s.open = [];
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c = a.col(s.x + dx, s.z + dz);
          const hidden = c.some(n => {
            const o = span(n);
            return o.hi >= me.hi - 1e-3 && o.lo <= me.lo + 1e-3;
          });
          s.open.push(!hidden);
        }
      }
    })();

    /* ---- movement graph */
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    /* is there room to stand here, or is something sitting on your head? */
    a.standable = function (s) {
      return !a.col(s.x, s.z).some(o => o.y > s.y + 0.1 && o.y < s.y + HEAD);
    };

    a.neighbours = function (s) {
      const out = [];
      for (const [dx, dz] of DIRS) {
        const c = a.col(s.x + dx, s.z + dz);
        for (const n of c) {
          const rise = n.y - s.y;
          if (rise > CLIMB + 0.02) continue;                 // too high to step
          // and no free ride down, either: if you could step off a roof the
          // stairs would be decoration and the bridge would mean nothing
          if (rise < -DROP) continue;
          if (!a.standable(n)) continue;                     // no headroom
          // a stair is a stair: it costs what it costs, without the climbing
          // surcharge that makes hauling yourself over a wall expensive
          const cost = n.t.cost + (rise > 0.35 && n.terrain !== 'stair' ? 1 : 0) + (rise < -0.65 ? 1 : 0);
          out.push({ s: n, cost, drop: rise < -0.65 });
        }
      }
      return out;
    };

    /* Dijkstra over surfaces: returns id -> { cost, from } */
    a.reach = function (from, move, blocked) {
      const best = new Map([[from.id, { cost: 0, from: null, s: from }]]);
      const q = [{ s: from, cost: 0 }];
      while (q.length) {
        q.sort((p, r) => p.cost - r.cost);
        const cur = q.shift();
        if (cur.cost > move) continue;
        for (const n of a.neighbours(cur.s)) {
          if (blocked && blocked(n.s)) continue;
          const c = cur.cost + n.cost;
          if (c > move) continue;
          const prev = best.get(n.s.id);
          if (!prev || c < prev.cost) {
            best.set(n.s.id, { cost: c, from: cur.s, s: n.s });
            q.push({ s: n.s, cost: c });
          }
        }
      }
      return best;
    };

    /* What every tile costs to walk to from here, with no movement limit —
       the map's own opinion of distance. Straight-line distance is a lie on a
       map with a rift in it: it will happily send a unit to the edge of a hole
       to stand and look at somebody six feet and one long walk away. */
    a.costsFrom = function (from) {
      const best = new Map([[from.id, 0]]);
      const q = [{ s: from, cost: 0 }];
      let head = 0;
      while (head < q.length) {
        // small graph, and it is only walked once per unit per turn
        let bi = head;
        for (let i = head + 1; i < q.length; i++) if (q[i].cost < q[bi].cost) bi = i;
        const tmp = q[head]; q[head] = q[bi]; q[bi] = tmp;
        const cur = q[head++];
        if (cur.cost > (best.get(cur.s.id) === undefined ? 1e9 : best.get(cur.s.id))) continue;
        for (const n of a.neighbours(cur.s)) {
          const c = cur.cost + n.cost;
          const prev = best.get(n.s.id);
          if (prev === undefined || c < prev) { best.set(n.s.id, c); q.push({ s: n.s, cost: c }); }
        }
      }
      return best;
    };

    /* everything you could walk to given all the time in the world */
    a.flood = function (from) {
      const seen = new Set([from.id]);
      const q = [from];
      while (q.length) {
        const cur = q.pop();
        for (const n of a.neighbours(cur)) {
          if (seen.has(n.s.id)) continue;
          seen.add(n.s.id); q.push(n.s);
        }
      }
      return seen;
    };

    a.pathTo = function (reachMap, target) {
      const out = [];
      let cur = reachMap.get(target.id);
      if (!cur) return null;
      while (cur) { out.unshift(cur.s); cur = cur.from ? reachMap.get(cur.from.id) : null; }
      return out;
    };

    /* grid distance ignoring height — Fire Emblem ranging, in three dimensions */
    a.dist = (p, q) => Math.abs(p.x - q.x) + Math.abs(p.z - q.z);

    a.at = function (x, z, y) {
      const c = a.col(x, z);
      let best = null;
      for (const s of c) if (!best || Math.abs(s.y - y) < Math.abs(best.y - y)) best = s;
      return best;
    };

    /* world position of a surface's centre */
    a.world = (s) => ({ x: (s.x - a.w / 2 + 0.5) * TILE, y: s.y, z: (s.z - a.d / 2 + 0.5) * TILE });

    /* is this surface over the pit — i.e. is there nothing under it to land on? */
    a.voidUnder = function (s) {
      const c = a.col(s.x, s.z);
      return !c.some(o => o.y < s.y - 0.1);
    };

    /* Every tile you can stand on with a hole beside it. This is the arena's
       own weapon — the tiles where a hard enough blow is lethal whatever the
       arithmetic said — and a map without enough of them is just a grid. */
    a.hazards = function () {
      const out = [];
      for (const s of a.surfaces) {
        if (!a.standable(s)) continue;
        for (const [dx, dz] of DIRS) {
          const nx = s.x + dx, nz = s.z + dz;
          if (nx <= 0 || nz <= 0 || nx >= a.w - 1 || nz >= a.d - 1) continue;
          if (a.col(nx, nz).length === 0) { out.push(s); break; }
        }
      }
      return out;
    };

    /* ---- where the two lines form up */
    const pick = (cells, high) => {
      const out = [];
      for (const [x, z] of cells) {
        const c = a.col(x, z);
        if (!c.length) continue;
        const s = high ? c[c.length - 1] : c[0];
        if (!a.standable(s)) continue;
        // a line forms up on solid ground, never on a plank over a hole
        if (!high && s.solid < 1) continue;
        out.push(s);
      }
      return out;
    };
    a.spawns = {
      player: pick(plan.player, false),
      enemy: pick(plan.enemy, false),
      guard: pick(plan.guard || [], true)
    };
    a.title = plan.title || name;

    /* The arena as something the physics solver can hit: every surface is a
       slab, bucketed by z so collision stays cheap with a dozen bodies. */
    a.collider = function () {
      const boxes = [], cells = new Map();
      for (const s of a.surfaces) {
        const w = a.world(s);
        const b = {
          x0: w.x - TILE / 2, x1: w.x + TILE / 2,
          y0: s.y - Math.max(0.2, s.solid), y1: s.y,
          z0: w.z - TILE / 2, z1: w.z + TILE / 2,
          friction: 1, surface: s
        };
        boxes.push(b);
        const c0 = Math.floor(b.z0 / 4), c1 = Math.floor(b.z1 / 4);
        for (let c = c0; c <= c1; c++) {
          if (!cells.has(c)) cells.set(c, []);
          cells.get(c).push(b);
        }
      }
      const EMPTY = [];
      return {
        boxes,
        solidsNear(z, pad) {
          const c0 = Math.floor((z - pad) / 4), c1 = Math.floor((z + pad) / 4);
          if (c0 === c1) return cells.get(c0) || EMPTY;
          const out = [];
          for (let c = c0; c <= c1; c++) {
            const arr = cells.get(c);
            if (arr) for (const b of arr) if (out.indexOf(b) < 0) out.push(b);
          }
          return out;
        },
        groundAt(x, z, fromY) {
          let best = null;
          for (const b of this.solidsNear(z, 0.3)) {
            if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
            if (b.y1 <= fromY + 0.05 && (!best || b.y1 > best.y)) best = { y: b.y1, box: b };
          }
          return best;
        }
      };
    };

    return a;
  }

  /* --------------------------------------------------------------- layouts */

  const LAYOUTS = {
    /* the original: a walled house, a rampart, and a bridge over a hole */
    courtyard(k) {
      k.ground();
      k.block(1, 1, 4, 4, 2.2, 'roof');
      k.stairway(5, 4, 0, -1, 0, 2.2);
      k.block(9, 9, 12, 12, 1.5, 'fort');
      k.stairway(9, 8, 1, 0, 0, 1.0);
      k.pit(6, 6, 8, 8);
      k.span(7, 5, 7, 9, 2.2);
      k.span(4, 5, 6, 5, 2.2);
      k.span(8, 9, 8, 9, 2.2);
      k.span(9, 9, 9, 9, 1.95);
      k.scatter(14);
      return {
        title: 'the courtyard',
        player: k.rect(1, 10, 3, 13),
        enemy: k.rect(9, 1, 12, 4),
        guard: k.rect(9, 9, 12, 12)
      };
    },

    /* a rift down the middle: one low plank, one high crossing, and the long
       way round the ends — every approach costs you something */
    chasm(k) {
      k.ground(0.26);
      k.pit(6, 2, 7, 11);
      k.span(6, 4, 7, 4, 0.35);
      k.block(4, 7, 5, 9, 1.7, 'fort');
      k.block(8, 7, 9, 9, 1.7, 'fort');
      k.span(6, 8, 7, 8, 1.7);
      k.stairway(1, 8, 1, 0, 0, 1.7);
      k.stairway(12, 8, -1, 0, 0, 1.7);
      k.scatter(16);
      return {
        title: 'the rift',
        player: k.rect(0, 10, 3, 13),
        enemy: k.rect(10, 0, 13, 3),
        guard: k.rect(8, 7, 9, 9)
      };
    },

    /* a keep in the middle with a moat either side: whoever holds the roof
       holds the battle, and the only ways up are two flights of steps */
    citadel(k) {
      k.ground(0.22);
      k.block(4, 4, 9, 9, 1.2, 'fort');
      k.block(5, 5, 8, 8, 2.4, 'roof');
      k.pit(3, 3, 3, 10);
      k.pit(10, 3, 10, 10);
      k.stairway(6, 2, 0, 1, 0, 1.2);
      k.stairway(7, 11, 0, -1, 0, 1.2);
      // two planks over the moat: a flank for anyone willing to cross a
      // one-tile bridge with a drop on both sides of it
      k.span(3, 6, 3, 6, 0.6);
      k.span(10, 7, 10, 7, 0.6);
      k.stairway(4, 6, 1, 0, 1.2, 2.4);
      k.stairway(9, 7, -1, 0, 1.2, 2.4);
      k.scatter(12);
      return {
        title: 'the keep',
        player: k.rect(3, 12, 10, 13),
        enemy: k.rect(3, 0, 10, 1),
        // they hold the north face of the roof; the south of it is yours to take
        guard: k.rect(5, 5, 8, 6)
      };
    },

    /* two towers and a walkway between them, with the floor missing under
       parts of it — the fastest route across is also the one with no rail */
    spires(k) {
      k.ground(0.20);
      k.block(1, 2, 3, 4, 2.6, 'roof');
      k.block(10, 9, 12, 11, 2.6, 'roof');
      k.span(4, 3, 10, 3, 2.6);
      k.span(11, 3, 11, 8, 2.6);
      k.pit(5, 2, 6, 4);
      k.pit(9, 6, 11, 7);
      k.stairway(5, 5, -1, 0, 0, 2.6);
      k.stairway(8, 12, 1, 0, 0, 2.6);
      k.scatter(14);
      return {
        title: 'the spires',
        player: k.rect(0, 10, 3, 13),
        enemy: k.rect(9, 0, 13, 2),
        guard: k.rect(10, 9, 12, 11)
      };
    }
  };

  /* -------------------------------------------------------------- checking */

  /* Everything that has to be true before a map is allowed in front of a
     player. A generator without one of these is a random map generator; with
     one it is a level designer that works quickly. */
  function check(a) {
    const sp = a.spawns;
    if (sp.player.length < 5) return 'nowhere for your line to stand';
    if (sp.enemy.length < 8) return 'nowhere for theirs';
    if (sp.guard.length < 2) return 'no high ground to hold';

    const reachable = a.flood(sp.player[0]);
    for (const s of sp.player) if (!reachable.has(s.id)) return 'your own line is cut in two';
    for (const s of sp.enemy) if (!reachable.has(s.id)) return 'the enemy cannot be reached';
    for (const s of sp.guard) if (!reachable.has(s.id)) return 'the high ground cannot be climbed';

    const standable = a.surfaces.filter(s => a.standable(s));
    if (reachable.size < standable.length * 0.6) return 'too much of the map is stranded';

    // the two lines need room to form up and a turn or two to close, and
    // nobody holding high ground may start inside your opening move
    let near = 99, held = 99;
    for (const p of sp.player) {
      for (const e of sp.enemy) near = Math.min(near, a.dist(p, e));
      for (const g of sp.guard) held = Math.min(held, a.dist(p, g));
    }
    if (near < 8) return 'the lines start on top of each other';
    // a guard wakes at five tiles, so six is the line between "they hold that
    // hill" and "you are shot at before you have moved"
    if (held < 6) return 'their high ground overlooks your start';

    // and it has to be a THREE dimensional arena, or none of this was worth it
    const levels = new Set(a.surfaces.map(s => Math.round(s.y * 4)));
    if (levels.size < 3) return 'the map is flat';
    if (a.hazards().length < 6) return 'nothing to be knocked into';
    return null;
  }

  /* build until one passes; a map that never passes is a bug, and falling
     back to the hand-built arena is better than shipping a broken board */
  function make(seed, opts) {
    const all = Object.keys(LAYOUTS);
    // two fields in a row on the same ground is the one thing a generator is
    // for avoiding, so last wave's map sits out of the draw
    const names = (opts && opts.avoid && all.length > 1)
      ? all.filter(n => n !== opts.avoid) : all;
    const rnd = U.rng((seed || 1) >>> 0);
    let last = null;
    for (let t = 0; t < 16; t++) {
      const name = (opts && opts.layout) || names[Math.floor(rnd() * names.length)];
      const a = Arena(((seed || 1) + t * 7919) >>> 0, name);
      const bad = check(a);
      if (!bad) { a.tries = t; return a; }
      a.problem = bad; last = a;
    }
    const fb = Arena(seed || 1, 'courtyard');
    fb.fallback = last ? last.problem : 'unknown';
    return fb;
  }

  return { TILE, CLIMB, DROP, HOP, HEAD, TERRAIN, Arena, LAYOUTS, make, check };
})();
