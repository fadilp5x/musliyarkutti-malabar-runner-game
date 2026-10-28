import * as THREE from 'three';

// CameraController — damped follow camera with trauma-based shake.
// Modes: 'library' | 'chase' | 'runner' | 'cinematic'
// 'cinematic' leaves the pose to the caller (CinematicIntro drives it
// directly); the first runner frame transitions from that pose independently.
// update(dt, playerX, mode, speed): the optional speed (m/s) is used in
// 'runner' mode only — damping tightens slightly as speed rises and the
// camera lifts a touch for readability, both kept subtle to avoid nausea.

const DAMP = 5; // lerp factor per second (base)
export const CAMERA_STATES = Object.freeze({
  INTRO_CUTSCENE: 'INTRO_CUTSCENE',
  TRANSITION_TO_PLAY: 'TRANSITION_TO_PLAY',
  GAMEPLAY: 'GAMEPLAY',
});

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.trauma = 0;
    this._pos = new THREE.Vector3(0, 4.2, 7.5);
    this._look = new THREE.Vector3(0, 1.2, -12);
    this.currentLookAt = this._look;
    this._tmpLook = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._desiredPos = new THREE.Vector3();
    this._desiredLookAt = new THREE.Vector3();
    this._cinematicShakeX = 0;
    this._cinematicShakeY = 0;
    this.state = CAMERA_STATES.GAMEPLAY;
  }

  // Add trauma (0..1). Screen shake scales with trauma^2 and decays over time.
  shake(amount) {
    this.trauma = Math.min(1, Math.max(0, this.trauma + amount));
  }

  update(dt, playerX, mode, speed = 0) {
    let px, py, pz, lx, ly, lz;
    // 0..1 across the runner speed band (8 -> 28 m/s); 0 when no speed given.
    const speedN = Math.min(1, Math.max(0, (speed - 8) / 20));
    if (mode === 'cinematic') {
      // The intro controller owns the camera pose. Capture its pose and
      // forward target, but never run gameplay follow tracking here.
      this.state = CAMERA_STATES.INTRO_CUTSCENE;
      this.camera.position.x -= this._cinematicShakeX;
      this.camera.position.y -= this._cinematicShakeY;
      this._cinematicShakeX = 0;
      this._cinematicShakeY = 0;
      this._pos.copy(this.camera.position);
      this.camera.getWorldDirection(this._direction);
      this.currentLookAt.copy(this.camera.position).addScaledVector(this._direction, 10);
      this._look.copy(this.currentLookAt);
      this.camera.lookAt(this.currentLookAt);
      this.trauma = Math.max(0, this.trauma - dt * 1.4);
      const shake = this.trauma * this.trauma;
      this._cinematicShakeX = shake * 0.7 * (Math.random() * 2 - 1);
      this._cinematicShakeY = shake * 0.5 * (Math.random() * 2 - 1);
      this.camera.position.x += this._cinematicShakeX;
      this.camera.position.y += this._cinematicShakeY;
      return;
    }
    if (mode === 'library') {
      // Calm view of the reading desk
      px = 0; py = 2.4; pz = 5.4;
      lx = 0; ly = 1.1; lz = -2.0;
    } else if (mode === 'chase') {
      // Behind the hero, sprinting down the aisle
      px = playerX * 0.5; py = 2.8; pz = 6.0;
      lx = playerX * 0.6; ly = 1.4; lz = -10.0;
    } else {
      // Runner follow (contract): (playerX*0.55, 4.2, 7.5) → (playerX*0.7, 1.2, -12)
      // At speed: a touch higher (+0.5 m) and looking a touch further ahead
      // (-2 m) for readability; damping tightens 5 -> 7 to keep the hero
      // framed without introducing swim.
      px = playerX * 0.55; py = 4.2 + speedN * 0.5; pz = 7.5;
      lx = playerX * 0.7; ly = 1.2; lz = -12.0 - speedN * 2.0;
    }

    if (this.state === CAMERA_STATES.INTRO_CUTSCENE) this.state = CAMERA_STATES.TRANSITION_TO_PLAY;
    const transitioning = this.state === CAMERA_STATES.TRANSITION_TO_PLAY;
    const damp = transitioning ? 8 : (mode === 'runner' ? DAMP + speedN * 2 : DAMP);
    const k = dt <= 0 ? 1 : 1 - Math.exp(-damp * dt);
    this._desiredPos.set(px, py, pz);
    this._desiredLookAt.set(lx, ly, lz);
    this._pos.x += (px - this._pos.x) * k;
    this._pos.y += (py - this._pos.y) * k;
    this._pos.z += (pz - this._pos.z) * k;
    this.currentLookAt.x += (lx - this.currentLookAt.x) * k;
    this.currentLookAt.y += (ly - this.currentLookAt.y) * k;
    this.currentLookAt.z += (lz - this.currentLookAt.z) * k;
    if (transitioning && this._pos.distanceToSquared(this._desiredPos) < 0.0025 &&
        this.currentLookAt.distanceToSquared(this._desiredLookAt) < 0.0025) {
      this.state = CAMERA_STATES.GAMEPLAY;
    }

    // Trauma decay + shake offsets
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma;
    const ox = s * 0.7 * (Math.random() * 2 - 1);
    const oy = s * 0.5 * (Math.random() * 2 - 1);

    this.camera.position.set(this._pos.x + ox, this._pos.y + oy, this._pos.z);
    this._tmpLook.set(this.currentLookAt.x + ox * 0.5, this.currentLookAt.y + oy * 0.5, this.currentLookAt.z);
    this.camera.lookAt(this._tmpLook);
  }
}
