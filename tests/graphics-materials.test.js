// tests/graphics-materials.test.js — Materials.js shared PBR cache.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { std, lit, vertexLit, Surfaces, cacheSize } from '../src/game/Materials.js';

describe('Materials cache', () => {
  it('returns the same instance for the same key (no duplicates)', () => {
    expect(std(0x33373d)).toBe(std(0x33373d));
    expect(std(0x33373d, { roughness: 0.5 })).toBe(std(0x33373d, { roughness: 0.5 }));
  });

  it('returns different instances for different params', () => {
    expect(std(0x33373d, { roughness: 0.5 })).not.toBe(std(0x33373d, { roughness: 0.9 }));
    expect(std(0x33373d)).not.toBe(std(0x9aa0a8));
  });

  it('produces MeshStandardMaterial (PBR), not Lambert/Basic', () => {
    const m = std(0x8a5f36, { roughness: 0.7 });
    expect(m.isMeshStandardMaterial).toBe(true);
    expect(m.roughness).toBeCloseTo(0.7);
    expect(m.metalness).toBe(0);
  });

  it('lit() is the standard-material drop-in with rough default 0.9', () => {
    const m = lit(0xd9c9a8);
    expect(m.isMeshStandardMaterial).toBe(true);
    expect(m.roughness).toBeCloseTo(0.9);
  });

  it('vertexLit() returns shared vertex-color standard materials', () => {
    expect(vertexLit()).toBe(vertexLit());
    expect(vertexLit({ doubleSide: true })).toBe(vertexLit({ doubleSide: true }));
    expect(vertexLit()).not.toBe(vertexLit({ doubleSide: true }));
    expect(vertexLit().vertexColors).toBe(true);
    expect(vertexLit({ doubleSide: true }).side).toBe(THREE.DoubleSide);
  });

  it('surface presets carry the spec roughness/metalness', () => {
    expect(Surfaces.asphalt().roughness).toBeCloseTo(0.95);
    expect(Surfaces.asphalt().metalness).toBe(0);
    expect(Surfaces.fabric().roughness).toBeCloseTo(0.8);
    expect(Surfaces.wood().roughness).toBeCloseTo(0.7);
    const glass = Surfaces.glass();
    expect(glass.roughness).toBeCloseTo(0.15);
    expect(glass.metalness).toBeCloseTo(0.1);
    const gold = Surfaces.gold();
    expect(gold.roughness).toBeCloseTo(0.35);
    expect(gold.metalness).toBeCloseTo(0.8);
    expect(Surfaces.foliage().roughness).toBeCloseTo(0.9);
  });

  it('cache stays bounded when reused', () => {
    const before = cacheSize();
    for (let i = 0; i < 50; i++) std(0x123456, { roughness: 0.42 });
    expect(cacheSize()).toBe(before + 1);
  });
});
