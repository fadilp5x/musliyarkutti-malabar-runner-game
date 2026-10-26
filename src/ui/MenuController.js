// MenuController.js — builds all menu screens: loading, tap, pause, gameover,
// settings, missions, inventory. DOM only, no three.js.

const DEFAULT_SETTINGS = {
  sound: true,
  subtitles: true,
  tutorialNext: false,
  reducedMotion: false,
  quality: 'high',
  shaytan: 'classic', // apparition variant: classic | reaper | shaythaan
  volumeMusic: 0.8,
  volumeAmbience: 0.7,
  volumeEffects: 0.9,
  volumeShaytan: 0.8,
};

const MISSION_FALLBACK = [
  { id: 'run500', name: 'Run 500 m in one run', target: 500, reward: 50 },
  { id: 'coins100', name: 'Collect 100 coins', target: 100, reward: 50 },
  { id: 'nearmiss10', name: '10 near-misses', target: 10, reward: 75 },
  { id: 'voucher1', name: 'Collect 1 voucher', target: 1, reward: 100 },
];

const BOARD_FALLBACK = [
  { id: 'palm', name: 'Palm Board', cost: 0 },
  { id: 'gold', name: 'Gold Board', cost: 500 },
  { id: 'cyan', name: 'Cyan Board', cost: 1500 },
];

export class MenuController {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.returnTo = 'hud'; // where "Back" buttons go
    this._resetArmed = false;
    this._buildAll();
  }

  click(fn) {
    return (e) => {
      e.stopPropagation();
      try { this.game.audio?.play?.('click'); } catch { /* noop */ }
      fn();
    };
  }

  makeBtn(label, cls, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + (cls || '');
    b.textContent = label;
    b.addEventListener('click', this.click(fn));
    return b;
  }

  makeScreen(name) {
    const el = document.createElement('div');
    el.className = 'screen hidden';
    el.id = 'screen-' + name;
    const panel = document.createElement('div');
    panel.className = 'panel';
    el.appendChild(panel);
    this.ui.registerScreen(name, el);
    return { el, panel };
  }

  _settings() {
    let s = {};
    try { s = this.game.save?.load?.()?.settings || {}; } catch { s = {}; }
    return { ...DEFAULT_SETTINGS, ...s };
  }

  _applySettings(s) {
    try { this.game.save?.save?.({ settings: { ...s } }); } catch { /* noop */ }
    try { this.game.audio?.setEnabled?.(!!s.sound); } catch { /* noop */ }
    try { this.game.audio?.setVolumes?.(s); } catch { /* noop */ }
    try { this.game.ui?.subtitles?.setEnabled?.(s.subtitles !== false); } catch { /* noop */ }
    // GRAPHICS OVERHAUL: three tiers now; Game.setQuality applies pixel
    // ratio, shadow map, bloom and world scenery/shadow resolution in one go.
    try {
      if (typeof this.game.setQuality === 'function') this.game.setQuality(s.quality);
      else this.game.world?.setQuality?.(s.quality === 'low' ? 'low' : 'high');
    } catch { /* noop */ }
    try { document.getElementById('ui')?.classList.toggle('reduced-motion', !!s.reducedMotion); } catch { /* noop */ }
  }

  // ---------------------------------------------------------------- loading
  _buildLoading() {
    const { panel } = this.makeScreen('loading');
    panel.classList.add('thakarppan-loading');

    const title = document.createElement('div');
    title.className = 'thakarppan-title';
    title.innerHTML = 'MUSLIYARKUTTI<br><span class="accent">MALABAR RUNNER</span>';
    panel.appendChild(title);

    const flair = document.createElement('div');
    flair.className = 'thakarppan-flair';
    flair.textContent = 'THAKARPPAN LOADING';
    panel.appendChild(flair);

    const barWrap = document.createElement('div');
    barWrap.className = 'load-bar-wrap';
    const barFill = document.createElement('div');
    barFill.className = 'load-bar-fill';
    barWrap.appendChild(barFill);
    panel.appendChild(barWrap);
    this.loadBarFill = barFill;

    this.loadPct = document.createElement('div');
    this.loadPct.className = 'load-pct';
    this.loadPct.textContent = '0%';
    panel.appendChild(this.loadPct);

    this.loadText = document.createElement('div');
    this.loadText.className = 'load-text';
    this.loadText.textContent = 'Starting...';
    panel.appendChild(this.loadText);
  }

  setLoadingProgress(pct, text) {
    const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
    if (this.loadBarFill) this.loadBarFill.style.width = p + '%';
    if (this.loadPct) this.loadPct.textContent = p + '%';
    if (this.loadText && text !== undefined) this.loadText.textContent = text;
  }

  // ---------------------------------------------------------------- tap
  _buildTap() {
    const el = document.createElement('div');
    el.className = 'screen hidden';
    el.id = 'screen-tap';

    // CSS-only animated library backdrop (shelves glow + drifting dust).
    const bg = document.createElement('div');
    bg.className = 'tap-bg';
    bg.setAttribute('aria-hidden', 'true');
    el.appendChild(bg);

    const title = document.createElement('h1');
    title.className = 'game-title';
    title.innerHTML = 'MUSLIYARKUTTI<br><span class="accent">MALABAR RUNNER</span>';
    el.appendChild(title);

    const rule = document.createElement('div');
    rule.className = 'title-rule';
    rule.setAttribute('aria-hidden', 'true');
    el.appendChild(rule);

    const sub = document.createElement('p');
    sub.className = 'subtitle';
    sub.textContent = 'Kuttikkattur \u00B7 Kozhikode';
    el.appendChild(sub);

    this.tapStats = document.createElement('div');
    this.tapStats.className = 'best-stats';
    el.appendChild(this.tapStats);

    const hint = document.createElement('div');
    hint.className = 'tap-hint';
    hint.textContent = 'TAP ANYWHERE TO BEGIN';
    el.appendChild(hint);

    const controls = document.createElement('div');
    controls.className = 'controls-hint';
    controls.innerHTML =
      '\u2190 \u2192 / A D \u2014 switch lane &nbsp;\u00B7&nbsp; \u2191 / Space \u2014 jump<br>' +
      '\u2193 / S \u2014 slide &nbsp;\u00B7&nbsp; Esc \u2014 pause &nbsp;\u00B7&nbsp; swipe on mobile';
    el.appendChild(controls);

    const corner = document.createElement('div');
    corner.className = 'corner-links';
    const mk = (label, screen) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn secondary small';
      b.textContent = label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        try { this.game.audio?.play?.('click'); } catch { /* noop */ }
        this.returnTo = 'tap';
        this.ui.show(screen);
      });
      corner.appendChild(b);
    };
    mk('Missions', 'missions');
    mk('Settings', 'settings');
    mk('Credits', 'credits');
    el.appendChild(corner);

    el.addEventListener('click', () => {
      try { this.game.audio?.play?.('start'); } catch { /* noop */ }
      try { this.game.startRun?.(); } catch { /* engine not ready */ }
    });

    this.tapEl = el;
    this.ui.registerScreen('tap', el);
  }

  // Best score / best distance / lifetime coins on the title screen.
  renderTap() {
    if (!this.tapStats) return;
    let d = {};
    try { d = this.game.save?.load?.() || {}; } catch { d = {}; }
    this.tapStats.innerHTML = '';
    const cells = [
      ['Best score', Math.floor(d.highscore || 0)],
      ['Best distance', Math.floor(d.bestDistance || 0) + ' m'],
      ['Coins', Math.floor(d.coins || 0)],
    ];
    for (const [label, value] of cells) {
      const cell = document.createElement('div');
      cell.className = 'bstat';
      const l = document.createElement('span');
      l.className = 'label';
      l.textContent = label;
      const v = document.createElement('span');
      v.className = 'value';
      v.textContent = String(value);
      cell.appendChild(l);
      cell.appendChild(v);
      this.tapStats.appendChild(cell);
    }
    // Skip Intro (Oct 14, 2026): shown only after the player has seen the
    // cinematic once. Jumps straight to the runner.
    if (this.skipIntroBtn) this.skipIntroBtn.remove();
    this.skipIntroBtn = null;
    if (d.hasSeenIntro) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn secondary small skip-intro-btn';
      btn.textContent = 'Skip Intro →';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        try { this.game.audio?.play?.('click'); } catch {}
        try { this.game.skipIntro?.(); } catch {}
      });
      // Insert after the tap hint
      const hint = this.tapEl?.querySelector('.tap-hint');
      if (hint && hint.parentNode) {
        hint.parentNode.insertBefore(btn, hint.nextSibling);
      }
      this.skipIntroBtn = btn;
    }
  }

  // ---------------------------------------------------------------- credits
  _buildCredits() {
    const { panel } = this.makeScreen('credits');
    panel.classList.add('credits-panel');

    const kicker = document.createElement('div');
    kicker.className = 'credits-kicker';
    kicker.textContent = 'DEVELOPER';
    panel.appendChild(kicker);

    // Each letter gets its own span for the staggered wave-in animation.
    // The rainbow cycling is done via CSS hue-rotate on the whole name.
    const name = document.createElement('div');
    name.className = 'credits-name';
    const handle = 'fadilp5x';
    for (let i = 0; i < handle.length; i++) {
      const ch = document.createElement('span');
      ch.className = 'credits-letter';
      ch.style.animationDelay = (i * 0.08) + 's';
      ch.textContent = handle[i];
      name.appendChild(ch);
    }
    panel.appendChild(name);

    const gh = document.createElement('a');
    gh.className = 'credits-github';
    gh.href = 'https://github.com/fadilp5x';
    gh.target = '_blank';
    gh.rel = 'noopener';
    gh.textContent = 'github.com/fadilp5x';
    // Don't let the link tap start the game (credits is reached from title).
    gh.addEventListener('click', (e) => e.stopPropagation());
    panel.appendChild(gh);

    const blurb = document.createElement('div');
    blurb.className = 'credits-blurb';
    blurb.textContent = 'Built with Three.js + Vite';
    panel.appendChild(blurb);

    const row = document.createElement('div');
    row.className = 'btn-row';
    row.appendChild(this.makeBtn('Back', 'secondary', () => {
      this.ui.show(this.returnTo || 'tap');
    }));
    panel.appendChild(row);
  }

  // ---------------------------------------------------------------- pause
  _buildPause() {
    const { panel } = this.makeScreen('pause');
    const t = document.createElement('h2');
    t.className = 'panel-title';
    t.textContent = 'Paused';
    panel.appendChild(t);

    panel.appendChild(this.makeBtn('Resume', '', () => {
      try { this.game.togglePause?.(); } catch { /* noop */ }
    }));
    panel.appendChild(this.makeBtn('Restart', 'secondary', () => {
      try { this.game.restart?.(); } catch { /* noop */ }
    }));

    const row = document.createElement('div');
    row.className = 'btn-row';
    const go = (label, screen) => {
      const b = this.makeBtn(label, 'secondary small', () => {
        this.returnTo = 'pause';
        this.ui.show(screen);
      });
      row.appendChild(b);
    };
    go('Settings', 'settings');
    go('Missions', 'missions');
    go('Inventory', 'inventory');
    go('Wallet', 'wallet');
    panel.appendChild(row);

    panel.appendChild(this.makeBtn('Quit to Title', 'danger', () => {
      try { this.game.setState?.('LIBRARY'); } catch { /* noop */ }
      this.ui.show('tap');
    }));
  }

  // ---------------------------------------------------------------- gameover
  _buildGameOver() {
    const { panel } = this.makeScreen('gameover');
    const t = document.createElement('h2');
    t.className = 'panel-title';
    t.textContent = 'Game Over';
    panel.appendChild(t);

    this.goBest = document.createElement('div');
    this.goBest.className = 'newbest hidden';
    this.goBest.textContent = 'NEW BEST!';
    panel.appendChild(this.goBest);

    this.goGrid = document.createElement('div');
    this.goGrid.className = 'stat-grid';
    panel.appendChild(this.goGrid);

    const row = document.createElement('div');
    row.className = 'btn-row';
    row.appendChild(this.makeBtn('Run Again', '', () => {
      try { this.game.restart?.(); } catch { /* noop */ }
    }));
    row.appendChild(this.makeBtn('Wallet', 'secondary small', () => {
      this.returnTo = 'gameover';
      this.ui.show('wallet');
    }));
    row.appendChild(this.makeBtn('Menu', 'secondary small', () => {
      this.ui.show('tap');
    }));
    panel.appendChild(row);
  }

  renderGameOver(data = {}) {
    const grid = this.goGrid;
    grid.innerHTML = '';
    const cells = [
      ['Score', Math.floor(data.score ?? this.game.scoring?.score ?? 0), false],
      ['Best', Math.floor(data.best ?? this.game.scoring?.best ?? 0), true],
      ['Distance', Math.floor(data.distanceM ?? this.game.scoring?.distanceM ?? 0) + ' m', false],
      ['Coins', data.coins ?? this.game.scoring?.coins ?? 0, true],
    ];
    for (const [label, value, gold] of cells) {
      const c = document.createElement('div');
      c.className = 'stat-cell';
      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = label;
      const v = document.createElement('div');
      v.className = 'value' + (gold ? ' gold' : '');
      v.textContent = String(value);
      c.appendChild(l);
      c.appendChild(v);
      grid.appendChild(c);
    }
    const isBest = !!data.isNewBest;
    this.goBest.classList.toggle('hidden', !isBest);
  }

  // ---------------------------------------------------------------- settings
  _buildSettings() {
    const { panel } = this.makeScreen('settings');
    const t = document.createElement('h2');
    t.className = 'panel-title';
    t.textContent = 'Settings';
    panel.appendChild(t);

    this.settingsRows = document.createElement('div');
    this.settingsRows.className = 'scroll-list';
    panel.appendChild(this.settingsRows);

    const row = document.createElement('div');
    row.className = 'btn-row';
    row.appendChild(this.makeBtn('Back', 'secondary', () => {
      this.ui.show(this.returnTo || 'tap');
    }));
    panel.appendChild(row);
  }

  renderSettings() {
    const host = this.settingsRows;
    host.innerHTML = '';
    const s = this._settings();

    const toggleRow = (label, key) => {
      const row = document.createElement('div');
      row.className = 'setting-row';
      const lab = document.createElement('span');
      lab.textContent = label;
      const tg = document.createElement('button');
      tg.type = 'button';
      tg.className = 'toggle';
      tg.setAttribute('role', 'switch');
      tg.setAttribute('aria-checked', String(!!s[key]));
      tg.setAttribute('aria-label', label);
      tg.addEventListener('click', this.click(() => {
        s[key] = !s[key];
        tg.setAttribute('aria-checked', String(!!s[key]));
        this._applySettings(s);
      }));
      row.appendChild(lab);
      row.appendChild(tg);
      host.appendChild(row);
    };

    toggleRow('Sound', 'sound');
    toggleRow('Subtitles', 'subtitles');
    toggleRow('Tutorial on next run', 'tutorialNext');
    toggleRow('Reduced motion', 'reducedMotion');

    const VOL_ROWS = [
      ['Music', 'volumeMusic', 'Background track: user-supplied'],
      ['Ambience', 'volumeAmbience', null],
      ['Effects', 'volumeEffects', null],
      ['Shaytan', 'volumeShaytan', null],
    ];
    for (const [label, key, note] of VOL_ROWS) {
      const row = document.createElement('div');
      row.className = 'setting-row vol-row';
      const lab = document.createElement('span');
      lab.textContent = label;
      row.appendChild(lab);

      const wrap = document.createElement('div');
      wrap.className = 'vol-wrap';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '1';
      const pct = Math.round((typeof s[key] === 'number' ? s[key] : DEFAULT_SETTINGS[key]) * 100);
      input.value = String(pct);
      input.setAttribute('aria-label', label + ' volume');
      const val = document.createElement('span');
      val.className = 'vol-val';
      val.textContent = pct + '%';
      const apply = () => {
        const v = Number(input.value) / 100;
        s[key] = v;
        val.textContent = input.value + '%';
        try { this.game.audio?.setVolumes?.({ [key]: v }); } catch { /* noop */ }
      };
      input.addEventListener('input', apply); // live, no restart
      input.addEventListener('change', () => { apply(); this._applySettings(s); });
      wrap.appendChild(input);
      wrap.appendChild(val);
      row.appendChild(wrap);
      host.appendChild(row);

      if (note) {
        const cap = document.createElement('div');
        cap.className = 'vol-note';
        cap.textContent = note;
        host.appendChild(cap);
      }
    }

    const qRow = document.createElement('div');
    qRow.className = 'setting-row';
    const qLab = document.createElement('span');
    qLab.textContent = 'Quality';
    const seg = document.createElement('div');
    seg.className = 'seg';
    // GRAPHICS OVERHAUL: Low / Medium / High tiers (was High/Low).
    for (const q of ['low', 'medium', 'high']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = q === 'high' ? 'High' : q === 'medium' ? 'Medium' : 'Low';
      b.setAttribute('aria-pressed', String(s.quality === q));
      b.addEventListener('click', this.click(() => {
        s.quality = q;
        seg.querySelectorAll('button').forEach((x) =>
          x.setAttribute('aria-pressed', String(x === b)));
        this._applySettings(s);
      }));
      seg.appendChild(b);
    }
    qRow.appendChild(qLab);
    qRow.appendChild(seg);
    host.appendChild(qRow);

    // Shaytan apparition (Oct 13, 2026): fari's models, switchable any time.
    // Classic = procedural smoke form; Reaper / Shaythaan = supplied GLBs
    // (static meshes presented as hovering apparitions; lazy-loaded on
    // first selection, never at boot).
    const shRow = document.createElement('div');
    shRow.className = 'setting-row';
    const shLab = document.createElement('span');
    shLab.textContent = 'Shaytan';
    const shSeg = document.createElement('div');
    shSeg.className = 'seg';
    const SHAYTAN_OPTS = [
      ['classic', 'Classic'],
      ['reaper', 'Reaper'],
      ['shaythaan', 'Shaythaan'],
    ];
    const curSh = s.shaytan === 'reaper' || s.shaytan === 'shaythaan' ? s.shaytan : 'classic';
    for (const [val, label] of SHAYTAN_OPTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(curSh === val));
      b.setAttribute('aria-label', 'Shaytan apparition: ' + label);
      b.addEventListener('click', this.click(() => {
        s.shaytan = val;
        shSeg.querySelectorAll('button').forEach((x) =>
          x.setAttribute('aria-pressed', String(x === b)));
        this._applySettings(s);
        // Live-apply: the pursuit picks it up on the next run (and loads
        // the GLB in the background if it hasn't yet).
        try { this.game.pursuit?.setVariant?.(val); } catch { /* noop */ }
      }));
      shSeg.appendChild(b);
    }
    shRow.appendChild(shLab);
    shRow.appendChild(shSeg);
    host.appendChild(shRow);

    // Reset progress — double-click-to-confirm pattern
    const rRow = document.createElement('div');
    rRow.className = 'setting-row';
    const rLab = document.createElement('span');
    rLab.textContent = 'Reset all progress';
    const rBtn = document.createElement('button');
    rBtn.type = 'button';
    rBtn.className = 'btn danger small';
    rBtn.textContent = 'Reset';
    const disarm = () => {
      this._resetArmed = false;
      rBtn.textContent = 'Reset';
    };
    rBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try { this.game.audio?.play?.('click'); } catch { /* noop */ }
      if (!this._resetArmed) {
        this._resetArmed = true;
        rBtn.textContent = 'Tap again to confirm';
        setTimeout(disarm, 3000);
      } else {
        disarm();
        try { this.game.save?.reset?.(); } catch { /* noop */ }
        this._applySettings(this._settings());
        this.renderSettings();
      }
    });
    rRow.appendChild(rLab);
    rRow.appendChild(rBtn);
    host.appendChild(rRow);
  }

  // ---------------------------------------------------------------- missions
  _buildMissions() {
    const { panel } = this.makeScreen('missions');
    const t = document.createElement('h2');
    t.className = 'panel-title';
    t.textContent = 'Missions';
    panel.appendChild(t);

    this.missionList = document.createElement('div');
    this.missionList.className = 'scroll-list';
    panel.appendChild(this.missionList);

    const row = document.createElement('div');
    row.className = 'btn-row';
    row.appendChild(this.makeBtn('Back', 'secondary', () => {
      this.ui.show(this.returnTo || 'tap');
    }));
    panel.appendChild(row);
  }

  renderMissions() {
    const host = this.missionList;
    host.innerHTML = '';
    let defs = MISSION_FALLBACK;
    try {
      const d = this.game.missions?.defs;
      if (Array.isArray(d) && d.length) defs = d;
    } catch { /* fallback */ }

    let progress = {};
    try { progress = this.game.missions?.progress || {}; } catch { /* noop */ }
    let done = {};
    try { done = this.game.missions?.done || {}; } catch { /* noop */ }

    for (const m of defs) {
      const cur = Math.min(progress[m.id] || 0, m.target);
      const pct = m.target > 0 ? (cur / m.target) * 100 : 0;
      const claimed = !!done[m.id];

      const card = document.createElement('div');
      card.className = 'mission';

      const head = document.createElement('div');
      head.className = 'm-head';
      const nm = document.createElement('span');
      nm.className = 'm-name';
      nm.textContent = m.name;
      const rw = document.createElement('span');
      rw.className = 'm-reward';
      rw.textContent = '+' + m.reward + ' coins';
      head.appendChild(nm);
      head.appendChild(rw);
      card.appendChild(head);

      const bar = document.createElement('div');
      bar.className = 'm-prog';
      const fill = document.createElement('i');
      fill.style.width = pct.toFixed(1) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);

      const foot = document.createElement('div');
      foot.className = 'm-foot';
      const txt = document.createElement('span');
      txt.textContent = cur + ' / ' + m.target;
      foot.appendChild(txt);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      if (claimed) {
        btn.textContent = 'Claimed';
        btn.disabled = true;
      } else if (cur >= m.target) {
        btn.textContent = 'Claim';
        btn.addEventListener('click', this.click(() => {
          let reward = null;
          try { reward = this.game.missions?.claim?.(m.id); } catch { reward = null; }
          if (reward) {
            try { this.game.audio?.play?.('voucher'); } catch { /* noop */ }
            try { this.game.events?.emit?.('mission', { id: m.id, reward }); } catch { /* noop */ }
          }
          this.renderMissions();
        }));
      } else {
        btn.textContent = 'Claim';
        btn.disabled = true;
      }
      foot.appendChild(btn);
      card.appendChild(foot);
      host.appendChild(card);
    }
  }

  // ---------------------------------------------------------------- inventory
  _buildInventory() {
    const { panel } = this.makeScreen('inventory');
    const t = document.createElement('h2');
    t.className = 'panel-title';
    t.textContent = 'Glide Boards';
    panel.appendChild(t);

    this.invBalance = document.createElement('div');
    this.invBalance.className = 'coin-balance';
    panel.appendChild(this.invBalance);

    this.invList = document.createElement('div');
    this.invList.className = 'scroll-list';
    panel.appendChild(this.invList);

    const row = document.createElement('div');
    row.className = 'btn-row';
    row.appendChild(this.makeBtn('Back', 'secondary', () => {
      this.ui.show(this.returnTo || 'tap');
    }));
    panel.appendChild(row);
  }

  renderInventory() {
    const host = this.invList;
    host.innerHTML = '';

    let balance = 0;
    try { balance = this.game.save?.load?.()?.coins ?? 0; } catch { balance = 0; }
    this.invBalance.textContent = 'Balance: ' + balance + ' coins';

    let boards = BOARD_FALLBACK;
    try {
      const b = this.game.inventory?.boards;
      if (Array.isArray(b) && b.length) boards = b;
    } catch { /* fallback */ }

    let owned = ['palm'];
    try { owned = this.game.inventory?.owned || ['palm']; } catch { /* noop */ }
    let selected = 'palm';
    try { selected = this.game.inventory?.selected || 'palm'; } catch { /* noop */ }

    for (const b of boards) {
      const isOwned = owned.includes(b.id);
      const isSel = selected === b.id;

      const card = document.createElement('div');
      card.className = 'board-card' + (isSel ? ' selected' : '');

      const sw = document.createElement('div');
      sw.className = 'board-swatch ' + b.id;
      card.appendChild(sw);

      const info = document.createElement('div');
      info.className = 'board-info';
      const nm = document.createElement('div');
      nm.className = 'b-name';
      nm.textContent = b.name;
      const sub = document.createElement('div');
      sub.className = 'b-sub';
      sub.textContent = isOwned
        ? (isSel ? 'Currently selected' : 'Owned')
        : b.cost + ' coins';
      info.appendChild(nm);
      info.appendChild(sub);
      card.appendChild(info);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small' + (isSel ? ' secondary' : '');
      if (isSel) {
        btn.textContent = 'Selected';
        btn.disabled = true;
      } else if (isOwned) {
        btn.textContent = 'Select';
        btn.addEventListener('click', this.click(() => {
          try { this.game.inventory?.select?.(b.id); } catch { /* noop */ }
          this.renderInventory();
        }));
      } else {
        btn.textContent = 'Buy';
        btn.disabled = balance < b.cost;
        btn.addEventListener('click', this.click(() => {
          let ok = false;
          try { ok = !!this.game.inventory?.buy?.(b.id, balance); } catch { ok = false; }
          if (ok) {
            try { this.game.save?.save?.({ coins: balance - b.cost }); } catch { /* noop */ }
            try { this.game.audio?.play?.('powerup'); } catch { /* noop */ }
          }
          this.renderInventory();
        }));
      }
      card.appendChild(btn);
      host.appendChild(card);
    }
  }

  _buildAll() {
    this._buildLoading();
    this._buildTap();
    this._buildPause();
    this._buildGameOver();
    this._buildSettings();
    this._buildMissions();
    this._buildInventory();
    this._buildCredits();
    // 'wallet' screen is built lazily by VoucherWalletUI.
  }
}
