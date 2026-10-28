import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectibleManager } from '../src/game/CollectibleManager.js';
import { ObstacleManager } from '../src/game/ObstacleManager.js';
import { PowerUpManager } from '../src/game/PowerUpManager.js';
import { VoucherManager } from '../src/game/VoucherManager.js';
import { makeStreams } from '../src/game/rng.js';
import { SpawnEventHash } from '../src/game/SpawnEventHash.js';

const STEP = 1 / 120;

function mockCanvas() {
  const gradient = { addColorStop() {} };
  const context = {
    createRadialGradient: () => gradient, createLinearGradient: () => gradient,
    measureText: (text) => ({ width: text.length * 12 }), fillRect() {}, strokeRect() {},
    beginPath() {}, arc() {}, fill() {}, stroke() {}, fillText() {}, strokeText() {}, roundRect() {},
  };
  return { width: 0, height: 0, getContext: () => context };
}

function simulate(renderFps, seed) {
  vi.stubGlobal('document', { createElement: () => mockCanvas() });
  const streams = makeStreams(seed, 1);
  const scene = new THREE.Group();
  const events = { on() {}, emit() {} };
  const hash = new SpawnEventHash();
  hash.reset(seed, 1);
  let distance = 0;
  const obstacles = new ObstacleManager(scene, events, { textures: {} }, streams.obstacles);
  obstacles.onSpawn = (event) => hash.record(event);
  const collectibles = new CollectibleManager(scene, events, { textures: {} });
  collectibles.setRandomStreams({ coins: streams.coins, vouchers: streams.vouchers });
  collectibles.onSpawn = (event) => hash.record(event);
  const powerups = new PowerUpManager(scene, events, streams.powerups);
  powerups.onSpawn = (event) => hash.record(event);
  const vouchers = new VoucherManager(streams.vouchers);
  obstacles.reset();
  collectibles.reset();
  powerups.reset();
  vouchers.reset();

  let accumulator = 0;
  let frames = 0;
  while (distance < 1000 && frames < renderFps * 90) {
    accumulator += 1 / renderFps;
    frames++;
    while (accumulator + 1e-10 >= STEP && distance < 1000) {
      const speed = Math.min(10 + distance * 0.0125, 28);
      powerups.update(STEP, speed, distance, null, null);
      obstacles.update(STEP, speed, distance, null, 1, {});
      collectibles.spawnPatterns(distance);
      collectibles.update(STEP, speed, null, {});
      const freeLanes = obstacles.getFreeLanes();
      if (vouchers.shouldSpawn(distance)) {
        const lane = freeLanes.length ? freeLanes[(vouchers.rng() * freeLanes.length) | 0] : 1;
        collectibles.spawnVoucher(lane, distance);
        vouchers.recordSpawn(distance);
      }
      powerups.trySpawn(distance, freeLanes);
      distance += speed * STEP;
      accumulator -= STEP;
    }
  }
  return { hash: hash.value(), events: hash.count, distance };
}

afterEach(() => vi.unstubAllGlobals());

describe('party spawn debug hash', () => {
  it('matches for same seed at 60 and 144 fps through 1000 m', () => {
    const at60 = simulate(60, 8675309);
    const at144 = simulate(144, 8675309);
    expect(at60.distance).toBeGreaterThanOrEqual(1000);
    expect(at144.distance).toBeGreaterThanOrEqual(1000);
    expect(at60.events).toBeGreaterThan(0);
    expect(at60.hash).toBe(at144.hash);
  });

  it('changes the final spawn hash with a different seed', () => {
    expect(simulate(60, 8675309).hash).not.toBe(simulate(60, 123456).hash);
  });
});
