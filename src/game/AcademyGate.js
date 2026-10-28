// AcademyGate.js — grand entrance gate of Shamsul Huda Islamic Academy.
//
// Spans all 3 lanes at the very start of the runner (distance ~8-35 m), right
// after the library exit and before landmark 1. PURELY VISUAL: no collision
// volume is registered with the CollisionSystem, and the pillars stand at
// |x| = 5.6 — outside the road edge (road |x| <= 5.3, lanes at x = -2.4/0/2.4),
// so the player always passes cleanly between them.
//
// The main sign carries the OFFICIAL academy logo, loaded as a THREE texture
// from the LOCAL file `public/shia-logo.png` (site root, same pattern
// AssetLoader uses: `${import.meta.env.BASE_URL}shia-logo.png`). Never
// hotlinked, never rendered as text. If the file is missing, a canvas-drawn
// "SHAMSUL HUDA ISLAMIC ACADEMY" fallback sign is used.
//
// Reveal: as the player approaches, a warm light under the beam ramps up and
// the sign's emissive intensity rises (sunlight feel). On pass-through the
// gate emits 'academy_gate_reveal' on the event bus and calls
// audio.play('academy_gate_reveal') — a safe no-op until AudioManager wires
// that key (see PATCHES.md).

import * as THREE from 'three';
import { LAP } from './LandmarkManager.js';

const GATE_OFFSET = 22;      // lap meters of the gate centre line (within the 8–35 m window)
const REVEAL_RANGE = 38;     // brighten-up window (m) as the player approaches
const LOGO_FILE = 'shia-logo.png';
const FALLBACK_TITLE = 'SHAMSUL HUDA ISLAMIC ACADEMY';

const PILLAR_X = 5.6;        // |x| of the two pillars (outside the road edge)
const STONE = 0xe6dfcd;
const STONE_DARK = 0xcfc4ab;
const GREEN = 0x1f6f43;
const GOLD = 0xd9a441;
const LAMP_WARM = 0xffc37a;
const _WARM_COL = new THREE.Color(LAMP_WARM);
const _COOL_COL = new THREE.Color(0x9fc0e8); // moonlit afterglow when far

export class AcademyGate {
  constructor(scene, assetLoader, opts = {}) {
    this.scene = scene;
    this.assetLoader = assetLoader;
    this.events = opts.events || { on() {}, emit() {} };
    this.audio = opts.audio || { play() {} };
    this._offset = GATE_OFFSET;
    this._revealed = false;
    this._checkpointFlash = 0;
    this._lampMats = [];
    this._disposables = [];
    this._build();
    this._loadLogo();
    // Flagged non-colliding: visual only, never registered as an obstacle.
    this.group.userData.nonColliding = true;
    this.scene.add(this.group);
    this.reset();
  }

  // ---------- construction ----------

  _geo(geo) { this._disposables.push(geo); return geo; }
  _mat(mat) { this._disposables.push(mat); return mat; }

  _box(w, h, d, color, opts = {}) {
    const m = new THREE.Mesh(
      this._geo(new THREE.BoxGeometry(w, h, d)),
      this._mat(new THREE.MeshLambertMaterial({ color, ...opts }))
    );
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  _build() {
    const g = new THREE.Group();

    // Two pillars with stone bases, green caps and gold orbs.
    for (const sx of [-1, 1]) {
      const px = sx * PILLAR_X;
      const base = this._box(1.9, 0.7, 1.9, STONE_DARK); base.position.set(px, 0.35, 0); g.add(base);
      const shaft = this._box(1.35, 5.0, 1.35, STONE); shaft.position.set(px, 3.2, 0); g.add(shaft);
      // recessed panel detail on the road-facing side
      const panel = this._box(0.1, 3.4, 0.9, STONE_DARK); panel.position.set(px - sx * 0.68, 3.1, 0); g.add(panel);
      const cap = this._box(1.7, 0.4, 1.7, GREEN); cap.position.set(px, 5.9, 0); g.add(cap);
      const orb = new THREE.Mesh(
        this._geo(new THREE.SphereGeometry(0.3, 14, 10)),
        this._mat(new THREE.MeshLambertMaterial({ color: GOLD }))
      );
      orb.position.set(px, 6.4, 0); orb.castShadow = true; g.add(orb);
      // warm lamp inset on the road-facing side (emissive; ramps on reveal)
      const lamp = this._box(0.16, 0.55, 0.34, 0x3a3a3a, { emissive: LAMP_WARM, emissiveIntensity: 0.4 });
      lamp.position.set(px - sx * 0.72, 4.55, 0); g.add(lamp);
      this._lampMats.push(lamp.material);
    }

    // Beam spanning all 3 lanes + stepped parapet with centre crest.
    const beam = this._box(12.7, 1.4, 1.15, STONE); beam.position.set(0, 6.9, 0); g.add(beam);
    const trim = this._box(12.9, 0.28, 1.25, GREEN); trim.position.set(0, 6.28, 0); g.add(trim);
    const parapet = this._box(12.7, 0.55, 0.85, STONE); parapet.position.set(0, 7.85, 0); g.add(parapet);
    const crest = this._box(2.6, 0.7, 1.0, STONE); crest.position.set(0, 8.4, 0); g.add(crest);
    const finial = new THREE.Mesh(
      this._geo(new THREE.SphereGeometry(0.24, 12, 8)),
      this._mat(new THREE.MeshLambertMaterial({ color: GOLD }))
    );
    finial.position.set(0, 8.95, 0); g.add(finial);

    // Boundary wall stubs running outward from each pillar.
    for (const sx of [-1, 1]) {
      const wx = sx * (PILLAR_X + 0.675 + 2.1);
      const wall = this._box(4.2, 1.5, 0.45, STONE); wall.position.set(wx, 0.75, 0); g.add(wall);
      const coping = this._box(4.4, 0.22, 0.6, GREEN); coping.position.set(wx, 1.6, 0); g.add(coping);
    }

    // Main sign plate (green frame) + face carrying the logo (or fallback text).
    const plate = this._box(7.0, 2.4, 0.28, GREEN); plate.position.set(0, 6.9, 0.72); g.add(plate);
    this._signMat = this._mat(new THREE.MeshLambertMaterial({
      map: this._fallbackTexture(),
      emissive: 0xfff2d8,
      emissiveMap: null, // set to the logo (or fallback) texture on load
      emissiveIntensity: 0.25,
    }));
    const face = new THREE.Mesh(this._geo(new THREE.PlaneGeometry(6.6, 2.2)), this._signMat);
    face.position.set(0, 6.9, 0.87); // faces +z, toward the approaching player
    g.add(face);

    // Warm light under the beam — ramps up as the player approaches.
    this._light = new THREE.PointLight(LAMP_WARM, 0.9, 26, 1.8);
    this._light.position.set(0, 5.6, 1.8);
    g.add(this._light);

    this.group = g;
  }

  _fallbackTexture() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 342;
    const x = c.getContext('2d');
    x.fillStyle = '#14532d';
    x.fillRect(0, 0, 1024, 342);
    x.strokeStyle = '#d9a441';
    x.lineWidth = 10;
    x.strokeRect(14, 14, 996, 314);
    x.fillStyle = '#ffffff';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    let px = 84;
    x.font = `bold ${px}px Georgia, serif`;
    while (x.measureText(FALLBACK_TITLE).width > 920 && px > 28) {
      px -= 4;
      x.font = `bold ${px}px Georgia, serif`;
    }
    x.fillText(FALLBACK_TITLE, 512, 171);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this._fallbackTex = tex;
    return tex;
  }

  _loadLogo() {
    // Local file only: public/shia-logo.png → served at the site root.
    const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
    const base = env.BASE_URL || './';
    const url = /^(https?:|blob:|data:|\/)/.test(LOGO_FILE) ? LOGO_FILE : `${base}${LOGO_FILE}`;
    new THREE.TextureLoader().loadAsync(url).then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this._logoTex = tex;
      this._signMat.map = tex;
      this._signMat.emissiveMap = tex;
      this._signMat.needsUpdate = true;
    }).catch(() => {
      // Keep the canvas-drawn fallback; make it glow evenly like the logo.
      this._signMat.emissiveMap = this._fallbackTex;
      this._signMat.needsUpdate = true;
    });
  }

  // ---------- per-frame ----------

  _positionAt(distanceM) {
    const lapD = ((distanceM % LAP) + LAP) % LAP;
    const rel = (((this._offset - lapD) % LAP) + LAP) % LAP;
    this.group.position.z = -rel + 10;
    return rel;
  }

  // Snap the gate to where it should be for the given player distance
  // (no reveal side effects — used for initial placement / reset).
  placeAt(distanceM) {
    this._positionAt(distanceM);
    this._revealed = false;
    return this;
  }

  // Align this same non-colliding academy arch with a kilometer checkpoint.
  setCheckpoint(distanceM) {
    this._offset = ((distanceM % LAP) + LAP) % LAP;
    this._revealed = false;
    return this;
  }

  flashCheckpoint() {
    this._checkpointFlash = 0.85;
  }

  update(dt, distanceM) {
    this._checkpointFlash = Math.max(0, this._checkpointFlash - dt);
    const rel = this._positionAt(distanceM);
    // Sunlight feel: brighten as the player closes in. Intensity eases
    // toward its target (no snap when the gate wraps behind the player),
    // and the hue shifts warm → cool moonlit once the gate is far away.
    const t = THREE.MathUtils.clamp(1 - rel / REVEAL_RANGE, 0, 1);
    const flash = this._checkpointFlash > 0 ? Math.sin((this._checkpointFlash / 0.85) * Math.PI) : 0;
    const targetI = 0.9 + 2.8 * t + flash * 5;
    this._light.intensity += (targetI - this._light.intensity) * Math.min(1, dt * 3.5);
    const farK = THREE.MathUtils.clamp((rel - REVEAL_RANGE) / 24, 0, 1);
    this._light.color.lerpColors(_WARM_COL, _COOL_COL, farK * farK);
    if (flash > 0) this._light.color.lerp(new THREE.Color(0xfff4c4), flash);
    this._signMat.emissiveIntensity = 0.25 + 1.0 * t + flash * 2.5;
    for (const m of this._lampMats) m.emissiveIntensity = 0.5 + 2.0 * t + flash * 4;
    if (rel < 3 && !this._revealed) {
      this._revealed = true;
      this.events.emit('academy_gate_reveal', { distanceM });
      this.audio.play('academy_gate_reveal'); // safe no-op until AudioManager wires the key
    }
    if (rel > REVEAL_RANGE + 10) this._revealed = false; // re-arm for the next lap
  }

  reset() {
    this._offset = GATE_OFFSET;
    this._checkpointFlash = 0;
    this.placeAt(0);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const d of this._disposables) {
      if (d && typeof d.dispose === 'function') d.dispose();
    }
    this._disposables.length = 0;
  }
}
