// tests/model-loader.test.js — unit tests for src/assets/manifest.js
// (pure logic: manifest parsing, clip-name mapping, slot validation).
// ModelLoader.js itself needs a browser (fetch + GLTFLoader), so the
// runtime class is integration-tested by hand; everything testable here
// is tested here.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL_SLOTS,
  HERO_CLIP_SLOTS,
  ANIM_TO_CLIP,
  clipSlotFor,
  parseManifest,
  getSlot,
  isSlotMissing,
  clipFileFor,
  fallbackInfo,
} from '../src/assets/manifest.js';
import { AVATAR_ANIMS } from '../src/game/PlayerAvatar.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const shippedManifest = JSON.parse(
  readFileSync(join(repoRoot, 'public/models/manifest.json'), 'utf8')
);

describe('MODEL_SLOTS', () => {
  it('lists all 26 required slots', () => {
    expect(MODEL_SLOTS).toHaveLength(26);
    for (const s of ['hero', 'shaytan', 'bus', 'auto_rickshaw', 'pedestrian_a', 'palm', 'lampPost',
                     'car_sport', 'windmill', 'shaytan_reaper', 'shaytan_alt', 'hero_mascot']) {
      expect(MODEL_SLOTS).toContain(s);
    }
  });
});

describe('shipped manifest.json', () => {
  it('contains every required slot', () => {
    const parsed = parseManifest(shippedManifest);
    expect(parsed.errors.filter((e) => e.includes('missing from manifest'))).toEqual([]);
    for (const s of MODEL_SLOTS) expect(parsed.slots[s]).toBeDefined();
  });

  it('has file: null for every slot without a real supplied GLB (no invented filenames)', () => {
    // Oct 13, 2026: six slots now point at real fari-supplied GLBs. Every
    // other slot must stay file: null — a filename here is a promise that
    // the file exists under public/models/.
    // Oct 14, 2026: hero_mascot joins the integrated list (fari's hero GLB).
    const INTEGRATED = ['bus', 'car', 'car_sport', 'windmill', 'shaytan_reaper', 'shaytan_alt', 'hero_mascot'];
    const parsed = parseManifest(shippedManifest);
    for (const s of MODEL_SLOTS) {
      if (INTEGRATED.includes(s)) {
        const f = parsed.slots[s].file;
        expect(typeof f, `slot ${s}`).toBe('string');
        expect(
          existsSync(join(repoRoot, 'public', f)),
          `slot ${s} file ${f} must exist`
        ).toBe(true);
        expect(isSlotMissing(parsed.slots[s]), `slot ${s}`).toBe(false);
      } else {
        expect(parsed.slots[s].file, `slot ${s}`).toBeNull();
        expect(isSlotMissing(parsed.slots[s]), `slot ${s}`).toBe(true);
      }
    }
  });

  it('marks every slot honestly: integrated or procedural fallback', () => {
    const parsed = parseManifest(shippedManifest);
    for (const s of MODEL_SLOTS) {
      const st = parsed.slots[s].status || '';
      const ok = /integrated/i.test(st) || /procedural fallback active|no procedural variant/.test(st);
      expect(ok, `slot ${s} status "${st}"`).toBe(true);
    }
  });

  it('names a fallback builder or module for every slot', () => {
    const parsed = parseManifest(shippedManifest);
    for (const s of MODEL_SLOTS) {
      const info = fallbackInfo(parsed.slots[s]);
      expect(info.builder || info.module || info.note, `slot ${s}`).toBeTruthy();
    }
  });

  it('hero has all 13 clip slots, all file: null', () => {
    const parsed = parseManifest(shippedManifest);
    const hero = getSlot(parsed, 'hero');
    for (const clip of HERO_CLIP_SLOTS) {
      expect(hero.animations[clip], `clip ${clip}`).toBeDefined();
      expect(clipFileFor(hero, clip), `clip ${clip}`).toBeNull();
    }
  });
});

describe('ANIM_TO_CLIP', () => {
  it('covers every AVATAR_ANIMS name used by the game', () => {
    for (const anim of AVATAR_ANIMS) {
      expect(clipSlotFor(anim), `anim ${anim}`).not.toBeNull();
    }
  });

  it('maps reading->read, left/right->dodge, fall->gameover', () => {
    expect(clipSlotFor('reading')).toBe('read');
    expect(clipSlotFor('left')).toBe('dodge');
    expect(clipSlotFor('right')).toBe('dodge');
    expect(clipSlotFor('fall')).toBe('gameover');
    expect(clipSlotFor('glide')).toBe('glideboard');
  });

  it('returns null for unknown anim names (never invents a clip)', () => {
    expect(clipSlotFor('backflip')).toBeNull();
    expect(clipSlotFor('')).toBeNull();
  });
});

describe('parseManifest', () => {
  it('returns errors instead of throwing on non-object input', () => {
    for (const bad of [null, undefined, 42, 'nope']) {
      const p = parseManifest(bad);
      expect(p.errors.length).toBeGreaterThan(0);
      expect(p.slots).toEqual({});
    }
    // Arrays are objects: they parse but report every required slot missing.
    const arr = parseManifest([]);
    expect(arr.errors.some((e) => e.includes('missing from manifest'))).toBe(true);
  });

  it('flags missing required slots', () => {
    const p = parseManifest({ version: 1, slots: {} });
    expect(p.errors.some((e) => e.includes('"hero" missing'))).toBe(true);
  });

  it('flags unknown slots (likely typos)', () => {
    const p = parseManifest({ version: 1, slots: { heroo: { file: null } } });
    expect(p.errors.some((e) => e.includes('unknown slot "heroo"'))).toBe(true);
  });

  it('accepts a slot with a real file and clip files', () => {
    const p = parseManifest({
      version: 1,
      slots: {
        hero: {
          file: 'models/hero.glb',
          fallback: 'PlayerAvatar',
          fallbackModule: 'src/game/PlayerAvatar.js',
          status: 'integrated',
          animations: { run: { file: 'models/hero_run.glb', status: 'integrated' } },
        },
      },
    });
    const hero = getSlot(p, 'hero');
    expect(isSlotMissing(hero)).toBe(false);
    expect(clipFileFor(hero, 'run')).toBe('models/hero_run.glb');
    expect(clipFileFor(hero, 'idle')).toBeNull();
  });

  it('treats non-string file values as missing', () => {
    const p = parseManifest({ slots: { hero: { file: 123 } } });
    expect(isSlotMissing(getSlot(p, 'hero'))).toBe(true);
  });
});

describe('getSlot / fallbackInfo', () => {
  it('getSlot returns null for unknown slots and bad manifests', () => {
    expect(getSlot(null, 'hero')).toBeNull();
    expect(getSlot({ slots: {} }, 'hero')).toBeNull();
  });

  it('fallbackInfo degrades gracefully', () => {
    expect(fallbackInfo(null).note).toBe('no manifest entry');
  });
});
