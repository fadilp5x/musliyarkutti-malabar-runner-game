// tests/collision.test.js — CollisionSystem pure helpers (world workstream).
import { describe, it, expect } from 'vitest';
import { aabbOverlap, rowIsFair } from '../src/game/CollisionSystem.js';

const box = (x0, x1, y0, y1, z0, z1) => ({ x0, x1, y0, y1, z0, z1 });

describe('aabbOverlap', () => {
  it('returns true for overlapping boxes', () => {
    expect(aabbOverlap(
      box(0, 2, 0, 2, 0, 2),
      box(1, 3, 1, 3, 1, 3),
    )).toBe(true);
  });

  it('returns false when boxes only touch at edges (strict <)', () => {
    expect(aabbOverlap(
      box(0, 2, 0, 2, 0, 2),
      box(2, 4, 0, 2, 0, 2), // touches at x = 2
    )).toBe(false);
    expect(aabbOverlap(
      box(0, 2, 0, 2, 0, 2),
      box(0, 2, 2, 4, 0, 2), // touches at y = 2
    )).toBe(false);
    expect(aabbOverlap(
      box(0, 2, 0, 2, 0, 2),
      box(0, 2, 0, 2, 2, 4), // touches at z = 2
    )).toBe(false);
  });

  it('returns false for separated boxes', () => {
    expect(aabbOverlap(
      box(0, 1, 0, 1, 0, 1),
      box(5, 6, 5, 6, 5, 6),
    )).toBe(false);
  });

  it('returns true when one box is inside the other', () => {
    expect(aabbOverlap(
      box(0, 10, 0, 10, 0, 10),
      box(2, 4, 2, 4, 2, 4),
    )).toBe(true);
  });
});

describe('rowIsFair', () => {
  it("['block','block','free'] is fair", () => {
    expect(rowIsFair(['block', 'block', 'free'])).toBe(true);
  });

  it('all block is not fair', () => {
    expect(rowIsFair(['block', 'block', 'block'])).toBe(false);
  });

  it('all jump is fair', () => {
    expect(rowIsFair(['jump', 'jump', 'jump'])).toBe(true);
  });

  it('all slide is fair', () => {
    expect(rowIsFair(['slide', 'slide', 'slide'])).toBe(true);
  });

  it("['block','jump','slide'] is not fair (no free lane and mixed)", () => {
    expect(rowIsFair(['block', 'jump', 'slide'])).toBe(false);
  });
});
