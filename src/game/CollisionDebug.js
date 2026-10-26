// CollisionDebug.js — dev-only collision overlay.
//
// Activated with ?debug=collisions (Game.js loads it via dynamic import, so it
// never ships in the production bundle path). Renders a Box3Helper for every
// live obstacle AABB plus the player AABB, persistent lane guide lines, and
// logs collision events to the console.

import * as THREE from 'three';
import { LANES } from './CollisionSystem.js';

const KIND_COLORS = {
  portal: 0x35e0ff,
  block: 0xff3333,
  stumble: 0xffaa00,
  jump: 0xffff00,
  slide: 0x00ccff,
};

export class CollisionDebug {
  constructor(root, events) {
    this.root = root;
    this.group = new THREE.Group();
    this.group.name = 'collision-debug';
    this.root.add(this.group);
    this._obHelpers = [];
    this._playerHelper = null;
    this._laneLines = [];
    this._drawLaneGuides();
    this._logEvents(events);
  }

  _logEvents(events) {
    if (!events || typeof events.on !== 'function') return;
    for (const name of ['crash', 'stumble', 'nearmiss']) {
      events.on(name, (data) => console.log(`[collision-debug] event "${name}"`, data));
    }
  }

  _drawLaneGuides() {
    const mat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.45 });
    for (const x of LANES) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0.02, -130),
        new THREE.Vector3(x, 0.02, 12),
      ]);
      const line = new THREE.Line(geo, mat);
      this.group.add(line);
      this._laneLines.push(line);
    }
  }

  _box3(b) {
    return new THREE.Box3(
      new THREE.Vector3(b.x0, b.y0, b.z0),
      new THREE.Vector3(b.x1, b.y1, b.z1)
    );
  }

  _disposeHelper(h) {
    if (!h) return;
    this.group.remove(h);
    if (h.geometry) h.geometry.dispose();
    if (h.material) h.material.dispose();
  }

  /**
   * @param {object} playerBox AABB from PlayerController.getBox()
   * @param {Array} obstacleBoxes AABBs from ObstacleManager.debugBoxes()
   */
  update(playerBox, obstacleBoxes) {
    for (const h of this._obHelpers) this._disposeHelper(h);
    this._obHelpers = [];
    this._disposeHelper(this._playerHelper);
    this._playerHelper = null;

    if (playerBox) {
      this._playerHelper = new THREE.Box3Helper(this._box3(playerBox), 0x00ff88);
      this.group.add(this._playerHelper);
    }
    for (const b of obstacleBoxes || []) {
      const color = KIND_COLORS[b.kind] !== undefined ? KIND_COLORS[b.kind] : 0xffffff;
      const helper = new THREE.Box3Helper(this._box3(b), color);
      this.group.add(helper);
      this._obHelpers.push(helper);
    }
  }

  dispose() {
    for (const h of this._obHelpers) this._disposeHelper(h);
    this._obHelpers = [];
    this._disposeHelper(this._playerHelper);
    this._playerHelper = null;
    for (const l of this._laneLines) this._disposeHelper(l);
    this._laneLines = [];
    if (this.root) this.root.remove(this.group);
  }
}
