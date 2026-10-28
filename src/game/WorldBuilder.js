// WorldBuilder.js — treadmill road, sky, lights, pooled scenery.
// Forward = -Z; player at z=0; everything moves +Z at speed.
//
// Layout cross-section (|x|):
//   0..3.6    running lanes (kept clear — obstacles are ObstacleManager's job)
//   3.6..5.3  road shoulders        5.05 curb (+ cap trim)
//   5.1..7.9  sidewalk (lamps 5.9, pedestrians 6.9, benches/bins/signs 7.4)
//   7..21     landmark band (LandmarkManager buildings — scenery may overlap)
//   8..17     palms / trees / power poles (instanced, shared geometries)
//   22..26.5  generic shops / houses (clear of the landmark band)
//   27.5..32.5 background service roads (non-colliding traffic, heavily fogged)
//
// Materials are MeshStandardMaterial (PBR + ACES friendly): `std()` for flat
// colors, vertex-color Standard materials for merged props. MeshBasicMaterial
// is kept only for unlit plates (sign faces, sun, skyline silhouettes).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// GRAPHICS OVERHAUL: shared PBR material cache (one instance per color/params
// across the whole game — no duplicate materials).
import { std as sharedStd } from './Materials.js';

const WINDMILL_BLADE_NODES = /^Cube\.(?:008|009|010|011)$/;

function isWindmillBlade(object) {
  if (WINDMILL_BLADE_NODES.test(object.name)) return true;
  if (!object.geometry) return false;
  if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
  const size = object.geometry.boundingBox.getSize(new THREE.Vector3());
  // The GLB parser may expose the mesh-definition name instead of its node
  // name. The rotor blades are uniquely long along local X (about 31:2:1.5).
  return size.x > 5 && size.x > size.y * 8 && size.x > size.z * 8;
}

// The supplied GLB gives its four rotor blades a near-black red material and
// very narrow local Y dimensions. Keep the original shape, but widen and
// lighten the blades so they read as solid blades instead of crossed lines.
export function styleWindmillBlades(root) {
  root.traverse((object) => {
    if (!object.isMesh || !isWindmillBlade(object)) return;
    object.scale.y *= 3;
    const brighten = (material) => {
      const blade = material.clone();
      if (blade.color) blade.color.setHex(0xdde3e7);
      if (blade.metalness !== undefined) blade.metalness = 0.12;
      if (blade.roughness !== undefined) blade.roughness = 0.72;
      return blade;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(brighten)
      : brighten(object.material);
  });
}

// ---------- module-level geometry / material caches (shared, modest draw calls)
const _geo = new Map();
function boxGeo(w, h, d) {
  const k = `box:${w},${h},${d}`;
  if (!_geo.has(k)) _geo.set(k, new THREE.BoxGeometry(w, h, d));
  return _geo.get(k);
}
function planeGeo(w, h) {
  const k = `plane:${w},${h}`;
  if (!_geo.has(k)) _geo.set(k, new THREE.PlaneGeometry(w, h));
  return _geo.get(k);
}
function cylGeo(rt, rb, h, seg = 10) {
  const k = `cyl:${rt},${rb},${h},${seg}`;
  if (!_geo.has(k)) _geo.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
  return _geo.get(k);
}
function sphGeo(r, seg = 12) {
  const k = `sph:${r},${seg}`;
  if (!_geo.has(k)) _geo.set(k, new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4)));
  return _geo.get(k);
}
// Terracotta prism roof (triangular cross-section, extruded along Z).
function prismGeo(halfW, depth) {
  const k = `prism:${halfW},${depth}`;
  if (!_geo.has(k)) {
    const R = halfW / 0.866;
    const g = new THREE.CylinderGeometry(R, R, depth, 3, 1);
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI);
    g.scale(1, 0.24, 1);
    _geo.set(k, g);
  }
  return _geo.get(k);
}

const _mat = new Map();
// PBR workhorse: near-Lambertian response that stays correct under ACES.
// Delegates to the shared Materials.js cache (graphics overhaul) — same
// call signature and defaults, one instance per (color, params) game-wide.
function std(color, opts = {}) {
  return sharedStd(color, { roughness: 0.9, metalness: 0.0, ...opts });
}
function basic(color, opts = {}) {
  const k = `b:${color}:${JSON.stringify(opts)}`;
  if (!_mat.has(k)) _mat.set(k, new THREE.MeshBasicMaterial({ color, ...opts }));
  return _mat.get(k);
}

// ---------- merged-geometry props: one draw call per prop instance ----------
// Parts are { g: transformed geometry, c: hex color }. Geometries are merged
// with a per-vertex color attribute and rendered with a single shared
// vertex-color Standard material. Base geometries stay cached & untouched.
const _mergedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 });
const _mergedMatDS = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide });
const _mergedBasic = new THREE.MeshBasicMaterial({ vertexColors: true }); // skyline silhouettes

// Transformed clone of a cached base geometry.
function P(geo, c, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const g = geo.clone();
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
  g.applyMatrix4(m);
  return { g, c };
}
function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const col = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const _propGeo = new Map();
function propGeo(key, parts) {
  if (!_propGeo.has(key)) {
    _propGeo.set(key, mergeGeometries(parts.map((p) => paint(p.g, p.c)), false));
  }
  return _propGeo.get(key);
}
function propMesh(key, parts, { doubleSide = false, shadow = true } = {}) {
  const m = new THREE.Mesh(propGeo(key, parts), doubleSide ? _mergedMatDS : _mergedMat);
  m.castShadow = shadow;
  return m;
}

// ---------- canvas textures ----------
// Road surface tile: 10.6 m x 30 m. Crisp lane markings, asphalt grain and
// faint tire-wear bands are baked in, so one plane per segment carries the
// whole road (no stacked decal planes => no z-fighting). The dash cycle is
// exactly 3 m, dividing the 30 m tile evenly, so segments tile seamlessly.
let _roadTex = null;
function roadTexture() {
  if (_roadTex) return _roadTex;
  const W = 1024, H = 1024;
  const SX = W / 10.6, SY = H / 30; // px per metre
  const X = (m) => (m + 5.3) * SX;  // world x -> px
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#2e3238';
  g.fillRect(0, 0, W, H);
  // large soft tonal patches (patchy asphalt)
  for (let i = 0; i < 46; i++) {
    const r = 40 + Math.random() * 130;
    const x = Math.random() * W, y = Math.random() * H;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, Math.random() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.07)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  // faint tire-wear darkening: wheel tracks for each lane centre
  for (const lc of [-2.4, 0, 2.4]) {
    for (const off of [-0.48, 0.48]) {
      const cx = X(lc + off);
      g.fillStyle = 'rgba(8,8,10,0.10)';
      g.fillRect(cx - 0.42 * SX, 0, 0.84 * SX, H);
      g.fillStyle = 'rgba(8,8,10,0.16)';
      g.fillRect(cx - 0.28 * SX, 0, 0.56 * SX, H);
    }
  }
  // fine grain
  for (let i = 0; i < 5200; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
    g.fillRect(Math.random() * W, Math.random() * H, 1.6, 1.6);
  }
  // 3 dashed lane dividers at x = +/-1.2 (1.5 m dash / 1.5 m gap)
  g.fillStyle = 'rgba(244,246,248,0.92)';
  const dashW = 0.16 * SX, dashL = 1.5 * SY, gapL = 1.5 * SY;
  for (const lx of [-1.2, 1.2]) {
    const x0 = X(lx) - dashW / 2;
    for (let y = 0; y < H; y += dashL + gapL) g.fillRect(x0, y, dashW, dashL);
  }
  // solid edge lines at x = +/-4.7
  g.fillStyle = '#d9a441';
  for (const lx of [-4.7, 4.7]) g.fillRect(X(lx) - 0.09 * SX, 0, 0.18 * SX, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _roadTex = t;
  return t;
}

// Sidewalk tile: 2.8 m x 30 m paver grid with grime near the curb edge.
// mirror=true flips u so the grime sits on the curb side for the -X sidewalk.
const _walkTex = {};
function sidewalkTexture(mirror) {
  const k = mirror ? 'm' : 's';
  if (_walkTex[k]) return _walkTex[k];
  const W = 256, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#9aa0a6';
  g.fillRect(0, 0, W, H);
  const pw = W / 4, ph = H / 42.857; // 0.7 m pavers
  for (let ix = 0; ix < 4; ix++) {
    for (let iy = 0; iy < 43; iy++) {
      const v = (Math.random() - 0.5) * 14;
      g.fillStyle = `rgb(${154 + v | 0},${160 + v | 0},${166 + v | 0})`;
      g.fillRect(ix * pw + 1, iy * ph + 1, pw - 2, ph - 2);
    }
  }
  const gr = g.createLinearGradient(0, 0, W * 0.22, 0);
  gr.addColorStop(0, 'rgba(40,42,44,0.35)');
  gr.addColorStop(1, 'rgba(40,42,44,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W * 0.22, H);
  const t = new THREE.CanvasTexture(c);
  if (mirror) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; }
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _walkTex[k] = t;
  return t;
}

const _roadMat = { m: null };
function roadMaterial() {
  if (!_roadMat.m) _roadMat.m = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.96, metalness: 0.0 });
  return _roadMat.m;
}
const _walkMats = {};
function sidewalkMaterial(mirror) {
  const k = mirror ? 'm' : 's';
  if (!_walkMats[k]) _walkMats[k] = new THREE.MeshStandardMaterial({ map: sidewalkTexture(mirror), roughness: 0.95, metalness: 0.0 });
  return _walkMats[k];
}

let _cloudTex = null;
function cloudTexture() {
  if (_cloudTex) return _cloudTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const blob = (x, y, r) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  };
  blob(80, 70, 55); blob(130, 60, 65); blob(180, 72, 50); blob(110, 82, 48);
  _cloudTex = new THREE.CanvasTexture(c);
  _cloudTex.colorSpace = THREE.SRGBColorSpace;
  return _cloudTex;
}

// Sun glow: PURE WHITE rgb everywhere, alpha-only falloff. Even if a driver or
// future edit ever composited this with normal blending, there is no dark RGB
// at alpha 0 to smear — and it is rendered additively anyway (see _buildSky).
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0.0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.42)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}

// Opaque text plate (shop signs, directional signs). Cached by text.
const _plateTex = new Map();
function textPlate(text, bg = '#1d4ed8', fg = '#ffffff') {
  const k = `${text}|${bg}|${fg}`;
  if (!_plateTex.has(k)) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 160);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 6;
    g.strokeRect(8, 8, 496, 144);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let px = 72;
    g.font = `bold ${px}px Arial, sans-serif`;
    while (g.measureText(text).width > 470 && px > 24) {
      px -= 4;
      g.font = `bold ${px}px Arial, sans-serif`;
    }
    g.fillText(text, 256, 84);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    _plateTex.set(k, t);
  }
  return _plateTex.get(k);
}
function signFace(w, h, text, bg, fg) {
  return new THREE.Mesh(
    planeGeo(w, h),
    new THREE.MeshBasicMaterial({ map: textPlate(text, bg, fg) })
  );
}

// Turn arrow decal for the main road (white on transparent, alpha-tested so no
// blending fringe). mirror=true curves left instead of right.
const _arrowTex = {};
function arrowTexture(mirror) {
  const k = mirror ? 'L' : 'R';
  if (_arrowTex[k]) return _arrowTex[k];
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 256);
  if (mirror) { g.translate(128, 0); g.scale(-1, 1); }
  g.strokeStyle = '#f4f6f8';
  g.lineWidth = 17;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(64, 244);
  g.lineTo(64, 120);
  g.quadraticCurveTo(64, 70, 104, 52); // curve toward the junction side
  g.stroke();
  // arrowhead
  g.fillStyle = '#f4f6f8';
  g.beginPath();
  g.moveTo(104, 26);
  g.lineTo(126, 62);
  g.lineTo(88, 74);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _arrowTex[k] = t;
  return t;
}

// Road word decal ('SLOW' etc.): white bold text on transparent, alpha-tested.
// Drawn horizontally; the mesh is spun in-plane so the word reads along -Z.
const _wordTex = {};
function roadWordTexture(word) {
  if (_wordTex[word]) return _wordTex[word];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(244,246,248,0.92)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let px = 64;
  g.font = `bold ${px}px Arial, sans-serif`;
  while (g.measureText(word).width > 230 && px > 20) {
    px -= 4;
    g.font = `bold ${px}px Arial, sans-serif`;
  }
  g.fillText(word, 128, 132);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _wordTex[word] = t;
  return t;
}
function roadWordDecal(word, w = 1.7) {
  const m = new THREE.Mesh(
    planeGeo(w, w),
    new THREE.MeshBasicMaterial({ map: roadWordTexture(word), transparent: true, alphaTest: 0.35,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.PI / 2; // spin in-plane: word runs along the road
  m.position.y = 0.02;
  return m;
}

const SEG_LEN = 30;
const SEG_COUNT = 6;          // 6 x 30 = 180 units: z from -150 to +30
const WRAP = SEG_LEN * SEG_COUNT; // 180
const FOG_COLOR = 0x87b5d6;   // must match scene.fog set in Game.js

// Scenic junctions. Player never leaves the main road: these are visual only.
// z values are fixed within the 180-unit treadmill wrap; the whole kit
// (apron, shops, signs, arrow) wraps as one group so offsets never drift.
const JUNCTIONS = [
  { z: -35, side: 1, kind: 'market' },
  { z: -80, side: -1, kind: 'campus' },
  { z: -125, side: 1, kind: 'residential' },
];

// ---------- instanced treadmill vegetation ----------
// One field = one set of items sharing transforms; each field owns 1+
// InstancedMeshes (e.g. palm trunks + crowns share the same item transforms).
// Per-frame work reuses module temps only — no allocation.
const _fm = new THREE.Matrix4();
const _fq = new THREE.Quaternion();
const _fe = new THREE.Euler();
const _fv = new THREE.Vector3();
const _fs = new THREE.Vector3();
class TreadmillField {
  constructor(items) {
    this.items = items;
    for (const it of items) it.z0 = it.z;
    this.meshes = [];
  }
  addMesh(geo, mat, shadow = true) {
    const m = new THREE.InstancedMesh(geo, mat, this.items.length);
    m.castShadow = shadow;
    m.frustumCulled = false; // instances span the whole wrap; cull manually
    this.meshes.push(m);
    return m;
  }
  addTo(scene) { for (const m of this.meshes) scene.add(m); }
  _write(i, t) {
    const it = this.items[i];
    _fe.set(0, it.yaw || 0, it.sway ? Math.sin(t * 1.25 + it.phase) * 0.035 : 0);
    _fq.setFromEuler(_fe);
    _fv.set(it.x, 0, it.z);
    const s = it.scale || 1;
    _fs.set(s, s, s);
    _fm.compose(_fv, _fq, _fs);
    for (const m of this.meshes) m.setMatrixAt(i, _fm);
  }
  update(dz, t) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      it.z += dz;
      if (it.z > 32) it.z -= WRAP;
      this._write(i, t);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
  reset() {
    for (let i = 0; i < this.items.length; i++) { this.items[i].z = this.items[i].z0; this._write(i, 0); }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
  setQuality(low) {
    const n = low ? Math.ceil(this.items.length / 2) : this.items.length;
    for (const m of this.meshes) m.count = n;
  }
}

// Palm crown fronds (baked pivot/tilt chain, double-sided).
function palmCrownParts() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = new THREE.Matrix4().makeTranslation(0, 5.4, 0);
    m.multiply(new THREE.Matrix4().makeRotationY(a));
    m.multiply(new THREE.Matrix4().makeRotationZ(-0.42));
    m.multiply(new THREE.Matrix4().makeTranslation(1.45, 0, 0));
    m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const f = planeGeo(3.0, 0.95).clone();
    f.applyMatrix4(m);
    parts.push({ g: f, c: 0x2e8b57 });
  }
  return parts;
}
const PALM_TRUNK_PARTS = [
  P(cylGeo(0.16, 0.28, 5.4, 7), 0x7a5230, 0, 2.7, 0),
  P(sphGeo(0.22, 8), 0x6b4a2a, 0, 5.15, 0), // coconut cluster
];
// Tree silhouette variants (no two identical silhouettes in a row: items are
// dealt round-robin over variants after sorting by z).
function treeGeoA() {
  return propGeo('treeA', [
    P(cylGeo(0.13, 0.2, 2.4, 8), 0x6e4a2f, 0, 1.2, 0),
    P(sphGeo(1.25, 10), 0x3f8f4f, 0, 2.9, 0),
    P(sphGeo(0.9, 9), 0x4da35c, 0.7, 2.3, 0.3),
  ]);
}
function treeGeoB() {
  return propGeo('treeB', [
    P(cylGeo(0.12, 0.18, 2.2, 8), 0x6e4a2f, 0, 1.1, 0),
    P(cylGeo(0.03, 1.25, 2.6, 8), 0x357a44, 0, 3.3, 0),
    P(cylGeo(0.03, 0.85, 1.7, 8), 0x3f8f4f, 0, 4.6, 0),
  ]);
}
function treeGeoC() {
  return propGeo('treeC', [
    P(cylGeo(0.14, 0.2, 2.8, 8), 0x6e4a2f, 0, 1.4, 0),
    P(sphGeo(1.5, 10), 0x4da35c, 0, 3.1, 0, 0, 0, 0, 1, 0.55, 1),
    P(sphGeo(0.8, 9), 0x3f8f4f, -0.9, 2.6, 0.4, 0, 0, 0, 1, 0.6, 1),
  ]);
}
function bushGeoA() {
  return propGeo('bushA', [P(sphGeo(0.7, 9), 0x4c9a52, 0, 0.35, 0, 0, 0, 0, 1, 0.62, 1)]);
}
function bushGeoB() {
  return propGeo('bushB', [
    P(sphGeo(0.55, 9), 0x57a55e, -0.3, 0.3, 0, 0, 0, 0, 1, 0.7, 1),
    P(sphGeo(0.5, 9), 0x478f4e, 0.32, 0.28, 0.1, 0, 0, 0, 1, 0.66, 1),
  ]);
}
function planterGeo() {
  return propGeo('planter', [
    P(boxGeo(0.7, 0.5, 0.7), 0xb9b2a4, 0, 0.25, 0),
    P(boxGeo(0.74, 0.08, 0.74), 0xcfc8b8, 0, 0.52, 0), // rim
    P(boxGeo(0.58, 0.08, 0.58), 0x4a3826, 0, 0.5, 0),  // soil
    P(sphGeo(0.45, 9), 0x4c9a52, 0, 0.85, 0, 0, 0, 0, 1, 0.8, 1),
  ]);
}

export class WorldBuilder {
  constructor(scene, events, assetLoader) {
    this.scene = scene;
    this.events = events || { on() {}, emit() {} };
    this.assetLoader = assetLoader;
    this.LAP = 900;
    this.quality = 'high';
    this._t = 0;

    this.scenery = []; // treadmill-recycled props (visible-halved on low quality)
    this.clouds = [];
    this.peds = [];    // background pedestrians (own walk motion)
    this.traffic = []; // background vehicles (own drive motion)
    this._fields = []; // instanced vegetation fields
    this._wires = null;
    this._home = [];   // {obj, x, z} initial transforms for reset()

    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildRoad();
    this._buildScenery();
    this._buildJunctions();
    this._buildTraffic();
  }

  // ----- sky, sun. Root-cause repair for the "dark halo around the sun":
  //   1. The glow sprite is now ADDITIVE — additive blending can only add
  //      light, so a dark ring is mathematically impossible no matter what
  //      the texture holds.
  //   2. The glow texture is pure-white RGB with an alpha-only falloff, so
  //      there is no dark RGB at alpha 0 to smear (the classic halo cause).
  //   3. The sun itself is an OPAQUE disc mesh (zero blending risk), with the
  //      additive sprite as halo around it.
  //   4. Sky-dome horizon color == fog color, so the dome melts into the
  //      fogged ground instead of leaving a bright seam.
  _buildSky() {
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x2b6cb8) },
        horizon: { value: new THREE.Color(FOG_COLOR) },
        // GRAPHICS OVERHAUL: below-horizon tinted toward the fog color (was a
        // flat gray 0x93a8b5) so the dome melts into the fully-fogged ground
        // at the horizon instead of leaving a gray band.
        below: { value: new THREE.Color(0x7ea6c8) },
      },
      vertexShader: `
        varying vec3 vP;
        void main() {
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vP;
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 below;
        void main() {
          float h = normalize(vP).y;
          vec3 c = h >= 0.0
            ? mix(horizon, top, pow(clamp(h * 1.6, 0.0, 1.0), 0.6))
            : mix(horizon, below, pow(clamp(-h * 4.0, 0.0, 1.0), 0.7));
          gl_FragColor = vec4(c, 1.0);
          // GRAPHICS OVERHAUL: custom ShaderMaterials skip tone mapping and
          // output-space conversion unless these chunks are included. Without
          // them the dome would render darker than the ACES-tonemapped
          // fogged ground and the horizon seam would reopen.
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(420, 24, 16), skyMat);
    dome.position.set(0, 0, -60);
    dome.frustumCulled = false;
    dome.renderOrder = -10;
    this.scene.add(dome);
    // NOTE: scene.fog is set by Game.js (0x87b5d6, 40 -> 160). This builder
    // must not set it: here `scene` is the runnerRoot Group in production
    // (a Group has no fog effect), and in tests a bare Scene.

    const sunPos = new THREE.Vector3(-90, 95, -300);
    // Opaque sun disc — no blending, no halo, always a clean circle.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(11, 32),
      new THREE.MeshBasicMaterial({ color: 0xfffdf4, fog: false })
    );
    disc.position.copy(sunPos);
    disc.lookAt(0, 4.2, 7.5);
    this.scene.add(disc);
    // Additive glow sprite around it.
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: 0xffe9a8,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })
    );
    glow.position.copy(sunPos).z -= 1;
    glow.scale.set(120, 120, 1);
    glow.renderOrder = 5;
    this.scene.add(glow);
  }

  // ----- lights
  // GRAPHICS OVERHAUL — daylight system, retuned for ACESFilmic tone mapping
  // (set in Game.js). ACES compresses midtones/highlights, so intensities run
  // ~1.5-2.5x their pre-tonemapping values; verified visually, not maxed.
  // One coherent sun: the key light shines FROM the sun sprite's direction
  // (sprite at (-90, 95, -300) in _buildSky), so cast shadows fall away from
  // the visible sun. Hemisphere = cool sky / warm ground fill for shadows.
  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x8a7a5f, 1.7);
    this.scene.add(hemi);
    this._hemiLight = hemi;

    const dir = new THREE.DirectionalLight(0xfff1d6, 3.2);
    dir.position.set(-26, 44, -48);
    dir.target.position.set(0, 0, -12);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    // Tight box around the play area the camera ever sees — not the whole
    // world — so shadow texels stay crisp. (medium tier drops to 1024.)
    dir.shadow.camera.left = -28;
    dir.shadow.camera.right = 28;
    dir.shadow.camera.top = 34;
    dir.shadow.camera.bottom = -34;
    dir.shadow.camera.near = 5;
    dir.shadow.camera.far = 150;
    dir.shadow.bias = -0.0002;
    dir.shadow.normalBias = 0.035; // kills acne on the big road/ground planes
    this.scene.add(dir);
    this.scene.add(dir.target);
    this._dirLight = dir;
  }

  // ----- ground: one big static plane so the world meets the horizon.
  // The camera barely travels (stays near z~7.5), so no treadmill needed.
  _buildGround() {
    const g = new THREE.Mesh(planeGeo(1200, 800), std(0x6f9a52));
    g.rotation.x = -Math.PI / 2;
    g.position.set(0, -0.05, -250);
    g.receiveShadow = true;
    this.scene.add(g);
  }

  // ----- road: recycled segments. Markings are baked into the asphalt
  // texture (one plane per segment) — crisp, continuous, zero z-fighting.
  _buildSegment() {
    const g = new THREE.Group();
    const road = new THREE.Mesh(planeGeo(10.6, SEG_LEN), roadMaterial());
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    g.add(road);
    // sidewalks with paver texture + curbs with cap trim
    for (const s of [-1, 1]) {
      const walk = new THREE.Mesh(planeGeo(2.8, SEG_LEN), sidewalkMaterial(s < 0));
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(s * 6.5, 0.1, 0);
      walk.receiveShadow = true;
      g.add(walk);
      const curb = new THREE.Mesh(boxGeo(0.3, 0.24, SEG_LEN), std(0x767c84));
      curb.position.set(s * 5.05, 0.12, 0);
      curb.castShadow = true;
      g.add(curb);
      const cap = new THREE.Mesh(boxGeo(0.38, 0.07, SEG_LEN), std(0xa8adb3));
      cap.position.set(s * 5.05, 0.275, 0);
      g.add(cap);
    }
    return g;
  }

  _buildRoad() {
    this.segments = [];
    // centers: -135, -105, -75, -45, -15, +15  -> covers z -150..+30
    for (let i = 0; i < SEG_COUNT; i++) {
      const seg = this._buildSegment();
      seg.position.z = -135 + i * SEG_LEN;
      this.scene.add(seg);
      this.segments.push(seg);
    }
  }

  // ----- scenery prop builders (each a single merged mesh => 1 draw call)
  _buildLamp() {
    const g = new THREE.Group();
    g.add(propMesh('lamp', [
      P(boxGeo(0.5, 0.25, 0.5), 0x3f4750, 0, 0.125, 0), // base flange, grounded
      P(cylGeo(0.09, 0.13, 6.2, 8), 0x4b5563, 0, 3.1, 0),
      P(boxGeo(1.4, 0.1, 0.1), 0x4b5563, -0.6, 6.1, 0),
      P(sphGeo(0.17, 10), 0xfff3bf, -1.25, 6.0, 0),
    ]));
    return g;
  }

  _buildPowerPole() {
    // Wire spans are a separate sagging-line object (see _buildWires); the
    // pole keeps its crossarm + insulator knobs only.
    return propMesh('powerPole', [
      P(cylGeo(0.09, 0.13, 8, 8), 0x5b4a38, 0, 4, 0),
      P(boxGeo(1.7, 0.12, 0.12), 0x5b4a38, 0, 7.3, 0),
      P(cylGeo(0.06, 0.06, 0.18, 6), 0x2b2b2b, -0.8, 7.42, 0),
      P(cylGeo(0.06, 0.06, 0.18, 6), 0x2b2b2b, 0.8, 7.42, 0),
    ]);
  }

  // Boundary wall with cap trim + end pillars (replaces the flat slabs).
  _buildWall(len = 4.2) {
    return propMesh(`wall:${len}`, [
      P(boxGeo(len, 0.85, 0.3), 0xbcb3a4, 0, 0.425, 0),
      P(boxGeo(len + 0.12, 0.14, 0.44), 0xd9d2c2, 0, 0.92, 0),
      P(boxGeo(0.42, 1.1, 0.42), 0xc4bcab, -len / 2, 0.55, 0),
      P(boxGeo(0.42, 1.1, 0.42), 0xc4bcab, len / 2, 0.55, 0),
      P(boxGeo(0.54, 0.12, 0.54), 0xd9d2c2, -len / 2, 1.16, 0),
      P(boxGeo(0.54, 0.12, 0.54), 0xd9d2c2, len / 2, 1.16, 0),
    ]);
  }

  _buildBench() {
    return propMesh('bench', [
      P(boxGeo(1.8, 0.09, 0.45), 0x9a6b3f, 0, 0.55, 0),
      P(boxGeo(1.8, 0.45, 0.09), 0x9a6b3f, 0, 0.9, -0.2),
      P(boxGeo(1.6, 0.5, 0.35), 0x8a8f96, 0, 0.25, 0),
    ]);
  }

  _buildBin() {
    return propMesh('bin', [
      P(cylGeo(0.32, 0.28, 0.85, 10), 0x2f6b3a, 0, 0.425, 0),
      P(cylGeo(0.34, 0.34, 0.1, 10), 0x24492c, 0, 0.9, 0),
    ]);
  }

  // Directional sign: merged pole+board, plus an opaque text face toward +Z.
  _buildDirSign(text, bg = '#1d4ed8') {
    const g = new THREE.Group();
    g.add(propMesh('dirSign', [
      P(cylGeo(0.07, 0.07, 2.8, 8), 0x6b7280, 0, 1.4, 0),
      P(boxGeo(1.7, 0.85, 0.08), 0x14306b, 0, 2.55, 0),
    ]));
    const face = signFace(1.6, 0.75, text, bg, '#ffffff');
    face.position.set(0, 2.55, 0.05);
    g.add(face);
    return g;
  }

  // Generic roadside shop with dimensional depth: plinth, cornice, parapet
  // slab, recessed door with frame, framed display windows. Front faces +Z
  // before rotation; rotate the group so the front faces the road.
  _buildShop(bodyColor, signText, signBg, awnColor) {
    const w = 6, h = 4.2, d = 5;
    const g = new THREE.Group();
    const trim = 0xece5d3;
    g.add(propMesh(`shop:${bodyColor}:${awnColor}`, [
      P(boxGeo(w, h, d), bodyColor, 0, h / 2, 0),
      P(boxGeo(w + 0.4, 0.55, d + 0.4), 0x8f8a7c, 0, 0.275, 0), // plinth
      P(boxGeo(w + 0.35, 0.3, d + 0.35), trim, 0, h - 0.15, 0), // cornice
      P(boxGeo(w + 0.4, 0.28, d + 0.4), 0x9a938a, 0, h + 0.14, 0), // parapet slab
      P(boxGeo(w * 0.92, 0.12, 1.3), awnColor, 0, 3.05, d / 2 + 0.55, -0.22, 0, 0),
      P(boxGeo(w * 0.95, 0.95, 0.14), 0x1c2128, 0, h - 0.62, d / 2 + 0.04), // sign band
      // recessed door: protruding frame, door plane set back inside it
      P(boxGeo(0.28, 2.5, 0.3), trim, -w / 4 - 0.75, 1.25, d / 2 + 0.12),
      P(boxGeo(0.28, 2.5, 0.3), trim, -w / 4 + 0.75, 1.25, d / 2 + 0.12),
      P(boxGeo(1.78, 0.3, 0.3), trim, -w / 4, 2.62, d / 2 + 0.12),
      P(boxGeo(1.1, 2.2, 0.1), 0x2a2118, -w / 4, 1.35, d / 2 + 0.02),
      P(boxGeo(1.5, 0.14, 0.5), 0x9aa0a8, -w / 4, 0.07, d / 2 + 0.35), // step
      // display windows with frames + sills
      P(boxGeo(0.14, 0.14, 2.0), trim, w / 4, 2.42, d / 2 + 0.05),
      P(boxGeo(0.14, 0.14, 2.0), trim, w / 4, 0.98, d / 2 + 0.05),
      P(boxGeo(0.14, 1.58, 0.14), trim, w / 4, 1.7, d / 2 - 0.88),
      P(boxGeo(0.14, 1.58, 0.14), trim, w / 4, 1.7, d / 2 + 0.98),
      P(boxGeo(1.7, 1.2, 0.12), 0xffe6a8, w / 4, 1.7, d / 2 + 0.02),
      P(boxGeo(0.34, 0.12, 2.1), trim, w / 4 + 0.1, 0.9, d / 2 + 0.05),
      P(boxGeo(1.2, 1.0, 0.12), 0xffe6a8, -w / 4, 3.1, d / 2 + 0.02),
    ]));
    const face = signFace(w * 0.88, 0.82, signText, signBg, '#ffffff');
    face.position.set(0, h - 0.62, d / 2 + 0.13);
    g.add(face);
    return g;
  }

  _buildHouse(bodyColor, roofColor) {
    const g = new THREE.Group();
    g.add(propMesh(`house:${bodyColor}:${roofColor}`, [
      P(boxGeo(6, 3.4, 5), bodyColor, 0, 1.7, 0),
      P(prismGeo(3.4, 5.6), roofColor, 0, 3.4 + 0.55, 0),
      P(boxGeo(1.0, 2.1, 0.12), 0x4a3320, 0, 1.05, 2.52),
      P(boxGeo(1.2, 1.0, 0.12), 0xffe6a8, -1.8, 1.9, 2.52),
      P(boxGeo(1.2, 1.0, 0.12), 0xffe6a8, 1.8, 1.9, 2.52),
    ]));
    return g;
  }

  _buildMotorcycle() {
    return propMesh('motorcycle', [
      P(boxGeo(0.35, 0.4, 1.7), 0x22303e, 0, 0.75, 0),
      P(boxGeo(0.32, 0.18, 0.9), 0x8a1f1f, 0, 1.0, -0.1),
      P(cylGeo(0.33, 0.33, 0.18, 10), 0x141414, 0, 0.33, 0.75, 0, 0, Math.PI / 2),
      P(cylGeo(0.14, 0.14, 0.2, 10), 0x9aa0a6, 0, 0.33, 0.75, 0, 0, Math.PI / 2),
      P(cylGeo(0.33, 0.33, 0.18, 10), 0x141414, 0, 0.33, -0.75, 0, 0, Math.PI / 2),
      P(cylGeo(0.14, 0.14, 0.2, 10), 0x9aa0a6, 0, 0.33, -0.75, 0, 0, Math.PI / 2),
      P(boxGeo(0.5, 0.08, 0.08), 0x9aa0a6, 0, 1.05, 0.8),
      P(boxGeo(0.2, 0.2, 0.1), 0xfff3bf, 0, 0.95, 0.88),
    ]);
  }

  _buildBicycle() {
    return propMesh('bicycle', [
      P(cylGeo(0.34, 0.34, 0.08, 10), 0x141414, 0, 0.34, 0.55, 0, 0, Math.PI / 2),
      P(cylGeo(0.12, 0.12, 0.1, 10), 0x9aa0a6, 0, 0.34, 0.55, 0, 0, Math.PI / 2),
      P(cylGeo(0.34, 0.34, 0.08, 10), 0x141414, 0, 0.34, -0.55, 0, 0, Math.PI / 2),
      P(cylGeo(0.12, 0.12, 0.1, 10), 0x9aa0a6, 0, 0.34, -0.55, 0, 0, Math.PI / 2),
      P(boxGeo(0.07, 0.07, 1.1), 0x2b6cb8, 0, 0.75, 0),
      P(boxGeo(0.07, 0.9, 0.07), 0x2b6cb8, 0, 0.55, 0.45, 0.35, 0, 0),
      P(boxGeo(0.07, 0.9, 0.07), 0x2b6cb8, 0, 0.55, -0.45, -0.35, 0, 0),
      P(boxGeo(0.22, 0.07, 0.28), 0x1c1c1e, 0, 0.95, -0.45),
      P(boxGeo(0.4, 0.06, 0.06), 0x9aa0a6, 0, 0.95, 0.55),
    ]);
  }

  // Background traffic: simple, clearly off the running lanes (|x| = 26).
  // Front modelled toward +Z (oncoming, drives toward the player).
  // Panel gaps (darker trim), wheels with hubs, framed windows — same
  // stylized proportions as before, no photorealism clash.
  _buildBus() {
    const body = 0xb3402e, dark = 0x7e2c20;
    const parts = [
      P(boxGeo(2.3, 0.5, 8.6), 0x141414, 0, 0.45, 0), // underbody (grounding)
      P(boxGeo(2.5, 2.2, 9), body, 0, 1.7, 0),
      P(boxGeo(2.54, 0.7, 8.2), 0xbfe0ee, 0, 2.2, 0), // window band
      P(boxGeo(2.5, 0.15, 9), 0xe8e4da, 0, 2.88, 0),  // roof trim
      P(boxGeo(2.0, 0.4, 0.12), 0x1a1a1a, 0, 0.95, 4.51), // grille
      P(boxGeo(2.56, 0.25, 0.3), 0x2b2b30, 0, 0.5, 4.55), // bumpers
      P(boxGeo(2.56, 0.25, 0.3), 0x2b2b30, 0, 0.5, -4.55),
      P(boxGeo(2.2, 0.9, 0.1), 0x9fc6dd, 0, 2.05, 4.52),   // windshield
      P(boxGeo(1.2, 0.3, 0.12), 0xf2b90c, 0, 2.78, 4.52),  // destination board
      // door panel gaps (right side)
      P(boxGeo(0.04, 1.9, 0.06), dark, 1.26, 1.45, 1.6),
      P(boxGeo(0.04, 1.9, 0.06), dark, 1.26, 1.45, 2.7),
      P(boxGeo(0.04, 0.06, 1.16), dark, 1.26, 2.35, 2.15),
    ];
    for (const z of [-3.4, -2.05, -0.7, 0.65, 2.0, 3.35]) // window pillars
      parts.push(P(boxGeo(2.56, 0.74, 0.12), body, 0, 2.2, z));
    for (const sx of [-1, 1]) for (const sz of [-3, 3]) { // wheels + hubs
      parts.push(P(cylGeo(0.45, 0.45, 0.3, 10), 0x1a1a1a, sx * 1.15, 0.45, sz, 0, 0, Math.PI / 2));
      parts.push(P(cylGeo(0.2, 0.2, 0.34, 10), 0x9aa0a6, sx * 1.15, 0.45, sz, 0, 0, Math.PI / 2));
    }
    return propMesh('bus', parts);
  }
  _buildAuto() {
    const parts = [
      P(boxGeo(1.3, 0.35, 2.2), 0x141414, 0, 0.35, 0), // underbody
      P(boxGeo(1.5, 0.9, 2.4), 0xf2b90c, 0, 0.85, 0),
      P(boxGeo(1.52, 0.35, 2.42), 0x1c1c1e, 0, 0.5, 0), // lower band
      P(boxGeo(1.5, 0.12, 2.0), 0x1c1c1e, 0, 1.55, -0.2), // canopy
      P(boxGeo(0.07, 0.55, 0.07), 0x1c1c1e, -0.68, 1.28, 0.75), // canopy posts
      P(boxGeo(0.07, 0.55, 0.07), 0x1c1c1e, 0.68, 1.28, 0.75),
      P(boxGeo(0.07, 0.55, 0.07), 0x1c1c1e, -0.68, 1.28, -1.1),
      P(boxGeo(0.07, 0.55, 0.07), 0x1c1c1e, 0.68, 1.28, -1.1),
      P(boxGeo(1.36, 0.5, 0.06), 0xbfe0ee, 0, 1.28, 0.78), // windshield
      P(boxGeo(1.4, 0.5, 0.14), 0x1c1c1e, 0, 0.72, 1.22),  // front apron
      P(boxGeo(0.3, 0.18, 0.08), 0xfff3bf, -0.4, 0.95, 1.28), // headlights
      P(boxGeo(0.3, 0.18, 0.08), 0xfff3bf, 0.4, 0.95, 1.28),
      P(boxGeo(0.04, 0.7, 0.05), 0x8a6a08, -0.76, 0.85, 0.2), // panel gaps
      P(boxGeo(0.04, 0.7, 0.05), 0x8a6a08, 0.76, 0.85, 0.2),
    ];
    for (const [wx, wz] of [[0, 1.05], [-0.65, -0.85], [0.65, -0.85]]) {
      parts.push(P(cylGeo(0.3, 0.3, 0.2, 8), 0x1a1a1a, wx, 0.3, wz, 0, 0, Math.PI / 2));
      parts.push(P(cylGeo(0.13, 0.13, 0.24, 8), 0x9aa0a6, wx, 0.3, wz, 0, 0, Math.PI / 2));
    }
    return propMesh('auto', parts);
  }
  _buildCar() {
    const body = 0x9fb3c8, dark = 0x5a6b7d;
    const parts = [
      P(boxGeo(1.6, 0.3, 3.8), 0x141414, 0, 0.35, 0), // underbody
      P(boxGeo(1.8, 0.65, 4.0), body, 0, 0.65, 0),
      P(boxGeo(1.62, 0.55, 1.9), 0x2e3d4d, 0, 1.2, -0.2), // glasshouse
      P(boxGeo(1.6, 0.1, 1.7), body, 0, 1.52, -0.25),     // roof
      P(boxGeo(0.1, 0.55, 0.12), body, -0.78, 1.2, 0.62), // A-pillars
      P(boxGeo(0.1, 0.55, 0.12), body, 0.78, 1.2, 0.62),
      P(boxGeo(1.5, 0.5, 0.06), 0x9fc6dd, 0, 1.05, 0.82, -0.28, 0, 0), // windshield
      P(boxGeo(1.85, 0.22, 0.25), dark, 0, 0.45, 2.0),  // bumpers
      P(boxGeo(1.85, 0.22, 0.25), dark, 0, 0.45, -2.0),
      P(boxGeo(1.2, 0.25, 0.1), 0x1a1a1a, 0, 0.6, 2.0), // grille
      P(boxGeo(0.35, 0.15, 0.08), 0xfff3bf, -0.55, 0.78, 2.0), // headlights
      P(boxGeo(0.35, 0.15, 0.08), 0xfff3bf, 0.55, 0.78, 2.0),
      // door panel gaps + handles
      P(boxGeo(0.03, 0.6, 0.05), dark, -0.91, 0.65, 0.3),
      P(boxGeo(0.03, 0.6, 0.05), dark, -0.91, 0.65, -0.9),
      P(boxGeo(0.03, 0.6, 0.05), dark, 0.91, 0.65, 0.3),
      P(boxGeo(0.03, 0.6, 0.05), dark, 0.91, 0.65, -0.9),
      P(boxGeo(0.04, 0.06, 0.25), 0x2b2b2b, -0.92, 0.85, 0.0),
      P(boxGeo(0.04, 0.06, 0.25), 0x2b2b2b, 0.92, 0.85, 0.0),
    ];
    for (const sx of [-1, 1]) for (const sz of [-1.3, 1.3]) {
      parts.push(P(cylGeo(0.35, 0.35, 0.25, 10), 0x1a1a1a, sx * 0.85, 0.35, sz, 0, 0, Math.PI / 2));
      parts.push(P(cylGeo(0.15, 0.15, 0.29, 10), 0x9aa0a6, sx * 0.85, 0.35, sz, 0, 0, Math.PI / 2));
    }
    return propMesh('car', parts);
  }

  // Background pedestrian: sidewalk-safe (|x| = 6.9), modest respectful
  // figure with a simple walk cycle (swinging legs + gentle bob).
  _buildPed(variant) {
    const shirts = [0xc94f4f, 0x4f7dc9, 0x53a06b, 0xd9a441];
    const pants = [0x2b3440, 0x3a3f45, 0x4a3b2c, 0x2b3440];
    const skins = [0x8a5a3b, 0x6e452c, 0x9c6a45, 0x7a4e30];
    const i = variant % 4;
    const g = new THREE.Group();
    const body = propMesh(`pedBody${i}`, [
      P(boxGeo(0.42, 0.38, 0.28), pants[i], 0, 0.56, 0),
      P(boxGeo(0.5, 0.7, 0.3), shirts[i], 0, 1.1, 0),
      P(boxGeo(0.12, 0.58, 0.12), shirts[i], -0.31, 1.02, 0),
      P(boxGeo(0.12, 0.58, 0.12), shirts[i], 0.31, 1.02, 0),
      P(sphGeo(0.21, 10), skins[i], 0, 1.68, 0),
    ]);
    g.add(body);
    // legs pivot at the hip (geometry translated so origin = hip joint)
    const legGeo = propGeo(`pedLeg${i}`, [P(boxGeo(0.16, 0.75, 0.2), pants[i], 0, -0.375, 0)]);
    const legL = new THREE.Mesh(legGeo, _mergedMat);
    legL.position.set(-0.12, 0.75, 0);
    legL.castShadow = true;
    const legR = new THREE.Mesh(legGeo, _mergedMat);
    legR.position.set(0.12, 0.75, 0);
    legR.castShadow = true;
    g.add(legL, legR);
    g.userData.phase = Math.random() * Math.PI * 2;
    g.userData.ws = -(1.0 + Math.random() * 0.5); // own walk drift (world -Z)
    g.userData.legL = legL;
    g.userData.legR = legR;
    return g;
  }

  _buildBusShelter() {
    const g = new THREE.Group();
    g.add(propMesh('shelter', [
      P(boxGeo(0.15, 2.4, 0.15), 0x4b5563, 0, 1.2, -1.5),
      P(boxGeo(0.15, 2.4, 0.15), 0x4b5563, 0, 1.2, 1.5),
      P(boxGeo(2.2, 0.14, 3.6), 0x2b6cb8, 0, 2.5, 0),
      P(boxGeo(2.3, 0.22, 3.7), 0x1d4ed8, 0, 2.62, 0), // roof fascia trim
      P(boxGeo(0.08, 1.2, 3.4), 0xbfe0ee, 0.95, 1.3, 0),
      P(boxGeo(0.5, 0.08, 3.0), 0x9a6b3f, 0.45, 0.6, 0),
      P(boxGeo(0.4, 0.55, 2.8), 0x8a8f96, 0.45, 0.28, 0),
    ]));
    const face = signFace(1.5, 0.5, 'BUS STOP', '#b45309', '#ffffff');
    face.position.set(-1.05, 2.1, 0);
    face.rotation.y = -Math.PI / 2; // faces -X, toward the road
    g.add(face);
    return g;
  }

  // ----- scenery (pooled, recycled)
  _buildScenery() {
    const add = (obj, x, z) => {
      obj.position.set(x, obj.position.y || 0, z);
      this.scene.add(obj);
      this.scenery.push(obj);
      this._home.push({ obj, x, z });
      return obj;
    };
    this._buildVegetation();

    // lamp posts (~8) along the sidewalks
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const lamp = this._buildLamp();
      // arm faces the road: mirror for the left side
      if (side < 0) lamp.rotation.y = Math.PI;
      add(lamp, side * 5.9, -140 + i * 22 + Math.random() * 8);
    }
    // power poles (left side, 36-unit spacing) + separate sagging wire spans
    for (let i = 0; i < 5; i++) {
      add(this._buildPowerPole(), -8.6, -150 + i * 36);
    }
    this._buildWires();
    // boundary walls with cap trim
    for (let i = 0; i < 10; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      add(this._buildWall(), side * 8.1, -145 + i * 18 + Math.random() * 6);
    }
    // benches + bins on the outer sidewalk edge (clear of the walking line)
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const bench = this._buildBench();
      bench.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; // face the road
      add(bench, side * 7.4, -138 + i * 30 + Math.random() * 6);
      const bin = this._buildBin();
      add(bin, side * 7.4, -128 + i * 30 + Math.random() * 6);
    }
    // parked two-wheelers on the sidewalk edge (clear of benches/bins)
    const parked = [
      [this._buildMotorcycle(), 7.65, -103, 0.15],
      [this._buildMotorcycle(), -7.65, -43, -0.1],
      [this._buildBicycle(), -7.65, -115, 0.1],
      [this._buildBicycle(), 7.65, -21, -0.15],
    ];
    for (const [obj, x, z, ry] of parked) {
      obj.rotation.y = ry;
      add(obj, x, z);
    }
    // background pedestrians on the sidewalks (safe zone |x| = 6.9)
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const ped = this._buildPed(i);
      add(ped, side * 6.9, -150 + i * 22 + Math.random() * 10);
      this.peds.push(ped);
    }

    // clouds drift independently (not in scenery list)
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: cloudTexture(), transparent: true, opacity: 0.92, depthWrite: false, fog: false })
      );
      sp.position.set(-70 + Math.random() * 140, 30 + Math.random() * 14, -170 + Math.random() * 190);
      const s = 26 + Math.random() * 22;
      sp.scale.set(s, s * 0.45, 1);
      this.scene.add(sp);
      this.clouds.push(sp);
    }
    this._buildSkyline();
  }

  // Instanced vegetation: shared geometries, per-instance yaw/scale variety.
  // Tree/bush items are dealt round-robin over silhouette variants after
  // sorting by z, so no two identical silhouettes stand in a row.
  _buildVegetation() {
    const rnd = Math.random;
    const byZ = (items) => items.sort((a, b) => a.z - b.z);

    // --- coconut palms: trunk + crown instanced, same item transforms ---
    const palms = [];
    for (let i = 0; i < 14; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      palms.push({
        x: side * (8.5 + rnd() * 6), z: -150 + rnd() * 180,
        yaw: rnd() * Math.PI * 2, scale: 0.85 + rnd() * 0.35,
        phase: rnd() * Math.PI * 2, sway: true,
      });
    }
    const palmField = new TreadmillField(palms);
    palmField.addMesh(propGeo('palmTrunk', PALM_TRUNK_PARTS), _mergedMat);
    palmField.addMesh(propGeo('palmCrown', palmCrownParts()), _mergedMatDS);
    palmField.addTo(this.scene);
    this._fields.push(palmField);

    // --- trees: 3 silhouette variants ---
    const treeSpots = [];
    for (let i = 0; i < 10; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      treeSpots.push({
        x: side * (10.5 + rnd() * 5), z: -150 + rnd() * 180,
        yaw: rnd() * Math.PI * 2, scale: 0.8 + rnd() * 0.5, phase: rnd() * Math.PI * 2,
      });
    }
    const treeGeos = [treeGeoA(), treeGeoB(), treeGeoC()];
    const treeVariants = [[], [], []];
    byZ(treeSpots).forEach((spot, i) => treeVariants[i % 3].push(spot));
    treeVariants.forEach((items, vi) => {
      const f = new TreadmillField(items);
      f.addMesh(treeGeos[vi], _mergedMat);
      f.addTo(this.scene);
      this._fields.push(f);
    });

    // --- bushes: 2 variants ---
    const bushSpots = [];
    for (let i = 0; i < 12; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      bushSpots.push({
        x: side * (8.2 + rnd() * 2), z: -150 + rnd() * 180,
        yaw: rnd() * Math.PI * 2, scale: 0.8 + rnd() * 0.5, phase: rnd() * Math.PI * 2,
      });
    }
    const bushGeos = [bushGeoA(), bushGeoB()];
    const bushVariants = [[], []];
    byZ(bushSpots).forEach((spot, i) => bushVariants[i % 2].push(spot));
    bushVariants.forEach((items, vi) => {
      const f = new TreadmillField(items);
      f.addMesh(bushGeos[vi], _mergedMat);
      f.addTo(this.scene);
      this._fields.push(f);
    });

    // --- planters along the outer sidewalk edge ---
    const planters = [];
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      planters.push({ x: side * 7.55, z: -146 + i * 21, yaw: (rnd() - 0.5) * 0.6, scale: 0.9 + rnd() * 0.25, phase: 0 });
    }
    const planterField = new TreadmillField(planters);
    planterField.addMesh(planterGeo(), _mergedMat);
    planterField.addTo(this.scene);
    this._fields.push(planterField);

    // write initial matrices (no treadmill motion yet)
    for (const f of this._fields) f.update(0, 0);
  }

  // Sagging power-line spans between the pole crossarms. One 180-unit
  // LineSegments object: pole spacing (36) divides the wrap length, so the
  // wire stays aligned with the individually-wrapping poles forever.
  _buildWires() {
    const pts = [];
    const sag = 0.7, y0 = 7.24, segsPer = 12;
    for (let s = 0; s < 5; s++) {
      const zA = -150 + s * 36; // span: pole s -> pole s+1 (last wraps to +30)
      for (const wx of [-9.4, -7.8]) {
        for (let i = 0; i < segsPer; i++) {
          const t0 = i / segsPer, t1 = (i + 1) / segsPer;
          pts.push(
            wx, y0 - sag * Math.sin(Math.PI * t0), zA + 36 * t0,
            wx, y0 - sag * Math.sin(Math.PI * t1), zA + 36 * t1
          );
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this._wires = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x141414 }));
    this._wires.frustumCulled = false;
    this.scene.add(this._wires);
  }

  // Distant skyline silhouette band: static (true parallax ~ 0), heavily
  // fogged, so the horizon never voids. One merged mesh, one draw call.
  _buildSkyline() {
    const parts = [];
    const cols = [0x5a6b7d, 0x6b7f92, 0x4e5f6e];
    let ci = 0;
    const block = (x, z, w, h, d) => {
      parts.push(P(boxGeo(w, h, d), cols[ci++ % 3], x, h / 2 - 0.5, z));
    };
    for (let i = 0; i < 22; i++) { // back row
      block(-80 + i * 7.4 + (Math.random() * 3 - 1.5), -150 - Math.random() * 8,
        4.5 + Math.random() * 2.5, 9 + Math.random() * 19, 7);
    }
    for (let i = 0; i < 16; i++) { // front row
      block(-72 + i * 9.4 + (Math.random() * 3 - 1.5), -136 - Math.random() * 6,
        4 + Math.random() * 2, 6 + Math.random() * 10, 6);
    }
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { // side wings
      block(s * (44 + i * 7 + Math.random() * 3), -70 - i * 14, 5, 7 + Math.random() * 12, 7);
    }
    const m = new THREE.Mesh(propGeo('skyline', parts), _mergedBasic);
    m.frustumCulled = false;
    this.scene.add(m);
  }

  // ----- scenic junctions: side-street aprons + signs, visual only.
  // The player stays on the main road; nothing here steers or collides.
  // Lanes are never blocked: kits touch |x| >= 4.9 only; the arrows/words
  // are flat decals ON the road surface.
  _buildJunctions() {
    const add = (obj, x, z) => {
      obj.position.set(x, obj.position.y || 0, z);
      this.scene.add(obj);
      this.scenery.push(obj);
      this._home.push({ obj, x, z });
      return obj;
    };

    for (const j of JUNCTIONS) {
      const s = j.side;
      const kit = new THREE.Group();
      // side-street apron: raised paved pad crossing the sidewalk (reads as a
      // junction mouth). Never touches the running lanes.
      const apron = new THREE.Mesh(boxGeo(9.7, 0.32, 6.6), std(0x33373d));
      apron.position.set(s * 10.45, 0.16, 0);
      apron.receiveShadow = true;
      kit.add(apron);
      // curb-cut wedge: sloped transition from sidewalk down to road level
      const wedge = new THREE.Mesh(boxGeo(0.85, 0.06, 6.8), std(0x767c84));
      wedge.position.set(s * 5.3, 0.16, 0);
      wedge.rotation.z = s * 0.42;
      kit.add(wedge);
      // advance turn arrows on the main road BEFORE the junction (turning lane)
      for (const az of [16, 27]) {
        const arrow = new THREE.Mesh(
          planeGeo(1.4, 2.8),
          new THREE.MeshBasicMaterial({
            map: arrowTexture(s < 0), alphaTest: 0.35, side: THREE.DoubleSide,
          })
        );
        arrow.rotation.x = -Math.PI / 2;
        arrow.position.set(s * 2.4, 0.025, az);
        kit.add(arrow);
      }
      // 'SLOW' word decal between the arrows
      const word = roadWordDecal('SLOW', 1.7);
      word.position.set(s * 2.4, 0.025, 21.5);
      kit.add(word);
      // advance warning sign on the sidewalk
      const warn = this._buildDirSign('SIDE ROAD', '#b45309');
      warn.position.set(s * 7.4, 0, 24);
      kit.add(warn);

      if (j.kind === 'market') {
        // market row: 3 generic shops set back past the landmark band
        const shops = [
          [0xe8e0d0, 'TEA SHOP', '#0d9488', 0xb5542d],
          [0xdde7f2, 'GROCERY', '#1d4ed8', 0x0d9488],
          [0xf3e9db, 'TAILOR', '#7c3aed', 0xb5542d],
        ];
        shops.forEach(([body, name, signBg, awn], i) => {
          const shop = this._buildShop(body, name, signBg, awn);
          shop.rotation.y = -Math.PI / 2; // front faces -X, toward the road
          shop.position.set(s * 24, 0, (i - 1) * 9);
          kit.add(shop);
        });
        // crates + baskets outside the shops (grounded, clear of the apron)
        const crates = propMesh('crates', [
          P(boxGeo(0.55, 0.55, 0.55), 0x9a6b3f, 0, 0.275, 0),
          P(boxGeo(0.55, 0.55, 0.55), 0x9a6b3f, 0.6, 0.275, 0.1),
          P(boxGeo(0.55, 0.55, 0.55), 0x8a5f36, 0.3, 0.825, 0.05),
          P(cylGeo(0.35, 0.28, 0.3, 10), 0xb5894a, 1.3, 0.15, -0.3),
          P(cylGeo(0.3, 0.24, 0.28, 10), 0xb5894a, 1.25, 0.14, 0.45),
        ]);
        crates.position.set(s * 8.2, 0, -8);
        kit.add(crates);
        const sign = this._buildDirSign('MARKET →');
        sign.position.set(s * 7.4, 0, 18);
        kit.add(sign);
      } else if (j.kind === 'campus') {
        // campus-side entrance: gate pillars
        for (const pz of [-2.8, 2.8]) {
          const pillar = new THREE.Mesh(boxGeo(0.7, 2.6, 0.7), std(0xf0ead9));
          pillar.position.set(s * 7.5, 1.3, pz);
          pillar.castShadow = true;
          kit.add(pillar);
          const capTop = new THREE.Mesh(boxGeo(0.9, 0.25, 0.9), std(0xb5542d));
          capTop.position.set(s * 7.5, 2.72, pz);
          kit.add(capTop);
        }
        // flag pole with green pennant beside the gate (grounded)
        const fpole = new THREE.Mesh(cylGeo(0.05, 0.07, 5.2, 8), std(0x8a8f96));
        fpole.position.set(s * 7.5, 2.6, 5.5);
        fpole.castShadow = true;
        kit.add(fpole);
        const flag = new THREE.Mesh(planeGeo(1.3, 0.8),
          new THREE.MeshStandardMaterial({ color: 0x1f6f43, roughness: 0.9, side: THREE.DoubleSide }));
        flag.rotation.y = Math.PI / 2;
        flag.position.set(s * 7.5, 4.6, 6.2);
        kit.add(flag);
        const sign = this._buildDirSign('← CAMPUS');
        sign.position.set(s * 7.4, 0, 18);
        kit.add(sign);
      } else {
        // quieter residential street: houses + hedges along the lane
        const houses = [
          [0xe8dcc4, 0xb5542d, -7],
          [0xdfe8dd, 0x8a5a3b, 7],
        ];
        for (const [body, roof, hz] of houses) {
          const house = this._buildHouse(body, roof);
          house.rotation.y = -Math.PI / 2; // front faces -X
          house.position.set(s * 24, 0, hz);
          kit.add(house);
        }
        for (const [hx, hz] of [[9, -4.5], [12, -4.5], [9, 4.5], [12, 4.5]]) {
          const hedge = new THREE.Mesh(bushGeoB(), _mergedMat);
          hedge.position.set(s * hx, 0, hz);
          hedge.castShadow = true;
          kit.add(hedge);
        }
        // street name sign at the junction mouth (neighborhood name, no address)
        const sign = this._buildDirSign('KUTTIKKATTUR', '#14532d');
        sign.position.set(s * 7.4, 0, 22);
        kit.add(sign);
        // roadside bus stop on the main road, just before the junction
        const shelter = this._buildBusShelter();
        shelter.position.set(s * 7.3, 0, 17);
        kit.add(shelter);
      }
      add(kit, 0, j.z);
    }
  }

  // ----- background traffic on distant service roads (|x| = 26).
  // Clearly non-colliding: far outside the lanes, heavily fogged.
  _buildTraffic() {
    const add = (obj, x, z) => {
      obj.position.set(x, obj.position.y || 0, z);
      this.scene.add(obj);
      this.scenery.push(obj);
      this._home.push({ obj, x, z });
      return obj;
    };
    // service road strips: featureless dark bands, 180 long, static in z
    // (a uniform strip looks identical wrapped or not, so keep them out of
    // the treadmill list and the low-quality halving)
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(planeGeo(5, WRAP), std(0x383d44));
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(s * 30, 0.01, -60);
      this.scene.add(strip);
    }
    // oncoming vehicles: spawn far ahead (fogged), drive toward the player,
    // wrap behind the camera. userData.v = ground speed toward +Z.
    const vehicles = [
      [this._buildBus(), 30, -150, 15],
      [this._buildAuto(), 30, -60, 17],
      [this._buildCar(), -30, -110, 16],
      [this._buildAuto(), -30, -20, 14],
    ];
    for (const [v, x, z, spd] of vehicles) {
      v.userData.v = spd;
      v.userData.noWrap = true; // own respawn logic in update()
      add(v, x, z);
      this.traffic.push(v);
    }
  }

  // ----- fari's GLB vehicles + windmill (Oct 13, 2026) -----------------------
  // Static meshes are exactly right for background traffic (translation only)
  // and scenery. Called once from Game init (async); on any failure the
  // procedural traffic above simply stays.
  //
  // Conventions: each GLB was measured — all three vehicles are upright with
  // length along Z and front toward +Z (oncoming). Scales normalize them to
  // game units (procedural bus ≈ 9 long, car ≈ 4).
  async loadVehicleModels(modelLoader) {
    if (!modelLoader || this._glbTrafficDone) return;
    this._glbTrafficDone = true;

    // [slot, trafficIndexToReplace, targetLength, groundY]
    const swaps = [
      ['bus', 0, 8.0, 0],   // stylized fire truck replaces procedural bus
      ['car', 2, 4.4, 0],   // stylized police car replaces procedural car
    ];
    for (const [slot, idx, targetLen, groundY] of swaps) {
      try {
        const handle = await modelLoader.loadModel(slot);
        const fitted = this._fitModel(handle.object3D, targetLen, groundY);
        fitted.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        this._swapTraffic(idx, fitted);
      } catch (e) {
        console.warn(`[world] traffic GLB "${slot}" failed, keeping procedural:`, e);
      }
    }

    // Mustang: added as an extra oncoming vehicle (slot car_sport). Its
    // wheels are separate nodes, so they spin in update().
    try {
      const handle = await modelLoader.loadModel('car_sport');
      const fitted = this._fitModel(handle.object3D, 4.6, 0);
      fitted.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      fitted.position.set(-30, 0, -160);
      fitted.userData.v = 18;
      fitted.userData.noWrap = true;
      this.scene.add(fitted);
      this.scenery.push(fitted);
      this.traffic.push(fitted);
      this._mustangWheels = [];
      fitted.traverse((o) => { if (/wheel/i.test(o.name)) this._mustangWheels.push(o); });
    } catch (e) {
      console.warn('[world] mustang GLB failed:', e);
    }

    // Windmills: roadside landmarks in the palm band (|x| ≈ 14). The supplied
    // GLB had giant terrain planes stripped (see tools note in models docs);
    // what remains is the tower + rotor, 6.25 units tall.
    try {
      const handle = await modelLoader.loadModel('windmill');
      const spots = [[-14, -70], [14, -150]];
      const sources = [handle.object3D, handle.object3D.clone()];
      for (let i = 0; i < spots.length; i++) {
        const src = sources[i];
        if (src.parent) src.parent.remove(src);
        styleWindmillBlades(src);
        const fitted = this._fitModel(src, 3.91, 0);
        fitted.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        fitted.position.set(spots[i][0], 0, spots[i][1]);
        this.scene.add(fitted);
        this.scenery.push(fitted);
      }
    } catch (e) {
      console.warn('[world] windmill GLB failed:', e);
    }
  }

  // Uniform-scale a loaded model so its Z length becomes targetLen, then lift
  // it so its lowest point sits at groundY. Returns a wrapper Group.
  _fitModel(obj, targetLen, groundY) {
    if (obj.parent) obj.parent.remove(obj);
    // Asset normalization: fully-metallic PBR with no environment map renders
    // black (the game has no env lighting). Clamp extreme metalness.
    obj.traverse((o) => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.metalness !== undefined && m.metalness > 0.6 && !m.envMap) m.metalness = 0.3;
        }
      }
    });
    const inner = new THREE.Group();
    inner.add(obj);
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const s = targetLen / Math.max(size.z, 0.001);
    inner.scale.setScalar(s);
    const wrap = new THREE.Group();
    wrap.add(inner);
    const box2 = new THREE.Box3().setFromObject(wrap);
    inner.position.y += groundY - box2.min.y;
    return wrap;
  }

  // Replace traffic[idx]'s procedural mesh with a fitted GLB, keeping its
  // lane position, speed and wrap behavior.
  _swapTraffic(idx, fitted) {
    const old = this.traffic[idx];
    if (!old) return;
    const v = old.userData.v, noWrap = old.userData.noWrap;
    const x = old.position.x, z = old.position.z;
    this.scene.remove(old);
    const si = this.scenery.indexOf(old);
    if (si >= 0) this.scenery.splice(si, 1);
    fitted.position.set(x, 0, z);
    fitted.userData.v = v;
    fitted.userData.noWrap = noWrap;
    this.scene.add(fitted);
    this.scenery.push(fitted);
    this.traffic[idx] = fitted;
  }

  // ----- per-frame (no per-frame allocation: temps reused, lists fixed)
  update(dt, speed, distanceM, quality) {
    const q = quality || this.quality;
    const dz = speed * dt;
    this._t += dt;

    for (const seg of this.segments) {
      seg.position.z += dz;
      if (seg.position.z > 45) seg.position.z = Math.round(seg.position.z - WRAP); // exact integer seam after wrap
    }
    for (const o of this.scenery) {
      o.position.z += dz;
      // background traffic manages its own wrap (respawns far ahead, fogged)
      if (!o.userData.noWrap && o.position.z > 32) o.position.z -= WRAP;
    }
    // instanced vegetation: treadmill + sway, matrices rewritten in place
    for (const f of this._fields) f.update(dz, this._t);
    // sagging wires treadmill as one unit (stays aligned with the poles)
    if (this._wires) {
      this._wires.position.z += dz;
      if (this._wires.position.z > 32) this._wires.position.z -= WRAP;
    }
    // pedestrians: walk cycle (swinging legs + bob); the scenery loop above
    // already applied the treadmill dz
    for (const p of this.peds) {
      p.position.z += p.userData.ws * dt;
      const sw = Math.sin(this._t * 7 + p.userData.phase);
      p.userData.legL.rotation.x = sw * 0.55;
      p.userData.legR.rotation.x = -sw * 0.55;
      p.position.y = Math.abs(Math.cos(this._t * 7 + p.userData.phase)) * 0.05;
      if (p.position.z > 32) p.position.z -= WRAP;
    }
    // background traffic: oncoming, faster than the treadmill
    // (the scenery loop above already applied the treadmill dz)
    for (const v of this.traffic) {
      v.position.z += v.userData.v * dt;
      if (v.position.z > 48) v.position.z = -200 - Math.random() * 30;
    }
    // mustang GLB wheels are separate nodes — spin them with road speed
    if (this._mustangWheels) {
      for (const w of this._mustangWheels) w.rotation.x += dt * 12;
    }
    // clouds: slow drift + parallax with the world
    for (const c of this.clouds) {
      c.position.z += dz * 0.15 + dt * 1.2;
      c.position.x += dt * 0.5;
      if (c.position.z > 50) {
        c.position.z = -180;
        c.position.x = -80 + Math.random() * 160;
      }
    }
    void distanceM; void q;
  }

  reset() {
    for (const h of this._home) h.obj.position.set(h.x, h.obj.position.y, h.z);
    for (const p of this.peds) {
      p.position.y = 0; // clear walk bob
      p.userData.legL.rotation.x = 0;
      p.userData.legR.rotation.x = 0;
    }
    for (const f of this._fields) f.reset();
    if (this._wires) this._wires.position.z = 0;
    for (let i = 0; i < this.segments.length; i++) {
      this.segments[i].position.z = -135 + i * SEG_LEN;
    }
    this._t = 0;
  }

  setQuality(q) {
    this.quality = q;
    const low = q === 'low';
    if (this._dirLight) {
      this._dirLight.castShadow = !low;
      // GRAPHICS OVERHAUL: shadow resolution per tier — 1024 on medium,
      // 2048 on high. Disposing the map forces the new size to take effect.
      const size = q === 'medium' ? 1024 : 2048;
      const sh = this._dirLight.shadow;
      if (!low && sh.mapSize.x !== size) {
        sh.mapSize.set(size, size);
        if (sh.map) { sh.map.dispose(); sh.map = null; }
      }
    }
    // halve scenery on low
    this.scenery.forEach((o, i) => { o.visible = low ? i % 2 === 0 : true; });
    // thin out instanced vegetation instead of hiding it outright
    for (const f of this._fields) f.setQuality(low);
    // wires are a subtle detail: drop them on low
    if (this._wires) this._wires.visible = !low;
  }
}
