# GLB Asset Sourcing Research — MUSLIYARKUTTI: MALABAR RUNNER

Researched 2026-10-13 (evening, IST) to support the in-flight graphics overhaul.
Goal: map the 21 `public/models/manifest.json` slots (all currently `file: null`,
per GRAPHICS_ASSET_STATUS.md) to **real, verifiable, license-clean** GLB sources —
and name the gaps plainly instead of inventing them.

**Rule kept throughout:** nothing here is claimed as integrated. A model counts
only when a real GLB lands in `public/models/` and the manifest points at it.

## Verified CC0 sources (license read on source pages, not snippets)

### 1. Quaternius — rigged + animated characters
- https://quaternius.com/packs/rpgcharacters.html
- CC0, per-pack license statement. Newer packs ship **glTF** alongside FBX/OBJ/Blend.
- "Universal Animation Library" (1 & 2): **250+ animation clips on a single
  humanoid rig** — this is the realistic path to idle/run/sprint/jump/slide/dodge
  clips for the hero without re-rigging.
- Measured profile (third-party audit, Sep 2026): base character ~13,700 tris,
  ~2 MB per model — heavier than Kenney/KayKit; fine for one hero.
- Download routes via itch.io (free tier); per-model mirrors on poly.pizza/u/Quaternius.
- Also confirmed in production use: CC0 Universal Animation Library redistributions
  with 46+ clips on one rig (github.com/J-Ponzo/gltf-universal-animation-library).

**Hero strategy recommendation:** use a Quaternius base humanoid as the *rig*, and
keep the existing procedural cloth work (lathe-turned jubba, wrapped lungi with
kara border, three-wrap thalappav with two-segment tail — see
GRAPHICS_ASSET_STATUS.md) layered on it. Rationale: **no CC0 rigged character in
Muslim/Malabar attire (jubba + lungi + thalappav) was found anywhere.** Dressing
a CC0 rig in the game's own cloth keeps fari's character identity intact and
avoids fabricating a "premium rigged hero" that doesn't exist.

### 2. KayKit — stylized city, vehicles, props, animated characters
- https://github.com/KayKit-Game-Assets (official repos) + itch.io
- CC0 verified ("free for personal and commercial use, no attribution required").
- Measured profile: chunky stylized low-poly, one gradient atlas per pack,
  small files (~33 KB median), dungeon walls 4 m — coherent family.
- "Adventurers" pack: 5 rigged + animated characters, ~76 animations each,
  ~6,500 tris — alternative/backup pedestrian rigs.
- City/vehicle packs cover **cars** (also used in production: KayKit GLB car
  packs in a Three.js city build, github.com/sasimis/gtathens).
- Direct download: `https://codeload.github.com/KayKit-Game-Assets/<repo>/zip/refs/heads/main`.

### 3. Kenney — cars, city kits, nature, street props
- https://kenney.nl — site-wide CC0 (kenney.nl/support).
- Car Kit 3.1, City Kit, Nature Kit (~330 models), street props; GLB/FBX/OBJ per pack.
- Measured profile: lowest triangle budget (trees median 166 tris, rocks 52),
  flat material colors or one shared colormap.png — cheapest to run.
- Direct zip recipe: `curl -s https://kenney.nl/assets/<slug> | grep -oE
  'https://kenney\.nl/media/pages/assets/[^"]+\.zip'`.
- **Gotcha (verified in production):** some Kenney GLBs reference external
  texture URIs — keep `colormap.png` at the matching relative path or materials break.

### 4. Poly Pizza — per-model props (palms, lamp posts, bus stop, bicycle)
- https://poly.pizza — per-model **CC0 or CC-BY** (badge on each model page; verify per model).
- No API key: model page `/m/<id>` → direct GLB `https://static.poly.pizza/<uuid>.glb`,
  preview `https://static.poly.pizza/<uuid>.jpg`.
- Hand-pick: coconut palm, street lamp, bus-stop shelter, bicycle.
- **If any chosen model is CC-BY, record attribution in ASSET_MANIFEST.md** —
  keep it out of the "invented branding" problem by attributing the model, not a shop.

### 5. ambientCG / Poly Haven — PBR textures + sky
- https://ambientcg.com (CC0, has API) — asphalt, concrete, sidewalk PBR sets.
- https://polyhaven.com (CC0, API with unique User-Agent) — HDR skies for the
  environment-lighting pass (1K is plenty; sample down).

## Honest gaps — no verified CC0 GLB found

| Slot(s) | Finding |
|---|---|
| `hero` (clothed rig) | No rigged Muslim-attire character in CC0 sources. Use Quaternius rig + game's own cloth (above), or fari-supplied model. |
| `auto_rickshaw` | Only paid models (CGTrader/Turbosquid), 3D-print STLs (Cults3d/MakerWorld), and one "Royalty Free" model on rigmodels.com with unclear terms. **Not CC0 — do not bundle.** Keep procedural or ask fari to supply. |
| `masjid` | CGTrader "GOLDEN MOSQUE" is free-to-download but royalty-free license needs per-model verification (not CC0). coohom minaret is "free use" with unclear terms. Given the spec's "respectful Islamic prayer-space exterior" requirement, procedural or fari-supplied is the safer path than a random download. |
| `shop_*`, `edumart`, `busstop` | Generic CC0 shop/shelter structures are fine from Kenney/KayKit/Poly Pizza, but **signage keeps the exact supplied names/colors and stays procedural** — per fari's own anti-fabrication rule (no invented offers, addresses, or branding). |
| `shaytan` | Custom by design. The procedural cinematic smoke apparition already built is the right asset — do not replace with a stock "demon" model (would violate the "frightening without graphic violence" spec). |
| `academyGate`, `academy_campus` | Academy-specific; procedural with the real shia-logo.png is the correct approach (already done). |

## Suggested fill order (visual ROI first)

1. **Hero rig** — Quaternius base + game cloth (biggest single win; one asset).
2. **Vehicles** — KayKit/Kenney car pack (covers `car`; check pack for bus/motorcycle variants).
3. **Props** — Poly Pizza palm/lamp/bicycle + Kenney nature; ambientCG asphalt/concrete PBR.
4. **Pedestrians** — KayKit Adventurers rigs as background pedestrians (respectful, modest styling holds).
5. **fari-supplied** — auto-rickshaw, masjid exterior reference/photos, and optionally a hero character. He has already supplied music and the academy logo, so asking is consistent with his pattern — and user-supplied assets stay inside his licensing comfort zone.

## Style-consistency warning

Kenney, KayKit and Quaternius are **different art families** (flat-color low-budget vs.
gradient-atlas chunky vs. higher-tri textured). Mixed side-by-side they clash.
Pick **one family for props** (recommend KayKit or Kenney for environment, since
they're the cheapest) and keep Quaternius only for characters. Recoloring a pack's
shared atlas to the game's palette is the fastest way to unify.

## Sources
- Pack license/contents verification: https://github.com/Francesco149/cosmic2d/blob/HEAD/docs/research-3d/assets-cc0.md
- Download recipes + Sketchfab/Kenney/Poly Pizza gotchas: https://github.com/studioigor/studioigor-skill/blob/HEAD/references/assets.md
- Measured pack profiles (tri counts, file sizes, scales): https://github.com/tmhsdigital/free-game-dev-assets/blob/HEAD/catalog/3d/README.md
- KayKit GLB vehicle packs in production: https://github.com/sasimis/gtathens/blob/HEAD/AGENTS.md
- Kenney Car Kit 3.1 CC0 vehicle sourcing: https://github.com/alezx311/terra-drive/blob/HEAD/docs/SOURCES.md
- Auto-rickshaw license dead-end: https://rigmodels.com/model.php?view=Indian_chennai_auto_rikshaw-3d-model__ea9ee5878ca640b783b26f38193584c8&searchkeyword=landscape&manualsearch=1
- Free mosque/minaret (license unverified): https://www.cgtrader.com/free-3d-models/architectural/other/golden-mosque and https://www.coohom.com/3d-models/Constructions/islamic-style-minaret-3d-model-mdtl~3FO48TER525I
- Quaternius character pack example: https://quaternius.com/packs/rpgcharacters.html
