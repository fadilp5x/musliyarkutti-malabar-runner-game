// VoucherManager.js — PURE (no three, no DOM). Unit-tested in node.
// Decides WHEN voucher cards may spawn. THE rule lives here:
// vouchers never spawn below 500 m. CollectibleManager / engine must call
// canSpawn / shouldSpawn and never spawn vouchers below 500 m.

// Unlock distance (metres).
export const VOUCHER_UNLOCK_M = 500;

// Stores that may issue vouchers. NOTE: never vouchers for the masjid,
// the bus stop, or the academy.
export const VOUCHER_STORES = [
  'Juicify Kuttikkattur',
  'Turkish Corner',
  'Hey Laban Store',
  'Family Collections',
  'Edumart',
  'MyG Store',
];

// Minimum metres between voucher spawns.
export const VOUCHER_MIN_INTERVAL_M = 120;
// Roll at fixed distance checkpoints so probability is independent of tick rate.
export const VOUCHER_CHECK_INTERVAL_M = 25;

// Spawn probability per eligible check.
export const VOUCHER_SPAWN_CHANCE = 0.45;

export class VoucherManager {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.lastSpawnM = -1e9;
    this.nextCheckM = VOUCHER_UNLOCK_M;
  }

  /** THE rule: vouchers unlock at >= 500 m. */
  canSpawn(distanceM) {
    return distanceM >= VOUCHER_UNLOCK_M;
  }

  /**
   * Eligible to spawn right now? Deterministic given the injected rng:
   * checks run in fixed order (unlock -> interval -> chance) and rng() is
   * called at most once per call, only when the first two checks pass.
   */
  shouldSpawn(distanceM) {
    if (!this.canSpawn(distanceM)) return false;
    if (distanceM - this.lastSpawnM < VOUCHER_MIN_INTERVAL_M) return false;
    while (this.nextCheckM <= distanceM) {
      this.nextCheckM += VOUCHER_CHECK_INTERVAL_M;
      if (this.rng() < VOUCHER_SPAWN_CHANCE) return true;
    }
    return false;
  }

  /** Record that a voucher spawned at distanceM (starts the 120 m cooldown). */
  recordSpawn(distanceM) {
    this.lastSpawnM = distanceM;
    this.nextCheckM = distanceM + VOUCHER_MIN_INTERVAL_M;
  }

  reset() {
    this.lastSpawnM = -1e9;
    this.nextCheckM = VOUCHER_UNLOCK_M;
  }
}
