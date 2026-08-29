/* IRONWAKE — the arena.
   A tactics map is not a heightmap: a bridge has to be able to cross over a
   courtyard, and a unit has to be able to stand on either. So a tile is a
   COLUMN holding any number of walkable surfaces, each with its own height,
   terrain and cover. Movement, ranging and line of sight all work on
   surfaces, which is what makes a genuinely multi-level arena possible. */
K.grid = (function () {
  const U = K.util;
  const { clamp } = U;

  const TILE = 1.7;              // metres per tile
  const CLIMB = 0.62;            // step up you can take without a cost
  const DROP = 1.25;             // and the most you will drop of your own will
  const HOP = 1.5;               // gap you can cross for extra movement

  const TERRAIN = {
    stone:  { name: 'stone',  cost: 1, avoid: 0,  def: 0, col: '#4a4f60' },
    grass:  { name: 'turf',   cost: 1, avoid: 5,  def: 0, col: '#3f5348' },
    rubble: { name: 'rubble', cost: 2, avoid: 10, def: 1, col: '#584f45' },
    roof:   { name: 'roof',   cost: 1, avoid: 5,  def: 0, col: '#5a4a52' },
    bridge: { name: 'bridge', cost: 1, avoid: 0,  def: 0, col: '#655244' },
    stair:  { name: 'stair',  cost: 1, avoid: 0,  def: 0, col: '#514f5c' },
    fort:   { name: 'rampart',cost: 2, avoid: 20, def: 2, col: '#6a5a64' }
  };

  function key(x, z, i) { return x + ',' + z + ',' + i; }

  function Arena(seed) {
    const rnd = U.rng(seed);
    const a = { w: 14, d: 14, cols: new Map(), surfaces: [], props: [], seed };

    function col(x, z) {
      const k = x + ',' + z;
      let c = a.cols.get(k);
      if (!c) { c = []; a.cols.set(k, c); }
      return c;
    }
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
      c.sort((p, q) => p.y - q.y);
      c.forEach((v, i) => { v.i = i; });
      a.surfaces.push(s);
      return s;
    }
    a.put = put;
    a.col = (x, z) => a.cols.get(x + ',' + z) || [];

    /* ---- the arena itself: a courtyard, two roofs, a bridge over the middle,
       a rampart on the high side and a pit you can be knocked into */
    for (let x = 0; x < a.w; x++) {
      for (let z = 0; z < a.d; z++) {
        const edge = x === 0 || z === 0 || x === a.w - 1 || z === a.d - 1;
        const pit = x >= 6 && x <= 8 && z >= 6 && z <= 8;
        if (pit) continue;                                  // the drop
        // the building and the rampart are solid masses, not roofed rooms:
        // nothing walks under them, so nothing is built under them
        if (x >= 1 && x <= 4 && z >= 1 && z <= 4) continue;
        if (x >= 9 && x <= 12 && z >= 9 && z <= 12) continue;
        const t = edge ? 'stone' : (rnd() < 0.18 ? 'grass' : 'stone');
        put(x, z, 0, t, 3);
      }
    }
    // West building: two storeys. Every rise on the stair is inside CLIMB, so
    // the route up is walkable in both directions — a staircase you can only
    // fall down is a bug, not a level.
    for (let x = 1; x <= 4; x++) for (let z = 1; z <= 4; z++) put(x, z, 2.2, 'roof', 2.2);
    put(5, 4, 0.55, 'stair', 0.55); put(5, 3, 1.10, 'stair', 1.10);
    put(5, 2, 1.65, 'stair', 1.65); put(5, 1, 2.20, 'stair', 2.20);
    // east rampart, one storey, with its own short flight up from the middle
    for (let x = 9; x <= 12; x++) for (let z = 9; z <= 12; z++) put(x, z, 1.5, 'fort', 1.5);
    put(9, 8, 0.50, 'stair', 0.50); put(10, 8, 1.00, 'stair', 1.00);
    // The bridge: off the roof at (4,4), across the pit, down onto the rampart.
    // It lands on a low ramp tile so the crossing works from both ends.
    for (let z = 5; z <= 9; z++) put(7, z, 2.2, 'bridge', 0.25);
    put(6, 5, 2.2, 'bridge', 0.25); put(5, 5, 2.2, 'bridge', 0.25); put(4, 5, 2.2, 'bridge', 0.25);
    put(8, 9, 2.2, 'bridge', 0.25); put(9, 9, 1.95, 'bridge', 0.45);
    // scattered cover
    for (let n = 0; n < 14; n++) {
      const x = 1 + Math.floor(rnd() * (a.w - 2)), z = 1 + Math.floor(rnd() * (a.d - 2));
      const c = a.col(x, z);
      if (c.length === 1 && c[0].y === 0) { c[0].terrain = 'rubble'; c[0].t = TERRAIN.rubble; }
    }
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
          // is something directly overhead in the way?
          const head = a.col(s.x + dx, s.z + dz).find(o => o.y > n.y + 0.1 && o.y < n.y + 1.7);
          if (head) continue;
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

  return { TILE, CLIMB, DROP, HOP, TERRAIN, Arena };
})();
