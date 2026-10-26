// validate-glb.mjs — inspect a GLB file and report whether it is game-ready.
// Usage: node tools/validate-glb.mjs <file.glb> [--expect-height=1.7]
//
// Checks (no rendering needed — parses the GLB container directly):
//   - valid GLB header (magic, version, length)
//   - JSON chunk parses; lists scenes / nodes / meshes / materials
//   - skins[] present? (a rigged character must have exactly >=1 skin with joints)
//   - animations[]: clip names + channel counts (a game-ready hero needs clips)
//   - world-space bounding box from POSITION accessors: height, lowest point
//     (feet should sit at y ~= 0), and footprint
//   - reports FAIL/WARN/PASS per check; exit code 1 if any FAIL.
//
// This is the gate every real model file must pass before it replaces a
// procedural fallback in public/models/manifest.json. See MODELS_GUIDE.md.
import { readFileSync } from 'fs';

const file = process.argv[2];
const expectHeight = parseFloat((process.argv.find(a => a.startsWith('--expect-height=')) || '=').split('=')[1]) || null;
if (!file) { console.error('Usage: node tools/validate-glb.mjs <file.glb> [--expect-height=1.7]'); process.exit(2); }

let fails = 0, warns = 0;
const pass = (m) => console.log('  PASS  ' + m);
const warn = (m) => { warns++; console.log('  WARN  ' + m); };
const fail = (m) => { fails++; console.log('  FAIL  ' + m); };

const buf = readFileSync(file);
console.log(`File: ${file} (${(buf.length / 1024).toFixed(1)} KB)`);

// --- header ---
const magic = buf.subarray(0, 4).toString('ascii');
const version = buf.readUInt32LE(4);
const length = buf.readUInt32LE(8);
if (magic !== 'glTF') { fail(`bad magic: ${JSON.stringify(magic)} (not a GLB)`); process.exit(1); }
if (version !== 2) { fail(`unsupported glTF version ${version} (need 2)`); process.exit(1); }
if (length !== buf.length) warn(`header length ${length} != actual ${buf.length}`);
pass(`GLB header ok (glTF v2, ${(length / 1024).toFixed(1)} KB)`);

// --- chunks ---
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const chunkLen = buf.readUInt32LE(off);
  const chunkType = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + chunkLen);
  if (chunkType === 0x4E4F534A) json = JSON.parse(data.toString('utf8'));       // JSON
  else if (chunkType === 0x004E4942) bin = data;                                  // BIN
  off += 8 + chunkLen;
}
if (!json) { fail('no JSON chunk found'); process.exit(1); }
pass('JSON chunk parses');

// --- structure ---
const n = (a) => (a ? a.length : 0);
console.log(`  info: ${n(json.scenes)} scene(s), ${n(json.nodes)} node(s), ${n(json.meshes)} mesh(es), ${n(json.materials)} material(s), ${n(json.skins)} skin(s), ${n(json.animations)} animation(s)`);
if (n(json.meshes) === 0) fail('no meshes — nothing to render');
else pass(`${n(json.meshes)} mesh(es) present`);

// --- rigging ---
if (n(json.skins) === 0) {
  fail('no skins[] — model is NOT rigged (cannot be animated by a skeleton)');
} else {
  const joints = json.skins[0].joints || [];
  pass(`rigged: ${n(json.skins)} skin(s), first skin has ${joints.length} joints`);
  if (joints.length < 10) warn('very few joints (<10) — fingers/limbs may be missing');
}

// --- animations ---
if (n(json.animations) === 0) {
  warn('no animation clips embedded — needs external clips or engine-driven poses');
} else {
  const names = json.animations.map(a => a.name || '(unnamed)');
  pass(`animation clips: ${names.join(', ')}`);
  const unnamed = names.filter(x => x === '(unnamed)').length;
  if (unnamed) warn(`${unnamed} clip(s) have no name — manifest clip mapping needs names`);
}

// --- bounding box from POSITION accessors ---
function accessorMinMax(acc) {
  if (!bin || !acc || !acc.bufferView === undefined) return null;
  const bv = json.bufferViews[acc.bufferView];
  if (!bv) return null;
  const compType = acc.componentType; // 5126 = float
  const count = acc.count;
  const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = 12; // VEC3 float
  if (compType !== 5126) return null;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const dv = new DataView(bin.buffer, bin.byteOffset + byteOffset);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = dv.getFloat32(i * stride + k * 4, true);
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
  }
  return { mn, mx };
}
let gmn = [Infinity, Infinity, Infinity], gmx = [-Infinity, -Infinity, -Infinity], got = 0;
for (const m of json.meshes || []) {
  for (const p of m.primitives || []) {
    const acc = json.accessors[p.attributes && p.attributes.POSITION];
    const r = accessorMinMax(acc);
    if (!r) continue;
    got++;
    for (let k = 0; k < 3; k++) { gmn[k] = Math.min(gmn[k], r.mn[k]); gmx[k] = Math.max(gmx[k], r.mx[k]); }
  }
}
if (!got) {
  warn('could not read POSITION bounds (skinned or sparse accessors) — scale check skipped');
} else {
  const size = gmx.map((v, k) => v - gmn[k]);
  console.log(`  info: bounds x[${gmn[0].toFixed(2)}, ${gmx[0].toFixed(2)}] y[${gmn[1].toFixed(2)}, ${gmx[1].toFixed(2)}] z[${gmn[2].toFixed(2)}, ${gmx[2].toFixed(2)}]`);
  console.log(`  info: height ${size[1].toFixed(2)} units, footprint ${size[0].toFixed(2)} x ${size[2].toFixed(2)}`);
  if (expectHeight && Math.abs(size[1] - expectHeight) > 0.35) {
    warn(`height ${size[1].toFixed(2)} differs from expected ${expectHeight} — model will be rescaled on load (ok) but check proportions`);
  } else if (expectHeight) pass(`height ~${expectHeight} as expected`);
  if (gmn[1] > 0.15) warn(`feet float at y=${gmn[1].toFixed(2)} (should be ~0) — will sink/float unless re-anchored`);
  else if (gmn[1] < -0.15) warn(`geometry extends below y=0 (${gmn[1].toFixed(2)}) — may clip through ground`);
  else pass('feet anchored near y=0');
}

console.log(`\nResult: ${fails} FAIL, ${warns} WARN`);
if (fails) { console.log('NOT game-ready — fix the FAIL items above.'); process.exit(1); }
console.log(warns ? 'Usable with the warnings noted.' : 'Game-ready.');
