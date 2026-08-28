/* KINESIS — the decision layer.
   Deliberately thin: it reads the deck ahead, picks a line and a take-off,
   and gets out of the way. REFLEX buys lookahead and timing precision.
   Everything it gets wrong is handed to the behaviour stack, which is the
   part worth watching. */
K.ai = (function () {
  const U = K.util, E = K.euphoria;
  const { clamp } = U;
  const G = 11.2;

  function range(vz, vy, dy) {
    const disc = vy * vy - 2 * G * dy;
    if (disc < 0) return -1;
    const t = (vy + Math.sqrt(disc)) / G;
    return (vz + vy * 0.22) * t;
  }

  /* how far can this line be run before something stops it? */
  function laneScore(level, x, z, y, look) {
    let clear = look;
    for (const o of level.scan(z, look)) {
      if (x < o.x0 - 0.34 || x > o.x1 + 0.34) continue;
      const h = o.y1 - y;
      if (o.kind === 'bar') continue;             // duck, don't dodge
      if (h < 0.3) continue;
      const cost = o.vaultable === false ? 0 : 4; // a vaultable crate is survivable
      clear = Math.min(clear, (o.z0 - z) + cost);
    }
    const gap = level.gapAhead(x, z + 0.4, y, look);
    if (gap && gap.width > 6) clear = Math.min(clear, gap.start - z + 2);
    return clear;
  }

  function think(c, level, dt) {
    const st = c.stats;
    const b = c.body, pel = b.parts.pelvis;
    c.intent.duck = false;
    c.targetSpeed = U.approach(c.targetSpeed, st.speed, 0.55, dt);

    if (c.duckT > 0) { c.duckT -= dt; c.intent.duck = true; }
    if (!c.com) return;                       // nothing sensed yet, first step
    if (c.state !== E.S.RUN && c.state !== E.S.STAGGER) return;

    const x = c.com.x, z = pel.z, y = pel.y;
    const look = 2.2 + Math.abs(c.speed) * (0.34 + st.reflex * 0.10);
    const ground = level.groundAt(x, z, y);
    const gy = ground ? ground.y : y - 1.2;
    const err = 1 - clamp(st.reflex * 0.75, 0, 0.92);

    // ---------- keep it on the deck, first and always
    c.laneT = (c.laneT || 0) - dt;
    const here = level.deckAt(x, z + 0.5, y);
    c.edgeFear = 0;
    if (here) {
      const mid0 = (here.x0 + here.x1) / 2, edge = (here.x1 - here.x0) / 2;
      const out = Math.abs(x - mid0) - (edge - 1.4);
      if (out > 0) {
        // edge instinct: aim for the middle, and stop trying to sprint while
        // you are busy not falling off a building
        c.laneX = mid0; c.laneT = 0.25;
        c.edgeFear = clamp(out / 1.2, 0, 1);
        c.targetSpeed *= 1 - 0.45 * c.edgeFear;
      }
    }
    const deck = level.deckAt(x, z + 2, y);
    if (c.laneT <= 0) {
      c.laneT = 0.18;
      const half = deck ? Math.max(0.2, (deck.x1 - deck.x0) / 2 - 0.9) : 1.2;
      const mid = deck ? (deck.x0 + deck.x1) / 2 : 0;
      const cands = [];
      for (const l of [-2.0, -1.0, 0, 1.0, 2.0]) {
        const cx = clamp(mid + l, mid - half, mid + half);
        if (cands.some(v => Math.abs(v.x - cx) < 0.2)) continue;
        const s = laneScore(level, cx, z, gy, 22) - Math.abs(cx - x) * (1.4 + err * 1.6);
        cands.push({ x: cx, s });
      }
      cands.sort((a, b2) => b2.s - a.s);
      const pick = cands[0];
      // hysteresis: changing line costs speed and balance, so a new line has
      // to be clearly better, not marginally better
      const cur = cands.find(v => Math.abs(v.x - c.laneX) < 0.55);
      const curScore = cur ? cur.s : -Infinity;
      if (pick && pick.s > curScore + 3.5 && Math.abs(pick.x - c.laneX) > 0.3
          && Math.random() < 0.55 + st.reflex * 0.3) {
        c.laneX = pick.x;
        c.laneT = 0.5;
      }
      if (deck) c.laneX = clamp(c.laneX, mid - half, mid + half);
    }

    // ---------- jammed against something: change the line and hop over it
    if (Math.abs(c.speed) < 0.8) c.stuckT = (c.stuckT || 0) + dt; else c.stuckT = 0;
    if (c.stuckT > 0.7) {
      c.stuckT = 0;
      const mid2 = here ? (here.x0 + here.x1) / 2 : 0;
      const half2 = here ? Math.max(0.2, (here.x1 - here.x0) / 2 - 0.9) : 1.2;
      c.laneX = clamp(mid2 + (x > mid2 ? -1.6 : 1.6), mid2 - half2, mid2 + half2);
      c.laneT = 0.6;
      E.requestJump(c, 0.9);
      return;
    }

    // ---------- solid things in the way
    for (const o of level.scan(z + 0.1, look + 2)) {
      if (o.z1 < z + 0.1) continue;
      const d = o.z0 - z;
      if (d > look) break;
      if (x < o.x0 - 0.35 || x > o.x1 + 0.35) continue;
      const h = o.y1 - gy;

      if (o.kind === 'bar') {
        if (o.y0 - gy > 0.7 && d < 1.1 + Math.abs(c.speed) * 0.22) {
          if (Math.random() < 0.985 - err * 0.45) c.duckT = Math.max(c.duckT || 0, 0.45);
        }
        continue;
      }
      if (h < 0.3) continue;
      if (c.lastActionZ !== undefined && Math.abs(c.lastActionZ - o.z0) < 0.5) continue;

      if (h <= 1.25 && o.vaultable !== false) {
        const trigger = 0.62 + Math.abs(c.speed) * 0.11 + (Math.random() - 0.5) * 0.5 * err;
        if (d < trigger && Math.abs(c.speed) > 1.5) {
          c.lastActionZ = o.z0;
          if (E.requestVault(c, o)) return;
        }
      } else {
        const need = h + 0.4;
        const maxV = (2.7 + st.legPower * 1.5) * 1.25;
        const vy = Math.sqrt(Math.max(0, 2 * G * need)) * 1.05;
        const power = clamp(vy / maxV * 1.25, 0.5, 1.25);
        if (d < 0.8 + Math.abs(c.speed) * 0.10) {
          c.lastActionZ = o.z0;
          E.requestJump(c, power);
          return;
        }
      }
    }

    // ---------- holes
    const gap = level.gapAhead(x, z + 0.35, gy, look + 2.5);
    if (gap) {
      const d = gap.start - z;
      const dy = (gap.landing === null ? gy - 3 : gap.landing) - gy;
      // Over-jumping a gap costs nothing. Under-jumping it costs the run.
      // So the take-off is chosen with a margin, and only mistimed by however
      // sloppy the reflexes are.
      const needed = (gap.width + 0.7 + Math.max(0, d)) * 1.25;
      const maxV = (2.7 + st.legPower * 1.5) * 1.25;
      let power = 1.25, ok = false;
      for (let p = 0.7; p <= 1.251; p += 0.05) {
        if (range(Math.abs(c.speed), maxV * (p / 1.25), dy) >= needed) { power = p; ok = true; break; }
      }
      const trigger = 0.45 + Math.abs(c.speed) * 0.09 + (Math.random() - 0.45) * 0.40 * err;
      // do not spam the request every substep: one intent per approach
      if (d < trigger && c.lastActionZ !== gap.start) {
        c.lastActionZ = gap.start;
        c.plannedGap = { width: gap.width, ok };
        E.requestJump(c, power * (1 + (Math.random() - 0.5) * 0.10 * err));
      }
    }
  }

  return { think, range, laneScore };
})();
