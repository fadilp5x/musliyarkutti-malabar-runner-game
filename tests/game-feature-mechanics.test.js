import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NearMissCombo, effectiveScoreMultiplier } from '../src/game/NearMissCombo.js';
import { MilestoneTracker } from '../src/game/MilestoneTracker.js';
import { ShieldBubble } from '../src/game/ShieldBubble.js';

describe('near-miss combo', () => {
  it('builds within four run-clock seconds and resets after a longer gap', () => {
    const combo = new NearMissCombo(4);
    expect(combo.record(10)).toBe(1);
    expect(combo.record(14)).toBe(1.25);
    expect(combo.record(17.9)).toBe(1.5);
    combo.update(21.91);
    expect(combo.streak).toBe(0);
    expect(combo.multiplier).toBe(1);
  });

  it('caps x2 power-up plus combo at x3 total', () => {
    expect(effectiveScoreMultiplier(2, true)).toBe(3);
    expect(effectiveScoreMultiplier(1.5, true)).toBe(3);
    expect(effectiveScoreMultiplier(1.5, false)).toBe(1.5);
  });
});

describe('kilometer milestone distances', () => {
  it('fires at exact 1000 m boundaries without render-time drift', () => {
    const milestones = new MilestoneTracker(1000);
    expect(milestones.crossed(999.99)).toEqual([]);
    expect(milestones.crossed(1000.01)).toEqual([1000]);
    expect(milestones.crossed(2999.9)).toEqual([2000]);
    expect(milestones.crossed(3000)).toEqual([3000]);
  });
});

describe('shield bubble lifecycle', () => {
  it('is parented to the avatar and uses a particle-free Low quality mode', () => {
    const avatar = new THREE.Group();
    const bubble = new ShieldBubble(avatar, { quality: 'low', reducedMotion: false });
    expect(bubble.group.parent).toBe(avatar);
    bubble.activate();
    bubble.update(0.25, 14.75);
    expect(bubble.group.visible).toBe(true);
    expect(bubble.mode).toBe('on');
    expect(bubble.particles.every((particle) => !particle.visible)).toBe(true);
    bubble.absorb();
    bubble.update(0.32, 0);
    expect(bubble.group.visible).toBe(false);
    bubble.dispose();
  });
});
