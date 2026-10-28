// ObstacleManager.js — obstacle rows, collision, near-miss, shaytan surge.
// Treadmill: obstacles spawn at z=-130, move +Z at speed, despawn at z>12.
// SVG textures come from assetLoader.loadAll() (keys = file base names);
// procedural fallbacks are used if a texture is unavailable.

import * as THREE from 'three';
import { aabbOverlap, rowIsFair, LANES } from './CollisionSystem.js';

// type -> { plane:[w,h], y (plane centre), flat, kind, box, svg, glow }
const TYPES = {
  low_barrier: {
    plane: [2.0, 1.0], y: 0.5, kind: 'jump',
    box: { w: 1.9, h: 1.0, d: 0.4 }, svg: 'obstacle_low_barrier',
  },
  puddle: {
    plane: [2.2, 1.4], y: 0.02, flat: true, kind: 'stumble',
    box: { w: 2.0, h: 0.25, d: 1.2 }, svg: 'obstacle_puddle',
  },
  overhead_gate: {
    plane: [2.2, 2.2], y: 1.55, kind: 'slide',
    box: { w: 2.0, h: 1.0, d: 0.4, yBase: 1.1 }, svg: 'obstacle_overhead_gate',
  },
  handcart: {
    plane: [2.2, 1.8], y: 0.9, kind: 'block',
    box: { w: 2.0, h: 1.8, d: 0.8 }, svg: 'obstacle_handcart',
  },
  bus: {
    plane: [3.4, 2.6], y: 1.3, kind: 'block',
    box: { w: 3.0, h: 2.6, d: 1.2 }, svg: 'obstacle_bus',
  },
  auto_rickshaw: {
    plane: [2.0, 1.7], y: 0.85, kind: 'block',
    box: { w: 1.8, h: 1.7, d: 0.8 }, svg: 'obstacle_auto_rickshaw',
  },
  smartphone_portal: {
    plane: [1.6, 2.4], y: 1.4, kind: 'portal', glow: true,
    // tall box covering the whole hover column — deadly on overlap at any height
    box: { w: 1.6, h: 4.2, d: 0.6, yBase: 0 }, svg: 'obstacle_smartphone_portal',
  },
  pedestrian: {
    plane: [2.7, 1.7], y: 0.85, kind: 'stumble', procedural: true,
    // matches the rendered 2-3 figure group's footprint (see _buildPedestrian)
    box: { w: 2.1, h: 1.7, d: 0.6 },
  },
  shaytan_wall: {
    plane: [2.2, 3.0], y: 1.5, kind: 'block', surge: true,
    box: { w: 2.0, h: 3.0, d: 0.4 }, svg: 'shaytan_disappear', dark: true,
  },
};

// weighted pick for single / two-lane rows
const TYPE_WEIGHTS = [
  ['low_barrier', 0.22],
  ['overhead_gate', 0.18],
  ['handcart', 0.15],
  ['auto_rickshaw', 0.12],
  ['bus', 0.08],
  ['puddle', 0.12],
  ['pedestrian', 0.13],
];

const SPAWN_Z = -130;
const DESPAWN_Z = 12;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function pickWeighted(rng, pairs) {
  let r = rng();
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

// ---------- module caches
const _geo = new Map();
function planeGeo(w, h) {
  const k = `p:${w},${h}`;
  if (!_geo.has(k)) _geo.set(k, new THREE.PlaneGeometry(w, h));
  return _geo.get(k);
}
const _fallbackTex = new Map();
function fallbackTexture(kind) {
  if (_fallbackTex.has(kind)) return _fallbackTex.get(kind);
  const cols = { jump: '#c0392b', slide: '#d9a441', block: '#5b2333', stumble: '#2980b9', portal: '#8e44ad' };
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = cols[kind] || '#888';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff';
  g.font = 'bold 36px Arial';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(kind[0].toUpperCase(), 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _fallbackTex.set(kind, tex);
  return tex;
}

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(190,140,255,0.85)');
  gr.addColorStop(1, 'rgba(120,60,220,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}

export class ObstacleManager {
  constructor(scene, events, assetLoader, rng = Math.random) {
    this.scene = scene;
    this.events = events || { on() {}, emit() {} };
    this.assetLoader = assetLoader;
    this.rng = rng;
    this.onSpawn = null;
    this.currentDistanceM = 0;
    /** live obstacles: { type, lane, z, group, box, kind, passed, hit, w, h, drift } */
    this.obstacles = [];

    this._textures = null;
    this._texInitStarted = false;

    this._distSinceRow = 0; // travelled metres since the previous row
    this._t = 0;

    // shaytan surge state
    this._surge = 'idle';      // idle | warning | active
    this._surgeT = 0; // travelled metres through the warning / active phase
    this._surgeClock = 0; // travelled metres after the 300 m gate
    this._nextSurgeIn = 120;   // metres after the 300 m gate
    this._warnMesh = null;

    // portal retrigger cooldown (per-obstacle ob.hit is the primary lockout)
    this._portalCd = 0;

    this._kickTextureLoad();
  }

  // ----- textures (assetLoader.loadAll keys = svg file base names)
  _kickTextureLoad() {
    if (this._texInitStarted) return;
    this._texInitStarted = true;
    try {
      const al = this.assetLoader;
      if (!al) { this._textures = {}; return; }
      if (al.textures && typeof al.textures === 'object') {
        this._textures = al.textures;
        return;
      }
      if (typeof al.loadAll === 'function') {
        al.loadAll()
          .then((map) => { this._textures = map || {}; })
          .catch(() => { this._textures = {}; });
        return;
      }
      this._textures = {};
    } catch {
      this._textures = {};
    }
  }

  _tex(key) {
    return (this._textures && this._textures[key]) || null;
  }

  // ----- procedural pedestrian GROUP (respectful: modest figures, no gore)
  // Renders 2-3 modest figures standing close together, like a small crowd on
  // the pavement. The collision box (TYPES.pedestrian.box, w 2.1) matches the
  // group's rendered footprint: outer figure at |x|<=0.6 plus robe radius 0.44.
  _buildPedestrian() {
    const g = new THREE.Group();
    const n = this.rng() < 0.5 ? 3 : 2;
    const xs = n === 3 ? [-0.6, 0, 0.6] : [-0.42, 0.42];
    for (let k = 0; k < n; k++) {
      const fig = this._buildPedestrianFigure();
      fig.position.x = xs[k];
      fig.position.z = (Math.random() - 0.5) * 0.2; // cosmetic depth stagger
      g.add(fig);
    }
    return g;
  }

  _buildPedestrianFigure() {
    const g = new THREE.Group();
    const purdah = this.rng() < 0.45;
    const skin = 0xc97e50;
    if (purdah) {
      // women-in-purdah variant: dark abaya cone + headscarf, abstract & modest
      const abayaCols = [0x23232b, 0x3a2430, 0x1f2a33];
      const robe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.44, 1.35, 10),
        new THREE.MeshLambertMaterial({ color: abayaCols[(this.rng() * 3) | 0] })
      );
      robe.position.y = 0.675;
      robe.castShadow = true;
      g.add(robe);
      const scarf = new THREE.Mesh(
        new THREE.SphereGeometry(0.19, 12, 10),
        new THREE.MeshLambertMaterial({ color: 0x2b2b33 })
      );
      scarf.position.y = 1.48;
      scarf.scale.set(1, 1.15, 1);
      g.add(scarf);
      const face = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 10, 8),
        new THREE.MeshLambertMaterial({ color: skin })
      );
      face.position.set(0, 1.47, 0.1);
      g.add(face);
    } else {
      const shirts = [0x3b82f6, 0x22c55e, 0xeab308, 0xef4444, 0xf5f0e6];
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.21, 0.75, 4, 10),
        new THREE.MeshLambertMaterial({ color: shirts[(this.rng() * shirts.length) | 0] })
      );
      body.position.y = 0.85;
      body.castShadow = true;
      g.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 12, 10),
        new THREE.MeshLambertMaterial({ color: skin })
      );
      head.position.y = 1.52;
      g.add(head);
    }
    return g;
  }

  // ----- spawning
  spawnObstacle(type, lane, z) {
    const def = TYPES[type];
    if (!def) return null;
    const group = new THREE.Group();

    if (def.procedural) {
      group.add(this._buildPedestrian());
    } else {
      const tex = this._tex(def.svg) || fallbackTexture(def.kind);
      const mat = new THREE.MeshLambertMaterial({
        map: tex, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide,
      });
      if (def.dark) { mat.opacity = 0.85; mat.transparent = true; mat.alphaTest = 0; }
      const mesh = new THREE.Mesh(planeGeo(def.plane[0], def.plane[1]), mat);
      if (def.flat) {
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = def.y;
      } else {
        mesh.position.y = def.y;
      }
      mesh.castShadow = !def.flat;
      group.add(mesh);
      if (def.glow) {
        const glow = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false })
        );
        glow.position.y = def.y;
        glow.scale.set(3.4, 3.4, 1);
        group.add(glow);
      }
    }

    group.position.set(LANES[lane], 0, z);
    this.scene.add(group);
    const ob = {
      type, lane, z, group,
      box: def.box, kind: def.kind,
      passed: false, hit: false,
      w: def.plane[0], h: def.plane[1],
      drift: type === 'pedestrian' ? 0.85 : 1, // pedestrians approach slightly slower
      bob: Math.random() * Math.PI * 2,
      surge: !!def.surge,
    };
    this.obstacles.push(ob);
    this.onSpawn?.({ kind: 'obstacle', type, lane, distanceM: this.currentDistanceM });
    return ob;
  }

  _randomLanes(n) {
    const lanes = [0, 1, 2];
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = (this.rng() * (i + 1)) | 0;
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    return lanes.slice(0, n);
  }

  spawnRow(z) {
    const r = this.rng();
    const cells = ['free', 'free', 'free'];
    if (r < 0.40) {
      // single obstacle
      const lane = (this.rng() * 3) | 0;
      const type = pickWeighted(this.rng, TYPE_WEIGHTS);
      this.spawnObstacle(type, lane, z);
      cells[lane] = this._kindToCell(TYPES[type].kind);
    } else if (r < 0.75) {
      // two lanes
      const lanes = this._randomLanes(2);
      for (const lane of lanes) {
        const type = pickWeighted(this.rng, TYPE_WEIGHTS);
        this.spawnObstacle(type, lane, z);
        cells[lane] = this._kindToCell(TYPES[type].kind);
      }
    } else if (r < 0.85) {
      // full-width slide gate row (all slide -> fair)
      for (let lane = 0; lane < 3; lane++) {
        this.spawnObstacle('overhead_gate', lane, z);
        cells[lane] = 'slide';
      }
    } else if (r < 0.90) {
      // portal row: deadly portal in one lane, rest free
      const lane = (this.rng() * 3) | 0;
      this.spawnObstacle('smartphone_portal', lane, z);
      cells[lane] = this._kindToCell('portal');
    }
    // else: empty breather row (10%)

    // defensive: never emit an unfair row
    if (!rowIsFair(cells)) {
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        if (this.obstacles[i].z === z && !this.obstacles[i].surge) {
          this._removeAt(i);
        }
      }
    }
  }

  _kindToCell(kind) {
    // rowIsFair cells: 'free'|'jump'|'slide'|'block'
    // 'portal' is deadly, so it counts as 'block' for fairness: a portal row
    // must still leave a passable lane.
    if (kind === 'portal') return 'block';
    if (kind === 'stumble') return 'free'; // stumble never kills -> passable
    return kind; // jump | slide | block
  }

  _removeAt(i) {
    const ob = this.obstacles[i];
    if (!ob) return;
    this.scene.remove(ob.group);
    this.obstacles.splice(i, 1);
  }

  /** Remove an obstacle by index (used by the engine after a shield absorb). */
  destroyAt(index) {
    this._removeAt(index);
  }

  /** Live obstacle AABBs for the dev collision overlay (CollisionDebug). */
  debugBoxes() {
    return this.obstacles.map((ob) => {
      const b = ob.box;
      const y0 = b.yBase || 0;
      return {
        type: ob.type, kind: ob.kind, lane: ob.lane,
        x0: LANES[ob.lane] - b.w / 2,
        x1: LANES[ob.lane] + b.w / 2,
        y0,
        y1: y0 + b.h,
        z0: ob.z - b.d / 2,
        z1: ob.z + b.d / 2,
      };
    });
  }

  /** Lane indexes 0..2 with no 'block'-kind obstacle in the spawn window. */
  getFreeLanes() {    const out = [];
    for (let lane = 0; lane < 3; lane++) {
      // Portal is deadly (crash), so it blocks voucher/powerup spawns just
      // like a solid block — see _kindToCell fairness mapping portal→'block'.
      const blocked = this.obstacles.some(
        (o) => (o.kind === 'block' || o.kind === 'portal') && o.lane === lane && o.z > -40 && o.z < -5
      );
      if (!blocked) out.push(lane);
    }
    return out;
  }

  // ----- shaytan surge
  _startWarning() {
    this._surge = 'warning';
    this._surgeT = 0;
    const tex = this._tex('shaytan_warning') || fallbackTexture('block');
    const mesh = new THREE.Mesh(
      planeGeo(7, 7),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    mesh.position.set(0, 2.6, -40);
    this.scene.add(mesh);
    this._warnMesh = mesh;
    this.events.emit('warning', { type: 'shaytan' });
  }

  _fireSurge() {
    if (this._warnMesh) {
      this.scene.remove(this._warnMesh);
      this._warnMesh = null;
    }
    // 2 shadow walls in 2 random lanes at z=-60; the third lane stays free
    const lanes = this._randomLanes(2);
    for (const lane of lanes) {
      this.spawnObstacle('shaytan_wall', lane, -60);
    }
    this._surge = 'active';
    this._surgeT = 0;
  }

  _updateSurge(dt, distanceM, speed) {
    if (this._surge === 'idle') {
      if (distanceM > 300) {
        this._surgeClock += speed * dt;
        if (this._surgeClock >= this._nextSurgeIn) this._startWarning();
      }
      return;
    }
    this._surgeT += speed * dt;
    if (this._surge === 'warning') {
      if (this._warnMesh) {
        const s = 7 * (1 + 0.12 * Math.sin((this._surgeT / 10) * 14));
        this._warnMesh.scale.set(s / 7, s / 7, 1);
      }
      if (this._surgeT >= 20) this._fireSurge();
    } else if (this._surge === 'active') {
      const wallsLeft = this.obstacles.some((o) => o.surge);
      if (!wallsLeft) {
        // walls passed/destroyed -> cooldown equivalent to 40-60 s at 10 m/s
        this._surge = 'idle';
        this._surgeClock = 0;
        this._nextSurgeIn = 400 + this.rng() * 200;
      }
    }
  }

  // ----- per-frame
  update(dt, speed, distanceM, playerBox, playerLane, mods = {}) {
    this._t += dt;
    this.currentDistanceM = distanceM;

    // row generation: rows every gap metres. Speed workstream (Oct 2026):
    // widened for the 28 m/s cap — preserves the old 0.717 s minimum reaction
    // time and keeps full jumps (19.1 m) and slides (17.4 m) inside the gap.
    const gap = clamp(40 - speed * 0.7, 20.2, 40);
    this._distSinceRow += speed * dt;
    while (this._distSinceRow >= gap) {
      this._distSinceRow -= gap;
      this.spawnRow(SPAWN_Z);
    }

    // shaytan surge state machine
    this._updateSurge(dt, distanceM, speed);

    // portal retrigger cooldown
    if (this._portalCd > 0) this._portalCd -= dt;

    // derive player lane if not supplied
    let pl = playerLane;
    if ((pl === undefined || pl === null) && playerBox) {
      const cx = (playerBox.x0 + playerBox.x1) / 2;
      pl = cx < -1.2 ? 0 : cx > 1.2 ? 2 : 1;
    }
    const jet = !!(mods && mods.jetpack);

    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const ob = this.obstacles[i];
      ob.z += speed * ob.drift * dt;
      ob.group.position.z = ob.z;

      // ambient motion
      if (ob.type === 'pedestrian') {
        ob.group.position.y = Math.abs(Math.sin(this._t * 7 + ob.bob)) * 0.07;
      } else if (ob.type === 'smartphone_portal') {
        ob.group.rotation.y = Math.sin(this._t * 2 + ob.bob) * 0.22;
        ob.group.position.y = Math.sin(this._t * 2.4 + ob.bob) * 0.12;
      }

      // despawn
      if (ob.z > DESPAWN_Z) {
        this._removeAt(i);
        continue;
      }

      // near-miss: passed the player in an adjacent lane without incident
      if (!ob.passed && ob.z > 1.5) {
        ob.passed = true;
        if (
          (ob.kind === 'jump' || ob.kind === 'block' || ob.kind === 'slide') &&
          !ob.hit && pl !== undefined && pl !== null &&
          Math.abs(pl - ob.lane) === 1
        ) {
          this.events.emit('nearmiss');
        }
        continue;
      }

      // collision
      if (playerBox && !ob.passed) {
        const b = ob.box;
        const y0 = b.yBase || 0;
        const obBox = {
          x0: LANES[ob.lane] - b.w / 2,
          x1: LANES[ob.lane] + b.w / 2,
          y0,
          y1: y0 + b.h,
          z0: ob.z - b.d / 2,
          z1: ob.z + b.d / 2,
        };
        if (!aabbOverlap(playerBox, obBox)) continue;

        switch (ob.kind) {
          case 'jump':
            if (jet) break; // flying clean over it
            if (playerBox.y0 < 0.55 && !ob.hit) {
              ob.hit = true;
              this.events.emit('crash', { type: ob.type, kind: ob.kind, index: i });
            }
            break;
          case 'slide':
            // gate: crash when the player's body is too tall (standing/jumping
            // into it). A proper slide (height <= 1.1) never overlaps the bar.
            if (playerBox.y1 - playerBox.y0 > 1.1 && !ob.hit) {
              ob.hit = true;
              this.events.emit('crash', { type: ob.type, kind: ob.kind, index: i });
            }
            break;
          case 'block':
            if (jet) break; // flying clean over it
            if (!ob.hit) {
              ob.hit = true;
              this.events.emit('crash', { type: ob.type, kind: ob.kind, index: i });
            }
            break;
          case 'stumble':
            if (jet) break;
            if (ob.hit) break;
            ob.hit = true;
            // payload distinguishes the pedestrian crowd (rich feedback path
            // in Game) from the puddle (classic non-lethal stumble)
            this.events.emit('stumble', { type: ob.type, lane: ob.lane });
            this._removeAt(i);
            break;
          case 'portal':
            // deadly smartphone portal: crash unless shield/glideboard absorbs
            // it (handled by Game's 'crash' wiring). Per-obstacle lockout plus
            // a short global cooldown so stacked portals can't multi-fire.
            if (ob.hit || this._portalCd > 0) break;
            ob.hit = true;
            this._portalCd = 0.5;
            this.events.emit('crash', { type: ob.type, kind: 'portal', lane: ob.lane, index: i });
            break;
        }
      }
    }
  }

  reset() {
    for (let i = this.obstacles.length - 1; i >= 0; i--) this._removeAt(i);
    if (this._warnMesh) {
      this.scene.remove(this._warnMesh);
      this._warnMesh = null;
    }
    this._distSinceRow = 0;
    this.currentDistanceM = 0;
    this._surge = 'idle';
    this._surgeT = 0;
    this._surgeClock = 0;
    this._nextSurgeIn = 120;
    this._portalCd = 0;
    // pre-populate a few rows so the road ahead isn't empty at run start
    // (base speed is now 10 m/s; same formula as update())
    const gap = clamp(40 - 10 * 0.7, 20.2, 40);
    for (let k = 0; k < 3; k++) this.spawnRow(SPAWN_Z - k * gap);
  }
}
