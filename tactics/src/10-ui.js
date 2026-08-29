/* IRONWAKE — the readable half.
   Everything a tactics game asks you to weigh is a number, and numbers belong
   in DOM, not painted into a canvas at whatever size the perspective felt
   like. It all lives in one strip along the bottom: on a phone the board is
   the scarce thing, and a panel that floats over it is a panel standing where
   you wanted to look. */
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
      bar: $('bar'), strip: $('strip'), unitStrip: $('unitStrip'), fcStrip: $('fcStrip'),
      uName: $('uName'), uClass: $('uClass'), uHp: $('uHp'), uHpFill: $('uHpFill'),
      uTerrain: $('uTerrain'), uStats: $('uStats'), btnMore: $('btnMore'),
      fcA: $('fcA'), fcB: $('fcB'), fcVs: $('fcVs'),
      btnAttack: $('btnAttack'), btnWait: $('btnWait'), btnCancel: $('btnCancel'), btnEnd: $('btnEnd'),
      hint: $('hint'), log: $('log'), logBody: $('logBody'), runStat: $('runStat'),
      sheet: $('sheet'), sName: $('sName'), sStats: $('sStats'), sWeapon: $('sWeapon'), sTag: $('sTag'),
      over: $('over'), overTitle: $('overTitle'), overSub: $('overSub'),
      overList: $('overList'), btnAgain: $('btnAgain'), intro: $('intro')
    };
    $('btnStart').onclick = () => { el.intro.classList.add('hidden'); H.start && H.start(); };
    $('btnAgain').onclick = () => { el.over.classList.add('hidden'); H.again && H.again(); };
    $('btnLog').onclick = () => el.log.classList.toggle('hidden');
    $('btnLogClose').onclick = () => el.log.classList.add('hidden');
    $('btnFit').onclick = () => H.fit && H.fit();
    $('btnSheetClose').onclick = () => el.sheet.classList.add('hidden');
    el.btnMore.onclick = () => el.sheet.classList.toggle('hidden');
    $('btnSound').onclick = (e) => {
      const on = !K.audio.isOn();
      K.audio.enable(on);
      e.currentTarget.classList.toggle('off', !on);
    };
    $('btnSound').classList.add('off');
    $('btnWipe').onclick = (e) => {
      const b = e.currentTarget;
      if (b.dataset.armed) {
        el.log.classList.add('hidden'); b.textContent = 'ABANDON RUN';
        delete b.dataset.armed; H.wipe && H.wipe();
      } else {
        b.textContent = 'SURE?'; b.dataset.armed = '1';
        setTimeout(() => { b.textContent = 'ABANDON RUN'; delete b.dataset.armed; }, 3000);
      }
    };
    el.btnAttack.onclick = () => H.attack && H.attack();
    el.btnWait.onclick = () => H.wait && H.wait();
    el.btnCancel.onclick = () => H.cancel && H.cancel();
    el.btnEnd.onclick = () => H.end && H.end();
  }

  /* how much screen the HUD is standing on, so the board can be framed in
     what is left rather than behind it */
  function band() {
    const t = el.bar ? 42 + (window.visualViewport ? 0 : 0) : 44;
    const b = el.bar ? el.bar.getBoundingClientRect().height : 96;
    return { top: t, bottom: Math.max(70, b + 4) };
  }

  const STAT_ROWS = [['STR', 'str'], ['MAG', 'mag'], ['SKL', 'skl'], ['SPD', 'spd'],
                     ['LCK', 'lck'], ['DEF', 'def'], ['RES', 'res'], ['MOV', 'mov']];

  function unitStrip(u) {
    const has = !!u;
    el.unitStrip.classList.toggle('empty', !has);
    el.uName.textContent = has ? u.name : 'IRONWAKE';
    el.uName.style.color = has ? (u.side === 0 ? 'var(--mine)' : 'var(--theirs)') : 'var(--dim)';
    el.uClass.textContent = has
      ? u.cls + ' · lv ' + u.level + (u.dead ? ' · down' : u.acted ? ' · spent' : '')
      : 'tap one of yours to give an order';
    el.uHp.textContent = has ? u.hp + ' / ' + u.maxHp : '';
    const frac = has ? clamp(u.hp / u.maxHp, 0, 1) : 0;
    el.uHpFill.style.width = (frac * 100).toFixed(1) + '%';
    el.uHpFill.style.background = frac > 0.5 ? 'var(--good)' : frac > 0.25 ? 'var(--warn)' : 'var(--theirs)';
    const s = has ? u.surface : null;
    el.uTerrain.textContent = s
      ? s.t.name + (s.t.avoid ? ' +' + s.t.avoid + 'avo' : '') + (s.y > 0.1 ? ' · ' + s.y.toFixed(1) + 'm' : '')
      : '';
    el.uStats.innerHTML = has
      ? (u.weapon.magic ? 'MAG <b>' + u.mag + '</b>' : 'STR <b>' + u.str + '</b>')
        + ' · DEF <b>' + u.def + '</b> · AS <b>' + Un.AS(u) + '</b> · MOV <b>' + u.mov + '</b>'
        + ' · <span style="color:var(--warn)">' + u.weapon.kind.toUpperCase() + '</span>'
      : '';
    el.btnMore.style.visibility = has ? 'visible' : 'hidden';
    if (has && !el.sheet.classList.contains('hidden')) sheet(u);
  }

  function sheet(u) {
    el.sName.textContent = u.name + ' · ' + u.cls + ' · lv ' + u.level;
    let html = '';
    for (const [label, key] of STAT_ROWS) html += '<div>' + label + '<b>' + u[key] + '</b></div>';
    html += '<div>AS<b>' + Un.AS(u) + '</b></div>';
    html += '<div>HP<b>' + u.hp + '/' + u.maxHp + '</b></div>';
    html += '<div>EXP<b>' + u.exp + '</b></div>';
    el.sStats.innerHTML = html;
    el.sWeapon.textContent = u.weapon.name + ' · mt ' + u.weapon.mt + ' · hit ' + u.weapon.hit
      + ' · rng ' + (u.weapon.rng[0] === u.weapon.rng[1] ? u.weapon.rng[0] : u.weapon.rng.join('-'));
    el.sTag.textContent = u.tag || '';
  }

  function side(u, s, dies) {
    const head = '<div class="n">' + u.name + '</div>'
      + '<div class="hp">' + u.hp + '/' + u.maxHp + (dies ? ' <b class="kill">falls</b>' : '') + '</div>';
    if (!s) return head + '<div class="num">cannot answer</div>';
    return head
      + '<div class="num"><b class="d">' + s.dmg + (s.hits > 1 ? ' ×2' : '') + '</b> dmg</div>'
      + '<div class="num"><b>' + s.acc + '%</b> hit' + (s.crit ? ' · <b>' + s.crit + '%</b> crit' : '') + '</div>';
  }

  function forecast(pair, arena) {
    if (!pair) { el.fcStrip.classList.add('hidden'); el.unitStrip.classList.remove('hidden'); return null; }
    // the odds are the odds from where the attacker will be standing, not
    // from where it happens to be standing while you think about it
    const save = pair.att.surface;
    if (pair.spot) pair.att.surface = pair.spot;
    const f = Un.forecast(pair.att, pair.def, arena);
    pair.att.surface = save;
    el.fcStrip.classList.remove('hidden');
    el.unitStrip.classList.add('hidden');
    el.sheet.classList.add('hidden');
    el.fcA.innerHTML = side(pair.att, f.a, f.b && f.b.total >= pair.att.hp);
    el.fcB.innerHTML = side(pair.def, f.b, f.a.total >= pair.def.hp);
    el.fcB.classList.toggle('none', !f.b);
    const bits = [];
    if (f.a.tri > 0) bits.push('<span class="tri up">triangle +</span>');
    else if (f.a.tri < 0) bits.push('<span class="tri down">triangle −</span>');
    if (f.a.high > 0.2) bits.push('<span class="tri up">high ground</span>');
    else if (f.a.high < -0.2) bits.push('<span class="tri down">below them</span>');
    el.fcVs.innerHTML = '<span class="tri">vs</span>' + bits.join('');
    return f;
  }

  function log(entries) {
    let html = '';
    for (const e of entries) html += '<div class="' + e.kind + '">' + e.text + '</div>';
    el.logBody.innerHTML = html;
  }

  let lastLog = 0, lastBanner = null;

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

    g.fc = forecast(g.pair, b.arena);
    if (!g.pair) unitStrip(g.cardUnit || b.sel);

    const busy = !!b.busy, mine = b.phase === 'player' && !b.over && !busy;
    el.btnAttack.classList.toggle('hidden', !(mine && g.pair));
    el.btnWait.classList.toggle('hidden', !(mine && b.sel && !b.reach && !g.pair));
    el.btnCancel.classList.toggle('hidden', !(mine && (g.pair || (b.sel && b.reach))));
    el.btnEnd.classList.toggle('hidden', !mine || !!b.sel);

    if (b.log.length !== lastLog) { lastLog = b.log.length; log(b.log); }
    if (g.run) el.runStat.textContent = 'run ' + ((g.run.runs || 0) + 1) + ' · best wave ' + (g.run.best || 0);

    el.hint.style.opacity = b.banner ? '0' : '1';
    const note = g.note && g.t - g.note.t < 2.2 ? g.note.text : null;
    el.hint.textContent = note ? note
      : b.over ? ''
      : busy ? ''
      : b.phase === 'enemy' ? 'they move'
      : g.pair ? 'STRIKE to commit'
      : b.sel && !b.reach ? 'pick a target, or WAIT'
      : b.sel ? 'blue to move · tap them to strike'
      : 'tap one of yours';

    if (b.over && g.summary && el.over.classList.contains('hidden')) {
      const s = g.summary, won = b.over === 'win';
      el.overTitle.textContent = won ? 'FIELD HELD' : 'OVERRUN';
      el.overTitle.style.color = won ? 'var(--good)' : 'var(--theirs)';
      el.overSub.textContent = won
        ? 'wave ' + s.wave + ' taken on turn ' + b.turn
        : 'wave ' + s.wave + ' broke the line · best ' + (g.run.best || 0);
      let html = '';
      for (const u of s.survivors) html += '<div class="up"><span>' + u.name + ' · ' + u.cls + '</span><b>lv ' + u.level + '</b></div>';
      for (const name of s.lost) html += '<div class="gone"><span>' + name + '</span><b>fallen</b></div>';
      el.overList.innerHTML = html;
      el.btnAgain.textContent = won ? 'PRESS ON' : 'BEGIN AGAIN';
      el.over.classList.remove('hidden');
    }
  }

  return { init, sync, band };
})();
