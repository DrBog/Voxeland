/* KINESIS — the route, running away from the camera along +z.
   An elevated deck through a city: gaps to clear, blocks to vault, bars to
   duck, narrow spans where the balance simulation is the whole game, and a
   long fall on both sides. Districts change the physics, not only the
   palette. A gate is geometry sized so that the stat it names is the stat
   that clears it — nothing checks a number and waves you through. */
K.world = (function () {
  const U = K.util;
  const { clamp, lerp } = U;

  const LANES = [-2.0, 0, 2.0];
  const HALF = 5.2;

  const DISTRICTS = [
    { name: 'THE FLATS', tag: 'low decks, sodium light', end: 150,
      sky: ['#0d1424', '#22304c', '#77452f', '#e0894a'], build: '#0d1524', accent: '#ffb057',
      friction: 1, wind: 0, gap: 1, density: 0.5, narrow: 0, mult: 1 },
    { name: 'NIGHT MARKET', tag: 'wire, awnings, neon spill', end: 470,
      sky: ['#160f24', '#33204a', '#7d2550', '#ff5f7a'], build: '#150e22', accent: '#ff5f9e',
      friction: 0.95, wind: 0, gap: 1.12, density: 0.85, narrow: 0.12, mult: 1.9 },
    { name: 'THE STACKS', tag: 'towers, long air', end: 950,
      sky: ['#0a1220', '#17304e', '#2b6a8a', '#79d0d8'], build: '#0a1420', accent: '#79d0d8',
      friction: 1, wind: 0.6, gap: 1.35, density: 0.7, narrow: 0.25, mult: 3.6 },
    { name: 'GLASSWORKS', tag: 'wet glass, no grip', end: 1750,
      sky: ['#0d1a1c', '#14403c', '#2f7d63', '#c8e6a0'], build: '#0b1c20', accent: '#9ff2c0',
      friction: 0.34, wind: 0.3, gap: 1.25, density: 0.9, narrow: 0.2, mult: 7 },
    { name: 'THE VEINS', tag: 'steam, low steel', end: 3000,
      sky: ['#1a0f12', '#3b1a24', '#8a3a2a', '#ffb36b'], build: '#1a1014', accent: '#ff8a5c',
      friction: 0.9, wind: 0, gap: 1.2, density: 1.35, narrow: 0.2, mult: 14 },
    { name: 'UPPER SPINE', tag: 'crosswind, thin deck', end: 5200,
      sky: ['#06101f', '#12294d', '#3a4f9a', '#a8b6ff'], build: '#08101e', accent: '#a8b6ff',
      friction: 0.85, wind: 1.7, gap: 1.5, density: 0.8, narrow: 0.5, mult: 32 },
    { name: 'THE CROWN', tag: 'everything, at once', end: Infinity,
      sky: ['#0b0713', '#2a1140', '#6b1f6b', '#ffd36b'], build: '#120b1c', accent: '#ffd36b',
      friction: 0.75, wind: 1.1, gap: 1.6, density: 1.2, narrow: 0.45, mult: 78 }
  ];

  const GATES = [
    { at: 140, name: 'THE JUNCTION', kind: 'gap', stat: 'legPower', need: 5, blurb: 'A six-lane cut with nothing under it.' },
    { at: 460, name: 'SHUTTER ROW', kind: 'wall', stat: 'grip', need: 6, blurb: 'Too tall to vault. Catch the lip or wear it.' },
    { at: 940, name: 'THE LEAP', kind: 'speed', stat: 'flow', need: 7, blurb: 'Three decks, no room to gather.' },
    { at: 1740, name: 'THE GLASSHOUSE', kind: 'slick', stat: 'balance', need: 9, blurb: 'Wet glass, one metre wide. Stay over your feet.' },
    { at: 2980, name: 'PIPE ALLEY', kind: 'pipes', stat: 'reflex', need: 11, blurb: 'Low steel at head height, three in a row.' },
    { at: 5180, name: 'THE DROP', kind: 'chasm', stat: 'conditioning', need: 13, blurb: 'Nine metres down onto a ledge you have to want.' },
    { at: 8200, name: 'THE CROWN', kind: 'crown', stat: 'all', need: 15, blurb: 'The whole city, in eighty metres.' }
  ];

  function districtIndex(d) {
    for (let i = 0; i < DISTRICTS.length; i++) if (d < DISTRICTS[i].end) return i;
    return DISTRICTS.length - 1;
  }

  function Level(seed, statLevel) {
    const rnd = U.rng(seed);
    const lv = {
      seed, boxes: [], cells: new Map(), ledges: [], props: [], towers: [],
      headZ: 0, lastTop: 0, tailZ: -40, gatesHit: [], statLevel, towerZ: -40
    };

    function push(b) {
      lv.boxes.push(b);
      const c0 = Math.floor(b.z0 / 8), c1 = Math.floor(b.z1 / 8);
      for (let c = c0; c <= c1; c++) {
        if (!lv.cells.has(c)) lv.cells.set(c, []);
        lv.cells.get(c).push(b);
      }
      return b;
    }

    function deck(z0, z1, top, opts) {
      opts = opts || {};
      const half = opts.half === undefined ? HALF : opts.half;
      const x = opts.x || 0;
      const b = push({
        x0: x - half, x1: x + half, y0: top - 0.9, y1: top, z0, z1,
        kind: opts.kind || 'deck', top,
        friction: opts.friction === undefined ? 1 : opts.friction,
        d: districtIndex(z0), seed: rnd()
      });
      if (opts.noLedge !== true) lv.ledges.push({ x, y: top, z: z0, half });
      return b;
    }

    function block(x, z0, z1, base, height, opts) {
      opts = opts || {};
      const half = opts.half === undefined ? 0.55 : opts.half;
      return push({
        x0: x - half, x1: x + half, y0: base, y1: base + height, z0, z1,
        kind: opts.kind || 'block', friction: opts.friction === undefined ? 1 : opts.friction,
        vaultable: opts.vaultable !== false, d: districtIndex(z0), seed: rnd()
      });
    }

    function prop(kind, x, y, z, s, d) { lv.props.push({ kind, x, y, z, s: s || 1, d, seed: rnd() }); }

    function towersTo(z) {
      while (lv.towerZ < z) {
        const d = districtIndex(lv.towerZ);
        for (const side of [-1, 1]) {
          const off = 6.5 + rnd() * 7;
          const w = 2.4 + rnd() * 4.5;
          const h = 6 + rnd() * (14 + d * 5);
          const base = lv.lastTop - 12 - rnd() * 8;
          lv.towers.push({
            x0: side * off - w / 2, x1: side * off + w / 2,
            y0: base, y1: base + h, z0: lv.towerZ, z1: lv.towerZ + 3 + rnd() * 5,
            d, seed: rnd(), lit: rnd()
          });
        }
        lv.towerZ += 5 + rnd() * 5;
      }
    }

    /* ---- gates: geometry tuned so the named stat is the one that pays */
    function buildGate(g, z, top) {
      const met = statLevel(g.stat) >= g.need;
      const mark = { gate: g, z, top, met, entryZ: z };
      lv.gatesHit.push(mark);
      prop('gatesign', 0, top, z + 1, 1, districtIndex(z));

      if (g.kind === 'gap') {
        deck(z, z + 6, top, { kind: 'gatepad' });
        const w = 3.1 + g.need * 0.36;
        deck(z + 6 + w, z + 6 + w + 20, top - 0.4);
        lv.headZ = z + 6 + w + 20; lv.lastTop = top - 0.4;
      } else if (g.kind === 'wall') {
        deck(z, z + 12, top, { kind: 'gatepad' });
        const h = 1.9 + g.need * 0.14;
        block(0, z + 12, z + 12.7, top, h, { half: HALF, kind: 'gatewall', vaultable: false });
        deck(z + 12.7, z + 30, top + h - 0.02);
        lv.headZ = z + 30; lv.lastTop = top + h - 0.02;
      } else if (g.kind === 'speed') {
        deck(z, z + 10, top, { kind: 'gatepad' });
        let cz = z + 10;
        for (let i = 0; i < 3; i++) {
          const w = 2.9 + g.need * 0.17 + i * 0.55;
          cz += w;
          const len = 5.5 - i * 0.9;
          deck(cz, cz + len, top + (i % 2 ? 0.6 : -0.3), { half: 2.6 });
          cz += len;
        }
        deck(cz + 3.6, cz + 22, top);
        lv.headZ = cz + 22; lv.lastTop = top;
      } else if (g.kind === 'slick') {
        let cz = z;
        for (let i = 0; i < 4; i++) {
          deck(cz, cz + 11, top + (i % 2 ? 0.5 : 0), { friction: 0.14, kind: 'glass', half: 1.05 });
          if (i % 2 === 0) block(0.4, cz + 6, cz + 6.6, top, 0.7, { friction: 0.2, kind: 'vent' });
          cz += 11 + 1.7;
        }
        deck(cz, cz + 18, top);
        lv.headZ = cz + 18; lv.lastTop = top;
      } else if (g.kind === 'pipes') {
        deck(z, z + 36, top, { kind: 'gatepad' });
        for (let i = 0; i < 3; i++) {
          block(0, z + 10 + i * 8, z + 10.5 + i * 8, top + 1.02 - i * 0.05, 0.30,
            { half: HALF, kind: 'bar', vaultable: false });
        }
        deck(z + 36, z + 48, top);
        lv.headZ = z + 48; lv.lastTop = top;
      } else if (g.kind === 'chasm') {
        deck(z, z + 10, top, { kind: 'gatepad' });
        const drop = 4.4 + g.need * 0.24, w = 3.6;
        deck(z + 10 + w, z + 10 + w + 4, top - drop, { kind: 'ledgepad', half: 2.4 });
        deck(z + 10 + w + 4, z + 10 + w + 24, top - drop - 0.4);
        lv.headZ = z + 10 + w + 24; lv.lastTop = top - drop - 0.4;
      } else {
        deck(z, z + 8, top, { kind: 'gatepad' });
        block(0, z + 12, z + 12.7, top, 1.7, { half: HALF, kind: 'gatewall', vaultable: false });
        deck(z + 12.7, z + 26, top + 1.68, { half: 1.6, friction: 0.2, kind: 'glass' });
        block(0, z + 20, z + 20.5, top + 2.7, 0.3, { half: HALF, kind: 'bar', vaultable: false });
        deck(z + 31, z + 48, top + 0.4);
        block(-1.6, z + 38, z + 38.8, top + 0.4, 0.85, { kind: 'crate' });
        block(1.6, z + 41, z + 41.8, top + 0.4, 0.85, { kind: 'crate' });
        deck(z + 53, z + 78, top - 1.2);
        lv.headZ = z + 78; lv.lastTop = top - 1.2;
      }
      mark.exitZ = lv.headZ;
    }

    /* ---- ordinary route */
    function segment() {
      const z = lv.headZ;
      const d = districtIndex(z);
      const D = DISTRICTS[d];

      const gate = GATES.find(g => !lv.gatesHit.some(h => h.gate === g) && z >= g.at - 24);
      if (gate) { buildGate(gate, z + 3, lv.lastTop); return; }

      // the first stretch is deliberately kind: a level-zero body needs
      // somewhere to find its feet before the city starts asking questions
      const warm = clamp(z / 420, 0, 1);
      const diff = clamp(z / 4000, 0, 1.4);
      // Gaps are sized against the legs that have to clear them. The route
      // gets harder because you get faster, not in spite of it — an idle
      // runner that meets an unjumpable hole just farms the same 40 metres
      // forever, and that is not a game, it is a wall.
      // Early gaps stay small for everybody. A fast runner meets them sooner
      // and mistimes more, so scaling the hole with the legs alone punished
      // exactly the players who had been training.
      const opening = clamp(z / 700, 0.35, 1);
      const jumpCap = (0.9 + statLevel('legPower') * 0.075 + statLevel('flow') * 0.03) * opening;
      // Not every block ends in a hole. Early districts are mostly continuous
      // deck with the occasional cut, so there is something to watch between
      // the jumps; the city gets more broken the further out it goes.
      const holeOdds = 0.30 + clamp(z / 2600, 0, 1) * 0.55;
      const gap = (z < 34 || rnd() > holeOdds) ? 0
        : Math.min(jumpCap, (0.7 + rnd() * (1.0 + diff * 1.7)) * D.gap * (0.45 + warm * 0.55));
      const len = lerp(16, 8, clamp(diff * 0.6 + rnd() * 0.4, 0, 1)) + rnd() * 6;
      let top = lv.lastTop + (rnd() - 0.45) * 2.4;
      top = clamp(top, -6, 6);
      if (Math.abs(top - lv.lastTop) > 2.2) top = lv.lastTop + Math.sign(top - lv.lastTop) * 2.2;

      const z0 = z + gap;
      const narrow = rnd() < D.narrow * warm;
      const half = narrow ? 1.4 + rnd() * 0.6 : HALF;
      const fr = D.friction * (rnd() < 0.12 ? 0.5 : 1);
      deck(z0, z0 + len, top, { friction: fr, half, kind: fr < 0.6 ? 'glass' : 'deck' });

      // obstacles
      let oz = z0 + 3.5;
      while (oz < z0 + len - 3) {
        if (rnd() < D.density * 0.5 * (0.15 + warm * 0.85)) {
          const roll = rnd();
          if (roll < 0.42 && !narrow) {
            // crate or vent in one or two lanes
            const lane = LANES[(rnd() * 3) | 0];
            block(lane, oz, oz + 0.7 + rnd() * 0.4, top, (0.30 + rnd() * (0.3 + diff * 0.3)) * (0.6 + warm * 0.4),
              { kind: rnd() < 0.5 ? 'vent' : 'crate', friction: fr, half: 0.62 });
            if (rnd() < 0.3) {
              const l2 = LANES[(rnd() * 3) | 0];
              if (Math.abs(l2 - lane) > 1) block(l2, oz, oz + 0.8, top, 0.55 + rnd() * 0.4, { kind: 'crate', half: 0.62 });
            }
          } else if (roll < 0.62) {
            block(0, oz, oz + 0.45, top + 1.02 + rnd() * 0.14, 0.30,
              { half: HALF, kind: 'bar', vaultable: false });
          } else if (roll < 0.80 && !narrow && z > 700) {
            const lane = LANES[(rnd() * 3) | 0];
            block(lane, oz, oz + 0.6, top, 1.8 + rnd() * 0.5, { kind: 'wall', vaultable: false, half: 0.7 });
          } else {
            block(0, oz, oz + 1.8 + rnd(), top, 0.26, { kind: 'step', friction: fr, half: half });
          }
          oz += 4.5;
        }
        oz += 2.6;
      }
      if (rnd() < 0.55) prop('antenna', (rnd() - 0.5) * half * 1.6, top, z0 + rnd() * len, 0.7 + rnd(), d);
      if (rnd() < 0.4) prop('lamp', (rnd() < 0.5 ? -1 : 1) * (half - 0.25), top, z0 + rnd() * len, 1, d);
      if (rnd() < 0.3) prop('sign', (rnd() < 0.5 ? -1 : 1) * (half + 0.6), top, z0 + rnd() * len, 0.8 + rnd() * 0.7, d);

      lv.lastTop = top;
      lv.headZ = z0 + len;
    }

    lv.ensure = function (z) {
      let guard = 0;
      while (lv.headZ < z + 120 && guard++ < 60) segment();
      towersTo(z + 150);
      if (lv.tailZ < z - 60) {
        const cut = z - 60;
        lv.boxes = lv.boxes.filter(b => b.z1 > cut);
        lv.ledges = lv.ledges.filter(l => l.z > cut);
        lv.props = lv.props.filter(p => p.z > cut);
        lv.towers = lv.towers.filter(t => t.z1 > cut);
        for (const k of Array.from(lv.cells.keys())) if (k * 8 < cut - 16) lv.cells.delete(k);
        lv.tailZ = cut;
      }
    };

    const EMPTY = [];
    lv.solidsNear = function (z, pad) {
      const c0 = Math.floor((z - pad) / 8), c1 = Math.floor((z + pad) / 8);
      if (c0 === c1) return lv.cells.get(c0) || EMPTY;
      const out = [];
      for (let c = c0; c <= c1; c++) {
        const a = lv.cells.get(c);
        if (a) for (const b of a) if (out.indexOf(b) < 0) out.push(b);
      }
      return out;
    };

    lv.groundAt = function (x, z, fromY) {
      const boxes = lv.solidsNear(z, 0.3);
      let best = null;
      for (const b of boxes) {
        if (b.kind === 'bar') continue;
        if (x < b.x0 - 0.06 || x > b.x1 + 0.06) continue;
        if (z < b.z0 - 0.06 || z > b.z1 + 0.06) continue;
        if (b.y1 <= fromY + 0.05 && (!best || b.y1 > best.y)) best = { y: b.y1, box: b };
      }
      return best;
    };

    lv.ledgeNear = function (x, y, z, r) {
      let best = null, bd = r;
      for (const l of lv.ledges) {
        if (l.z < z - 0.4) continue;
        const lx = clamp(x, l.x - l.half + 0.25, l.x + l.half - 0.25);
        const d = Math.hypot(lx - x, l.y - y, l.z - z);
        if (d < bd) { bd = d; best = { x: lx, y: l.y, z: l.z }; }
      }
      return best;
    };

    lv.scan = function (z, range) {
      const out = [];
      for (const b of lv.solidsNear(z + range / 2, range / 2 + 6)) {
        if (b.z1 < z || b.z0 > z + range) continue;
        if (b.kind === 'deck' || b.kind === 'glass' || b.kind === 'gatepad' || b.kind === 'ledgepad') continue;
        out.push(b);
      }
      out.sort((a, b) => a.z0 - b.z0);
      return out;
    };

    /* is there a hole between z and z+range on the line x? */
    lv.gapAhead = function (x, z, y, range) {
      let cz = z, edge = null;
      while (cz < z + range) {
        const g = lv.groundAt(x, cz, y + 0.4);
        if (!g || g.y < y - 2.4) { if (edge === null) edge = cz; }
        else if (edge !== null) return { start: edge, end: cz, width: cz - edge, landing: g.y };
        cz += 0.25;
      }
      return edge !== null ? { start: edge, end: z + range, width: z + range - edge, landing: null } : null;
    };

    /* how wide is the deck here, and where is its middle? */
    lv.deckAt = function (x, z, y) {
      const boxes = lv.solidsNear(z, 0.3);
      let best = null;
      for (const b of boxes) {
        if (b.kind === 'bar' || b.kind === 'block' || b.kind === 'wall') continue;
        if (z < b.z0 || z > b.z1) continue;
        if (b.y1 <= y + 0.6 && (!best || b.y1 > best.y1)) best = b;
      }
      return best;
    };

    lv.ensure(0);
    return lv;
  }

  return { DISTRICTS, GATES, LANES, HALF, districtIndex, Level };
})();
