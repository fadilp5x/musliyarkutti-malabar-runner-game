// Node smoke test: instantiate the REAL game modules (three.js scene graph works in
// Node; DOM canvas is stubbed) and run a simulated 20s runner session, exercising
// inputs, power-ups (activation+expiry), voucher gating, wallet redeem, crash events.
import * as THREE from 'three';

// ---------- DOM canvas stub ----------
function makeCtx2d() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, p) {
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
      if (p === 'measureText') return () => ({ width: 12 });
      if (p === Symbol.toPrimitive) return () => 0;
      return (...a) => {};
    },
    set() { return true; },
  });
}
function fakeCanvas() {
  return { width: 0, height: 0, style: {}, getContext: () => makeCtx2d(), addEventListener() {} };
}
globalThis.document = {
  createElement: (tag) => tag === 'canvas' ? fakeCanvas() : { style: {}, appendChild() {}, addEventListener() {} },
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
const rng = mulberry32(1234);

// ---------- event bus ----------
const events = {
  handlers: {},
  on(e, f) { (this.handlers[e] = this.handlers[e] || []).push(f); },
  emit(e, d) { (this.handlers[e] || []).forEach(f => f(d)); },
};
const seen = {};
['coin','nearmiss','powerup','powerupEnd','voucher','crash','gameover','stumble','portal','warning','landmark'].forEach(e => {
  seen[e] = 0; events.on(e, () => seen[e]++);
});

// ---------- imports ----------
const { PlayerAvatar } = await import('./src/game/PlayerAvatar.js');
const { PlayerController } = await import('./src/game/PlayerController.js');
const { WorldBuilder } = await import('./src/game/WorldBuilder.js');
const { LandmarkManager } = await import('./src/game/LandmarkManager.js');
const { ObstacleManager } = await import('./src/game/ObstacleManager.js');
const { CollectibleManager } = await import('./src/game/CollectibleManager.js');
const { PowerUpManager } = await import('./src/game/PowerUpManager.js');
const { ScoringSystem } = await import('./src/game/ScoringSystem.js');
const { VoucherManager } = await import('./src/game/VoucherManager.js');
const { VoucherWallet } = await import('./src/game/VoucherWallet.js');
const { Missions } = await import('./src/game/Missions.js');
const { Inventory } = await import('./src/game/Inventory.js');

const assetLoader = { loadAll: async () => ({}), loadSVGTexture: async () => new THREE.Texture() };
const scene = new THREE.Scene();

const avatar = new PlayerAvatar(scene);
const player = new PlayerController(avatar, events);
const world = new WorldBuilder(scene, events, assetLoader);
const landmarks = new LandmarkManager(scene, events, assetLoader);
const obstacles = new ObstacleManager(scene, events, assetLoader, rng);
const collectibles = new CollectibleManager(scene, events, assetLoader);
const powerups = new PowerUpManager(scene, events);
const scoring = new ScoringSystem();
const vouchers = new VoucherManager(rng);
const wallet = new VoucherWallet();
const missions = new Missions();
const inventory = new Inventory();

const failures = [];
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name);
  if (!cond) failures.push(name);
}

// allow async texture kick to settle
await new Promise(r => setTimeout(r, 100));

avatar.setAnim('run');
let distanceM = 0, speed = 8;
const dt = 1 / 60;
let voucherSpawnAttempts = 0, vouchersSpawned = 0;

// simulate 1500 frames (~25s)
for (let f = 0; f < 1500; f++) {
  speed = Math.min(8 + distanceM * 0.012, 24);
  distanceM += speed * dt;
  if (f === 100) player.doLeft();
  if (f === 200) player.doRight();
  if (f === 300) player.doJump();
  if (f === 420) player.doSlide();
  if (f === 500) { player.doRight(); player.doJump(); }
  player.update(dt, speed);
  powerups.update(dt, speed, distanceM, player, avatar);
  world.update(dt, speed, distanceM, 'high');
  landmarks.update(dt, speed, distanceM);
  const pb = player.getBox();
  obstacles.update(dt, speed, distanceM, pb, player.laneIndex, { shield: false, jetpack: player.flyY > 2, sliding: player.sliding });
  collectibles.spawnPatterns(distanceM);
  collectibles.update(dt, speed, pb, { magnet: powerups.has('magnet'), jetpack: player.flyY > 2 });
  scoring.addDistance(speed * dt);
  if (vouchers.shouldSpawn(distanceM)) { voucherSpawnAttempts++; vouchers.recordSpawn(distanceM); vouchersSpawned++; collectibles.spawnVoucher(1); }
  avatar.update(dt);
  if (f === 700) { // force a crash: teleport nearest obstacle onto the player
    const o = obstacles.obstacles.find(o => o.kind === 'block');
    if (o) { o.z = 0.2; o.lane = player.laneIndex; }
  }
}

check('sim ran 1500 frames without throwing', true);
check('distance advanced (>150m)', distanceM > 150);
check('obstacles were generated', obstacles.obstacles.length > 0);
check('coins were generated', collectibles.coins.length > 0);
check('crash event fired when forced', seen.crash > 0);
check('no voucher spawned below 500m', vouchersSpawned === 0 || distanceM < 500 ? vouchersSpawned === 0 : true);
console.log('  distance reached:', distanceM.toFixed(1) + 'm, vouchers spawned:', vouchersSpawned, '(expect 0 below 500m)');

// power-up activation + expiry in the live module
powerups.collect('jetpack');
check('jetpack activates (flyY rises)', (() => { for (let i = 0; i < 30; i++) powerups.update(dt, speed, distanceM, player, avatar); return player.flyY > 1; })());
powerups.active.jetpack = 0.05;
for (let i = 0; i < 150; i++) powerups.update(dt, speed, distanceM, player, avatar);
check('jetpack expires (flyY falls, powerupEnd emitted)', player.flyY < 0.5 && seen.powerupEnd > 0);
powerups.collect('multiplier');
check('multiplier activates', powerups.has('multiplier'));
powerups.consume('multiplier');
check('multiplier consumes', !powerups.has('multiplier'));

// wallet: add, redeem, double-redeem throws, code stable
wallet.addVoucher('Turkish Corner');
const wid = wallet.list()[0].id;
const code1 = wallet.redeem(wid);
let threw = false, code2 = null;
try { code2 = wallet.redeem(wid); } catch (e) { threw = /already redeemed/.test(e.message); }
check('redeem returns MMR-DEMO- code', /^MMR-DEMO-/.test(code1));
check('double redeem throws already-redeemed', threw && code2 === null);

// missions + inventory smoke
missions.update({ distanceM: 600, coins: 40, nearMisses: 3, vouchers: 1 });
check('mission progress recorded', missions.progress.run500 >= 600);
check('board buy with insufficient coins fails', inventory.buy('gold', 100) === false);
check('board buy with enough coins succeeds', inventory.buy('gold', 600) === true);

// scoring sanity in live module
const s0 = scoring.score;
scoring.multiplier = 2; scoring.addCoins(5);
check('coin scoring with x2 multiplier', scoring.score === s0 + 5 * 10 * 2);

console.log('\nevents seen:', JSON.stringify(seen));
console.log(failures.length === 0 ? '\nALL SMOKE CHECKS PASSED' : '\nFAILURES: ' + failures.join(', '));
process.exit(failures.length ? 1 : 0);
