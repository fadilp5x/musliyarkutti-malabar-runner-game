// ScoringSystem.js — PURE (no three, no DOM). Unit-tested in node.
// Owns run score, coins, distance, near-misses and the score multiplier.

export class ScoringSystem {
  constructor() {
    this.score = 0;
    this.coins = 0;
    this.distanceM = 0;
    this.best = 0;
    this.nearMisses = 0;
    this.multiplier = 1; // x2 while the multiplier powerup is active
  }

  /** Distance travelled (metres, may be fractional). score += dm * 1 * multiplier */
  addDistance(dm) {
    if (dm <= 0) return;
    this.distanceM += dm;
    this.score += dm * 1 * this.multiplier;
  }

  /** Coins collected. coins += n; score += n * 10 * multiplier */
  addCoins(n) {
    if (n <= 0) return;
    this.coins += n;
    this.score += n * 10 * this.multiplier;
  }

  /** Near miss. nearMisses++; score += 25 * multiplier */
  addNearMiss() {
    this.nearMisses += 1;
    this.score += 25 * this.multiplier;
  }

  /** Flat bonus (portal, mission rewards, ...). score += pts * multiplier */
  addBonus(pts) {
    if (pts <= 0) return;
    this.score += pts * this.multiplier;
  }

  /** Zero run stats, keep best. */
  resetRun() {
    this.score = 0;
    this.coins = 0;
    this.distanceM = 0;
    this.nearMisses = 0;
    this.multiplier = 1;
  }

  /** best = max(best, score). Call at run end. */
  commitBest() {
    if (this.score > this.best) this.best = this.score;
  }
}
