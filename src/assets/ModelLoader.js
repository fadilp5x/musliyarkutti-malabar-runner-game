// ---------------------------------------------------------------------------
// ModelLoader — GLB model pipeline for MUSLIYARKUTTI: MALABAR RUNNER.
//
// Drop-in design: game code asks for a NAMED SLOT (e.g. 'hero'), never a
// filename. Slot -> file mapping lives ONLY in public/models/manifest.json.
// Today every slot has file: null, so every load resolves to a documented
// procedural fallback. When a real, rigged GLB is supplied, only the manifest
// changes (set `file`, keep the slot name, list the clips) — no code edits.
//
// Conventions a supplied GLB must follow (documented here and in the
// manifest; the loader does not silently "fix" a non-conforming model):
//   - hero faces -Z (away from camera), ~1.7 units tall, feet at y=0.
//   - animation clips are named per the manifest `animations` map
//     (idle/read/run/sprint/jump/land/slide/dodge/collect/stumble/
//      gameover/jetpack/glideboard).
//   - one GLB per slot, or one GLB per clip via the animations map.
//
// Honesty rule: a fallback is NEVER reported as an integrated premium
// model. SlotHandle.source is 'glb' only when a real GLB file was loaded;
// everything else is 'procedural' (callable builder) or
// 'procedural-deferred' (rendered in-game by the named module, no
// standalone ModelLoader builder yet).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  parseManifest,
  clipSlotFor,
  clipFileFor,
  isSlotMissing,
  fallbackInfo,
  MODEL_SLOTS,
} from './manifest.js';
import { PlayerAvatar } from '../game/PlayerAvatar.js';

// Slot -> procedural fallback builder. `build(scene)` must return an object
// with { object3D, setAnim(name), update(dt) }. `build: null` means the slot
// is rendered procedurally in-game by the named module, but ModelLoader has
// no standalone builder for it yet — loadModel still resolves, honestly
// marked 'procedural-deferred', instead of throwing or inventing geometry.
const FALLBACK_BUILDERS = {
  hero: {
    // The upgraded stylized procedural rig. Explicitly NOT a premium model:
    // it is the documented stand-in until a rigged hero GLB exists.
    build: (scene) => new PlayerAvatar(scene),
    note: 'PlayerAvatar stylized procedural stand-in (src/game/PlayerAvatar.js) — rigged hero GLB still needed',
  },
  shaytan: {
    build: null,
    note: 'ShaytanPursuit cinematic smoke apparition (src/game/ShaytanPursuit.js) — modeled shaytan GLB still needed',
  },
  academyGate: {
    build: null,
    note: 'AcademyGate procedural gate (src/game/AcademyGate.js)',
  },
  shop_juicify:   { build: null, note: 'LandmarkManager procedural shopfront (src/game/LandmarkManager.js)' },
  shop_turkish:   { build: null, note: 'LandmarkManager procedural shopfront (src/game/LandmarkManager.js)' },
  shop_laban:     { build: null, note: 'LandmarkManager procedural shopfront (src/game/LandmarkManager.js)' },
  shop_family:    { build: null, note: 'LandmarkManager procedural shopfront (src/game/LandmarkManager.js)' },
  busstop:        { build: null, note: 'LandmarkManager procedural bus stop (src/game/LandmarkManager.js)' },
  masjid:         { build: null, note: 'LandmarkManager procedural masjid (src/game/LandmarkManager.js)' },
  edumart:        { build: null, note: 'LandmarkManager procedural office (src/game/LandmarkManager.js)' },
  academy_campus: { build: null, note: 'LandmarkManager procedural campus (src/game/LandmarkManager.js)' },
  shop_myg:       { build: null, note: 'LandmarkManager procedural shopfront (src/game/LandmarkManager.js)' },
  bus:            { build: null, note: 'ObstacleManager SVG-textured procedural bus (src/game/ObstacleManager.js)' },
  auto_rickshaw:  { build: null, note: 'ObstacleManager SVG-textured procedural auto-rickshaw (src/game/ObstacleManager.js)' },
  car:            { build: null, note: 'WorldBuilder background traffic car (src/game/WorldBuilder.js)' },
  motorcycle:     { build: null, note: 'no motorcycle variant built yet — slot reserved, GLB still needed' },
  bicycle:        { build: null, note: 'no bicycle variant built yet — slot reserved, GLB still needed' },
  pedestrian_a:   { build: null, note: 'WorldBuilder procedural sidewalk pedestrian (src/game/WorldBuilder.js)' },
  pedestrian_b:   { build: null, note: 'WorldBuilder procedural sidewalk pedestrian (src/game/WorldBuilder.js)' },
  palm:           { build: null, note: 'WorldBuilder procedural coconut palm (src/game/WorldBuilder.js)' },
  lampPost:       { build: null, note: 'WorldBuilder procedural street lamp (src/game/WorldBuilder.js)' },
  // Oct 13, 2026: fari's Sketchfab GLBs. Static meshes (no rig) used as
  // background traffic / scenery / selectable Shaytan apparitions.
  car_sport:      { build: null, note: 'WorldBuilder background traffic sport car (src/game/WorldBuilder.js) — mustang GLB' },
  windmill:       { build: null, note: 'WorldBuilder roadside windmill landmark (src/game/WorldBuilder.js) — terrain stripped' },
  shaytan_reaper: { build: null, note: 'ShaytanPursuit selectable reaper apparition (src/game/ShaytanPursuit.js) — static mesh, hover treatment' },
  shaytan_alt:    { build: null, note: 'ShaytanPursuit selectable apparition (src/game/ShaytanPursuit.js) — static mesh, hover treatment' },
};

export class ModelLoader {
  constructor({ scene = null, manifestUrl = 'models/manifest.json' } = {}) {
    this.scene = scene;
    this.manifestUrl = manifestUrl;
    this._manifest = null;
    this._gltfLoader = new GLTFLoader();
    // Meshopt-compressed GLBs (e.g. fari's hero-mascot.glb) need the decoder.
    try {
      this._gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    } catch { /* older three without meshopt — non-compressed GLBs still load */ }
    this._handles = new Map(); // slotName -> SlotHandle
    this._clipCache = new Map(); // clip file url -> loaded gltf (per-clip GLBs)
    this.onAssetSettled = null;
  }

  setAssetProgressListener(listener) {
    this.onAssetSettled = typeof listener === 'function' ? listener : null;
  }

  _resolve(path) {
    if (/^(https?:|blob:|data:|\/)/.test(path)) return path;
    return `${import.meta.env.BASE_URL}${path}`;
  }

  async init() {
    const url = this._resolve(this.manifestUrl);
    let raw = null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (err) {
      console.warn(`[models] manifest fetch failed (${url}): ${err.message} — all slots fall back to procedural`);
    }
    this._manifest = parseManifest(raw);
    for (const e of this._manifest.errors) console.warn(`[models] manifest: ${e}`);
    return this._manifest;
  }

  async _ensureInit() {
    if (!this._manifest) await this.init();
    return this._manifest;
  }

  _slotEntry(slotName) {
    const entry = this._manifest && this._manifest.slots[slotName];
    if (!entry) {
      throw new Error(
        `[models] unknown slot "${slotName}". Known slots: ${MODEL_SLOTS.join(', ')}`
      );
    }
    return entry;
  }

  // Load a slot. Always resolves — to a real GLB handle or to a documented
  // procedural fallback. Rejects only for unknown slot names or GLB load
  // errors (a corrupt GLB must not silently become a fallback).
  async loadModel(slotName, { rotationY = 0 } = {}) {
    await this._ensureInit();
    if (this._handles.has(slotName)) return this._handles.get(slotName);
    const entry = this._slotEntry(slotName);

    try {
      let handle;
      if (!isSlotMissing(entry)) {
        const url = this._resolve(entry.file);
        const gltf = await this._gltfLoader.loadAsync(url); // throws on failure: honest
        handle = this._makeGlbHandle(slotName, entry, gltf);
      } else {
        handle = this._makeFallbackHandle(slotName, entry);
      }
      if (rotationY) handle.object3D.rotation.y += rotationY;
      this._handles.set(slotName, handle);
      return handle;
    } finally {
      this.onAssetSettled?.(slotName);
    }
  }

  _makeGlbHandle(slotName, entry, gltf) {
    const object3D = gltf.scene || new THREE.Group();
    if (this.scene && !object3D.parent) this.scene.add(object3D);
    const mixer = new THREE.AnimationMixer(object3D);
    const loader = this;
    const handle = {
      slot: slotName,
      source: 'glb', // genuinely integrated premium model
      note: `GLB loaded from ${entry.file}`,
      object3D,
      mixer,
      impl: gltf,
      _currentAction: null,
      // setAnim accepts runtime anim names ('run', 'jump', ...) and maps
      // them to manifest clip slots — the same API the procedural hero
      // exposes, so game code is identical either way.
      setAnim(name) {
        const clip = clipSlotFor(name);
        if (!clip) {
          console.warn(`[models] hero GLB: no clip slot for anim "${name}"`);
          return false;
        }
        loader.playClip(slotName, clip).catch((err) => {
          console.warn(`[models] playClip failed for ${slotName}/${clip}:`, err);
        });
        return true;
      },
      update(dt) {
        mixer.update(dt);
      },
      dispose() {
        mixer.stopAllAction();
        if (object3D.parent) object3D.parent.remove(object3D);
        loader._handles.delete(slotName);
      },
    };
    return handle;
  }

  _makeFallbackHandle(slotName, entry) {
    const reg = FALLBACK_BUILDERS[slotName] || { build: null, note: 'no fallback registered' };
    const info = fallbackInfo(entry);
    if (typeof reg.build === 'function') {
      const built = reg.build(this.scene);
      return {
        slot: slotName,
        source: 'procedural',
        note: reg.note,
        object3D: built.group || built.object3D || built,
        mixer: null,
        impl: built,
        setAnim(name) { built.setAnim(name); return true; },
        update(dt) { built.update(dt); },
        dispose() {
          const o = built.group || built.object3D;
          if (o && o.parent) o.parent.remove(o);
          this._handles.delete(slotName);
        },
      };
    }
    // No standalone builder: the in-game module named in the note renders
    // this slot. Resolve to an empty placeholder so callers never crash, and
    // mark it honestly.
    const placeholder = new THREE.Group();
    placeholder.name = `fallback-placeholder:${slotName}`;
    if (this.scene) this.scene.add(placeholder);
    return {
      slot: slotName,
      source: 'procedural-deferred',
      note: `${reg.note} (manifest: ${info.note})`,
      object3D: placeholder,
      mixer: null,
      impl: null,
      setAnim() { return false; },
      update() {},
      dispose() {
        if (placeholder.parent) placeholder.parent.remove(placeholder);
        this._handles.delete(slotName);
      },
    };
  }

  // THREE.AnimationMixer for a loaded GLB slot, or null for procedural slots.
  getMixer(slotName) {
    const h = this._handles.get(slotName);
    return h ? h.mixer : null;
  }

  // Find a clip inside a loaded animations array: exact name, then
  // case-insensitive, then substring match. Returns null (never invents).
  _findClip(animations, clipName) {
    if (!animations || !animations.length) return null;
    const lower = clipName.toLowerCase();
    return (
      animations.find((c) => c.name === clipName) ||
      animations.find((c) => c.name && c.name.toLowerCase() === lower) ||
      animations.find((c) => c.name && c.name.toLowerCase().includes(lower)) ||
      null
    );
  }

  // Play a manifest clip slot on a loaded GLB with crossfade. Returns true
  // when a clip actually started; false (with a warning) when the clip is
  // missing — never throws for a missing clip.
  async playClip(slotName, clipName, { crossfade = 0.25, loop = THREE.LoopRepeat } = {}) {
    await this._ensureInit();
    const handle = this._handles.get(slotName);
    if (!handle || handle.source !== 'glb' || !handle.mixer) {
      console.warn(`[models] playClip: slot "${slotName}" has no loaded GLB`);
      return false;
    }
    const entry = this._slotEntry(slotName);
    let animations = handle.impl.animations || [];
    const clipFile = clipFileFor(entry, clipName);
    if (clipFile) {
      // Per-clip GLB: load (cached) and use its animation track(s).
      const url = this._resolve(clipFile);
      if (!this._clipCache.has(clipFile)) {
        this._clipCache.set(clipFile, await this._gltfLoader.loadAsync(url));
      }
      animations = this._clipCache.get(clipFile).animations || [];
    }
    const clip = this._findClip(animations, clipName);
    if (!clip) {
      console.warn(`[models] clip "${clipName}" not found in ${slotName} GLB animations`);
      return false;
    }
    const next = handle.mixer.clipAction(clip);
    next.setLoop(loop, Infinity);
    next.reset();
    const prev = handle._currentAction;
    if (prev && prev !== next) prev.fadeOut(crossfade);
    next.fadeIn(crossfade).play();
    handle._currentAction = next;
    return true;
  }

  // Honesty report: one row per slot. `integrated` is true ONLY when a real
  // GLB file was loaded for the slot — a procedural fallback is never
  // reported as integrated.
  statusReport() {
    const rows = [];
    const slots = (this._manifest && this._manifest.slots) || {};
    for (const name of MODEL_SLOTS) {
      const entry = slots[name];
      const handle = this._handles.get(name);
      const integrated = !!handle && handle.source === 'glb';
      rows.push({
        slot: name,
        file: entry && entry.file ? entry.file : 'missing',
        integrated,
        source: handle ? handle.source : (entry && !isSlotMissing(entry) ? 'glb (not loaded)' : 'procedural fallback'),
        fallback: entry ? fallbackInfo(entry).builder : null,
        note: handle ? handle.note : (entry ? entry.status : 'no manifest entry'),
      });
    }
    return rows;
  }
}

export default ModelLoader;
