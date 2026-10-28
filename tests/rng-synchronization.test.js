import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectibleManager } from '../src/game/CollectibleManager.js';
import { ObstacleManager } from '../src/game/ObstacleManager.js';
import { PowerUpManager } from '../src/game/PowerUpManager.js';
import { VoucherManager } from '../src/game/VoucherManager.js';
import { makeStreams } from '../src/game/rng.js';
import { PartyRace } from '../src/party/PartyRace.js';

const STEP = 1 / 120;

function mockCanvas() {
  const gradient = { addColorStop() {} };
  const context = {
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    measureText: (text) => ({ width: text.length * 12 }),
    fillRect() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
    fillText() {}, strokeText() {}, roundRect() {},
  };
  return { width: 0, height: 0, getContext: () => context };
}

function track(manager, method, sequence, currentDistance, typeFromResult = () => null) {
  const original = manager[method].bind(manager);
  manager[method] = (...args) => {
    const result = original(...args);
    const item = typeFromResult(result, args);
    if (item) sequence.push({
      type: item.type,
      lane: item.lane,
      distance: Math.round(currentDistance() * 10000) / 10000,
    });
    return result;
  };
}

function simulate(renderFps, seed, round = 1) {
  vi.stubGlobal('document', { createElement: () => mockCanvas() });
  const streams = makeStreams(seed, round);
  const scene = new THREE.Group();
  const events = { on() {}, emit() {} };
  let distance = 0;
  const currentDistance = () => distance;
  const sequences = { obstacles: [], coins: [], powerups: [], vouchers: [] };

  const obstacles = new ObstacleManager(scene, events, { textures: {} }, streams.obstacles);
  track(obstacles, 'spawnObstacle', sequences.obstacles, currentDistance,
    (_result, [type, lane]) => ({ type, lane }));
  const collectibles = new CollectibleManager(scene, events, { textures: {} });
  collectibles.setRandomStreams({ coins: streams.coins, vouchers: streams.vouchers });
  track(collectibles, '_spawnCoin', sequences.coins, currentDistance,
    (_result, [lane]) => ({ type: 'coin', lane }));
  track(collectibles, 'spawnVoucher', sequences.vouchers, currentDistance,
    (store, [lane]) => ({ type: store, lane }));
  const powerups = new PowerUpManager(scene, events, streams.powerups);
  const vouchers = new VoucherManager(streams.vouchers);

  obstacles.reset();
  collectibles.reset();
  powerups.reset();
  vouchers.reset();

  let accumulator = 0;
  let frames = 0;
  while (distance < 501 && frames < renderFps * 60) {
    accumulator += 1 / renderFps;
    frames++;
    while (accumulator + 1e-10 >= STEP && distance < 501) {
      const speed = Math.min(10 + distance * 0.0125, 28);
      powerups.update(STEP, speed, distance, null, null);
      obstacles.update(STEP, speed, distance, null, 1, {});
      collectibles.spawnPatterns(distance);
      collectibles.update(STEP, speed, null, {});

      const freeLanes = obstacles.getFreeLanes();
      if (vouchers.shouldSpawn(distance)) {
        const lane = freeLanes.length
          ? freeLanes[(vouchers.rng() * freeLanes.length) | 0]
          : 1;
        collectibles.spawnVoucher(lane);
        vouchers.recordSpawn(distance);
      }
      const previousPowerupCount = powerups.pickups.length;
      powerups.trySpawn(distance, freeLanes);
      if (powerups.pickups.length > previousPowerupCount) {
        const pickup = powerups.pickups.at(-1);
        sequences.powerups.push({
          type: pickup.type,
          lane: pickup.lane,
          distance: Math.round(distance * 10000) / 10000,
        });
      }

      distance += speed * STEP;
      accumulator -= STEP;
    }
  }

  expect(distance).toBeGreaterThanOrEqual(500);
  return sequences;
}

afterEach(() => vi.unstubAllGlobals());

describe('seeded party race spawn streams', () => {
  it('produces identical manager sequences at 60 and 144 render fps through 500 m', () => {
    const at60 = simulate(60, 12345, 2);
    expect(at60).toEqual(simulate(144, 12345, 2));
    for (const name of ['obstacles', 'coins', 'powerups', 'vouchers']) {
      expect(at60[name].length, `${name} should spawn during the test run`).toBeGreaterThan(0);
    }
  });

  it('changes the generated spawn sequence when the room seed changes', () => {
    const firstSeed = simulate(60, 12345, 2);
    const secondSeed = simulate(60, 54321, 2);
    for (const name of ['obstacles', 'coins', 'powerups', 'vouchers']) {
      expect(firstSeed[name]).not.toEqual(secondSeed[name]);
    }
  });

  it('derives independent, repeatable streams for each race round', () => {
    const first = makeStreams(12345, 1);
    const repeat = makeStreams(12345, 1);
    const nextRound = makeStreams(12345, 2);
    const names = ['obstacles', 'coins', 'powerups', 'vouchers'];
    for (const name of names) {
      expect(Array.from({ length: 5 }, () => first[name]()))
        .toEqual(Array.from({ length: 5 }, () => repeat[name]()));
    }
    expect(makeStreams(12345, 1).obstacles()).not.toBe(nextRound.obstacles());

    const unaffectedObstacles = makeStreams(12345, 1).obstacles;
    const consumedCoins = makeStreams(12345, 1);
    for (let i = 0; i < 1000; i++) consumedCoins.coins();
    expect(consumedCoins.obstacles()).toBe(unaffectedObstacles());
  });

  it('passes each room round seed to the game when starting that round', () => {
    const startPartyRace = vi.fn();
    const partyRace = {
      room: { phase: 'running', seed: 12345, round: 1 },
      roomCode: 'ABC123',
      _startedForRoom: null,
      finishedForRoom: null,
      game: { state: 'LIBRARY', startPartyRace },
    };

    PartyRace.prototype._ensureStarted.call(partyRace);
    expect(startPartyRace).toHaveBeenLastCalledWith({ seed: 12345, round: 1 });

    partyRace.room.round = 2;
    partyRace.game.state = 'GAMEOVER';
    PartyRace.prototype._ensureStarted.call(partyRace);
    expect(startPartyRace).toHaveBeenLastCalledWith({ seed: 12345, round: 2 });
  });
});
