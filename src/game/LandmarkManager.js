// LandmarkManager.js — 9 Kuttikkattur landmarks on a 900 m lap.
// Each landmark = THREE.Group placed at x = +/-9 (alternating sides), with the
// building mass offset outward so nothing intrudes on the lanes (|x| >= 7).
// z is computed from the lap each frame: z = -rel + 10, rel in [0, 900).
// Signage is DIMENSIONAL: every sign is a 3D board (dark backing box + canvas
// face plane), name-only, exact official spellings — no invented offers.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const LAP = 900;

// Fixed order + lap offsets. Sides alternate L,R,L,R...
// Spellings are the official signage spellings (name-only, no invented offers).
const LANDMARKS = [
  { id: 'juicify', name: 'Juicify Kuttikkattur', offset: 40,  side: -1, kind: 'shop', body: 0xa8dcec, signBg: '#06b6d4', signFg: '#ffffff', h: 7, glassFront: true },
  { id: 'turkish', name: 'Turkish Corner',      offset: 130, side: 1,  kind: 'shop', body: 0x2b2b30, signBg: '#1a1a1a', signFg: '#fbbf24', h: 6, foodCounter: true },
  { id: 'laban',   name: 'Hey Laban Store',     offset: 220, side: -1, kind: 'shop', body: 0xdde7f2, signBg: '#1d4ed8', signFg: '#ffffff', h: 7, blueFront: true },
  { id: 'family',  name: 'Family Collections',  offset: 310, side: 1,  kind: 'shop', body: 0xf3e9db, signBg: '#0d9488', signFg: '#ffffff', h: 6, clothing: true, textile: true },
  { id: 'busstop', name: 'Bus stop',            offset: 400, side: -1, kind: 'busstop' },
  { id: 'masjid',  name: 'Masjid',              offset: 490, side: 1,  kind: 'masjid' },
  { id: 'edumart', name: 'Edumart Office',      offset: 580, side: -1, kind: 'shop', body: 0xf5f0e2, signBg: '#facc15', signFg: '#1a1a1a', h: 6, office: true },
  { id: 'academy', name: 'Shamsul Huda Islamic Academy Campus', offset: 670, side: 1, kind: 'academy' },
  { id: 'myg',     name: 'MyG Store',           offset: 760, side: -1, kind: 'shop', body: 0x232a35, signBg: '#f97316', signFg: '#ffffff', h: 7, electronics: true },
];

// ---------- module caches
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
function cylGeo(rt, rb, h, seg = 12) {
  const k = `cyl:${rt},${rb},${h},${seg}`;
  if (!_geo.has(k)) _geo.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
  return _geo.get(k);
}
const _mat = new Map();
// PBR workhorse (correct under ACES tone mapping); near-Lambertian default.
function std(color, opts = {}) {
  const k = `s:${color}:${JSON.stringify(opts)}`;
  if (!_mat.has(k)) _mat.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.0, ...opts }));
  return _mat.get(k);
}

// ---------- merged trim geometry: one draw call per landmark's static trim
// Parts are { g: transformed geometry, c: hex color }, merged with a
// per-vertex color attribute under a shared vertex-color Standard material.
const _lmMerged = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 });
function LP(geo, c, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geo.clone();
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1)
  );
  g.applyMatrix4(m);
  return { g, c };
}
function lpaint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const col = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const _lmPropGeo = new Map();
function lmProp(key, parts, shadow = true) {
  if (!_lmPropGeo.has(key)) {
    _lmPropGeo.set(key, mergeGeometries(parts.map((p) => lpaint(p.g, p.c)), false));
  }
  const m = new THREE.Mesh(_lmPropGeo.get(key), _lmMerged);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

// Terracotta prism roof (triangular cross-section, extruded along Z).
function prismRoofGeo(halfW, depth) {
  const k = `roof:${halfW},${depth}`;
  if (_geo.has(k)) return _geo.get(k);
  const R = halfW / 0.866;
  const geo = new THREE.CylinderGeometry(R, R, depth, 3, 1);
  geo.rotateX(Math.PI / 2);   // axis along Z
  geo.rotateZ(Math.PI);       // apex up
  geo.scale(1, 0.24, 1);       // flatten: roof height ~= 0.36 * R
  _geo.set(k, geo);
  return geo;
}

// Sign board texture with the EXACT store name. No invented offers/branding.
const _signTex = new Map();
function signTexture(name, bg, fg) {
  const k = `${name}|${bg}|${fg}`;
  if (_signTex.has(k)) return _signTex.get(k);
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 10;
  g.strokeRect(14, 14, 996, 228);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let px = 112;
  g.font = `bold ${px}px Arial, sans-serif`;
  while (g.measureText(name).width > 940 && px > 28) {
    px -= 6;
    g.font = `bold ${px}px Arial, sans-serif`;
  }
  g.fillText(name, 512, 136);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _signTex.set(k, tex);
  return tex;
}

// Striped canvas texture (awnings), cached. c1/c2 are CSS colors.
const _stripeTex = new Map();
function stripeTexture(c1, c2, stripes = 8) {
  const k = `${c1}|${c2}|${stripes}`;
  if (_stripeTex.has(k)) return _stripeTex.get(k);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  const w = c.width / stripes;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? c1 : c2;
    g.fillRect(Math.floor(i * w), 0, Math.ceil(w) + 1, c.height);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _stripeTex.set(k, tex);
  return tex;
}

export class LandmarkManager {
  constructor(scene, events, assetLoader) {
    this.scene = scene;
    this.events = events || { on() {}, emit() {} };
    this.assetLoader = assetLoader;
    this.LAP = LAP;
    this._lastLap = {}; // id -> lap number of last 'landmark' emit
    this.landmarks = LANDMARKS.map((def) => {
      const group = this._buildLandmark(def);
      group.position.set(def.side * 9, 0, -def.offset + 10);
      this.scene.add(group);
      return { def, group };
    });
  }

  // Dimensional sign: dark backing board + canvas name-face, rotated as one
  // unit to face the road. Group is at x=side*9; the road-facing building
  // face is at local x = -2*side (|x| = 7 in world).
  _addSign(group, def, text, w, h, y, bg, fg) {
    const holder = new THREE.Group();
    holder.position.set(-2.15 * def.side, y, 0);
    const back = new THREE.Mesh(boxGeo(w + 0.35, h + 0.35, 0.16), std(0x14161a));
    back.castShadow = true;
    holder.add(back);
    const face = new THREE.Mesh(
      planeGeo(w, h),
      new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg) })
    );
    face.position.z = 0.09;
    holder.add(face);
    holder.rotation.y = def.side > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(holder);
    return holder;
  }

  _buildShop(def) {
    const g = new THREE.Group();
    const s = def.side;
    const h = def.h || 7;
    // body: world centre x = s*14, spans s*7..s*21 (local centre s*5)
    const body = new THREE.Mesh(boxGeo(14, h, 10), std(def.body));
    body.position.set(s * 5, h / 2, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    // terracotta prism roof
    const roof = new THREE.Mesh(prismRoofGeo(7.8, 11), std(0xb5542d));
    roof.position.set(s * 5, h + 0.55, 0);
    roof.castShadow = true;
    g.add(roof);
    // ---- dimensional shopfront trim: plinth, cornice, corner pilasters,
    // recessed door frame, framed display windows (one merged mesh) ----
    {
      const trim = 0xece5d3;
      const tparts = [];
      tparts.push(LP(boxGeo(14.4, 0.55, 10.4), 0x8f8a7c, s * 5, 0.275, 0)); // plinth
      tparts.push(LP(boxGeo(14.5, 0.35, 10.5), trim, s * 5, h - 0.18, 0));  // cornice
      for (const px of [s * 5 - 6.9, s * 5 + 6.9]) for (const pz of [-4.9, 4.9])
        tparts.push(LP(boxGeo(0.55, h - 0.6, 0.55), trim, px, (h - 0.6) / 2 + 0.4, pz));
      // door frame: protruding jambs + lintel; the door plane sits recessed
      const fx = -2.12 * s;
      tparts.push(LP(boxGeo(0.35, 3.6, 0.3), trim, fx, 1.8, -1.45));
      tparts.push(LP(boxGeo(0.35, 3.6, 0.3), trim, fx, 1.8, 1.45));
      tparts.push(LP(boxGeo(0.35, 0.4, 3.2), trim, fx, 3.7, 0));
      if (!def.office) tparts.push(LP(boxGeo(0.9, 0.18, 3.2), 0x9aa0a8, -2.5 * s, 0.09, 0)); // step
      if (!def.glassFront && !def.office) {
        for (const z of [-3.1, 3.1]) { // framed display windows + sills
          const wx = -2.06 * s;
          tparts.push(LP(boxGeo(0.14, 0.14, 3.28), trim, wx, 2.92, z));
          tparts.push(LP(boxGeo(0.14, 0.14, 3.28), trim, wx, 0.48, z));
          tparts.push(LP(boxGeo(0.14, 2.58, 0.14), trim, wx, 1.7, z - 1.57));
          tparts.push(LP(boxGeo(0.14, 2.58, 0.14), trim, wx, 1.7, z + 1.57));
          tparts.push(LP(boxGeo(0.34, 0.12, 3.4), trim, -2.08 * s, 0.4, z));
        }
      } else { // transom bar across the top of the glass curtain
        tparts.push(LP(boxGeo(0.2, 0.3, 7.9), def.glassFront ? 0x06b6d4 : 0x4b5563, -2.1 * s, 3.35, 0));
      }
      g.add(lmProp(`shoptrim:${s}:${h}:${def.glassFront || def.office ? 'glass' : 'win'}`, tparts));
    }
    // recessed dark entrance on the road face (local x = -2s)
    const door = new THREE.Mesh(planeGeo(2.6, 3.2), std(0x14181f));
    door.position.set(-2.02 * s, 1.6, 0);
    door.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(door);
    // storefront glass: full curtain for glass-front shops, else two windows
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xbcd8e8, transparent: true, opacity: 0.55, roughness: 0.25, metalness: 0.1,
    });
    if (def.glassFront || def.office) {
      // Juicify: cyan/blue glass facade — big curtain + cyan mullions
      const curtain = new THREE.Mesh(planeGeo(7.6, 3.0), new THREE.MeshStandardMaterial({
        color: 0x9fd4ef, transparent: true, opacity: 0.72, roughness: 0.25, metalness: 0.1,
      }));
      curtain.position.set(-2.02 * s, 1.8, 0);
      curtain.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(curtain);
      const mullCol = def.glassFront ? 0x06b6d4 : 0x4b5563;
      for (const z of [-3.4, -1.15, 1.15, 3.4]) {
        const mull = new THREE.Mesh(boxGeo(0.16, 3.2, 0.16), std(mullCol));
        mull.position.set(-2.12 * s, 1.8, z);
        g.add(mull);
      }
      const sill = new THREE.Mesh(boxGeo(0.2, 0.35, 7.8), std(mullCol));
      sill.position.set(-2.1 * s, 0.18, 0);
      g.add(sill);
    } else {
      for (const z of [-3.1, 3.1]) {
        const win = new THREE.Mesh(planeGeo(3.0, 2.3), glassMat);
        win.position.set(-2.02 * s, 1.7, z);
        win.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
        g.add(win);
      }
    }
    if (def.blueFront) {
      // Hey Laban: blue shopfront trim — pilasters, lintel, base band
      for (const z of [-2.2, 2.2]) {
        const pil = new THREE.Mesh(boxGeo(0.5, 3.6, 0.5), std(0x1d4ed8));
        pil.position.set(-2.1 * s, 1.8, z);
        pil.castShadow = true;
        g.add(pil);
      }
      const lintel = new THREE.Mesh(boxGeo(0.2, 0.35, 5.0), std(0x1d4ed8));
      lintel.position.set(-2.08 * s, 3.55, 0);
      g.add(lintel);
      const band = new THREE.Mesh(boxGeo(0.18, 0.9, 10), std(0x1d4ed8));
      band.position.set(-2.06 * s, 0.45, 0);
      g.add(band);
    }
    if (def.foodCounter) {
      // Turkish Corner: street food-counter form in front of the dark facade.
      // Kept roadside (world |x| ~ 5.1..6.9) — never in the lanes.
      const cx = -3.2 * s;
      const counter = new THREE.Mesh(boxGeo(1.4, 1.0, 3.4), std(0x5b3a20));
      counter.position.set(cx, 0.5, 0);
      counter.castShadow = true;
      g.add(counter);
      const ctop = new THREE.Mesh(boxGeo(1.6, 0.1, 3.6), std(0x2b2b30));
      ctop.position.set(cx, 1.05, 0);
      g.add(ctop);
      // striped awning sloping down toward the road
      const awn = new THREE.Mesh(
        planeGeo(2.6, 4.2),
        new THREE.MeshStandardMaterial({ map: stripeTexture('#f97316', '#fdf6e9'), side: THREE.DoubleSide, roughness: 0.9 })
      );
      awn.position.set(-2.9 * s, 3.1, 0);
      awn.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      awn.rotateX(-0.42);
      awn.castShadow = true;
      g.add(awn);
      for (const z of [-1.9, 1.9]) {
        const pole = new THREE.Mesh(cylGeo(0.06, 0.06, 3.2, 8), std(0x3f4750));
        pole.position.set(-2.35 * s, 1.6, z);
        g.add(pole);
      }
      // warm glow strip under the awning (emissive, no extra light)
      const glow = new THREE.Mesh(
        boxGeo(0.1, 0.12, 3.2),
        new THREE.MeshBasicMaterial({ color: 0xffc979 })
      );
      glow.position.set(-2.5 * s, 2.35, 0);
      g.add(glow);
    }
    if (def.textile) {
      // Family Collections: striped textile awning + fabric rolls on display
      const awn = new THREE.Mesh(
        planeGeo(2.4, 8.6),
        new THREE.MeshStandardMaterial({ map: stripeTexture('#0d9488', '#fdf6e9'), side: THREE.DoubleSide, roughness: 0.9 })
      );
      awn.position.set(-2.95 * s, 3.7, 0);
      awn.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      awn.rotateX(-0.38);
      awn.castShadow = true;
      g.add(awn);
      const rollCols = [0xd94f4f, 0xf2b134, 0x4f7ad9];
      rollCols.forEach((cc, i) => {
        const roll = new THREE.Mesh(cylGeo(0.26, 0.26, 2.0, 10), std(cc));
        roll.rotation.x = Math.PI / 2; // axis along Z
        roll.position.set(-2.35 * s, 1.0 + i * 0.55, -3.1);
        g.add(roll);
      });
    }
    if (def.office) {
      // Edumart Office: entry steps + glass door
      const st1 = new THREE.Mesh(boxGeo(1.2, 0.18, 3.2), std(0x9aa0a8));
      st1.position.set(-2.55 * s, 0.09, 0);
      g.add(st1);
      const st2 = new THREE.Mesh(boxGeo(0.9, 0.18, 2.8), std(0x9aa0a8));
      st2.position.set(-2.4 * s, 0.27, 0);
      g.add(st2);
    }
    // window displays
    if (def.clothing) {
      // Family Collections: colored clothing boxes in the window
      // (opposite window from the fabric rolls, to avoid clipping)
      const cols = [0xd94f4f, 0x4f7ad9, 0x4fd97a];
      cols.forEach((cc, i) => {
        const bx = new THREE.Mesh(boxGeo(0.5, 0.7, 0.5), std(cc));
        bx.position.set(-2.35 * s, 0.85, 3.1 - i * 0.9);
        g.add(bx);
      });
    }
    if (def.electronics) {
      // MyG: phone / box shapes with glowing screens
      for (const z of [-3.4, -2.5]) {
        const phone = new THREE.Mesh(boxGeo(0.35, 1.0, 0.6), std(0x111418));
        phone.position.set(-2.4 * s, 1.0, z);
        g.add(phone);
        const scr = new THREE.Mesh(
          planeGeo(0.45, 0.8),
          new THREE.MeshBasicMaterial({ color: 0x9fd8ff })
        );
        scr.position.set(-2.6 * s, 1.0, z);
        scr.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
        g.add(scr);
      }
    }
    // sign board above the storefront
    this._addSign(g, def, def.name, 9, 1.7, h - 1.1, def.signBg, def.signFg);
    return g;
  }

  _buildBusStop(def) {
    const g = new THREE.Group();
    const s = def.side;
    const cx = -1.4 * s; // shelter centre, just off the road (|x| ~ 7.6 world)
    // poles
    for (const z of [-2.2, 2.2]) {
      const pole = new THREE.Mesh(cylGeo(0.09, 0.09, 3.0, 8), std(0x3f4750));
      pole.position.set(cx, 1.5, z);
      pole.castShadow = true;
      g.add(pole);
    }
    // roof + fascia trim + side frames (one merged mesh)
    const roof = new THREE.Mesh(boxGeo(1.8, 0.14, 5.4), std(0x1f6f8b));
    roof.position.set(cx, 3.05, 0);
    roof.castShadow = true;
    g.add(roof);
    g.add(lmProp(`shelterTrim:${s}`, [
      LP(boxGeo(0.12, 0.3, 5.5), 0x14532d, cx - 0.9 * s, 3.0, 0), // road-side fascia
      LP(boxGeo(1.9, 0.3, 0.12), 0x14532d, cx, 3.0, -2.7),       // end fascias
      LP(boxGeo(1.9, 0.3, 0.12), 0x14532d, cx, 3.0, 2.7),
      LP(boxGeo(0.1, 1.7, 0.1), 0x3f4750, cx + 0.8 * s, 1.35, -2.6), // back-panel frame
      LP(boxGeo(0.1, 1.7, 0.1), 0x3f4750, cx + 0.8 * s, 1.35, 2.6),
      LP(boxGeo(0.1, 0.1, 5.3), 0x3f4750, cx + 0.8 * s, 2.2, 0),
    ]));
    // bench
    const bench = new THREE.Mesh(boxGeo(0.55, 0.12, 4.2), std(0x8a5a33));
    bench.position.set(cx + 0.35 * s, 0.65, 0);
    g.add(bench);
    for (const z of [-1.8, 1.8]) {
      const leg = new THREE.Mesh(boxGeo(0.5, 0.6, 0.12), std(0x5b3a20));
      leg.position.set(cx + 0.35 * s, 0.3, z);
      g.add(leg);
    }
    // back panel
    const back = new THREE.Mesh(boxGeo(0.08, 1.6, 5.0), std(0xd7dee6, { transparent: true, opacity: 0.7 }));
    back.position.set(cx + 0.8 * s, 1.6, 0);
    g.add(back);
    // sign pole + board (dimensional sign holder, repositioned by the pole)
    const spole = new THREE.Mesh(cylGeo(0.07, 0.07, 3.6, 8), std(0x3f4750));
    spole.position.set(-2.0 * s, 1.8, 3.4);
    g.add(spole);
    const signHolder = this._addSign(g, { ...def, side: s }, 'Bus stop', 3.4, 1.0, 3.9, '#14532d', '#ffffff');
    signHolder.position.set(-2.0 * s, 3.9, 3.4);
    return g;
  }

  _buildMasjid(def) {
    // Respectful abstract exterior: cream building, central dome, 2 minarets.
    // No interior, no figures.
    const g = new THREE.Group();
    const s = def.side;
    const bx = s * 5; // local centre -> world |x| 7..21
    const hall = new THREE.Mesh(boxGeo(13, 5, 10), std(0xf7f1e3));
    hall.position.set(bx, 2.5, 0);
    hall.castShadow = true;
    hall.receiveShadow = true;
    g.add(hall);
    // parapet
    const par = new THREE.Mesh(boxGeo(13.6, 0.7, 10.6), std(0xe4d9c2));
    par.position.set(bx, 5.3, 0);
    g.add(par);
    // central dome (half sphere)
    const domeGeo = new THREE.SphereGeometry(3.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const dome = new THREE.Mesh(domeGeo, std(0xfbf7ec));
    dome.position.set(bx, 5.6, 0);
    dome.castShadow = true;
    g.add(dome);
    // abstract crescent finial (gold torus arc)
    const cres = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.09, 8, 20, 4.4),
      std(0xd9a441)
    );
    cres.position.set(bx, 9.35, 0);
    cres.rotation.z = 0.6;
    g.add(cres);
    const fin = new THREE.Mesh(cylGeo(0.06, 0.06, 0.8, 8), std(0xd9a441));
    fin.position.set(bx, 8.85, 0);
    g.add(fin);
    // 2 minarets engaged at the road-facing corners + gallery rings
    for (const z of [-5.2, 5.2]) {
      const m = new THREE.Mesh(cylGeo(0.42, 0.55, 8.5, 10), std(0xf1e9d4));
      m.position.set(-1.55 * s, 4.25, z);
      m.castShadow = true;
      g.add(m);
      const gal = new THREE.Mesh(cylGeo(0.62, 0.62, 0.16, 10), std(0xe4d9c2));
      gal.position.set(-1.55 * s, 6.4, z);
      g.add(gal);
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.62, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        std(0xd9a441)
      );
      cap.position.set(-1.55 * s, 8.5, z);
      g.add(cap);
    }
    // arched doorway hint (dark recessed plane, abstract) + surround + step.
    // (The door previously floated ~0.5 in front of the hall face — fixed.)
    const door = new THREE.Mesh(planeGeo(2.2, 3.0), std(0x3a332a));
    door.position.set(-1.53 * s, 1.5, 0);
    door.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(door);
    g.add(lmProp(`masjidDoor:${s}`, [
      LP(boxGeo(0.2, 3.4, 0.3), 0xe4d9c2, -1.6 * s, 1.7, -1.25),
      LP(boxGeo(0.2, 3.4, 0.3), 0xe4d9c2, -1.6 * s, 1.7, 1.25),
      LP(boxGeo(0.2, 0.35, 2.8), 0xe4d9c2, -1.6 * s, 3.35, 0),
      LP(boxGeo(1.0, 0.16, 3.0), 0x9aa0a8, -2.0 * s, 0.08, 0),
    ]));
    // arched window hints flanking the door (trim border + dark inset)
    for (const z of [-3.2, 3.2]) {
      const ry = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      const trimP = new THREE.Mesh(planeGeo(1.7, 2.5), std(0xe4d9c2));
      trimP.position.set(-1.512 * s, 1.55, z);
      trimP.rotation.y = ry;
      g.add(trimP);
      const darkP = new THREE.Mesh(planeGeo(1.4, 2.2), std(0x3a332a));
      darkP.position.set(-1.524 * s, 1.55, z);
      darkP.rotation.y = ry;
      g.add(darkP);
      const trimA = new THREE.Mesh(new THREE.CircleGeometry(0.85, 14, 0, Math.PI), std(0xe4d9c2));
      trimA.position.set(-1.512 * s, 2.8, z);
      trimA.rotation.y = ry;
      g.add(trimA);
      const darkA = new THREE.Mesh(new THREE.CircleGeometry(0.7, 14, 0, Math.PI), std(0x3a332a));
      darkA.position.set(-1.524 * s, 2.8, z);
      darkA.rotation.y = ry;
      g.add(darkA);
    }
    // low boundary railing along the sidewalk edge (world |x| ~ 7.9),
    // gate opening aligned with the door
    {
      const wparts = [];
      for (let z = -8; z <= 8.01; z += 3.2) {
        if (Math.abs(z) < 2.6) continue;
        wparts.push(LP(boxGeo(0.4, 1.5, 0.4), 0xf7f1e3, -1.1 * s, 0.75, z));
        wparts.push(LP(boxGeo(0.52, 0.14, 0.52), 0xd9a441, -1.1 * s, 1.57, z));
      }
      for (let z = -8; z < 8; z += 3.2) {
        const z0 = z + 1.6;
        if (Math.abs(z0) < 3.0) continue;
        wparts.push(LP(boxGeo(0.08, 0.08, 3.0), 0x3f4750, -1.1 * s, 1.25, z0));
        wparts.push(LP(boxGeo(0.08, 0.08, 3.0), 0x3f4750, -1.1 * s, 0.55, z0));
        for (let k = -1; k <= 1; k++)
          wparts.push(LP(boxGeo(0.06, 0.8, 0.06), 0x3f4750, -1.1 * s, 0.9, z0 + k * 0.9));
      }
      g.add(lmProp(`masjidRail:${s}`, wparts));
    }
    const signHolder = this._addSign(g, def, 'Masjid', 5, 1.2, 6.6, '#f7f1e3', '#1f2937');
    signHolder.position.x = -1.8 * s; // sit just proud of the hall face
    return g;
  }

  _buildAcademy(def) {
    // Campus gate: 2 pillars + arch + sign, school block behind.
    const g = new THREE.Group();
    const s = def.side;
    const gx = -1.35 * s; // gate line near the road (world |x| ~ 7.65, clear of the ped line)
    for (const z of [-3.4, 3.4]) {
      const pillar = new THREE.Mesh(boxGeo(1.1, 4.6, 1.1), std(0xf2ede0));
      pillar.position.set(gx, 2.3, z);
      pillar.castShadow = true;
      g.add(pillar);
      const cap = new THREE.Mesh(boxGeo(1.4, 0.35, 1.4), std(0x1f6f43));
      cap.position.set(gx, 4.75, z);
      g.add(cap);
    }
    const arch = new THREE.Mesh(boxGeo(1.0, 1.1, 8.2), std(0xf2ede0));
    arch.position.set(gx, 4.4, 0);
    arch.castShadow = true;
    g.add(arch);
    // flag pole with green pennant beside the gate (grounded)
    const fpole = new THREE.Mesh(cylGeo(0.05, 0.07, 5.2, 8), std(0x8a8f96));
    fpole.position.set(gx, 2.6, 6.2);
    fpole.castShadow = true;
    g.add(fpole);
    const flag = new THREE.Mesh(planeGeo(1.3, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x1f6f43, roughness: 0.9, side: THREE.DoubleSide }));
    flag.rotation.y = Math.PI / 2;
    flag.position.set(gx, 4.6, 6.9);
    g.add(flag);
    // school block behind the gate (world |x| ~ 9..21)
    const block = new THREE.Mesh(boxGeo(12, 5.5, 14), std(0xfbf8ef));
    block.position.set(s * 6.5, 2.75, 0);
    block.castShadow = true;
    block.receiveShadow = true;
    g.add(block);
    const broof = new THREE.Mesh(prismRoofGeo(6.8, 15), std(0xb5542d));
    broof.position.set(s * 6.5, 6.05, 0);
    g.add(broof);
    // classroom window hints on the block's road face (local x = 0.5s;
    // they previously floated ~2.5 in front of the block — fixed)
    for (let i = -2; i <= 2; i++) {
      const win = new THREE.Mesh(planeGeo(1.4, 1.4), std(0x9fc3d8));
      win.position.set(0.48 * s, 2.9, i * 2.4);
      win.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(win);
    }
    // boundary wall echoing the campus perimeter (world |x| ~ 7.3, roadside),
    // split with a gap at the gate opening (|z| < 4.5).
    for (const zc of [-8.75, 8.75]) {
      const wall = new THREE.Mesh(boxGeo(0.45, 1.7, 8.5), std(0xf2ede0));
      wall.position.set(-1.7 * s, 0.85, zc);
      wall.castShadow = true;
      wall.receiveShadow = true;
      g.add(wall);
      const coping = new THREE.Mesh(boxGeo(0.6, 0.22, 8.7), std(0x1f6f43));
      coping.position.set(-1.7 * s, 1.8, zc);
      g.add(coping);
    }
    for (const z of [-12.5, -8.75, -4.75, 4.75, 8.75, 12.5]) {
      const wp = new THREE.Mesh(boxGeo(0.7, 2.2, 0.7), std(0xf2ede0));
      wp.position.set(-1.7 * s, 1.1, z);
      wp.castShadow = true;
      g.add(wp);
      const wcap = new THREE.Mesh(boxGeo(0.9, 0.25, 0.9), std(0x1f6f43));
      wcap.position.set(-1.7 * s, 2.3, z);
      g.add(wcap);
    }
    // long sign on the arch
    const sign = new THREE.Mesh(
      planeGeo(7.6, 1.0),
      new THREE.MeshBasicMaterial({ map: signTexture(def.name, '#1f6f43', '#ffffff') })
    );
    sign.position.set(gx - 0.55 * s, 4.4, 0);
    sign.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(sign);
    return g;
  }

  _buildLandmark(def) {
    switch (def.kind) {
      case 'busstop': return this._buildBusStop(def);
      case 'masjid': return this._buildMasjid(def);
      case 'academy': return this._buildAcademy(def);
      default: return this._buildShop(def);
    }
  }

  update(dt, speed, distanceM) {
    const lap = Math.floor(distanceM / this.LAP);
    const lapD = ((distanceM % this.LAP) + this.LAP) % this.LAP;
    for (const { def, group } of this.landmarks) {
      const rel = (((def.offset - lapD) % this.LAP) + this.LAP) % this.LAP;
      const z = -rel + 10; // sweeps from -890 up to +10, then wraps
      group.position.z = z;
      if (z >= -5 && z <= 5 && this._lastLap[def.id] !== lap) {
        this._lastLap[def.id] = lap;
        this.events.emit('landmark', def.name);
      }
    }
    void dt; void speed;
  }

  reset() {
    this._lastLap = {};
    for (const { def, group } of this.landmarks) {
      group.position.z = -def.offset + 10;
    }
  }
}
