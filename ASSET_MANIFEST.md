# ASSET_MANIFEST.md — MUSLIYARKUTTI: MALABAR RUNNER

Generated 2026-10-13. All assets below were supplied by the user in chat and extracted verbatim into `assets/svg/`. Each SVG validated as well-formed XML (Python `xml.etree` parse, 2026-10-13).

## Saved assets (present, ready to use)

| File | Source ID | Intended gameplay use |
|---|---|---|
| `assets/svg/character_reference.svg` | (2400×1500 design sheet) | **Hero design reference**: full-body front/side/back turnarounds, face close-up, 4 gameplay expressions (happy/serious/surprised/tired), costume detail studies (thalappav knot, jubba collar, lungi kara border, barefoot), official color palette (`#FAF7F0` ivory attire, `#697682` slate border, `#C97E50` warm skin, `#24140B` eyes/hair, `#D9A441` gold). Also contains location refs: library interior, library exit, Malabar street, 3-lane road. Use as the authority for the procedural 3D hero rig (white jubba, white lungi with grey kara, wrapped white thalappav, warm brown skin). |
| `assets/svg/location_library_exit.svg` | `location_library_exit.svg` | **Opening scene environment reference**: teak library interior with kitab bookshelves, grand carved arched doorway with open panels, sunlit Malabar street vista (shophouses, terracotta roofs, mosque dome/minaret, coconut palms). Rebuild as actual 3D scene elements; use the SVG as texture/detail reference. |
| `assets/svg/obstacle_overhead_gate.svg` | `obstacle_overhead_gate` | **Slide-under obstacle**: low-clearance steel gantry, yellow/black hazard header, "MAX 1.8M" plaque. |
| `assets/svg/obstacle_puddle.svg` | `obstacle_puddle` | **Jumpable/slow hazard**: rainwater puddle. |
| `assets/svg/obstacle_low_barrier.svg` | `obstacle_low_barrier` | **Jumpable obstacle**: red/white striped sawhorse barrier ("CAUTION • വഴി അടച്ചിരിക്കുന്നു"). |
| `assets/svg/obstacle_handcart.svg` | `obstacle_handcart` | **Lane-blocking obstacle**: wooden handcart with sacks. |
| `assets/svg/obstacle_bus.svg` | `obstacle_bus` | **Lane-blocking traffic**: Kerala KSRTC-style bus ("MALABAR EXP"). |
| `assets/svg/obstacle_auto_rickshaw.svg` | `obstacle_auto_rickshaw` | **Lane-blocking traffic**: green/yellow auto-rickshaw. |
| `assets/svg/shaytan_warning.svg` | `shaytan_warning` | **Shaytan surge warning FX**: pulsing red slit-eye aura. |
| `assets/svg/shaytan_disappear.svg` | `shaytan_disappear` | **Shaytan entity**: smoky shadow silhouette with glowing red-orange eyes (billowing smoke, claw tendrils). Use for the library scare + surge events. |
| `assets/svg/obstacle_smartphone_portal.svg` | `obstacle_smartphone_portal` | **Special event obstacle**: hovering smartphone with cosmic vortex screen. |

## Corrections applied during extraction

- `obstacle_smartphone_portal.svg`: the `<clipPath id="screenMask">` was nested *inside* the `<g clip-path="url(#screenMask)">` element that references it. Moved into `<defs>` for loader compatibility. No visual change.

## Referenced but NOT supplied (missing — build procedural fallbacks)

The spec references these, but no image/SVG files for them exist in the workspace or were supplied:

| Reference | Expected use | Fallback plan |
|---|---|---|
| Juicify Kuttikkattur facade photo | Landmark 1 — cyan/blue glass storefront | Procedural 3D storefront; keep **name + cyan/blue color** as specified |
| Turkish Corner facade photo | Landmark 2 — dark storefront, warm-yellow lettering, food counter | Procedural 3D; keep **name + dark/yellow scheme** |
| Edumart sign reference | Landmark 7 — yellow Edumart sign | Procedural sign; keep **yellow Edumart branding** as specified |
| MyG logo reference | Landmark 9 — orange MyG logo, electronics retail | Procedural facade; keep **orange MyG branding** |
| Women-in-purdah pedestrian artwork | Respectful background pedestrians | Procedural modest pedestrian figures; keep respectful, no collision gore |
| `location_library_exit.svg` as a *separate* file | (Supplied inline in chat instead — saved above) | Saved as `assets/svg/location_library_exit.svg` ✅ |

Do **not** invent offers, addresses, or extra branding for these stores. Keep store names and specified colors accurate.

## New SVG creation budget

Spec limits new SVG creation to batches of ≤5 files; prefer procedural Three.js geometry. Planned new SVGs (only if needed): Arabic-letter coin faces (1 file, several glyphs), voucher card faces (1 file). Everything else procedural.

## Dependency notes

- Three.js + Vite via local `node_modules` (no CDN at runtime); `npm install` required once.
- Web Audio API: procedural SFX, no audio files needed.
- LocalStorage keys namespaced `mmr.*` (see `src/game/SaveManager.js`).
