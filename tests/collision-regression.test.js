// tests/collision-regression.test.js — regression tests for the collision fixes:
// pedestrian crowd feedback, deadly smartphone portal, shield absorb, row fairness.
// Runs in node (three.js scene graph only); canvas textures are stubbed.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { ObstacleManager } from '../src/game/ObstacleManager.js';
import { LANES, rowIsFair } from '../src/game/CollisionSystem.js';
import { Game } from '../src/game/Game.js';
import { STATES } from '../src/game/GameState.js';
import { AudioManager } from '../src/game/AudioManager.js';

// ---------- minimal DOM stub (procedural canvas textures) ----------
function makeCtx2d() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, p) {
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
      if (p === 'measureText') return () => ({ width: 12 });
      if (p === Symbol.toPrimitive) return () => 0;
      return () => {};
    },
    set() { return true; },
  });
}
function fakeElement() {
  return { width: 0, height: 0, style: {}, offsetWidth: 0, getContext: () => makeCtx2d(), appendChild() {} };
}
globalThis.document = {
  createElement: () => fakeElement(),
  getElementById: () => null,
  body: { appendChild() {} },
};

// ---------- seeded rng ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- event bus stub ----------
function makeBus() {
  const handlers = {};
  const log = [];
  return {
    log,
    on(e, f) { (handlers[e] = handlers[e] || []).push(f); },
    emit(e, d) { log.push({ name: e, data: d }); (handlers[e] || []).forEach((f) => f(d)); },
    count: (e) => log.filter((x) => x.name === e).length,
  };
}

const DT = 1 / 120;
const playerBoxAt = (lane, y0 = 0, h = 1.7) => ({
  x0: LANES[lane] - 0.35, x1: LANES[lane] + 0.35,
  y0, y1: y0 + h,
  z0: -0.3, z1: 0.3,
});
const makeManager = (bus, seed = 7) =>
  new ObstacleManager(new THREE.Scene(), bus, { textures: {} }, mulberry32(seed));

describe('pedestrian crowd collision', () => {
  let bus, mgr;
  beforeEach(() => {
    bus = makeBus();
    mgr = makeManager(bus);
  });

  it('renders a small group (2-3 figures), not a single figure', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = makeManager(makeBus(), seed);
      const ob = m.spawnObstacle('pedestrian', 1, -10);
      const crowd = ob.group.children[0]; // group holds one crowd sub-group
      expect(crowd.children.length).toBeGreaterThanOrEqual(2);
      expect(crowd.children.length).toBeLessThanOrEqual(3);
    }
  });

  it('overlap emits stumble with type=pedestrian and removes the obstacle (lockout)', () => {
    mgr.spawnObstacle('pedestrian', 1, 0);
    mgr.update(DT, 10, 100, playerBoxAt(1), 1, {});
    const stumbles = bus.log.filter((e) => e.name === 'stumble');
    expect(stumbles.length).toBe(1);
    expect(stumbles[0].data.type).toBe('pedestrian');
    expect(stumbles[0].data.lane).toBe(1);
    expect(mgr.obstacles.length).toBe(0); // removed immediately = no retrigger
    // a second update cannot re-fire
    mgr.update(DT, 10, 100, playerBoxAt(1), 1, {});
    expect(bus.count('stumble')).toBe(1);
  });

  it('collision box matches the group footprint (wider than the old single-figure box)', () => {
    const ob = mgr.spawnObstacle('pedestrian', 0, -10);
    expect(ob.box.w).toBeGreaterThanOrEqual(1.5);
    expect(ob.box.h).toBe(1.7);
  });

  it('jetpack still skips the crowd', () => {
    mgr.spawnObstacle('pedestrian', 1, 0);
    mgr.update(DT, 10, 100, playerBoxAt(1, 3.2), 1, { jetpack: true });
    expect(bus.count('stumble')).toBe(0);
  });
});

describe('smartphone portal is a real hazard', () => {
  let bus, mgr;
  beforeEach(() => {
    bus = makeBus();
    mgr = makeManager(bus);
  });

  it('overlap emits crash with kind=portal and a valid obstacle index', () => {
    mgr.spawnObstacle('smartphone_portal', 2, 0);
    mgr.update(DT, 10, 100, playerBoxAt(2), 2, {});
    const crashes = bus.log.filter((e) => e.name === 'crash');
    expect(crashes.length).toBe(1);
    expect(crashes[0].data.kind).toBe('portal');
    expect(crashes[0].data.type).toBe('smartphone_portal');
    expect(typeof crashes[0].data.index).toBe('number');
    expect(crashes[0].data.index).toBeGreaterThanOrEqual(0);
  });

  it('per-obstacle lockout + cooldown: no retrigger on later frames', () => {
    const ob = mgr.spawnObstacle('smartphone_portal', 2, 0);
    mgr.update(DT, 10, 100, playerBoxAt(2), 2, {});
    expect(bus.count('crash')).toBe(1);
    expect(ob.hit).toBe(true);
    for (let k = 0; k < 30; k++) mgr.update(DT, 10, 100, playerBoxAt(2), 2, {});
    expect(bus.count('crash')).toBe(1);
  });

  it("no 'portal' bonus event is emitted anymore", () => {
    mgr.spawnObstacle('smartphone_portal', 2, 0);
    mgr.update(DT, 10, 100, playerBoxAt(2), 2, {});
    expect(bus.count('portal')).toBe(0);
  });
});

describe('Game wiring: crash / pedestrian / shield absorb', () => {
  let bus, game, played, shaken, flashed;
  beforeEach(() => {
    bus = makeBus();
    game = new Game(null);
    game.events = bus;
    game.state = STATES.RUNNER;
    game.audio = new AudioManager();
    played = [];
    game.audio.play = (n) => played.push(n);
    shaken = [];
    game.cameraCtl = { shake: (a) => shaken.push(a) };
    flashed = [];
    game._flashImpact = (c) => flashed.push(c);
    game._fx = [];
    game.scene = new THREE.Scene();
    game.runnerRoot = new THREE.Group();
    game._reducedMotion = false;
    game.powerups = { has: () => false, consume: () => {} };
    game.obstacles = { destroyAt: () => {} };
    game.avatar = { setAnim: () => {} };
    game._wireEvents();
  });

  it('shield absorbs the portal: consumed, obstacle destroyed, FX fired, no gameover', () => {
    const consumed = [];
    const destroyed = [];
    game.powerups = { has: (t) => t === 'shield', consume: (t) => consumed.push(t) };
    game.obstacles = { destroyAt: (i) => destroyed.push(i) };
    bus.on('gameover', () => {});
    bus.emit('crash', { type: 'smartphone_portal', kind: 'portal', lane: 1, index: 3 });
    expect(consumed).toEqual(['shield']);
    expect(destroyed).toEqual([3]);
    expect(bus.count('gameover')).toBe(0);
    expect(played).toContain('portal_collision');
    expect(shaken.length).toBeGreaterThan(0);
    expect(game._fx.length).toBeGreaterThan(0); // blue-cyan shockwave ring
  });

  it('unprotected portal crash ends the run', () => {
    game.scoring = { commitBest: () => {}, best: 0 };
    game._saveProgress = () => {};
    game.ui = { show: () => {} };
    bus.emit('crash', { type: 'smartphone_portal', kind: 'portal', lane: 1, index: 0 });
    expect(bus.count('gameover')).toBe(1);
  });

  it('pedestrian hit: rich feedback (stumble anim + sound hook + shake + flash)', () => {
    let stumbled = 0;
    game.player = { stumble: () => { stumbled += 1; }, jumping: false, sliding: false };
    game._stumbleT = 0;
    bus.emit('stumble', { type: 'pedestrian', lane: 0 });
    expect(stumbled).toBe(1);
    expect(game._stumbleT).toBe(0.9);
    expect(played).toContain('pedestrian_collision');
    expect(shaken).toContain(0.35);
    expect(flashed.length).toBe(1);
    expect(bus.count('crash')).toBe(0);
    expect(bus.count('gameover')).toBe(0);
  });

  it('pedestrian hit while already stumbling (vulnerable window) => crash', () => {
    game.player = { stumble: () => {}, jumping: false, sliding: false };
    game._stumbleT = 0.4; // mid-stumble
    game.scoring = { commitBest: () => {}, best: 0 };
    game._saveProgress = () => {};
    game.ui = { show: () => {} };
    bus.emit('stumble', { type: 'pedestrian', lane: 2 });
    expect(bus.count('crash')).toBe(1);
    expect(bus.count('gameover')).toBe(1); // unprotected => run ends
  });

  it('shield absorbs the pedestrian crowd: consumed, break effect, no stumble', () => {
    const consumed = [];
    let stumbled = 0;
    game.powerups = { has: (t) => t === 'shield', consume: (t) => consumed.push(t) };
    game.player = { stumble: () => { stumbled += 1; }, jumping: false, sliding: false };
    game._stumbleT = 0;
    bus.emit('stumble', { type: 'pedestrian', lane: 1 });
    expect(consumed).toEqual(['shield']);
    expect(stumbled).toBe(0);
    expect(game._fx.length).toBeGreaterThan(0); // clear break effect
    expect(bus.count('crash')).toBe(0);
  });

  it('puddle keeps classic non-lethal stumble semantics', () => {
    let stumbled = 0;
    game.player = { stumble: () => { stumbled += 1; }, jumping: false, sliding: false };
    game._stumbleT = 0;
    bus.emit('stumble', { type: 'puddle' });
    expect(stumbled).toBe(1);
    expect(game._stumbleT).toBe(0.9);
    expect(bus.count('crash')).toBe(0);
  });
});

describe('portal fairness in generated rows', () => {
  it("_kindToCell('portal') is 'block' (deadly lanes must leave a passable lane)", () => {
    const mgr = makeManager(makeBus());
    expect(mgr._kindToCell('portal')).toBe('block');
    expect(mgr._kindToCell('stumble')).toBe('free');
    expect(mgr._kindToCell('jump')).toBe('jump');
    expect(mgr._kindToCell('block')).toBe('block');
  });

  it('no generated row is unfair across many seeds (portal included)', () => {
    const Z = -130;
    for (let seed = 1; seed <= 300; seed++) {
      const m = makeManager(makeBus(), seed);
      m.spawnRow(Z);
      const cells = ['free', 'free', 'free'];
      for (const o of m.obstacles) {
        if (o.z === Z && !o.surge) cells[o.lane] = m._kindToCell(o.kind);
      }
      expect(rowIsFair(cells)).toBe(true);
    }
  });

  it('a portal row leaves passable lanes (portal lane counts as blocked)', () => {
    // force the portal-row branch by stubbing rng: first draw r in [0.85,0.90)
    const seq = [0.87, 0.1]; // r, lane pick
    let k = 0;
    const rng = () => seq[k++ % seq.length];
    const m = new ObstacleManager(new THREE.Scene(), makeBus(), { textures: {} }, rng);
    m.spawnRow(-130);
    const portals = m.obstacles.filter((o) => o.type === 'smartphone_portal');
    expect(portals.length).toBe(1);
    const cells = ['free', 'free', 'free'];
    for (const o of m.obstacles) {
      if (o.z === -130 && !o.surge) cells[o.lane] = m._kindToCell(o.kind);
    }
    expect(cells).toEqual(['block', 'free', 'free']);
    expect(rowIsFair(cells)).toBe(true);
  });
});
