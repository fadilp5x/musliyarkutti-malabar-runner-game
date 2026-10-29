const GLYPHS = ['ع', 'م', 'ن', 'ل', 'ر', 'ب'];

/** Small canvas decoration for the loading and title screens only. */
export class ParticleLayer {
  constructor(game, parent) {
    this.game = game;
    this.parent = parent;
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.burstParticles = [];
    this.active = false;
    this.frame = 0;
    this.lastTime = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this._userReduced = Boolean(game?.save?.load?.()?.settings?.reducedMotion);
    this._prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
    this._reduced = this._userReduced || this._prefersReduced;
    this._resize = () => this.resize();
    this._visibility = () => this._syncFrame();
    this._motion = (event) => {
      this._prefersReduced = event.matches;
      this._reduced = this._userReduced || this._prefersReduced;
      if (this._reduced) this._removeCanvas();
      else if (this.active) this._ensureCanvas();
    };
    window.addEventListener('resize', this._resize, { passive: true });
    document.addEventListener('visibilitychange', this._visibility);
    this.motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.motionQuery?.addEventListener?.('change', this._motion);
    this.setScreen('loading');
  }

  setScreen(screen) {
    this.active = screen === 'loading' || screen === 'tap';
    this.screenElement = this.active ? document.getElementById(`screen-${screen}`) : null;
    if (!this.active || this._reduced) this._removeCanvas();
    else this._ensureCanvas();
  }

  qualityChanged() {
    if (this.active && this.canvas && !this._reduced) this.resize();
  }

  burst(count = 10) {
    if (!this.active || !this.canvas || this._reduced || document.hidden) return;
    const cx = this.width / 2;
    const cy = this.height * 0.48;
    this.burstParticles = Array.from({ length: Math.max(0, Math.min(16, count)) }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 45 + Math.random() * 70;
      return { x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.45 + Math.random() * 0.3, maxLife: 0.75, size: 2 + Math.random() * 3 };
    });
  }

  setReducedMotion(enabled) {
    this._userReduced = Boolean(enabled);
    this._reduced = this._userReduced || this._prefersReduced;
    if (this._reduced) this._removeCanvas();
    else if (this.active) this._ensureCanvas();
  }

  _ensureCanvas() {
    if (!this.active || this._reduced) return;
    const host = this.screenElement || this.parent;
    if (this.canvas) {
      if (this.canvas.parentElement !== host) host.insertBefore(this.canvas, host.firstChild);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.className = 'particle-layer';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.pointerEvents = 'none';
    host.insertBefore(canvas, host.firstChild);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.resize();
    const count = this._count();
    this.particles = Array.from({ length: count }, (_, index) => this._newParticle(index, count, true));
    this._syncFrame();
  }

  _removeCanvas() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.burstParticles = [];
  }

  _count() {
    const low = this.game?._quality === 'low' || this.game?.quality === 'low';
    return window.innerWidth <= 640 || low ? 12 : 30;
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const count = this._count();
    if (this.particles.length !== count) {
      this.particles = Array.from({ length: count }, (_, index) => this._newParticle(index, count, true));
    }
  }

  _newParticle(index, count, spread = false) {
    const type = ['coin', 'leaf', 'sparkle'][index % 3];
    return {
      type,
      x: Math.random() * (this.width || window.innerWidth),
      y: spread ? Math.random() * (this.height || window.innerHeight) : (this.height || window.innerHeight) + 18,
      sway: Math.random() * Math.PI * 2,
      drift: (Math.random() - 0.5) * 0.28,
      rise: 9 + Math.random() * 17,
      size: type === 'coin' ? 10 + Math.random() * 7 : 3 + Math.random() * 5,
      glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
      alpha: 0.4 + Math.random() * 0.45,
    };
  }

  _syncFrame() {
    if (!this.canvas || document.hidden || this._reduced) {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      return;
    }
    if (!this.frame) this.frame = requestAnimationFrame((time) => this._draw(time));
  }

  _draw(time) {
    this.frame = 0;
    if (!this.active || !this.canvas || !this.ctx || document.hidden || this._reduced) return;
    const drawStart = performance.now();
    const dt = Math.min(0.05, this.lastTime ? (time - this.lastTime) / 1000 : 1 / 60);
    this.lastTime = time;
    const style = getComputedStyle(this.parent);
    const gold = style.getPropertyValue('--color-gold-400').trim();
    const goldDark = style.getPropertyValue('--color-gold-600').trim();
    const ink = style.getPropertyValue('--color-ink').trim();
    const green = style.getPropertyValue('--color-green-500').trim();
    const white = style.getPropertyValue('--color-white').trim();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.y -= p.rise * dt;
      p.x += (Math.sin(time * 0.0007 + p.sway) * 7 + p.drift * 18) * dt;
      if (p.y < -24) this.particles[i] = this._newParticle(i, this.particles.length);
      else this._paint(ctx, p, time, { gold, goldDark, ink, green, white });
    }
    this.burstParticles = this.burstParticles.filter((p) => p.life > 0);
    for (const p of this.burstParticles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.size > 4 ? gold : white;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.drawTimeMs = performance.now() - drawStart;
    window.__mmrParticleDrawMs = this.drawTimeMs;
    this.frame = requestAnimationFrame((nextTime) => this._draw(nextTime));
  }

  _paint(ctx, p, time, colors) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y);
    if (p.type === 'coin') {
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fillStyle = colors.gold;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = colors.goldDark;
      ctx.stroke();
      ctx.fillStyle = colors.ink;
      ctx.font = `700 ${Math.max(10, p.size * 1.15)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.glyph, 0, 1);
    } else if (p.type === 'leaf') {
      ctx.rotate(Math.sin(time * 0.001 + p.sway) * 0.35);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size * 1.5, p.size * 0.65, 0, 0, Math.PI * 2);
      ctx.fillStyle = colors.green;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-p.size, 0);
      ctx.lineTo(p.size, 0);
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      const pulse = 0.65 + (Math.sin(time * 0.003 + p.sway) + 1) * 0.2;
      ctx.globalAlpha *= pulse;
      ctx.strokeStyle = colors.white;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-p.size, 0); ctx.lineTo(p.size, 0);
      ctx.moveTo(0, -p.size); ctx.lineTo(0, p.size);
      ctx.stroke();
    }
    ctx.restore();
  }

  dispose() {
    this._removeCanvas();
    window.removeEventListener('resize', this._resize);
    document.removeEventListener('visibilitychange', this._visibility);
    this.motionQuery?.removeEventListener?.('change', this._motion);
  }
}
