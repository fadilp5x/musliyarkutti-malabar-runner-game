// Distance-independent, fixed-step near-miss streak state.
export class NearMissCombo {
  constructor(windowSeconds = 4) {
    this.windowSeconds = windowSeconds;
    this.reset();
  }

  record(runTimeSeconds) {
    const now = Math.max(0, Number(runTimeSeconds) || 0);
    if (this.lastAt === null || now - this.lastAt > this.windowSeconds) this.streak = 0;
    this.streak += 1;
    this.lastAt = now;
    this.multiplier = Math.min(2, 1 + Math.max(0, this.streak - 1) * 0.25);
    return this.multiplier;
  }

  update(runTimeSeconds) {
    if (this.lastAt !== null && runTimeSeconds - this.lastAt > this.windowSeconds) this.reset();
    return this.multiplier;
  }

  reset() {
    this.streak = 0;
    this.lastAt = null;
    this.multiplier = 1;
  }
}

export function effectiveScoreMultiplier(comboMultiplier, x2PowerupActive) {
  return Math.min(3, Math.max(1, Number(comboMultiplier) || 1) * (x2PowerupActive ? 2 : 1));
}

export default NearMissCombo;
