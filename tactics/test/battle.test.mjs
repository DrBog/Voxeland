import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, play, anyNaN } from './harness.mjs';

test('the arena is genuinely multi-level: a bridge over an empty column', () => {
  const K = load();
  const a = K.grid.Arena(3);
  const pit = a.col(7, 7);
  assert.equal(pit.length, 1, 'the pit column holds only the bridge');
  assert.ok(pit[0].y > 2, 'and the bridge is above it');
  assert.ok(a.voidUnder(pit[0]), 'with nothing underneath to catch a body');
  const roof = a.at(2, 2, 2.2);
  assert.ok(roof.y > 2, 'the west building has a roof to stand on');
  assert.equal(a.col(2, 2).length, 1, 'and is solid underneath — no phantom room');
  assert.ok(roof.solid >= 2.2, 'the building fills the space it occupies');
});

test('you cannot step onto a roof, you have to take the stair', () => {
  const K = load();
  const a = K.grid.Arena(3);
  const ground = a.at(5, 1, 0);
  const roof = a.at(4, 1, 2.2);
  assert.ok(roof && roof.y > 2);
  const direct = a.neighbours(ground).some(n => n.s === roof);
  assert.equal(direct, false, 'a 2.2 m wall is not a step');
  const reach = a.reach(a.at(5, 4, 0), 8);
  const viaStair = reach.get(a.at(4, 3, 2.2).id);
  assert.ok(viaStair, 'but the stair gets you up there');
  const path = a.pathTo(reach, a.at(4, 3, 2.2));
  for (let i = 1; i < path.length; i++) {
    const d = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].z - path[i - 1].z);
    assert.equal(d, 1, 'every step of a path is one tile');
  }
});

test('the weapon triangle and doubling both move the forecast', () => {
  const K = load(), Un = K.units;
  const a = K.grid.Arena(3);
  const sword = Un.make('Blade', 0, 'A', 1), axe = Un.make('Reaver', 1, 'B', 1);
  sword.surface = a.at(3, 3, 0); axe.surface = a.at(4, 3, 0);
  const f = Un.forecast(sword, axe, a);
  assert.equal(f.a.tri, 1, 'sword beats axe');
  assert.ok(f.a.acc > f.b.acc, 'and lands more often for it');
  assert.equal(f.a.hits, 2, 'a Blade doubles a Reaver');
  assert.equal(f.b.hits, 1);
});

test('height is worth taking', () => {
  const K = load(), Un = K.units;
  const a = K.grid.Arena(3);
  const up = Un.make('Blade', 0, 'A', 1), down = Un.make('Blade', 1, 'B', 1);
  up.surface = a.at(9, 9, 1.5); down.surface = a.at(8, 9, 0);
  const high = Un.forecast(up, down, a);
  up.surface = a.at(8, 8, 0); down.surface = a.at(8, 9, 0);
  const level = Un.forecast(up, down, a);
  assert.ok(high.a.acc > level.a.acc, 'the high ground hits more often');
  assert.ok(high.a.dmg >= level.a.dmg, 'and no softer');
});

test('a unit stands up and stays standing', () => {
  const K = load();
  const b = K.battle.create(11);
  const u = b.units[0], act = b.actors.get(u.id);
  const dt = 1 / 120;
  for (let i = 0; i < 120 * 3; i++) K.battle.step(b, dt);
  const hip = act.body.parts.pelvis.y - u.surface.y;
  assert.ok(hip > 0.55, 'the hips hold near standing height, got ' + hip.toFixed(2));
  assert.ok(act.body.parts.head.y > act.body.parts.pelvis.y, 'and the head is above the hips');
  for (const [, a] of b.actors) {
    const p = a.body.parts.pelvis;
    assert.ok(p.y > a.unit.surface.y - 0.6, a.unit.name + ' has not sunk through the floor');
  }
});

test('a killing blow is a physical event, not a bookkeeping one', () => {
  const K = load();
  const b = K.battle.create(11);
  const victim = K.battle.living(b, 1)[0];
  const act = b.actors.get(victim.id);
  const dt = 1 / 120;
  for (let i = 0; i < 60; i++) K.battle.step(b, dt);
  const x0 = act.body.parts.chest.x, z0 = act.body.parts.chest.z;
  K.actor.takeHit(act, x0 - 2, z0, 6, true, true);
  for (let i = 0; i < 120; i++) K.battle.step(b, dt);
  const moved = Math.hypot(act.body.parts.chest.x - x0, act.body.parts.chest.z - z0);
  assert.ok(moved > 0.2, 'the body goes with the blow, moved ' + moved.toFixed(2));
  assert.ok(act.body.parts.chest.y < act.body.parts.head.y + 0.4, 'and it goes down');
});

test('the bridge has no rail: a body knocked off it falls out of the arena', () => {
  const K = load();
  const b = K.battle.create(11);
  const u = b.units[0], act = b.actors.get(u.id);
  const bridge = b.arena.at(7, 7, 2.2);
  u.surface.occupant = null;
  u.surface = bridge;
  const w = b.arena.world(bridge);
  act.pos = { x: w.x, y: w.y, z: w.z };
  const dx = w.x - act.body.parts.pelvis.x, dz = w.z - act.body.parts.pelvis.z;
  const dy = (w.y + 0.9) - act.body.parts.pelvis.y;
  for (const p of act.body.list) { p.x += dx; p.y += dy; p.z += dz; p.px = p.x; p.py = p.y; p.pz = p.z; }
  act.foot = [null, null];
  const dt = 1 / 120;
  for (let i = 0; i < 90; i++) K.battle.step(b, dt);
  const onBridge = act.body.parts.pelvis.y;
  assert.ok(onBridge > 2.4, 'it is standing on the bridge, y=' + onBridge.toFixed(2));
  K.actor.takeHit(act, w.x, w.z - 3, 9, true, true);
  for (let i = 0; i < 240; i++) K.battle.step(b, dt);
  assert.ok(act.body.parts.pelvis.y < 1.0, 'and off it, y=' + act.body.parts.pelvis.y.toFixed(2));
  assert.ok(act.fell || act.mode === 'dead', 'the arena counts the fall');
});

test('a whole battle plays out, ends, and leaves nothing broken', () => {
  const K = load(5);
  const { b } = play(K, { seed: 5, seconds: 400 });
  assert.equal(anyNaN(K, b), null, 'no part of any body went NaN');
  assert.ok(b.over === 'win' || b.over === 'loss', 'someone won, got ' + b.over + ' on turn ' + b.turn);
  assert.ok(b.turn < 40, 'and it did not stall, turn ' + b.turn);
  for (const u of b.units) if (!u.dead) assert.ok(u.surface, u.name + ' stands somewhere real');
});

test('two units never end a turn standing in the same tile', () => {
  const K = load(9);
  const { b } = play(K, { seed: 9, seconds: 400 });
  const seen = new Map();
  for (const u of b.units) {
    if (u.dead) continue;
    assert.ok(!seen.has(u.surface.id), u.name + ' shares a tile with ' + (seen.get(u.surface.id) || ''));
    seen.set(u.surface.id, u.name);
  }
});

test('experience accrues and levels are earned in the field', () => {
  const K = load(3);
  const { b } = play(K, { seed: 3, seconds: 400 });
  const mine = b.units.filter(u => u.side === 0);
  assert.ok(mine.some(u => u.exp > 0 || u.level > 3), 'somebody learned something');
});

test('a body dropped into the pit does not fall forever', () => {
  const K = load();
  const b = K.battle.create(11);
  const act = b.actors.get(b.units[0].id);
  const dt = 1 / 120;
  for (const p of act.body.list) { p.y += 6; p.py = p.y; }
  for (let i = 0; i < 120 * 4; i++) K.battle.step(b, dt);
  const y = act.body.parts.pelvis.y;
  assert.ok(isFinite(y) && y > -1 && y < 5, 'it lands and stays landed, y=' + y.toFixed(2));
});

test('a run carries its survivors and buries its dead', () => {
  const K = load(4);
  const run = K.camp.fresh();
  assert.equal(run.wave, 1);
  const b = K.battle.create(4, { wave: 1, player: K.camp.playerPlan(run) });
  const mine = b.units.filter(u => u.side === 0);
  mine[0].level = 9; mine[0].str = 14;
  mine[1].dead = true;
  const summary = K.camp.afterBattle(run, b, true);
  assert.equal(run.wave, 2, 'a win advances the wave');
  assert.equal(run.roster.length, 3, 'the fallen do not come back');
  assert.equal(run.roster[0].level, 9, 'and the living keep what they earned');
  assert.equal(run.roster[0].str, 14);
  assert.ok(summary.lost.includes(mine[1].name));
  // the thinned line is topped up, but never to strength for free
  const plan = K.camp.playerPlan(run);
  assert.equal(plan.length, 4);
  assert.ok(plan[3].recruit, 'the fourth is a recruit');
  assert.ok(plan[3].level < Math.max(...plan.slice(0, 3).map(u => u.level)), 'and a green one');
});

test('a loss ends the run but not the record', () => {
  const K = load(4);
  const run = K.camp.fresh();
  run.wave = 5; run.best = 4;
  const b = K.battle.create(4, { wave: 5, player: K.camp.playerPlan(run) });
  b.units.filter(u => u.side === 0).forEach(u => { u.dead = true; });
  K.camp.afterBattle(run, b, false);
  assert.equal(run.wave, 1, 'the next run starts at the beginning');
  assert.equal(run.best, 4, 'the best wave stands');
  assert.equal(run.roster.length, 4, 'with a fresh four');
  assert.equal(run.roster[0].level, 6);
});

test('later waves are heavier than the first', () => {
  const K = load(4);
  const rnd = K.util.rng(9);
  const w1 = K.camp.enemyPlan(1, rnd), w6 = K.camp.enemyPlan(6, rnd);
  assert.ok(w6.length > w1.length, 'more of them');
  assert.ok(Math.max(...w6.map(u => u.level)) > Math.max(...w1.map(u => u.level)), 'and better');
  assert.ok(w6.some(u => u.guard), 'the rampart is still held');
});

test('a planned wave builds and plays', () => {
  const K = load(6);
  const run = K.camp.fresh();
  run.wave = 4;
  const plan = { wave: 4, player: K.camp.playerPlan(run), enemy: K.camp.enemyPlan(4, K.util.rng(3)) };
  const { b } = play(K, { seed: 6, seconds: 400, plan });
  assert.equal(anyNaN(K, b), null);
  assert.ok(b.over === 'win' || b.over === 'loss', 'the wave resolves, got ' + b.over);
  assert.equal(b.wave, 4);
});
