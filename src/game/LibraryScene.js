import * as THREE from 'three';

// LibraryScene — procedural 3D library (engine workstream).
// Timeline: LIBRARY (hero `reading` at desk, tap to begin) → SHAYTAN (~4.2s
// cinematic scare: warm peaceful reading → lights dim + flicker, layered
// smoke gathers behind the hero, red-orange eyes fade in, the silhouette
// grows taller with animated tendrils, hero `react` (head turn) → LUNGE →
// hero closes the kitab, `standup`) → CHASE (~5s: hero `run` between shelf
// rows toward the glowing doorway with the Shaytan visibly chasing behind
// him, dissolving into smoke before the fade) → RUNNER (street).
// The shaytan is atmospheric smoke + glowing eyes only — no gore.
//
// Audio hooks (all safe no-ops until wired): `this._sfx(name)` emits an
// 'sfx' event with the name (and calls this.audio.play(name) when an
// AudioManager was injected). Room ambience is ducked via
// `events.emit('audioDuck', { level })` during the scare.

const BASE_URL = import.meta.env.BASE_URL;

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

function pageTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f7efdc';
  ctx.fillRect(0, 0, 256, 320);
  ctx.strokeStyle = '#c9a94e';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 240, 304);
  ctx.strokeStyle = '#8a7a5c';
  ctx.lineWidth = 3;
  for (let y = 60; y < 290; y += 26) {
    ctx.beginPath();
    // Wavy "handwriting" lines suggesting kitab script
    for (let x = 30; x <= 226; x += 8) {
      const yy = y + Math.sin(x * 0.15 + y) * 3;
      if (x === 30) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 144;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3d2a18';
  ctx.fillRect(0, 0, 1024, 144);
  ctx.strokeStyle = '#d9a441';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 1004, 124);
  ctx.fillStyle = '#f3e3b8';
  ctx.font = '700 62px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SHAMSUL HUDA LIBRARY', 512, 76);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function tendrilGeometry(w, h, segs) {
  const g = new THREE.PlaneGeometry(w, h, 1, segs);
  g.translate(0, h / 2, 0); // pivot at the base
  const pos = g.attributes.position;
  g.userData.base = new Float32Array(pos.array); // pristine copy for wobble
  g.userData.h = h;
  return g;
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function easeIn(x) {
  return x * x * x;
}

export class LibraryScene {
  constructor(scene, assetLoader, avatar, events) {
    this.scene = scene;
    this.assetLoader = assetLoader;
    this.avatar = avatar;
    this.events = events;
    this.audio = null; // optional: integrator may inject an AudioManager

    this.group = new THREE.Group();   // everything library (removed after chase)
    this.aisle = new THREE.Group();   // scrollable shelf rows
    this.reducedMotion = false;

    this._elapsed = 0;
    this._timers = [];

    this._warmLight = null;
    this._ambient = null;
    this._fillLight = null; // cool fill so shelf shadows never go pitch black
    this._lightTarget = { warm: 60, amb: 0.5 };
    this._flicker = false;

    this._dust = null;
    this._dustPos = null;

    // Cinematic shaytan apparition: smoke columns + eyes + tendrils + blob.
    this._shGroup = null;
    this._columns = [];
    this._eyes = [];
    this._tendrils = [];
    this._blob = null;
    this._driftShadows = [];
    this._smoke = [];   // short-lived smoke burst sprites

    this._scare = false;
    this._scareT = 0;
    this._kitabClose = -1; // -1 idle, else 0..1 close progress
    this._kitabLeft = null;
    this._kitabRight = null;

    this._chasing = false;
    this._chaseT = 0;
    this._chaseShaytan = false; // apparition active during the chase
    this._chaseTCh = 0;
    this._dissolvePuffed = false;
    this._chasePuffed = false;
    this._sfxFired = null;
    this._door = null;
    this._doorGlowMat = null;

    this._fadeMesh = null;
    this._chaseCleaned = false;
    this._camera = null;
  }

  // Optional: give the scene the active camera so the chase fade plane can
  // stay glued in front of it. (Extra helper; contracted API unchanged.)
  setCamera(camera) {
    this._camera = camera;
  }

  // --- audio ----------------------------------------------------------------

  // Safe no-op until wired: emits an 'sfx' event with the hook name, and also
  // plays through an injected AudioManager when one is assigned. The game
  // integrator wires 'sfx' → audio.play(name); unknown names are no-ops.
  _sfx(name) {
    if (this.audio) {
      try { this.audio.play(name); } catch { /* audio must never break the game */ }
    }
    this.events.emit('sfx', name);
  }

  // --- timeline helpers ---------------------------------------------------

  _after(delay, fn) {
    this._timers.push({ at: this._elapsed + delay, fn, done: false });
  }

  _wait(sec) {
    return new Promise((resolve) => this._after(sec, resolve));
  }

  // --- build --------------------------------------------------------------

  async init() {
    this._smokeTex = radialTexture('rgba(200,200,210,0.55)', 'rgba(200,200,210,0)');
    this._darkTex = radialTexture('rgba(12,9,14,0.85)', 'rgba(12,9,14,0)');

    // Lights — tuned to read well under ACESFilmic: warm key lifted modestly
    // (ACES compresses mids), a faint cool fill keeps shelf shadows readable
    // instead of pitch black, and the scare-dim targets stay low but never 0.
    this._ambient = new THREE.AmbientLight(0xffdfb8, 0.5);
    this.scene.add(this._ambient);
    this._warmLight = new THREE.PointLight(0xffa95e, 60, 26, 1.6);
    this._warmLight.position.set(0, 4.4, 1.2);
    this.group.add(this._warmLight);
    this._fillLight = new THREE.PointLight(0x91a7cc, 7, 30, 1.7);
    this._fillLight.position.set(0, 5, -20);
    this.group.add(this._fillLight);

    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.85 });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x4a3120, roughness: 0.9 });
    const plaster = new THREE.MeshStandardMaterial({ color: 0xd9c9a8, roughness: 0.95 });

    // Floor + walls + ceiling
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 46), new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -14);
    this.group.add(floor);

    // Back wall WITH A REAL DOORWAY OPENING (Oct 14, 2026 cinematic rebuild).
    // The wall is built from segments leaving a 4-wide, 4.5-tall opening in
    // the center. No invisible wall — the camera and character pass through.
    const DOOR_W = 4.0, DOOR_H = 4.5, WALL_Z = -6.2;
    const wallSegMat = plaster;
    // Left segment (x from -9 to -2)
    const wallL = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), wallSegMat);
    wallL.position.set(-5.5, 3.5, WALL_Z);
    this.group.add(wallL);
    // Right segment (x from 2 to 9)
    const wallR = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), wallSegMat);
    wallR.position.set(5.5, 3.5, WALL_Z);
    this.group.add(wallR);
    // Top segment above doorway (y from 4.5 to 7)
    const wallT = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, 2.5), wallSegMat);
    wallT.position.set(0, 5.75, WALL_Z);
    this.group.add(wallT);

    // Traditional wooden door frame
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a3120, roughness: 0.85 });
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, DOOR_H, 0.6), frameMat);
      post.position.set(sx * (DOOR_W / 2 + 0.2), DOOR_H / 2, WALL_Z);
      post.castShadow = true;
      this.group.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.8, 0.4, 0.6), frameMat);
    lintel.position.set(0, DOOR_H + 0.2, WALL_Z);
    lintel.castShadow = true;
    this.group.add(lintel);
    // Arch above (traditional)
    const arch = new THREE.Mesh(new THREE.TorusGeometry(DOOR_W / 2, 0.22, 10, 24, Math.PI), frameMat);
    arch.position.set(0, DOOR_H + 0.4, WALL_Z);
    this.group.add(arch);

    // Open door panels (swung outward into the courtyard)
    const doorPanelGeo = new THREE.BoxGeometry(DOOR_W / 2 - 0.05, DOOR_H - 0.1, 0.08);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8 });
    for (const sx of [-1, 1]) {
      const panel = new THREE.Mesh(doorPanelGeo, doorMat);
      // Hinge at the frame post, opened ~110 degrees outward
      panel.geometry.translate(sx * (DOOR_W / 4 - 0.025), 0, 0);
      panel.position.set(sx * (DOOR_W / 2), (DOOR_H - 0.1) / 2, WALL_Z);
      panel.rotation.y = sx * -1.9; // swung open into courtyard
      panel.castShadow = true;
      this.group.add(panel);
    }

    // Stone threshold
    const threshold = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR_W + 0.6, 0.18, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x9a8a72, roughness: 0.95 })
    );
    threshold.position.set(0, 0.09, WALL_Z);
    threshold.receiveShadow = true;
    this.group.add(threshold);

    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(46, 7), plaster);
      wall.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
      wall.position.set(sx * 9, 3.5, -14);
      this.group.add(wall);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(18, 46), new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, 6.4, -14);
    this.group.add(ceil);

    // Carpet runner under the aisle
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 44), new THREE.MeshStandardMaterial({ color: 0x7a2e2e, roughness: 1 }));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, 0.01, -14);
    this.group.add(carpet);

    // Wall sign above the back wall
    this._buildSign();

    // Courtyard beyond the real doorway (Oct 14, 2026): outdoor ground,
    // sunlight, palms, and the academy gate in the distance.
    this._buildCourtyard();

    // Shelf rows forming the chase aisle (x = ±3.4, z from -38 to 6)
    this._buildShelfRows(wood, woodDark);
    this.group.add(this.aisle);

    // Desk + open kitab
    this._buildDesk(wood, woodDark);

    // Framed poster from location_library_exit.svg
    await this._buildPoster(woodDark);

    // (Oct 14, 2026: the old glowing doorway is retired — the exit is now a
    // real opening in the back wall at z=-6.2, built in init() above.)

    // Shaytan apparition (hidden until the scare)
    this._buildShaytan();

    // Dust motes
    this._buildDust();

    // Hero in the aisle, searching (Oct 14, 2026 cinematic rebuild: no longer
    // reading at the desk — the opening is a search between the shelves).
    this.avatar.group.position.set(0, 0, 3.5);
    this.avatar.group.rotation.set(0, 0, 0);
    this.avatar.setAnim('idle');

    this.scene.add(this.group);
  }

  _buildSign() {
    const tex = signTexture();
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(6.7, 1.05, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x2e1f10, roughness: 0.9 })
    );
    // Above the real doorway (Oct 14, 2026): sign stays visible over the exit.
    backing.position.set(0, 5.6, -6.18);
    this.group.add(backing);
    // Plaque carries a modest self-glow so "SHAMSUL HUDA LIBRARY" stays
    // legible even when the scare dims the room lights.
    this._plaqueMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.8,
      emissive: 0xfff3d8,
      emissiveMap: tex,
      emissiveIntensity: 0.3,
    });
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 0.9),
      this._plaqueMat
    );
    plaque.position.set(0, 5.6, -6.12);
    this.group.add(plaque);
  }

  // Courtyard beyond the library exit (Oct 14, 2026 cinematic rebuild).
  // Bright outdoor space: sunlit ground, palms, academy gate in the distance.
  // The route runs: library aisle → doorway (z=-6.2) → courtyard → gate (z=-25).
  _buildCourtyard() {
    const g = new THREE.Group();
    this._courtyard = g;

    // Outdoor ground: warm sand/grass, from the doorway to beyond the gate
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xc9b184, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(36, 28), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.01, -20);
    ground.receiveShadow = true;
    g.add(ground);

    // Path: stone slabs from the doorway to the gate
    const pathMat = new THREE.MeshStandardMaterial({ color: 0x9a8a72, roughness: 0.95 });
    for (let z = -7; z >= -24; z -= 2.2) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 2.0), pathMat);
      slab.position.set(0, 0.02, z);
      slab.receiveShadow = true;
      g.add(slab);
    }

    // Bright sky backdrop (gradient plane far behind the courtyard)
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 16; skyCanvas.height = 128;
    const sctx = skyCanvas.getContext('2d');
    const grad = sctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#3a7bd5');   // zenith blue
    grad.addColorStop(0.6, '#87b5d6'); // horizon blue
    grad.addColorStop(1, '#ffe9b8');   // warm haze at ground
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 16, 128);
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 40),
      new THREE.MeshBasicMaterial({ map: skyTex, fog: false })
    );
    sky.position.set(0, 12, -38);
    g.add(sky);

    // Sun: bright directional light for the courtyard
    this._sunLight = new THREE.DirectionalLight(0xfff2d8, 3.0);
    this._sunLight.position.set(8, 18, -14);
    this._sunLight.target.position.set(0, 0, -18);
    this._sunLight.castShadow = true;
    this._sunLight.shadow.camera.left = -20;
    this._sunLight.shadow.camera.right = 20;
    this._sunLight.shadow.camera.top = 20;
    this._sunLight.shadow.camera.bottom = -20;
    this._sunLight.shadow.mapSize.set(1024, 1024);
    g.add(this._sunLight);
    g.add(this._sunLight.target);
    // Sun starts dim (interior mood); brightens when the character exits.
    this._sunLight.intensity = 0.4;

    // Simple palms (trunk + frond cone) flanking the path
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x2e8a4e, roughness: 0.85 });
    const palmAt = (x, z, s = 1) => {
      const palm = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * s, 0.2 * s, 3.2 * s, 7), trunkMat);
      trunk.position.y = 1.6 * s;
      trunk.castShadow = true;
      palm.add(trunk);
      for (let i = 0; i < 6; i++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(0.5 * s, 1.8 * s, 5), frondMat);
        const a = (i / 6) * Math.PI * 2;
        frond.position.set(Math.cos(a) * 0.7 * s, 3.3 * s, Math.sin(a) * 0.7 * s);
        frond.rotation.z = Math.cos(a) * 0.9;
        frond.rotation.x = Math.sin(a) * 0.9;
        frond.castShadow = true;
        palm.add(frond);
      }
      palm.position.set(x, 0, z);
      palm.rotation.y = Math.random() * Math.PI;
      g.add(palm);
    };
    palmAt(-7, -11); palmAt(7.5, -13); palmAt(-8, -19); palmAt(8, -21, 1.2);

    // Academy gate in the distance (simple arch: pillars + lintel + sign)
    const gateMat = new THREE.MeshStandardMaterial({ color: 0xd9c9a8, roughness: 0.85 });
    const gate = new THREE.Group();
    for (const sx of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5.5, 0.8), gateMat);
      pillar.position.set(sx * 2.8, 2.75, 0);
      pillar.castShadow = true;
      gate.add(pillar);
    }
    const gateLintel = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.9, 0.9), gateMat);
    gateLintel.position.set(0, 5.5, 0);
    gateLintel.castShadow = true;
    gate.add(gateLintel);
    // Gate sign
    const gateSign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.5, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x1a3a5a, roughness: 0.7 })
    );
    gateSign.position.set(0, 5.5, 0.46);
    gate.add(gateSign);
    gate.position.set(0, 0, -26);
    g.add(gate);
    this._academyGateSimple = gate;

    this.group.add(g);
  }

  _buildShelfRows(wood, woodDark) {
    // One shelf unit: frame + 4 shelves; books as instanced spines across all units.
    const unitW = 2.2;
    const unitH = 3.2;
    const unitD = 0.55;
    const bookGeos = [];
    const bookXforms = [];
    const bookColors = [];
    const palette = [0x8a2e2e, 0x2e5a8a, 0x2e8a4e, 0xb07f2a, 0x6a3a8a, 0x8a5a2e, 0x3a7a8a, 0xa03a5a];

    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };

    const addUnit = (x, z) => {
      const unit = new THREE.Group();
      const side = new THREE.BoxGeometry(0.08, unitH, unitD);
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(side, wood);
        p.position.set(sx * (unitW / 2), unitH / 2, 0);
        unit.add(p);
      }
      const shelfGeo = new THREE.BoxGeometry(unitW, 0.07, unitD);
      for (let i = 0; i <= 4; i++) {
        const s = new THREE.Mesh(shelfGeo, wood);
        s.position.set(0, 0.15 + i * 0.72, 0);
        unit.add(s);
        // Books on this shelf
        let bx = -unitW / 2 + 0.1;
        while (bx < unitW / 2 - 0.12) {
          const bw = 0.06 + rnd() * 0.05;
          const bh = 0.42 + rnd() * 0.16;
          const lean = rnd() < 0.08 ? 0.12 : 0;
          bookGeos.push({ x: x + bx + bw / 2, y: 0.15 + i * 0.72 + 0.035 + bh / 2, z, bw, bh, lean });
          bookColors.push(palette[Math.floor(rnd() * palette.length)]);
          bx += bw + 0.008 + (rnd() < 0.1 ? 0.09 : 0);
        }
      }
      const back = new THREE.Mesh(new THREE.BoxGeometry(unitW, unitH, 0.06), woodDark);
      back.position.set(0, unitH / 2, -unitD / 2);
      unit.add(back);
      unit.position.set(x, 0, z);
      this.aisle.add(unit);
    };

    for (let z = 6; z >= -4; z -= 2.5) {
      addUnit(-3.4, z);
      addUnit(3.4, z);
    }

    // Instanced book spines
    const geo = new THREE.BoxGeometry(1, 1, 0.34);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const inst = new THREE.InstancedMesh(geo, mat, bookGeos.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    bookGeos.forEach((b, i) => {
      e.set(0, 0, b.lean);
      q.setFromEuler(e);
      v.set(b.x, b.y, b.z);
      sc.set(b.bw, b.bh, 1);
      m.compose(v, q, sc);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, col.setHex(bookColors[i]));
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.aisle.add(inst);
  }

  _buildDesk(wood, woodDark) {
    const desk = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 1.2), wood);
    top.position.y = 0.78;
    desk.add(top);
    const legGeo = new THREE.BoxGeometry(0.1, 0.78, 0.1);
    for (const [lx, lz] of [[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]]) {
      const leg = new THREE.Mesh(legGeo, woodDark);
      leg.position.set(lx, 0.39, lz);
      desk.add(leg);
    }
    // Chair
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.55), woodDark);
    seat.position.set(0, 0.5, 0.75);
    desk.add(seat);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.08), woodDark);
    backrest.position.set(0, 0.9, 1.0);
    desk.add(backrest);

    // Open kitab: two page planes (kept for the closing-kitab beat)
    const pgTex = pageTexture();
    const pgMat = new THREE.MeshStandardMaterial({ map: pgTex, roughness: 0.9, side: THREE.DoubleSide });
    const pgGeo = new THREE.PlaneGeometry(0.42, 0.55);
    const left = new THREE.Mesh(pgGeo, pgMat);
    left.rotation.x = -Math.PI / 2 + 0.16;
    left.rotation.z = 0.06;
    left.position.set(-0.2, 0.86, 0);
    const right = new THREE.Mesh(pgGeo, pgMat);
    right.rotation.x = -Math.PI / 2 + 0.16;
    right.rotation.z = -0.06;
    right.position.set(0.2, 0.86, 0);
    left.userData.open = { rz: 0.06, y: 0.86 };
    right.userData.open = { rz: -0.06, y: 0.86 };
    desk.add(left, right);
    this._kitabLeft = left;
    this._kitabRight = right;

    // Small oil lamp glow on the desk
    const lampGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd27a })
    );
    lampGlow.position.set(0.85, 0.92, -0.25);
    desk.add(lampGlow);

    desk.position.set(4.8, 0, 2.5);
    desk.rotation.y = -0.5; // angled against the right wall, clear of the aisle
    this.group.add(desk);
  }

  async _buildPoster(woodDark) {
    const W = 3.4;
    const H = 1.9;
    let tex = null;
    try {
      tex = await this.assetLoader.loadSVGTexture(`${BASE_URL}svg/location_library_exit.svg`, 512, 288);
    } catch (err) {
      console.warn('[library] poster texture failed:', err);
    }
    const frame = new THREE.Group();
    const border = new THREE.Mesh(new THREE.BoxGeometry(W + 0.24, H + 0.24, 0.08), woodDark);
    frame.add(border);
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      tex
        ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })
        : new THREE.MeshStandardMaterial({ color: 0x2e5a8a, roughness: 0.85 })
    );
    art.position.z = 0.05;
    frame.add(art);
    frame.position.set(-4.6, 3.1, -6.1);
    frame.rotation.y = 0.0;
    this.group.add(frame);
  }

  _buildDoorway() {
    const door = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a3120, roughness: 0.85 });
    const post = new THREE.BoxGeometry(0.35, 3.6, 0.5);
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(post, frameMat);
      p.position.set(sx * 1.5, 1.8, 0);
      door.add(p);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.35, 0.35, 0.5), frameMat);
    lintel.position.set(0, 3.6, 0);
    door.add(lintel);
    // Arch
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.18, 10, 24, Math.PI), frameMat);
    arch.position.set(0, 3.6, 0);
    door.add(arch);

    // Glowing light beyond the doorway (the chase target)
    this._doorGlowMat = new THREE.MeshBasicMaterial({ color: 0xffe9b8, transparent: true, opacity: 0.95 });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 3.5), this._doorGlowMat);
    glow.position.set(0, 1.75, -0.3);
    door.add(glow);
    const halo = new THREE.PointLight(0xffe2a0, 40, 18, 1.7);
    halo.position.set(0, 2, 1);
    door.add(halo);

    door.position.set(0, 0, -26);
    this._door = door;
    this.aisle.add(door);
  }

  _buildShaytan() {
    // Cinematic apparition: a group of independently animated smoke columns,
    // two separate glowing eyes, wobbling tendrils and a ground shadow blob —
    // deliberately NOT one scaled mesh.
    const g = new THREE.Group();
    g.visible = false;

    // 4 tall smoke columns (sprites) with independent drift/opacity
    this._columns = [];
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this._smokeTex,
        color: 0x23232e,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.userData = {
        phase: i * 1.7,
        rise: 0.5 + i * 0.12,
        sway: 0.5 + (i % 3) * 0.35,
        x0: (i - 1.5) * 0.42,
        age: (i / 4) * 2.4, // stagger the columns
        life: 2.6,
        maxOp: 0.5 + (i % 2) * 0.12,
      };
      g.add(s);
      this._columns.push(s);
    }

    // Two dim red-orange eyes — separate meshes, subtle pulse
    const eyeGeo = new THREE.SphereGeometry(0.075, 10, 10);
    this._eyes = [];
    for (const sx of [-1, 1]) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff3a10, transparent: true, opacity: 0 });
      const eye = new THREE.Mesh(eyeGeo, mat);
      eye.position.set(sx * 0.34, 0.45, 0.28);
      eye.visible = false;
      g.add(eye);
      this._eyes.push(eye);
    }

    // 3 tendrils: dark plane strips with vertex wobble
    this._tendrils = [];
    const tendMat = new THREE.MeshBasicMaterial({
      color: 0x1b1b25,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (let i = 0; i < 3; i++) {
      const geo = tendrilGeometry(0.26, 2.1, 12);
      const m = new THREE.Mesh(geo, tendMat.clone());
      m.position.set((i - 1) * 0.55, 0.1, -0.15 - i * 0.08);
      m.rotation.z = (i - 1) * 0.28;
      m.userData = { phase: i * 2.1, freq: 2.6 + i * 0.5 };
      m.visible = false;
      g.add(m);
      this._tendrils.push(m);
    }

    // Ground shadow blob spreading under the apparition
    const blobMat = new THREE.MeshBasicMaterial({
      map: this._darkTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this._blob = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), blobMat);
    this._blob.rotation.x = -Math.PI / 2;
    this._blob.position.y = 0.02;
    g.add(this._blob);

    g.position.set(0, 0, -3.4); // behind the reading hero (at z ≈ -1.6)
    this._shGroup = g;
    this.group.add(g);

    // Drifting shadows sliding between the shelf rows (unease, pre-reveal)
    this._driftShadows = [];
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this._darkTex,
      color: 0x0a0a10,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.7), shadowMat.clone());
      m.position.set(sx * 2.55, 1.5, sx > 0 ? -5.5 : 1.5);
      m.userData = { speed: sx > 0 ? 1.4 : -1.1, zMin: -6.5, zMax: 2.5 };
      m.visible = false;
      this.group.add(m);
      this._driftShadows.push(m);
    }
  }

  _buildDust() {
    const N = 130;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 12;
      pos[i * 3 + 1] = Math.random() * 5.5 + 0.3;
      pos[i * 3 + 2] = -Math.random() * 18 + 2;
    }
    this._dustPos = pos;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: this._smokeTex,
      size: 0.12,
      transparent: true,
      opacity: 0.35,
      color: 0xffe2a8,
      depthWrite: false,
    });
    this._dust = new THREE.Points(geo, mat);
    this.group.add(this._dust);
  }

  // Short-lived smoke burst; positions parametrised so chase/scary moments
  // can puff smoke anywhere. Fixed pool, no per-frame allocation.
  _spawnSmoke(n, cx = 0, cy = 1.4, cz = -3.4) {
    if (this.reducedMotion) return;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this._smokeTex,
        color: 0x2a2a34,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      const a = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.random() * 1.4;
      s.position.set(cx + Math.cos(a) * r, cy + Math.random() * 1.4, cz + (Math.random() - 0.5) * 1.2);
      const sc = 0.5 + Math.random() * 0.9;
      s.scale.set(sc, sc, 1);
      s.userData = {
        vx: (Math.random() - 0.5) * 0.5,
        vy: 0.35 + Math.random() * 0.5,
        vz: (Math.random() - 0.5) * 0.4,
        life: 2.2 + Math.random() * 1.2,
        age: 0,
        isBurst: true,
      };
      this._smoke.push(s);
      this.group.add(s);
    }
  }

  _dimLights(dim) {
    this._lightTarget = dim ? { warm: 6, amb: 0.09 } : { warm: 60, amb: 0.5 };
    this._flicker = dim && !this.reducedMotion;
  }

  // Rebuild the intro tableau (e.g. quit-to-title after a run).
  // Re-attaches the library group if the chase removed it.
  resetToIntro() {
    if (!this.group.parent) this.scene.add(this.group);
    this.aisle.position.set(0, 0, 0);
    if (this._door) this._door.position.z = -26;
    this._chasing = false;
    this._chaseShaytan = false;
    this._chaseTCh = 0;
    this._dissolvePuffed = false;
    this._chasePuffed = false;
    this._sfxFired = null;
    this._chaseCleaned = false;
    this._scare = false;
    this._scareT = 0;
    this._kitabClose = -1;
    this._resetKitabPages();
    this._resetShaytanGroup();
    for (const m of this._driftShadows) {
      m.visible = false;
      m.material.opacity = 0;
    }
    for (const s of this._smoke) {
      this.group.remove(s);
      s.material.dispose();
    }
    this._smoke.length = 0;
    if (this._fadeMesh) {
      this.scene.remove(this._fadeMesh);
      this._fadeMesh.material.dispose();
      this._fadeMesh.geometry.dispose();
      this._fadeMesh = null;
    }
    this._timers.length = 0;
    this._dimLights(false);
    if (this._warmLight) this._warmLight.intensity = this._lightTarget.warm;
    if (this._ambient) this._ambient.intensity = this._lightTarget.amb;
    // Reset for the cinematic opening (aisle, not desk)
    this.avatar.group.position.set(0, 0, 3.5);
    this.avatar.group.rotation.set(0, 0, 0);
    this.avatar.setAnim('idle');
    // Reset sun (courtyard brightens during exit)
    if (this._sunLight) this._sunLight.intensity = 0.4;
    // Hide cinematic Shaytan if it was created
    if (this._cinShaytan) this._cinShaytan.visible = false;
  }

  _resetShaytanGroup() {
    if (!this._shGroup) return;
    this._shGroup.visible = false;
    this._shGroup.position.set(0, 0, -3.4);
    this._shGroup.scale.set(1, 1, 1);
    for (const c of this._columns) {
      c.material.opacity = 0;
      c.userData.age = 0;
    }
    for (const e of this._eyes) {
      e.visible = false;
      e.material.opacity = 0;
    }
    for (const t of this._tendrils) {
      t.visible = false;
      const pos = t.geometry.attributes.position;
      pos.array.set(t.geometry.userData.base);
      pos.needsUpdate = true;
    }
    if (this._blob) {
      this._blob.material.opacity = 0;
      this._blob.scale.set(0.3, 0.3, 1);
    }
  }

  _resetKitabPages() {
    for (const pg of [this._kitabLeft, this._kitabRight]) {
      if (!pg) continue;
      pg.rotation.x = -Math.PI / 2 + 0.16;
      pg.rotation.z = pg.userData.open.rz;
      pg.position.y = pg.userData.open.y;
    }
  }

  // --- scripted timeline --------------------------------------------------------

  // Sets up the intro tableau and returns immediately; Game waits for a tap.
  async playIntro() {
    this.avatar.group.position.set(0, 0, -0.35);
    this.avatar.setAnim('reading');
    // A quiet page turn while the player lingers on the intro screen.
    this._after(2.0, () => {
      if (!this._scare) this._sfx('library_page_turn');
    });
    return Promise.resolve();
  }

  // ~4.2s cinematic scare. Resolves when the hero is standing and the
  // apparition has dissolved back into smoke.
  async playShaytan() {
    this._scare = true;
    this._scareT = 0;
    this._kitabClose = -1;
    this._dissolvePuffed = false;
    this._shGroup.visible = true;
    this._shGroup.position.set(0, 0, -3.4);
    for (const m of this._driftShadows) m.visible = !this.reducedMotion;

    // 0.0–0.9: peaceful warm reading — the hero doesn't notice anything yet.
    await this._wait(0.5);
    this._sfx('library_page_turn');

    // 0.9: the room turns — lights dim with a subtle flicker, ambience ducks.
    await this._wait(0.4);
    this._dimLights(true);
    this.events.emit('audioDuck', { level: 0.25 });
    this._sfx('shaytan_distant_roar');

    // 1.9: eyes are in, the silhouette grows — the reveal roar.
    await this._wait(1.0);
    this._sfx('shaytan_reveal_roar');
    this.events.emit('shake', 0.3);

    // 2.5: the hero pauses and turns his head toward the threat.
    await this._wait(0.6);
    this.avatar.setAnim('react');

    // 3.0: LUNGE — the apparition rushes the desk.
    await this._wait(0.5);
    this.events.emit('shake', 0.65);

    // 3.3: the hero closes the kitab (handled respectfully), places it down,
    // and stands.
    await this._wait(0.3);
    this._sfx('library_page_turn');
    this._kitabClose = 0;
    await this._wait(0.1);
    this.avatar.setAnim('standup');

    // 3.9: the apparition dissolves into smoke; the room breathes again.
    await this._wait(0.5);
    this._dimLights(false);
    this._scare = false;
  }

  // ~5s chase down the aisle toward the glowing doorway, then a fade to black.
  // The Shaytan visibly chases behind the hero through the shelves before
  // dissolving into smoke (fade, no pop). The library group is removed before
  // resolving so RUNNER starts clean.
  async playChase() {
    this.avatar.group.position.set(0, 0, 0.4);
    this.avatar.setAnim('run');
    this._chasing = true;
    this._chaseT = 0;
    this._chaseCleaned = false;

    // The apparition re-forms behind the hero in the aisle.
    this._chaseShaytan = true;
    this._chaseTCh = 0;
    this._chasePuffed = false;
    this._sfxFired = null;
    this._shGroup.visible = true;
    this._shGroup.position.set(0, 0, 3.0);
    this._shGroup.scale.set(0.85, 0.85, 1);
    for (const c of this._columns) c.material.opacity = 0.42;
    for (const e of this._eyes) { e.visible = true; e.material.opacity = 0.9; }
    for (const t of this._tendrils) { t.visible = !this.reducedMotion; t.rotation.x = -0.5; }
    if (this._blob) { this._blob.material.opacity = 0.55; this._blob.scale.set(1.6, 1.6, 1); }
    this._sfx('shaytan_chase_breath');

    // Fade plane parked in front of the camera
    this._fadeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false })
    );
    this._fadeMesh.renderOrder = 999;
    this._fadeMesh.visible = false;
    this.scene.add(this._fadeMesh);

    await this._wait(5.0);
    this._chasing = false;
    this._chaseShaytan = false;
  }

  // Cinematic library opening (Oct 14, 2026 rebuild).
  // 8-state sequence: INTRO → SEARCH → REVEAL → RECITATION → ESCAPE → EXIT → GATE → done.
  // Uses the real 3D Shaytan GLB (reaper), the supplied recitation audio, and
  // procedural suspense. onState(s) notifies Game.js of state changes.
  // NOTE: Uses wall-clock time (performance.now), not the RAF-driven _elapsed,
  // so the cinematic pacing is consistent even if the frame rate dips.

  // --- per-frame ----------------------------------------------------------------

  update(dt) {
    this._elapsed += dt;

    // Timers
    for (const t of this._timers) {
      if (!t.done && this._elapsed >= t.at) {
        t.done = true;
        try {
          t.fn();
        } catch (err) {
          console.error('[library] timer failed:', err);
        }
      }
    }
    if (this._timers.length > 64) this._timers = this._timers.filter((t) => !t.done);

    // Light easing toward target + warm flicker (stronger during the scare).
    // The flicker troughs are clamped at 0: negative intensities would just
    // read as "off", and the clamp keeps the strobe from overshooting under
    // tone mapping.
    if (this._warmLight) {
      const k = 1 - Math.exp(-3 * dt);
      this._warmLight.intensity += (this._lightTarget.warm - this._warmLight.intensity) * k;
      if (!this.reducedMotion) {
        const fl = this._flicker ? 3.4 : 1;
        this._warmLight.intensity +=
          (Math.sin(this._elapsed * 13.7) * 0.9 + Math.sin(this._elapsed * 7.3) * 0.6) * fl;
        if (this._flicker && Math.random() < 0.03) this._warmLight.intensity *= 0.55;
        if (this._warmLight.intensity < 0) this._warmLight.intensity = 0;
      }
    }
    if (this._ambient) {
      const k = 1 - Math.exp(-3 * dt);
      this._ambient.intensity += (this._lightTarget.amb - this._ambient.intensity) * k;
    }

    // Dust drift
    if (this._dust && this._dustPos) {
      const p = this._dustPos;
      for (let i = 0; i < p.length; i += 3) {
        p[i + 1] -= dt * 0.12;
        p[i] += Math.sin(this._elapsed * 0.7 + i) * dt * 0.05;
        if (p[i + 1] < 0.2) p[i + 1] = 5.6;
      }
      this._dust.geometry.attributes.position.needsUpdate = true;
    }

    // Kitab closing beat (hero closes the book before standing)
    if (this._kitabClose >= 0 && this._kitabClose < 1) {
      this._kitabClose = Math.min(1, this._kitabClose + dt / 0.5);
      const k = easeIn(this._kitabClose);
      if (this._kitabLeft && this._kitabRight) {
        this._kitabLeft.rotation.z = 0.06 + k * 1.25;
        this._kitabRight.rotation.z = -0.06 - k * 1.25;
        this._kitabLeft.position.y = 0.86 + k * 0.1;
        this._kitabRight.position.y = 0.86 + k * 0.1;
      }
    }

    // Shaytan scare choreography
    if (this._scare) this._updateScare(dt);
    if (this._chaseShaytan) this._updateChaseShaytan(dt);

    // Smoke bursts
    for (let i = this._smoke.length - 1; i >= 0; i--) {
      const s = this._smoke[i];
      s.userData.age += dt;
      const u = s.userData;
      s.position.x += u.vx * dt;
      s.position.y += u.vy * dt;
      s.position.z += u.vz * dt;
      const lifeK = u.age / u.life;
      s.material.opacity = 0.5 * (1 - lifeK);
      s.scale.set(s.scale.x * (1 + dt * 0.4), s.scale.y * (1 + dt * 0.4), 1);
      if (u.age >= u.life) {
        this.group.remove(s);
        s.material.dispose();
        this._smoke.splice(i, 1);
      }
    }

    // Chase scroll
    if (this._chasing) {
      this._chaseT += dt;
      const t = this._chaseT;
      const scroll = 9 * t;
      this.aisle.position.z = scroll;
      if (this._door) {
        this._door.position.z = Math.min(-1.4, -26 + 9 * t);
        if (this._doorGlowMat) this._doorGlowMat.opacity = 0.85 + Math.sin(t * 6) * 0.15;
      }
      // Hero runs in place with a slight bob handled by the avatar anim.
      // Fade in → remove library → fade out.
      if (this._fadeMesh) {
        this._fadeMesh.visible = true;
        let op = 0;
        if (t > 3.5 && t <= 4.1) op = (t - 3.5) / 0.6;
        else if (t > 4.1 && t <= 4.9) op = 1 - (t - 4.1) / 0.8;
        this._fadeMesh.material.opacity = Math.max(0, Math.min(1, op));
        // Keep the fade plane glued in front of the camera
        if (this._camera) {
          this._fadeMesh.position.copy(this._camera.position);
          this._fadeMesh.quaternion.copy(this._camera.quaternion);
          this._fadeMesh.translateZ(-0.6);
        }
        if (t >= 3.5 && !this._chaseCleaned) {
          // Escape beat: the doorway light swallows the screen.
          this._sfxOnce('library_escape_whoosh');
          this.events.emit('audioDuck', { level: 1 }); // restore room ambience
        }
        if (t >= 4.1 && !this._chaseCleaned) {
          this._chaseCleaned = true;
          this.scene.remove(this.group);
        }
        if (t >= 4.9) {
          this.scene.remove(this._fadeMesh);
          this._fadeMesh.material.dispose();
          this._fadeMesh.geometry.dispose();
          this._fadeMesh = null;
        }
      }
    }
  }

  _sfxOnce(name) {
    if (this._sfxFired === name) return;
    this._sfxFired = name;
    this._sfx(name);
  }

  // Scare choreography, driven by _scareT (seconds since playShaytan began).
  _updateScare(dt) {
    this._scareT += dt;
    const t = this._scareT;
    const g = this._shGroup;
    if (!g || !g.visible) return;

    const rm = this.reducedMotion;
    const fadeIn = clamp01((t - 0.9) / 0.7);        // group materialises
    const eyesIn = clamp01((t - 1.7) / 0.5);        // eyes fade in
    const grow = clamp01((t - 2.0) / 0.8);          // silhouette grows taller
    const lungeK = clamp01((t - 3.0) / 0.35);       // the lunge
    const dissolveK = clamp01((t - 3.55) / 0.4);    // dissolves into smoke

    // Column heights drift upward and recycle while the scare runs
    for (const c of this._columns) {
      const u = c.userData;
      u.age += dt;
      if (u.age >= u.life) {
        if (t < 3.5) u.age = 0; // keep gathering until the dissolve
        else { c.material.opacity = 0; continue; }
      }
      const ak = u.age / u.life;
      const rise = u.age * u.rise;
      c.position.set(
        u.x0 + Math.sin(t * u.sway + u.phase) * 0.35,
        0.4 + rise,
        Math.cos(t * 0.8 + u.phase) * 0.3
      );
      const tall = 1 + grow * 0.45;
      c.scale.set(1.1 - grow * 0.15, (2.2 + ak * 1.2) * tall, 1);
      const edgeFade = Math.sin(Math.PI * clamp01(ak)); // in-out over life
      c.material.opacity = fadeIn * u.maxOp * edgeFade * (1 - dissolveK) * (rm ? 0.5 : 1);
    }

    // Eyes: fade in, then pulse subtly
    for (const e of this._eyes) {
      if (eyesIn > 0) e.visible = true;
      const pulse = 0.8 + Math.sin(t * 7) * 0.2;
      e.material.opacity = eyesIn * pulse * (1 - dissolveK);
      e.position.y = 0.45 + grow * 0.35 + Math.sin(t * 2.1) * 0.03;
      const es = 1 + Math.sin(t * 7) * 0.08;
      e.scale.set(es, es, es);
    }

    // Tendrils: wobble via per-vertex sine offset
    for (const td of this._tendrils) {
      if (!rm) td.visible = fadeIn > 0.3 && dissolveK < 1;
      else td.visible = false;
      if (!td.visible) continue;
      td.material.opacity = 0.8 * fadeIn * (1 - dissolveK);
      const pos = td.geometry.attributes.position;
      const base = td.geometry.userData.base;
      const h = td.geometry.userData.h;
      const ph = td.userData.phase;
      const fq = td.userData.freq;
      for (let i = 0; i < pos.count; i++) {
        const y = base[i * 3 + 1];
        const k = y / h;
        pos.array[i * 3] = base[i * 3] + Math.sin(t * fq + ph + k * 4.2) * 0.24 * k;
      }
      pos.needsUpdate = true;
    }

    // Ground shadow blob spreads independently of the columns
    if (this._blob) {
      const spread = 0.3 + clamp01((t - 1.7) / 1.1) * 2.3;
      this._blob.scale.set(spread, spread, 1);
      this._blob.material.opacity = fadeIn * 0.7 * (1 - dissolveK);
    }

    // Shadows drift between the shelf rows, sliding past the hero
    if (!rm) {
      for (const m of this._driftShadows) {
        m.material.opacity = fadeIn * 0.32 * (1 - dissolveK);
        m.position.z += m.userData.speed * dt;
        if (m.position.z > m.userData.zMax) m.position.z = m.userData.zMin;
        if (m.position.z < m.userData.zMin) m.position.z = m.userData.zMax;
      }
    }

    // The lunge: the whole apparition rushes the desk/camera
    g.position.z = -3.4 + easeIn(lungeK) * 2.7;

    // Dissolve into smoke — no pop
    if (dissolveK > 0 && dissolveK < 1 && !this._dissolvePuffed) {
      this._dissolvePuffed = true;
      this._spawnSmoke(rm ? 4 : 12, g.position.x, 1.4, g.position.z);
    }
    if (dissolveK >= 1) {
      g.visible = false;
      this._dissolvePuffed = false;
    }
  }

  // The apparition chases behind the hero through the shelves, then
  // dissolves (fade, no pop) before the fade-to-black.
  _updateChaseShaytan(dt) {
    this._chaseTCh = (this._chaseTCh || 0) + dt;
    const t = this._chaseTCh;
    const g = this._shGroup;
    if (!g || !g.visible) return;

    const rm = this.reducedMotion;
    const approachK = clamp01(t / 2.4);                 // closes in behind the hero
    const dissolveK = clamp01((t - 2.6) / 0.8);         // dissolves into smoke

    g.position.z = 3.0 - approachK * 1.7;
    g.position.x = Math.sin(t * 2.2) * 0.55;
    g.position.y = 0.1 + Math.sin(t * 3.1) * 0.12;

    for (const c of this._columns) {
      const u = c.userData;
      u.age += dt;
      if (u.age >= u.life) u.age = 0;
      const ak = u.age / u.life;
      c.position.set(
        u.x0 + Math.sin(t * u.sway + u.phase) * 0.3,
        0.5 + u.age * u.rise,
        Math.cos(t * 0.9 + u.phase) * 0.25
      );
      c.scale.set(1.0, 2.4 + ak * 0.8, 1);
      c.material.opacity = 0.42 * Math.sin(Math.PI * clamp01(ak)) * (1 - dissolveK);
    }
    for (const e of this._eyes) {
      e.visible = dissolveK < 1;
      const pulse = 0.75 + Math.sin(t * 8) * 0.25;
      e.material.opacity = 0.9 * pulse * (1 - dissolveK);
      e.position.y = 0.5 + Math.sin(t * 3.1) * 0.05;
    }
    if (!rm) {
      for (const td of this._tendrils) {
        td.visible = dissolveK < 1;
        td.material.opacity = 0.8 * (1 - dissolveK);
        // reaching forward toward the fleeing hero
        td.rotation.x = -0.5 - approachK * 0.5;
        const pos = td.geometry.attributes.position;
        const base = td.geometry.userData.base;
        const h = td.geometry.userData.h;
        for (let i = 0; i < pos.count; i++) {
          const k = base[i * 3 + 1] / h;
          pos.array[i * 3] = base[i * 3] + Math.sin(t * 5 + td.userData.phase + k * 5.0) * 0.3 * k;
        }
        pos.needsUpdate = true;
      }
    }
    if (this._blob) {
      this._blob.scale.set(1.6, 1.6, 1);
      this._blob.material.opacity = 0.55 * (1 - dissolveK);
    }
    if (dissolveK > 0 && dissolveK < 1 && !this._chasePuffed) {
      this._chasePuffed = true;
      this._spawnSmoke(rm ? 4 : 10, g.position.x, 1.2, g.position.z);
    }
    if (dissolveK >= 1) {
      g.visible = false;
      this._chaseShaytan = false;
      this._chasePuffed = false;
      this._chaseTCh = 0;
    }
  }
}
