// tests/graphics-contact-shadows.test.js — ContactShadows blob logic.
// Canvas 2D is stubbed like the other DOM-dependent tests.
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';

beforeAll(() => {
  const grad = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(t, p) {
      if (p === 'createRadialGradient') return () => grad;
      return () => {};
    },
    set() { return true; },
  });
  globalThis.document = {
    createElement: (tag) => tag === 'canvas'
      ? { width: 0, height: 0, getContext: () => ctx }
      : { style: {} },
  };
});

import { ContactShadows } from '../src/game/ContactShadows.js';

function propGroup(w, h, d) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  m.position.y = h / 2;
  g.add(m);
  return g;
}

describe('ContactShadows', () => {
  it('hero blob tracks x and fades with jump height', () => {
    const scene = new THREE.Scene();
    const cs = new ContactShadows(scene);
    let x = 2.5, y = 0;
    cs.setHero(() => x, () => y);
    cs.update();
    expect(cs._hero.position.x).toBeCloseTo(2.5);
    const groundOpacity = cs._hero.material.opacity;
    y = 2; // airborne
    cs.update();
    expect(cs._hero.position.x).toBeCloseTo(2.5);
    expect(cs._hero.material.opacity).toBeLessThan(groundOpacity);
    // blob grows slightly with height
    expect(cs._hero.scale.x).toBeGreaterThan(1.7);
  });

  it('attachWorld adds blob children to world scenery props', () => {
    const scene = new THREE.Scene();
    const cs = new ContactShadows(scene);
    const world = { scenery: [propGroup(1, 2, 1), propGroup(3, 1, 2)] };
    const n = cs.attachWorld(world);
    expect(n).toBe(2);
    for (const obj of world.scenery) {
      const blob = obj.children.find((c) => c.userData.contactShadow);
      expect(blob).toBeTruthy();
      expect(blob.rotation.x).toBeCloseTo(-Math.PI / 2);
    }
  });

  it('attachWorld skips degenerate props without crashing', () => {
    const scene = new THREE.Scene();
    const cs = new ContactShadows(scene);
    const empty = new THREE.Group();
    expect(cs.attachWorld({ scenery: [empty] })).toBe(0);
    expect(cs.attachWorld(null)).toBe(0);
    expect(cs.attachLandmarks(null)).toBe(0);
    expect(cs.attachGate(null)).toBe(0);
  });

  it('attachLandmarks / attachGate use the exposed groups', () => {
    const scene = new THREE.Scene();
    const cs = new ContactShadows(scene);
    const lm = { landmarks: [{ def: {}, group: propGroup(14, 7, 10) }] };
    expect(cs.attachLandmarks(lm)).toBe(1);
    expect(cs.attachGate({ group: propGroup(8, 5, 2) })).toBe(1);
  });
});
