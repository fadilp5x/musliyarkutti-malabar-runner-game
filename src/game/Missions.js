// Missions.js — PURE (no three, no DOM).
// Four missions. progress/done are keyed by mission id.
// update(stats): stats = { distanceM, coins, nearMisses, vouchers }.
//   - run500 uses per-run BEST distance (stats.distanceM = current run distance)
//   - coins100 / near10 / voucher1 accumulate LIFETIME totals
//     (stats.coins etc. are deltas since the last update call).

export const MISSION_DEFS = [
  { id: 'run500', name: 'Run 500 m in one run', target: 500, reward: 50 },
  { id: 'coins100', name: 'Collect 100 coins (total)', target: 100, reward: 80 },
  { id: 'near10', name: '10 near misses (total)', target: 10, reward: 100 },
  { id: 'voucher1', name: 'Collect a voucher card', target: 1, reward: 150 },
];

function blankProgress() {
  const p = {};
  for (const d of MISSION_DEFS) p[d.id] = 0;
  return p;
}

export class Missions {
  constructor() {
    this.defs = MISSION_DEFS;
    this.progress = blankProgress();
    this.done = {};    // id -> true when target reached
    this.claimed = {}; // id -> true once the reward was claimed
  }

  update(stats = {}) {
    if (typeof stats.distanceM === 'number' && stats.distanceM > 0) {
      // per-run best: keep the max single-run distance seen
      this.progress.run500 = Math.max(this.progress.run500, stats.distanceM);
    }
    if (typeof stats.coins === 'number' && stats.coins > 0) {
      this.progress.coins100 += stats.coins;
    }
    if (typeof stats.nearMisses === 'number' && stats.nearMisses > 0) {
      this.progress.near10 += stats.nearMisses;
    }
    if (typeof stats.vouchers === 'number' && stats.vouchers > 0) {
      this.progress.voucher1 += stats.vouchers;
    }
    for (const d of this.defs) {
      if (this.progress[d.id] >= d.target) this.done[d.id] = true;
    }
  }

  isDone(id) {
    const d = this.defs.find((x) => x.id === id);
    if (!d) return false;
    return (this.progress[id] || 0) >= d.target;
  }

  /**
   * Claim a completed mission's coin reward. Returns the reward coins,
   * or 0 when the mission is unknown, incomplete, or already claimed.
   */
  claim(id) {
    const d = this.defs.find((x) => x.id === id);
    if (!d) return 0;
    if (this.claimed[id]) return 0;
    if (!this.isDone(id)) return 0;
    this.claimed[id] = true;
    return d.reward;
  }

  serialize() {
    return {
      progress: { ...this.progress },
      done: { ...this.done },
      claimed: { ...this.claimed },
    };
  }

  /** Validated load: corrupt data -> fresh missions, never throws. */
  load(data) {
    this.progress = blankProgress();
    this.done = {};
    this.claimed = {};
    if (!data || typeof data !== 'object') return;
    if (data.progress && typeof data.progress === 'object') {
      for (const d of this.defs) {
        const v = data.progress[d.id];
        if (typeof v === 'number' && v >= 0 && Number.isFinite(v)) {
          this.progress[d.id] = v;
        }
      }
    }
    for (const d of this.defs) {
      if (this.progress[d.id] >= d.target) this.done[d.id] = true;
    }
    if (data.claimed && typeof data.claimed === 'object') {
      for (const d of this.defs) {
        if (data.claimed[d.id] === true && this.done[d.id]) this.claimed[d.id] = true;
      }
    }
  }

  reset() {
    this.progress = blankProgress();
    this.done = {};
    this.claimed = {};
  }
}
