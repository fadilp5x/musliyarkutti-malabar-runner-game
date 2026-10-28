// Small, deterministic random streams for synchronized party race spawns.

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function hashString(value) {
  let hash = 0x811C9DC5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const STREAM_NAMES = ['obstacles', 'coins', 'powerups', 'vouchers', 'shaytan'];

export function makeStreams(seed, round) {
  const prefix = `${seed}:${round}:`;
  return Object.fromEntries(
    STREAM_NAMES.map((name) => [name, mulberry32(hashString(`${prefix}${name}`))])
  );
}
