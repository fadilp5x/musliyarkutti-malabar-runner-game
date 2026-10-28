import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CollisionDebug } from '../src/game/CollisionDebug.js';
import { PlayerController } from '../src/game/PlayerController.js';

describe('collision debug and reusable bounds', () => {
  it('reuses Box3 helpers and their bounds across updates', () => {
    const debug = new CollisionDebug(new THREE.Group(), { on() {} });
    const player = { x0: -0.35, x1: 0.35, y0: 0, y1: 1.7, z0: -0.3, z1: 0.3 };
    const obstacle = { type: 'low_barrier', kind: 'jump', x0: -1, x1: 1, y0: 0, y1: 1, z0: -1, z1: -0.6 };
    debug.update(player, [obstacle]);
    const playerHelper = debug._playerHelper;
    const obstacleHelper = debug._obHelpers[0];
    const obstacleBounds = debug._obBoxes[0];

    debug.update({ ...player, y0: 0.4, y1: 2.1 }, [{ ...obstacle, z0: -0.2, z1: 0.2 }]);
    expect(debug._playerHelper).toBe(playerHelper);
    expect(debug._obHelpers[0]).toBe(obstacleHelper);
    expect(debug._obBoxes[0]).toBe(obstacleBounds);
    expect(debug._playerBox.min.y).toBe(0.4);
    expect(obstacleBounds.min.z).toBe(-0.2);
    debug.dispose();
  });

  it('reuses the player AABB object rather than allocating on each read', () => {
    const avatar = { reset() {}, group: { position: { set() {} } } };
    const player = new PlayerController(avatar, { emit() {} });
    const first = player.getBox();
    player.y = 1.2;
    const second = player.getBox();
    expect(second).toBe(first);
    expect(second.y0).toBe(1.2);
  });
});
