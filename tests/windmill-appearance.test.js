import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { styleWindmillBlades } from '../src/game/WorldBuilder.js';

describe('windmill GLB blade styling', () => {
  it('brightens and widens only the four rotor blade nodes', () => {
    const root = new THREE.Group();
    const original = new THREE.MeshStandardMaterial({ color: 0x210201, metalness: 0, roughness: 0.5 });
    const blades = ['Cube.008', 'Cube.009', 'Cube.010', 'Cube.011'].map((name) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), original);
      mesh.name = name;
      mesh.scale.set(0.105, 0.105, 0.105);
      root.add(mesh);
      return mesh;
    });
    const unnamedBlade = new THREE.Mesh(new THREE.BoxGeometry(32, 2, 1.5), original);
    unnamedBlade.name = 'mesh_3';
    unnamedBlade.scale.set(0.105, 0.105, 0.105);
    root.add(unnamedBlade);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), original);
    hub.name = 'Circle.002';
    hub.scale.set(1.25, 1.25, 1.25);
    root.add(hub);

    styleWindmillBlades(root);

    for (const blade of blades) {
      expect(blade.scale.x).toBeCloseTo(0.105);
      expect(blade.scale.y).toBeCloseTo(0.315);
      expect(blade.scale.z).toBeCloseTo(0.105);
      expect(blade.material.color.getHex()).toBe(0xdde3e7);
      expect(blade.material.roughness).toBeCloseTo(0.72);
    }
    expect(unnamedBlade.scale.y).toBeCloseTo(0.315);
    expect(unnamedBlade.material.color.getHex()).toBe(0xdde3e7);
    expect(hub.scale.toArray()).toEqual([1.25, 1.25, 1.25]);
    expect(hub.material.color.getHex()).toBe(0x210201);
    expect(original.color.getHex()).toBe(0x210201);
  });
});
