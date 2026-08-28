/* Loads the browser modules into a plain node sandbox so the simulation can
   be tested without a canvas. The game deliberately keeps rendering out of
   the physics and progression modules, which is what makes this possible. */
import fs from 'fs';
import vm from 'vm';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function load(seed) {
  const store = {};
  let a = seed === undefined ? 12345 : seed;
  const rand = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const M = Object.create(Math); M.random = rand;
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
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js') && !n.startsWith('11')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }
  return sandbox.K;
}

/* run the real game loop headlessly */
export function simulate(K, { seconds = 30, levels = {}, fps = 60 } = {}) {
  const state = K.prog.fresh();
  Object.assign(state.levels, levels);
  const g = K.game.create(state);
  const dt = 1 / fps;
  const seen = {};
  for (let i = 0; i < seconds * fps; i++) {
    K.game.update(g, dt);
    seen[g.ctrl.state] = (seen[g.ctrl.state] || 0) + 1;
  }
  return { g, state, seen, frames: seconds * fps };
}
