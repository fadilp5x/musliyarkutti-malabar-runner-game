# BUG_FIX_REPORT — collision workstream (2026-10-13)

Scope: `src/game/ObstacleManager.js`, `src/game/CollisionSystem.js`,
`src/game/PlayerController.js`, `src/game/CollisionDebug.js` (new),
`tests/` (new regression file), and the crash/stumble wiring sections of
`src/game/Game.js`. Nothing else touched.

Verification: `npx vitest run` → 46/46 green (30 pre-existing + 16 new);
`node smoke.mjs` → all checks pass; `npm run build` → clean (CollisionDebug
code-splits into its own chunk, loaded only on `?debug=collisions`).
Visual in-browser rendering of the new FX/group/overlay was NOT possible in
this environment (no live browser); those are covered by unit tests + build +
smoke only — flagging honestly.

## Issues found (with root causes)

### 1. Stumble event infinite recursion — FIXED
- `src/game/PlayerController.js:93` (old): `stumble()` called
  `this.events.emit('stumble')`.
- `src/game/Game.js:297` (old): the `'stumble'` handler called
  `this.player.stumble()`.
- Chain: `ObstacleManager` emits `'stumble'` → Game handler →
  `player.stumble()` → emits `'stumble'` → Game handler → … until
  `RangeError: Maximum call stack size exceeded`, caught by the bus's
  try/catch (`Game.js` emit wrapper) and logged to console. Every puddle or
  pedestrian hit threw and logged a stack overflow. It "worked" only because
  the error was swallowed.
- Fix: `stumble()` no longer emits (`PlayerController.js:93`); the collision
  source (`ObstacleManager`) owns the event, `Game` owns the response.
  No other caller depended on the self-emit (only Game's handler called
  `player.stumble()`).

### 2. Smartphone portal fired into the void — FIXED
- `src/game/ObstacleManager.js:498` (old): portal overlap emitted `'portal'`,
  but `Game.js` `_wireEvents()` had **no `'portal'` handler** — confirmed by
  grep: zero `on('portal', …)` listeners anywhere in `src/`. The player passed
  through silently.
- Fix: portal overlap now emits `'crash'` with `{ type, kind: 'portal', lane,
  index }` (`ObstacleManager.js:549`), so the existing shield/glideboard
  absorb → destroy-obstacle rules, or game-over, apply unchanged. Game's
  crash handler adds the portal FX: blue-cyan shockwave ring at the portal
  (`Game.js:303-309`), `audio.play('portal_collision')` (safe no-op until the
  audio workstream wires the file), `cameraCtl.shake(0.55)`, and a cyan
  `#impact-flash` screen flash.

### 3. Pedestrian crowd: weak feedback + single figure + undersized hitbox — FIXED
- Old visual was one figure (`_buildPedestrian`, single cone/capsule) with a
  `0.7 × 1.7` box (`ObstacleManager.js` TYPES) — not a crowd, and the box
  didn't match even the single figure's robe (radius 0.44).
- Old reaction: bare `'stumble'` emit → Game handler did the anim only. No
  sound, no shake, no flash — hence "almost no visible consequence".
- Fix:
  - `_buildPedestrian()` (`ObstacleManager.js:177`) now builds a respectful
    GROUP of 2–3 modest figures (reuses the existing purdah/casual variants,
    offsets x ∈ {−0.6, 0, 0.6} or {±0.42}, slight depth stagger).
  - Collision box widened to `{ w: 2.1, h: 1.7, d: 0.6 }`
    (`ObstacleManager.js:43`) to match the rendered footprint (outer figure
    at |x| ≤ 0.6 + robe radius 0.44). Still lane-local: adjacent-lane player
    (|Δx| = 2.4) cannot false-trigger.
  - Rich feedback in `Game._onPedestrianHit` (`Game.js:352`): existing stumble
    anim + `audio.play('pedestrian_collision')` (safe no-op for now) +
    restrained `cameraCtl.shake(0.35)` + warm `#impact-flash` flash.
    Shake/flash honor the reduced-motion setting.
  - Rules: shield/glideboard active → consume protection + bright break-effect
    ring at the crowd + obstacle already destroyed by the manager, no stumble.
    Unprotected **and** already stumbling (`_stumbleT > 0`, the vulnerable
    window) → emits `'crash'` (game over, since no protection remains).
    Otherwise → rich non-lethal stumble.
  - Lockout: `ob.hit` flag set before emit; obstacle removed immediately
    (as before), so no multi-fire within or across frames.
  - Puddle keeps classic semantics: `'stumble'` with `type: 'puddle'` →
    anim only, never death. Game branches on `info.type === 'pedestrian'`
    (`Game.js:328`).

### 4. Portal fairness accounting was wrong — FIXED
- `_kindToCell('portal')` returned `'free'` and the portal-row branch never
  marked its lane, so `rowIsFair` treated a deadly lane as passable.
- Fix: `_kindToCell('portal')` → `'block'` (`ObstacleManager.js:334`); the
  portal-row branch now records `cells[lane] = this._kindToCell('portal')`
  (`ObstacleManager.js:320`); the redundant special-case in the single-lane
  branch was removed (`ObstacleManager.js:301`). A portal row is now
  `['block','free','free']` — always fair. The defensive unfair-row removal
  is unchanged.

### 5. Portal multi-fire — FIXED
- New lockout: `ob.hit = true` before emit plus a 0.5 s global
  `_portalCd` (`ObstacleManager.js:141,454,546-548`, reset in `reset()`).
  Regression test confirms a single crash across 30 frames.

### 6. No collision observability — FIXED
- New dev-only `src/game/CollisionDebug.js`: Box3Helper per live obstacle
  AABB (color-coded by kind) + player AABB + lane guide lines, and console
  logging of `crash`/`stumble`/`nearmiss`. Enabled only via
  `?debug=collisions` through a dynamic import in `Game.init()`
  (`Game.js:170-181`) — it code-splits out of the main bundle (verified in
  build output: `CollisionDebug-*.js` chunk). Live AABBs come from the new
  `ObstacleManager.debugBoxes()` (`ObstacleManager.js:356`), which reuses the
  exact box math from the collision loop.
- Tiny Game.js hook: `collisionDebug.update(playerBox, obstacles.debugBoxes())`
  after `obstacles.update()` in `_updateRunner` (`Game.js:635`).

### 7. Minor: unguarded 'stumble' handler — FIXED
- The old handler ran regardless of game state. It now returns early unless
  `state === STATES.RUNNER` (`Game.js:326`), matching the crash handler.

## Other inspection notes (no change needed)
- `CollisionSystem.js` (`aabbOverlap`, `rowIsFair`, `LANES`): pure and
  correct; no changes. No existing unit test assumed `portal == free`.
- `PlayerController.getBox()` matches the documented AABB (±0.35 x,
  0→1.7 y, ±0.3 z; 0.85 tall when sliding). Unchanged.
- `AudioManager.play()` ignores unknown names, so the new
  `'pedestrian_collision'` / `'portal_collision'` hooks are safe until the
  audio workstream adds real SFX (I may not touch `AudioManager.js`).
- The `'portal'` event is no longer emitted anywhere; no UI/listener code
  referenced it (verified by grep), so nothing else breaks.
- Transient FX (`_spawnShockwave` / `_updateFx` / `_flashImpact`,
  `Game.js:381-429`) use a minimal self-created `#impact-flash` div — no UI
  restyle. Rings are disposed after 0.45 s and cleared on restart/quit
  (`_clearFx`, `Game.js:532`).

## Deliberate judgment calls (for review)
- Portal stays deadly **while jetpacking** (its box spans y 0→4.2; no jet
  skip, unlike jump/block). Rationale: it reads as a hovering hazard column,
  and lane-dodging still works mid-flight.
- Reduced-motion mode suppresses shake + flash but keeps SFX hooks.

## Not verified
- Pixel-level rendering of the pedestrian group, shockwave rings, screen
  flash, and the debug overlay (no live browser in this environment).
- Real-device performance impact of the debug overlay (dev-only, off by
  default).

---

# Appendix: audio-ui workstream findings (verbatim, 2026-10-13)

# audio-ui-findings.md — Audio + UI workstream (2026-10-13)

Scope: `src/game/AudioManager.js` (rewrite), `src/game/SaveManager.js`
(settings additive), `src/ui/*` (all), PATCHES.md (integration section for the
integrator). Game.js / PlayerController.js / LibraryScene.js / WorldBuilder.js /
ObstacleManager.js / LandmarkManager.js were NOT touched.

## Done & verified

- **AudioManager rewrite**: 4 independent layers (music / ambience / effects /
  shaytan), each its own GainNode, default volumes 0.8 / 0.7 / 0.9 / 0.8.
  All 20 `public/audio/sfx/*.wav` files + `public/audio/bg-music.mp3` verified
  present on disk and verified copied into `dist/audio/` by `npm run build`.
  `play(name)` accepts all 20 file-backed hook names + all 11 legacy procedural
  names (`coin, jump, slide, hit, powerup, voucher, click, nearmiss, shaytan,
  gameover, start`); legacy mapping per spec
  (coin→coin_collect, nearmiss→near_miss, gameover→game_over,
  powerup→powerup_activate, shaytan→shaytan_reveal_roar); the rest keep their
  original procedural synths, which are also the per-file fallbacks when a
  file is missing/undecodable. Unknown names stay silent no-ops.
- AudioContext starts only after pointerdown/keydown; assets preload lazily
  after the first gesture. Relative paths (`audio/sfx/<n>.wav`,
  `audio/bg-music.mp3`) — no hotlinking, works in dist/. On file://, fetch()
  fails and the engine falls back to synths by design (never crashes).
- Event API for the integrator: `bindEvents(events)` wires
  `sfx`→play, `statechange`→loop routing (ambience loop in LIBRARY/SHAYTAN/CHASE;
  bg-music.mp3 loop in RUNNER; silence on GAMEOVER), `audioDuck`→`duck(level)`,
  `footstep`→throttled (420 ms) footsteps_running. `update(dt, flyY)` runs the
  jetpack thrust loop while `player.flyY > 2`. `setVolumes({...})` applies live
  with no restart. Ducking smooth-ramps music + ambience; effects/shaytan are
  untouched.
- **SaveManager**: settings now carry `volumeMusic / volumeAmbience /
  volumeEffects / volumeShaytan` (validated 0–1; invalid → whole-settings
  fallback to defaults, matching the existing strict pattern). `save({settings})`
  MERGES volume keys over stored settings, so Game.js `_applySettings` (which
  writes only sound/reducedMotion/quality) can no longer wipe the sliders.
- **Settings UI**: 4 live volume sliders (Music / Ambience / Effects / Shaytan)
  with % readouts, ≥44px touch targets, focus-visible styles; Music row carries
  a "Background track: user-supplied" caption (the mp3 was supplied by the user
  — its content was NOT inspected and no claims are made about it). Sound
  toggle, reduced-motion, quality, and reset-progress all still functional.
- **UI polish**: title screen gets a CSS-only animated library backdrop
  (drifting glow + dust motes, reduced-motion aware), a gold title rule, and a
  best-score / best-distance / lifetime-coins strip. HUD chips now show a
  seconds timer and labels for all 7 power-ups; the voucher badge pops when a
  new voucher lands. `#impact-flash` keeps its Game.js-owned element — only
  default/polish CSS was added in screens.css (no second element built).
- Voucher wallet + verbatim "DEMO VOUCHER — NOT VALID FOR REAL-WORLD PURCHASES"
  disclaimer untouched. Missions, `mmr.*` saves, Arabic-letter coins (not in my
  files), all 7 power-ups preserved.
- Verified: `npx vitest run` → 46/46 green; `npm run build` clean; headless
  Node checks for volume defaults/persist/merge/invalid-reject + AudioManager
  no-window no-op safety for all 31 accepted names + events + update + destroy.

## Non-scope / needs attention (not fixed — out of my files)

1. **Shaytan S5 patch anchor looks stale.** PATCHES.md S5 anchors on
   `this.cameraCtl.update(dt, this.player.x, 'runner');` + `this.avatar.update(dt);`
   but Game.js actually has `..., 'runner', speed);` at line 719 and
   `this.avatar.update(dt * 0.25);` at line 621 — the verbatim anchor matches
   neither. The integrator should confirm the intended site (likely
   `_updateRunner` near line 719) before applying S5. My A4 patch anchors on
   the verified line-719 text instead.
2. **audioDuck has two consumers after my patches.** A1's `bindEvents` already
   subscribes `audioDuck`→`audio.duck`. The S3 patch adds a no-op
   `audioDuck` handler, and my A3 replaces it with a direct `audio.duck` call.
   Applying both A1 and A3 means duck() runs twice per event (idempotent —
   same level — but the integrator should pick one clear call site).
3. **Footsteps previously had no emitter.** No `'footstep'` event existed
   anywhere; A4 adds the emission in `_updateRunner` via the integrator.
   Until applied, `play('footsteps_running')` still works when called directly.
4. Pre-existing nits carried over (not mine to fix): the sky's dark halo
   around the sun; game-over screen and real mobile GPU were not visually
   checked for this workstream's changes (only headless Node + build + tests).

---

# Appendix: collisions workstream findings (verbatim, 2026-10-13)

# Collision workstream — findings outside scope (2026-10-13)

Things noticed during the collision repair that belong to other workstreams.
Nothing here was changed.

## Docs / contracts (stale after this fix)
- `CONTRACTS.md:150` documents `smartphone_portal` as "overlap → +250 score
  & coin burst (bonus, never death)". The portal is now **deadly** (emits
  `'crash'`, kind `'portal'`). The contracts doc needs updating by its owner.
- `CONTRACTS.md:36` event list doesn't mention `'portal'` (already true
  before); the event is now fully retired — nothing listens for it.
- `FEATURE_CHECKLIST.md:98` says the portal was "verified in code path only
  (`portal` event), not in live play" — doubly stale now.

## Audio workstream
- `AudioManager.js` `SOUNDS` list has no `'pedestrian_collision'` or
  `'portal_collision'`. Game.js now calls `audio.play()` with both names;
  `play()` safely no-ops on unknown names, so this is forward-compatible —
  but the real SFX still need to be added there (file was out of scope).

## Design questions for the parent / game-design owner
- `getFreeLanes()` (`ObstacleManager.js`) only treats kind `'block'` as
  lane-blocking. The portal is now deadly but keeps kind `'portal'`, so
  vouchers and power-ups can still spawn in a portal lane — a deliberate
  risk/reward or an oversight? Currently the former by default.
- Portal is deadly while jetpacking (box spans y 0→4.2, no jet skip). Kept
  intentionally; confirm this is the desired difficulty.
- Pedestrian `drift: 0.85` (`ObstacleManager.js` spawn) makes crowds approach
  slower than the road scrolls — they visually recede relative to road
  markings. Pre-existing; left alone.

## Robustness nits (not fixed — out of scope, low risk)
- `spawnRow`'s defensive unfair-row removal matches obstacles by exact float
  equality (`ob.z === z`). Works today because `spawnRow` runs before any z
  mutation, but it's fragile.
- The old `'stumble'` handler had no state guard; the new one (and the
  pedestrian path) guard on `STATES.RUNNER`. Behavior change is strictly
  safer, but noted.
- `_flashImpact` uses `z-index: 60` on a body-level div; verify against the
  UI workstream's overlay stacking if menus ever overlap mid-run flashes
  (flashes only fire during RUNNER, so risk is minimal).

---

# Appendix: landmarks workstream findings (verbatim, 2026-10-13)

# Landmarks workstream — findings (2026-10-13)

Scope: `src/game/LandmarkManager.js` upgrades + new `src/game/AcademyGate.js`.
Game.js was NOT edited; integration patches are in repo-root `PATCHES.md`.

## Done
- `src/game/AcademyGate.js` (new): two pillars (|x|=5.6, outside road edge 5.3)
  + beam/parapet spanning all 3 lanes at lap offset 22 m (inside the 8–35 m
  window). Purely visual: `group.userData.nonColliding = true`, no collider
  registered. Official logo loaded as a THREE texture from the LOCAL file
  `public/shia-logo.png` via `${import.meta.env.BASE_URL}shia-logo.png`
  (never hotlinked, never rendered as text); canvas-drawn
  "SHAMSUL HUDA ISLAMIC ACADEMY" fallback if the file is missing.
  Reveal: warm PointLight + sign/lamp emissive ramp as the player approaches;
  emits `academy_gate_reveal` on the event bus and calls
  `audio.play('academy_gate_reveal')` (safe no-op until AudioManager wires it).
  API: `new AcademyGate(scene, assetLoader, {events, audio})`,
  `placeAt(distanceM)` / `update(dt, distanceM)` / `reset()` / `dispose()`.
  Verified in node with DOM stubs: z sweep correct (z=-12 at d=0, passes player
  at d=22), reveal fires once per lap and re-arms (3 passes over 1850 m),
  reset re-arms, dispose removes + frees resources.
- `LandmarkManager.js`: kept the 9-landmark fixed-offset loop and public API
  (`reset`/`update`). All signs are now DIMENSIONAL (dark backing board +
  canvas name-face in a road-facing holder; `_addSign` returns the holder).
  Required spellings applied: 'Hey Laban Store', 'Bus stop',
  'Shamsul Huda Islamic Academy Campus'. Per-landmark identity upgrades:
  Juicify = full cyan/blue glass curtain + cyan mullions; Turkish Corner =
  dark facade + warm-yellow lettering + roadside food counter (striped awning,
  warm glow strip); Hey Laban = blue pilasters/lintel/base band; Family
  Collections = teal striped awning + fabric rolls (+ clothing boxes moved to
  the other window); Bus stop = shelter + pole sign; Masjid = unchanged dome +
  minarets + crescent (respectful exterior); Edumart Office = glass front +
  entry steps + yellow sign; Academy Campus = boundary wall with gate gap +
  gate echo; MyG = orange sign + phone displays. All props stay at world
  |x| >= ~5.1 (roadside), lanes untouched. Signage is name-only.

## Verification
- `npm run build`: clean (34 modules). `dist/shia-logo.png` present after build.
- `npx vitest run` on the 4 pre-existing suites: 30/30 pass.
- `node smoke.mjs`: 17 PASS, 0 FAIL.

## Non-scope findings / handoffs
1. **Failing test not mine**: `tests/collision-regression.test.js` >
   "renders a small group (2-3 figures), not a single figure" fails
   (crowd children = 1, expected >= 2). It was created 07:23 UTC by the
   concurrent collision workstream (ObstacleManager.js also touched 07:22
   UTC); it imports ObstacleManager/CollisionSystem/Game only and is
   independent of the landmark changes. Left for that workstream.
2. **Spelling consistency**: VoucherManager's `VOUCHER_STORES` still lists
   `'HEY LABAN STORE'` while the landmark signage now reads
   'Hey Laban Store' per the required spellings. Voucher files are another
   workstream's scope — flagging so the voucher/wallet UI can reconcile.
3. **CONTRACTS.md drift**: §LandmarkManager documents the old spellings
   ('HEY LABAN STORE', 'Shamsul Huda Islamic Academy' without 'Campus') and
   line 232 repeats 'HEY LABAN STORE' in VOUCHER_STORES. Worth a doc touch-up.
4. **Not yet live**: AcademyGate is constructed/updated/reset only via the
   PATCHES.md Game.js integration — the gate will not appear in-game until
   the integrator applies it.
5. **Library interior sign** ("SHAMSUL HUDA LIBRARY") intentionally untouched —
   other workstream's scope; no duplication.
6. Perf: AcademyGate adds exactly one PointLight and ~25 small meshes; sign
   and stripe textures are module-cached. No new npm deps, no runtime network.

---

# Appendix: shaytan workstream findings (verbatim, 2026-10-13)

# Shaytan workstream — non-scope findings

## Verified safe (no action needed)
- `AudioManager.play()` is already a silent no-op for unknown names, so the new
  sound hooks (`library_page_turn`, `shaytan_distant_roar`, `shaytan_reveal_roar`,
  `shaytan_chase_breath`, `library_escape_whoosh`, `shaytan_surge`) cannot break
  the game before the audio workstream wires files. The `audioDuck` event is
  intentionally a documented no-op until the audio workstream consumes it —
  I could not add a duck method to AudioManager (out of scope for my files).
- PATCHES.md (S1–S8) is additive to the existing AcademyGate patches; anchors
  were chosen on lines that workstream does not touch.
- `ShaytanPursuit` warning vignette lazily loads `svg/shaytan_warning.svg`
  (already preloaded at boot); until it resolves, a procedural red-edge
  vignette is used, so there is no flash of untextured geometry.

## For the integrator (Game.js patches S1–S8 not yet applied)
- The pursuit never appears in the street until the Game.js patches land — I
  could not test the street pursuit end-to-end. LibraryScene's new intro was
  syntax-checked via build only; the visual sequence (sign placement, eye
  positions, tendril wobble) has NOT been screenshot-verified.
- `shake` events from LibraryScene need the S3 wiring to be visible;
  without it they are harmless no-ops.

## Behaviour notes / minor risks
- The scare is now ~4.2s (was ~3.5s) — "extended slightly for cinema" as
  permitted. Flow LIBRARY→tap→SHAYTAN→CHASE→RUNNER is unchanged.
- During the lunge the apparition reaches z ≈ −0.7, i.e. past the desk toward
  the camera; with reducedMotion this is muted (no flicker, no shake, faint
  smoke only).
- The chase-dissolve happens at t≈2.6–3.4 of `playChase`, before the
  fade-to-black at 3.5, so the apparition never pops out.
- `ShaytanPursuit` keeps the apparition low (y≈0.75, blob at y=0.03) and
  z ≥ playerZ+1.2 by design so it can't sit over the road hiding obstacles.
- Surge on `nearmiss`/`stumble` only fires while the apparition is visibly
  present (pursue/retreat); in dormant phase those events do nothing.
- Long runs: dormant roars re-arm every 40–70s indefinitely — intended
  atmosphere, but if the run lasts 20+ minutes the roar hook fires often.

---

# Appendix: speed workstream findings (verbatim, 2026-10-13)

# Speed + Effects workstream — findings (Oct 13, 2026)

## What was changed (in-scope)

- `Game.js`: `_speed()` = `min(10 + distanceM*0.0125, 28)` (base 8→10 = +25%,
  cap 24→28 = +17%, linear ramp kept, slope 0.012→0.0125; cap reached at
  ~1440 m vs ~1333 m before). `MAX_SPEED` 24→28. Effects hooks only: construct
  `EffectsManager`, `reset()` on run start, `update()` per step in RUNNER
  (running) and GAMEOVER (finishing), speed passed to `CameraController`.
- `PlayerController.js`: emits `footstep` each stride while running grounded
  (period = π / (14·speed/8) s), emits new `left`/`right` on lane changes
  (`{lane, dir}`), advances `avatar.runPhase`/`runRate`. **Slide time 0.75→0.62 s**
  (fairness fix — see below).
- `PlayerAvatar.js`: run-cycle phase driven by the controller's `runPhase`
  instead of `animT·14`, so leg swing and footstep events can never drift apart.
- `CameraController.js`: optional 4th arg `speed`; in runner mode damping
  tightens 5→7 and the camera lifts +0.5 m / looks +2 m further ahead at cap
  speed (subtle, no nausea). Old 3-arg calls behave exactly as before.
- New `src/game/EffectsManager.js`: pooled (fixed-size round-robin pools, zero
  per-frame allocation), capped, off-screen culled. Event-triggered only:
  footstep dust, landing burst, lane-change streaks, jump wisp, coin sparkle,
  near-miss streak, portal blue-cyan swirl (complements, not duplicates, the
  collision workstream's shockwave), glideboard trail, jetpack thrust, and
  speed lines above ~70% max speed. `reducedMotion` suppresses ambient FX.

## Fairness verification (done)

- `/tmp/fairness-check.mjs` (throwaway script, not committed): at every speed
  10–28 m/s, asserts reaction ≥ old minimum (0.717 s), jump travel < gap−0.5 m,
  slide travel < gap−0.5 m, two-lane change < gap−2 m, 1.0 m-clear window >
  deepest jump obstacle. **All pass** with the proposed gap formula
  `clamp(40 − speed·0.7, 20.2, 40)` (PATCHES.md §1 — needs the collision
  workstream, ObstacleManager.js is not my file).
- Node smoke of PlayerController/PlayerAvatar: 5 footsteps in 1 s at 10 m/s,
  runPhase synced, jump/land/slide events intact, no footsteps mid-air or
  while sliding, slide travel 17.5 m at 28 m/s < 19.9 m margin.
- `npx vitest run`: 46/46 green (incl. voucher 500 m rule and rowIsFair tests).
- `npm run build`: clean.

## Non-scope findings (honest notes)

1. **The gap-formula patch is REQUIRED, not optional.** Until PATCHES.md §1 is
   applied, the old `clamp(34 − speed·0.7, 16, 34)` floor of 16 m stands, and
   at speeds above ~24.4 m/s a full jump (up to 19.1 m travel) lands on the
   next row. The game is currently unfair at the top of the new speed band.
2. **Pre-existing unfair corner found (not introduced by me):** at the OLD
   24 m/s cap, slide travel was 18.0 m > 17.2 m gap — a slide followed by a
   jump row was already unreactable. The 0.62 s slide time fixes this for both
   old and new caps.
3. **Not visually verified.** I have no live-browser access in this session, so
   the FX (dust, streaks, swirls, speed lines) and the camera raise were NOT
   seen on screen. Values were chosen conservatively (small scales ≤0.5 m,
   opacities 0.26–0.5, lives ≤0.65 s), but a headless-Chromium screenshot pass
   is still owed before calling the visuals "done" — especially the speed
   lines at cap speed and the portal swirl vs the existing shockwave.
4. **Footstep event rate** reaches ~15.6/s at cap speed. The audio workstream
   must throttle `footsteps_running` (noted in PATCHES.md §2); the FX side
   already throttles dust to one puff per 0.07 s.
5. **Coin sparkle position is approximate** (player pos, not the coin's) — the
   `coin` event carries only a count and CollectibleManager is another
   workstream's file. Coins collect within ~1 m of the hero, so this is fine.
6. **Score accumulates ~25% faster** early (per-metre scoring is unchanged, so
   this is consistent, not a bug — high scores will just read higher).
7. Speed lines are world-anchored relative to the camera, not screen-space;
   on ultrawide aspect ratios the "edge of screen" x-offsets (±3.6–6.2 m at
   ~9–13 m ahead) may sit slightly inside the visible edge. Acceptable; tune
   after the visual pass.
8. `EffectsManager` builds canvas textures at construction — fine in the
   browser, but it must never be constructed in a node/test context.
EOF
echo done
---

# Appendix: world workstream findings (verbatim, 2026-10-13)

# world-findings.md — WorldBuilder workstream (2026-10-13)

Non-scope findings from the sky/road/roadside work. All changes landed in
`src/game/WorldBuilder.js`; see `PATCHES.md` (repo root) for the
no-outside-edits statement.

## 1. Sun "dark halo" — diagnosis (honest note)
- I could **not reproduce** a dark halo in the current build. I rendered the
  real `WorldBuilder` headlessly (Chromium 152 + SwiftShader via CDP, exact
  runner camera framing, fog 40→160) before and after the change and scanned
  pixel rows through the sun: brightness rises monotonically into the glow
  with no dip below sky level.
- The previously recorded root cause (sky dome clipped by camera far plane
  400, exposing dark-navy `scene.background`; fixed by far 400→1000) is
  consistent with what I see — the bug appears already fixed.
- Applied defense-in-depth anyway, since a normal-blended soft sprite is the
  classic halo mechanism (dark RGB where alpha is 0, premultiplication
  quirks, driver differences):
  1. glow sprite now uses `THREE.AdditiveBlending` (can only add light —
     a dark ring is mathematically impossible);
  2. glow texture is pure-white RGB with an alpha-only falloff (no dark RGB
     at alpha 0 to smear);
  3. the sun itself is an **opaque** disc mesh (zero blending risk), glow is
     halo-only;
  4. dome horizon color == fog color (`0x87b5d6`), so no bright/dark seam.
- If the halo is still seen on a real device, the remaining suspects are a
  real-GPU blending difference (not reproducible in SwiftShader here) or the
  library-scene Shaytan smoke — not the runner sky.

## 2. Removed misleading line (no behaviour change)
- Deleted `this.scene.fog = new THREE.Fog(...)` from `_buildSky()`. In
  production `scene` is the `runnerRoot` **Group**, so the assignment was a
  no-op; Game.js owns the real scene fog (40→160). Noted in PATCHES.md.

## 3. Turn arrows sit at |x| = 2.4 (inside the lane band) — intentional
- They are flat painted decals (y = 0.025, alpha-tested, like the existing
  lane dashes), not props. No collision or visual-blocking concern.

## 4. Junction side streets vs landmark buildings
- Junctions recycle on the 180-unit treadmill wrap; landmarks on the 900 m
  lap. When they coincide in z, a side-street apron may pass *behind* a
  landmark building — reads naturally as the lane continuing behind it.
- Generic shops/houses were placed at |x| 21.5..26.5 (landmarks end at 21);
  service roads/vehicles at |x| 27.5..32.5. Palms/trees at 8.5..16.5 can
  still intersect landmark buildings when z-coincident (pre-existing).

## 5. Draw calls / perf (not measured on real mobile GPU)
- Merged-geometry props (1 draw call each): palms went 14×8 → 14×2 meshes,
  lamps 8×3 → 8×1. New props add ~90 draw calls (high). `low` quality halves
  scenery visibility via the existing index-parity pattern and disables
  shadow casting. Real-device perf still unmeasured.

## 6. Not verified
- Real mobile GPU rendering; game-over screen framing with the new world
  (only the runner view was screenshotted); reduced-motion interplay is
  untouched (no motion added beyond the existing sway/drift patterns).
