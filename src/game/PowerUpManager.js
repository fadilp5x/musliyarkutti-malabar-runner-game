// PowerUpManager.js — powerup pickups, timed effects, instant boosts.
// HUD reads `powerups.active` (type -> remaining seconds). Expiry emits
// 'powerupEnd'. Instant types (headstart/superheadstart) emit 'powerup' and
// the engine applies +150/+400 m via scoring.addDistance plus a speed burst.

import * as THREE from 'three';
import { LANES } from './CollisionSystem.js';

const DEFS = {
  jetpack:        { dur: 8,        letter: 'J',  color: '#f97316' },
  magnet:         { dur: 10,       letter: 'M',  color: '#ef4444' },
  multiplier:     { dur: 12,       letter: '×2', color: '#06b6d4' },
  shield:         { dur: 15,       letter: 'S',  color: '#D99A00' },
  glideboard:     { dur: Infinity, letter: 'G',  color: '#22c55e' },
  headstart:      { dur: 0,        letter: 'H',  color: '#a855f7', instant: true },
  superheadstart: { dur: 0,        letter: 'H+', color: '#eab308', instant: true },
};

const SPAWN_WEIGHTS = [
  ['magnet', 0.20],
  ['multiplier', 0.20],
  ['shield', 0.20],
  ['jetpack', 0.15],
  ['glideboard', 0.10],
  ['headstart', 0.10],
  ['superheadstart', 0.05],
];

const SPAWN_Z = -100;
const DESPAWN_Z = 12;

function pickWeighted(rng, pairs) {
  let r = rng();
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

const _tex = new Map();
function pickupTexture(type) {
  if (_tex.has(type)) return _tex.get(type);
  const def = DEFS[type];
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const r = 22;
  g.fillStyle = def.color;
  g.beginPath();
  g.roundRect(6, 6, 116, 116, r);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(12, 12, 104, 104, r - 6);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = 'bold 52px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(def.letter, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _tex.set(type, tex);
  return tex;
}

export class PowerUpManager {
  constructor(scene, events, rng = Math.random) {
    this.scene = scene;
    this.events = events || { on() {}, emit() {} };
    this.rng = rng;
    /** active powerups: type -> remaining seconds (glideboard: Infinity until hit) */
    this.active = {};
    /** live pickups: { type, lane, z, mesh, bob } */
    this.pickups = [];
    this._lastSpawnM = 0;
    this._nextSpawnM = 90;
    this.onSpawn = null;
  }

  has(type) {
    return Object.prototype.hasOwnProperty.call(this.active, type);
  }

  /** Grant a powerup (or apply an instant one). Emits 'powerup'. */
  collect(type) {
    const def = DEFS[type];
    if (!def) return;
    if (def.instant) {
      this.events.emit('powerup', type);
      return;
    }
    this.active[type] = def.dur;
    this.events.emit('powerup', type);
  }

  /** Remove a powerup early (e.g. shield/glideboard absorbing a hit). Emits 'powerupEnd'. */
  consume(type) {
    if (this.has(type)) {
      delete this.active[type];
      this.events.emit('powerupEnd', type);
    }
  }

  /**
   * Maybe spawn a pickup. Call each simulation step with the run distance and the
   * obstacle manager's getFreeLanes(). Spawns every 90-160 m in a free lane.
   */
  trySpawn(distanceM, freeLanes = [0, 1, 2]) {
    if (distanceM < this._nextSpawnM) return;
    if (!freeLanes || freeLanes.length === 0) return;
    this._lastSpawnM = distanceM;
    const lane = freeLanes[(this.rng() * freeLanes.length) | 0];
    const type = pickWeighted(this.rng, SPAWN_WEIGHTS);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.15),
      new THREE.MeshBasicMaterial({ map: pickupTexture(type), transparent: true, side: THREE.DoubleSide })
    );
    mesh.position.set(LANES[lane], 1.25, SPAWN_Z);
    this.scene.add(mesh);
    this.pickups.push({ type, lane, z: SPAWN_Z, mesh, bob: Math.random() * 6.28 });
    this.onSpawn?.({ kind: 'powerup', type, lane, distanceM });
    this._nextSpawnM = distanceM + 90 + this.rng() * 70;
  }

  update(dt, speed, distanceM, player, avatar) {
    // move pickups with the world; collect on proximity to the player
    const px = player ? player.x || 0 : 0;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.z += speed * dt;
      if (p.z > DESPAWN_Z) {
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
        continue;
      }
      p.mesh.position.set(
        LANES[p.lane],
        1.25 + Math.sin(distanceM * 0.4 + p.bob) * 0.18,
        p.z
      );
      p.mesh.rotation.y += dt * 2.2;
      if (Math.abs(p.z) < 1.2 && Math.abs(LANES[p.lane] - px) < 1.2) {
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
        this.collect(p.type);
      }
    }

    // tick down timed effects; expiry emits 'powerupEnd'
    for (const type of Object.keys(this.active)) {
      const def = DEFS[type];
      if (!def || !Number.isFinite(def.dur)) continue; // glideboard: until consumed
      this.active[type] -= dt;
      if (this.active[type] <= 0) {
        delete this.active[type];
        this.events.emit('powerupEnd', type);
      }
    }

    // jetpack hover: drive the player's fly target height
    if (player) {
      const target = this.has('jetpack') ? 3.2 : 0;
      const cur = player.flyY || 0;
      player.flyY = cur + (target - cur) * Math.min(1, dt * 3);
    }
    void avatar;
  }

  reset() {
    this.active = {};
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.pickups = [];
    this._lastSpawnM = 0;
    this._nextSpawnM = 90 + this.rng() * 70;
  }
}
