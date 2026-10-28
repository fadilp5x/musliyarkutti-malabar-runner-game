// UI.js — root UI class for MUSLIYARKUTTI: MALABAR RUNNER.
// Builds all DOM programmatically under #ui. DOM only, no three.js.

import './screens.css';
import { HUD } from './HUD.js';
import { MenuController } from './MenuController.js';
import { VoucherWalletUI } from './VoucherWalletUI.js';
import { SubtitleManager } from './SubtitleManager.js';
import { ParticleLayer } from './ParticleLayer.js';

export class UI {
  constructor(game, rootEl) {
    if (!rootEl) throw new Error('UI: rootEl (document.getElementById("ui")) is required');
    this.game = game;
    this.root = rootEl;
    this.root.classList.add('mmr-ui');

    this.particles = new ParticleLayer(game, this.root);

    this.screensEl = document.createElement('div');
    this.screensEl.className = 'mmr-screens';
    this.root.appendChild(this.screensEl);

    this.screenMap = new Map();
    this.current = null;

    // HUD lives outside the screens container so it can persist over overlays.
    this.hud = new HUD(game, this.root);

    // Subtitles (Oct 14, 2026): mounted at UI root, above screens.
    this.subtitles = new SubtitleManager();
    this.subtitles.mount(this.root);
    this.subtitles.load();

    // Skip-intro hint (Oct 14, 2026): upper-right during cinematic.
    this._skipHint = document.createElement('div');
    this._skipHint.className = 'skip-intro-hint hidden';
    this._skipHint.textContent = '⏭ PRESS ANY BUTTON TO SKIP INTRO';
    this._skipHint.addEventListener('click', (e) => {
      e.stopPropagation();
      try { this.game.skipCinematic?.(); } catch {}
    });
    this.root.appendChild(this._skipHint);

    // Tutorial choice overlay (Oct 14, 2026): first-time players choose.
    this._tutorialChoice = document.createElement('div');
    this._tutorialChoice.className = 'tutorial-choice hidden';
    this._tutorialChoice.innerHTML = `
      <div class="tutorial-choice-panel">
        <h2>HOW WOULD YOU LIKE TO PLAY?</h2>
        <p class="tutorial-desc">Learn how to move, jump, slide, collect Arabic-letter coins, and avoid road obstacles.</p>
        <div class="tutorial-buttons">
          <button type="button" class="btn primary" data-choice="with">PLAY WITH TUTORIAL</button>
          <button type="button" class="btn secondary" data-choice="without">PLAY WITHOUT TUTORIAL</button>
        </div>
      </div>`;
    this._tutorialChoice.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const choice = btn.dataset.choice;
        try { this.game.setTutorialPreference?.(choice); } catch {}
        this.hideTutorialChoice();
        try { this.game.proceedAfterTutorialChoice?.(); } catch {}
      });
    });
    this.root.appendChild(this._tutorialChoice);

    // Expose ui on game so HUD buttons can reach ui.show() (set defensively).
    try {
      if (game && !game.ui) game.ui = this;
    } catch { /* game may be frozen */ }

    this.menus = new MenuController(game, this);
    this.walletUI = new VoucherWalletUI(game, this);

    this.show('loading');

    try {
      game.events?.on?.('statechange', (s) => this._onStateChange(s));
    } catch { /* noop */ }
  }

  registerScreen(name, el) {
    this.screenMap.set(name, el);
    if (!el.parentElement) this.screensEl.appendChild(el);
  }

  // Map engine states to UI presentation. Manual show() calls always win for
  // the current turn; state changes re-sync.
  _onStateChange(s) {
    const CINEMATIC = ['LIBRARY_INTRO', 'LIBRARY_SEARCH', 'SHAYTAN_REVEAL', 'RECITATION', 'LIBRARY_ESCAPE', 'LIBRARY_EXIT', 'ACADEMY_GATE'];
    switch (s) {
      case 'LOADING':
        this.show('loading');
        this._setSkipHint(false);
        break;
      case 'LIBRARY':
        this.menus.markLoadingComplete?.();
        // First session load waits for the user to tap, which also unlocks audio.
        if ((this.menus._loadingMinMs > 0 && !this.menus._loadingStartDismissed) ||
            new URLSearchParams(window.location.search).get('loading-preview') === '1') {
          this.show('loading');
        } else {
          this.show('tap');
        }
        this._setSkipHint(false);
        this.subtitles.stop();
        break;
      case 'LIBRARY_INTRO':
      case 'LIBRARY_SEARCH':
      case 'SHAYTAN_REVEAL':
      case 'RECITATION':
      case 'LIBRARY_ESCAPE':
      case 'LIBRARY_EXIT':
      case 'ACADEMY_GATE':
        // Cinematic states: hide all UI overlays, the 3D scene tells the story.
        // Show the skip hint (any input skips).
        this.hideAll();
        this._setSkipHint(true);
        break;
      case 'SHAYTAN':
        this.hideAll();
        this._setSkipHint(false);
        break;
      case 'CHASE':
      case 'RUNNER':
      case 'RUNNING':
      case 'TUTORIAL':
        this.show('hud');
        this._setSkipHint(false);
        this.subtitles.stop();
        break;
      case 'PAUSED':
        this.show('pause');
        break;
      case 'GAMEOVER':
        this.show('gameover', { isNewBest: false });
        this._setSkipHint(false);
        break;
      default:
        break;
    }
  }

  _setSkipHint(show) {
    if (this._skipHint) {
      this._skipHint.classList.toggle('hidden', !show);
    }
  }

  showTutorialChoice() {
    if (this._tutorialChoice) this._tutorialChoice.classList.remove('hidden');
  }

  hideTutorialChoice() {
    if (this._tutorialChoice) this._tutorialChoice.classList.add('hidden');
  }

  // Tutorial step prompt (Oct 14, 2026)
  showTutorialPrompt(text) {
    if (!this._tutorialPrompt) {
      this._tutorialPrompt = document.createElement('div');
      this._tutorialPrompt.className = 'tutorial-prompt hidden';
      this.root.appendChild(this._tutorialPrompt);
      this._tutorialSkipBtn = document.createElement('button');
      this._tutorialSkipBtn.type = 'button';
      this._tutorialSkipBtn.className = 'tutorial-skip hidden';
      this._tutorialSkipBtn.textContent = 'SKIP TUTORIAL';
      this._tutorialSkipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try { this.game.skipTutorial?.(); } catch {}
      });
      this.root.appendChild(this._tutorialSkipBtn);
    }
    this._tutorialPrompt.textContent = text;
    this._tutorialPrompt.classList.remove('hidden');
    this._tutorialSkipBtn.classList.remove('hidden');
  }

  hideTutorialPrompt() {
    if (this._tutorialPrompt) this._tutorialPrompt.classList.add('hidden');
    if (this._tutorialSkipBtn) this._tutorialSkipBtn.classList.add('hidden');
  }

  show(name, data) {
    this.current = name;
    if (name !== 'hud') {
      this.subtitles.stop();
      this._setSkipHint(false);
    }
    this.particles.setScreen(name);
    for (const [n, el] of this.screenMap) {
      el.classList.toggle('hidden', n !== name);
    }

    // Dynamic screens re-render on every show.
    if (name === 'gameover') this.menus.renderGameOver(data || {});
    else if (name === 'settings') this.menus.renderSettings();
    else if (name === 'missions') this.menus.renderMissions();
    else if (name === 'goals') this.menus.renderGoals();
    else if (name === 'inventory') this.menus.renderInventory();
    else if (name === 'wardrobe') this.menus.renderWardrobe();
    else if (name === 'tap') this.menus.renderTap?.();
    else if (name === 'wallet') this.walletUI.render();

    // HUD stays visible during run states and over the pause overlay.
    this.hud.setVisible(name === 'hud' || name === 'pause');

    // Apply saved reduced-motion preference to the UI root.
    try {
      const rm = this.game.save?.load?.()?.settings?.reducedMotion;
      if (rm !== undefined) this.root.classList.toggle('reduced-motion', !!rm);
    } catch { /* noop */ }
  }

  hideAll() {
    this.current = null;
    this.particles.setScreen(null);
    for (const el of this.screenMap.values()) el.classList.add('hidden');
    this.hud.setVisible(false);
  }

  setLoadingProgress(pct, text) {
    this.menus.setLoadingProgress(pct, text);
  }
}
