# FEATURE_CHECKLIST.md — MUSLIYARKUTTI: MALABAR RUNNER

Status key: **done** = implemented and verified by automated check (build / unit test /
Node smoke test driving the real modules) **or** visually verified in headless Chromium ·
**complete** = implemented, code-reviewed, not yet runtime-verified · **missing** = not
implemented. Nothing below is claimed without the evidence stated.

## Spec §12 acceptance criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Game builds successfully | **done** | `npm run build` → 38 modules, dist/ emitted, zero errors (only pre-existing >500 kB chunk warning) |
| 2 | Opening shows Musliyarkutti reading in the library | **done** | Screenshot `01-title.png`: 3D library, "SHAMSUL HUDA LIBRARY" sign, bookshelves, tap overlay (see §Browser) |
| 3 | Click/tap initiates the Shaytan event | **done** | Screenshots `02-shaytan.png` (lights dim, silhouette materializes) + `02c-shaytan-lunge.png` (hero reacts, apparition looms); real-click input drove SHAYTAN state |
| 4 | Character escapes through the library entrance | **done** | Screenshot `05-chase.png`: hero in aisle, Shaytan behind, HUD up; CHASE state reached and completed |
| 5 | Street game starts automatically after transition | **done** | CHASE → RUNNER with no second input; screenshot `03-street.png` |
| 6 | Camera follows player from behind | **done** | Screenshots: chase + runner both from behind (see §Browser) |
| 7 | Three lanes work correctly | **done** | Real ArrowLeft/ArrowRight key events → laneIndex 0→1 in live browser; smoke tests clamping/lerp |
| 8 | Jump, slide, collision responses work | **done** | Real ArrowUp → jump arc in live browser; forced pedestrian spawn → stumble (run continues); forced portal spawn → crash → game over; slide 0.62 s unit-covered |
| 9 | Coins collected and counted | **done** | Node smoke: coin patterns spawn; forced pickup → `scoring.coins` increased, `coin` event fired |
| 10 | Score and distance update continuously | **done** | HUD showed SCORE 27 / DIST 27 m live; Node smoke: 233 m over 1500 frames |
| 11 | Power-ups activate and expire | **done** | Node smoke: jetpack raises `flyY`, expiry decays it + emits `powerupEnd`; multiplier/shield/consume paths exercised |
| 12 | Landmarks appear in specified order | **done** | Fixed offsets + smoke event order; "Juicify Kuttikkattur" visible in `04-gate.png`; all 9 landmarks upgraded with dimensional signs |
| 13 | World loops without visible gap | **complete** | Modulo-based recycling in World/Landmark/Obstacle managers. Seam not visually verified |
| 14 | Scenery varies; generation stays fair | **done** | Pooled palms/lamps/clouds/shops/vehicles; `rowIsFair` unit-tested; gap formula widened for 28 m/s cap (see below) — fairness-check script passes 10–28 m/s |
| 15 | Supplied assets load correctly | **done** | Real `public/shia-logo.png` visibly rendered on the gate signboard in `03-street.png` (browser fetch works); 20 WAVs + bg-music.mp3 present in dist/audio/ |
| 16 | Missing asset never crashes game | **done** | try/catch + procedural fallbacks; `AudioManager.play` silent no-op for unknown names; zero console errors in full playthrough |
| 17 | Vouchers NEVER spawn below 500 m | **done** | 10 unit tests incl. `canSpawn` false for 0–499; Node smoke: 0 spawns over 233 m; HUD banner "Vouchers unlock at 500 m" visible |
| 18 | Voucher collection updates wallet | **done** | `voucher` event → `wallet.addVoucher(store)`; verified in Node (list/add) |
| 19 | Redemption prevents reuse | **done** | Unit test: second `redeem()` throws `already redeemed`, code stable; Node smoke re-verified |
| 20 | Saves persist after reload | **complete** | `SaveManager` `mmr.*` keys, validated load, corrupt-data→defaults (5 unit tests); volume keys now merge additively. Real reload persistence not browser-verified |
| 21 | Pause, restart, game-over work | **done** | Portal crash → `08-gameover.png` (score/best/distance/coins, RUN AGAIN / WALLET / MENU); restart path exercised in QA; pause covered by state machine (Esc path tested in prior run) |
| 22 | Usable on desktop and mobile | **complete** | Swipe controls, ≥44 px touch targets, responsive CSS, quality toggle, reduced-motion. Not device-tested |

## Post-launch workstream criteria (2026-10-13 integration)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 23 | Academy gate bridges library → street | **done** | `04-gate.png` + `03-street.png`: pillars/arch at ~22 m with the real academy logo; `academy_gate_reveal` fired on pass-through; non-colliding |
| 24 | Shaytan street pursuit (~10 s) then retreat | **done** | `pursuit._phase`: `pursue` at run start → `retreat` observed live; apparition visible behind player in street shots |
| 25 | Faster game stays fair | **done** | `_speed()` = min(10 + d·0.0125, 28); gap `clamp(40 − speed·0.7, 20.2, 40)` in update + reset seeding; workstream fairness script passes all speeds 10–28 m/s (reaction ≥ 0.717 s, jump/slide inside gap) |
| 26 | 4-layer audio with volume sliders | **done** | `bindEvents` wired once (no duplicate `sfx`/`audioDuck` handlers); 20 WAVs + bg-music.mp3 in dist; persisted per-layer volumes applied on boot; 4 sliders in settings UI |
| 27 | Pedestrian crowd + portal hazard feedback | **done** | Forced spawns in live browser: pedestrian → stumble (shake/flash/SFX hooks, run continues); portal → crash → game over (shockwave/SFX/shake/flash); zero console errors |
| 28 | Voucher store-name casing consistent | **done** | `'Hey Laban Store'` everywhere; `09-wallet.png` shows correct casing; `VoucherWallet.load()` normalizes old `'HEY LABAN STORE'` saves |

## Integration bugs found and fixed (via Node smoke test, original build)

1. **Crash did nothing (game unloseable).** `ObstacleManager` emits `crash`, but
   `Game` only listened for `gameover`, which nothing emitted. **Fixed:**
   `_wireEvents` now handles `crash` → shield absorbs → glideboard absorbs →
   else `gameover` (with `obstacles.destroyAt` on absorb).
2. **Coins never spawned.** `Game._updateRunner` never called
   `collectibles.spawnPatterns()`. **Fixed:** call added before `update()`.
3. **Voucher 120 m interval unenforced.** `recordSpawn` ran only on *collection*,
   so a missed voucher could respawn every frame. **Fixed:** `recordSpawn` at
   spawn time in `_updateRunner`.
4. **Jetpack coin trails never rose.** `collectibles.update` got no `jetpack`
   flag, so `_jetpack` stayed false. **Fixed:** mods now include
   `jetpack: player.flyY > 2`.

## Collision workstream bugs (2026-10-13, see BUG_FIX_REPORT.md)

1. Stumble event infinite recursion (stack overflow, swallowed by bus) — fixed.
2. Smartphone portal fired `'portal'` into the void — now emits `'crash'`
   `{kind:'portal'}`; portal is a hazard, not a bonus.
3. Pedestrian crowd: single figure, undersized hitbox, no feedback — now a
   2–3 figure group with rich stumble feedback / protection absorb / vulnerable
   window crash.
4. Portal fairness accounting wrong (`portal` counted as `free`) — now maps to
   `block`; `getFreeLanes()` treats portal lanes as blocked (integrator).
5. Portal multi-fire — per-obstacle lockout + 0.5 s global cooldown.

## §Browser — verified via headless Chromium 152 (file:// build, SwiftShader)

Full CDP playthrough of the production `dist/` build on 2026-10-13 (second run
after integration; the sandbox blocks localhost navigation, so `file://` with
`--allow-file-access-from-files` was used). Real mouse + keyboard input;
software rendering runs game-time ~40–50× slower than wall-clock, so waits were
extended — a test-environment artifact, not a game bug.

**15/15 checks passed, 0 console errors, 0 warnings:**
- LIBRARY → (real click) → SHAYTAN → CHASE → RUNNER, all transitions observed
- `AcademyGate`, `ShaytanPursuit`, `EffectsManager`, `AudioManager` constructed
- Pursuit `pursue` at run start → `retreat` after ~10 s game-time
- `academy_gate_reveal` fired passing ~22 m; gate shows the real academy logo
- No dark sky voids (smooth gradient + sun glow in street shots)
- ArrowLeft/ArrowRight → lane changes; ArrowUp → jump arc
- Forced pedestrian spawn → `_stumbleT > 0`, state stays RUNNER
- Forced portal spawn → state GAMEOVER (no protection)
- Wallet UI renders "Hey Laban Store" voucher + DEMO banner

**Screenshots** (`preview-screenshots/`): `01-title.png`, `02-shaytan.png`
(reveal beat), `02c-shaytan-lunge.png`, `03-street.png`, `04-gate.png`,
`05-chase.png`, `06-pedestrian-hit.png`, `07-portal-hit.png`,
`08-gameover.png`, `09-wallet.png`.

## Known limitations / partial

- Performance on real mobile GPUs untested; Low quality toggle exists but unmeasured.
- Audio files present and wired (20 WAVs + bg-music.mp3 with procedural
  fallbacks), but headless capture is silent — not aurally verified.
- `public/audio/bg-music.mp3` is user-supplied; rights not verified.
- Shaytan surge mid-run event (40–60 s cadence) not exercised end-to-end; logic present.
- Landmark sign legibility / art direction not formally reviewed.
- `smoke.mjs` (repo root) is the Node QA harness used for the checks above.
- Saves: real reload persistence not browser-verified (SaveManager unit-tested).
- World-loop seam (criterion 13) not visually verified.
