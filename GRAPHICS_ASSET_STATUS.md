# GRAPHICS_ASSET_STATUS.md — MUSLIYARKUTTI: MALABAR RUNNER

Generated 2026-10-13 (graphics overhaul — character technical-art workstream).
Updated 2026-10-13 late night (fari's GLB batch integration).

## Plain statement (updated)

**6 of 25 slots now point at real, fari-supplied GLB files** (all verified
to exist and load; see "Oct 13 late-night integration" below). The remaining
19 slots are still `file: null` with procedural fallbacks. **No rigged/
animated character GLB exists** — all six integrated models are static meshes
(no skeleton, no animation clips), used only where a static mesh is correct
(vehicles, scenery) or as hovering apparitions (Shaytan variants).

## Oct 13 late-night integration — fari's supplied GLBs

| Slot | File | Tris | Status |
|------|------|------|--------|
| `bus` | `models/fire-truck.glb` | ~10.8k | ✅ Static stylized fire truck in background traffic (replaces procedural bus) |
| `car` | `models/police-car.glb` | ~9.9k | ✅ Static stylized police car in background traffic (replaces procedural car) |
| `car_sport` | `models/mustang.glb` | ~10.5k | ✅ Yellow mustang, added as 5th traffic vehicle; separate wheel nodes spin |
| `windmill` | `models/windmill.glb` | ~28.6k | ✅ Roadside landmark ×2; giant terrain planes stripped (asset prep) |
| `shaytan_reaper` | `models/shaytan-reaper.glb` | ~50k | ✅ Selectable Shaytan variant (Settings → Shaytan → Reaper); hover apparition |
| `shaytan_alt` | `models/shaytan-alt.glb` | ~38k | ✅ Selectable Shaytan variant (Settings → Shaytan → Shaythaan); decimated 212k→38k |

Asset prep notes (all documented, reversible, originals kept):
- Windmill: 4 giant terrain Plane nodes removed via script (`public/models/windmill.glb` is the cleaned copy; fari's original untouched in `workspace/user/files/`).
- Shaythaan: decimated 212k→38k tris with three.js SimplifyModifier — the 212k version caused a black-screen artifact with UnrealBloomPass (High quality). 38k renders correctly. Original archived at `_archive/models/shaytan-alt-orig-212k.glb`, outside the deployment publish directory.
- Material normalization: extreme metalness (>0.6, no envmap) clamped to 0.3 at load — fully-metallic PBR renders black without environment lighting.
- Attribution: Sketchfab downloads — fire truck / police car by arunangshubanerjee, reaper by pixellabs. Check licenses before public distribution.

Held (NOT integrated — honest reasons):
- Hero (`musliyarkutti-optimized-compressed.glb`): 500k tris, unrigged static. Cannot run/jump/slide. Needs rigging + optimization.
- Girls (`girls_1_0syo.glb`): 500k tris, unrigged static. Cannot walk; far over poly budget for a pedestrian.

## Previous statement (graphics overhaul pass)

**No rigged GLB hero/shaytan/vehicle models exist anywhere in this repo, and
none were created in this pass.** Every slot in `public/models/manifest.json`
has `file: null`. What the game renders today for every one of these slots is
a procedural fallback. A fallback is **never** marked below as a completed
premium model — the "Genuinely integrated?" column is `no` for all 21 rows,
and it stays `no` until a real GLB file lands in `public/models/` and the
manifest points at it.

## What this pass actually delivered

1. **A real GLB-ready loading pipeline** — `src/assets/ModelLoader.js`
   (GLTFLoader-based) + `src/assets/manifest.js` (pure, unit-tested manifest
   parsing and anim→clip mapping) + `public/models/manifest.json` (21 slots,
   all `file: null`, each naming its fallback). When a real GLB appears,
   **only `manifest.json` changes** — no code edits. `loadModel(slot)`
   resolves to the GLB with an `AnimationMixer`, `getMixer(slot)` /
   `playClip(slot, clip, {crossfade})` drive clips, and the returned handle
   exposes the same `setAnim(name)` / `update(dt)` API the game already uses,
   so swapping the procedural hero for a GLB hero is a one-line change at the
   call site. `statusReport()` produces this table's data honestly from the
   manifest (`integrated: true` only when a real GLB was loaded).
2. **An honestly-documented stylized procedural hero upgrade** — see below.
   It is a better stand-in, not a premium model.

## Hero upgrade (PlayerAvatar.js) — what genuinely improved

- **Proportions re-checked**: hips pivot 0.95, leg 0.90 (thigh 0.44 / knee /
  shin 0.42 / foot, sole ~0.02), head centre 1.47, turban crown ~1.76 —
  ~1.7-unit body, natural limb ratios, feet actually touch the ground.
- **Jubba as shaped cloth**: lathe-turned profile (shaped shoulder, fitted
  waist, flared skirt to the knees) instead of a plain cone, plus a separate
  **hem band** that sways with speed/stride, and a curved front placket with
  gold buttons.
- **Lungi as wrapped cloth**: visible fold bands (tilted wrap rings), a wrap
  overlap seam at the back, kept the grey kara border at the hem.
- **Thalappav refined**: three wrap tori with natural tilt variation, dome
  cap, gold ring, nape knot — and the tail is now a **two-segment hinge**
  (root + tip) so it waves instead of swinging as one stiff plane.
- **PBR fabrics**: `MeshPhysicalMaterial` with sheen on jubba/lungi/turban so
  cloth reads as woven fabric under the lights, with roughness variation
  between garments.
- **Run cycle**: still driven by `runPhase`/`runRate` from PlayerController
  (footsteps stay synced), now with pelvic counter-rotation, shoulder
  counter-rotation, forearm pump, and cloth (hem + two-piece tail) keyed to
  stride phase and real speed.
- **Face**: brows, nose, kept the readable-from-behind identity (white wrap +
  tail silhouette) for the chase camera.
- Constraints kept: exact `AVATAR_ANIMS` names, `setAnim`/`update`/`reset`
  API, all `parts` fields, `-Z` facing. PlayerController, Game.js,
  LibraryScene, ShaytanPursuit untouched. No boxes-as-character anywhere.

## Asset table — every required model

| Slot | GLB file | File present? | Genuinely integrated as premium model? | Fallback in use |
|---|---|---|---|---|
| `hero` | missing | no | **no** | PlayerAvatar — stylized procedural stand-in (`src/game/PlayerAvatar.js`) |
| `shaytan` | missing | no | **no** | ShaytanPursuit cinematic smoke apparition (`src/game/ShaytanPursuit.js`) |
| `academyGate` | missing | no | **no** | AcademyGate procedural gate (`src/game/AcademyGate.js`) |
| `shop_juicify` | missing | no | **no** | LandmarkManager procedural shopfront (`src/game/LandmarkManager.js`) |
| `shop_turkish` | missing | no | **no** | LandmarkManager procedural shopfront |
| `shop_laban` | missing | no | **no** | LandmarkManager procedural shopfront |
| `shop_family` | missing | no | **no** | LandmarkManager procedural shopfront |
| `busstop` | missing | no | **no** | LandmarkManager procedural bus stop |
| `masjid` | missing | no | **no** | LandmarkManager procedural masjid |
| `edumart` | missing | no | **no** | LandmarkManager procedural office |
| `academy_campus` | missing | no | **no** | LandmarkManager procedural campus |
| `shop_myg` | missing | no | **no** | LandmarkManager procedural shopfront |
| `bus` | missing | no | **no** | ObstacleManager SVG-textured procedural bus (`src/game/ObstacleManager.js`) |
| `auto_rickshaw` | missing | no | **no** | ObstacleManager SVG-textured procedural auto-rickshaw |
| `car` | missing | no | **no** | WorldBuilder background-traffic car (`src/game/WorldBuilder.js`) |
| `motorcycle` | missing | no | **no** | none yet — slot reserved, no procedural variant built |
| `bicycle` | missing | no | **no** | none yet — slot reserved, no procedural variant built |
| `pedestrian_a` | missing | no | **no** | WorldBuilder procedural sidewalk pedestrian (`src/game/WorldBuilder.js`) |
| `pedestrian_b` | missing | no | **no** | WorldBuilder procedural sidewalk pedestrian |
| `palm` | missing | no | **no** | WorldBuilder procedural coconut palm |
| `lampPost` | missing | no | **no** | WorldBuilder procedural street lamp |

Hero animation clips (`idle/read/run/sprint/jump/land/slide/dodge/collect/
stumble/gameover/jetpack/glideboard`): all `file: null` — no clip GLBs exist;
the pose-table animation in PlayerAvatar.js is the active fallback for all of
them. `sprint` and `land` are reserved clip slots with no runtime anim yet.

## Real GLB assets still needed (explicit list)

To retire the fallbacks, each of these must be supplied as a real file under
`public/models/` and registered in `public/models/manifest.json`:

1. **Rigged hero GLB** (`hero`) — the single most-needed asset. Must face
   `-Z`, ~1.7 units tall, feet at y=0, with clips named per the manifest
   animations map (idle/read/run/sprint/jump/land/slide/dodge/collect/
   stumble/gameover/jetpack/glideboard), or one GLB per clip.
2. **Shaytan GLB** (`shaytan`) — modeled apparition to replace the smoke
   effect (must stay frightening without graphic violence, per the spec).
3. **Academy gate GLB** (`academyGate`).
4. **Shop/landmark GLBs** — `shop_juicify`, `shop_turkish`, `shop_laban`,
   `shop_family`, `busstop`, `masjid`, `edumart`, `academy_campus`,
   `shop_myg` (keep the specified names/colors; do not invent offers,
   addresses, or branding).
5. **Vehicle GLBs** — `bus`, `auto_rickshaw`, `car`, `motorcycle`, `bicycle`.
6. **Pedestrian GLBs** — `pedestrian_a`, `pedestrian_b` (respectful,
   modest representation, per the spec).
7. **Props** — `palm` (coconut palm), `lampPost` (street lamp).

Until then: 0 of 21 slots have a real model, 0 are genuinely integrated, and
this file must not be edited to claim otherwise.
