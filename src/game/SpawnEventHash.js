// Compact rolling hash for deterministic spawn diagnostics.
export class SpawnEventHash {
  constructor() { this.reset(null, null); }

  reset(seed, round) {
    this.seed = seed ?? null;
    this.round = round ?? null;
    this.hash = 0x811c9dc5;
    this.count = 0;
  }

  record({ kind, type, lane, distanceM }) {
    const distance = Math.round(Number(distanceM) * 10) / 10;
    const event = JSON.stringify([kind, type, lane, distance]);
    for (let i = 0; i < event.length; i++) {
      this.hash ^= event.charCodeAt(i);
      this.hash = Math.imul(this.hash, 0x01000193) >>> 0;
    }
    this.count++;
    return this.hash.toString(16).padStart(8, '0');
  }

  value() { return this.hash.toString(16).padStart(8, '0'); }
}
