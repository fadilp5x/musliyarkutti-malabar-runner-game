// AudioManager — 4-layer WebAudio mixer + file-backed SFX with procedural synth fallbacks.
// No deps, no network at runtime (assets are local).
//
// Layers (each with its own GainNode): music / ambience / effects / shaytan.
// Real assets, served from public/ at the site root (relative paths work in dist/ and file://):
//   audio/bg-music.mp3        — user-supplied background track; loops during RUNNER
//   audio/sfx/<name>.wav     — 20 named one-shot/loop files (see SFX_FILES)
// The procedural synth methods (_coin, _jump, …) are kept as FALLBACKS: when a
// file is missing or fails to decode, the mapped synth plays instead, so a
// missing file NEVER crashes or silences the game. Unknown names are silent
// no-ops (other workstreams rely on that for not-yet-wired hooks).
//
// Audio starts ONLY after a user gesture (pointerdown/keydown); assets preload
// lazily after that first gesture. Event wiring is opt-in via bindEvents():
//   audio.bindEvents(events) — 'sfx'→play, 'statechange'→loop routing,
//                              'audioDuck'→duck, 'footstep'→throttled steps.
// Call update(dt, flyY) once per frame from the game loop to run the jetpack
// thrust loop (or wire 'powerupStart'/'powerupEnd' style events manually).

const ASSET_BASE = 'audio/';

// All 20 real files. Key = the exact hook name other workstreams emit.
const SFX_FILES = {
  shaytan_distant_roar: 'shaytan_distant_roar.wav',
  shaytan_reveal_roar: 'shaytan_reveal_roar.wav',
  shaytan_chase_breath: 'shaytan_chase_breath.wav',
  shaytan_surge: 'shaytan_surge.wav',
  shaytan_retreat: 'shaytan_retreat.wav',
  library_ambience: 'library_ambience.wav',
  library_page_turn: 'library_page_turn.wav',
  library_escape_whoosh: 'library_escape_whoosh.wav',
  academy_gate_reveal: 'academy_gate_reveal.wav',
  footsteps_running: 'footsteps_running.wav',
  jump_whoosh: 'jump_whoosh.wav',
  landing_dust: 'landing_dust.wav',
  lane_change: 'lane_change.wav',
  coin_collect: 'coin_collect.wav',
  near_miss: 'near_miss.wav',
  pedestrian_collision: 'pedestrian_collision.wav',
  portal_collision: 'portal_collision.wav',
  powerup_activate: 'powerup_activate.wav',
  jetpack_thrust: 'jetpack_thrust.wav',
  game_over: 'game_over.wav',
};

// Layer routing for file-backed names. Anything unlisted goes to 'effects'.
const LAYER_FOR = {
  library_ambience: 'ambience',
  shaytan_distant_roar: 'shaytan',
  shaytan_reveal_roar: 'shaytan',
  shaytan_chase_breath: 'shaytan',
  shaytan_surge: 'shaytan',
  shaytan_retreat: 'shaytan',
};

// Legacy procedural names → the new file-backed hook. Anything not mapped
// here and not in SFX_FILES falls through to a pure synth (SYNTH_DIRECT).
const LEGACY_MAP = {
  coin: 'coin_collect',
  nearmiss: 'near_miss',
  gameover: 'game_over',
  powerup: 'powerup_activate',
  shaytan: 'shaytan_reveal_roar',
};

// Pure-synth names (no file equivalent — kept working forever).
const SYNTH_DIRECT = {
  jump: '_jump',
  slide: '_slide',
  hit: '_hit',
  voucher: '_voucher',
  click: '_click',
  start: '_start',
};

// File-backed name → procedural method used when the file is unavailable.
const SYNTH_FALLBACK = {
  coin_collect: '_coin',
  jump_whoosh: '_jump',
  landing_dust: '_dust',
  lane_change: '_blip',
  near_miss: '_nearmiss',
  pedestrian_collision: '_hit',
  portal_collision: '_portal',
  powerup_activate: '_powerup',
  footsteps_running: '_step',
  library_page_turn: '_page',
  library_escape_whoosh: '_whoosh',
  academy_gate_reveal: '_gate',
  jetpack_thrust: '_jet',
  game_over: '_gameover',
  shaytan_distant_roar: '_shaytan',
  shaytan_reveal_roar: '_shaytan',
  shaytan_chase_breath: '_breath',
  shaytan_surge: '_shaytan',
  shaytan_retreat: '_shaytan',
  // library_ambience intentionally has no one-shot fallback (it's a loop).
};

// Which layer each synth plays through (so volume sliders still apply).
const SYNTH_LAYER = {
  _shaytan: 'shaytan',
  _breath: 'shaytan',
};

export const DEFAULT_VOLUMES = {
  music: 0.8,
  ambience: 0.7,
  effects: 0.9,
  shaytan: 0.8,
};

const SETTING_KEYS = {
  volumeMusic: 'music',
  volumeAmbience: 'ambience',
  volumeEffects: 'effects',
  volumeShaytan: 'shaytan',
};

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export class AudioManager {
  constructor() {
    this.enabled = true;
    this._ctx = null;
    this._master = null;
    this._gains = null; // { music, ambience, effects, shaytan }
    this._vol = { ...DEFAULT_VOLUMES };
    this._duck = 1; // last audioDuck level (1 = no ducking)
    this._buffers = new Map(); // canon name -> AudioBuffer ('__music' for bg track)
    this._pending = new Set(); // canon names currently fetching
    this._failed = new Set(); // canon names that failed to load/decode
    this._preloading = false;
    this._loops = { music: null, ambience: null, jetpack: null };
    this._lastState = null;
    this._lastStep = 0; // footstep throttle

    this._unlock = () => {
      this._ensure();
      if (this._ctx && this._ctx.state === 'running') {
        this._preloadAll();
        this._maybeStartLoops();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this._unlock);
      window.addEventListener('keydown', this._unlock);
    }
  }

  // --- context & graph ------------------------------------------------------

  _ensure() {
    if (typeof window === 'undefined') return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!this._ctx) {
      try {
        this._ctx = new AC();
        this._master = this._ctx.createGain();
        this._master.gain.value = 1;
        this._master.connect(this._ctx.destination);
        this._gains = {};
        for (const layer of Object.keys(DEFAULT_VOLUMES)) {
          const g = this._ctx.createGain();
          const ducked = layer === 'music' || layer === 'ambience' ? this._duck : 1;
          g.gain.value = this._vol[layer] * ducked;
          g.connect(this._master);
          this._gains[layer] = g;
        }
      } catch {
        this._ctx = null;
        return false;
      }
    }
    if (this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }
    return this._ctx.state === 'running';
  }

  _ready() {
    if (!this._ctx) return false;
    if (this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
      return false;
    }
    return this._ctx.state === 'running';
  }

  setEnabled(b) {
    const next = b === true;
    if (next === this.enabled) return;
    this.enabled = next;
    if (!next) {
      this._stopAllLoops();
    } else if (this._lastState) {
      if (this._ensure()) this.onStateChange(this._lastState);
    }
  }

  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this._unlock);
      window.removeEventListener('keydown', this._unlock);
    }
    this._stopAllLoops();
    if (this._ctx) {
      this._ctx.close().catch(() => {});
      this._ctx = null;
      this._gains = null;
    }
    this._buffers.clear();
    this._pending.clear();
  }

  // --- volumes ---------------------------------------------------------------

  // Accepts SaveManager settings shape { volumeMusic, volumeAmbience,
  // volumeEffects, volumeShaytan } (partial ok). Applies immediately, no restart.
  setVolumes(v = {}) {
    if (!v || typeof v !== 'object') return;
    for (const [settingKey, layer] of Object.entries(SETTING_KEYS)) {
      const raw = v[settingKey];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        this._vol[layer] = clamp01(raw);
      }
    }
    this._applyVolumes();
  }

  setMusicVolume(v) { this.setVolumes({ volumeMusic: v }); }
  setAmbienceVolume(v) { this.setVolumes({ volumeAmbience: v }); }
  setEffectsVolume(v) { this.setVolumes({ volumeEffects: v }); }
  setShaytanVolume(v) { this.setVolumes({ volumeShaytan: v }); }

  getVolumes() {
    return {
      volumeMusic: this._vol.music,
      volumeAmbience: this._vol.ambience,
      volumeEffects: this._vol.effects,
      volumeShaytan: this._vol.shaytan,
    };
  }

  _applyVolumes() {
    if (!this._ctx || !this._gains) return;
    const t = this._ctx.currentTime;
    for (const layer of Object.keys(this._gains)) {
      const ducked = layer === 'music' || layer === 'ambience' ? this._duck : 1;
      try {
        this._gains[layer].gain.setTargetAtTime(this._vol[layer] * ducked, t, 0.05);
      } catch { /* never break the game */ }
    }
  }

  // --- event wiring -----------------------------------------------------------

  // Opt-in: route the shared event bus into the audio engine. Safe to call
  // multiple times only if events.on dedupes; call once from the integrator.
  bindEvents(events) {
    if (!events || typeof events.on !== 'function') return this;
    events.on('sfx', (name) => this.play(name));
    events.on('statechange', (s) => this.onStateChange(s));
    events.on('audioDuck', ({ level } = {}) => this.duck(level));
    events.on('footstep', () => this._footstep());
    return this;
  }

  // Game-state → loop routing. LIBRARY/SHAYTAN/CHASE: room ambience;
  // RUNNER: background music (user-supplied track); GAMEOVER: silence.
  onStateChange(s) {
    this._lastState = s;
    if (!this.enabled) return;
    try {
      switch (s) {
        case 'LIBRARY':
        case 'SHAYTAN':
        case 'CHASE':
          this._stopLoop('music');
          this._startLoop('ambience');
          break;
        case 'RUNNER':
          this._stopLoop('ambience');
          this._startLoop('music');
          break;
        case 'GAMEOVER':
          this._stopLoop('music');
          this._stopLoop('ambience');
          break;
        case 'PAUSED':
        case 'LOADING':
        default:
          break; // keep whatever is playing
      }
    } catch { /* never break the game */ }
  }

  // audioDuck({ level }) — smooth dip of music + ambience (effects/shaytan untouched).
  duck(level = 1) {
    const l = typeof level === 'number' && Number.isFinite(level) ? clamp01(level) : 1;
    this._duck = l;
    this._applyVolumes();
  }

  // Lightweight per-frame hook: call as audio.update(dt, player.flyY).
  // Starts the jetpack thrust loop while airborne (flyY > 2), stops it on landing.
  update(_dt, flyY = 0) {
    if (!this.enabled || !this._ready()) {
      if (this._loops.jetpack) this._stopLoop('jetpack');
      return;
    }
    try {
      if (flyY > 2) this._startLoop('jetpack');
      else if (this._loops.jetpack) this._stopLoop('jetpack');
    } catch { /* never break the game */ }
  }

  // --- playback ---------------------------------------------------------------

  // Accepts all 20 file-backed hook names + all legacy procedural names.
  // Unknown names are safe no-ops.
  play(name) {
    if (!this.enabled) return;
    const canon = LEGACY_MAP[name] || name;
    try {
      if (SFX_FILES[canon]) {
        this._playFile(canon);
        return;
      }
      const synth = SYNTH_DIRECT[canon];
      if (synth && this._ready()) this[synth]();
      // else: unknown name — silent no-op by design
    } catch {
      // audio must never break the game
    }
  }

  _playFile(canon) {
    if (!this._ready()) return;
    const buf = this._buffers.get(canon);
    if (buf) {
      const opts = {};
      if (canon === 'footsteps_running') opts.rate = 0.92 + Math.random() * 0.16;
      this._playBuffer(buf, LAYER_FOR[canon] || 'effects', opts);
      return;
    }
    // File not ready: fetch it lazily for next time, synth-fallback now so
    // the moment is never silent.
    this._loadFile(canon);
    const fb = SYNTH_FALLBACK[canon];
    if (fb && typeof this[fb] === 'function') this[fb]();
  }

  _playBuffer(buf, layer, { loop = false, rate = 1 } = {}) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    if (rate !== 1) src.playbackRate.value = rate;
    src.connect(this._gains[layer] || this._master);
    src.start();
    if (!loop) src.onended = () => { try { src.disconnect(); } catch { /* noop */ } };
    return src;
  }

  // --- loops -------------------------------------------------------------------

  _loopBuffer(kind) {
    if (kind === 'music') return this._buffers.get('__music');
    if (kind === 'ambience') return this._buffers.get('library_ambience');
    return this._buffers.get('jetpack_thrust'); // jetpack
  }

  _loopLayer(kind) {
    return kind === 'music' ? 'music' : kind === 'ambience' ? 'ambience' : 'effects';
  }

  _startLoop(kind) {
    if (!this.enabled || !this._ready()) return;
    if (this._loops[kind]) return;
    const buf = this._loopBuffer(kind);
    if (!buf) {
      if (kind === 'music') this._loadMusic();
      else this._loadFile(kind === 'ambience' ? 'library_ambience' : 'jetpack_thrust');
      return;
    }
    this._loops[kind] = this._playBuffer(buf, this._loopLayer(kind), { loop: true });
  }

  _stopLoop(kind) {
    const src = this._loops[kind];
    this._loops[kind] = null;
    if (src) {
      try { src.stop(); } catch { /* noop */ }
      try { src.disconnect(); } catch { /* noop */ }
    }
  }

  _stopAllLoops() {
    this._stopLoop('music');
    this._stopLoop('ambience');
    this._stopLoop('jetpack');
  }

  _maybeStartLoops() {
    if (this._lastState) this.onStateChange(this._lastState);
  }

  // --- asset loading (lazy, post-gesture) -----------------------------------------

  _preloadAll() {
    if (this._preloading || !this._ctx) return;
    this._preloading = true;
    for (const name of Object.keys(SFX_FILES)) this._loadFile(name);
    this._loadMusic();
  }

  _loadFile(name) {
    if (!this._ctx || this._buffers.has(name) || this._pending.has(name) || this._failed.has(name)) return;
    this._pending.add(name);
    const url = ASSET_BASE + 'sfx/' + SFX_FILES[name];
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then((ab) => {
        if (!this._ctx) throw new Error('no ctx');
        return Promise.resolve(this._ctx.decodeAudioData(ab));
      })
      .then((buf) => {
        this._pending.delete(name);
        if (!this._ctx) return;
        this._buffers.set(name, buf);
        this._maybeStartLoops();
      })
      .catch(() => {
        // Missing/undecodable file: remember, fall back to synth forever.
        this._pending.delete(name);
        this._failed.add(name);
      });
  }

  _loadMusic() {
    if (!this._ctx || this._buffers.has('__music') || this._pending.has('__music') || this._failed.has('__music')) return;
    this._pending.add('__music');
    fetch(ASSET_BASE + 'bg-music.mp3')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then((ab) => {
        if (!this._ctx) throw new Error('no ctx');
        return Promise.resolve(this._ctx.decodeAudioData(ab));
      })
      .then((buf) => {
        this._pending.delete('__music');
        if (!this._ctx) return;
        this._buffers.set('__music', buf);
        this._maybeStartLoops();
      })
      .catch(() => {
        this._pending.delete('__music');
        this._failed.add('__music');
      });
  }

  // Recitation (Oct 14, 2026): A'udhu billahi min ash-shaytan ir-rajim.
  // Supplied by fari as an MP3. Played once during the cinematic; the
  // buffer is cached after first load. Ducking is handled by the caller
  // via setVolumes / duckAll.
  async playRecitation() {
    if (!this._ctx) return false;
    const KEY = '__recitation';
    try {
      await this._ctx.resume();
      let buf = this._buffers.get(KEY);
      if (!buf && !this._failed.has(KEY)) {
        const r = await fetch(ASSET_BASE + 'audhu-billahi.mp3');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const ab = await r.arrayBuffer();
        buf = await this._ctx.decodeAudioData(ab);
        this._buffers.set(KEY, buf);
      }
      if (!buf) return false;
      const src = this._ctx.createBufferSource();
      src.buffer = buf;
      const g = this._ctx.createGain();
      g.gain.value = 1.0;
      src.connect(g);
      g.connect(this._master || this._ctx.destination);
      src.start();
      return true;
    } catch (e) {
      this._failed.add(KEY);
      return false;
    }
  }

  // Duck everything except the recitation (called during RECITATION state).
  // Levels are restored via setVolumes().
  duckForRecitation() {
    try {
      // Lower music and shaytan layers; keep master up for the recitation.
      if (this._musicGain) this._musicGain.gain.setTargetAtTime(0.15, this._ctx.currentTime, 0.3);
      if (this._layerGains && this._layerGains.shaytan) {
        this._layerGains.shaytan.gain.setTargetAtTime(0.1, this._ctx.currentTime, 0.3);
      }
    } catch { /* audio is best-effort */ }
  }

  // Master narration track (Oct 14, 2026): fari's supplied intro narration.
  // Played once at cinematic start; subtitles sync to its start time.
  // Returns the audio element/duration for sync, or null on failure.
  async playNarration() {
    if (!this._ctx) return null;
    const KEY = '__narration';
    try {
      await this._ctx.resume();
      let buf = this._buffers.get(KEY);
      if (!buf && !this._failed.has(KEY)) {
        const r = await fetch(ASSET_BASE + 'intro-narration.mp3');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const ab = await r.arrayBuffer();
        buf = await this._ctx.decodeAudioData(ab);
        this._buffers.set(KEY, buf);
      }
      if (!buf) return null;
      // Stop any existing narration first (prevent overlaps)
      this.stopNarration();
      const src = this._ctx.createBufferSource();
      src.buffer = buf;
      const g = this._ctx.createGain();
      g.gain.value = 1.0;
      src.connect(g);
      g.connect(this._master || this._ctx.destination);
      src.start();
      this._narrationSrc = src;
      this._narrationGain = g;
      this._narrationStart = this._ctx.currentTime;
      return { duration: buf.duration, startTime: this._narrationStart };
    } catch (e) {
      this._failed.add(KEY);
      return null;
    }
  }

  stopNarration() {
    try {
      if (this._narrationSrc) {
        this._narrationSrc.stop();
        this._narrationSrc.disconnect();
        this._narrationSrc = null;
      }
    } catch { /* already stopped */ }
  }

  // Duck narration during the recitation so both remain intelligible.
  duckNarrationForRecitation(duck = true) {
    try {
      if (this._narrationGain && this._ctx) {
        const target = duck ? 0.3 : 1.0;
        this._narrationGain.gain.setTargetAtTime(target, this._ctx.currentTime, 0.3);
      }
    } catch { /* best-effort */ }
  }

  // --- footsteps (throttled) -------------------------------------------------------

  _footstep() {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this._lastStep < 420) return; // avoid overlap on the 2s sample
    this._lastStep = now;
    this.play('footsteps_running');
  }

  // --- primitives ---------------------------------------------------------

  _dest(via) {
    return (via && this._gains && this._gains[via]) || this._master;
  }

  _tone({ freq = 440, freqEnd = null, dur = 0.15, type = 'sine', vol = 0.4, delay = 0, attack = 0.005, via = 'effects' }) {
    const ctx = this._ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this._dest(via));
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noise({ dur = 0.2, vol = 0.3, type = 'lowpass', freq = 1000, freqEnd = null, delay = 0, q = 1, via = 'effects' }) {
    const ctx = this._ctx;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t0);
    filt.Q.value = q;
    if (freqEnd !== null) filt.frequency.exponentialRampToValueAtTime(Math.max(10, freqEnd), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this._dest(via));
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // --- procedural sounds (kept as fallbacks; all < 0.5s unless noted) ----------

  _coin() {
    this._tone({ freq: 988, dur: 0.07, type: 'sine', vol: 0.32 });
    this._tone({ freq: 1319, dur: 0.12, type: 'sine', vol: 0.32, delay: 0.06 });
  }

  _jump() {
    this._tone({ freq: 280, freqEnd: 640, dur: 0.18, type: 'sine', vol: 0.35 });
  }

  _slide() {
    this._noise({ dur: 0.24, vol: 0.3, type: 'lowpass', freq: 1400, freqEnd: 300 });
  }

  _hit() {
    this._noise({ dur: 0.2, vol: 0.45, type: 'lowpass', freq: 900, freqEnd: 120 });
    this._tone({ freq: 130, freqEnd: 55, dur: 0.28, type: 'square', vol: 0.3 });
  }

  _powerup() {
    const notes = [523, 659, 784];
    notes.forEach((f, i) => this._tone({ freq: f, dur: 0.12, type: 'triangle', vol: 0.35, delay: i * 0.08 }));
  }

  _voucher() {
    this._tone({ freq: 660, dur: 0.15, type: 'triangle', vol: 0.35 });
    this._tone({ freq: 880, dur: 0.25, type: 'triangle', vol: 0.35, delay: 0.12 });
  }

  _click() {
    this._tone({ freq: 1050, dur: 0.05, type: 'square', vol: 0.18 });
  }

  _nearmiss() {
    this._noise({ dur: 0.26, vol: 0.32, type: 'bandpass', freq: 600, freqEnd: 3600, q: 1.5 });
  }

  _shaytan() {
    // Low dissonant swell — eerie, no harshness. Routed to the shaytan layer.
    this._tone({ freq: 55, dur: 0.48, type: 'sawtooth', vol: 0.16, attack: 0.15, via: 'shaytan' });
    this._tone({ freq: 58.3, dur: 0.48, type: 'sawtooth', vol: 0.16, attack: 0.15, via: 'shaytan' });
    this._tone({ freq: 110, freqEnd: 82, dur: 0.45, type: 'sine', vol: 0.22, attack: 0.1, via: 'shaytan' });
  }

  _breath() {
    // Slow ragged breath for the chase — shaytan layer.
    this._noise({ dur: 0.6, vol: 0.22, type: 'bandpass', freq: 300, freqEnd: 180, q: 2, via: 'shaytan' });
    this._noise({ dur: 0.5, vol: 0.18, type: 'bandpass', freq: 420, freqEnd: 240, q: 2, delay: 0.55, via: 'shaytan' });
  }

  _gameover() {
    const notes = [392, 311, 233];
    notes.forEach((f, i) => this._tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.34, delay: i * 0.13 }));
  }

  _start() {
    this._tone({ freq: 220, freqEnd: 880, dur: 0.3, type: 'sawtooth', vol: 0.2 });
    this._tone({ freq: 440, freqEnd: 1760, dur: 0.3, type: 'sine', vol: 0.22 });
  }

  // --- file-specific fallbacks (only reached when a file is unavailable) ---

  _dust() {
    this._noise({ dur: 0.18, vol: 0.22, type: 'lowpass', freq: 700, freqEnd: 150 });
  }

  _blip() {
    this._tone({ freq: 520, freqEnd: 780, dur: 0.09, type: 'triangle', vol: 0.25 });
  }

  _page() {
    this._noise({ dur: 0.22, vol: 0.16, type: 'highpass', freq: 2500 });
  }

  _whoosh() {
    this._noise({ dur: 0.35, vol: 0.3, type: 'bandpass', freq: 500, freqEnd: 2800, q: 1.2 });
  }

  _gate() {
    // Warm, quiet chime — matches the respectful tone of the academy gate.
    this._tone({ freq: 523, dur: 0.4, type: 'triangle', vol: 0.2, attack: 0.05 });
    this._tone({ freq: 784, dur: 0.5, type: 'triangle', vol: 0.16, attack: 0.05, delay: 0.15 });
  }

  _portal() {
    this._tone({ freq: 220, freqEnd: 880, dur: 0.25, type: 'sine', vol: 0.3 });
    this._noise({ dur: 0.2, vol: 0.2, type: 'bandpass', freq: 1200, freqEnd: 3000, q: 1.5 });
  }

  _step() {
    this._noise({ dur: 0.08, vol: 0.14, type: 'lowpass', freq: 900, freqEnd: 300 });
  }

  _jet() {
    this._noise({ dur: 0.4, vol: 0.25, type: 'lowpass', freq: 1600, freqEnd: 2400 });
  }
}
