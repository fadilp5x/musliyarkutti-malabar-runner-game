# GRAPHICS AUDIT — MUSLIYARKUTTI: MALABAR RUNNER
Renderer/materials/lighting workstream. Audited 2026-10-13 against the live
codebase (Vite + three 0.170.0). "Before" reference: `preview-screenshots/`
(`01-title.png` … `07-portal-hit.png`); "after" shots: `preview-screenshots/gfx-after-*.png`
and `preview-screenshots/harness-*.png` (verification harness, same renderer
settings as the game, no gameplay).

Scope note: I own the renderer core, lighting, materials, sky, shadows, bloom
and quality tiers. Character models, Shaytan behavior, and environment geometry
belong to parallel workstreams — those sections below are observations only,
not changes I will make.

## 1. Primitive / low-detail models
- `WorldBuilder.js` props are merged boxes/cylinders/spheres (`_buildPalm`,
  `_buildTree`, `_buildBench`, `_buildBin`, `_buildLamp`, `_buildMotorcycle`,
  `_buildBicycle`, `_buildPed`). Palm fronds are 6 flat double-sided planes
  (`_buildPalm`, ~line 620) — no thickness, visible as paper cutouts up close.
- Landmark buildings (`LandmarkManager.js`) are boxes + prism roofs with
  canvas-texture sign faces. Serviceable at distance; flat up close.
- The avatar and Shaytan are primitive-built (character/shaytan workstreams).
- Not mine to remodel; my PBR pass (section 2) will at least make the
  primitives shade like real surfaces.

## 2. Flat materials
- `WorldBuilder.js` `lambert()` helper (line ~57) returns
  `MeshLambertMaterial` for ~everything lit — per-vertex lighting, zero
  specular response. Merged props use `MeshLambertMaterial({vertexColors:true})`
  (`_mergedMat`, line ~66). Result: the plasticky flat look in `03-street.png`.
- `basic()` (`MeshBasicMaterial`, line ~60) is used for the sun disc (correct —
  it's emissive), sign text faces (fine, keeps text legible), road dashes
  (line ~383) and turn arrows (line ~752). Dashes/arrows as unlit paper-white
  is acceptable but they ignore scene lighting entirely.
- No `MeshStandardMaterial` anywhere in `WorldBuilder.js`; no environment map;
  glass (`LandmarkManager.js` line ~173) is transparent Lambert — no reflection.
- Fix (mine): convert `lambert()`/`_mergedMat` to `MeshStandardMaterial` with
  sensible roughness defaults, add shared `src/game/Materials.js` surface
  library (asphalt 0.95/0, fabric 0.8/0, wood 0.7/0, glass 0.15/0.1,
  foliage 0.9/0, gold 0.35/0.8). Other managers keep their own helpers —
  per-surface tuning there is left to the owning workstreams.

## 3. Lighting / shadows
- `Game.js` init (lines 124–140): `outputColorSpace` never set (defaults to
  sRGB in r152+, so not broken, but implicit); **no tone mapping** — lighting
  values were tuned for raw linear→sRGB output, so highlights clip.
- `WorldBuilder._buildLights` (line ~344): hemi `0xcfe6ff/0x8a7a5f @ 0.95`,
  dir `0xfff1d6 @ 1.7` from `(28, 52, 18)`. Two problems:
  a) The sun sprite sits at `(-90, 95, -300)` (upper-left, far down-road) while
     the key light comes from the right-front — **sun direction and key light
     are incoherent**; shadows fall the "wrong" way relative to the visible sun.
  b) Shadow camera is ±40 units (`left/right/top/bottom`, lines 351–354) —
     far wider than the play area the camera ever sees, so the 2048 map's
     texels are spread thin; `bias -0.0004` with **no `normalBias`** risks acne
     on the big road/ground planes.
- `LibraryScene.js` lights (lines 186–192: ambient 0.35 + warm point 55;
  line ~442: door halo point 40; `_dimLights` at ~603 lerps warm 55→5) are
  indoor and tuned for no-tonemapping — ACES will shift them; not my file to
  retune (shaytan workstream), will verify visually and report.
- No contact shadows anywhere (Shaytan has its own blob in `ShaytanPursuit.js`
  line ~203 — theirs). Hero, peds, parked bikes, landmark buildings all rely
  solely on the shadow map; on Low quality (shadows off) everything floats.
- Fix (mine): ACESFilmic + exposure ~1.1, re-tuned intensities (expect
  ~1.5–2.5× up), key light re-aimed to match the sun sprite, tight shadow box
  (±28), bias + normalBias, quality-scaled 1024/2048, blob contact shadows for
  hero/palms/scenery/landmarks/gate.

## 4. Horizon / dark shape
- The earlier "dark halo around the sun" repair (`_buildSky` comments) is
  intact and sound: opaque sun disc + additive white-alpha-only glow sprite +
  `scene.fog = Fog(0x87b5d6, 40, 160)` in `Game.js` line 135 with camera far
  1000 (line 137) — no regression, will re-verify visually.
- Remaining seam: in `03-street.png` the horizon shows the ground plane's far
  edge as a green band against the dome's below-horizon gray (`0x93a8b5`).
  The dome horizon color equals the fog color, but the *ground* is green and
  unfogged-to-fully-fogged only at 160 — beyond 160 the dome takes over and its
  below-horizon gray ≠ fogged green. Fix (mine): tint the dome's below-horizon
  color toward the fogged ground color so the transition melts.

## 5. Empty shoulders
- Honestly: not empty. Layout comment (`WorldBuilder.js` lines 1–17) documents
  the cross-section and `_buildScenery` populates it: lamps at |x|=5.9, peds
  at 6.6, benches/bins/signs at 7.4, palms 8–17, poles at 8.6, junction kits.
  The `03-street.png` shot shows both sidewalks dressed. No action needed from
  the graphics workstream beyond making what's there shade better.

## 6. Floating / misproportioned objects
- Spot-checked builders: bench (parts span y 0–0.9, base sits at 0),
  bin (0–0.9), lamp pole (0–6.2), power pole (0–8), palm trunk (0–5.4), tree
  (0–~4), dir-sign pole (0–2.8) — all grounded. Bush sphere dips 0.08 under
  grade (reads as planted, fine).
- Pedestrians bob `|sin|*0.07` (`WorldBuilder.update`) — feet leave the ground
  up to 7 cm at the bob peak; minor, reads as a walk bounce, but with blob
  contact shadows added it will look intentional rather than floaty.
- Turn arrow decal at y=0.025 over road (line ~760) — fine, alpha-tested.
- Misproportion: palm fronds (3.0×0.95 m planes) vs 0.16 m trunk — stylized but
  coherent; lamp glow sphere (0.17) reads small against the 6.2 m pole — the
  *light* it implies doesn't exist (no point lights on street lamps; only the
  sun). Lamp glow is unlit-basic pale — at night it would need emissive, but
  this is a day scene; acceptable.
- No floating geometry found that needs a graphics-workstream fix; real
  proportion upgrades belong to the environment workstream.

## 7. Atmospheric depth
- Fog 40→160 is present and the dome horizon matches it — mid-distance reads
  well in screenshots.
- Weak spots: clouds (`fog:false`, z −170…+20, y 30–44) are unfogged bright
  white sprites that pop against the sky gradient; distant service-road traffic
  is fogged but the vehicles are unlit dark boxes that read as silhouettes.
- Fix (mine): keep fog as-is (never hides the road), leave clouds unfogged but
  soften opacity slightly; the PBR + ACES pass will naturally seat distant
  objects better. No fog-range change — gameplay readability of the road wins.

## 8. Shaytan movement quality
- `ShaytanPursuit.js`: 4 smoke-column sprites + 2 eye meshes + tendrils, ~8 s
  pursuit weaving behind the player, then dissolve-retreat. Movement is
  parametric (sine weaves, scripted lunge) — smooth by construction; the
  "quality" risk is repetition over a 10 s beat, which is a behavior/polish
  call for the shaytan workstream, not rendering.
- Rendering-side: eyes are `MeshBasicMaterial 0xff3a10` (line 176) — flat red
  dots; with restrained bloom on High they would glow if their luminance
  crossed the threshold (it won't at ≤1.0 — see §10). Eye glow-up is the
  shaytan workstream's call; I will not touch `ShaytanPursuit.js`.

## 9. Performance bottlenecks
- `renderer.setPixelRatio(min(devicePixelRatio, 2))` for everyone (`Game.js`
  line 127) — a 3× mobile display renders 6× the pixels of Low for no gameplay
  gain. Quality tiers (mine) fix this: Low=1, Medium≤1.5, High≤2.
- Shadow map 2048 re-renders every frame over a ±40 box; most casters are
  static. Tightening the box (mine) is the cheap win; `shadowMap.autoUpdate`
  tricks are rejected — the treadmill moves casters every frame anyway.
- Draw calls are already disciplined: merged-geometry props (1 call per prop),
  cached geometries/materials, pooled particles (`EffectsManager`), fixed
  sprite pools in `ShaytanPursuit`. No per-frame allocation in hot loops.
- Overdraw risks: 6 large cloud sprites, fullscreen additive sun glow
  (120-unit sprite), dust puffs — all modest.
- New cost from this workstream: `UnrealBloomPass` (2 blur targets) on High
  only; `EffectComposer` adds one extra fullscreen blit chain. Low/Medium skip
  the composer entirely (direct `renderer.render`), so the perf floor is
  unchanged from today.
- Honest unknowns I cannot verify here: real-GPU frame times (no device lab —
  headless Chromium is SwiftShader), thermal throttling on low-end Android,
  and whether 2048 shadows + bloom hold 60 fps on the target phones. The
  tier defaults (Medium = 1024, no bloom) are chosen so a mid phone is safe.

## 10. Bloom target note
Restrained bloom (threshold ~0.85, strength ~0.3, radius ~0.4, High only) will
catch: academy gate lamps (`AcademyGate.js` emissiveIntensity → 2.2),
landmark awning glow strips (`LandmarkManager.js` line ~238, emissive),
the sun disc/glow. It will *not* catch Shaytan eyes, portal glow, or coin
glint at their current ≤1.0 luminance — those need emissiveIntensity > 1 from
their owning workstreams if they want bloom. Deliberately not boosted here:
blowing out the whole street to make coins glow would be the opposite of
"restrained".

---

## Appendix: post-implementation verification (2026-10-13)

Implemented: `src/game/Materials.js` (shared PBR cache + surface presets),
`src/game/RenderPipeline.js` (EffectComposer + restrained UnrealBloomPass),
`src/game/ContactShadows.js` (blob shadows, no extra shadow-map passes);
`Game.js` (ACES + sRGB + pipeline + `setQuality` tiers + contact-shadow
wiring), `WorldBuilder.js` (`_buildLights` retune, `_buildSky` horizon melt +
tonemapping/colorspace chunks, `std()` unified with `Materials.js`,
per-tier shadow resolution), `MenuController.js` (Low/Medium/High buttons).

- **Build / tests / smoke:** `npm run build` clean; `vitest` 76/76
  (15 new: materials cache, pipeline config, contact shadows);
  `node smoke.mjs` ALL SMOKE CHECKS PASSED. Zero console errors in every
  headless-Chromium run.
- **Exposure (ACES 1.1):** `harness-high-11.png` vs `03-street.png` — richer
  sky, readable road, no clipping; kept at 1.1 (spec range 1.0–1.15).
- **Sun coherence:** key light re-aimed to the sun sprite; shadows fall
  away from the visible sun (gate/pole shadows toward camera-right).
- **Sun halo:** no dark ring in any after-shot (additive glow intact).
- **Horizon:** dome below-horizon tinted to fog color + tonemapping chunks in
  the sky shader (else the dome would render darker than the ACES fogged
  ground and reopen the seam); `harness-*.png` show a clean melt.
- **Shadows:** ±28 box, bias −0.0002 / normalBias 0.035 — no acne on the road
  in screenshots; 1024 on Medium / 2048 on High verified via `__game` handle.
- **Bloom:** A/B (`harness-bloom-test.png` vs `harness-bloom-off.png`, gate
  lamps cranked to 2.5): subtle halation only around the lamps — restrained
  as specified; ON only on High. Shaytan eyes / portal / coins stay below
  threshold at their current ≤1.0 luminance (owning workstreams' call).
- **Contact shadows:** blobs under hero (follows x, fades on jump), palms,
  lamps, bins, parked bikes, peds, landmark buildings, academy gate —
  visible in `harness-low-11.png` where the shadow map is off.
- **Quality tiers (live game, `window.__game` handle):** boot High →
  `{bloom:true, shadow:2048}`; Medium → `{bloom:false, shadow:1024}`;
  Low → `{castShadow:false, saved:'low'}`; back to High restores
  `{bloom:true, shadow:2048, saved:'high'}`. Settings panel shows
  Low/Medium/High (`gfx-settings.png`).
- **Merge note:** the environment workstream rewrote `WorldBuilder.js`
  mid-task (own `std()` PBR helper, instanced fields, wires, skyline);
  my light/sky/quality edits were re-applied on top and their `std()`
  now delegates to the shared `Materials.js` cache — one instance per
  (color, params) game-wide.
- **Not verifiable here:** real-GPU frame times / thermal throttling
  (SwiftShader only); the library chase shots show ACES looks warm and
  correct indoors, but `LibraryScene` light values are untouched (shaytan
  workstream's file) — worth one glance on a real device.
