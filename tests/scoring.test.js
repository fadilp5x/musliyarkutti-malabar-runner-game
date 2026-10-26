// tests/scoring.test.js — ScoringSystem (world workstream).
import { describe, it, expect } from 'vitest';
import { ScoringSystem } from '../src/game/ScoringSystem.js';

describe('ScoringSystem', () => {
  it('adds 1 score point per metre of distance', () => {
    const s = new ScoringSystem();
    s.addDistance(100);
    expect(s.score).toBe(100);
    expect(s.distanceM).toBe(100);
  });

  it('adds 10 score points per coin', () => {
    const s = new ScoringSystem();
    s.addCoins(3);
    expect(s.coins).toBe(3);
    expect(s.score).toBe(30);
  });

  it('applies the x2 multiplier to distance, coins, near-miss and bonus', () => {
    const s = new ScoringSystem();
    s.multiplier = 2;
    s.addDistance(50);
    expect(s.score).toBe(100);
    s.addCoins(2);
    expect(s.score).toBe(140); // 100 + 2*10*2
    s.addNearMiss();
    expect(s.score).toBe(190); // + 25*2
    s.addBonus(250);
    expect(s.score).toBe(690); // + 250*2
  });

  it('awards +25 for a near miss at x1', () => {
    const s = new ScoringSystem();
    s.addNearMiss();
    expect(s.nearMisses).toBe(1);
    expect(s.score).toBe(25);
  });

  it('resetRun zeroes run stats but keeps best', () => {
    const s = new ScoringSystem();
    s.addDistance(200);
    s.addCoins(5);
    s.commitBest();
    expect(s.best).toBe(250);
    s.resetRun();
    expect(s.score).toBe(0);
    expect(s.coins).toBe(0);
    expect(s.distanceM).toBe(0);
    expect(s.nearMisses).toBe(0);
    expect(s.best).toBe(250);
  });

  it('commitBest updates best to the max of best and score', () => {
    const s = new ScoringSystem();
    s.addDistance(100);
    s.commitBest();
    expect(s.best).toBe(100);
    s.addDistance(50);
    s.commitBest();
    expect(s.best).toBe(150);
    // lower score does not lower best
    s.resetRun();
    s.addDistance(10);
    s.commitBest();
    expect(s.best).toBe(150);
  });
});
