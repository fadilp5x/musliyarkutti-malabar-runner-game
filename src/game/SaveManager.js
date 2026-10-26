// SaveManager — PURE module (no three, no DOM).
// Persists progress under mmr.* keys. Accepts any storage-like object
// ({getItem,setItem,removeItem}) so tests can inject a fake. Never throws.

const KEYS = {
  highscore: 'mmr.highscore',
  bestDistance: 'mmr.bestDistance',
  coins: 'mmr.coins',
  settings: 'mmr.settings',
  vouchers: 'mmr.vouchers',
  wallet: 'mmr.wallet',
  missions: 'mmr.missions',
  inventory: 'mmr.inventory',
  hasSeenIntro: 'mmr.hasSeenIntro',
  tutorialPreference: 'mmr.tutorialPreference',
};

const VOLUME_DEFAULTS = {
  volumeMusic: 0.8,
  volumeAmbience: 0.7,
  volumeEffects: 0.9,
  volumeShaytan: 0.8,
};

function clampVolume(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.max(0, Math.min(1, v))
    : fallback;
}

function normalizeSettings(v) {
  const shaytan = v.shaytan === 'reaper' || v.shaytan === 'shaythaan' ? v.shaytan : 'classic';
  return {
    sound: v.sound !== false,
    reducedMotion: v.reducedMotion === true,
    quality: v.quality === 'low' ? 'low' : 'high',
    shaytan,
    volumeMusic: clampVolume(v.volumeMusic, VOLUME_DEFAULTS.volumeMusic),
    volumeAmbience: clampVolume(v.volumeAmbience, VOLUME_DEFAULTS.volumeAmbience),
    volumeEffects: clampVolume(v.volumeEffects, VOLUME_DEFAULTS.volumeEffects),
    volumeShaytan: clampVolume(v.volumeShaytan, VOLUME_DEFAULTS.volumeShaytan),
  };
}

function defaults() {
  return {
    highscore: 0,
    bestDistance: 0,
    coins: 0,
    settings: { sound: true, reducedMotion: false, quality: 'high', ...VOLUME_DEFAULTS },
    vouchers: { lastSpawnM: -1e9 },
    wallet: [],
    missions: {},
    inventory: { owned: ['palm'], selected: 'palm' },
  };
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validSettings(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if ('sound' in v && typeof v.sound !== 'boolean') return false;
  if ('reducedMotion' in v && typeof v.reducedMotion !== 'boolean') return false;
  if ('quality' in v && v.quality !== 'high' && v.quality !== 'low') return false;
  for (const k of Object.keys(VOLUME_DEFAULTS)) {
    if (k in v && (typeof v[k] !== 'number' || !Number.isFinite(v[k]) || v[k] < 0 || v[k] > 1)) return false;
  }
  return true;
}

export class SaveManager {
  constructor(storage = globalThis.localStorage) {
    // NOTE: tests inject a fake storage; never reference localStorage directly.
    this.storage = storage;
  }

  _read(key) {
    if (!this.storage) return undefined;
    try {
      const raw = this.storage.getItem(key);
      if (raw === null || raw === undefined) return undefined;
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  _write(key, value) {
    if (!this.storage) return;
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch {
      // storage full / unavailable — stay silent, never throw
    }
  }

  load() {
    try {
      const d = defaults();

      const highscore = this._read(KEYS.highscore);
      if (isNum(highscore) && highscore >= 0) d.highscore = Math.floor(highscore);

      const bestDistance = this._read(KEYS.bestDistance);
      if (isNum(bestDistance) && bestDistance >= 0) d.bestDistance = Math.floor(bestDistance);

      const coins = this._read(KEYS.coins);
      if (isNum(coins) && coins >= 0) d.coins = Math.floor(coins);

      const settings = this._read(KEYS.settings);
      if (validSettings(settings)) {
        d.settings = normalizeSettings(settings);
      }

      const vouchers = this._read(KEYS.vouchers);
      if (vouchers && typeof vouchers === 'object' && isNum(vouchers.lastSpawnM)) {
        d.vouchers = { lastSpawnM: vouchers.lastSpawnM };
      }

      const wallet = this._read(KEYS.wallet);
      if (Array.isArray(wallet)) d.wallet = wallet;

      const missions = this._read(KEYS.missions);
      if (missions && typeof missions === 'object' && !Array.isArray(missions)) d.missions = missions;

      const inventory = this._read(KEYS.inventory);
      if (inventory && typeof inventory === 'object' && !Array.isArray(inventory)) {
        const owned = Array.isArray(inventory.owned) && inventory.owned.length > 0
          ? inventory.owned.filter((x) => typeof x === 'string')
          : ['palm'];
        const selected = typeof inventory.selected === 'string' && owned.includes(inventory.selected)
          ? inventory.selected
          : owned[0];
        d.inventory = { owned, selected };
      }

      // Oct 14, 2026: cinematic/tutorial flags
      const hasSeenIntro = this._read(KEYS.hasSeenIntro);
      if (typeof hasSeenIntro === 'boolean') d.hasSeenIntro = hasSeenIntro;

      const tutorialPreference = this._read(KEYS.tutorialPreference);
      if (tutorialPreference === 'with' || tutorialPreference === 'without') {
        d.tutorialPreference = tutorialPreference;
      }

      return d;
    } catch {
      return defaults();
    }
  }

  save(patch) {
    try {
      if (!patch || typeof patch !== 'object') return;
      const cur = this.load();
      if ('highscore' in patch && isNum(patch.highscore) && patch.highscore >= 0) {
        this._write(KEYS.highscore, Math.floor(patch.highscore));
      }
      if ('bestDistance' in patch && isNum(patch.bestDistance) && patch.bestDistance >= 0) {
        this._write(KEYS.bestDistance, Math.floor(patch.bestDistance));
      }
      if ('coins' in patch && isNum(patch.coins) && patch.coins >= 0) {
        this._write(KEYS.coins, Math.floor(patch.coins));
      }
      if ('settings' in patch && validSettings(patch.settings)) {
        // Merge over the stored settings so a partial patch (e.g. only
        // {sound, reducedMotion, quality}) never wipes the volume keys.
        const stored = this._read(KEYS.settings);
        const base = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
        this._write(KEYS.settings, normalizeSettings({ ...base, ...patch.settings }));
      }
      if ('vouchers' in patch && patch.vouchers && typeof patch.vouchers === 'object') {
        this._write(KEYS.vouchers, { lastSpawnM: isNum(patch.vouchers.lastSpawnM) ? patch.vouchers.lastSpawnM : cur.vouchers.lastSpawnM });
      }
      if ('wallet' in patch && Array.isArray(patch.wallet)) this._write(KEYS.wallet, patch.wallet);
      if ('missions' in patch && patch.missions && typeof patch.missions === 'object' && !Array.isArray(patch.missions)) {
        this._write(KEYS.missions, patch.missions);
      }
      if ('inventory' in patch && patch.inventory && typeof patch.inventory === 'object' && !Array.isArray(patch.inventory)) {
        this._write(KEYS.inventory, patch.inventory);
      }
      // Oct 14, 2026: cinematic/tutorial flags
      if ('hasSeenIntro' in patch) {
        this._write(KEYS.hasSeenIntro, !!patch.hasSeenIntro);
      }
      if ('tutorialPreference' in patch && (patch.tutorialPreference === 'with' || patch.tutorialPreference === 'without')) {
        this._write(KEYS.tutorialPreference, patch.tutorialPreference);
      }
    } catch {
      // never throw
    }
  }

  reset() {
    try {
      if (!this.storage) return;
      for (const key of Object.values(KEYS)) {
        try {
          this.storage.removeItem(key);
        } catch {
          // ignore per-key failures
        }
      }
    } catch {
      // never throw
    }
  }
}
