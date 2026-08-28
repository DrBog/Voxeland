/* KINESIS — DOM layer. Text stays out of the canvas so it stays sharp,
   and so the whole panel scrolls like a normal page on a phone. */
K.ui = (function () {
  const U = K.util, prog = K.prog, E = K.euphoria;
  const { clamp } = U;

  const STATE_COL = {
    RUN: '#8fe3a0', AIRBORNE: '#7ec8ff', CATCH: '#ffd166', VAULT: '#b3a4ff',
    ROLL: '#ffb057', STAGGER: '#ffa14a', PROTECT: '#ff6b6b', DOWN: '#ff8fa3',
    RISE: '#ffc9d1', WIPEOUT: '#ff4d5e'
  };
  const STATE_HINT = {
    RUN: 'balance holding', AIRBORNE: 'reading the landing', CATCH: 'hanging on',
    VAULT: 'hand planted', ROLL: 'bleeding off the drop', STAGGER: 'stepping under the fall',
    PROTECT: 'arms out, head covered', DOWN: 'still', RISE: 'pushing up', WIPEOUT: 'done'
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function $(id) { return document.getElementById(id); }

  function build(app, game, state) {
    const ui = { app, game, state, tab: 'train', buyMode: 1, dirty: true, rows: {}, acc: 0 };

    /* ---------------- HUD (overlaid on the canvas) */
    const hud = $('hud');
    const top = el('div', 'hud-top');
    const dl = el('div', 'district');
    ui.districtName = el('div', 'district-name', 'THE FLATS');
    ui.districtTag = el('div', 'district-tag', '');
    dl.append(ui.districtName, ui.districtTag);
    const dr = el('div', 'readout');
    ui.distance = el('div', 'distance', '0.0 m');
    ui.best = el('div', 'best', 'best 0 m');
    dr.append(ui.distance, ui.best);
    top.append(dl, dr);

    const body = el('div', 'hud-body');
    ui.chip = el('div', 'chip');
    ui.chipState = el('span', 'chip-state', 'RUN');
    ui.chipHint = el('span', 'chip-hint', '');
    ui.chip.append(ui.chipState, ui.chipHint);

    const bars = el('div', 'bars');
    function bar(label) {
      const w = el('div', 'bar');
      const l = el('div', 'bar-label', label);
      const t = el('div', 'bar-track');
      const f = el('div', 'bar-fill');
      t.append(f); w.append(l, t);
      bars.append(w);
      return f;
    }
    ui.barIntegrity = bar('FRAME');
    ui.barConsc = bar('CONSC');
    ui.barBalance = bar('BAL');
    ui.notes = el('div', 'notes');
    body.append(ui.chip, bars, ui.notes);

    ui.banner = el('div', 'banner');
    ui.bannerTitle = el('div', 'banner-title');
    ui.bannerSub = el('div', 'banner-sub');
    ui.banner.append(ui.bannerTitle, ui.bannerSub);

    const wallet = el('div', 'wallet');
    ui.momentum = el('div', 'momentum', '0');
    ui.rate = el('div', 'rate', '0/s');
    wallet.append(ui.momentum, ui.rate);

    ui.sound = el('button', 'icon-btn', '♪');
    ui.sound.title = 'sound';
    ui.sound.onclick = () => {
      state.muted = !state.muted;
      K.audio.enable(!state.muted);
      ui.sound.classList.toggle('off', state.muted);
      prog.save(state);
    };
    ui.sound.classList.toggle('off', !!state.muted);

    ui.camBtn = el('button', 'cam-btn', K.game.camName(game));
    ui.camBtn.title = 'camera';
    ui.camBtn.onclick = () => {
      ui.camBtn.textContent = K.game.cycleCam(game);
      prog.save(state);
    };

    hud.append(top, body, wallet, ui.banner, ui.sound, ui.camBtn);

    /* ---------------- panel */
    const panel = $('panel');
    const tabs = el('nav', 'tabs');
    ui.tabButtons = {};
    for (const [key, label] of [['train', 'TRAIN'], ['route', 'ROUTE'], ['mind', 'MIND'], ['log', 'LOG']]) {
      const b = el('button', 'tab', label);
      b.onclick = () => { ui.tab = key; refreshTabs(ui); render(ui); };
      ui.tabButtons[key] = b;
      tabs.append(b);
    }
    ui.bodyEl = el('div', 'panel-body');
    panel.append(tabs, ui.bodyEl);

    refreshTabs(ui);
    render(ui);
    return ui;
  }

  function refreshTabs(ui) {
    for (const k in ui.tabButtons) ui.tabButtons[k].classList.toggle('on', k === ui.tab);
  }

  /* ---------------- panel contents */

  function buyCount(s, key, mode) {
    if (mode === 1) return 1;
    if (mode === 10) return 10;
    let n = 0, spend = 0;
    while (n < 500) {
      const c = prog.cost(s, key, n + 1);
      if (c > s.momentum) break;
      spend = c; n++;
    }
    return Math.max(1, n);
  }

  function render(ui) {
    const s = ui.state, g = ui.game;
    const b = ui.bodyEl;
    b.innerHTML = '';
    ui.rows = {};
    if (ui.tab === 'train') renderTrain(ui, b, s);
    else if (ui.tab === 'route') renderRoute(ui, b, s);
    else if (ui.tab === 'mind') renderMind(ui, b, s);
    else renderLog(ui, b, s);
  }

  function renderTrain(ui, b, s) {
    const head = el('div', 'row-head');
    head.append(el('div', 'row-title', 'TRAIN THE BODY'));
    const modes = el('div', 'modes');
    for (const m of [1, 10, 'MAX']) {
      const btn = el('button', 'mode' + (ui.buyMode === m ? ' on' : ''), m === 'MAX' ? 'MAX' : 'x' + m);
      btn.onclick = () => { ui.buyMode = m; render(ui); };
      modes.append(btn);
    }
    head.append(modes);
    b.append(head);

    for (const u of prog.UPGRADES) {
      if (!prog.unlocked(s, u.key)) {
        const lock = el('div', 'card locked');
        lock.append(el('div', 'card-name', u.name));
        lock.append(el('div', 'card-blurb', 'unlocks when a gate opens'));
        b.append(lock);
        continue;
      }
      const card = el('div', 'card');
      const l1 = el('div', 'card-line');
      l1.append(el('div', 'card-name', u.name));
      const lvl = el('div', 'card-level', 'LV ' + prog.level(s, u.key));
      l1.append(lvl);
      const read = el('div', 'card-read', '');
      const blurb = el('div', 'card-blurb', u.blurb);
      const buy = el('button', 'buy');
      const n = () => buyCount(s, u.key, ui.buyMode);
      buy.onclick = () => {
        const count = n();
        let bought = 0;
        for (let i = 0; i < count; i++) { if (!prog.buy(s, u.key)) break; bought++; }
        if (bought) {
          K.audio.buy();
          K.game.restat(ui.game);
          prog.save(s);
          render(ui);
        }
      };
      card.append(l1, read, blurb, buy);
      b.append(card);
      ui.rows[u.key] = { card, lvl, read, buy, u };
    }
    updateTrain(ui);
  }

  function updateTrain(ui) {
    const s = ui.state;
    const st = prog.physStats(s);
    for (const key in ui.rows) {
      const r = ui.rows[key];
      const lv = prog.level(s, key);
      r.lvl.textContent = 'LV ' + lv;
      r.read.textContent = r.u.read(st[key]);
      const count = buyCount(s, key, ui.buyMode);
      const cost = prog.cost(s, key, ui.buyMode === 'MAX' ? count : ui.buyMode);
      const can = s.momentum >= cost;
      r.buy.textContent = (count > 1 ? '+' + count + '   ' : '') + U.num(cost) + ' M';
      r.buy.classList.toggle('can', can);
      r.buy.disabled = !can;
    }
  }

  function renderRoute(ui, b, s) {
    b.append(el('div', 'row-title', 'THE ROUTE'));
    const cur = Math.max(s.best, s.bestRun);
    for (let i = 0; i < K.world.GATES.length; i++) {
      const gate = K.world.GATES[i];
      const open = !!s.gates[gate.name];
      const lvFn = prog.statLevelFn(s);
      const have = lvFn(gate.stat);
      const met = have >= gate.need;
      const card = el('div', 'card gate' + (open ? ' open' : met ? ' ready' : ''));
      const l1 = el('div', 'card-line');
      l1.append(el('div', 'card-name', gate.name));
      l1.append(el('div', 'card-level', U.dist(gate.at)));
      card.append(l1);
      card.append(el('div', 'card-blurb', gate.blurb));
      const reqName = gate.stat === 'all' ? 'EVERY STAT' : prog.BY_KEY[gate.stat].name;
      const req = el('div', 'req');
      req.append(el('span', 'req-name', reqName));
      const val = el('span', 'req-val' + (met ? ' met' : ''), have + ' / ' + gate.need);
      req.append(val);
      card.append(req);
      card.append(el('div', 'card-state', open ? 'OPEN — cleared once, and every run since'
        : met ? 'READY — the body can do this now' : 'SHORT — it will not go'));
      b.append(card);
    }
    const d = el('div', 'card');
    d.append(el('div', 'card-name', 'DISTRICTS'));
    for (const D of K.world.DISTRICTS) {
      const r = el('div', 'dline');
      r.append(el('span', 'dname', D.name));
      r.append(el('span', 'dmult', 'x' + D.mult + ' momentum'));
      if (cur >= (D.end === Infinity ? 12600 : D.end) - 400) r.classList.add('seen');
      d.append(r);
    }
    b.append(d);
  }

  function renderMind(ui, b, s) {
    b.append(el('div', 'row-title', 'MUSCLE MEMORY'));
    const gain = prog.prestigeGain(s);
    const card = el('div', 'card');
    card.append(el('div', 'card-blurb',
      'Wipe the training and keep what the body learned. Instinct is permanent: '
      + '+' + (prog.INSTINCT_ECON * 100).toFixed(0) + '% momentum and +'
      + (prog.INSTINCT_BODY * 100).toFixed(1) + '% to every physical stat, each point.'));
    const l = el('div', 'card-line');
    l.append(el('div', 'card-name', 'INSTINCT'));
    l.append(el('div', 'card-level', s.instinct + (gain > 0 ? '  →  ' + (s.instinct + gain) : '')));
    card.append(l);
    const btn = el('button', 'buy big' + (gain > 0 ? ' can' : ''));
    btn.textContent = gain > 0 ? 'RESET FOR +' + gain + ' INSTINCT' : 'REACH 1.2 km IN ONE RUN';
    btn.disabled = gain <= 0;
    btn.onclick = () => {
      if (!confirm('Reset every upgrade and gate for +' + gain + ' instinct?')) return;
      prog.prestige(s);
      K.game.restat(ui.game);
      K.game.newRun(ui.game);
      prog.save(s);
      render(ui);
    };
    card.append(btn);
    b.append(card);

    if (s.instinct > 0) {
      const auto = el('div', 'card');
      const line = el('div', 'card-line');
      line.append(el('div', 'card-name', 'INSTINCT BUYING'));
      const t = el('button', 'toggle' + (s.auto ? ' on' : ''), s.auto ? 'ON' : 'OFF');
      t.onclick = () => { s.auto = !s.auto; prog.save(s); render(ui); };
      line.append(t);
      auto.append(line, el('div', 'card-blurb', 'Spends momentum on the cheapest useful upgrade, forever, without you.'));
      b.append(auto);
    }

    const stats = el('div', 'card');
    stats.append(el('div', 'card-name', 'RECORD'));
    const pairs = [
      ['best run', U.dist(s.best)],
      ['runs', s.runs],
      ['ground covered', U.dist(s.totalDistance)],
      ['momentum earned', U.num(s.lifetime)],
      ['resets', s.resets],
      ['gates open', prog.clearedGates(s) + ' / ' + K.world.GATES.length]
    ];
    for (const [k, val] of pairs) {
      const r = el('div', 'dline');
      r.append(el('span', 'dname', k)); r.append(el('span', 'dmult', String(val)));
      stats.append(r);
    }
    b.append(stats);

    const danger = el('div', 'card');
    const wipe = el('button', 'toggle danger', 'ERASE SAVE');
    wipe.onclick = () => {
      if (!confirm('Erase everything, permanently?')) return;
      prog.wipe(); location.reload();
    };
    danger.append(wipe);
    b.append(danger);
  }

  function renderLog(ui, b, s) {
    b.append(el('div', 'row-title', 'RUN LOG'));
    if (!s.log.length) b.append(el('div', 'card-blurb', 'Nothing yet. Give it a minute.'));
    for (const entry of s.log) {
      const c = el('div', 'card log ' + entry.kind);
      const l = el('div', 'card-line');
      l.append(el('div', 'card-name', entry.kind === 'gate' ? 'GATE'
        : entry.kind === 'reset' ? 'RESET' : 'RUN ' + (entry.run || '')));
      l.append(el('div', 'card-level', U.dist(entry.d || 0)));
      c.append(l);
      c.append(el('div', 'card-blurb', entry.text + (entry.detail ? ' — ' + entry.detail : '')));
      b.append(c);
    }
  }

  /* ---------------- per-frame HUD */

  function tick(ui, dt) {
    const g = ui.game, s = ui.state, c = g.ctrl;
    ui.distance.textContent = U.dist(g.distance);
    ui.best.textContent = 'best ' + U.dist(Math.max(s.best, g.distance));
    ui.districtName.textContent = g.district.name;
    ui.districtTag.textContent = g.district.tag + '  ·  x' + g.district.mult;
    ui.momentum.textContent = U.num(s.momentum) + ' M';
    ui.rate.textContent = U.num(g.rateEMA) + ' /s';

    const st = c.state;
    ui.chipState.textContent = st;
    ui.chipHint.textContent = STATE_HINT[st] || '';
    const col = STATE_COL[st] || '#fff';
    ui.chip.style.color = col;
    ui.chip.style.borderColor = col + '55';
    ui.chip.style.background = col + '14';

    ui.barIntegrity.style.width = (c.integrity * 100).toFixed(1) + '%';
    ui.barIntegrity.style.background = c.integrity > 0.5 ? '#8fe3a0' : c.integrity > 0.22 ? '#ffb057' : '#ff5d6c';
    ui.barConsc.style.width = (c.consciousness * 100).toFixed(1) + '%';
    const bal = clamp(1 - Math.abs(c.balanceErr) / Math.max(0.1, c.reach), 0, 1);
    ui.barBalance.style.width = (bal * 100).toFixed(1) + '%';
    ui.barBalance.style.background = bal > 0.4 ? '#7ec8ff' : '#ffa14a';

    if (c.notes.length !== ui.noteCount || ui.noteT > 0.2) {
      ui.noteCount = c.notes.length; ui.noteT = 0;
      ui.notes.innerHTML = '';
      for (const n of c.notes.slice(-3)) {
        const e = el('div', 'note ' + n.kind, n.text);
        e.style.opacity = clamp(1.2 - n.t / 3, 0, 1);
        ui.notes.append(e);
      }
    }
    ui.noteT = (ui.noteT || 0) + dt;

    if (g.banner) {
      ui.banner.classList.add('show');
      ui.banner.classList.toggle('gate', !!g.banner.gate);
      ui.banner.classList.toggle('record', !!g.banner.record);
      ui.bannerTitle.textContent = g.banner.title;
      ui.bannerSub.textContent = g.banner.sub;
    } else ui.banner.classList.remove('show');

    ui.acc += dt;
    if (ui.acc > 0.2) {
      ui.acc = 0;
      if (ui.tab === 'train') updateTrain(ui);
    }
  }

  return { build, render, tick, el, STATE_COL };
})();
