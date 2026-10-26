# CONTRACTS.md — module APIs for MUSLIYARKUTTI: MALABAR RUNNER

Authoritative inter-module contracts. Every workstream reads this first and implements
exactly these APIs. No CDN at runtime: `three` is imported from local node_modules
(`import * as THREE from 'three'`). ES modules throughout. Game must run offline after
`npm install` (SVG assets load from `assets/svg/` via fetch → blob, see AssetLoader).

## World model (treadmill runner)

- Forward direction is **-Z**. The player rig stays at **z = 0**; every world entity
  (obstacles, coins, scenery, landmarks) moves **+Z** at the current speed.
- **1 world unit = 1 metre.** `distanceM += speed * dt` each frame.
- Lanes: `LANES = [-2.4, 0, 2.4]` (x positions). `laneIndex` 0|1|2.
- Player collision box (world coords, z≈0): width 0.7 (x), depth 0.6 (z), height
  1.7 standing / 0.85 sliding. Jump uses real physics: `vy0 = 8.2`, `g = -24`.
- Speed: `speed = min(8 + distanceM * 0.012, 24)` metres/sec. Do NOT exceed 24.
- Obstacles spawn at z = -130, despawn at z > 12. Obstacle row gap:
  `gap = clamp(34 - speed * 0.7, 16, 34)` metres between rows.
- Camera: behind player at approx (playerX*0.55, 4.2, 7.5), lookAt (playerX*0.7, 1.2, -12),
  damped (lerp factor ~5/s). FOV 60.

## Game states (GameState.js)

`STATES = { LOADING, LIBRARY, SHAYTAN, CHASE, RUNNER, PAUSED, GAMEOVER }`
- `LIBRARY`: hero sits reading at desk. Any tap/click/key → `SHAYTAN`.
- `SHAYTAN`: ~3.5s scripted scare (shaytan sprite appears, hero reacts, stands).
- `CHASE`: ~5s scripted run through shelves → doorway → crossfade to street.
- `RUNNER`: endless gameplay. Auto-entered from CHASE (no second button).
- `PAUSED` remembers `prevState` (CHASE or RUNNER). `GAMEOVER` shows panel.
- `Game.state` holds current; `game.setState(s)` emits `events.emit('statechange', s)`.

## Event bus

`game.events = { on(evt, cb), emit(evt, data) }` — tiny pub/sub, no deps.
Events: `statechange, coin(n), nearmiss, powerup(type), powerupEnd(type), voucher(store),
hit(kind), stumble, gameover, pause, resume, redeem, mission`.

## Input actions

`game.input.onAction(name)` where name ∈ `left, right, jump, slide, pause, tap`.
Engine maps: ArrowLeft/A, ArrowRight/D, ArrowUp/W/Space, ArrowDown/S, Esc, click/touch,
mobile swipes (left/right/up/down). During LIBRARY any action → start SHAYTAN.

## Game.js (engine owns)

```js
class Game {
  constructor(canvas)
  async init()          // AssetLoader.loadAll, build scenes, show LIBRARY
  setState(s)
  loop with fixed-step accumulator (1/120) + render
  // public handles:
  state, events, input, audio (AudioManager), save (SaveManager),
  camera (CameraController), player (PlayerController), avatar (PlayerAvatar),
  world (WorldBuilder), landmarks (LandmarkManager), obstacles (ObstacleManager),
  collectibles (CollectibleManager), powerups (PowerUpManager),
  scoring (ScoringSystem), vouchers (VoucherManager), wallet (VoucherWallet),
  missions (Missions), inventory (Inventory), ui (UI root: hud, menus, walletUI)
}
```

## PlayerController.js

```js
class PlayerController {
  constructor(avatar, events)
  laneIndex = 1; x = 0 (lerp to LANES[laneIndex] at 12/s)
  y = 0; vy = 0; jumping = false
  sliding = false; slideT = 0 (0.75s)
  flyY = 0          // set by PowerUpManager for jetpack (target hover height)
  update(dt, speed)
  doLeft(), doRight(), doJump(), doSlide()
  stumble()         // brief slow, plays anim, no death
  getBox() -> { x0,x1, y0,y1, z0,z1 }   // y0 = y + flyY
  reset()
}
```
Jump only if grounded and not sliding. Slide cancels jump? Slide while airborne =
fast-fall (vy = -18). Lane change during slide keeps sliding.

## PlayerAvatar.js

```js
class PlayerAvatar {
  constructor(scene)            // builds procedural rig, adds group at (0,0,0)
  group: THREE.Group
  setAnim(name)                // idle|reading|run|jump|slide|left|right|collect|
                               // stumble|fall|jetpack|glide|standup|react
  update(dt)
  reset()
}
```
Rig per `assets/svg/character_reference.svg`: white jubba (ivory #FAF7F0), white lungi
with grey kara border (#697682), wrapped white thalappav, warm brown skin (#C97E50).
Separate pivots: hips, torso, head, armL/armR (shoulder pivots), legL/legR (hip pivots).
Face: simple dark eyes on head sphere. Run cycle = sinusoidal limb swings in update().

## CameraController.js

```js
class CameraController {
  constructor(camera)
  update(dt, playerX, mode)   // mode: 'library'|'chase'|'runner' — damped follow
  shake(amount)               // trauma-based shake, decays
}
```

## WorldBuilder.js

```js
class WorldBuilder {
  constructor(scene, events, assetLoader)
  LAP = 900
  update(dt, speed, distanceM, quality)  // treadmill segments, palms, lamps, sky
  reset()
  setQuality('high'|'low')
}
```
Road: recycled 30-unit segments, 3 lanes with dashed markings, sidewalks, fog,
hemisphere+directional light with shadows (low quality: shadows off). Scenery pooled.

## LandmarkManager.js

```js
class LandmarkManager {
  constructor(scene, events, assetLoader)
  // 9 landmarks, fixed order, each { id, name, offset } offsets 0..800 step ~100:
  // juicify "Juicify Kuttikkattur" (cyan/blue glass), turkish "Turkish Corner"
  // (dark + warm-yellow letters), laban "HEY LABAN STORE" (blue), family
  // "Family Collections" (clothing storefront), busstop "Bus Stop" (shelter+bench),
  // masjid "Masjid" (respectful dome+minaret exterior, NO interior), edumart
  // "Edumart Office" (yellow sign), academy "Shamsul Huda Islamic Academy" (campus gate),
  // myg "MyG Store" (orange logo, electronics)
  update(dt, speed, distanceM)  // z from lap-relative offset; recycle per lap
}
```
Signage text via CanvasTexture. Do NOT invent offers/addresses/branding.

## ObstacleManager.js

Obstacle types (SVG texture on plane + invisible 3D collider box):
```js
// { type, svg:'obstacle_low_barrier.svg', w,h (plane size), box:{w,h,d}, kind }
low_barrier   // kind 'jump'  — crash if player y0 < 0.55 on overlap
puddle        // kind 'stumble'— box h 0.25; overlap → stumble, never death
overhead_gate // kind 'slide' — crash if player height (y1-y0) > 1.1 on overlap
handcart      // kind 'block' — crash on overlap
bus           // kind 'block' — crash on overlap (tall)
auto_rickshaw // kind 'block' — crash on overlap
smartphone_portal // kind 'portal' — HAZARD: overlap → emit('crash', {kind:'portal'});
               // shield/glideboard absorb one hit (consuming protection, destroying
               // nothing further); otherwise crash ends the run. Blue-cyan shockwave
               // + portal_collision sfx + shake + flash on impact. Fairness: counts
               // as 'block' (never spawns without a free lane; getFreeLanes treats
               // portal lanes as blocked).
pedestrian    // kind 'stumble'— procedural respectful figures; overlap → stumble
shaytan_surge  // scripted event: warning 2s (shaytan_warning.svg), then shadow walls
               // in 2 random lanes, 1 lane free; overlap → crash unless shield
```
```js
class ObstacleManager {
  constructor(scene, events, assetLoader, rng=Math.random)
  obstacles: [{ type, lane, z, group, box, kind, passed, w,h }]
  update(dt, speed, distanceM, playerBox, mods) // mods: {shield, jetpack}
  reset()
}
```
Fair generation: rows every `gap`; each row pattern leaves ≥1 free lane.
Never spawn shaytan_surge before 300m; min 40s between surges.
Collision: AABB overlap of playerBox vs obstacle box (world z at obstacle.z).
Shield absorbs one crash (consumes shield, destroys obstacle, brief slow).
Jetpack (flyY>2): skips ground obstacles (jump/block/puddle/pedestrian) but NOT
overhead_gate? Flying into gate = crash. Portal is a hazard while flying too.
Near-miss: obstacle with kind jump/block/slide passes z>1.5 while player in adjacent
lane (|lane diff|==1) and no collision → emit('nearmiss') once.

## CollisionSystem.js

```js
// pure helpers, no three:
export function aabbOverlap(a, b) -> boolean
export function rowIsFair(cells) -> boolean  // cells: 3 lanes, each 'free'|'jump'|'slide'|'block' — fair if some lane passable
```

## CollectibleManager.js (coins)

Arabic-letter gold coins (CanvasTexture letters: ['ب','ت','ث','ن','م','س','ع']).
```js
class CollectibleManager {
  constructor(scene, events, assetLoader)
  coins: [{ lane, z, y, taken }]
  spawnPatterns(distanceM)   // lines, arcs, zigzag; y=1 or y=3.4 during jetpack trails
  update(dt, speed, playerBox, mods) // mods: {magnet:boolean}
  reset()
}
```
Coin value handled by ScoringSystem via events.emit('coin', n).

## PowerUpManager.js

Types: `jetpack` (8s), `magnet` (10s), `multiplier` (12s, ×2), `shield` (15s or 1 hit),
`glideboard` (until 1 hit, shows board under feet), `headstart` (instant +150m score-dist),
`superheadstart` (instant +400m).
```js
class PowerUpManager {
  constructor(scene, events)
  active = {}               // type -> remaining seconds
  update(dt, speed, distanceM, player, avatar)
  trySpawn(distanceM)       // every 90–160m in a free lane (obstacles tell free lanes)
  collect(type)
  has(type) -> boolean
  reset()
}
```
HUD reads `powerups.active`. Expiry emits `powerupEnd`.

## ScoringSystem.js (PURE — no three, no DOM; unit-tested)

```js
class ScoringSystem {
  constructor()
  score=0; coins=0; distanceM=0; best=0; nearMisses=0
  multiplier=1               // x2 while multiplier powerup active
  addDistance(dm)            // score += dm * 1 * multiplier
  addCoins(n)                // coins+=n; score += n*10*multiplier
  addNearMiss()              // nearMisses++; score += 25*multiplier
  addBonus(pts)              // score += pts*multiplier
  resetRun()                 // zero run stats, keep best
  commitBest()               // best = max(best, score)
}
```

## VoucherManager.js (PURE — unit-tested)

```js
export const VOUCHER_UNLOCK_M = 500;
export const VOUCHER_STORES = ['Juicify Kuttikkattur','Turkish Corner','HEY LABAN STORE','Family Collections','Edumart','MyG Store'];
// NOTE: never vouchers for masjid, bus stop, academy.
class VoucherManager {
  constructor(rng=Math.random)
  lastSpawnM = -1e9
  canSpawn(distanceM)        // distanceM >= 500  (THE rule — game logic)
  shouldSpawn(distanceM)    // canSpawn && (distanceM - lastSpawnM) >= 120 && rng() < 0.45
  recordSpawn(distanceM)
  reset()
}
```

## VoucherWallet.js (PURE — unit-tested)

```js
class VoucherWallet {
  constructor()
  items = []  // {id, store, type, status:'available'|'redeemed', collectedAt, code:null}
  addVoucher(store)          // type derived from store category
  list() -> items copy
  redeem(id) -> code          // throws Error('already redeemed') if redeemed;
                             // code = 'MMR-DEMO-' + 8 chars; stored on item; never regenerated
  serialize() / load(data)   // validated
  reset()
}
```
Redemption UI must label: "DEMO VOUCHER — NOT VALID FOR REAL-WORLD PURCHASES".

## Missions.js (PURE)

```js
class Missions {
  constructor()  // defs: [{id:'run500', name:'Run 500 m in one run', target:500, reward:50}, ...]
  progress = {}  // id -> current
  updateFromEvents(events) or update(stats)
  claim(id) -> reward coins or null
  serialize()/load()
}
```
Keep 4 missions: run 500m, collect 100 coins, 10 near-misses, collect 1 voucher.

## Inventory.js (PURE)

Boards: [{id:'palm', name:'Palm Board', cost:0}, {id:'gold', name:'Gold Board', cost:500}, {id:'cyan', name:'Cyan Board', cost:1500}].
```js
class Inventory { owned=['palm']; selected='palm'; buy(id, coins)->bool; select(id); serialize()/load() }
```

## SaveManager.js (no three; works with stubbed localStorage in tests)

Keys: `mmr.highscore, mmr.bestDistance, mmr.coins, mmr.settings, mmr.vouchers, mmr.wallet, mmr.missions, mmr.inventory`.
```js
class SaveManager {
  constructor(storage = globalThis.localStorage)
  load() -> validated object with defaults
  save(patch)
  reset()
}
```
Validate types on load; corrupt → defaults. Never throws.

## AudioManager.js (no deps)

WebAudio, lazy AudioContext (resume on first gesture).
```js
class AudioManager {
  constructor()
  enabled = true (persisted in mmr.settings)
  play(name)  // coin|jump|slide|hit|powerup|voucher|click|nearmiss|shaytan|gameover|start
  setEnabled(b)
}
```
Procedural: oscillators + noise envelopes. `play` no-ops when disabled or no ctx.

## AssetLoader.js

```js
class AssetLoader {
  constructor()
  async loadSVGTexture(path, pxW, pxH) -> THREE.Texture
    // fetch SVG text → set explicit width/height attrs from viewBox →
    // blob URL → TextureLoader.load → texture.colorSpace = SRGBColorSpace
  async loadAll() -> { obstacle_overhead_gate, obstacle_puddle, ... } // keyed by file base name
  makeTextSprite? — no, landmarks do their own canvas textures.
}
```

## UI (all DOM built programmatically — engine only provides index.html shell)

- `src/ui/UI.js`: builds `#ui` root, owns screens, `show(name)`, `hud.update(snap)`.
- `src/ui/HUD.js`: score, distance m, coins, multiplier badge, powerup timers, pause btn,
  voucher wallet button + "Vouchers unlock at 500 m" hint (hide after unlock).
- `src/ui/MenuController.js`: screens — loading, tap-to-begin hint, pause, gameover
  (score/best/coins/restart), settings (sound, reduced motion, quality, reset progress),
  missions, inventory, wallet.
- `src/ui/VoucherWalletUI.js`: wallet list + redeem flow with DEMO disclaimer.
- CSS: `src/ui/styles.css` — navy/ivory/gold/cyan, mobile responsive, reduced-motion
  media query respected + `settings.reducedMotion` disables shakes/particles.
- HUD must never cover the road centre-bottom; keep to top bar + small corner buttons.

## LibraryScene.js (engine workstream)

Procedural 3D library: wood shelves with book spines (instanced boxes), desk, open
kitab (two page planes), warm point light, doorway arch (BoxGeometry frame) with
`location_library_exit.svg` used as a framed poster/reference texture on the wall.
Timeline: LIBRARY (hero `reading` at desk, "TAP ANYWHERE TO BEGIN" overlay) →
SHAYTAN (lights dim, `shaytan_disappear.svg` texture plane looms + red eyes,
hero `react`→`standup`, kitab placed on desk) → CHASE (camera behind hero, hero
`run` between shelf rows toward glowing doorway) → fade → street RUNNER starts.
Shaytan uses smoke particle sprites (canvas radial texture), no gore.

## Tests (tests/*.test.js, vitest, node env)

- `tests/voucher.test.js`: canSpawn false for 0..499 (sample), true ≥500;
  shouldSpawn respects min interval & never below 500 over simulated 2000m run;
  redeem returns code; second redeem throws; code stable.
- `tests/scoring.test.js`: distance/coin/nearmiss math, multiplier, reset/commit best.
- `tests/save.test.js`: corrupt JSON → defaults; validation of types; reset.
- `tests/collision.test.js`: aabbOverlap cases; rowIsFair cases.
- Pure modules MUST NOT import 'three' or DOM. SaveManager accepts injected storage.

## File map (who owns what)

- engine: index.html, src/main.js, src/game/Game.js, GameState.js, CameraController.js,
  InputManager.js, SaveManager.js, AudioManager.js, LibraryScene.js,
  src/assets/AssetLoader.js, src/ui/styles.css (base; UI workstream may append via edit? NO —
  engine creates styles.css shell; UI workstream creates src/ui/screens.css and UI.js imports it)
- player: src/game/PlayerAvatar.js, PlayerController.js
- world: src/game/WorldBuilder.js, LandmarkManager.js, ObstacleManager.js,
  CollisionSystem.js, CollectibleManager.js, PowerUpManager.js, ScoringSystem.js,
  VoucherManager.js, VoucherWallet.js, Missions.js, Inventory.js
- ui+tests: src/ui/UI.js, HUD.js, MenuController.js, VoucherWalletUI.js, screens.css,
  tests/*.test.js

Cross-imports allowed only via the APIs above. `Game.js` wires everything.
