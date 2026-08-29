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
  // no tile anywhere is a shortcut up a wall or a free ride off one
  for (const s of a.surfaces) {
    for (const n of a.neighbours(s)) {
      const rise = n.s.y - s.y;
      assert.ok(rise <= K.grid.CLIMB + 0.03, 'a wall is not a step (' + rise.toFixed(2) + 'm)');
      assert.ok(rise >= -K.grid.DROP, 'and a roof is not a slide');
    }
  }
  // the roof is still reachable, and the route is a walk of single tiles
  const floor = a.at(5, 6, 0), roof = a.at(2, 2, 2.2);
  assert.ok(roof.y > 2 && floor.y === 0);
  const reach = a.reach(floor, 40);
  assert.ok(reach.get(roof.id), 'the stair gets you up there');
  const path = a.pathTo(reach, roof);
  assert.ok(path.some(s => s.terrain === 'stair'), 'and the way up is the stair');
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

test('every layout is a playable board, not just a shape', () => {
  const K = load();
  for (const name of Object.keys(K.grid.LAYOUTS)) {
    const a = K.grid.Arena(31, name);
    assert.equal(K.grid.check(a), null, name + ': ' + K.grid.check(a));
    assert.ok(a.spawns.guard.every(s => s.y > 0.4), name + ' puts its guards on high ground');
    const walkable = a.flood(a.spawns.player[0]);
    for (const s of a.spawns.guard) assert.ok(walkable.has(s.id), name + ': the high ground is climbable');
    assert.ok(a.hazards().length >= 6, name + ' has somewhere to be knocked into');
  }
});

test('the generator never hands over a board it has not checked', () => {
  const K = load();
  const seen = {};
  for (let s = 1; s <= 60; s++) {
    const a = K.grid.make(s * 37);
    assert.ok(!a.fallback, 'seed ' + s + ' fell back: ' + a.fallback);
    assert.equal(K.grid.check(a), null, 'seed ' + s + ' shipped broken');
    seen[a.layout] = (seen[a.layout] || 0) + 1;
  }
  assert.equal(Object.keys(seen).length, Object.keys(K.grid.LAYOUTS).length, 'every layout gets used');
});

test('two waves running never land on the same ground', () => {
  const K = load();
  for (let s = 1; s <= 20; s++) {
    const first = K.grid.make(s * 11);
    const next = K.grid.make(s * 11 + 5, { avoid: first.layout });
    assert.notEqual(next.layout, first.layout, 'seed ' + s + ' repeated ' + first.layout);
  }
});

test('a battle on any layout closes and ends', () => {
  for (const name of Object.keys(load().grid.LAYOUTS)) {
    const K = load(17);
    const run = K.camp.fresh();
    const plan = {
      wave: 2, layout: name,
      player: K.camp.playerPlan(run),
      enemy: K.camp.enemyPlan(2, K.util.rng(4))
    };
    const { b } = play(K, { seed: 77, seconds: 500, plan });
    assert.equal(b.arena.layout, name);
    assert.equal(anyNaN(K, b), null, name + ' broke a body');
    assert.ok(b.over === 'win' || b.over === 'loss', name + ' never resolved (turn ' + b.turn + ')');
    assert.ok(b.turn < 40, name + ' dragged to turn ' + b.turn);
  }
});

test('a weapon upgrade is a trade, not a gift', () => {
  const K = load(), Un = K.units;
  for (const [cls, line] of Object.entries(Un.ARSENAL)) {
    for (let i = 1; i < line.length; i++) {
      const was = Un.WEAPONS[line[i - 1]], now = Un.WEAPONS[line[i]];
      assert.ok(now.mt > was.mt, cls + ': ' + now.name + ' hits harder');
      assert.ok(now.hit < was.hit, cls + ': and less often');
      assert.ok(now.wt > was.wt, cls + ': and weighs more');
    }
    assert.equal(Un.upgrade(cls, line[line.length - 1]), null, cls + ' has a top of the line');
    assert.equal(Un.upgrade(cls, line[0]), line[1]);
  }
  // weight is not decoration: a heavy weapon costs attack speed
  const a = Un.make('Blade', 0, 'A', 5), b = Un.make('Blade', 0, 'B', 5);
  b.str = a.str; b.spd = a.spd;
  b.weapon = Un.WEAPONS.silver_sword;
  assert.ok(Un.AS(b) < Un.AS(a), 'silver slows you down');
});

test('a field won buys a choice, and the choice sticks', () => {
  const K = load(8);
  const run = K.camp.fresh();
  const offers = K.camp.offers(run, K.util.rng(2));
  assert.ok(offers.length === 3, 'three offers');
  assert.equal(new Set(offers.map(o => o.kind)).size, 3, 'three different kinds');
  for (const o of offers) { assert.ok(o.label && o.detail, o.kind + ' explains itself'); }

  const arm = offers.find(o => o.kind === 'arm');
  if (arm) {
    const before = run.roster.find(u => u.name === arm.unit).weapon;
    K.camp.take(run, arm);
    assert.notEqual(run.roster.find(u => u.name === arm.unit).weapon, before, 'the weapon changed hands');
  }
  const r2 = K.camp.fresh();
  const hp = r2.roster.map(u => u.maxHp);
  K.camp.take(r2, { kind: 'rally', amount: 3 });
  r2.roster.forEach((u, i) => assert.equal(u.maxHp, hp[i] + 3, 'everybody ate'));
  const r3 = K.camp.fresh();
  const n = r3.roster.length;
  K.camp.take(r3, { kind: 'recruit', cls: 'Blade', name: 'NEWBLOOD', level: 4 });
  assert.equal(r3.roster.length, n + 1);
  assert.ok(r3.roster[n].maxHp > 0, 'a recruit arrives with real numbers');
  const r4 = K.camp.fresh();
  const str = r4.roster[0].str;
  K.camp.take(r4, { kind: 'drill', unit: r4.roster[0].name, stat: 'str', amount: 2 });
  assert.equal(r4.roster[0].str, str + 2);
});

test('the last field has somebody in charge of it', () => {
  const K = load(9);
  const plan = K.camp.enemyPlan(K.camp.RUN, K.util.rng(3));
  const boss = plan.find(u => u.boss);
  assert.ok(boss, 'a commander holds the final wave');
  assert.ok(boss.level > Math.max(...plan.filter(u => !u.boss).map(u => u.level)), 'and outranks the line');
  assert.equal(K.units.ARSENAL[boss.cls].indexOf(boss.weapon), 2, 'carrying the best of its kind');
  assert.ok(!K.camp.enemyPlan(1, K.util.rng(3)).some(u => u.boss), 'wave one does not');

  const b = K.battle.create(55, { wave: K.camp.RUN, player: K.camp.playerPlan(K.camp.fresh()), enemy: plan });
  const inField = b.units.find(u => u.boss);
  assert.ok(inField && inField.surface, 'and it is actually on the board');
  assert.ok(inField.maxHp > Math.max(...b.units.filter(u => u.side === 1 && !u.boss).map(u => u.maxHp)),
    'harder to put down than its own line');
});

test('a run can be finished, and finishing it is recorded', () => {
  const K = load(10);
  const run = K.camp.fresh();
  run.wave = K.camp.RUN;
  const b = K.battle.create(12, { wave: K.camp.RUN, player: K.camp.playerPlan(run), enemy: K.camp.enemyPlan(K.camp.RUN, K.util.rng(1)) });
  b.units.filter(u => u.side === 1).forEach(u => { u.dead = true; });
  const summary = K.camp.afterBattle(run, b, true);
  assert.equal(summary.final, true, 'the last wave knows it was the last');
  assert.equal(run.wins, 1, 'the win is counted');
  assert.equal(run.wave, 1, 'and the next run starts at the beginning');
  assert.equal(run.best, K.camp.RUN);
  assert.equal(run.roster.length, 4, 'with a fresh four');
});

test('a weapon a unit was given is the weapon it fights with', () => {
  const K = load(11);
  const run = K.camp.fresh();
  const name = run.roster[0].name;
  K.camp.take(run, { kind: 'arm', unit: name, weapon: 'silver_sword' });
  const b = K.battle.create(13, { wave: 2, player: K.camp.playerPlan(run), enemy: K.camp.enemyPlan(2, K.util.rng(1)) });
  const u = b.units.find(x => x.name === name);
  assert.equal(u.weapon.name, 'Silver Sword', 'it carried it onto the field');
  // and back out again
  const snap = K.camp.snapshot(u);
  assert.equal(snap.weapon, 'silver_sword');
  assert.equal(K.camp.restore(snap, 0).weapon.name, 'Silver Sword');
});
