# MODELS_GUIDE.md — Real GLB models for MUSLIYARKUTTI: MALABAR RUNNER

The game renders today with stylized procedural stand-ins (honestly documented in
`GRAPHICS_ASSET_STATUS.md`). This guide is the complete handoff for replacing them
with real rigged GLB models — whether generated in Meshy, Blender, or anywhere else.
No code changes are needed: only files + one manifest edit per model.

## The three priority models

| # | File (exact name) | Reference | What it is |
|---|---|---|---|
| 1 | `public/models/musliyarkutti_running.glb` | boy in white thalappav/jubba/lungi (fari's upload) | Hero — the player character |
| 2 | `public/models/shaytan_chaser.glb` | red devil face (fari's upload) | Full-body Shaytan chaser |
| 3 | `public/models/pedestrian_woman_niqab.glb` | woman in black niqab (fari's upload) | Pedestrian hazard (respectful) |

## Model requirements (give these to whoever/whatever generates them)

- **Format:** glTF 2.0 binary (`.glb`), textures embedded, PBR materials.
- **Pose:** neutral A-pose (arms slightly down/out, legs slightly apart, hands and
  feet separated and unobstructed). NOT a frozen action pose.
- **Rig:** full humanoid skeleton (shoulders, elbows, wrists, hips, knees, ankles
  identifiable). Must include `skins[]` — an unrigged mesh cannot be animated.
- **Scale:** hero ~1.7 units tall; **feet at y = 0** (the game anchors feet to the ground).
- **Facing:** character faces **-Z** (three.js convention used by this game).
- **No:** environment, ground plane, pedestal, extra props, duplicated limbs,
  cropped feet, floating parts.
- **Animations:** embed clips with these exact names (hero): `idle`, `read`, `run`,
  `sprint`, `jump`, `land`, `slide`, `dodge`, `collect`, `stumble`, `gameover`,
  `jetpack`, `glideboard`. Shaytan: `run` (+ `lunge` if available). Pedestrian:
  `walk`, `idle`. Unnamed clips cannot be mapped — name them.
- **Shaytan art direction:** crimson skin, black horns, glowing amber-red eyes —
  frightening but NO gore, blood, or exposed organs. Smoke/dissolve is added by
  the game engine; the mesh itself must be solid geometry.
- **Pedestrian art direction:** respectful, modest, ordinary person — not a villain.

## Integration (3 steps, no code changes)

1. **Validate** the file before touching the game:
   ```bash
   node tools/validate-glb.mjs public/models/musliyarkutti_running.glb --expect-height=1.7
   ```
   It must report rigging present, expected clips named, feet at y≈0. Fix the
   FAIL items it lists — do not integrate a file that fails.

2. **Drop the file** into `public/models/` with the exact filename above.

3. **Point the manifest** at it — in `public/models/manifest.json`, change the
   slot's `"file": null` to the filename, e.g.:
   ```json
   "hero": { "file": "musliyarkutti_running.glb", ... }
   ```
   The `ModelLoader` (`src/assets/ModelLoader.js`) picks it up automatically,
   builds an `AnimationMixer`, and the game's existing `setAnim(name)` /
   `update(dt)` calls drive it. To revert, set `"file"` back to `null`.

Then rebuild and check in a browser:
```bash
npm run build && npx vitest run
# serve dist/ and play: title → tap → Shaytan → street; confirm the new model
# runs, jumps, slides, and stumbles with feet on the ground, facing correctly.
```

## Slot reference (full list in `public/models/manifest.json`)

`hero`, `shaytan`, `academyGate`, `shop_juicify`, `shop_turkish`, `shop_laban`,
`shop_family`, `busstop`, `masjid`, `edumart`, `academy_campus`, `shop_myg`,
`bus`, `auto_rickshaw`, `car`, `motorcycle`, `bicycle`, `pedestrian_a`,
`pedestrian_b`, `palm`, `lampPost` — 21 slots, all currently `file: null`.

## Honesty rule (standing)

`GRAPHICS_ASSET_STATUS.md` is updated **only** when a real file passes the
validator and is visually inspected in the running game. A procedural fallback
is never marked as a completed premium model.
