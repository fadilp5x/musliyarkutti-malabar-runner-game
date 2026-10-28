import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AVATAR_ANIMS, PlayerAvatar, SERVER_ANIM_POSES } from '../src/game/PlayerAvatar.js';

describe('server animation mapping', () => {
  it('maps every animation name accepted by multiplayer to an existing avatar pose', () => {
    const avatar = new PlayerAvatar(new THREE.Scene());
    for (const [serverName, poseName] of Object.entries(SERVER_ANIM_POSES)) {
      expect(AVATAR_ANIMS, `server animation ${serverName}`).toContain(poseName);
      avatar.setAnim(serverName);
      expect(avatar.anim).toBe(poseName);
    }
    expect(Object.keys(SERVER_ANIM_POSES).sort()).toEqual(['fall', 'glide', 'jetpack', 'jump', 'run', 'slide']);
  });

  it('keeps limb transforms bounded when switching repeatedly between poses', () => {
    const avatar = new PlayerAvatar(new THREE.Scene());
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (const pose of ['run', 'jump', 'slide', 'glide', 'jetpack', 'fall', 'stumble']) {
        avatar.setAnim(pose);
        for (let frame = 0; frame < 30; frame += 1) avatar.update(1 / 120);
      }
    }
    for (const joint of [avatar.parts.legL, avatar.parts.legR, avatar.parts.kneeL, avatar.parts.kneeR]) {
      expect(joint.scale.toArray()).toEqual([1, 1, 1]);
      expect(Number.isFinite(joint.rotation.x)).toBe(true);
      expect(Math.abs(joint.rotation.x)).toBeLessThan(2);
    }
  });
});
