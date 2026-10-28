// MenuController.js — builds all menu screens: loading, tap, pause, gameover,
// settings, goals, wardrobe, missions, inventory. DOM only, no three.js.

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

  makeScreen(name, pageTitle) {
    const el = document.createElement('div');
    el.className = 'screen hidden';
    el.id = 'screen-' + name;
    const panel = document.createElement('div');
    panel.className = 'panel page-shell';
    if (name !== 'loading') {
      const header = document.createElement('header');
      header.className = 'page-header';
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn-ghost page-back';
      back.setAttribute('aria-label', 'Back');
      back.textContent = '←';
      back.addEventListener('click', this.click(() => {
        if (name === 'pause') {
          try { this.game.togglePause?.(); } catch { /* noop */ }
        } else {
          this.ui.show(this.returnTo || 'tap');
        }
      }));
      const title = document.createElement('h2');
      title.className = 'panel-title';
      title.textContent = pageTitle || (name === 'inventory' ? 'Glide Boards' : name[0].toUpperCase() + name.slice(1));
      header.append(back, title, document.createElement('span'));
      panel.appendChild(header);
    }
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
    this.game.ui?.particles?.setReducedMotion?.(s.reducedMotion);
  }

  // ---------------------------------------------------------------- loading
  _buildLoading() {
    const { el, panel } = this.makeScreen('loading');
    panel.remove(); // the full-screen splash has no constrained generic card
    el.classList.add('thakarppan-loading', 'loading-screen');

    const particles = document.createElement('div');
    particles.className = 'loading-particles';
    particles.setAttribute('aria-hidden', 'true');

    const splash = document.createElement('div');
    splash.className = 'loading-splash';
    splash.setAttribute('aria-hidden', 'true');
    splash.textContent = 'Made with love for the Muslim scholar and student communities of Kerala, Malaysia and across South and Southeast Asia.';

    const content = document.createElement('div');
    content.className = 'loading-content';

    const title = document.createElement('h1');
    title.className = 'loading-title';
    title.innerHTML = 'MUSLIYARKUTTI /<br>MALABAR RUNNER';

    const flair = document.createElement('div');
    flair.className = 'loading-flair';
    flair.textContent = 'GETTING THE ROAD READY';

    const barWrap = document.createElement('div');
    barWrap.className = 'load-bar-wrap';
    barWrap.setAttribute('role', 'progressbar');
    barWrap.setAttribute('aria-label', 'Loading game assets');
    barWrap.setAttribute('aria-valuemin', '0');
    barWrap.setAttribute('aria-valuemax', '100');
    barWrap.setAttribute('aria-valuenow', '0');
    const barFill = document.createElement('div');
    barFill.className = 'load-bar-fill';
    barWrap.appendChild(barFill);
    this.loadBarFill = barFill;

    this.loadPct = document.createElement('div');
    this.loadPct.className = 'load-pct';
    this.loadPct.textContent = '0%';

    this.loadText = document.createElement('div');
    this.loadText.className = 'load-text';
    this.loadText.textContent = 'Starting...';

    const tip = document.createElement('p');
    tip.className = 'loading-tip';
    tip.setAttribute('aria-live', 'polite');
    const tips = ['Slide under overhead gates', 'Collect gold letters', 'Race friends with a room code'];
    let tipIndex = 0;
    tip.textContent = tips[tipIndex];

    content.append(title, flair, barWrap, this.loadPct, this.loadText, tip);

    const owner = document.createElement('div');
    owner.className = 'loading-owner';
    owner.textContent = 'Fadil Muhammed P. · Built in Kerala';

    const productCredit = document.createElement('div');
    productCredit.className = 'loading-product-credit';
    productCredit.textContent = 'Multiplayer built with ChatGPT';

    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn btn-primary loading-start hidden';
    start.textContent = 'TAP TO START';
    start.addEventListener('click', (event) => {
      event.stopPropagation();
      try { this.game.audio?._unlock?.(); } catch { /* browser may deny audio */ }
      try { sessionStorage.setItem('mmr.loadingSeen', '1'); } catch { /* storage may be disabled */ }
      this._loadingStartDismissed = true;
      this.ui.show('tap');
    });

    el.append(particles, splash, content, owner, productCredit, start);
    this.loadingScreen = el;
    this.loadBarWrap = barWrap;
    this.loadingStartButton = start;
    this._loadingTips = tips;
    this._loadingStartedAt = performance.now();
    this._loadingMinMs = 0;
    this._loadingReady = false;
    this._loadingStartDismissed = false;
    this._loadingRaw = 0;
    this._loadingShown = 0;
    this._loadingFrame = 0;
    try {
      this._loadingMinMs = sessionStorage.getItem('mmr.loadingSeen') === '1' ? 0 : 3000;
      sessionStorage.setItem('mmr.loadingSeen', '1');
    } catch {
      this._loadingMinMs = 3000;
    }
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      this._settings().reducedMotion;
    if (!reduceMotion) {
      this.loadingTipTimer = window.setInterval(() => {
        tipIndex = (tipIndex + 1) % tips.length;
        tip.textContent = tips[tipIndex];
      }, 2600);
    }
    if (this._loadingMinMs === 0 || new URLSearchParams(window.location.search).get('loading-preview') === '1') {
      el.classList.add('progress-ready');
    } else {
      this.loadingRevealTimer = window.setTimeout(() => {
        el.classList.add('progress-ready');
      }, 1200);
    }
  }

  setLoadingProgress(pct, text) {
    const p = Math.max(this._loadingRaw || 0, Math.max(0, Math.min(100, Number(pct) || 0)));
    this._loadingRaw = p;
    if (this.loadText && text !== undefined) this.loadText.textContent = text;
    this._easeLoadingProgress();
    this._maybeShowLoadingStart();
  }

  _easeLoadingProgress() {
    if (this._loadingFrame || !this.loadBarFill) return;
    const tick = () => {
      this._loadingFrame = 0;
      const gap = this._loadingRaw - this._loadingShown;
      this._loadingShown = gap < 0.35 ? this._loadingRaw : this._loadingShown + gap * 0.18;
      const shown = Math.floor(this._loadingShown);
      this.loadBarFill.style.width = this._loadingShown.toFixed(2) + '%';
      this.loadBarWrap?.setAttribute('aria-valuenow', String(shown));
      if (this.loadPct) this.loadPct.textContent = shown + '%';
      if (this._loadingShown < this._loadingRaw) this._loadingFrame = requestAnimationFrame(tick);
      this._maybeShowLoadingStart();
    };
    this._loadingFrame = requestAnimationFrame(tick);
  }

  markLoadingComplete() {
    this._loadingReady = true;
    this._maybeShowLoadingStart();
  }

  _maybeShowLoadingStart() {
    if (!this._loadingReady || this._loadingShown < 99.95 || !this.loadingStartButton) return;
    const remaining = this._loadingMinMs - (performance.now() - this._loadingStartedAt);
    if (remaining > 0) {
      if (!this.loadingMinTimer) {
        this.loadingMinTimer = window.setTimeout(() => {
          this.loadingMinTimer = null;
          this._maybeShowLoadingStart();
        }, remaining);
      }
      return;
    }
    this.loadingStartButton.classList.remove('hidden');
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

    const storyButton = document.createElement('button');
    storyButton.type = 'button';
    storyButton.className = 'story-button';
    storyButton.setAttribute('aria-label', 'Play the story');
    storyButton.innerHTML = `<svg class="story-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle class="runner-head" cx="39" cy="11" r="7" />
      <path class="runner-body" d="M33 21 24 37l10 5 8-14 8 7 5-5-12-12z" />
      <path class="runner-limb" d="m31 25-12-5-8 7m22 15-13 8-10 1m22-9 11 5 8 10" />
      <path class="runner-limb" d="m42 22 10-8 7 2" />
    </svg><span>STORY</span>`;
    storyButton.addEventListener('click', this.click(() => this._playStoryTransition()));
    el.appendChild(storyButton);

    const title = document.createElement('h1');
    title.className = 'game-title';
    title.innerHTML = 'MUSLIYARKUTTI<br><span class="accent">MALABAR RUNNER</span>';
    el.appendChild(title);

    this.tapStats = document.createElement('div');
    this.tapStats.className = 'title-stats-pill';
    el.appendChild(this.tapStats);

    const mainActions = document.createElement('div');
    mainActions.className = 'title-main-actions';
    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'btn btn-primary title-play';
    playButton.textContent = 'PLAY';
    playButton.setAttribute('aria-label', 'Play');
    playButton.addEventListener('click', this.click(() => this.game.startRun?.({ story: 'auto' })));
    mainActions.appendChild(playButton);
    el.appendChild(mainActions);

    const transition = document.createElement('div');
    transition.className = 'story-transition-layer hidden';
    transition.setAttribute('aria-hidden', 'true');
    transition.innerHTML = `<svg class="story-runner-mark" viewBox="0 0 64 64">
      <circle class="runner-head" cx="39" cy="11" r="7" />
      <path class="runner-body" d="M33 21 24 37l10 5 8-14 8 7 5-5-12-12z" />
      <path class="runner-limb" d="m31 25-12-5-8 7m22 15-13 8-10 1m22-9 11 5 8 10" />
      <path class="runner-limb" d="m42 22 10-8 7 2" />
    </svg><div class="story-flash"></div><div class="story-fade"></div>`;
    el.appendChild(transition);
    this.storyTransitionLayer = transition;

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
    mk('Goals', 'goals');
    mk('Wardrobe', 'wardrobe');
    mk('Settings', 'settings');
    mk('Credits', 'credits');
    el.appendChild(corner);

    this.tapEl = el;
    this.ui.registerScreen('tap', el);
  }

  _playStoryTransition() {
    if (this._storyTransitioning) return;
    this._storyTransitioning = true;
    this.tapEl?.classList.add('story-starting');
    this.storyTransitionLayer?.classList.remove('hidden');
    this.tapEl?.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      this._settings().reducedMotion;
    const beginStory = () => {
      this.storyTransitionLayer?.classList.add('hidden');
      this.tapEl?.classList.remove('story-starting');
      this.tapEl?.querySelectorAll('button').forEach((button) => { button.disabled = false; });
      this._storyTransitioning = false;
      this.game.startRun?.({ story: 'force' });
    };
    if (reduced) beginStory();
    else window.setTimeout(beginStory, 1120);
  }

  // Best score / best distance / lifetime coins on the title screen.
  renderTap() {
    if (!this.tapStats) return;
    let d = {};
    try { d = this.game.save?.load?.() || {}; } catch { d = {}; }
    this.tapStats.replaceChildren();
    const best = document.createElement('span');
    best.textContent = `Best ${Math.floor(d.highscore || 0)}`;
    const distance = document.createElement('span');
    distance.textContent = `${Math.floor(d.bestDistance || 0)} m`;
    const coins = document.createElement('span');
    coins.className = 'title-coins';
    const coin = document.createElement('span');
    coin.className = 'coin-icon';
    coin.setAttribute('aria-hidden', 'true');
    coin.textContent = '\u0639';
    coins.append(coin, document.createTextNode(` ${Math.floor(d.coins || 0)} coins`));
    this.tapStats.append(best, distance, coins);
  }

  // ---------------------------------------------------------------- credits
  _buildCredits() {
    const { panel } = this.makeScreen('credits', 'Credits');
    panel.classList.add('credits-panel');

    const addCredit = (heading, copy) => {
      const section = document.createElement('section');
      section.className = 'credits-section';
      const title = document.createElement('h3');
      title.textContent = heading;
      const text = document.createElement('p');
      text.textContent = copy;
      section.append(title, text);
      panel.appendChild(section);
    };
    addCredit('Made by', 'Fadil Muhammed P. · Built in Kerala · fadilp5x');
    addCredit('Built with', 'Three.js · Vite · Multiplayer built with ChatGPT');
    addCredit('Audio and assets', 'Music made with Google Lyria · Voice made with ElevenLabs (free plan)');

    const dedication = document.createElement('p');
    dedication.className = 'credits-dedication';
    dedication.textContent = 'Made with love for the Muslim scholar and student communities of Kerala, Malaysia and across South and Southeast Asia.';
    panel.appendChild(dedication);

    const creditsLink = document.createElement('a');
    creditsLink.className = 'credits-file-link';
    creditsLink.href = 'https://github.com/fadilp5x/musliyarkutti-malabar-runner-game/blob/main/CREDITS.md';
    creditsLink.target = '_blank';
    creditsLink.rel = 'noopener';
    creditsLink.textContent = 'Full asset credits · CREDITS.md';
    creditsLink.addEventListener('click', (event) => event.stopPropagation());
    panel.appendChild(creditsLink);
  }

  // ---------------------------------------------------------------- pause
  _buildPause() {
    const { panel } = this.makeScreen('pause', 'Paused');

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
    go('Goals', 'goals');
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
    const { panel } = this.makeScreen('gameover', 'Run complete');

    this.goBest = document.createElement('div');
    this.goBest.className = 'newbest hidden';
    this.goBest.textContent = 'NEW BEST!';
    panel.appendChild(this.goBest);

    this.goGrid = document.createElement('div');
    this.goGrid.className = 'stat-grid';
    panel.appendChild(this.goGrid);

    const row = document.createElement('div');
    row.className = 'btn-row';
    row.appendChild(this.makeBtn('Play Again', 'primary gameover-replay', () => {
      try { this.game.restart?.(); } catch { /* noop */ }
    }));
    const nav = document.createElement('div');
    nav.className = 'btn-row gameover-home-row';
    nav.appendChild(this.makeBtn('Home', 'secondary small', () => {
      this.ui.show('tap');
    }));
    nav.appendChild(this.makeBtn('Multiplayer', 'secondary small', () => {
      document.querySelector('.party-trigger')?.click();
    }));
    panel.appendChild(row);
    panel.appendChild(nav);
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
      this._countUp(v, value);
    }
    const isBest = !!data.isNewBest;
    this.goBest.classList.toggle('hidden', !isBest);
  }

  _countUp(element, value) {
    const match = String(value).match(/^([\d,]+)(.*)$/);
    if (!match) return;
    const target = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(target) || target <= 0 || this.ui.root.classList.contains('reduced-motion')) return;
    const suffix = match[2];
    const start = performance.now();
    const duration = 520;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      element.textContent = Math.floor(target * eased).toLocaleString() + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    element.textContent = '0' + suffix;
    requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- settings
  _buildSettings() {
    const { panel } = this.makeScreen('settings', 'Settings');

    this.settingsRows = document.createElement('div');
    this.settingsRows.className = 'scroll-list';
    panel.appendChild(this.settingsRows);

    const guide = document.createElement('details');
    guide.className = 'controls-hint settings-guide';
    const guideTitle = document.createElement('summary');
    guideTitle.textContent = 'How to play';
    const guideCopy = document.createElement('p');
    guideCopy.textContent = 'Swipe or use ← → to change lanes · swipe up or ↑ / Space to jump · swipe down or ↓ / S to slide · Esc to pause.';
    guide.append(guideTitle, guideCopy);
    this.settingsRows.after(guide);
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
    const { panel } = this.makeScreen('missions', 'Missions');

    this.missionList = document.createElement('div');
    this.missionList.className = 'scroll-list';
    panel.appendChild(this.missionList);

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
    const { panel } = this.makeScreen('inventory', 'Glide Boards');

    this.invBalance = document.createElement('div');
    this.invBalance.className = 'coin-balance';
    panel.appendChild(this.invBalance);

    this.invList = document.createElement('div');
    this.invList.className = 'scroll-list';
    panel.appendChild(this.invList);

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
    this._buildGoals();
    this._buildInventory();
    this._buildWardrobe();
    this._buildCredits();
    // 'wallet' screen is built lazily by VoucherWalletUI.
  }

  _buildGoals() {
    const { panel } = this.makeScreen('goals', 'Goals');
    this.goalSummary = document.createElement('div');
    this.goalSummary.className = 'goal-summary';
    panel.appendChild(this.goalSummary);
    this.goalList = document.createElement('div');
    this.goalList.className = 'scroll-list goal-list';
    panel.appendChild(this.goalList);
    const row = document.createElement('div');
    row.className = 'btn-row page-action-bar';
    row.appendChild(this.makeBtn('View missions', 'secondary', () => this.ui.show('missions')));
    panel.appendChild(row);
  }

  renderGoals() {
    this.goalList.replaceChildren();
    const balance = Math.floor(this.game.save?.load?.()?.coins || 0);
    const goals = this.game.goals?.list?.() || [];
    const readyCount = goals.filter((goal) => goal.progress >= goal.target).length;
    this.goalSummary.textContent = `${readyCount} of ${goals.length} goals ready to claim · ${balance} coins`;
    const orderedGoals = goals.map((goal, index) => ({ goal, index })).sort((a, b) => Number(b.goal.progress >= b.goal.target) - Number(a.goal.progress >= a.goal.target) || a.index - b.index).map(({ goal }) => goal);
    for (const goal of orderedGoals) {
      const card = document.createElement('article');
      card.className = 'goal-card';
      const head = document.createElement('div');
      head.className = 'goal-head';
      const title = document.createElement('strong');
      title.textContent = `${goal.name} · Level ${goal.level}`;
      const reward = document.createElement('span');
      reward.textContent = `+${goal.reward} coins`;
      head.append(title, reward);
      const detail = document.createElement('p');
      detail.textContent = goal.detail;
      const progress = document.createElement('div');
      progress.className = 'goal-progress';
      const fill = document.createElement('i');
      fill.style.width = `${Math.min(100, goal.progress / goal.target * 100)}%`;
      progress.appendChild(fill);
      const foot = document.createElement('div');
      foot.className = 'goal-foot';
      const count = document.createElement('span');
      const unit = goal.stat === 'distance' || goal.stat === 'runDistance' ? 'm' : '';
      count.textContent = `${Math.floor(Math.min(goal.progress, goal.target))} / ${goal.target} ${unit}`.trim();
      if (goal.progress >= goal.target) {
        const claim = document.createElement('button');
        claim.type = 'button';
        claim.className = 'btn btn-primary small goal-claim';
        claim.textContent = 'Claim';
        claim.addEventListener('click', this.click(() => {
          this.game.claimGoal?.(goal.id);
          this.renderGoals();
        }));
        foot.append(count, claim);
      } else {
        const state = document.createElement('span');
        state.className = 'goal-state';
        state.textContent = count.textContent;
        foot.append(state);
      }
      card.append(head, detail, progress, foot);
      this.goalList.appendChild(card);
    }
  }

  _buildWardrobe() {
    const { panel } = this.makeScreen('wardrobe', 'Wardrobe');
    const note = document.createElement('p');
    note.className = 'wardrobe-note';
    note.textContent = 'Choose cloth colours for your jubba, thalappav and lungi border. Earn Arabic-letter coins on the road to unlock more looks.';
    panel.appendChild(note);
    this.wardrobeBalance = document.createElement('div');
    this.wardrobeBalance.className = 'coin-balance';
    panel.appendChild(this.wardrobeBalance);
    this.wardrobeList = document.createElement('div');
    this.wardrobeList.className = 'scroll-list wardrobe-list';
    panel.appendChild(this.wardrobeList);
  }

  renderWardrobe() {
    this.wardrobeList.replaceChildren();
    const balance = Math.floor(this.game.save?.load?.()?.coins || 0);
    this.wardrobeBalance.textContent = `Arabic-letter coins: ${balance}`;
    const owned = this.game.wardrobe?.owned || ['classic'];
    const selected = this.game.wardrobe?.selected || 'classic';
    for (const skin of this.game.wardrobe?.skins || []) {
      const card = document.createElement('article');
      card.className = `wardrobe-card${selected === skin.id ? ' selected' : ''}`;
      const swatch = document.createElement('div');
      swatch.className = 'wardrobe-swatch';
      for (const [part, color] of [['jubba', skin.colors.jubba], ['thalappav', skin.colors.thalappav], ['border', skin.colors.border]]) {
        const chip = document.createElement('i');
        chip.className = `cloth-${part}`;
        chip.style.backgroundColor = `#${color.toString(16).padStart(6, '0')}`;
        swatch.appendChild(chip);
      }
      const info = document.createElement('div');
      info.className = 'wardrobe-info';
      const name = document.createElement('strong');
      name.textContent = skin.name;
      const status = document.createElement('span');
      status.textContent = owned.includes(skin.id) ? (selected === skin.id ? 'Wearing' : 'Owned') : `${skin.cost} coins`;
      info.append(name, status);
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'btn small';
      if (selected === skin.id) {
        action.textContent = 'Selected';
        action.disabled = true;
      } else if (owned.includes(skin.id)) {
        action.textContent = 'Wear';
        action.addEventListener('click', this.click(() => {
          this.game.selectSkin?.(skin.id);
          this.renderWardrobe();
        }));
      } else {
        action.textContent = 'Unlock';
        action.disabled = balance < skin.cost;
        action.addEventListener('click', this.click(() => {
          this.game.buySkin?.(skin.id);
          this.renderWardrobe();
        }));
      }
      card.append(swatch, info, action);
      this.wardrobeList.appendChild(card);
    }
  }
}
