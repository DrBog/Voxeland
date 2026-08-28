/* KINESIS — boot, loop, save. */
(function () {
  const U = K.util, prog = K.prog;

  let state, game, view, ui, last = 0, saveT = 0, autoT = 0, splashUp = true;

  function boot() {
    state = prog.load() || prog.fresh();
    const report = prog.offline(state, Date.now());

    game = K.game.create(state);
    view = K.render.View(document.getElementById('view'));
    K.render.resize(view);
    ui = K.ui.build(document.getElementById('app'), game, state);
    K.audio.enable(!state.muted);

    window.addEventListener('resize', () => K.render.resize(view));
    window.addEventListener('orientationchange', () => setTimeout(() => K.render.resize(view), 250));

    const splash = document.getElementById('splash');
    const fresh = state.runs === 0 && state.lifetime < 1;
    if (!fresh) {
      splash.classList.add('gone');
      splashUp = false;
      if (report && report.gained > 1) ghostCard(report);
    } else {
      splash.classList.remove('gone');
      document.getElementById('begin').onclick = () => start(true);
      document.getElementById('begin-quiet').onclick = () => start(false);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { prog.save(state); }
      else {
        const r = prog.offline(state, Date.now());
        if (r && r.gained > 1) ghostCard(r);
        last = performance.now();
      }
    });

    window.__g = game; window.__ui = ui;   // deliberate: inspect the sim from a console
    last = performance.now();
    requestAnimationFrame(loop);
  }

  function start(sound) {
    state.muted = !sound;
    K.audio.enable(sound);
    ui.sound.classList.toggle('off', !sound);
    document.getElementById('splash').classList.add('gone');
    splashUp = false;
    prog.save(state);
  }

  function ghostCard(r) {
    const box = document.getElementById('ghost');
    document.getElementById('ghost-time').textContent = U.time(r.away);
    document.getElementById('ghost-gain').textContent = '+' + U.num(r.gained) + ' M';
    document.getElementById('ghost-note').textContent = r.capped
      ? 'Your ghost ran out of road — GHOST banks longer.'
      : 'It kept running at ' + (r.eff * 100).toFixed(0) + '% of your pace.';
    box.classList.add('show');
    document.getElementById('ghost-ok').onclick = () => box.classList.remove('show');
    setTimeout(() => box.classList.remove('show'), 9000);
  }

  function autoBuy(dt) {
    if (!state.auto || !state.instinct) return;
    autoT += dt;
    if (autoT < 0.6) return;
    autoT = 0;
    let best = null, bestCost = Infinity;
    for (const u of prog.UPGRADES) {
      if (!prog.unlocked(state, u.key)) continue;
      const c = prog.cost(state, u.key);
      if (c < bestCost && c <= state.momentum) { best = u.key; bestCost = c; }
    }
    if (best) {
      prog.buy(state, best);
      K.game.restat(game);
      if (ui.tab === 'train') K.ui.render(ui);
    }
  }

  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000) || 0;
    last = t;
    if (splashUp) { K.render.frame(view, game, t / 1000); return; }

    K.game.update(game, dt);
    K.render.frame(view, game, t / 1000);
    K.ui.tick(ui, dt);
    autoBuy(dt);

    saveT += dt;
    if (saveT > 10) { saveT = 0; prog.save(state); }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 0);
  else window.addEventListener('DOMContentLoaded', boot);
})();
