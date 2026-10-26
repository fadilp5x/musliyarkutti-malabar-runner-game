import * as THREE from 'three';

// ShaytanPursuit — street pursuit for MUSLIYARKUTTI: MALABAR RUNNER.
// For ~10s after RUNNER begins, the Shaytan stays BEHIND the player
// (z > playerZ, i.e. nearer the camera — kept low and drifting so it never
// sits over the road hiding obstacles): it weaves forward/back, trails
// smoke, glows its eyes, and occasionally lunges with a warning cue
// (shaytan_warning SVG shown as a brief camera vignette, not a road
// blocker), then retreats into the distance dissolving into smoke
// (fade, no pop). After the retreat it stays dormant apart from a faint
// distant roar every 40–70s (sound hook + far smoke puff).
//
// Audio hooks (safe no-ops until the audio workstream wires names):
//   'shaytan_chase_breath' (pursuit start, lunges)
//   'shaytan_distant_roar'  (retreat beat, dormant roars)
//   'shaytan_surge'         (nearmiss/stumble surge)
// Emitted via this._sfx(name) → 'sfx' event (+ this.audio.play when an
// AudioManager is injected).
//
// Performance: fixed sprite pools, shared geometries/materials, no
// per-frame allocation. reducedMotion: minimal smoke, no lunges/flashes.

const BASE_URL = import.meta.env.BASE_URL;

const TRAIL_N = 10;   // smoke trail pool
const PURSUE_T = 8;   // seconds of active pursuit
const RETREAT_T = 2;  // seconds of dissolve-retreat

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function vignetteFallbackTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
  g.addColorStop(0, 'rgba(120,10,5,0)');
  g.addColorStop(0.65, 'rgba(120,10,5,0.25)');
  g.addColorStop(1, 'rgba(120,10,5,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function tendrilGeometry(w, h, segs) {
  const g = new THREE.PlaneGeometry(w, h, 1, segs);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position;
  g.userData.base = new Float32Array(pos.array);
  g.userData.h = h;
  return g;
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function easeIn(x) {
  return x * x * x;
}

export class ShaytanPursuit {
  constructor(scene, events) {
    this.scene = scene;
    this.events = events;
    this.audio = null; // optional: integrator may inject an AudioManager

    this._camera = null;
    this._assetLoader = null;
    this._playerX = null; // optional () => player x
    this.reducedMotion = false;

    // Shared procedural textures (per-instance; cheap, created once)
    this._smokeTex = radialTexture('rgba(200,200,210,0.55)', 'rgba(200,200,210,0)');
    this._darkTex = radialTexture('rgba(12,9,14,0.85)', 'rgba(12,9,14,0)');
    this._glowTex = radialTexture('rgba(255,110,30,0.65)', 'rgba(255,110,30,0)');
    this._vigTex = vignetteFallbackTexture();
    this._warnTex = null;

    // Presence growth factor: swells slightly on surge/lunge (pursue only).
    this._grow = 1;
    this._retreatGrow = 1;

    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    // Selectable apparition variants (Oct 13, 2026): 'classic' = the
    // procedural smoke form below; 'reaper' / 'shaythaan' = fari's supplied
    // GLB meshes (static — no skeleton — so they hover like apparitions
    // instead of running). GLBs lazy-load on first selection, never at boot.
    this._variant = 'classic';
    this._modelLoader = null;
    this._glbReady = false;
    this._glbMount = new THREE.Group();
    this._glbMount.visible = false;
    this.group.add(this._glbMount);
    this._glbEyeGlows = [];

    this._buildForm();
    this._buildTrail();
    this._buildVignette();
    this._buildDistantPuff();

    // Phases: 'idle' | 'pursue' | 'retreat' | 'dormant'
    this._phase = 'idle';
    this._t = 0;
    this._surgeT = 0;
    this._lunge = null;
    this._nextLunge = Infinity;
    this._spawnT = 0;
    this._nextRoar = Infinity;
    this._retreatFromZ = 0;
    this._puffT = -1;

    // Proximity reacts to gameplay: nearmiss/stumble → brief surge.
    this.events.on('nearmiss', () => this._onScareEvent());
    this.events.on('stumble', () => this._onScareEvent());
  }

  // --- optional wiring --------------------------------------------------------

  setCamera(camera) {
    this._camera = camera;
  }

  setAssetLoader(loader) {
    this._assetLoader = loader;
    this._ensureWarnTex();
  }

  setPlayerX(fn) {
    this._playerX = fn;
  }

  setReducedMotion(b) {
    this.reducedMotion = b === true;
  }

  // --- selectable apparition variants ---------------------------------------
  // 'classic' = procedural smoke form (always available).
  // 'reaper'  = fari's grim-reaper GLB, 'shaythaan' = fari's alt Shaytan GLB.
  // The GLBs are static meshes (no skeleton/animations), so they are
  // presented as hovering apparitions: gentle bob + sway, eye glow, and the
  // existing smoke trail. All pursuit motion (weave, lunge, retreat) is
  // unchanged — only the visual form swaps.

  setModelLoader(ml) {
    this._modelLoader = ml;
  }

  get variant() {
    return this._variant;
  }

  _glbActive() {
    return this._variant !== 'classic' && this._glbReady;
  }

  async setVariant(name) {
    const v = name === 'reaper' || name === 'shaythaan' ? name : 'classic';
    if (v === this._variant && (v === 'classic' || this._glbReady)) return;
    this._variant = v;
    this._glbReady = false;
    this._applyVariantVisibility();
    if (v === 'classic' || !this._modelLoader) return;
    const slot = v === 'reaper' ? 'shaytan_reaper' : 'shaytan_alt';
    try {
      const handle = await this._modelLoader.loadModel(slot);
      // The user may have switched again while this loaded.
      if (this._variant !== v) return;
      this._mountGlb(handle.object3D);
      this._glbReady = true;
    } catch (e) {
      console.warn(`[shaytan] variant "${v}" failed to load, staying classic:`, e);
      this._variant = 'classic';
    }
    this._applyVariantVisibility();
  }

  _mountGlb(obj) {
    // Clear any previous variant.
    while (this._glbMount.children.length) {
      this._glbMount.remove(this._glbMount.children[0]);
    }
    this._glbEyeGlows = [];
    if (obj.parent) obj.parent.remove(obj);

    const inner = new THREE.Group();
    inner.add(obj);
    // Normalize: apparition ~2.0 units tall, hovering with feet at ~0.3
    // (group base y=0.35 for GLB variants — roadside stalk, never blocking).
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const s = 2.0 / Math.max(size.y, 0.001);
    inner.scale.setScalar(s);
    inner.position.y += 0.3 - box.min.y * s;
    // Face the player: the pursuit trails behind at +Z, player is toward -Z.
    inner.rotation.y = Math.PI;
    inner.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this._glbMount.add(inner);

    // Track materials for the retreat dissolve (fade, never pop).
    this._glbMats = [];
    inner.traverse((o) => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          // Asset normalization: fully-metallic PBR with no environment map
          // renders black. The game has no env lighting, so clamp extreme
          // metalness to keep the model readable (documented, reversible).
          if (m.metalness !== undefined && m.metalness > 0.6 && !m.envMap) {
            m.metalness = 0.3;
          }
          if (!this._glbMats.includes(m)) {
            m.transparent = true;
            m.userData.baseOp = (typeof m.opacity === 'number') ? m.opacity : 1;
            this._glbMats.push(m);
          }
        }
      }
    });

    // Red eye glow at head height — the scare cue reads on any model.
    const eyeY = 0.3 + 2.0 * 0.87;
    for (const sx of [-1, 1]) {
      const m = new THREE.SpriteMaterial({
        map: this._glowTex,
        color: 0xff3a10,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const halo = new THREE.Sprite(m);
      halo.position.set(sx * 0.22, eyeY, -0.3);
      halo.scale.set(0.5, 0.5, 1);
      this._glbMount.add(halo);
      this._glbEyeGlows.push(halo);
    }
  }

  _applyVariantVisibility() {
    const glb = this._glbActive();
    this._glbMount.visible = glb;
    const proc = !glb;
    for (const c of this._columns) c.visible = proc;
    for (const td of this._tendrils) td.visible = proc;
    for (const e of this._eyes) e.visible = proc;
    for (const h of this._eyeHalos) h.visible = proc;
    if (this._blob) this._blob.visible = proc;
  }

  // --- audio ------------------------------------------------------------------

  _sfx(name) {
    if (this.audio) {
      try { this.audio.play(name); } catch { /* audio must never break the game */ }
    }
    this.events.emit('sfx', name);
  }

  // --- build ------------------------------------------------------------------

  _buildForm() {
    // 6 layered smoke sprites with independent drift, opacity and rotation:
    // 4 dense core columns + 2 faint outer wisp sheets.
    this._columns = [];
    for (let i = 0; i < 6; i++) {
      const wisp = i >= 4;
      const mat = new THREE.SpriteMaterial({
        map: this._smokeTex,
        color: wisp ? 0x2e2e3a : 0x23232e,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.userData = {
        phase: i * 2.3,
        rise: wisp ? 0.3 : 0.45 + (i % 4) * 0.1,
        sway: 0.6 + (i % 3) * 0.3,
        x0: wisp ? (i === 4 ? -1.1 : 1.1) : ((i % 4) - 1.5) * 0.38,
        age: (i / 6) * 2.4,
        life: wisp ? 3.2 : 2.4,
        maxOp: wisp ? 0.22 : 0.42 + (i % 2) * 0.1,
        w: wisp ? 2.6 : 1.0,
        h: wisp ? 3.4 : 2.0,
        spin: (i % 2 === 0 ? 1 : -1) * (wisp ? 0.28 : 0.12),
        spread: 0,      // dispersal direction at retreat start
        retreatX: 0,
      };
      this.group.add(s);
      this._columns.push(s);
    }

    // Two glowing eyes — standard material with a MODEST emissive so a
    // bloom pass can catch the red-orange glow; pulsed in _updatePursue.
    const eyeGeo = new THREE.SphereGeometry(0.07, 10, 10);
    this._eyes = [];
    this._eyeHalos = [];
    for (const sx of [-1, 1]) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x1a0500,
        emissive: 0xff3a10,
        emissiveIntensity: 1.4,
        transparent: true,
        opacity: 0,
        roughness: 0.4,
      });
      const eye = new THREE.Mesh(eyeGeo, mat);
      eye.position.set(sx * 0.3, 0.62, 0.25);
      this.group.add(eye);
      this._eyes.push(eye);
      // Additive halo so the glow reads even without a bloom pass.
      const hmat = new THREE.SpriteMaterial({
        map: this._glowTex,
        color: 0xff5a1a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const halo = new THREE.Sprite(hmat);
      halo.position.set(sx * 0.3, 0.62, 0.22);
      halo.scale.set(0.55, 0.55, 1);
      this.group.add(halo);
      this._eyeHalos.push(halo);
    }

    // 4 tendrils with vertex wobble — they reach forward toward the player
    // during lunge dashes (rotation.x + lengthen in _updatePursue).
    this._tendrils = [];
    for (let i = 0; i < 4; i++) {
      const geo = tendrilGeometry(0.24, 1.8, 10);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x1b1b25,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      const inner = i < 2;
      m.position.set((inner ? i - 0.5 : (i - 2.5) * 1.4) * 0.7, 0.05, -0.12);
      m.rotation.z = (i - 1.5) * 0.22;
      m.userData = { phase: i * 2.9, freq: 3.0 + i * 0.6, retreatRotX: 0 };
      this.group.add(m);
      this._tendrils.push(m);
    }

    // Ground shadow blob — kept low so it never hides the road; spreads as
    // the apparition grows (see _updatePursue).
    const blobMat = new THREE.MeshBasicMaterial({
      map: this._darkTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this._blob = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), blobMat);
    this._blob.rotation.x = -Math.PI / 2;
    this._blob.position.y = 0.03;
    this.group.add(this._blob);
  }

  _buildTrail() {
    // Fixed smoke-trail pool; sprites are recycled, never allocated per-frame.
    this._trail = [];
    for (let i = 0; i < TRAIL_N; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this._smokeTex,
        color: 0x2a2a34,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      s.userData = { age: 0, life: 1.4, vx: 0, vy: 0, vz: 0 };
      this.group.add(s);
      this._trail.push(s);
    }
    this._trailIdx = 0;
  }

  _buildVignette() {
    // Camera-attached warning vignette — a screen flash, never a road blocker.
    this._vignette = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({
        map: this._vigTex,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      })
    );
    this._vignette.renderOrder = 1000;
    this._vignette.visible = false;
    this.scene.add(this._vignette);
    this._vignT = -1;
  }

  _buildDistantPuff() {
    const mat = new THREE.SpriteMaterial({
      map: this._smokeTex,
      color: 0x1c1c26,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this._distantPuff = new THREE.Sprite(mat);
    this._distantPuff.scale.set(6, 4, 1);
    this._distantPuff.visible = false;
    this.scene.add(this._distantPuff);
  }

  _ensureWarnTex() {
    if (this._warnTex || !this._assetLoader) return;
    try {
      const p = this._assetLoader.loadSVGTexture(`${BASE_URL}svg/shaytan_warning.svg`, 256, 256);
      Promise.resolve(p)
        .then((tex) => {
          if (tex) {
            this._warnTex = tex;
            this._vignette.material.map = tex;
            this._vignette.material.needsUpdate = true;
          }
        })
        .catch(() => { /* fallback texture stays */ });
    } catch { /* fallback texture stays */ }
  }

  // --- control ----------------------------------------------------------------

  start() {
    this._phase = 'pursue';
    this._t = 0;
    this._surgeT = 0;
    this._lunge = null;
    this._nextLunge = this.reducedMotion ? Infinity : 2.5 + Math.random() * 2.5;
    this._spawnT = 0;
    this._vignT = -1;
    this._vignette.visible = false;
    this._vignette.material.opacity = 0;
    for (const s of this._trail) {
      s.visible = false;
      s.material.opacity = 0;
      s.userData.age = 0;
    }
    for (const e of this._eyes) e.material.opacity = 0;
    for (const h of this._eyeHalos) h.material.opacity = 0;
    for (const c of this._columns) {
      c.userData.spread = 0;
      c.material.rotation = 0;
    }
    this._blob.material.opacity = 0;
    this._grow = 1;
    this.group.visible = true;
    this.group.scale.set(1, 1, 1);
    this._ensureWarnTex();
    this._sfx('shaytan_chase_breath');
  }

  reset() {
    this._phase = 'idle';
    this._t = 0;
    this._surgeT = 0;
    this._lunge = null;
    this._nextLunge = Infinity;
    this._nextRoar = Infinity;
    this._puffT = -1;
    this._vignT = -1;
    this.group.visible = false;
    this._vignette.visible = false;
    this._vignette.material.opacity = 0;
    this._distantPuff.visible = false;
    this._distantPuff.material.opacity = 0;
    for (const s of this._trail) {
      s.visible = false;
      s.material.opacity = 0;
    }
    for (const c of this._columns) {
      c.material.rotation = 0;
      c.userData.spread = 0;
    }
    for (const e of this._eyes) {
      e.material.opacity = 0;
      e.material.emissiveIntensity = 1.4;
    }
    for (const h of this._eyeHalos) h.material.opacity = 0;
    for (const td of this._tendrils) {
      const pos = td.geometry.attributes.position;
      pos.array.set(td.geometry.userData.base);
      pos.needsUpdate = true;
      td.rotation.x = 0;
      td.scale.y = 1;
    }
    this._grow = 1;
    this._retreatGrow = 1;
    // GLB apparition variant: restore full opacity (a previous retreat may
    // have faded it) and re-apply which form is visible.
    for (const m of this._glbMats || []) m.opacity = m.userData.baseOp || 1;
    for (const h of this._glbEyeGlows) h.material.opacity = 0.8;
    this._glbMount.position.set(0, 0, 0);
    this._glbMount.rotation.set(0, 0, 0);
    this._applyVariantVisibility();
  }

  _onScareEvent() {
    // Only when the apparition is visibly present — otherwise it would pop in.
    if (this._phase === 'pursue' || this._phase === 'retreat') {
      if (this._surgeT <= 0) {
        this._surgeT = 1.2;
        this._sfx('shaytan_surge');
      }
    }
  }

  // --- per-frame ---------------------------------------------------------------

  update(dt, playerZ, speed) {
    if (this._phase === 'idle') return;
    if (this._phase === 'pursue') this._updatePursue(dt, playerZ);
    else if (this._phase === 'retreat') this._updateRetreat(dt, playerZ);
    else if (this._phase === 'dormant') this._updateDormant(dt);

    // Warning vignette lifecycle (glued to the camera when active)
    if (this._vignT >= 0) {
      this._vignT += dt;
      const k = this._vignT / 0.9;
      if (k >= 1) {
        this._vignT = -1;
        this._vignette.visible = false;
        this._vignette.material.opacity = 0;
      } else {
        this._vignette.visible = true;
        this._vignette.material.opacity = 0.55 * Math.sin(Math.PI * clamp01(k));
        if (this._camera) {
          this._vignette.position.copy(this._camera.position);
          this._vignette.quaternion.copy(this._camera.quaternion);
          this._vignette.translateZ(-0.6);
        }
      }
    }

    // Distant smoke puff lifecycle
    if (this._puffT >= 0) {
      this._puffT += dt;
      const k = this._puffT / 3;
      if (k >= 1) {
        this._puffT = -1;
        this._distantPuff.visible = false;
        this._distantPuff.material.opacity = 0;
      } else {
        this._distantPuff.visible = true;
        this._distantPuff.material.opacity = 0.4 * Math.sin(Math.PI * clamp01(k));
      }
    }
  }

  _spawnTrailPuff(x, y, z) {
    const s = this._trail[this._trailIdx];
    this._trailIdx = (this._trailIdx + 1) % this._trail.length;
    const u = s.userData;
    u.age = 0;
    u.life = 1.3;
    u.vx = (Math.random() - 0.5) * 0.6;
    u.vy = -0.25 - Math.random() * 0.3;
    u.vz = 1.0 + Math.random() * 0.8; // drifts back toward the camera
    s.position.set(x + (Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.8, z + 0.4);
    s.scale.set(0.6, 0.6, 1);
    s.visible = true;
  }

  _stepTrail(dt) {
    for (const s of this._trail) {
      if (!s.visible) continue;
      const u = s.userData;
      u.age += dt;
      if (u.age >= u.life) { s.visible = false; s.material.opacity = 0; continue; }
      const k = u.age / u.life;
      s.position.x += u.vx * dt;
      s.position.y += u.vy * dt;
      s.position.z += u.vz * dt;
      const sc = 0.6 + k * 1.1;
      s.scale.set(sc, sc, 1);
      s.material.opacity = 0.45 * (1 - k);
    }
  }

  _playerBaseX() {
    return typeof this._playerX === 'function' ? this._playerX() : 0;
  }

  _updatePursue(dt, playerZ) {
    this._t += dt;
    const t = this._t;
    const rm = this.reducedMotion;
    const px = this._playerBaseX();

    // Surge envelope (from nearmiss/stumble)
    if (this._surgeT > 0) this._surgeT -= dt;
    const surgeK = clamp01(this._surgeT / 1.2);

    // Lunge state machine: warn (vignette) → dash → back
    let lungeZ = 0;
    if (this._lunge) {
      const L = this._lunge;
      L.t += dt;
      if (L.phase === 'warn' && L.t >= 0.7) { L.phase = 'dash'; L.t = 0; }
      else if (L.phase === 'dash' && L.t >= 0.45) {
        L.phase = 'back'; L.t = 0;
        this._sfx('shaytan_chase_breath');
      } else if (L.phase === 'back' && L.t >= 0.9) {
        this._lunge = null;
        this._nextLunge = t + 3 + Math.random() * 3;
      }
      if (this._lunge) {
        if (L.phase === 'dash') lungeZ = -1.8 * easeIn(clamp01(L.t / 0.45));
        else if (L.phase === 'back') lungeZ = -1.8 * (1 - clamp01(L.t / 0.9));
      }
    } else if (t >= this._nextLunge && t < PURSUE_T - 1.6) {
      this._lunge = { phase: 'warn', t: 0 };
      this._vignT = 0;
    }

    // Position: behind the player (z > playerZ), low, weaving — never high
    // over the road where it could hide obstacles.
    const baseZ = (rm ? 4.6 : 3.4) - surgeK * 1.1;
    let z = playerZ + baseZ + Math.sin(t * 0.9) * 0.9 + lungeZ;
    let x = px + Math.sin(t * 1.3) * 1.6;
    let y = 0.75 + Math.sin(t * 2) * 0.12;
    // GLB apparition variant: hover bob + eerie sway (the mesh itself is
    // static — no skeleton — so all motion is at the mount level).
    const glb = this._glbActive();
    if (glb) {
      // Solid model (unlike translucent smoke): stalk from the roadside so it
      // never blocks the player's view of obstacles. Lunges still dash in.
      x = px + 2.6 + Math.sin(t * 1.1) * 0.5 - (this._lunge && this._lunge.phase === 'dash' ? 1.2 : 0);
      z = playerZ + 2.6 + lungeZ * 0.6;
      y = 0.35;
      this._glbMount.position.y = Math.sin(t * 2.2) * 0.14;
      this._glbMount.rotation.z = Math.sin(t * 1.4) * 0.06;
      this._glbMount.rotation.y = Math.sin(t * 0.9) * 0.12;
      const pulse = 0.65 + Math.sin(t * 6) * 0.15 + surgeK * 0.3;
      for (const h of this._glbEyeGlows) h.material.opacity = Math.min(0.9, pulse);
    }
    this.group.position.set(x, y, Math.max(playerZ + 1.2, z));

    if (!glb) {
    // Layered smoke — 4 core columns + 2 outer wisps, each drifting and
    // rotating independently (rotation drift lives in the sprite material).
    for (const c of this._columns) {
      const u = c.userData;
      u.age += dt;
      if (u.age >= u.life) u.age = 0;
      const ak = u.age / u.life;
      c.position.set(
        u.x0 + Math.sin(t * u.sway + u.phase) * 0.3,
        u.age * u.rise,
        Math.cos(t * 0.8 + u.phase) * 0.25
      );
      c.scale.set(u.w * (1 + ak * 0.35), u.h + ak * 0.9, 1);
      c.material.rotation += u.spin * dt;
      c.material.opacity = u.maxOp * Math.sin(Math.PI * clamp01(ak)) * (rm ? 0.6 : 1);
    }

    // Eyes: red-orange emissive pulse (bloom-friendly, modest intensity),
    // brighter on surge/lunge; additive halos keep the glow readable
    // without a bloom pass.
    const glow = 0.55 + Math.sin(t * 6) * 0.15 + surgeK * 0.3 + (this._lunge ? 0.2 : 0);
    const emis = (rm ? 1.1 : 1.4) + Math.sin(t * 6) * 0.3 + surgeK * 0.6 + (this._lunge ? 0.5 : 0);
    for (let i = 0; i < this._eyes.length; i++) {
      const e = this._eyes[i];
      e.material.opacity = Math.min(1, glow);
      e.material.emissiveIntensity = Math.min(2.4, emis);
      e.position.y = 0.62 + Math.sin(t * 2.4) * 0.03;
      const h = this._eyeHalos[i];
      h.material.opacity = Math.min(0.75, glow * 0.6) * (rm ? 0.7 : 1);
      const hs = 0.5 + Math.sin(t * 6 + i * 1.7) * 0.07 + surgeK * 0.18;
      h.scale.set(hs, hs, 1);
      h.position.y = e.position.y;
    }

    // Tendril wobble; during a lunge dash they reach forward (-z, toward the
    // player) and lengthen.
    const dashK = this._lunge && this._lunge.phase === 'dash' && !rm
      ? easeIn(clamp01(this._lunge.t / 0.45)) : 0;
    for (const td of this._tendrils) {
      const pos = td.geometry.attributes.position;
      const base = td.geometry.userData.base;
      const h = td.geometry.userData.h;
      const wob = 1 + dashK * 0.6;
      for (let i = 0; i < pos.count; i++) {
        const k = base[i * 3 + 1] / h;
        pos.array[i * 3] = base[i * 3] + Math.sin(t * td.userData.freq + td.userData.phase + k * 4.5) * 0.2 * k * wob;
      }
      pos.needsUpdate = true;
      td.rotation.x = -dashK * 0.85;
      td.scale.y = 1 + dashK * 0.9;
      td.material.opacity = Math.min(0.95, 0.7 + dashK * 0.25) * (rm ? 0.6 : 1);
    }

    // Presence growth: the apparition swells slightly on surge/lunge (group
    // scale — applies to the GLB mount too).
    const growT = 1 + surgeK * 0.1 + (this._lunge && !rm ? 0.14 : 0);
    this._grow += (growT - this._grow) * Math.min(1, dt * 3);
    this.group.scale.setScalar(this._grow);
    } // end procedural-only visuals (if (!glb))

    // Ground shadow blob (procedural form only) spreads wider than growth.
    if (!glb) {
      const blobS = this._grow * (1.1 + Math.sin(t * 1.7) * 0.25);
      this._blob.scale.set(blobS, blobS, 1);
      this._blob.material.opacity = 0.5 * (rm ? 0.6 : 1);
    }

    // Smoke trail (fixed pool)
    this._spawnT -= dt;
    const interval = rm ? 0.28 : 0.09;
    if (this._spawnT <= 0) {
      this._spawnT = interval;
      this._spawnTrailPuff(x, 0, this.group.position.z);
    }
    this._stepTrail(dt);

    // Pursuit ends → dissolve-retreat
    if (t >= PURSUE_T) {
      this._phase = 'retreat';
      this._t = 0;
      this._retreatFromZ = this.group.position.z;
      this._retreatGrow = this._grow;
      this._lunge = null;
      // Snapshot current opacities so the retreat fades linearly (no pop),
      // and give every column a dispersal direction for the dissolve.
      for (const c of this._columns) {
        c.userData.retreatOp = c.material.opacity;
        c.userData.retreatX = c.position.x;
        c.userData.spread = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 1.2);
      }
      for (const e of this._eyes) e.userData.retreatOp = e.material.opacity;
      for (const h of this._eyeHalos) h.userData.retreatOp = h.material.opacity;
      for (const td of this._tendrils) {
        td.userData.retreatOp = td.material.opacity;
        td.userData.retreatRotX = td.rotation.x;
      }
      this._blob.userData.retreatOp = this._blob.material.opacity;
      this._blob.userData.retreatS = this._blob.scale.x;
      // Dispersal burst: a soft cloud of smoke where the apparition stood,
      // so the dissolve reads as a burst rather than a vanish.
      if (!rm) {
        for (let i = 0; i < 6; i++) {
          const s = this._trail[this._trailIdx];
          this._trailIdx = (this._trailIdx + 1) % this._trail.length;
          const u = s.userData;
          u.age = 0;
          u.life = 1.6 + Math.random() * 0.8;
          const a = Math.random() * Math.PI * 2;
          u.vx = Math.cos(a) * (0.8 + Math.random());
          u.vy = 0.3 + Math.random() * 0.7;
          u.vz = Math.sin(a) * (0.8 + Math.random());
          s.position.set(
            this.group.position.x + Math.cos(a) * 0.4,
            0.6 + Math.random() * 0.8,
            this.group.position.z + Math.sin(a) * 0.4
          );
          s.scale.set(0.7, 0.7, 1);
          s.visible = true;
        }
      }
      this._sfx('shaytan_distant_roar');
    }
  }

  _updateRetreat(dt, playerZ) {
    this._t += dt;
    const k = clamp01(this._t / RETREAT_T);
    const z = this._retreatFromZ + easeIn(k) * 16;
    this.group.position.z = z;
    this.group.position.y = 0.75 + k * 1.2; // rises as it recedes
    const fade = 1 - k;
    const grow = (this._retreatGrow || 1) * (1 - k * 0.35);
    this.group.scale.setScalar(grow);
    // Columns drift apart, keep rotating and swelling as they thin out — a
    // dissolve, never a pop.
    for (const c of this._columns) {
      const u = c.userData;
      c.material.opacity = (u.retreatOp || 0) * fade;
      c.position.x = (u.retreatX || 0) + (u.spread || 0) * k * 1.6;
      c.material.rotation += (u.spin || 0) * dt * (1 + k * 2);
      const sc = 1 + k * 0.8;
      c.scale.set(u.w * sc, u.h * sc, 1);
    }
    // Eyes and their halos linger a beat, then die faster than the smoke.
    for (const e of this._eyes) e.material.opacity = (e.userData.retreatOp || 0) * fade * fade;
    for (const h of this._eyeHalos) h.material.opacity = (h.userData.retreatOp || 0) * fade * fade;
    // Tendrils shrivel as the form loses cohesion.
    for (const td of this._tendrils) {
      td.material.opacity = (td.userData.retreatOp || 0) * fade;
      td.scale.y = Math.max(0.05, 1 - k * 0.9);
      td.rotation.x = (td.userData.retreatRotX || 0) * fade;
    }
    // Shadow blob spreads wide and thin as the presence lifts.
    const bs = (this._blob.userData.retreatS || 1) * (1 + k * 1.4);
    this._blob.scale.set(bs, bs * 0.8, 1);
    this._blob.material.opacity = (this._blob.userData.retreatOp || 0) * fade;
    // GLB apparition variant: dissolve the mesh + eye glows (never pop).
    if (this._glbActive()) {
      for (const m of this._glbMats || []) m.opacity = (m.userData.baseOp || 1) * fade;
      for (const h of this._glbEyeGlows) h.material.opacity = 0.8 * fade * fade;
      this._glbMount.position.y = k * 1.2; // rises with the retreat
    }
    // The dispersal burst keeps animating through the retreat.
    this._stepTrail(dt);

    if (k >= 1) {
      this.group.visible = false;
      this._phase = 'dormant';
      this._t = 0;
      this._nextRoar = 40 + Math.random() * 30;
    }
  }

  _updateDormant(dt) {
    this._t += dt;
    if (this._t >= this._nextRoar) {
      this._t = 0;
      this._nextRoar = 40 + Math.random() * 30;
      this._sfx('shaytan_distant_roar');
      // Faint distant smoke puff — atmosphere only, far beyond the road.
      this._distantPuff.position.set((Math.random() - 0.5) * 10, 2.5, -38);
      this._puffT = 0;
    }
  }
}
