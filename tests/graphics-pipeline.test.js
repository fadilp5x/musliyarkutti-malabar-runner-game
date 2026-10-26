// tests/graphics-pipeline.test.js — RenderPipeline bloom chain config.
// Uses a stub renderer: EffectComposer/UnrealBloomPass only need sizing
// calls at construction, no real GL context.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RenderPipeline } from '../src/game/RenderPipeline.js';

function stubRenderer() {
  return {
    getPixelRatio: () => 1,
    getSize: (v) => v.set(1280, 720),
    getDrawingBufferSize: (v) => v.set(1280, 720),
  };
}

describe('RenderPipeline', () => {
  it('builds a composer with restrained bloom params, bloom off by default', () => {
    const p = new RenderPipeline(stubRenderer(), new THREE.Scene(), new THREE.Camera());
    const bp = p.bloomParams();
    expect(bp.threshold).toBeCloseTo(0.85); // HIGH threshold
    expect(bp.strength).toBeCloseTo(0.3);   // LOW strength
    expect(bp.radius).toBeCloseTo(0.4);
    expect(bp.enabled).toBe(false);
    expect(p.bloomOn).toBe(false);
  });

  it('setBloom toggles the pass without rebuilding the chain', () => {
    const p = new RenderPipeline(stubRenderer(), new THREE.Scene(), new THREE.Camera());
    const pass = p.bloomPass;
    p.setBloom(true);
    expect(p.bloomOn).toBe(true);
    expect(pass.enabled).toBe(true);
    expect(p.bloomPass).toBe(pass); // same instance
    p.setBloom(false);
    expect(p.bloomOn).toBe(false);
    expect(pass.enabled).toBe(false);
  });

  it('setSize/setPixelRatio forward to the composer', () => {
    const p = new RenderPipeline(stubRenderer(), new THREE.Scene(), new THREE.Camera());
    expect(() => p.setSize(800, 600)).not.toThrow();
    expect(() => p.setPixelRatio(1.5)).not.toThrow();
  });
});
