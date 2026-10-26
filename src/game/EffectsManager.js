import * as THREE from 'three';

// ---------------------------------------------------------------------------
// EffectsManager — pooled, capped, event-triggered transient FX for the
// runner (speed workstream, Oct 2026).
//
// Design rules:
//  - Pooled: every sprite is preallocated at construction; spawning reuses a
//    round-robin slot, so there is NO per-frame allocation in the hot loop.
//  - Capped: each effect type has a fixed pool size; a burst that exceeds the
//    pool simply recycles the oldest live particle.
//  - Culled: particles behind the camera plane or far off-axis are skipped in
//    update and hidden (the runner's FX all live near the player, so this is
//    mostly for the edge-of-screen speed lines).
//  - Event-triggered only: dust puffs fire on 'footstep', the landing burst
//    ONLY on 'land', streaks ONLY on 'left'/'right'/'nearmiss', etc. Nothing
//    ambient except the glideboard trail / jetpack thrust / speed lines, which
//    are gated on live powerup/fly state passed into update().
//  - Subtle by default: small scales, low opacities, short lives — FX must
//    never hide the road. reducedMotion suppresses ambient FX and halves
//    bursts.
//  - Camera-consistent: all particles live in world space under runnerRoot,
//    at the player's z-plane or slightly ahead; sprites always face camera.
//  - Shaytan smoke is NOT handled here — ShaytanPursuit.js owns its trail.
//  - Blending: coin sparkles, portal swirl, jetpack thrust, lane/nearmiss
//    streaks and speed lines are ADDITIVE (hot glow); footstep dust, landing
//    bursts, jump wind and glide trails are normal-blended soft sprites.
//  - Portal FX: the collision workstream's shockwave (Game._spawnShockwave)
//    already fires on 'crash' {kind:'portal'}; this manager adds a
//    complementary blue-cyan swirl burst, never a duplicate shockwave.
//
// Audio: this manager emits nothing for sound. The audio workstream maps the
// existing gameplay events ('footstep','jump','land','left','right','coin',
// 'nearmiss') to SFX — see PATCHES.md for the expected event->sfx mapping.
// ---------------------------------------------------------------------------

function makeRadialTexture(inner, outer, size = 64) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeStreakTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 16;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 128, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSparkTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,240,180,0.95)';
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(32, 6); g.lineTo(32, 58);
  g.moveTo(6, 32); g.lineTo(58, 32);
  g.stroke();
  g.fillStyle = 'rgba(255,250,220,1)';
  g.beginPath(); g.arc(32, 32, 7, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLineTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Fixed-size round-robin pool of sprite particles. spawn() returns the next
// slot (recycling the oldest live particle when the pool is exhausted).
// opts: { blending } — additive pools glow (coin sparks, portal swirl, thrust,
// streaks); dust/trails stay normal-blended soft sprites.
class Pool {
  constructor(parent, texture, count, opts = {}) {
    this.items = new Array(count);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture, transparent: true, opacity: 0, depthWrite: false,
        blending: opts.blending || THREE.NormalBlending,
      });
      const spr = new THREE.Sprite(mat);
      spr.visible = false;
      parent.add(spr);
      this.items[i] = {
        spr, life: 0, maxLife: 1,
        vx: 0, vy: 0, vz: 0, grav: 0,
        growX: 0, growY: 0, spin: 0,
        baseOp: 1, fadePow: 1,
        active: false,
      };
    }
    this.cursor = 0;
  }

  spawn(x, y, z, o = {}) {
    const p = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    p.life = 0;
    p.maxLife = o.life || 0.5;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.grav = o.grav || 0;
    p.growX = o.growX || 0; p.growY = o.growY || 0;
    p.spin = o.spin || 0;
    p.baseOp = o.opacity !== undefined ? o.opacity : 0.6;
    p.fadePow = o.fadePow || 1;
    p.active = true;
    const s = p.spr;
    s.position.set(x, y, z);
    const sx = o.sx !== undefined ? o.sx : 0.5;
    const sy = o.sy !== undefined ? o.sy : sx;
    s.scale.set(sx, sy, 1);
    s.material.opacity = p.baseOp;
    s.material.rotation = o.rot || 0;
    s.visible = true;
    return p;
  }

  // Step every live particle. No allocation: plain indexed loop.
  step(dt, camZ, camX) {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        p.spr.visible = false;
        continue;
      }
      const s = p.spr;
      // Cull: behind the camera or far off the play corridor.
      const px = s.position.x, py = s.position.y, pz = s.position.z;
      if (pz > camZ + 2 || py > 14 || px < camX - 18 || px > camX + 18) {
        p.active = false;
        s.visible = false;
        continue;
      }
      p.vy += p.grav * dt;
      s.position.set(px + p.vx * dt, py + p.vy * dt, pz + p.vz * dt);
      s.scale.x += p.growX * dt;
      s.scale.y += p.growY * dt;
      if (p.spin !== 0) s.material.rotation += p.spin * dt;
      const k = 1 - p.life / p.maxLife;
      s.material.opacity = p.baseOp * Math.pow(k, p.fadePow);
    }
  }

  killAll() {
    for (const p of this.items) {
      p.active = false;
      p.spr.visible = false;
    }
  }
}

export class EffectsManager {
  /**
   * @param {THREE.Group} parent  runnerRoot — FX hide with quit-to-title.
   * @param {{on,emit}} events    game event bus.
   * @param {THREE.Camera} camera for off-screen culling.
   * @param {object} opts { reducedMotion, maxSpeed }
   */
  constructor(parent, events, camera, opts = {}) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.events = events;
    this.camera = camera;
    this.reducedMotion = opts.reducedMotion === true;
    this.maxSpeed = opts.maxSpeed || 28;

    // Shared canvas textures (built once). Soft 128px radial sprites keep
    // dust/trails pillowy under tone mapping; additive pools get tight,
    // hot cores.
    const dustTex = makeRadialTexture('rgba(232,224,210,0.85)', 'rgba(232,224,210,0)', 128);
    const sparkTex = makeSparkTexture();
    const streakTex = makeStreakTexture();
    const wispTex = makeRadialTexture('rgba(255,255,255,0.7)', 'rgba(255,255,255,0)', 128);
    const swirlTex = makeRadialTexture('rgba(150,230,255,0.95)', 'rgba(40,140,255,0)');
    const trailTex = makeRadialTexture('rgba(200,235,255,0.7)', 'rgba(200,235,255,0)', 128);
    const thrustTex = makeRadialTexture('rgba(255,200,110,0.95)', 'rgba(255,120,40,0)');
    const lineTex = makeLineTexture();

    this._dust = new Pool(this.group, dustTex, 30);
    this._spark = new Pool(this.group, sparkTex, 20, { blending: THREE.AdditiveBlending });
    this._streak = new Pool(this.group, streakTex, 14, { blending: THREE.AdditiveBlending });
    this._wisp = new Pool(this.group, wispTex, 10);
    this._swirl = new Pool(this.group, swirlTex, 24, { blending: THREE.AdditiveBlending });
    this._trail = new Pool(this.group, trailTex, 26);
    this._thrust = new Pool(this.group, thrustTex, 20, { blending: THREE.AdditiveBlending });
    this._lines = new Pool(this.group, lineTex, 12, { blending: THREE.AdditiveBlending });

    // Last known player state (updated every step; events read the previous
    // step's values — 1/120 s stale, negligible for FX placement).
    this._px = 0;
    this._py = 0;

    // Spawn throttles (seconds) so high stride rates don't spam sprites.
    this._dustT = 0;
    this._trailT = 0;
    this._thrustT = 0;

    this._bind(events);
  }

  _bind(events) {
    if (!events || typeof events.on !== 'function') return;
    // Footstep dust puffs — a two-layer soft puff (dense core + lingering
    // halo) at the feet, throttled. Soft scale/alpha curve: quick bloom,
    // slow settle.
    events.on('footstep', (d = {}) => {
      if (this.reducedMotion || this._dustT > 0) return;
      this._dustT = 0.07;
      const x = typeof d.x === 'number' ? d.x : this._px;
      this._dust.spawn(x + (Math.random() - 0.5) * 0.3, 0.12, 0.25, {
        life: 0.4, vx: (Math.random() - 0.5) * 0.8, vy: 0.9, vz: 1.2,
        sx: 0.26, growX: 1.0, growY: 1.0, opacity: 0.34, fadePow: 1.25,
      });
      this._dust.spawn(x + (Math.random() - 0.5) * 0.4, 0.16, 0.35, {
        life: 0.62, vx: (Math.random() - 0.5) * 0.5, vy: 0.55, vz: 1.0,
        sx: 0.42, growX: 1.3, growY: 1.3, opacity: 0.18, fadePow: 1.5,
      });
    });
    // Landing burst — ONLY on 'land': radial puffs plus a flat dust ring
    // that blooms outward and dies fast.
    events.on('land', () => {
      const n = this.reducedMotion ? 2 : 5;
      for (let i = 0; i < n; i++) {
        this._dust.spawn(this._px + (Math.random() - 0.5) * 0.9, 0.12, 0.2, {
          life: 0.5, vx: (Math.random() - 0.5) * 2.4, vy: 1.4 + Math.random(), vz: 1.6,
          sx: 0.34, growX: 1.7, growY: 1.7, opacity: 0.42, fadePow: 1.2,
        });
      }
      if (!this.reducedMotion) {
        this._dust.spawn(this._px, 0.1, 0.2, {
          life: 0.38, sx: 0.9, sy: 0.3, growX: 4.2, growY: 1.4,
          opacity: 0.3, fadePow: 1.6,
        });
      }
    });
    // Lane-change streaks — brief lateral whooshes on 'left'/'right',
    // additive so they shimmer against the road.
    const laneStreak = (dir) => {
      if (this.reducedMotion) return;
      for (let i = 0; i < 3; i++) {
        this._streak.spawn(this._px - dir * i * 0.5, 0.9 + i * 0.25, -0.2 - i * 0.3, {
          life: 0.32, vx: -dir * 7, vz: 2,
          sx: 1.5, sy: 0.14, opacity: 0.5, fadePow: 1.6,
        });
      }
      this._streak.spawn(this._px, 1.35, -0.4, {
        life: 0.26, vx: -dir * 5, vz: 1.5,
        sx: 1.1, sy: 0.1, opacity: 0.3, fadePow: 1.8,
      });
    };
    events.on('left', () => laneStreak(-1));
    events.on('right', () => laneStreak(1));
    // Jump wind — short upward wisps on 'jump', stretched and soft.
    events.on('jump', () => {
      if (this.reducedMotion) return;
      for (let i = 0; i < 2; i++) {
        this._wisp.spawn(this._px + (Math.random() - 0.5) * 0.5, 0.5 + i * 0.5, 0.2, {
          life: 0.5, vy: 3.2, vx: (Math.random() - 0.5) * 0.6,
          sx: 0.5, growX: 1.2, growY: 2.4, opacity: 0.3, fadePow: 1.2,
        });
      }
      this._wisp.spawn(this._px, 0.3, 0.3, {
        life: 0.42, vy: 2.2, sx: 0.7, sy: 0.4,
        growX: 1.6, growY: 2.0, opacity: 0.22, fadePow: 1.4,
      });
    });
    // Coin sparkle — gold, ADDITIVE, at the player (coins collect within
    // ~1 m of the hero). A hot white-gold core flash sells the pickup.
    events.on('coin', () => {
      const n = this.reducedMotion ? 2 : 4;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        this._spark.spawn(this._px + Math.cos(a) * 0.25, 1.1 + Math.sin(a) * 0.25, 0, {
          life: 0.42, vx: Math.cos(a) * 1.6, vy: 1.2 + Math.sin(a) * 1.2,
          sx: 0.32, growX: -0.25, growY: -0.25, spin: (Math.random() - 0.5) * 6,
          opacity: 0.9, fadePow: 1.2,
        });
      }
      if (!this.reducedMotion) {
        this._spark.spawn(this._px, 1.15, 0, {
          life: 0.24, sx: 0.5, growX: 2.2, growY: 2.2,
          opacity: 1.0, fadePow: 1.8,
        });
      }
    });
    // Near-miss streak — quick side whoosh, additive so it flashes.
    events.on('nearmiss', () => {
      if (this.reducedMotion) return;
      const side = this._px >= 0 ? 1 : -1;
      for (let i = 0; i < 3; i++) {
        this._streak.spawn(this._px + side * (0.8 + i * 0.4), 1.0 + i * 0.3, -1 - i, {
          life: 0.32, vz: 14, vx: side * 2,
          sx: 0.5, sy: 2.2, rot: Math.PI / 2, opacity: 0.55, fadePow: 1.6,
        });
      }
    });
    // Portal swirl — additive blue-cyan glow burst that complements (never
    // duplicates) the collision workstream's shockwave on the same
    // 'crash' {kind:'portal'} event.
    events.on('crash', (info = {}) => {
      if (info.kind !== 'portal') return;
      const n = this.reducedMotion ? 4 : 9;
      const laneX = typeof info.lane === 'number' ? [-2.4, 0, 2.4][info.lane] ?? 0 : this._px;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const r = 0.4 + Math.random() * 0.4;
        this._swirl.spawn(laneX + Math.cos(a) * r, 1.5 + Math.sin(a) * r * 0.8, 0, {
          life: 0.7,
          vx: -Math.sin(a) * 3.2 + Math.cos(a) * 1.4,
          vy: Math.cos(a) * 3.2 + 1.4,
          vz: 0.8,
          sx: 0.4, growX: 1.0, growY: 1.0, spin: (Math.random() - 0.5) * 10,
          opacity: 0.8, fadePow: 1.4,
        });
      }
      if (!this.reducedMotion) {
        // One hot core flash at the swirl centre.
        this._swirl.spawn(laneX, 1.5, 0, {
          life: 0.3, sx: 0.8, growX: 3.2, growY: 3.2,
          opacity: 0.9, fadePow: 2.0,
        });
      }
    });
  }

  /** Clear all live particles (fresh run = clean slate). */
  reset() {
    for (const pool of [this._dust, this._spark, this._streak, this._wisp,
      this._swirl, this._trail, this._thrust, this._lines]) {
      pool.killAll();
    }
    this._dustT = 0; this._trailT = 0; this._thrustT = 0;
  }

  /**
   * Step all FX. Call once per fixed step in RUNNER (and GAMEOVER with
   * running:false so bursts finish gracefully).
   * st: { x, y, speed, speedN, glide, jet, running }
   */
  update(dt, st = {}) {
    const px = typeof st.x === 'number' ? st.x : this._px;
    const py = typeof st.y === 'number' ? st.y : this._py;
    this._px = px; this._py = py;
    const running = st.running !== false;
    const cam = this.camera;
    const camZ = cam ? cam.position.z : 7.5;
    const camX = cam ? cam.position.x : 0;

    this._dustT = Math.max(0, this._dustT - dt);
    this._trailT = Math.max(0, this._trailT - dt);
    this._thrustT = Math.max(0, this._thrustT - dt);

    if (running && !this.reducedMotion) {
      // Glideboard trail — soft puffs streaming behind the hero.
      if (st.glide && this._trailT <= 0) {
        this._trailT = 0.05;
        this._trail.spawn(px + (Math.random() - 0.5) * 0.4, py + 0.25, 0.9, {
          life: 0.55, vy: 0.5, vz: 3.5,
          sx: 0.3, growX: 1.5, growY: 1.5, opacity: 0.4, fadePow: 1.3,
        });
      }
      // Jetpack thrust — hot additive puffs below the hero while airborne
      // on jetpack.
      if (st.jet && this._thrustT <= 0) {
        this._thrustT = 0.045;
        this._thrust.spawn(px + (Math.random() - 0.5) * 0.3, py - 0.35, 0.3, {
          life: 0.34, vy: -4.5, vz: 1.5,
          sx: 0.34, growX: 2.0, growY: 2.0, opacity: 0.7, fadePow: 1.2,
        });
      }
      // Speed lines — subtle, edge-of-screen, only above ~70% of max speed.
      const speedN = typeof st.speedN === 'number' ? st.speedN : 0;
      if (speedN > 0.7) {
        const op = 0.26 * Math.min(1, (speedN - 0.7) / 0.3);
        for (const p of this._lines.items) {
          const s = p.spr;
          if (!p.active) {
            // (re)spawn at the frustum edges, ahead of the camera
            p.active = true;
            p.life = 0; p.maxLife = 999;
            const side = Math.random() < 0.5 ? -1 : 1;
            s.position.set(
              camX + side * (3.6 + Math.random() * 2.6),
              0.6 + Math.random() * 3.6,
              camZ - 9 - Math.random() * 4
            );
            s.scale.set(0.05 + Math.random() * 0.05, 1.2 + Math.random() * 1.4, 1);
            s.visible = true;
          }
          p.vz = (st.speed || 20) * 1.6;
          // recycle: streaked past the camera -> back to the far edge
          if (s.position.z > camZ + 1.5) {
            const side = Math.random() < 0.5 ? -1 : 1;
            s.position.set(
              camX + side * (3.6 + Math.random() * 2.6),
              0.6 + Math.random() * 3.6,
              camZ - 9 - Math.random() * 4
            );
          }
          s.material.opacity = op;
        }
      } else {
        this._lines.killAll();
      }
    } else if (!running) {
      this._lines.killAll();
    }

    this._dust.step(dt, camZ, camX);
    this._spark.step(dt, camZ, camX);
    this._streak.step(dt, camZ, camX);
    this._wisp.step(dt, camZ, camX);
    this._swirl.step(dt, camZ, camX);
    this._trail.step(dt, camZ, camX);
    this._thrust.step(dt, camZ, camX);
    // Speed lines are positioned manually above (world-anchored to the
    // camera), so they are NOT stepped by Pool.step — only culled/faded here.
    for (const p of this._lines.items) {
      if (!p.active) continue;
      const s = p.spr;
      s.position.z += p.vz * dt;
      if (s.position.z > camZ + 2) {
        p.active = false;
        s.visible = false;
      }
    }
  }
}

export default EffectsManager;
