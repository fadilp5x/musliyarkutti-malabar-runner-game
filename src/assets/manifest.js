// ---------------------------------------------------------------------------
// manifest.js — pure, unit-testable logic for the GLB model pipeline.
// No three.js import here: this module must stay runnable in plain Node so
// vitest can exercise manifest parsing, clip-name mapping, and slot
// validation without a renderer or DOM.
//
// The runtime loader lives in ./ModelLoader.js and consumes these helpers.
// ---------------------------------------------------------------------------

// Every named GLB slot the art pipeline may fill. When a real, rigged GLB
// exists for a slot, ONLY public/models/manifest.json changes: set that
// slot's `file` (and any per-clip files) — no code changes needed.
export const MODEL_SLOTS = [
  'hero',
  'shaytan',
  'academyGate',
  'shop_juicify',
  'shop_turkish',
  'shop_laban',
  'shop_family',
  'busstop',
  'masjid',
  'edumart',
  'academy_campus',
  'shop_myg',
  'bus',
  'auto_rickshaw',
  'car',
  'motorcycle',
  'bicycle',
  'pedestrian_a',
  'pedestrian_b',
  'palm',
  'lampPost',
  // Added Oct 13, 2026 (fari's Sketchfab GLBs): sport-car traffic variant,
  // roadside windmill landmark, and two selectable Shaytan apparitions.
  'car_sport',
  'windmill',
  'shaytan_reaper',
  'shaytan_alt',
  // Added Oct 14, 2026: fari's hero GLB as the title-screen greeting mascot.
  'hero_mascot',
];

// Animation clip slots expected in the manifest's hero `animations` map.
// These are the GLB-side clip names (a superset of the runtime anim names:
// 'sprint' and 'land' have no direct AVATAR_ANIMS counterpart yet and are
// reserved for future speed-tier / landing flourishes).
export const HERO_CLIP_SLOTS = [
  'idle', 'read', 'run', 'sprint', 'jump', 'land', 'slide', 'dodge',
  'collect', 'stumble', 'gameover', 'jetpack', 'glideboard',
];

// Runtime AVATAR_ANIMS (PlayerAvatar) -> manifest clip-slot mapping.
// Used by ModelLoader so game code keeps calling setAnim('run') etc.
// whether the hero is the procedural rig or a real rigged GLB.
export const ANIM_TO_CLIP = {
  idle: 'idle',
  reading: 'read',
  run: 'run',
  jump: 'jump',
  slide: 'slide',
  left: 'dodge',
  right: 'dodge',
  collect: 'collect',
  stumble: 'stumble',
  fall: 'gameover',
  jetpack: 'jetpack',
  glide: 'glideboard',
  standup: 'idle',
  react: 'idle',
};

// Map a runtime anim name to its manifest clip slot. Returns null for
// unknown names (the caller must not invent a clip).
export function clipSlotFor(animName) {
  return Object.prototype.hasOwnProperty.call(ANIM_TO_CLIP, animName)
    ? ANIM_TO_CLIP[animName]
    : null;
}

// Normalize + validate a raw manifest JSON object. Never throws on bad
// input: problems are collected in `errors` so the loader can report them
// honestly instead of crashing the game.
export function parseManifest(raw) {
  const errors = [];
  const slots = {};
  if (!raw || typeof raw !== 'object') {
    return { version: 0, slots, errors: ['manifest is not an object'] };
  }
  const version = typeof raw.version === 'number' ? raw.version : 0;
  const rawSlots = raw.slots && typeof raw.slots === 'object' ? raw.slots : {};

  for (const name of MODEL_SLOTS) {
    const s = rawSlots[name];
    if (!s || typeof s !== 'object') {
      errors.push(`slot "${name}" missing from manifest`);
      slots[name] = { file: null, fallback: null, fallbackModule: null, status: 'missing from manifest', animations: {} };
      continue;
    }
    const animations = {};
    const rawAnims = s.animations && typeof s.animations === 'object' ? s.animations : {};
    for (const clip of HERO_CLIP_SLOTS) {
      const c = rawAnims[clip];
      animations[clip] = {
        file: c && typeof c.file === 'string' ? c.file : null,
        status: c && typeof c.status === 'string' ? c.status : 'missing — procedural fallback active',
      };
    }
    slots[name] = {
      file: typeof s.file === 'string' ? s.file : null,
      fallback: typeof s.fallback === 'string' ? s.fallback : null,
      fallbackModule: typeof s.fallbackModule === 'string' ? s.fallbackModule : null,
      status: typeof s.status === 'string' ? s.status : 'missing — procedural fallback active',
      animations,
    };
  }

  // Flag manifest entries for slots the pipeline does not know about rather
  // than silently ignoring them (usually a typo in the JSON).
  for (const name of Object.keys(rawSlots)) {
    if (!MODEL_SLOTS.includes(name)) errors.push(`unknown slot "${name}" in manifest (not in MODEL_SLOTS)`);
  }
  return { version, slots, errors };
}

export function getSlot(manifest, name) {
  return manifest && manifest.slots ? manifest.slots[name] || null : null;
}

// True when no GLB file is assigned: the procedural fallback is active.
export function isSlotMissing(entry) {
  return !entry || entry.file == null;
}

// GLB file for a hero animation clip, or null when the clip has no file.
export function clipFileFor(slotEntry, clipName) {
  const a = slotEntry && slotEntry.animations ? slotEntry.animations[clipName] : null;
  return a && typeof a.file === 'string' ? a.file : null;
}

// Human-readable fallback description for status reporting.
export function fallbackInfo(entry) {
  if (!entry) return { builder: null, module: null, note: 'no manifest entry' };
  return {
    builder: entry.fallback,
    module: entry.fallbackModule,
    note: entry.status,
  };
}
