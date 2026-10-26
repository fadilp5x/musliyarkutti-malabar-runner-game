# CHANGELOG — MUSLIYARKUTTI: MALABAR RUNNER

## 2026-10-14 — Intro audio sync, subtitles, skip-anywhere, tutorial

**Narration + subtitles (fari's exact assets)**:
- Downloaded `public/audio/intro-narration.mp3` (16.67s, fari's master track).
- Saved `public/subtitles/intro.srt` verbatim (5 cues, 0–19s, exact words/timecodes).
- New `SubtitleManager`: parses SRT, displays bottom-center with fade, synced to
  narration start, toggleable in Settings → Subtitles.
- Cinematic re-synced to narration: search (0–4.5s) → dim (5s) → Shaytan (7s) →
  recitation at 10.5s (narration ducks to 30%) → escape (15s) → gate → runner (~22s).
- **Discrepancy reported**: narration is 16.67s, SRT runs to 19.0s — final subtitle
  lingers 2.3s past narration end; kept verbatim per spec.

**Skip intro**: "PRESS ANY BUTTON TO SKIP INTRO" upper-right during cinematic;
any key/click/tap skips (800ms arming delay protects the opening tap). Aborts
cleanly: stops narration/recitation/subtitles/timers, jumps to runner.

**Tutorial**: first-time "HOW WOULD YOU LIKE TO PLAY?" choice (with/without);
6 steps using real mechanics; SKIP TUTORIAL button; preference saved; Settings →
"Tutorial on next run" replays. Fixed SaveManager to persist hasSeenIntro and
tutorialPreference (were silently dropped).

**Verified**: build clean, 76/76 Vitest, browser QA (choice → cinematic → subtitles
with exact text → skip → RUNNER, zero errors).

## 2026-10-14 — Cinematic library opening rebuild

**New opening sequence** (replaces the desk-reading intro):
- Musliyarkutti now searches between tall bookshelves (walk → reach for book
  → hear sound → turn), instead of reading at the desk.
- Real doorway: the back wall has a genuine 4m opening with wooden frame,
  arch, open door panels, and stone threshold — no more glowing fake plane.
- Courtyard beyond: sunlit ground, palms, academy gate, bright sky backdrop.
- 8-state cinematic: LIBRARY_INTRO → LIBRARY_SEARCH → SHAYTAN_REVEAL →
  RECITATION → LIBRARY_ESCAPE → LIBRARY_EXIT → ACADEMY_GATE → RUNNER.
- 3D Shaytan: the reaper GLB appears with glowing red eyes, smoke, 3 aggressive
  steps, then rushes with camera shake.
- Recitation: fari's supplied `audhu-billahi.mp3` (A'udhu billahi min ash-shaytan
  ir-rajim) plays once during RECITATION with music/SFX ducking.
- Escape: avatar runs through the real doorway into the courtyard, sun brightens,
  through the academy gate, then the runner starts automatically.
- Skip Intro: button on title after first viewing (hasSeenIntro in save).
- Desk moved to the side; shelves trimmed to end at the wall; sign above doorway.

**Technical**: wall-clock timing for cinematic (robust to frame dips); new
'cinematic' camera mode (caller-driven + trauma shake); library.group hidden on
runner start; AudioManager.playRecitation() + duckForRecitation().

**Verified**: full sequence in headless Chromium, all 8 states in order,
library hides, runner renders, zero console errors. 76/76 Vitest pass.

## 2026-10-13 late night — fari's GLB batch integration (6 models)

**New models** (all fari-supplied, all static meshes — no rig/animation):
- Background traffic: stylized fire truck (`bus` slot), police car (`car` slot),
  yellow mustang (new `car_sport` slot, 5th vehicle, spinning wheels).
- Scenery: windmill (new `windmill` slot, ×2 roadside; terrain planes stripped).
- Shaytan selector: Settings → Shaytan → Classic / Reaper / Shaythaan. GLB
  variants lazy-load on first selection, hover as apparitions (side-stalk so
  they never block obstacles), with eye glow + smoke trail + retreat dissolve.
- Manifest: 21 → 25 slots. ModelLoader, tests updated (76/76 pass).

**Asset prep** (documented in GRAPHICS_ASSET_STATUS.md): windmill terrain
removal; shaythaan decimated 212k→38k tris (the 212k version black-screened
with UnrealBloomPass); metalness clamp for env-less PBR. Attribution:
arunangshubanerjee (vehicles), pixellabs (reaper) — Sketchfab; check licenses
before public distribution.

**Held, not integrated**: hero GLB (500k tris, unrigged — can't animate);
girls GLB (500k tris, unrigged — can't walk, over budget).

**Verified**: build clean, 76/76 Vitest, real-browser QA (traffic orientation,
windmill placement, reaper + shaythaan pursuits, settings UI, zero console
errors).

## 2026-10-13 — Graphics overhaul (renderer, materials, character, environment)

**Renderer** (new `src/game/RenderPipeline.js`, `Materials.js`, `ContactShadows.js`):
ACESFilmic tone mapping (exposure ~1.1), sRGB output, warm key directional light
re-aimed to match the visible sun, cool hemisphere ambient, tighter shadow camera
(±28) with bias + normalBias, blob contact shadows under hero/props/buildings,
restrained bloom (High tier only, threshold 0.85 / strength 0.3 — gate lamps,
sun disc), subtle fog that never hides the road. Horizon dark-blob fix verified
still intact (camera far 1000, fog 0x87b5d6); dome below-horizon tint matched to
fogged ground so the seam melts.

**Materials**: Lambert flat shading replaced with a shared PBR surface library
(asphalt, fabric, wood, glass, foliage, gold) — sensible roughness/metalness per
surface; cloth uses sheen so the jubba/lungi read as woven fabric.

**Character** (`PlayerAvatar.js`): proportions re-checked (1.7-unit body, feet
touch ground), jubba as lathe-turned cloth with swaying hem band + gold-button
placket, lungi with wrap-fold bands, thalappav with two-segment waving tail,
PBR fabrics, run cycle with pelvic/shoulder counter-rotation. This is an
honestly-documented stylized procedural stand-in — see GRAPHICS_ASSET_STATUS.md.
No rigged GLB exists; a real GLB-ready pipeline (`ModelLoader.js` +
`public/models/manifest.json`, 21 slots, all `file: null`) is in place so
dropping in a real model later is a one-line manifest change.

**Environment** (`WorldBuilder.js`): canvas-textured road (crisp 3-lane dashes,
yellow edges, asphalt grain, per-lane tire wear), instanced palms (2 draw calls)
with sway, shopfronts with plinth/cornice/pilasters/recessed doors/framed
windows, junctions with advance arrows + SLOW decals + curb cuts, grounding
fixes (floating masjid doors, buried minarets). Zero object/geometry/material
growth over 20k simulated frames.

**Quality tiers** Low/Medium/High (extends the settings toggle): Low = pixelRatio
1, shadows off, bloom off, halved scenery; Medium = ≤1.5, 1024 shadows, full
scenery; High = ≤2, 2048 shadows, restrained bloom, full FX. Low/Medium skip the
post-processing composer entirely.

**Verified**: `npm run build` clean, **76/76 Vitest green** (9 files), browser
playthrough (CDP, real input, `file://` build): title, library, tap → Shaytan,
runner with lane change + jump, score/distance/obstacles/landmarks live, wallet,
**zero console errors**. Docs: `GRAPHICS_AUDIT.md`, `GRAPHICS_ASSET_STATUS.md`
(0 of 21 GLB slots filled — honestly marked, never claimed).

**Honest gaps**: no rigged GLB hero/shaytan/vehicle models exist (the single
biggest remaining upgrade — needs real modeled assets); Shaytan tendril sprites
can look blobby up close; distant skyline blocks are simple; real-GPU frame
times and mobile thermal behavior unmeasured (SwiftShader only); audio still not
aurally verified.

## 2026-10-13 — Integration of the six workstreams (final integration pass)

All six workstreams were integrated into `src/game/Game.js` (plus the
`ObstacleManager` gap patch and three small nit fixes). Architecture preserved;
no rewrites. `npm run build` clean, 46/46 Vitest green, `node smoke.mjs` all
pass, and a full headless-Chromium playthrough (CDP, real input) completed with
**zero console errors / zero warnings** — 15/15 verification checks passed.

### What changed, per area

**Collisions** (`ObstacleManager.js`, `Game.js` crash/stumble wiring)
- Pedestrian crowd: 2–3 respectful figures, 2.1 m hitbox; hit → stumble anim +
  `pedestrian_collision` SFX + restrained shake + warm screen flash. Shield /
  glideboard absorb (consume protection, no stumble). Hitting the crowd while
  already stumbling = crash (vulnerable window).
- Smartphone portal is now a **hazard**: emits `crash` `{kind:'portal'}` →
  shield/glideboard absorb, otherwise game over; blue-cyan shockwave,
  `portal_collision` SFX, shake, cyan flash. Per-obstacle lockout + 0.5 s
  global cooldown. Fairness: portal counts as `block` (never spawns without a
  free lane); `getFreeLanes()` now also treats portal lanes as blocked so
  vouchers/power-ups never spawn there.
- `CONTRACTS.md` updated: portal documented as a hazard (was "bonus, never
  death").

**Shaytan cinematic** (`LibraryScene.js` rewrite, new `ShaytanPursuit.js`)
- Library intro: "SHAMSUL HUDA LIBRARY" sign, bookshelves, warm reading beat.
- Scare: lights dim + flicker, layered smoke/tendrils, glowing eyes, reveal
  roar, lunge at the desk, kitab closed respectfully, apparition dissolves.
- Chase: aisle run with the Shaytan behind the hero, fade to black.
- Street pursuit: the apparition follows behind the player for ~10 s after
  each run starts, surges on near-miss/stumble, then retreats and dissolves.
- Game.js wiring: import/field/construction in `init()` (S1–S3), `start()` in
  `_beginRunner` (S4), per-frame `update(dt, 0, speed)` in `_updateRunner`
  (S5), `reset()` on game-over and quit-to-title (S6/S7), reduced-motion
  propagation (S8).
- Integrator note: PATCHES.md S5's anchor was stale (the speed workstream had
  added a `speed` arg to the camera call) — applied by intent at the same
  site. `sfx`/`audioDuck` handlers were NOT duplicated in S3: both are
  consumed once by `audio.bindEvents()` (see Audio below), so A3 was subsumed
  and the redundant footstep emitter in A4 was skipped (PlayerController
  already emits `footstep` each grounded stride; AudioManager throttles it).

**Academy gate** (new `AcademyGate.js`)
- Pillars + arch spanning all 3 lanes at ~22 m, using the real
  `public/shia-logo.png` (the academy's official logo) on the signboard with
  "SHAMSUL HUDA ISLAMIC ACADEMY / AFFILIATED TO DARUL HUDA ISLAMIC
  UNIVERSITY". Non-colliding, reveal light + subtle camera tilt on
  pass-through, `academy_gate_reveal` event hook.
- Game.js wiring: import/field/construct in `init()`, `update()` in
  `_updateRunner`, `reset()` in `_beginRunner` and `_quitToTitle`.

**World** (`WorldBuilder.js` rewrite)
- Sky/horizon repair: no more dark voids (camera far 1000, fog `0x87b5d6`
  matching the sky-dome horizon). Roadside life: shops/houses, palms, lamps,
  service roads with vehicles, bus stop, benches, turn-arrow road decals,
  junctions. No Game.js changes needed.

**Speed + effects** (`Game.js` `_speed()`, `PlayerController.js`,
`PlayerAvatar.js`, `CameraController.js`, new `EffectsManager.js`)
- `_speed()` = `min(10 + d*0.0125, 28)` (base 10, cap 28). Slide 0.75 → 0.62 s.
- **Fairness patch** (`ObstacleManager.js`): row gap `clamp(34 - speed*0.7, 16,
  34)` → `clamp(40 - speed*0.7, 20.2, 40)` in both `update()` and the
  pre-run seeding in `reset()`. Rationale: at 28 m/s a full jump travels
  19.1 m and a slide 17.4 m; the old 16 m floor would land the player on the
  next row. The new formula preserves the old 0.717 s minimum reaction time
  (20.4 m gap at cap → 0.729 s). Verified by `/tmp/fairness-check.mjs`
  (workstream) across 10–28 m/s.
- `EffectsManager`: pooled, zero-allocation FX (footstep dust, landing
  bursts, streaks, sparkles, portal swirl, glide/jet trails, speed lines),
  event-triggered, honors reduced-motion. Constructed/updated/reset in Game.js.

**Audio + UI** (`AudioManager.js` rewrite, `SaveManager.js`, `src/ui/*`)
- 4-layer mixer: music / ambience / effects / shaytan, each with its own
  GainNode and persisted volume slider (defaults 0.8 / 0.7 / 0.9 / 0.8).
- 20 SFX WAVs in `public/audio/sfx/` + `public/audio/bg-music.mp3`
  (user-supplied — see rights note below); missing/undecodable files fall
  back to procedural synths, never crash. Unknown hook names stay silent.
- Game.js wiring: `audio.bindEvents(events)` in the constructor (single call
  site for `sfx`→play, `statechange`→loop routing, `audioDuck`→duck,
  `footstep`→throttled steps), persisted volumes applied in `init()`,
  `audio.update(dt, flyY)` per frame (jetpack thrust loop). Audio unlocks on
  first gesture; HUD/menus polished, settings screen has 4 live sliders.
- Ambience loop in LIBRARY/SHAYTAN/CHASE, bg-music loop in RUNNER, silence on
  GAMEOVER; `audioDuck` smooth-dips music + ambience during the scare.

**Nit fixes (integrator)**
- `VOUCHER_STORES` / wallet store types: `'HEY LABAN STORE'` →
  `'Hey Laban Store'` (matches the landmark signage). `VoucherWallet.load()`
  normalizes the old casing so existing saves keep working.
- `index.html`: added `<link rel="icon" href="data:,">` to suppress the
  favicon 404 console error on `file://` loads.

**Docs**
- `.work/*-findings.md` (6 workstream reports) merged as appendices into
  `BUG_FIX_REPORT.md`; `.work/` deleted.
- `FEATURE_CHECKLIST.md` updated to reflect the integrated build and today's
  browser verification.

### Verification evidence (2026-10-13, headless Chromium 152, SwiftShader)

- `npm run build` → clean (38 modules; only the pre-existing >500 kB chunk
  warning).
- `npx vitest run` → 46/46 green (incl. voucher 500 m rule + portal fairness
  regression tests).
- `node smoke.mjs` → ALL SMOKE CHECKS PASSED (incl. "no voucher spawned
  below 500m").
- CDP playthrough, `file:///…/dist/index.html`, real mouse + keyboard input,
  15/15 checks passed, **0 console errors, 0 warnings**:
  - LIBRARY → click → SHAYTAN → CHASE → RUNNER transitions
  - `AcademyGate`, `ShaytanPursuit`, `EffectsManager`, `AudioManager` all
    constructed; pursuit phase `pursue` at run start → `retreat` after ~10 s
  - `academy_gate_reveal` fired passing ~22 m (gate renders with the real
    logo); no dark sky voids
  - Arrow keys change lanes, jump works
  - Forced pedestrian collision → stumble, run continues; forced portal
    collision → crash → game-over screen
  - Wallet UI renders "Hey Laban Store" voucher with DEMO banner
- Screenshots refreshed in `preview-screenshots/` (title, shaytan, street,
  gate + chase/pedestrian/portal/gameover/wallet).

### Asset provenance & rights (honest)

- `public/audio/bg-music.mp3` is **USER-SUPPLIED** — rights not verified; do
  not redistribute commercially without checking.
- `public/shia-logo.png` is the official Shamsul Huda Islamic Academy logo,
  used locally on the gate signboard.
- The 20 `public/audio/sfx/*.wav` files are original generated files made for
  this project.
- Named neighborhood shops appear as in-game landmarks per the project spec;
  voucher cards are labeled "DEMO VOUCHER — NOT VALID FOR REAL-WORLD
  PURCHASES" and the build claims no real-world offers or participation.

### Still missing / not verified (honest)

- **Real mobile GPU**: all rendering verified under SwiftShader (software
  WebGL) only; real-device frame rates unmeasured (Low quality toggle exists).
- **Audio**: files are present and wired (20 WAVs + bg-music.mp3, procedural
  fallbacks); headless capture is silent, so nothing was aurally verified.
- **Peak scare framing**: the scare timeline was verified end-to-end (states
  + transitions + sfx hooks), but the timed screenshots caught the early
  phase; the eyes/lunge peak was captured in a follow-up timed run —
  `preview-screenshots/02-shaytan.png` shows the reveal beat.
- The Shaytan surge mid-run event (40–60 s cadence) was not exercised
  end-to-end; logic + unit tests cover it.
- Landmark sign legibility / art direction not formally reviewed.
- Known nits carried over: dark halo around the sun in the sky shader was
  reported fixed by the world workstream; the new street screenshot shows a
  clean gradient — no halo observed.

## 2026-10-14 — Title mascot, thakarppan loading screen, developer credits

**Hero mascot** (fari's request): `musliyarkutti-optimized-compressed.glb`
copied to `public/models/hero-mascot.glb`, new `hero_mascot` manifest slot
(26 slots total). Loads during boot with honest progress, placed in the
library at (2.1, 0, -1.2) in greeting pose, gentle group-level bob/sway
(no fake skeletal animation — the model is static). Visible on the title
screen only; hides during scare/chase/runner, returns on quit-to-title.
Meshopt decoder wired into ModelLoader (the hero GLB uses meshopt
compression; other GLBs don't).

**Thakarppan loading screen**: the old spinner is replaced with a real
0-100% progress bar — UI is created at the start of `Game.init()` (was:
mid-init, so early steps had no progress UI), and each init step reports
honest percentages (textures 15%, renderer 25%, library 40%, models 48%,
mascot 62%, vehicles 78%, wiring 88%, intro 94%, ready 100%). Styled with
"THAKARPPAN LOADING" flair, animated gradient bar, big percentage.

**Developer credits**: new Credits screen (title → Credits button) with
"fadilp5x" in animated rainbow gradient text (per-letter wave + hue slide),
github.com/fadilp5x link, "Built with Three.js + Vite". Respects
reduced-motion.

**Verified**: build clean, 76/76 Vitest, browser QA — loading bar hits 62%
on mascot step, mascot visible on title / hidden in-game, credits rainbow
renders, zero console errors.
