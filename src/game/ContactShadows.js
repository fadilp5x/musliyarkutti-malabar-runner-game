// ContactShadows.js — cheap blob contact shadows for the graphics overhaul.
//
// No extra shadow-map passes: a single shared radial-gradient texture on
// planes laid just above the ground. Blobs attached as CHILDREN of their
// owner group ride the treadmill / landmark slide / ped walk for free.
// The hero blob follows player.x every frame and fades as the avatar jumps.
//
// This grounds objects on all quality tiers — especially Low, where the real
// shadow map is off and everything would otherwise float.

import * as THREE from 'three';

let _blobTex = null;
function blobTexture() {
  if (_blobTex) return _blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  gr.addColorStop(0.0, 'rgba(0,0,0,0.85)');
  gr.addColorStop(0.55, 'rgba(0,0,0,0.38)');
  gr.addColorStop(1.0, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  _blobTex = new THREE.CanvasTexture(c);
  _blobTex.colorSpace = THREE.SRGBColorSpace;
  return _blobTex;
}

const _blobGeo = new THREE.PlaneGeometry(1, 1);
const _blobMats = new Map(); // opacity -> material
function blobMaterial(opacity) {
  const k = opacity.toFixed(2);
  if (!_blobMats.has(k)) {
    _blobMats.set(k, new THREE.MeshBasicMaterial({
      map: blobTexture(),
      transparent: true,
      opacity,
      depthWrite: false,
    }));
  }
  return _blobMats.get(k);
}

/** Local-space footprint (x/z) of a group's meshes, in the group's own frame. */
const _box = new THREE.Box3();
const _inv = new THREE.Matrix4();
function localFootprint(group) {
  group.updateWorldMatrix(true, true);
  _inv.copy(group.matrixWorld).invert();
  _box.makeEmpty();
  const tmp = new THREE.Box3();
  group.traverse((m) => {
    if (!m.isMesh || !m.geometry) return;
    // Skip meshes that are themselves transparent decals/blobs.
    if (m.material && m.material.transparent && m.material.opacity < 0.6) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld).applyMatrix4(_inv);
    _box.union(tmp);
  });
  if (_box.isEmpty()) return null;
  return _box;
}

function attachBlob(group, opacity, y = 0.03, pad = 1.18, minArea = 0.35, maxArea = 90) {
  const fp = localFootprint(group);
  if (!fp) return null;
  const sx = fp.max.x - fp.min.x;
  const sz = fp.max.z - fp.min.z;
  const h = fp.max.y - fp.min.y;
  const area = sx * sz;
  // Skip tiny props, huge ground-covering things, and anything floating high.
  if (area < minArea || area > maxArea || h > 14 || fp.min.y > 2.5) return null;
  const blob = new THREE.Mesh(_blobGeo, blobMaterial(opacity));
  blob.rotation.x = -Math.PI / 2;
  blob.position.set((fp.min.x + fp.max.x) / 2, y, (fp.min.z + fp.max.z) / 2);
  blob.scale.set(Math.max(sx * pad, 0.4), Math.max(sz * pad, 0.4), 1);
  blob.renderOrder = 2;
  blob.userData.contactShadow = true;
  group.add(blob);
  return blob;
}

export class ContactShadows {
  constructor(scene) {
    this.scene = scene;
    this._hero = null;
    this._getX = null;
    this._getY = null;
    this._heroBaseOpacity = 0.42;
  }

  /** Hero blob follows the runner. getX/getY are () => number. */
  setHero(getX, getY) {
    this._getX = getX;
    this._getY = getY || (() => 0);
    const blob = new THREE.Mesh(_blobGeo, blobMaterial(this._heroBaseOpacity));
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(0, 0.02, 0);
    blob.scale.set(1.7, 2.3, 1);
    blob.renderOrder = 2;
    blob.userData.contactShadow = true;
    this.scene.add(blob);
    this._hero = blob;
  }

  /** Blob under every treadmill-recycled WorldBuilder prop (palms, lamps,
   *  benches, parked bikes, peds, ...). Children ride the treadmill.
   *  Height is surface-aware: road y=0, sidewalk top y=0.1, grass y=-0.05. */
  attachWorld(world) {
    if (!world || !Array.isArray(world.scenery)) return 0;
    let n = 0;
    for (const obj of world.scenery) {
      const ax = Math.abs(obj.position.x);
      const y = ax <= 5.3 ? 0.02 : ax <= 8.0 ? 0.12 : -0.03;
      if (attachBlob(obj, 0.3, y)) n++;
    }
    return n;
  }

  /** Blobs under the landmark buildings. LandmarkManager exposes
   *  `.landmarks` = [{ def, group }]; blobs ride the landmark slide.
   *  Buildings sit on grass (y=-0.05), so blobs sit just above it. */
  attachLandmarks(landmarkManager) {
    if (!landmarkManager || !Array.isArray(landmarkManager.landmarks)) return 0;
    let n = 0;
    for (const { group } of landmarkManager.landmarks) {
      if (attachBlob(group, 0.38, -0.03, 1.12, 4, 400)) n++;
    }
    return n;
  }

  /** Blob under the academy gate (AcademyGate exposes `.group`).
   *  The gate spans the road (y=0). */
  attachGate(gate) {
    if (!gate || !gate.group) return 0;
    return attachBlob(gate.group, 0.32, 0.02, 1.15, 2, 200) ? 1 : 0;
  }

  /** Per-frame: hero blob tracks x and fades/shrinks with jump height. */
  update() {
    if (!this._hero || !this._getX) return;
    const x = this._getX();
    const y = Math.max(0, this._getY());
    this._hero.position.x = x;
    const fade = 1 / (1 + y * 1.4);
    this._hero.material = blobMaterial(this._heroBaseOpacity * fade);
    const s = 1 + y * 0.12;
    this._hero.scale.set(1.7 * s, 2.3 * s, 1);
  }
}
