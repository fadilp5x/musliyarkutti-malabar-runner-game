# MUSLIYARKUTTI: MALABAR RUNNER

A 3D endless-runner browser game built with **Vite + Three.js** (plain JavaScript ES
modules, no frameworks, no CDN at runtime — fully offline-capable after install).

You play **Musliyarkutti**, a young Malabar Muslim student in white jubba, lungi and
thalappav. The game opens with a narrated cinematic in Shamsul Huda Library where
he searches for a kitab — until Shaytan appears, he recites the prayer, and the
chase bursts out onto a Malabar street for the endless run past nine local landmarks.

## Quick start

```bash
cd musliyarkutti-malabar-runner
npm install     # once — installs three, vite, vitest locally
npm run dev     # play in dev at http://localhost:5173
npm run build   # production build into dist/
npm run preview # serve the production build at http://localhost:4173
npm test        # run the Vitest suite (76 tests)
```

No accounts, no servers, no build-time network calls. SVG assets ship in `public/svg/`.

## Intro, subtitles & audio

- **Narration**: fari's supplied `public/audio/intro-narration.mp3` (~16.7s) plays as the
  master track; the cinematic visuals sync to it. Do not trim or alter it.
- **Subtitles**: exact captions in `public/subtitles/intro.srt` display at their
  specified timecodes, synced to narration start. Toggle in Settings → Subtitles.
- **Recitation**: fari's supplied `public/audio/audhu-billahi.mp3` (A'udhu billahi min
  ash-shaytan ir-rajim, ~3.2s) plays once at the Shaytan reveal. Music and horror
  SFX duck so the recitation stays clear; narration dips to 30% during it.
- **Skip intro**: "PRESS ANY BUTTON TO SKIP INTRO" (upper-right) — any key, click,
  or tap skips to gameplay. The opening tap is protected so it starts the game
  instead of skipping.
- **Note**: narration is 16.67s but the SRT runs to 19.0s; the final subtitle lingers
  ~2.3s past the narration end during the escape — kept verbatim per spec.

## Tutorial

First-time players choose **PLAY WITH TUTORIAL** or **PLAY WITHOUT TUTORIAL** before
the cinematic. The 6-step tutorial uses real game mechanics (lane change → jump →
slide → collect 3 coins → avoid for 8s → Shaytan warning), with a SKIP TUTORIAL
button throughout. The choice is saved; Settings → "Tutorial on next run" replays it.

## How to play

| Input | Action |
|---|---|
| Click / tap / any key | Begin (library) |
| ← / A, → / D (or swipe) | Change lane |
| ↑ / W / Space (or swipe up) | Jump |
| ↓ / S (or swipe down) | Slide (fast-fall if airborne) |
| Esc | Pause |

Dodge buses, auto-rickshaws, handcarts, barriers and puddles; slide under overhead
gates; grab Arabic-letter coins; collect power-ups (jetpack, magnet, ×2 multiplier,
shield, scholar's glideboard, headstarts). Voucher cards unlock at **500 m** and live
in your wallet — redeem them for **demo** codes (not real coupons; see
`VOUCHER_INTEGRATION.md`).

## Project layout

```
index.html                 # canvas + UI shell
public/svg/                # supplied artwork (character ref, library exit, obstacles…)
src/
  main.js                  # boot
  game/
    Game.js                # orchestrator, fixed-step loop, state machine
    GameState.js           # LIBRARY → SHAYTAN → CHASE → RUNNER → PAUSED → GAMEOVER
    PlayerController.js    # lanes, jump physics, slide
    PlayerAvatar.js        # procedural hero rig + 14 animations
    CameraController.js    # damped chase camera + shake
    WorldBuilder.js        # road, lighting, palms, pooled scenery
    LandmarkManager.js     # 9 landmarks, fixed loop order
    ObstacleManager.js     # fair obstacle generation + Shaytan surges
    CollisionSystem.js     # pure AABB helpers (tested)
    CollectibleManager.js  # Arabic-letter coins + voucher cards
    PowerUpManager.js      # 7 power-ups with durations/expiry
    ScoringSystem.js       # pure scoring (tested)
    VoucherManager.js      # 500 m unlock rule (tested)
    VoucherWallet.js       # wallet + demo redemption (tested)
    Missions.js / Inventory.js / SaveManager.js / AudioManager.js
    LibraryScene.js        # opening cinematic
  assets/AssetLoader.js    # SVG → texture pipeline
  ui/                      # HUD, menus, wallet/settings/missions/inventory, CSS
tests/                     # Vitest suite (voucher rule, redemption, scoring, saves)
ASSET_MANIFEST.md          # supplied-artwork inventory
CONTRACTS.md               # inter-module API contracts
```

Saves live in LocalStorage under `mmr.*` keys (high score, coins, settings, wallet,
missions, inventory) with validation and a reset option in Settings.

## Tech notes

- Treadmill runner: the player stays near z=0 while the world streams toward +Z.
- Fixed-timestep simulation (120 Hz accumulator) with per-frame rendering.
- Procedural Web Audio SFX (no audio files); mute in Settings.
- Quality toggle (High/Low) for mobile; reduced-motion support.
- Contract details: see `CONTRACTS.md`. Honest status: see `FEATURE_CHECKLIST.md`.

## Multiplayer race (local preview)

The multiplayer race uses the original version 2 runner scene. Choose **Multiplayer** on the title screen to create a room, then share its six-character code. Friends join from their own devices; the host starts the shared countdown. Rooms support 2–8 runners, with live distance and coin standings. The longest run wins, with coins as the tie-breaker.

Start the local server with `npm run dev -- --host 0.0.0.0 --port 5174` and open `http://localhost:5174/`. Devices on the same Wi-Fi can use this computer's network address with port `5174` (for example, `http://192.168.1.42:5174/`).
