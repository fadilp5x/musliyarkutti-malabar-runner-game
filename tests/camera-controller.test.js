import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraController, CAMERA_STATES } from '../src/game/CameraController.js';

describe('CameraController intro handoff', () => {
  it('isolates the intro pose and damps position and look target into gameplay', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 180);
    camera.position.set(1, 3, 8);
    const controller = new CameraController(camera);

    controller.update(1 / 60, 0, 'cinematic');
    expect(controller.state).toBe(CAMERA_STATES.INTRO_CUTSCENE);
    expect(camera.position.x).toBeCloseTo(1);
    expect(camera.position.y).toBeCloseTo(3);
    expect(camera.position.z).toBeCloseTo(8);

    const introPosition = camera.position.clone();
    const introLookAt = controller.currentLookAt.clone();
    controller.update(1 / 60, 0, 'runner', 10);
    expect(controller.state).toBe(CAMERA_STATES.TRANSITION_TO_PLAY);
    expect(camera.position.distanceTo(introPosition)).toBeGreaterThan(0);
    expect(camera.position.distanceTo(introPosition)).toBeLessThan(1);
    expect(controller.currentLookAt.distanceTo(introLookAt)).toBeGreaterThan(0);
    expect(controller.currentLookAt.distanceTo(introLookAt)).toBeLessThan(2);
  });

  it('uses the requested near and far clipping range', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 180);
    expect(camera.near).toBe(0.5);
    expect(camera.far).toBe(180);
  });
});
