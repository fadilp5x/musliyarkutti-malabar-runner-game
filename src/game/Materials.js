// Materials.js — shared PBR material cache for the graphics overhaul.
//
// One cached MeshStandardMaterial per (color, roughness, metalness, extras)
// key: builders share instances instead of allocating duplicates, and every
// lit surface in the game gets a real roughness/metalness response instead of
// the old flat Lambert look.
//
// Surface guide (roughness / metalness):
//   asphalt 0.95 / 0      concrete 0.9 / 0      fabric 0.8 / 0
//   wood 0.7 / 0          foliage 0.9 / 0       plaster 0.95 / 0
//   glass 0.15 / 0.1      gold trim 0.35 / 0.8  painted metal 0.5 / 0.6
//
// NOTE on envMap: three r170 lights MeshStandardMaterial with scene.environment
// or per-material envMap. We don't ship an env map (no PMREM pass at boot —
// keeps load fast on low-end phones), so glass/metal read mostly through
// their specular highlight from the key light. If a future pass adds a tiny
// procedural sky env, set envMapIntensity here per surface.

import * as THREE from 'three';

const _cache = new Map();

function keyOf(color, roughness, metalness, extras) {
  return `${color}|${roughness}|${metalness}|${JSON.stringify(extras)}`;
}

/**
 * Shared MeshStandardMaterial. `extras` accepts any other
 * MeshStandardMaterial parameters (transparent, opacity, map, side, ...).
 */
export function std(color, { roughness = 0.9, metalness = 0.0, ...extras } = {}) {
  const k = keyOf(color, roughness, metalness, extras);
  if (!_cache.has(k)) {
    _cache.set(k, new THREE.MeshStandardMaterial({
      color, roughness, metalness, ...extras,
    }));
  }
  return _cache.get(k);
}

/** Drop-in lit replacement for the old MeshLambertMaterial helpers. */
export function lit(color, opts = {}) {
  return std(color, { roughness: 0.9, metalness: 0.0, ...opts });
}

/** Vertex-color variant for merged-geometry props (palms, benches, ...). */
let _vertexColorMat = null;
let _vertexColorMatDS = null;
export function vertexLit({ doubleSide = false } = {}) {
  if (doubleSide) {
    if (!_vertexColorMatDS) {
      _vertexColorMatDS = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.9, metalness: 0.0,
        side: THREE.DoubleSide,
      });
    }
    return _vertexColorMatDS;
  }
  if (!_vertexColorMat) {
    _vertexColorMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0.0,
    });
  }
  return _vertexColorMat;
}

// ----- named surface presets ----------------------------------------------
export const Surfaces = {
  asphalt:   (c = 0x33373d) => std(c, { roughness: 0.95, metalness: 0.0 }),
  concrete:  (c = 0x9aa0a8) => std(c, { roughness: 0.9,  metalness: 0.0 }),
  fabric:    (c = 0xffffff) => std(c, { roughness: 0.8,  metalness: 0.0 }),
  wood:      (c = 0x8a5f36) => std(c, { roughness: 0.7,  metalness: 0.0 }),
  woodDark:  (c = 0x4a3120) => std(c, { roughness: 0.75, metalness: 0.0 }),
  foliage:   (c = 0x3f8f4f) => std(c, { roughness: 0.9,  metalness: 0.0 }),
  trunk:     (c = 0x6e4a2f) => std(c, { roughness: 0.85, metalness: 0.0 }),
  plaster:   (c = 0xd9c9a8) => std(c, { roughness: 0.95, metalness: 0.0 }),
  terracotta:(c = 0xb5542d) => std(c, { roughness: 0.8,  metalness: 0.0 }),
  glass:     (c = 0x9fd4ef) => std(c, { roughness: 0.15, metalness: 0.1, envMapIntensity: 1.0 }),
  gold:      (c = 0xd8a93f) => std(c, { roughness: 0.35, metalness: 0.8 }),
  paintMetal:(c = 0x4b5563) => std(c, { roughness: 0.5,  metalness: 0.6 }),
  darkMetal: (c = 0x1a1a1a) => std(c, { roughness: 0.6,  metalness: 0.4 }),
};

/** For tests: how many unique materials are cached. */
export function cacheSize() {
  return _cache.size + (_vertexColorMat ? 1 : 0) + (_vertexColorMatDS ? 1 : 0);
}
