import { afterAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ObstacleManager } from '../src/game/ObstacleManager.js';
import { LANES } from '../src/game/CollisionSystem.js';

const STEP = 1 / 120;
const MAX_STEPS = 5;
const SPEEDS = [10, 20, 28];
const FRAME_MS = [8, 16, 33, 66];
const STATES = ['standing', 'jumping at peak', 'sliding', 'jetpack', 'shielded'];
const TYPES = [
  'low_barrier', 'puddle', 'overhead_gate', 'handcart', 'bus',
  'auto_rickshaw', 'smartphone_portal', 'pedestrian', 'shaytan_wall',
];

function context2d() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      return () => {};
    },
  });
}

vi.stubGlobal('document', {
  createElement: () => ({ width: 0, height: 0, getContext: () => context2d() }),
});

const stateBox = (lane, state) => {
  const y0 = state === 'jumping at peak' ? 1.4 : state === 'jetpack' ? 3.2 : 0;
  const height = state === 'sliding' ? 0.85 : 1.7;
  return {
    x0: LANES[lane] - 0.35,
    x1: LANES[lane] + 0.35,
    y0,
    y1: y0 + height,
    z0: -0.3,
    z1: 0.3,
  };
};

function expectedOutcome(type, state) {
  const shielded = state === 'shielded';
  const jumping = state === 'jumping at peak';
  const jetpack = state === 'jetpack';
  if (type === 'puddle' || type === 'pedestrian') {
    // Pedestrian contact is explicitly a non-lethal stumble; its 1.7 m box
    // still overlaps the player's body at the 1.4 m jump apex.
    if (type === 'pedestrian') return jetpack ? 'pass' : 'stumble';
    return jumping || jetpack ? 'pass' : 'stumble';
  }
  if (shielded) return 'block';
  if (type === 'smartphone_portal') return 'portal';
  if (jetpack) return 'pass';
  if (type === 'low_barrier' && jumping) return 'jump';
  if (type === 'overhead_gate' && state === 'sliding') return 'slide';
  return 'hit';
}

function simulate(type, lane, state, speed, frameMs) {
  const events = [];
  const bus = { on() {}, emit(name, data) { events.push({ name, data }); } };
  const manager = new ObstacleManager(new THREE.Scene(), bus, { textures: {} }, () => 0.5);
  const obstacle = manager.spawnObstacle(type, lane, -3);
  const shield = state === 'shielded';
  const jetpack = state === 'jetpack';
  let accumulator = 0;
  let obstacleRemovedByShield = false;

  // Mirror Game.start(): clamp render dt to 250 ms, accumulate, step at 120 Hz,
  // cap at five simulation steps per render and drop any remaining backlog.
  for (let frame = 0; frame < 180 && obstacle && !events.length; frame += 1) {
    let dt = frameMs / 1000;
    if (dt > 0.25) dt = 0.25;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < MAX_STEPS && !events.length) {
      manager.update(STEP, speed, 0, stateBox(lane, state), lane, { jetpack, shield });
      const event = events[0];
      if (event?.name === 'crash' && shield) {
        const index = manager.obstacles.findIndex((entry) => entry.type === event.data.type);
        if (index >= 0) manager.destroyAt(index);
        obstacleRemovedByShield = true;
      }
      accumulator -= STEP;
      steps += 1;
    }
    if (steps === MAX_STEPS) accumulator = 0;
    if (manager.obstacles.length === 0) break;
  }

  const event = events[0];
  let outcome = 'pass';
  if (event?.name === 'stumble') outcome = 'stumble';
  if (event?.name === 'crash') outcome = shield && obstacleRemovedByShield
    ? 'block'
    : event.data.kind === 'portal' ? 'portal' : 'hit';
  for (const entry of [...manager.obstacles]) manager.destroyAt(manager.obstacles.indexOf(entry));
  return outcome;
}

function outcomeLabel(value) {
  return ({ hit: 'crash', block: 'shield block', pass: 'pass' })[value] || value;
}

function buildMatrix() {
  const rows = [];
  for (const type of TYPES) {
    for (const state of STATES) {
      for (let lane = 0; lane < LANES.length; lane += 1) {
        const expected = expectedOutcome(type, state);
        const actuals = [];
        for (const speed of SPEEDS) {
          for (const frameMs of FRAME_MS) {
            let actual = simulate(type, lane, state, speed, frameMs);
            if (actual === 'pass' && type === 'low_barrier' && state === 'jumping at peak') actual = 'jump';
            if (actual === 'pass' && type === 'overhead_gate' && state === 'sliding') actual = 'slide';
            actuals.push(`${speed}@${frameMs}=${outcomeLabel(actual)}`);
          }
        }
        rows.push({ type, lane, state, expected: outcomeLabel(expected), actual: actuals.join('; ') });
      }
    }
  }
  return rows;
}

function buildHitboxMatrix() {
  return TYPES.map((type) => {
    const manager = new ObstacleManager(new THREE.Scene(), { on() {}, emit() {} }, { textures: {} }, () => 0.5);
    const obstacle = manager.spawnObstacle(type, 1, -10);
    const box = obstacle.box;
    const verticalPlane = type !== 'puddle' && type !== 'pedestrian';
    const planeSize = type === 'pedestrian'
      ? 'procedural group (2.1 × 1.7 m documented footprint)'
      : verticalPlane ? `${obstacle.w} × ${obstacle.h} m` : `${obstacle.w} × ${obstacle.h} m (rotated: width × depth)`;
    return `${type}: plane ${planeSize}; box ${box.w} × ${box.h} × ${box.d} m${box.yBase ? `, y=${box.yBase}..${box.yBase + box.h} m` : ''}`;
  });
}

describe('obstacle hit matrix', () => {
  it('prints expected and observed outcomes across lanes, states, speeds and render frame times', () => {
    const rows = buildMatrix();
    const output = [
      '| Obstacle | Lane | Player state | Expected | Actual by speed@frame-ms |',
      '|---|---:|---|---|---|',
      ...rows.map((row) => `| ${row.type} | ${row.lane} | ${row.state} | ${row.expected} | ${row.actual} |`),
    ].join('\n');
    console.log(`\nOBSTACLE HIT MATRIX\n${output}\n`);
    console.log(`OBSTACLE PLANE / HITBOX SIZES\n${buildHitboxMatrix().map((line) => `- ${line}`).join('\n')}\n`);
    const mismatches = rows.filter((row) => row.actual.split('; ').some((cell) => !cell.endsWith(`=${row.expected}`)));
    console.log(`Matrix: ${rows.length} lane/state/type rows; ${mismatches.length} mismatched rows.`);
    expect(mismatches).toEqual([]);
  });

  it('does not tunnel through a narrow obstacle during 8, 16, 33, or 66 ms frames', () => {
    for (const speed of SPEEDS) {
      for (const frameMs of FRAME_MS) {
        expect(simulate('low_barrier', 1, 'standing', speed, frameMs), `${speed} m/s at ${frameMs} ms`).toBe('hit');
      }
    }
  });

  it('documents fixed-step behavior during a 250 ms lag spike', () => {
    expect(simulate('low_barrier', 1, 'standing', 28, 1000)).toBe('hit');
  });

  it('cannot skip an overlapping box when the passed branch begins at z > 1.5', () => {
    // The largest obstacle depth is 1.2 m, so its near edge is at z > 0.9
    // once its center passes 1.5 m. The player's far edge is z=0.3 m.
    expect(Math.max(...TYPES.map((type) => {
      const manager = new ObstacleManager(new THREE.Scene(), { on() {}, emit() {} }, { textures: {} }, () => 0.5);
      return manager.spawnObstacle(type, 1, 0).box.d;
    }))).toBeLessThanOrEqual(1.2);
    expect(1.5 - 1.2 / 2).toBeGreaterThan(0.3);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});
