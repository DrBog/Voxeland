/* Loads the browser modules into a plain node sandbox so the arena, the
   combat maths and the bodies can be tested without a canvas. */
import fs from 'fs';
import vm from 'vm';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function load(seed) {
  let a = seed === undefined ? 12345 : seed;
  const rand = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const M = Object.create(Math); M.random = rand;
  const store = {};
  const sandbox = {
    console, Math: M, Date, JSON, isFinite, parseInt, parseFloat,
    performance: { now: () => 0 },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    }
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const dir = path.join(root, 'src');
  const files = fs.readdirSync(dir)
    .filter(n => n.endsWith('.js') && !/^(08|10|11)/.test(n)).sort();
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  sandbox.K.rand = rand;
  return sandbox.K;
}

/* run the real turn loop headlessly until it ends or runs out of patience */
export function play(K, { seed = 7, seconds = 240, fps = 120, autoPlayer = true, plan = null } = {}) {
  const b = K.battle.create(seed, plan);
  const dt = 1 / fps;
  const steps = seconds * fps;
  let acted = 0;
  for (let i = 0; i < steps && !b.over; i++) {
    K.battle.step(b, dt);
    if (autoPlayer && b.phase === 'player' && !b.busy && !b.over) {
      // the player side plays itself with the enemy's own scoring, which is
      // the cheapest honest exercise of every path through a turn
      const mine = K.battle.living(b, 0).filter(u => !u.acted);
      if (mine.length) { playerMove(K, b, mine[0]); acted++; }
      else K.battle.endPhase(b);
    }
  }
  return { b, acted };
}

function playerMove(K, b, u) {
  const Un = K.units;
  K.battle.select(b, u);
  const foes = K.battle.living(b, 1);
  let best = null;
  for (const [, e] of b.reach) {
    const s = e.s;
    if (s !== u.surface && K.battle.occupied(b, s, u)) continue;
    for (const f of foes) {
      const save = u.surface; u.surface = s;
      const can = Un.inRange(u, f, b.arena);
      const fc = can ? Un.forecast(u, f, b.arena) : null;
      u.surface = save;
      if (!can) continue;
      const score = (fc.lethal ? 1000 : 0) + fc.a.total * 10 - (fc.b ? fc.b.total * 6 : -20) - e.cost * 0.2;
      if (!best || score > best.score) best = { score, s, f };
    }
  }
  if (best) {
    if (best.s === u.surface) K.battle.attack(b, u, best.f);
    else K.battle.moveTo(b, u, best.s, best.f);
    return;
  }
  let goal = null;
  for (const [, e] of b.reach) {
    const s = e.s;
    if (K.battle.occupied(b, s, u)) continue;
    const d = Math.min(...foes.map(f => b.arena.dist(s, f.surface)));
    const score = -d * 10 - e.cost * 0.1;
    if (!goal || score > goal.score) goal = { score, s };
  }
  if (goal && goal.s !== u.surface) K.battle.moveTo(b, u, goal.s);
  else K.battle.finishUnit(b, u);
}

export function anyNaN(K, b) {
  for (const [, a] of b.actors) {
    for (const p of a.body.list) {
      if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) return a.unit.name + '.' + p.name;
    }
  }
  return null;
}
