// CollectibleManager.js — Arabic-letter gold coins + voucher cards.
// Coins: pooled meshes (shared geometry, one material per letter).
// Voucher rule lives in VoucherManager: engine/CollectibleManager must only
// spawn vouchers at distanceM >= 500 (via canSpawn/shouldSpawn).

import * as THREE from 'three';
import { LANES } from './CollisionSystem.js';
import { VOUCHER_STORES } from './VoucherManager.js';

const LETTERS = ['ب', 'ت', 'ث', 'ن', 'م', 'س', 'ع'];
const POOL_SIZE = 64;
const SPAWN_Z = -130;
const DESPAWN_Z = 12;

// ---------- module caches
let _coinGeo = null;
function coinGeo() {
  if (_coinGeo) return _coinGeo;
  // A turned profile gives the coin a raised rim and a soft bevel instead of
  // the flat, sharp edge of a basic cylinder.
  const profile = [
    [0, -0.052], [0.285, -0.052], [0.322, -0.05], [0.343, -0.041],
    [0.35, -0.027], [0.35, 0.027], [0.343, 0.041], [0.322, 0.05],
    [0.285, 0.052], [0, 0.052],
  ].map(([radius, y]) => new THREE.Vector2(radius, y));
  _coinGeo = new THREE.LatheGeometry(profile, 48);
  _coinGeo.rotateX(Math.PI / 2); // coin faces point along the road camera axis
  return _coinGeo;
}

const _coinFaceGeo = new THREE.CircleGeometry(0.302, 48);
let _coinBodyMat = null;
function coinBodyMaterial() {
  if (_coinBodyMat) return _coinBodyMat;
  _coinBodyMat = new THREE.MeshPhysicalMaterial({
    color: '#D99000',
    metalness: 0.72,
    roughness: 0.24,
    clearcoat: 0.65,
    clearcoatRoughness: 0.2,
    emissive: '#6D3900',
    emissiveIntensity: 0.08,
  });
  return _coinBodyMat;
}

const _coinFaceMats = new Map();
function coinMaterial(letter) {
  if (_coinFaceMats.has(letter)) return _coinFaceMats.get(letter);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(40, 32, 4, 64, 64, 66);
  gr.addColorStop(0, '#FFF8C9');
  gr.addColorStop(0.36, '#FFD700');
  gr.addColorStop(0.72, '#FFC107');
  gr.addColorStop(1, '#D99000');
  g.fillStyle = gr;
  g.beginPath(); g.arc(64, 64, 63, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#8B6914';
  g.lineWidth = 7;
  g.beginPath(); g.arc(64, 64, 55, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(255, 248, 201, 0.95)';
  g.lineWidth = 2;
  g.beginPath(); g.arc(64, 64, 48, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(139, 105, 20, 0.45)';
  g.lineWidth = 2;
  g.beginPath(); g.arc(64, 64, 36, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#704000';
  g.shadowColor = 'rgba(82, 46, 0, 0.45)';
  g.shadowBlur = 3;
  g.font = '900 61px "Noto Sans Arabic", "Arial", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 64, 66);
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(255, 248, 201, 0.55)';
  g.lineWidth = 1;
  g.strokeText(letter, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshPhysicalMaterial({
    map: tex,
    metalness: 0.42,
    roughness: 0.27,
    clearcoat: 0.8,
    clearcoatRoughness: 0.18,
    emissive: '#5B3700',
    emissiveIntensity: 0.035,
    side: THREE.DoubleSide,
  });
  _coinFaceMats.set(letter, mat);
  return mat;
}

const _voucherTex = new Map();
function voucherTexture(store) {
  if (_voucherTex.has(store)) return _voucherTex.get(store);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 170;
  const g = c.getContext('2d');
  g.fillStyle = '#16213E';
  g.fillRect(0, 0, 256, 170);
  g.strokeStyle = '#FFD700';
  g.lineWidth = 8;
  g.strokeRect(8, 8, 240, 154);
  g.fillStyle = '#FFD700';
  g.font = 'bold 26px Arial';
  g.textAlign = 'center';
  g.fillText('VOUCHER', 128, 44);
  g.fillStyle = '#ffffff';
  let px = 30;
  g.font = `bold ${px}px Arial, sans-serif`;
  while (g.measureText(store).width > 220 && px > 14) {
    px -= 2;
    g.font = `bold ${px}px Arial, sans-serif`;
  }
  g.fillText(store, 128, 92);
  g.fillStyle = '#82B1FF';
  g.font = '18px Arial';
  g.fillText('MALABAR RUNNER', 128, 130);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _voucherTex.set(store, tex);
  return tex;
}

export class CollectibleManager {
  constructor(scene, events, assetLoader = null) {
    this.scene = scene;
    this.events = events || { on() {}, emit() {} };
    this.assetLoader = assetLoader;

    // coin pool
    this._pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(coinGeo(), coinBodyMaterial()));
      const faceMaterial = coinMaterial(LETTERS[i % LETTERS.length]);
      for (const side of [-1, 1]) {
        const face = new THREE.Mesh(_coinFaceGeo, faceMaterial);
        face.position.z = side * 0.053;
        if (side < 0) face.rotation.y = Math.PI;
        mesh.add(face);
      }
      mesh.visible = false;
      this.scene.add(mesh);
      this._pool.push(mesh);
    }
    /** live coins: { mesh, lane, z, y, taken, spin, mx, my } */
    this.coins = [];
    /** live voucher cards: { mesh, lane, z, store, bob } */
    this.vouchers = [];

    this._lastPatternM = 0;
    this._jetpack = false;
    this._t = 0;
  }

  _freeCoin() {
    return this._pool.find((m) => !m.visible) || null;
  }

  _spawnCoin(lane, z, y) {
    const mesh = this._freeCoin();
    if (!mesh) return;
    mesh.visible = true;
    mesh.position.set(LANES[lane], y, z);
    mesh.rotation.set(0, Math.random() * 6.28, 0);
    this.coins.push({ mesh, lane, z, y, taken: false, spin: 3 + Math.random() * 3, mx: 0, my: 0 });
  }

  /**
   * Spawn a coin pattern every ~25 m. Called by the engine each frame with the
   * current distance. y=1.0 normally, y=3.4 arcs while the jetpack is active
   * (update() copies mods.jetpack into this._jetpack).
   */
  spawnPatterns(distanceM) {
    if (distanceM - this._lastPatternM < 25) return;
    this._lastPatternM = distanceM;
    const r = Math.random();
    const baseY = this._jetpack ? 3.4 : 1.0;
    if (r < 0.4) {
      // line: 5 coins in one lane
      const lane = (Math.random() * 3) | 0;
      for (let i = 0; i < 5; i++) this._spawnCoin(lane, SPAWN_Z - i * 2.4, baseY);
    } else if (r < 0.7) {
      // arc: 7 coins sweeping across the lanes
      for (let i = 0; i < 7; i++) {
        const lane = Math.max(0, Math.min(2, Math.round(1 + Math.sin((i / 6) * Math.PI * 2))));
        const y = baseY + Math.sin((i / 6) * Math.PI) * 1.1;
        this._spawnCoin(lane, SPAWN_Z - i * 2.4, y);
      }
    } else {
      // zigzag: 8 coins alternating lanes
      const seq = [0, 1, 2, 1, 0, 1, 2, 1];
      const off = (Math.random() * 3) | 0;
      for (let i = 0; i < 8; i++) this._spawnCoin(seq[(i + off) % seq.length], SPAWN_Z - i * 2.6, baseY);
    }
  }

  /**
   * Spawn a floating voucher card. The caller (engine) MUST gate this with
   * VoucherManager.canSpawn/shouldSpawn — never below 500 m.
   */
  spawnVoucher(lane) {
    const store = VOUCHER_STORES[(Math.random() * VOUCHER_STORES.length) | 0];
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.8),
      new THREE.MeshBasicMaterial({ map: voucherTexture(store), side: THREE.DoubleSide, transparent: true })
    );
    mesh.position.set(LANES[lane], 1.2, SPAWN_Z);
    this.scene.add(mesh);
    this.vouchers.push({ mesh, lane, z: SPAWN_Z, store, bob: Math.random() * 6.28 });
    return store;
  }

  update(dt, speed, playerBox, mods = {}) {
    this._t += dt;
    this._jetpack = !!(mods && mods.jetpack);
    const magnet = !!(mods && mods.magnet);

    const pcx = playerBox ? (playerBox.x0 + playerBox.x1) / 2 : 0;
    const pcy = playerBox ? (playerBox.y0 + playerBox.y1) / 2 : 1;

    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.z += speed * dt;
      if (c.z > DESPAWN_Z) {
        c.mesh.visible = false;
        this.coins.splice(i, 1);
        continue;
      }
      const cx = LANES[c.lane] + c.mx;
      const cy = c.y + c.my;
      if (magnet && !c.taken) {
        const dx = pcx - cx, dy = pcy - cy, dz = 0 - c.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 4 && dist > 0.001) {
          const pull = Math.min(1, dt * 10);
          c.mx += (dx / dist) * dist * pull * 0.9;
          c.my += (dy / dist) * dist * pull * 0.9;
          c.z += (dz / dist) * dist * pull * 0.9;
        }
      }
      c.mesh.position.set(cx, cy, c.z);
      c.mesh.rotation.y += dt * c.spin;

      if (!c.taken && Math.abs(c.z) < 0.9 && Math.abs(cx - pcx) < 1.0 && Math.abs(cy - pcy) < 1.3) {
        c.taken = true;
        c.mesh.visible = false;
        this.coins.splice(i, 1);
        this.events.emit('coin', 1);
      }
    }

    for (let i = this.vouchers.length - 1; i >= 0; i--) {
      const v = this.vouchers[i];
      v.z += speed * dt;
      if (v.z > DESPAWN_Z) {
        this.scene.remove(v.mesh);
        this.vouchers.splice(i, 1);
        continue;
      }
      v.mesh.position.set(
        LANES[v.lane],
        1.2 + Math.sin(this._t * 3 + v.bob) * 0.15,
        v.z
      );
      v.mesh.rotation.y = Math.sin(this._t * 2 + v.bob) * 0.35;
      const dx = Math.abs(LANES[v.lane] - pcx);
      if (Math.abs(v.z) < 1 && dx < 1.2) {
        this.scene.remove(v.mesh);
        this.vouchers.splice(i, 1);
        this.events.emit('voucher', v.store);
      }
    }
  }

  reset() {
    for (const c of this.coins) c.mesh.visible = false;
    this.coins = [];
    for (const v of this.vouchers) this.scene.remove(v.mesh);
    this.vouchers = [];
    this._lastPatternM = 0;
    this._jetpack = false;
  }
}
