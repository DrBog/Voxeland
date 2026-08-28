import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, simulate } from './harness.mjs';

test('upgrade costs grow and stay affordable in order', () => {
  const K = load();
  const s = K.prog.fresh();
  const first = K.prog.cost(s, 'legPower');
  s.levels.legPower = 10;
  const tenth = K.prog.cost(s, 'legPower');
  assert.ok(tenth > first * 2, 'cost should compound');
  s.momentum = tenth;
  assert.ok(K.prog.buy(s, 'legPower'));
  assert.equal(s.levels.legPower, 11);
  assert.ok(s.momentum < 1);
});

test('buying a stat changes a number the physics actually reads', () => {
  const K = load();
  const s = K.prog.fresh();
  const before = K.prog.physStats(s);
  s.levels.flow = 6;
  const after = K.prog.physStats(s);
  assert.ok(after.speed > before.speed, 'FLOW must raise the commanded pace');
  assert.ok(after.flow > 0);
});

test('prestige needs a real run and pays instinct once', () => {
  const K = load();
  const s = K.prog.fresh();
  assert.equal(K.prog.prestigeGain(s), 0);
  s.best = 3000;
  const gain = K.prog.prestigeGain(s);
  assert.ok(gain > 0);
  s.levels.grip = 9;
  assert.ok(K.prog.prestige(s));
  assert.equal(s.levels.grip, 0);
  assert.equal(s.instinct, gain);
  assert.equal(K.prog.prestigeGain(s), 0, 'the same distance cannot be cashed twice');
});

test('offline banking is capped and needs a measured rate', () => {
  const K = load();
  const s = K.prog.fresh();
  s.seen = Date.now() - 6 * 3600 * 1000;
  assert.equal(K.prog.offline(s, Date.now()), null, 'no rate sampled yet, no bank');
  s.rateSample = 10;
  const r = K.prog.offline(s, Date.now());
  assert.ok(r.capped, 'six hours away should hit the two hour ceiling at GHOST 0');
  assert.ok(r.gained > 0 && r.gained < 10 * 6 * 3600, 'banked at a fraction of live rate');
});

test('every gate names a stat that exists', () => {
  const K = load();
  for (const g of K.world.GATES) {
    assert.ok(g.stat === 'all' || K.prog.BY_KEY[g.stat], g.name + ' asks for an unknown stat');
    assert.ok(g.at > 0 && g.need > 0);
  }
});

test('gaps are never wider than the legs that must clear them', () => {
  const K = load();
  for (const lvl of [0, 6, 20]) {
    const s = K.prog.fresh();
    s.levels.legPower = lvl; s.levels.flow = lvl;
    const lv = K.world.Level(99 + lvl, K.prog.statLevelFn(s));
    lv.ensure(600);
    const cap = 0.9 + lvl * 0.075 + lvl * 0.03;
    const gates = lv.gatesHit.map(m => [m.entryZ - 4, m.exitZ + 4]);
    const decks = lv.boxes
      .filter(b => b.kind === 'deck' || b.kind === 'glass' || b.kind === 'gatepad')
      .sort((a, b) => a.z0 - b.z0);
    for (let i = 1; i < decks.length; i++) {
      const gap = decks[i].z0 - decks[i - 1].z1;
      // gates author their own geometry; this is about the ordinary route
      if (gates.some(([a, b]) => decks[i].z0 > a && decks[i - 1].z1 < b)) continue;
      if (gap > 0) assert.ok(gap <= cap + 0.01, 'gap ' + gap.toFixed(2) + ' > cap ' + cap.toFixed(2));
    }
  }
});

test('the body stays a body: no exploding, no sinking through the deck', () => {
  const K = load();
  const { g } = simulate(K, { seconds: 20, levels: { legPower: 6, flow: 4, balance: 6 } });
  for (const p of g.body.list) {
    assert.ok(isFinite(p.x) && isFinite(p.y) && isFinite(p.z), p.name + ' left the number line');
  }
  const head = g.body.parts.head, foot = g.body.parts.footL;
  assert.ok(Math.hypot(head.x - foot.x, head.y - foot.y, head.z - foot.z) < 2.4,
    'the skeleton has come apart');
});

test('a trained runner covers ground and spends most of it running', () => {
  const K = load(7);
  const { g, seen, frames } = simulate(K, { seconds: 40, levels: {
    legPower: 8, flow: 6, balance: 8, reflex: 8, grip: 6, conditioning: 6, rebound: 5
  } });
  const running = (seen.RUN || 0) / frames;
  assert.ok(g.state.totalDistance + g.distance > 60,
    'covered only ' + (g.state.totalDistance + g.distance).toFixed(0) + ' m in 40 s');
  // the rest is flight phase, catches, rolls and getting back up — all of
  // which are the point — but a runner that is mostly on the deck is broken
  assert.ok(running > 0.35, 'only ' + (running * 100).toFixed(0) + '% of the time on its feet');
});

test('momentum only ever accrues from ground actually covered', () => {
  const K = load(3);
  const { g, state } = simulate(K, { seconds: 15 });
  assert.ok(state.lifetime > 0);
  const maxRate = K.prog.rate(state, g.distance) * 1.001;
  const fromGates = Object.keys(state.gates).length;
  if (!fromGates) {
    assert.ok(state.lifetime <= (state.totalDistance + g.distance) * maxRate + 1,
      'momentum outran the metres that earned it');
  }
});
