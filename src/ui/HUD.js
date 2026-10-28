// HUD.js — in-run heads-up display. DOM only, no three.js.
// Cheap per-frame updates: textContent is only written when the value changed.

const POWERUP_LABELS = {
  jetpack: 'Jetpack',
  magnet: 'Magnet',
  multiplier: 'x2 Score',
  shield: 'Shield',
  glideboard: 'Glide',
  headstart: 'Headstart',
  superheadstart: 'Super Headstart',
};

const POWERUP_MAX = {
  jetpack: 8,
  magnet: 10,
  multiplier: 12,
  shield: 15,
  glideboard: 30,
  headstart: 1,
  superheadstart: 1,
};

export class HUD {
  constructor(game, parent) {
    this.game = game;

    this.root = document.createElement('div');
    this.root.id = 'mmr-hud';
    this.root.classList.add('hidden');

    const bar = document.createElement('div');
    bar.className = 'hud-topbar';

    this.scoreEl = this._stat(bar, 'Score', '0');
    this.distEl = this._stat(bar, 'Dist', '0 m');
    this.coinsEl = this._stat(bar, 'Coins', '0');
    this.coinsEl.parentElement.classList.add('coins');

    this.multEl = document.createElement('div');
    this.multEl.className = 'hud-mult';
    this.multEl.textContent = 'x2';
    bar.appendChild(this.multEl);

    this.comboEl = document.createElement('div');
    this.comboEl.className = 'hud-combo hidden';
    this.comboEl.setAttribute('aria-live', 'polite');
    bar.appendChild(this.comboEl);

    const btns = document.createElement('div');
    btns.className = 'hud-btns';

    this.walletBtn = document.createElement('button');
    this.walletBtn.className = 'hud-btn';
    this.walletBtn.type = 'button';
    this.walletBtn.setAttribute('aria-label', 'Open voucher wallet');
    this.walletBtn.textContent = '\u{1F39F}\uFE0E';
    this.walletBtn.title = 'Voucher wallet';
    this.walletBadge = document.createElement('span');
    this.walletBadge.className = 'badge';
    this.walletBadge.textContent = '0';
    this.walletBadge.style.display = 'none';
    this.walletBtn.appendChild(this.walletBadge);
    btns.appendChild(this.walletBtn);

    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'hud-btn';
    pauseBtn.type = 'button';
    pauseBtn.setAttribute('aria-label', 'Pause game');
    pauseBtn.textContent = '\u23F8\uFE0E';
    pauseBtn.title = 'Pause';
    btns.appendChild(pauseBtn);

    bar.appendChild(btns);
    this.root.appendChild(bar);

    this.chipsEl = document.createElement('div');
    this.chipsEl.className = 'hud-powerups';
    this.root.appendChild(this.chipsEl);

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'hud-hint';
    this.hintEl.textContent = 'Vouchers unlock at 500 m';
    this.root.appendChild(this.hintEl);

    parent.appendChild(this.root);

    // Cached last values — update() only touches the DOM on change.
    this._score = undefined;
    this._dist = undefined;
    this._coins = undefined;
    this._mult = undefined;
    this._chipKey = null;
    this._chips = new Map();
    this._badgeCount = undefined;
    this._hintVisible = undefined;
    this._coinAnimationId = 0;
    this._floatCursor = 0;
    this._floaters = Array.from({ length: 6 }, () => {
      const el = document.createElement('span');
      el.className = 'hud-float hidden';
      el.setAttribute('aria-hidden', 'true');
      this.root.appendChild(el);
      return el;
    });

    pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.audio?.play?.('click');
      try { this.game.togglePause?.(); } catch { /* engine not ready */ }
    });

    this.walletBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.audio?.play?.('click');
      try { this.game.ui?.show?.('wallet'); } catch { /* engine not ready */ }
    });
  }

  _stat(bar, label, initial) {
    const cell = document.createElement('div');
    cell.className = 'hud-stat';
    const l = document.createElement('span');
    l.className = 'label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'value';
    v.textContent = initial;
    let coin = null;
    if (label === 'Coins') {
      coin = document.createElement('span');
      coin.className = 'coin-icon';
      coin.setAttribute('aria-hidden', 'true');
      coin.textContent = '\u0639';
      v.classList.add('coin-counter');
    }
    cell.appendChild(l);
    if (coin) cell.appendChild(coin);
    cell.appendChild(v);
    bar.appendChild(cell);
    return v;
  }

  setVisible(v) {
    this.root.classList.toggle('hidden', !v);
  }

  resetCache() {
    this._score = undefined;
    this._dist = undefined;
    this._coins = undefined;
    this._mult = undefined;
    this._chipKey = null;
    this._chips.clear();
    this.chipsEl.innerHTML = '';
    this._badgeCount = undefined;
    this._hintVisible = undefined;
  }

  // snap: { score, coins, distanceM, multiplier, activePowerups, voucherCount, canSpawn }
  // Any missing field falls back to reading this.game defensively.
  update(snap = {}) {
    const g = this.game;
    const scoring = g.scoring || {};

    const score = snap.score ?? scoring.score ?? 0;
    const coins = snap.coins ?? scoring.coins ?? 0;
    const dist = snap.distanceM ?? scoring.distanceM ?? 0;
    const mult = snap.multiplier ?? scoring.multiplier ?? 1;
    const comboStreak = Math.max(0, Math.floor(snap.comboStreak ?? 0));
    const comboMultiplier = Number(snap.comboMultiplier) || 1;

    const sInt = Math.floor(score);
    if (sInt !== this._score) {
      this._score = sInt;
      this.scoreEl.textContent = String(sInt);
    }
    const dInt = Math.floor(dist);
    if (dInt !== this._dist) {
      this._dist = dInt;
      this.distEl.textContent = dInt + ' m';
    }
    if (coins !== this._coins) {
      const previousCoins = Number(this._coins);
      this._coins = coins;
      if (Number.isFinite(previousCoins) && Number(coins) > previousCoins) {
        this._animateCoinCounter(previousCoins, Number(coins));
      } else {
        this.coinsEl.textContent = String(coins);
      }
      this.coinsEl.classList.remove('coin-tick');
      void this.coinsEl.offsetWidth;
      this.coinsEl.classList.add('coin-tick');
    }

    const multOn = mult > 1;
    if (multOn !== this._mult) {
      this._mult = multOn;
      this.multEl.classList.toggle('on', multOn);
      if (multOn) this.multEl.textContent = 'x' + mult;
    }
    this.comboEl.classList.toggle('hidden', comboStreak === 0);
    const comboText = `NEAR MISS ×${comboMultiplier.toFixed(2)} · ${comboStreak}`;
    if (this.comboEl.textContent !== comboText) this.comboEl.textContent = comboText;

    // Power-up chips
    const active = snap.activePowerups ?? g.powerups?.active ?? {};
    const types = Object.keys(active).filter((t) => (active[t] ?? 0) > 0).sort();
    const key = types.join(',');
    if (key !== this._chipKey) {
      this._chipKey = key;
      this.chipsEl.innerHTML = '';
      this._chips.clear();
      for (const t of types) {
        const chip = document.createElement('div');
        chip.className = 'pchip';
        const nm = document.createElement('div');
        nm.className = 'pname';
        const label = document.createElement('span');
        label.textContent = POWERUP_LABELS[t] || t;
        const timer = document.createElement('span');
        timer.className = 't';
        nm.appendChild(label);
        nm.appendChild(timer);
        const bar = document.createElement('div');
        bar.className = 'bar';
        const fill = document.createElement('i');
        bar.appendChild(fill);
        chip.appendChild(nm);
        chip.appendChild(bar);
        this.chipsEl.appendChild(chip);
        this._chips.set(t, { fill, timer });
      }
    }
    for (const t of types) {
      const chip = this._chips.get(t);
      if (!chip) continue;
      const max = POWERUP_MAX[t] || 10;
      const pct = Math.max(0, Math.min(100, (active[t] / max) * 100));
      const w = pct.toFixed(1) + '%';
      if (chip.fill.style.width !== w) chip.fill.style.width = w;
      const secs = Math.ceil(active[t]);
      const txt = secs > 0 ? secs + 's' : '';
      if (chip.timer.textContent !== txt) chip.timer.textContent = txt;
    }

    // Wallet voucher badge
    let count = snap.voucherCount;
    if (count === undefined) {
      try { count = g.wallet?.list?.().length ?? 0; } catch { count = 0; }
    }
    if (count !== this._badgeCount) {
      const prev = this._badgeCount ?? 0;
      this._badgeCount = count;
      this.walletBadge.textContent = String(count);
      this.walletBadge.style.display = count > 0 ? '' : 'none';
      // Pop the badge when a new voucher lands — immediate, visible feedback.
      if (count > prev && count > 0) {
        this.walletBadge.classList.remove('pop');
        void this.walletBadge.offsetWidth; // restart the animation
        this.walletBadge.classList.add('pop');
      }
    }

    // "Vouchers unlock at 500 m" hint until vouchers can spawn
    let canSpawn = snap.canSpawn;
    if (canSpawn === undefined) {
      try { canSpawn = g.vouchers?.canSpawn?.(dInt) ?? false; } catch { canSpawn = false; }
    }
    const showHint = !canSpawn;
    if (showHint !== this._hintVisible) {
      this._hintVisible = showHint;
      this.hintEl.classList.toggle('hidden', !showHint);
    }
  }

  _animateCoinCounter(from, to) {
    const animationId = ++this._coinAnimationId;
    const start = performance.now();
    const duration = 200;
    const tick = (now) => {
      if (animationId !== this._coinAnimationId) return;
      const p = Math.min(1, (now - start) / duration);
      this.coinsEl.textContent = String(Math.floor(from + (to - from) * p));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  showFloatingText(text, kind = 'coin') {
    const el = this._floaters[this._floatCursor];
    this._floatCursor = (this._floatCursor + 1) % this._floaters.length;
    el.textContent = text;
    el.className = `hud-float hud-float-${kind}`;
    el.classList.remove('hidden');
    void el.offsetWidth;
    el.classList.add('is-rising');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.add('hidden'), 720);
  }
}
