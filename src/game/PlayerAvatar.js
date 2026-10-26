import * as THREE from 'three';

// ---------------------------------------------------------------------------
// PlayerAvatar — stylized procedural hero rig for MUSLIYARKUTTI: MALABAR RUNNER.
//
// HONEST STATUS: this is a stylized procedural stand-in, NOT a premium model.
// It is built from shaped three.js geometry (lathe cloth forms, wrapped
// tori, sculpted spheres — no boxes stacked, no SVG). A real rigged hero GLB
// is still needed; see public/models/manifest.json (slot "hero") and
// GRAPHICS_ASSET_STATUS.md. When that GLB lands, ModelLoader's hero
// fallback builder (currently `new PlayerAvatar(scene)`) is retired and only
// the manifest changes.
//
// Faces -Z (away from camera); camera behind at +Z sees the back + turban tail.
// Palette from assets/svg/character_reference.svg:
//   jubba/lungi ivory #FAF7F0, kara border #697682, skin #C97E50,
//   turban white #FFFFFF, eyes dark umber #24140B, gold accents #D9A441.
//
// Proportions (stylized, checked against ~1.7 units):
//   hips pivot 0.95 | leg 0.90 (thigh 0.44 / shin 0.42 / foot) -> sole ~0.02
//   torso pivot 1.07 | head centre 1.47 (r 0.155) | turban crown ~1.76
//   shoulder width ~0.45, head : body ~ 1 : 10.5 (slightly heroic, readable
//   at chase-camera distance).
// ---------------------------------------------------------------------------

const IVORY = 0xfaf7f0;
const LUNGI_IVORY = 0xf5f1e6;
const SKIN = 0xc97e50;
const TURBAN_WHITE = 0xffffff;
const KARA = 0x697682;
const KARA_DARK = 0x4d5761;
const DARK = 0x24140b;
const SMILE = 0x5c2010;
const GOLD = 0xd9a441;

export const AVATAR_ANIMS = [
  'idle', 'reading', 'run', 'jump', 'slide', 'left', 'right',
  'collect', 'stumble', 'fall', 'jetpack', 'glide', 'standup', 'react',
];

const HIPS_BASE_Y = 0.95; // waist height; total rig height ~1.7 (+ turban)

function smooth01(x) {
  x = Math.min(1, Math.max(0, x));
  return x * x * (3 - 2 * x);
}

// Full joint pose. hipsY is a delta added to HIPS_BASE_Y.
// Convention: facing -Z. Positive rotation.x swings a downward limb toward -Z
// (forward); negative torso rotation.x leans the torso forward.
// Cloth channels: hemX/hemZ drive the jubba hem band, tailX the turban tail
// root, tailTipX the tail tip hinge — all keyed to runPhase / runRate so
// cloth motion stays synced with the stride.
function basePose() {
  return {
    hipsY: 0, hipsRX: 0, hipsRY: 0,
    torsoRX: 0, torsoRY: 0, torsoRZ: 0, torsoSY: 1,
    headRX: 0, headRY: 0, headRZ: 0,
    armLx: 0, armLz: 0, armRx: 0, armRz: 0,
    foreLx: 0, foreRx: 0,
    legLx: 0, legRx: 0,
    leanZ: 0, fallX: 0, dropY: 0,
    tailX: 0, tailTipX: 0, hemX: 0, hemZ: 0,
  };
}

function lerpPose(a, b, k) {
  const o = {};
  for (const key in a) o[key] = a[key] + (b[key] - a[key]) * k;
  return o;
}

export class PlayerAvatar {
  constructor(scene) {
    this.group = new THREE.Group();
    this.groupOffsetY = 0; // extra y offset (used by 'fall'); controller adds it
    this.anim = 'idle';
    this.animT = 0;
    // Run-cycle stride: PlayerController advances `runPhase` each fixed step
    // at 14 * (speed / 8) rad/s and sets `runRate`; the run poses read
    // `runPhase` so leg swing matches ground speed (footsteps stay in sync).
    this.runRate = 1;
    this.runPhase = 0;
    this.parts = {};
    this._buildRig();
    this._pose = basePose();
    this._prev = basePose();
    this._blendT = 1; // 0..1 transition blend on setAnim
    scene.add(this.group);
  }

  // ------------------------------------------------------------ rig building
  _buildRig() {
    // PBR fabrics: physical materials with sheen so the ivory cloth reads as
    // woven fabric under the sun/hemisphere lights instead of flat plastic.
    const matJubba = new THREE.MeshPhysicalMaterial({
      color: IVORY, roughness: 0.8, sheen: 0.8, sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0xfffdf8),
    });
    const matLungi = new THREE.MeshPhysicalMaterial({
      color: LUNGI_IVORY, roughness: 0.9, sheen: 0.5, sheenRoughness: 0.6,
      sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide,
    });
    const matTurban = new THREE.MeshPhysicalMaterial({
      color: TURBAN_WHITE, roughness: 0.65, sheen: 0.6, sheenRoughness: 0.45,
      sheenColor: new THREE.Color(0xffffff),
    });
    const matSkin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.55 });
    const matKara = new THREE.MeshStandardMaterial({ color: KARA, roughness: 0.85 });
    const matKaraDark = new THREE.MeshStandardMaterial({ color: KARA_DARK, roughness: 0.85 });
    const matDark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.5 });
    const matSmile = new THREE.MeshStandardMaterial({ color: SMILE, roughness: 0.6 });
    const matGold = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.35, metalness: 0.6 });

    const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // ---- hips (waist pivot) ----
    const hips = new THREE.Group();
    hips.position.set(0, HIPS_BASE_Y, 0);
    this.group.add(hips);

    // ---- lungi: wrapped form with visible fold bands + wrap seam ----
    const lungiMesh = mesh(
      new THREE.CylinderGeometry(0.19, 0.245, 0.56, 18), matLungi, hips, 0, -0.28, 0
    );
    // fold bands: thin wrap rings at slightly different tilts — the wrap reads
    // as folded cloth rather than a plain tube
    const foldTilt = [[-0.16, 0.06, 0.03], [-0.30, -0.05, -0.04], [-0.43, 0.05, 0.05]];
    for (const [fy, tx, tz] of foldTilt) {
      const r = 0.205 + (-fy - 0.16) * 0.28; // widen with the flare
      const fold = mesh(new THREE.TorusGeometry(r, 0.011, 6, 20), matLungi, hips, 0, fy, 0);
      fold.rotation.set(Math.PI / 2 + tx, 0, tz);
    }
    // wrap overlap seam at the back (+Z): a curved partial shell
    const seam = mesh(
      new THREE.CylinderGeometry(0.252, 0.258, 0.5, 12, 1, true, -0.35, 0.7),
      matLungi, hips, 0, -0.28, 0
    );
    seam.castShadow = false;
    // kara border at the hem
    mesh(new THREE.CylinderGeometry(0.243, 0.247, 0.05, 18), matKara, hips, 0, -0.52, 0);
    mesh(new THREE.CylinderGeometry(0.247, 0.249, 0.018, 18), matKaraDark, hips, 0, -0.552, 0);

    // ---- legs: thigh + knee + shin on hip pivots, bare feet ----
    const makeLeg = (sx) => {
      const leg = new THREE.Group();
      leg.position.set(0.11 * sx, 0, 0);
      hips.add(leg);
      mesh(new THREE.CylinderGeometry(0.066, 0.056, 0.44, 12), matSkin, leg, 0, -0.22, 0);
      mesh(new THREE.SphereGeometry(0.058, 10, 8), matSkin, leg, 0, -0.44, 0); // knee
      mesh(new THREE.CylinderGeometry(0.054, 0.042, 0.42, 12), matSkin, leg, 0, -0.65, 0);
      const foot = mesh(new THREE.SphereGeometry(0.075, 12, 10), matSkin, leg, 0, -0.895, -0.05);
      foot.scale.set(0.85, 0.45, 1.5); // bare foot, sole lands ~0.02
      return leg;
    };
    const legL = makeLeg(-1);
    const legR = makeLeg(1);

    // ---- torso (waist pivot) ----
    const torso = new THREE.Group();
    torso.position.set(0, 0.12, 0);
    hips.add(torso);

    // jubba: lathe-turned cloth form — shaped shoulder, fitted waist, flared
    // skirt to the knees (a real cloth silhouette, not a cone)
    const jubbaProfile = [
      [0.100, 0.36], [0.145, 0.30], [0.168, 0.22], [0.178, 0.10],
      [0.185, -0.05], [0.205, -0.20], [0.235, -0.33], [0.265, -0.43], [0.280, -0.50],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const jubbaMesh = mesh(new THREE.LatheGeometry(jubbaProfile, 22), matJubba, torso, 0, 0, 0);
    // hem band: separate flared skirt ring that sways with speed/stride
    const hemProfile = [
      [0.278, 0.03], [0.295, -0.03], [0.308, -0.09], [0.315, -0.14],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const jubbaHem = mesh(new THREE.LatheGeometry(hemProfile, 22), matJubba, torso, 0, -0.46, 0);
    // front placket: curved cloth strip down the chest (front = -Z) with gold buttons
    const placket = mesh(
      new THREE.CylinderGeometry(0.186, 0.20, 0.52, 10, 1, true, Math.PI - 0.20, 0.40),
      matJubba, torso, 0, 0.02, 0
    );
    placket.castShadow = false;
    mesh(new THREE.SphereGeometry(0.013, 8, 6), matGold, torso, 0, 0.20, -0.183);
    mesh(new THREE.SphereGeometry(0.013, 8, 6), matGold, torso, 0, 0.10, -0.190);
    mesh(new THREE.SphereGeometry(0.013, 8, 6), matGold, torso, 0, 0.00, -0.196);
    // rounded shoulder cap under the jubba neckline
    const shoulderCap = mesh(new THREE.SphereGeometry(0.16, 14, 10), matJubba, torso, 0, 0.27, 0);
    shoulderCap.scale.set(1.3, 0.6, 1.0);
    // collar ring + neck
    const collar = mesh(new THREE.TorusGeometry(0.075, 0.02, 8, 16), matJubba, torso, 0, 0.30, 0);
    collar.rotation.x = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 10), matSkin, torso, 0, 0.34, 0);

    // ---- arms on shoulder pivots: cloth sleeve + kara cuff + forearm + hand ----
    const makeArm = (sx) => {
      const arm = new THREE.Group();
      arm.position.set(0.225 * sx, 0.20, 0);
      torso.add(arm);
      mesh(new THREE.CylinderGeometry(0.064, 0.056, 0.28, 12), matJubba, arm, 0, -0.14, 0);
      const cuff = mesh(new THREE.TorusGeometry(0.057, 0.013, 6, 14), matKara, arm, 0, -0.275, 0);
      cuff.rotation.x = Math.PI / 2;
      const fore = new THREE.Group();
      fore.position.set(0, -0.28, 0);
      arm.add(fore);
      mesh(new THREE.CylinderGeometry(0.047, 0.040, 0.24, 12), matJubba, fore, 0, -0.12, 0);
      const hand = mesh(new THREE.SphereGeometry(0.056, 10, 8), matSkin, fore, 0, -0.265, 0);
      hand.scale.set(0.9, 1.15, 0.95);
      return { arm, fore };
    };
    const aL = makeArm(-1);
    const aR = makeArm(1);

    // ---- head ----
    const head = new THREE.Group();
    head.position.set(0, 0.40, 0); // world y ~1.47
    torso.add(head);
    mesh(new THREE.SphereGeometry(0.155, 16, 14), matSkin, head, 0, 0, 0);
    // face on -Z side: eyes, brows, nose, smile
    mesh(new THREE.SphereGeometry(0.023, 8, 8), matDark, head, -0.060, 0.020, -0.140);
    mesh(new THREE.SphereGeometry(0.023, 8, 8), matDark, head, 0.060, 0.020, -0.140);
    for (const sx of [-1, 1]) {
      const browG = new THREE.Group();
      browG.position.set(0.060 * sx, 0.062, -0.138);
      browG.rotation.y = Math.PI; // face -Z
      head.add(browG);
      const brow = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.007, 6, 10, Math.PI * 0.8), matDark);
      brow.rotation.z = Math.PI * 0.1; // centre the arc over the eye
      brow.castShadow = true;
      browG.add(brow);
    }
    const nose = mesh(new THREE.SphereGeometry(0.02, 8, 8), matSkin, head, 0, -0.015, -0.148);
    nose.scale.set(0.85, 1.15, 0.8);
    const smile = mesh(new THREE.TorusGeometry(0.048, 0.008, 6, 12, Math.PI), matSmile, head, 0, -0.058, -0.140);
    smile.rotation.z = Math.PI; // lower-half arc = smile

    // ---- thalappav: wrapped tori with natural tilt + dome cap + gold ring ----
    // (kept as the readable-from-behind identity: white wrap + tail silhouette)
    const band1 = mesh(new THREE.TorusGeometry(0.148, 0.040, 8, 18), matTurban, head, 0, 0.085, 0);
    band1.rotation.set(Math.PI / 2 + 0.05, 0, 0.04);
    const band2 = mesh(new THREE.TorusGeometry(0.136, 0.038, 8, 18), matTurban, head, 0, 0.135, 0);
    band2.rotation.set(Math.PI / 2 - 0.04, 0, -0.10);
    const band3 = mesh(new THREE.TorusGeometry(0.118, 0.034, 8, 18), matTurban, head, 0, 0.180, 0);
    band3.rotation.set(Math.PI / 2 + 0.03, 0, 0.08);
    mesh(new THREE.SphereGeometry(0.112, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), matTurban, head, 0, 0.165, 0);
    const goldRing = mesh(new THREE.TorusGeometry(0.150, 0.009, 6, 22), matGold, head, 0, 0.108, 0);
    goldRing.rotation.x = Math.PI / 2;
    mesh(new THREE.SphereGeometry(0.048, 10, 8), matTurban, head, 0, 0.030, 0.148); // knot at nape

    // tail: two-segment cloth hinge (root + tip) so it waves instead of
    // swinging as one stiff plane. Root pivot at the nape (+Z/back).
    const turbanTail = new THREE.Group();
    turbanTail.position.set(0.025, 0.055, 0.148);
    head.add(turbanTail);
    const tailMat = new THREE.MeshPhysicalMaterial({
      color: TURBAN_WHITE, roughness: 0.7, sheen: 0.5, sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide,
    });
    const tailGeo = new THREE.PlaneGeometry(0.10, 0.22, 1, 3);
    tailGeo.translate(0, -0.11, 0); // pivot at top edge
    const tailMesh = new THREE.Mesh(tailGeo, tailMat);
    tailMesh.castShadow = true;
    turbanTail.add(tailMesh);
    const tailTip = new THREE.Group();
    tailTip.position.set(0, -0.22, 0.008);
    turbanTail.add(tailTip);
    const tipGeo = new THREE.PlaneGeometry(0.085, 0.20, 1, 3);
    tipGeo.translate(0, -0.10, 0);
    const tipMesh = new THREE.Mesh(tipGeo, tailMat);
    tipMesh.castShadow = true;
    tailTip.add(tipMesh);

    this.parts = {
      hips, torso, head,
      armL: aL.arm, armR: aR.arm,
      forearmL: aL.fore, forearmR: aR.fore,
      legL, legR,
      jubbaMesh, jubbaHem, lungiMesh, turbanTail, tailTip,
    };
  }

  // ------------------------------------------------------------------ anims
  setAnim(name) {
    if (!AVATAR_ANIMS.includes(name)) return;
    if (name === this.anim && this.animT > 0) {
      // re-trigger one-shots cleanly
      this.animT = 0;
      this._prev = { ...this._pose };
      this._blendT = 0;
      return;
    }
    this.anim = name;
    this.animT = 0;
    this._prev = { ...this._pose };
    this._blendT = 0;
  }

  reset() {
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.groupOffsetY = 0;
    this._pose = basePose();
    this._prev = basePose();
    this._blendT = 1;
    this.anim = 'idle';
    this.animT = 0;
    this.runRate = 1;
    this.runPhase = 0;
  }

  // ------------------------------------------------------------- pose table
  _poseIdle(t) {
    const p = basePose();
    p.torsoSY = 1 + 0.01 * Math.sin(t * 2); // breathing
    p.armLz = 0.08; p.armRz = -0.08;
    p.foreLx = 0.12; p.foreRx = 0.12;
    p.headRY = 0.1 * Math.sin(t * 0.8);
    p.tailX = 0.06 * Math.sin(t * 1.5);
    p.tailTipX = 0.08 * Math.sin(t * 1.5 + 0.6);
    p.hemX = 0.02 * Math.sin(t * 1.8); // cloth settles
    return p;
  }

  _poseReading(t) {
    const p = basePose();
    p.hipsY = 0.55 - HIPS_BASE_Y; // seated
    p.legLx = 1.4; p.legRx = 1.4; // thighs forward (sitting)
    p.armLx = 0.9; p.armRx = 0.9; // arms forward holding kitab
    p.foreLx = 0.9; p.foreRx = 0.9;
    p.headRX = -0.3; // looking down at the book
    p.torsoRX = -0.12;
    p.torsoSY = 1 + 0.008 * Math.sin(t * 2);
    p.tailX = 0.05 * Math.sin(t * 1.2);
    p.tailTipX = 0.06 * Math.sin(t * 1.2 + 0.5);
    p.hemX = 0.10; // jubba drapes over the lap
    return p;
  }

  _poseRun(t) {
    const p = basePose();
    // Stride phase comes from the controller (tied to actual speed), not
    // from animT, so the legs never drift out of sync with the footsteps.
    const ph = this.runPhase || 0;
    // runRate tracks speed/8: cloth energy scales with real speed.
    const rate = Math.min(2.0, Math.max(0.25, this.runRate || 1));
    const sL = Math.sin(ph);
    const sR = Math.sin(ph + Math.PI);
    p.legLx = sL * 0.75;
    p.legRx = sR * 0.75;
    p.armLx = sR * 0.62;
    p.armRx = sL * 0.62;
    p.armLz = 0.14; p.armRz = -0.14;
    p.foreLx = 0.8 + 0.18 * sR; // forearm pump
    p.foreRx = 0.8 + 0.18 * sL;
    p.hipsY = -0.05 * Math.abs(sL); // bob
    p.hipsRY = -0.10 * sL; // pelvic counter-rotation
    p.torsoRX = -0.16 + 0.035 * Math.sin(ph * 2); // forward lean + bounce
    p.torsoRY = 0.08 * sL; // shoulder counter-rotation
    p.headRX = 0.07;
    p.headRY = 0.06 * sL;
    const wind = Math.min(1.4, rate);
    p.tailX = (-0.55 - 0.30 * Math.sin(ph - 0.6)) * wind; // tail streams back
    p.tailTipX = -0.45 * Math.sin(ph - 1.3) * wind; // tip trails in a wave
    p.hemX = -0.16 * rate - 0.10 * Math.sin(ph * 2) * rate; // hem lifts back, flutters
    p.hemZ = 0.06 * Math.sin(ph) * rate;
    return p;
  }

  _poseJump(t) {
    const p = basePose();
    p.legLx = 0.9; p.legRx = 0.5; // tuck
    p.armLx = 2.8; p.armRx = 2.8; // arms up
    p.armLz = 0.25; p.armRz = -0.25;
    p.foreLx = 0.4; p.foreRx = 0.4;
    p.torsoRX = -0.1;
    p.headRX = 0.1;
    p.tailX = -0.2 - 0.08 * Math.sin(t * 10);
    p.tailTipX = -0.2 * Math.sin(t * 10 + 0.7);
    p.hemX = -0.35 - 0.08 * Math.sin(t * 10); // skirt flares in the air
    return p;
  }

  _poseSlide(t) {
    const p = basePose();
    p.hipsY = 0.35 - HIPS_BASE_Y; // low
    p.torsoRX = 0.5; // lean back
    p.legLx = 1.2; p.legRx = 1.2; // legs extended forward
    p.armLx = -0.6; p.armRx = -0.6; // arms trailing
    p.headRX = 0.25;
    p.tailX = -0.6;
    p.tailTipX = -0.3;
    p.hemX = 0.42; // hem spills forward over the knees
    return p;
  }

  _poseJetpack(t) {
    const p = basePose();
    p.hipsY = 0.04 * Math.sin(t * 3); // hover bob
    p.legLx = 0.25; p.legRx = 0.12; // dangling
    p.armLz = 0.45; p.armRz = -0.45; // slightly out
    p.armLx = 0.2; p.armRx = 0.2;
    p.foreLx = 0.3; p.foreRx = 0.3;
    p.torsoRX = -0.05;
    p.headRX = 0.12;
    p.tailX = -0.3 + 0.1 * Math.sin(t * 3);
    p.tailTipX = 0.12 * Math.sin(t * 3 + 0.8);
    p.hemX = -0.10 + 0.05 * Math.sin(t * 3); // skirt dangles in the wash
    return p;
  }

  _poseGlide(t) {
    const p = basePose();
    p.hipsY = -0.14; // slight crouch, feet together on board
    p.legLx = 0.05; p.legRx = 0.05;
    p.armLz = 0.85; p.armRz = -0.85; // out for balance
    p.armLx = 0.15; p.armRx = 0.15;
    p.torsoRX = -0.12;
    p.headRX = 0.08;
    p.tailX = -0.45 - 0.1 * Math.sin(t * 6);
    p.tailTipX = -0.2 * Math.sin(t * 6 + 0.6);
    p.hemX = -0.18 - 0.05 * Math.sin(t * 6);
    return p;
  }

  _computeTarget(t) {
    switch (this.anim) {
      case 'idle': return this._poseIdle(t);
      case 'reading': return this._poseReading(t);
      case 'run': return this._poseRun(t);
      case 'jump': return this._poseJump(t);
      case 'slide': return this._poseSlide(t);
      case 'jetpack': return this._poseJetpack(t);
      case 'glide': return this._poseGlide(t);
      case 'left': {
        const p = this._poseRun(t);
        p.leanZ = 0.3;
        p.torsoRY += 0.12;
        return p;
      }
      case 'right': {
        const p = this._poseRun(t);
        p.leanZ = -0.3;
        p.torsoRY -= 0.12;
        return p;
      }
      case 'collect': {
        const p = this._poseRun(t);
        const e = Math.sin(Math.min(1, t / 0.6) * Math.PI);
        p.armRx = 2.7 * e; // one arm up briefly
        p.armRz = -0.25 * e;
        p.foreRx = 0.3 * e;
        return p;
      }
      case 'react': {
        const p = this._poseIdle(t);
        const tt = Math.min(t, 0.4);
        const env = 1 - tt / 0.4;
        p.headRY = 0.9 * Math.sin(tt * 22) * env; // quick head turn
        p.armLx = 2.3 + Math.sin(tt * 30) * 0.6 * env; // flail
        p.armRx = 2.3 - Math.sin(tt * 30) * 0.6 * env;
        p.armLz = 0.5 * env; p.armRz = -0.5 * env;
        p.torsoRX = -0.12 * env;
        p.tailTipX = 0.35 * Math.sin(tt * 26) * env;
        return p;
      }
      case 'stumble': {
        const p = this._poseRun(t);
        const tt = Math.min(t, 0.5);
        const env = 1 - tt / 0.5;
        p.torsoRX += 0.55 * Math.sin(tt * 18) * env; // pitch wobble
        p.armLx = Math.sin(tt * 24) * 1.4; // windmill
        p.armRx = Math.sin(tt * 24 + Math.PI) * 1.4;
        p.headRX = -0.2 * env;
        p.tailTipX = 0.4 * Math.sin(tt * 24 + 1) * env;
        return p;
      }
      case 'standup': {
        const k = smooth01(t / 0.8);
        return lerpPose(this._poseReading(t), this._poseIdle(t), k);
      }
      case 'fall': {
        const p = basePose();
        const k = smooth01(t / 0.6);
        p.fallX = -1.5 * k; // whole group tips to lying (face-down forward)
        p.dropY = -0.15 * k;
        p.armLz = 1.1 * k; p.armRz = -1.1 * k;
        p.legLx = 0.2 * k; p.legRx = -0.15 * k;
        p.headRX = 0.2 * k;
        return p;
      }
      default: return this._poseIdle(t);
    }
  }

  _apply() {
    const p = this._pose;
    const P = this.parts;
    P.hips.position.y = HIPS_BASE_Y + p.hipsY;
    P.hips.rotation.x = p.hipsRX;
    P.hips.rotation.y = p.hipsRY;
    P.torso.rotation.x = p.torsoRX;
    P.torso.rotation.y = p.torsoRY;
    P.torso.rotation.z = p.torsoRZ;
    P.torso.scale.y = p.torsoSY;
    P.head.rotation.set(p.headRX, p.headRY, p.headRZ);
    P.armL.rotation.x = p.armLx; P.armL.rotation.z = p.armLz;
    P.armR.rotation.x = p.armRx; P.armR.rotation.z = p.armRz;
    P.forearmL.rotation.x = p.foreLx;
    P.forearmR.rotation.x = p.foreRx;
    P.legL.rotation.x = p.legLx;
    P.legR.rotation.x = p.legRx;
    this.group.rotation.z = p.leanZ;
    this.group.rotation.x = p.fallX;
    this.groupOffsetY = p.dropY;
    P.turbanTail.rotation.x = p.tailX;
    P.tailTip.rotation.x = p.tailTipX;
    P.jubbaHem.rotation.x = p.hemX;
    P.jubbaHem.rotation.z = p.hemZ;
  }

  update(dt) {
    this.animT += dt;
    const target = this._computeTarget(this.animT);
    this._blendT += dt;
    const k = smooth01(this._blendT / 0.18);
    this._pose = lerpPose(this._prev, target, k);
    this._apply();
  }
}

export default PlayerAvatar;
