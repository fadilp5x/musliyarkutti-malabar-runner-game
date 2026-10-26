# PATCHES.md — AcademyGate integration (integrator applies; subagent did NOT edit Game.js)

These patches wire `src/game/AcademyGate.js` into `src/game/Game.js`. All anchors
are verbatim from Game.js as of 2026-10-13. AcademyGate's own API is
`new AcademyGate(scene, assetLoader, { events, audio })`,
`placeAt(distanceM)` / `update(dt, distanceM)` / `reset()` / `dispose()`.
The gate is purely visual (`group.userData.nonColliding = true`, pillars at
|x| = 5.6 outside the road edge) — no collision changes needed.

## 1. Import (Game.js)

Anchor:
```js
import { LandmarkManager } from './LandmarkManager.js';
```
Replacement:
```js
import { LandmarkManager } from './LandmarkManager.js';
import { AcademyGate } from './AcademyGate.js';
```

## 2. Field declaration (Game.js)

Anchor:
```js
    this.world = null;
    this.landmarks = null;
```
Replacement:
```js
    this.world = null;
    this.landmarks = null;
    this.academyGate = null;
```

## 3. Construction (Game.js)

Anchor:
```js
    this.landmarks = new LandmarkManager(this.runnerRoot, this.events, this.assetLoader);
```
Replacement:
```js
    this.landmarks = new LandmarkManager(this.runnerRoot, this.events, this.assetLoader);
    // Shamsul Huda academy entrance gate: spans all 3 lanes at ~22 m, visual only.
    this.academyGate = new AcademyGate(this.runnerRoot, this.assetLoader, {
      events: this.events,
      audio: this.audio,
    });
```

## 4. Reset in `_beginRunner` (Game.js)

Anchor:
```js
    this.powerups.reset();
    this.world.reset();
    this.runnerRoot.visible = true;
```
Replacement:
```js
    this.powerups.reset();
    this.world.reset();
    this.academyGate.reset?.();
    this.runnerRoot.visible = true;
```

## 5. Reset in `_quitToTitle` (Game.js)

Anchor:
```js
      this.world.reset();
      this.landmarks.reset?.();
```
Replacement:
```js
      this.world.reset();
      this.landmarks.reset?.();
      this.academyGate.reset?.();
```

## 6. Per-frame update in `_updateRunner` (Game.js)

Anchor:
```js
    this.landmarks.update(dt, speed, this.scoring.distanceM);
```
Replacement:
```js
    this.landmarks.update(dt, speed, this.scoring.distanceM);
    this.academyGate.update(dt, this.scoring.distanceM);
```

## 7. Camera reveal tilt — wire in `_wireEvents` (Game.js, optional but recommended)

Subtle tilt as the player passes under the gate, using the existing
CameraController API. Place next to the other `events.on(...)` handlers:

```js
this.events.on('academy_gate_reveal', () => {
  if (!this._reducedMotion) this.cameraCtl.shake(0.15);
});
```

## 8. Audio key — `src/game/AudioManager.js` (optional, safe no-op until done)

AcademyGate calls `audio.play('academy_gate_reveal')` on pass-through; today
that is a silent no-op because the key is not in `SOUNDS`. To enable:
- add `'academy_gate_reveal'` to the `SOUNDS` array, and
- add a `case 'academy_gate_reveal': this._someChime(t); break;` branch in
  `play()` reusing an existing soft chime (do not invent a loud sting —
  keep it warm/quiet to match the respectful tone).

---
Also see `~/workspace/musliyarkutti-malabar-runner/.work/landmarks-findings.md`
for non-scope findings (spelling-consistency notes, CONTRACTS.md drift).

---

# Shaytan cinematic workstream — Game.js integration (integrator applies; subagent did NOT edit Game.js)

These patches wire the rewritten `src/game/LibraryScene.js` (cinematic scare +
chase) and the new `src/game/ShaytanPursuit.js` (street pursuit) into
`src/game/Game.js`. All anchors are verbatim from Game.js as of 2026-10-13.
`audio.play(name)` is already a safe no-op for the new sound-hook names, and
`cameraCtl.shake` already exists — no AudioManager/UI edits needed.

## S1. Import (Game.js)

Anchor:
```js
import { Missions } from './Missions.js';
import { Inventory } from './Inventory.js';
```
Replacement:
```js
import { Missions } from './Missions.js';
import { ShaytanPursuit } from './ShaytanPursuit.js';
import { Inventory } from './Inventory.js';
```

## S2. Field declaration (Game.js)

Anchor:
```js
    this.avatar = null;
    this.player = null;
    this.library = null;
    this.world = null;
```
Replacement:
```js
    this.avatar = null;
    this.player = null;
    this.library = null;
    this.pursuit = null;
    this.world = null;
```

## S3. Construction + audio-hook plumbing (in `init()`, after the library init)

Anchor:
```js
    this.library.setCamera(this.camera);
    if (this._reducedMotion) this.library.reducedMotion = true;
    await this.library.init();
```
Replacement:
```js
    this.library.setCamera(this.camera);
    if (this._reducedMotion) this.library.reducedMotion = true;
    await this.library.init();

    // Street pursuit (cinematic workstream): follows the player for ~10s
    // after each run begins, then dissolves and stays dormant.
    this.pursuit = new ShaytanPursuit(this.scene, this.events);
    this.pursuit.setCamera(this.camera);
    this.pursuit.setAssetLoader(this.assetLoader);
    this.pursuit.setPlayerX(() => this.player.x);
    this.pursuit.setReducedMotion(this._reducedMotion);

    // Audio-hook plumbing (cinematic workstream). 'sfx' carries sound-hook
    // names from LibraryScene/ShaytanPursuit; AudioManager.play is already a
    // safe no-op for unknown names, so these stay silent until the audio
    // workstream wires the new files.
    this.events.on('sfx', (name) => this.audio.play(name));
    // Camera shake for the library lunge (LibraryScene has no camera handle).
    this.events.on('shake', (n) => { if (this.cameraCtl) this.cameraCtl.shake(n); });
    // Room-ambience ducking. The audio workstream should consume this;
    // until then it is a documented no-op.
    this.events.on('audioDuck', ({ level } = {}) => { void level; });
```

## S4. Start the pursuit in `_beginRunner()`

Anchor:
```js
    this.setState(STATES.RUNNER); // UI shows HUD via 'statechange'
    this.audio.play('start');
  }
```
Replacement:
```js
    this.setState(STATES.RUNNER); // UI shows HUD via 'statechange'
    this.audio.play('start');
    if (this.pursuit) this.pursuit.start();
  }
```

## S5. Per-frame pursuit update in `_updateRunner(dt)`

Anchor:
```js
    this.cameraCtl.update(dt, this.player.x, 'runner');
    this.avatar.update(dt);
  }
}
```
Replacement:
```js
    // Street pursuit: playerZ is 0 in RUNNER (the world scrolls past the hero).
    if (this.pursuit) this.pursuit.update(dt, 0, speed);
    this.cameraCtl.update(dt, this.player.x, 'runner');
    this.avatar.update(dt);
  }
}
```

## S6. Stop the pursuit on game over

Anchor:
```js
  _gameOver() {
    if (this.state !== STATES.RUNNER) return;
    this.setState(STATES.GAMEOVER);
```
Replacement:
```js
  _gameOver() {
    if (this.state !== STATES.RUNNER) return;
    this.setState(STATES.GAMEOVER);
    if (this.pursuit) this.pursuit.reset();
```

## S7. Stop the pursuit on quit-to-title

Anchor:
```js
    this.runnerRoot.visible = false;
    this.player.reset();
    this.scoring.resetRun();
```
Replacement:
```js
    this.runnerRoot.visible = false;
    this.player.reset();
    if (this.pursuit) this.pursuit.reset();
    this.scoring.resetRun();
```

## S8. Propagate reduced-motion setting changes

Anchor:
```js
    if (this.library) this.library.reducedMotion = next.reducedMotion;
```
Replacement:
```js
    if (this.library) this.library.reducedMotion = next.reducedMotion;
    if (this.pursuit) this.pursuit.setReducedMotion(next.reducedMotion);
```

## Sound hooks emitted by the cinematic workstream (for the audio workstream)

| Hook | Source | Moment |
|---|---|---|
| `library_page_turn` | LibraryScene | quiet page turn on the intro screen; peaceful beat before the scare; kitab closing |
| `shaytan_distant_roar` | LibraryScene | scare begins (lights dim); ShaytanPursuit | retreat beat + dormant roars |
| `shaytan_reveal_roar` | LibraryScene | eyes in, silhouette grows |
| `shaytan_chase_breath` | LibraryScene | CHASE begins; ShaytanPursuit | pursuit start, lunge dash |
| `library_escape_whoosh` | LibraryScene | chase fade-to-black |
| `shaytan_surge` | ShaytanPursuit | `nearmiss`/`stumble` while the apparition is visibly present |
| `audioDuck` event `{ level }` | LibraryScene | `{level: 0.25}` at scare start, `{level: 1}` at chase fade |

All hooks route through `events.emit('sfx', name)` inside `LibraryScene._sfx` /
`ShaytanPursuit._sfx`, which also call `this.audio.play(name)` when an
AudioManager has been injected (`library.audio = …`, `pursuit.audio = …`).

---

# World/level workstream — sky repair + roadside enrichment (integrator applies; subagent did NOT edit Game.js)

**Status: NO PATCHES REQUIRED.** All work was completed inside
`src/game/WorldBuilder.js` (public API unchanged:
`constructor(scene, events, assetLoader)`, `reset()`,
`update(dt, speed, distanceM, quality)`, `setQuality(q)`).
`npm run build` clean, 46/46 Vitest + `node smoke.mjs` pass, and the new world
was visually verified in headless Chromium (CDP screenshots, zero console
errors) at high quality, low quality, and across `reset()`.

Outside files inspected, deliberately left untouched:

## `src/game/Game.js` — no change
- Anchor checked: `init()` sets `this.scene.fog = new THREE.Fog(0x87b5d6, 40, 160);`
  and `this.camera = new THREE.PerspectiveCamera(60, ..., 0.1, 1000);`
- WorldBuilder's new sky-dome horizon color (`FOG_COLOR = 0x87b5d6`) matches
  this fog; dome radius 420 < far plane 1000. No edit needed.
- The old `this.scene.fog = ...` line inside WorldBuilder `_buildSky()` was
  **removed** (it set fog on the `runnerRoot` Group — a no-op; Game.js owns
  the real scene fog). Behaviour unchanged.

## `src/game/LandmarkManager.js` — no change
- Landmark buildings occupy |x| 7..21. New props respect this: generic
  shops/houses at |x| 21.5..26.5, background service roads + vehicles at
  |x| 27.5..32.5. Palms/trees (8.5..16.5) may still intersect landmark
  buildings when z-coincident — pre-existing behaviour, kept.

## `src/game/ObstacleManager.js`, `CollectibleManager.js`, `LibraryScene.js`,
  `AudioManager.js`, `src/ui/*` — no change
- Nothing decorative inside the running lanes (|x| < 3.6). The only in-lane
  additions are flat painted turn-arrow decals (y = 0.025, like the existing
  lane dashes) — non-colliding road paint.

---

# Audio + UI workstream — Game.js integration (integrator applies; subagent did NOT edit Game.js)

The rewritten `src/game/AudioManager.js` exposes a 4-layer mixer
(music/ambience/effects/shaytan), file-backed SFX with procedural fallbacks,
per-layer volume settings, and event hooks. Game.js already calls
`audio.play(name)` / `audio.setEnabled(b)`; the patches below wire the rest.
All anchors are verbatim from Game.js as of 2026-10-13.

New AudioManager public API (matches the cinematic workstream's expectations):
- `audio.play(name)` — accepts all 20 file-backed hook names (`shaytan_distant_roar`,
  `shaytan_reveal_roar`, `shaytan_chase_breath`, `shaytan_surge`, `shaytan_retreat`,
  `library_ambience`, `library_page_turn`, `library_escape_whoosh`,
  `academy_gate_reveal`, `footsteps_running`, `jump_whoosh`, `landing_dust`,
  `lane_change`, `coin_collect`, `near_miss`, `pedestrian_collision`,
  `portal_collision`, `powerup_activate`, `jetpack_thrust`, `game_over`)
  PLUS all legacy procedural names (`coin`, `jump`, `slide`, `hit`, `powerup`,
  `voucher`, `click`, `nearmiss`, `shaytan`, `gameover`, `start`). Unknown names
  stay silent no-ops. Missing/undecodable files fall back to synths — never crash.
- `audio.setVolumes({ volumeMusic, volumeAmbience, volumeEffects, volumeShaytan })`
  — applies immediately, no restart. Defaults 0.8 / 0.7 / 0.9 / 0.8 (persisted
  in `mmr.settings` by SaveManager; settings UI in MenuController calls this live).
- `audio.bindEvents(events)` — subscribes `sfx`→play, `statechange`→loop routing
  (ambience in LIBRARY/SHAYTAN/CHASE, user-supplied bg-music.mp3 in RUNNER),
  `audioDuck`→duck, `footstep`→throttled footsteps.
- `audio.duck(level)` — smooth dip of music + ambience (consumes the S3
  `audioDuck` no-op).
- `audio.update(dt, flyY)` — per-frame; runs the jetpack thrust loop while
  `player.flyY > 2`.

## A1. Bind events in the constructor

Anchor:
```js
    this.save = new SaveManager();
    this.audio = new AudioManager();
    this.assetLoader = new AssetLoader();
```
Replacement:
```js
    this.save = new SaveManager();
    this.audio = new AudioManager();
    this.audio.bindEvents(this.events);
    this.assetLoader = new AssetLoader();
```

## A2. Apply persisted per-layer volumes in init()

Anchor:
```js
    this.audio.setEnabled(data.settings.sound !== false);
```
Replacement:
```js
    this.audio.setEnabled(data.settings.sound !== false);
    try { this.audio.setVolumes(data.settings); } catch { /* audio optional */ }
```

## A3. Consume audioDuck (apply AFTER the cinematic workstream's S3 patch)

Anchor (added by S3):
```js
    this.events.on('audioDuck', ({ level } = {}) => { void level; });
```
Replacement:
```js
    this.events.on('audioDuck', ({ level } = {}) => this.audio.duck(level));
```
Note: with A1's bindEvents, `audioDuck` is already consumed by the AudioManager
itself, so A3 is redundant-but-harmless — apply it anyway for a single clear
call site, or skip it; do NOT keep both duck paths in doubt.

## A4. Per-frame audio update + footstep emission in _updateRunner

Anchor:
```js
    this.cameraCtl.update(dt, this.player.x, 'runner', speed);
    this.avatar.update(dt);
    // Pooled FX step: player state for event placement + continuous states
```
Replacement:
```js
    this.cameraCtl.update(dt, this.player.x, 'runner', speed);
    this.avatar.update(dt);
    // Audio workstream: jetpack thrust loop follows player.flyY.
    try { this.audio.update(dt, this.player ? this.player.flyY : 0); } catch { /* noop */ }
    // Footstep emission while grounded in RUNNER (AudioManager throttles to
    // avoid overlap on the 2s footsteps_running sample).
    if (this.state === STATES.RUNNER && this.player && this.player.flyY < 0.5) {
      this._footT = (this._footT || 0) + dt;
      if (this._footT > 0.42) { this._footT = 0; this.events.emit('footstep'); }
    }
    // Pooled FX step: player state for event placement + continuous states
```

Notes for the integrator:
- Audio starts only after a user gesture (pointerdown/keydown unlocks the
  AudioContext and lazily preloads all files); nothing to do in Game.js.
- The settings screen (MenuController) persists the four volume sliders via
  SaveManager and calls `audio.setVolumes` live — no Game.js changes needed.
- `SaveManager.save({settings})` now MERGES volume keys over stored settings,
  so Game.js `_applySettings` (which writes only sound/reducedMotion/quality)
  no longer wipes the volume sliders. No Game.js change needed.

---

# Speed + Effects workstream (Oct 13, 2026 — gameplay/speed engineer)

Everything the speed workstream could change inside its own files was changed
directly (`src/game/Game.js` `_speed()`/effects hooks only, `src/game/PlayerController.js`,
`src/game/PlayerAvatar.js`, `src/game/CameraController.js`, new
`src/game/EffectsManager.js`). Two items below need the collision workstream
(they live in `ObstacleManager.js`, which is not this workstream's file).

## 1. REQUIRED: row-gap formula must be widened for the new 28 m/s cap

**Why.** `_speed()` is now `min(10 + distanceM*0.0125, 28)`. With the old
`clamp(34 - speed*0.7, 16, 34)` the gap clamps to 16 m at cap speed, but a full
jump now travels 28 * (2*8.2/24) = **19.1 m** — you would land ON the next row.
Worse, the shortened slide (0.75 -> 0.62 s, in `PlayerController.js`) still
travels 17.4 m at cap, and a slide locks out jumping, so a jump-required row
right after a slide row would be unreactable.

**Verification.** `/tmp/fairness-check.mjs` replicates the runner constants and
asserts, for every speed 10..28: reaction time >= the old minimum (0.717 s),
jump travel < gap-0.5, slide travel < gap-0.5, two-lane change < gap-2, and the
1.0 m-clear window during a jump wider than the deepest jump obstacle. ALL
CHECKS PASS with the formula below (at 28 m/s: gap 20.4 m, reaction 0.729 s —
essentially the old feel). Note the old system was ALREADY marginal here: at
the old 24 m/s cap, slide travel was 18.0 m > 17.2 m gap.

**Patch A** — `src/game/ObstacleManager.js`, in `update()`:

Anchor:
```js
    // row generation: rows every gap metres
    const gap = clamp(34 - speed * 0.7, 16, 34);
```
Replacement:
```js
    // row generation: rows every gap metres. Speed workstream (Oct 2026):
    // widened for the 28 m/s cap — preserves the old 0.717 s minimum reaction
    // time and keeps full jumps (19.1 m) and slides (17.4 m) inside the gap.
    const gap = clamp(40 - speed * 0.7, 20.2, 40);
```

**Patch B** — `src/game/ObstacleManager.js`, in `reset()` (pre-run seeding):

Anchor:
```js
    // pre-populate a few rows so the road ahead isn't empty at run start
    const gap = clamp(34 - 8 * 0.7, 16, 34);
```
Replacement:
```js
    // pre-populate a few rows so the road ahead isn't empty at run start
    // (base speed is now 10 m/s; same formula as update())
    const gap = clamp(40 - 10 * 0.7, 20.2, 40);
```

Do NOT just change the slope — the floor is the binding constraint at cap
speed, and the old floor of 16 m is what breaks fairness.

## 2. Event -> SFX mapping expected by the speed/FX workstream

The speed workstream emits gameplay events only; it does NOT call
`AudioManager` (another workstream's file). `PlayerController` now emits two
new events alongside the existing `'jump'`, `'land'`, `'slide'`, `'coin'`,
`'nearmiss'`, and `'crash'`:

| event | payload | when | expected SFX key |
|---|---|---|---|
| `footstep` | `{x, y}` | each stride while running grounded (period = PI / (14 * speed/8) s; up to ~15.6/s at cap) | `footsteps_running` |
| `jump` | — | jump takeoff (existing) | `jump_whoosh` |
| `land` | — | touchdown (existing) | `landing_dust` |
| `left` / `right` | `{lane, dir}` | lane change (new) | `lane_change` |
| `coin` | `1` | coin collected (existing) | `coin_collect` |
| `nearmiss` | — | near miss (existing) | `near_miss` |

Notes for the audio workstream:
- `footstep` can fire ~15/s at cap speed — consider a polyphony/throttle cap
  and/or pitch-scaling with stride rate rather than playing every event.
- `EffectsManager` subscribes to the same events for visuals; it never emits
  sound and must not be used as the audio trigger (audio maps the gameplay
  events directly).
- `reducedMotion` suppresses most FX but does NOT suppress events — do not
  gate SFX on the FX manager.
