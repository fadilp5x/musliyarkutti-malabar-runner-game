import * as THREE from 'three';

// CameraController — damped follow camera with trauma-based shake.
// Modes: 'library' | 'chase' | 'runner' | 'cinematic'
// 'cinematic' leaves the position to the caller (LibraryCinematic drives it
// directly) and only applies trauma shake.
// update(dt, playerX, mode, speed): the optional speed (m/s) is used in
// 'runner' mode only — damping tightens slightly as speed rises and the
// camera lifts a touch for readability, both kept subtle to avoid nausea.

const DAMP = 5; // lerp factor per second (base)

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.trauma = 0;
    this._pos = new THREE.Vector3(0, 4.2, 7.5);
    this._look = new THREE.Vector3(0, 1.2, -12);
    this._tmpLook = new THREE.Vector3();
  }

  // Add trauma (0..1). Screen shake scales with trauma^2 and decays over time.
  shake(amount) {
    this.trauma = Math.min(1, Math.max(0, this.trauma + amount));
  }

  update(dt, playerX, mode, speed = 0) {
    let px, py, pz, lx, ly, lz;
    // 0..1 across the runner speed band (8 -> 28 m/s); 0 when no speed given.
    const speedN = Math.min(1, Math.max(0, (speed - 8) / 20));
    if (mode === 'library') {
      // Calm view of the reading desk
      px = 0; py = 2.4; pz = 5.4;
      lx = 0; ly = 1.1; lz = -2.0;
    } else if (mode === 'chase') {
      // Behind the hero, sprinting down the aisle
      px = playerX * 0.5; py = 2.8; pz = 6.0;
      lx = playerX * 0.6; ly = 1.4; lz = -10.0;
    } else if (mode === 'cinematic') {
      // Cinematic: caller drives camera.position directly; we only apply
      // trauma shake on top. Sync _pos/_look to the current camera so the
      // next non-cinematic mode damps from here instead of snapping.
      this._pos.copy(this.camera.position);
      this._look.set(0, 1.2, -6);
      // px/lx unused in cinematic mode (position driven by caller)
      px = this._pos.x; py = this._pos.y; pz = this._pos.z;
      lx = 0; ly = 1.2; lz = -6;
    } else {
      // Runner follow (contract): (playerX*0.55, 4.2, 7.5) → (playerX*0.7, 1.2, -12)
      // At speed: a touch higher (+0.5 m) and looking a touch further ahead
      // (-2 m) for readability; damping tightens 5 -> 7 to keep the hero
      // framed without introducing swim.
      px = playerX * 0.55; py = 4.2 + speedN * 0.5; pz = 7.5;
      lx = playerX * 0.7; ly = 1.2; lz = -12.0 - speedN * 2.0;
    }

    const damp = mode === 'runner' ? DAMP + speedN * 2 : DAMP;
    const k = dt <= 0 ? 1 : 1 - Math.exp(-damp * dt);
    if (mode !== 'cinematic') {
      this._pos.x += (px - this._pos.x) * k;
      this._pos.y += (py - this._pos.y) * k;
      this._pos.z += (pz - this._pos.z) * k;
      this._look.x += (lx - this._look.x) * k;
      this._look.y += (ly - this._look.y) * k;
      this._look.z += (lz - this._look.z) * k;
    }

    // Trauma decay + shake offsets
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma;
    const ox = s * 0.7 * (Math.random() * 2 - 1);
    const oy = s * 0.5 * (Math.random() * 2 - 1);

    if (mode === 'cinematic') {
      // Add shake to the caller-driven position
      this.camera.position.x += ox;
      this.camera.position.y += oy;
    } else {
      this.camera.position.set(this._pos.x + ox, this._pos.y + oy, this._pos.z);
    }
    this._tmpLook.set(this._look.x + ox * 0.5, this._look.y + oy * 0.5, this._look.z);
    this.camera.lookAt(this._tmpLook);
  }
}
