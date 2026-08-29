/* IRONWAKE — the readable half.
   Everything a tactics game asks you to weigh is a number, and numbers belong
   in DOM, not painted into a canvas at whatever size the perspective felt
   like. The canvas shows the fight; this shows the decision. */
K.ui = (function () {
  const U = K.util, Un = K.units;
  const { clamp } = U;
  const $ = (id) => document.getElementById(id);
  let el = {}, H = {};

  function init(handlers) {
    H = handlers;
    el = {
      phase: $('phase'), phaseB: $('phase').querySelector('b'), turn: $('turn'),
      tallyMine: $('tallyMine'), tallyTheirs: $('tallyTheirs'),
      banner: $('banner'), bannerB: $('banner').querySelector('b'), bannerS: $('banner').querySelector('span'),
      card: $('card'), cName: $('cName'), cClass: $('cClass'), cHp: $('cHp'), cMax: $('cMax'),
      cHpFill: $('cHpFill'), cStats: $('cStats'), cWeapon: $('cWeapon'), cTerrain: $('cTerrain'),
      forecast: $('forecast'), fcA: $('fcA'), fcB: $('fcB'), fcVs: $('fcVs'),
      btnAttack: $('btnAttack'), btnWait: $('btnWait'), btnCancel: $('btnCancel'), btnEnd: $('btnEnd'),
      hint: $('hint'), log: $('log'), logBody: $('logBody'),
      over: $('over'), overTitle: $('overTitle'), overSub: $('overSub'),
      overList: $('overList'), btnAgain: $('btnAgain'), intro: $('intro'),
      runStat: $('runStat')
    };
    $('btnStart').onclick = () => { el.intro.classList.add('hidden'); H.start && H.start(); };
    $('btnAgain').onclick = () => { el.over.classList.add('hidden'); H.again && H.again(); };
    $('btnLog').onclick = () => el.log.classList.toggle('hidden');
    $('btnLogClose').onclick = () => el.log.classList.add('hidden');
    $('btnWipe').onclick = (e) => {
      const b = e.currentTarget;
      if (b.dataset.armed) { el.log.classList.add('hidden'); b.textContent = 'ABANDON RUN'; delete b.dataset.armed; H.wipe && H.wipe(); }
      else { b.textContent = 'SURE?'; b.dataset.armed = '1'; setTimeout(() => { b.textContent = 'ABANDON RUN'; delete b.dataset.armed; }, 3000); }
    };
    $('btnSound').onclick = (e) => {
      const on = !K.audio.isOn();
      K.audio.enable(on);
      e.currentTarget.classList.toggle('off', !on);
    };
    $('btnSound').classList.add('off');
    el.btnAttack.onclick = () => H.attack && H.attack();
    el.btnWait.onclick = () => H.wait && H.wait();
    el.btnCancel.onclick = () => H.cancel && H.cancel();
    el.btnEnd.onclick = () => H.end && H.end();
  }

  const STAT_ROWS = [['STR', 'str'], ['MAG', 'mag'], ['SKL', 'skl'], ['SPD', 'spd'],
                     ['LCK', 'lck'], ['DEF', 'def'], ['RES', 'res'], ['MOV', 'mov']];

  function unitCard(u) {
    if (!u) { el.card.classList.add('hidden'); return; }
    el.card.classList.remove('hidden');
    el.cName.textContent = u.name;
    el.cName.style.color = u.side === 0 ? 'var(--mine)' : 'var(--theirs)';
    el.cClass.textContent = u.cls + ' · lv ' + u.level + (u.dead ? ' · down' : u.acted ? ' · spent' : '');
    el.cHp.textContent = u.hp; el.cMax.textContent = u.maxHp;
    const frac = clamp(u.hp / u.maxHp, 0, 1);
    el.cHpFill.style.width = (frac * 100).toFixed(1) + '%';
    el.cHpFill.style.background = frac > 0.5 ? 'var(--good)' : frac > 0.25 ? 'var(--warn)' : 'var(--theirs)';
    let html = '';
    for (const [label, key] of STAT_ROWS) html += '<div>' + label + '<b>' + u[key] + '</b></div>';
    html += '<div>AS<b>' + Un.AS(u) + '</b></div>';
    html += '<div>EXP<b>' + u.exp + '</b></div>';
    el.cStats.innerHTML = html;
    el.cWeapon.textContent = u.weapon.name + ' · mt ' + u.weapon.mt + ' · rng ' +
      (u.weapon.rng[0] === u.weapon.rng[1] ? u.weapon.rng[0] : u.weapon.rng.join('-'));
    const s = u.surface;
    el.cTerrain.textContent = s
      ? s.t.name + (s.t.avoid ? ' +' + s.t.avoid + ' avo' : '') + (s.t.def ? ' +' + s.t.def + ' def' : '') +
        (s.y > 0.1 ? ' · +' + s.y.toFixed(1) + 'm' : '')
      : '';
  }

  function sideHtml(u, s, cls, willDie) {
    if (!s) return '<div class="n">' + u.name + '</div><div class="hp">' + u.hp + ' hp</div>' +
      '<div class="row"><span>no answer</span></div>';
    return '<div class="n">' + u.name + '</div>' +
      '<div class="hp">' + u.hp + '/' + u.maxHp + ' hp' + (willDie ? ' <b class="kill">· falls</b>' : '') + '</div>' +
      '<div class="row"><span>dmg</span><b class="dmg">' + s.dmg + (s.hits > 1 ? ' ×2' : '') + '</b></div>' +
      '<div class="row"><span>hit</span><b>' + s.acc + '%</b></div>' +
      '<div class="row"><span>crit</span><b>' + s.crit + '%</b></div>';
  }

  function forecast(pair, arena) {
    if (!pair) { el.forecast.classList.add('hidden'); return null; }
    // the odds are the odds from where the attacker will be standing, not
    // from where it happens to be standing while you think about it
    const save = pair.att.surface;
    if (pair.spot) pair.att.surface = pair.spot;
    const f = Un.forecast(pair.att, pair.def, arena);
    pair.att.surface = save;
    el.forecast.classList.remove('hidden');
    const defDies = f.a.total >= pair.def.hp;
    const attDies = f.b && f.b.total >= pair.att.hp;
    el.fcA.className = 'fcside ' + (pair.att.side === 0 ? 'mine' : 'theirs');
    el.fcB.className = 'fcside ' + (pair.def.side === 0 ? 'mine' : 'theirs') + (f.b ? '' : ' none');
    el.fcA.innerHTML = sideHtml(pair.att, f.a, '', attDies);
    el.fcB.innerHTML = sideHtml(pair.def, f.b, '', defDies);
    const tri = f.a.tri > 0 ? '<span class="tri up">triangle +</span>'
      : f.a.tri < 0 ? '<span class="tri down">triangle −</span>' : '';
    const high = f.a.high > 0.2 ? '<span class="tri up">high ground</span>'
      : f.a.high < -0.2 ? '<span class="tri down">below them</span>' : '';
    el.fcVs.innerHTML = 'vs' + tri + high;
    return f;
  }

  function log(entries) {
    let html = '';
    for (const e of entries) html += '<div class="' + e.kind + '">' + e.text + '</div>';
    el.logBody.innerHTML = html;
  }

  let lastLog = 0, lastBanner = null;

  /* pushed once per frame — cheap because every write is guarded */
  function sync(g) {
    const b = g.battle;
    el.phaseB.textContent = b.phase === 'player' ? 'PLAYER' : 'ENEMY';
    el.phase.classList.toggle('enemy', b.phase === 'enemy');
    el.turn.textContent = 'turn ' + b.turn + (b.wave > 1 ? ' · wave ' + b.wave : '');
    el.tallyMine.textContent = K.battle.living(b, 0).length;
    el.tallyTheirs.textContent = K.battle.living(b, 1).length;

    if (b.banner !== lastBanner) {
      lastBanner = b.banner;
      if (b.banner) {
        el.bannerB.textContent = b.banner.title;
        el.bannerS.textContent = b.banner.sub || '';
        el.banner.className = 'show ' + (b.banner.title.indexOf('ENEMY') === 0 ? 'enemy' : 'mine');
      } else el.banner.className = '';
    }

    // the forecast owns the bottom of the screen while it is up
    unitCard(g.pair ? null : g.cardUnit);
    g.fc = forecast(g.pair, b.arena);

    const busy = !!b.busy, mine = b.phase === 'player' && !b.over && !busy;
    el.btnAttack.classList.toggle('hidden', !(mine && g.pair));
    el.btnWait.classList.toggle('hidden', !(mine && b.sel && !b.reach));
    el.btnCancel.classList.toggle('hidden', !(mine && b.sel && b.reach));
    el.btnEnd.classList.toggle('hidden', !mine || !!b.sel);

    if (b.log.length !== lastLog) { lastLog = b.log.length; log(b.log); }
    if (g.run) el.runStat.textContent = 'run ' + ((g.run.runs || 0) + 1) + ' · best wave ' + (g.run.best || 0);

    el.hint.textContent = b.over ? ''
      : busy ? ''
      : b.phase === 'enemy' ? 'they move'
      : g.pair ? 'STRIKE to commit, or pick another'
      : b.sel && !b.reach ? 'pick a target, or WAIT'
      : b.sel ? 'blue to move · red to strike · tap them again to hold'
      : 'tap one of yours · drag to look · pinch to zoom';

    if (b.over && g.summary && el.over.classList.contains('hidden')) {
      const s = g.summary, won = b.over === 'win';
      el.overTitle.textContent = won ? 'FIELD HELD' : 'OVERRUN';
      el.overTitle.style.color = won ? 'var(--good)' : 'var(--theirs)';
      el.overSub.textContent = won
        ? 'wave ' + s.wave + ' taken on turn ' + b.turn
        : 'wave ' + s.wave + ' broke the line · best ' + (g.run.best || 0);
      let html = '';
      for (const u of s.survivors) {
        html += '<div class="up"><span>' + u.name + ' · ' + u.cls + '</span><b>lv ' + u.level + '</b></div>';
      }
      for (const name of s.lost) html += '<div class="gone"><span>' + name + '</span><b>fallen</b></div>';
      el.overList.innerHTML = html;
      el.btnAgain.textContent = won ? 'PRESS ON' : 'BEGIN AGAIN';
      el.over.classList.remove('hidden');
    }
  }

  return { init, sync, unitCard };
})();
